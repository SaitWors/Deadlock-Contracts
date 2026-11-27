from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db import Base

from app.models import CompanionEvent, ContractRelayConnection, Evaluation, Match, User
from app.relay_measurement_models import RelayMatchObservation
from app.services.normalization import normalize_deadlock_match
from app.services.relay_effectiveness import record_bound_attempt, summary
from app.worker import store_normalized_match
from tests.test_gep_settlement_backend import create_board, create_identity, fresh_db

END = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)


@contextmanager
def _measurement_db():
    url = os.getenv("RELAY_MEASUREMENT_TEST_DATABASE_URL")
    if not url:
        with fresh_db() as db:
            yield db
        return

    schema = f"relay_measurement_{uuid4().hex}"
    engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})
    assert engine.dialect.name == "postgresql"
    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))
        Base.metadata.create_all(connection)
    try:
        with Session(engine) as db:
            yield db
    finally:
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        engine.dispose()


def _match(db, external_id, *, metadata_seconds=None, game_mode="STANDARD"):
    match = Match(
        external_match_id=external_id,
        provider="deadlock_api",
        mode_classifier_version="test-v1",
        started_at=END - timedelta(minutes=30),
        ended_at=END,
        game_match_mode=game_mode,
        integrity_status="SERVER_VERIFIED",
        relay_provider_metadata_observed_at=None if metadata_seconds is None else END + timedelta(seconds=metadata_seconds),
    )
    db.add(match)
    db.flush()
    return match


def _settle(db, option, match, elapsed, *, evidence="VERIFIED_SUMMARY"):
    evaluation = Evaluation(
        assignment_id=option.id,
        match_id=match.id,
        status="FAILED",
        evaluator_version="test-v1",
        evidence_level=evidence,
        explanation="Test evaluation",
    )
    db.add(evaluation)
    db.flush()
    option.bound_match_id = match.id
    option.final_evaluation_id = evaluation.id
    option.settled_at = END + timedelta(seconds=elapsed)
    option.status = "FAILED"


def test_only_actual_metadata_observation_is_recorded_and_the_earliest_is_kept():
    history = {"match_id": 500123, "start_time": int(END.timestamp()), "account_id": 8888}
    no_metadata = normalize_deadlock_match(8888, history, None)
    unexpected_metadata = normalize_deadlock_match(8888, history, {"error": "no data"})
    wrong_match = normalize_deadlock_match(8888, history, {"match_info": {"match_id": 500321, "players": [{"account_id": 8888}]}})
    metadata = normalize_deadlock_match(8888, history, {"match_info": {"match_id": 500123, "duration_s": 1500}})
    key = "relay_provider_metadata_observed_at"
    assert no_metadata[key] is None
    assert unexpected_metadata[key] is None
    assert wrong_match[key] is None
    assert metadata[key] is not None

    with _measurement_db() as db:
        assert store_normalized_match(db, no_metadata).relay_provider_metadata_observed_at is None
        observed = END + timedelta(seconds=80)
        newer = {**metadata, key: observed + timedelta(seconds=20)}
        earlier = {**metadata, key: observed}
        client = {**metadata, "provider": "overwolf_gep", key: END}
        store_normalized_match(db, newer)
        store_normalized_match(db, earlier)
        store_normalized_match(db, client)
        stored = store_normalized_match(db, no_metadata).relay_provider_metadata_observed_at
        assert stored.replace(tzinfo=timezone.utc) == observed


def test_report_uses_persisted_observations_and_rejects_pending_or_future_friendship():
    with _measurement_db() as db:
        user, device = create_identity(db)
        connection = ContractRelayConnection(
            user_id=user.id,
            consented_at=END - timedelta(hours=2),
            friendship_confirmed_at=END - timedelta(hours=1),
        )
        db.add(connection)
        db.commit()

        board, option = create_board(db, user)
        known = _match(db, 501001, metadata_seconds=120)
        # An exact, authenticated terminal signal distinguishes actual use from a merely paired device.
        db.add(CompanionEvent(
            user_id=user.id,
            device_id=device.id,
            event_type="match_ended",
            external_match_id=known.external_match_id,
            payload={"identity_ok": True, "session": {"match_clock_s": 1800}},
            created_at=END,
        ))
        record_bound_attempt(db, board, known, END + timedelta(seconds=120))
        _settle(db, option, known, 150)
        board.status = "SETTLED"
        board.board_date -= timedelta(days=1)
        db.commit()

        board, option = create_board(db, user)
        connection.friendship_confirmed_at = END + timedelta(seconds=20)
        db.commit()
        unknown = _match(db, 501002, game_mode="RANKED")
        db.add(CompanionEvent(
            user_id=user.id,
            device_id=device.id,
            event_type="match_ended",
            external_match_id=unknown.external_match_id,
            payload={"identity_ok": False, "session": {"match_clock_s": 1800}},
            created_at=END,
        ))
        record_bound_attempt(db, board, unknown, END + timedelta(seconds=45))
        _settle(db, option, unknown, 90, evidence="INTERNAL_REVIEW")
        db.commit()

        # Revocation must never reclassify prior enrolled or unknown observations as baseline.
        db.delete(connection)
        db.commit()
        report = summary(db, END - timedelta(days=1), END + timedelta(days=1), now=END + timedelta(minutes=6))

    assert report["sample_size"] == 2
    assert report["quota_at_match_time"] == "unobserved"
    assert report["cohorts"] == [
        {
            "relay": "eligible", "companion": "observed", "mode": "STANDARD", "sample_size": 1,
            "metadata_unobserved_count": 0, "unresolved_count": 0, "confirmed_share": 1.0,
            "discovery": {"observed_count": 1, "median_seconds": 120, "p90_seconds": 120},
            "verification": {"observed_count": 1, "median_seconds": 150, "p90_seconds": 150},
            "after_discovery": {"observed_count": 1, "median_seconds": 30, "p90_seconds": 30},
        },
        {
            "relay": "unknown", "companion": "unobserved", "mode": "RANKED", "sample_size": 1,
            "metadata_unobserved_count": 1, "unresolved_count": 1, "confirmed_share": 0.0,
            "discovery": {"observed_count": 0, "median_seconds": None, "p90_seconds": None},
            "verification": {"observed_count": 0, "median_seconds": None, "p90_seconds": None},
            "after_discovery": {"observed_count": 0, "median_seconds": None, "p90_seconds": None},
        },
    ]


def test_baseline_discloses_unresolved_coverage_and_ignores_legacy_and_future_records():
    with _measurement_db() as db:
        user = User(account_id=8989)
        db.add(user)
        db.commit()
        board, option = create_board(db, user)
        legacy = _match(db, 502001, metadata_seconds=60)
        legacy.ended_at = END - timedelta(seconds=1)
        baseline = _match(db, 502002, metadata_seconds=90)
        record_bound_attempt(db, board, baseline, END + timedelta(seconds=50))
        _settle(db, option, baseline, 70)  # history settlement can precede full metadata
        future = _match(db, 502003, metadata_seconds=220)
        record_bound_attempt(db, board, future, END + timedelta(seconds=200))
        missing_end = _match(db, 502004)
        missing_end.ended_at = None
        record_bound_attempt(db, board, missing_end, END + timedelta(seconds=45))
        db.commit()

        window = (END - timedelta(days=1), END + timedelta(days=1))
        pilot_report = summary(db, *window, now=END + timedelta(seconds=80))
        later_report = summary(db, *window, now=END + timedelta(seconds=100))
        assert len(db.scalars(select(RelayMatchObservation)).all()) == 3

    assert pilot_report["sample_size"] == 1
    assert pilot_report["unknown_match_end_count"] == 1
    assert pilot_report["cohorts"] == [{
        "relay": "baseline", "companion": "unobserved", "mode": "STANDARD", "sample_size": 1,
        "metadata_unobserved_count": 1, "unresolved_count": 0, "confirmed_share": 1.0,
        "discovery": {"observed_count": 0, "median_seconds": None, "p90_seconds": None},
        "verification": {"observed_count": 1, "median_seconds": 70, "p90_seconds": 70},
        "after_discovery": {"observed_count": 0, "median_seconds": None, "p90_seconds": None},
    }]
    assert later_report["cohorts"][0]["discovery"]["observed_count"] == 1
    assert later_report["cohorts"][0]["after_discovery"]["observed_count"] == 0
