from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import BoardMatchCandidate, CompanionAttemptLease, Job, Match, RewardLedgerEntry
from app.services.boards import lock_board
from app.services.companion import _gep_managed_direct_settlement
from app.services.evaluator import _has_trusted_finality
from app.services.gep_settlement import (
    GEP_INTEGRITY_CLIENT_ATTESTED,
    GEP_SETTLEMENT_SOURCE,
    start_gep_attempt_lease,
)
from app.services.jobs import enqueue_job
from app.services.providers import DeadlockApiProvider, HistoryResult
from app.worker import (
    CompanionMatchNotReady,
    NoMatchYet,
    dispatch_outbox,
    handle_discover,
    handle_evaluate,
    handle_resolve_companion_match_auto,
    handle_settle_gep_match,
    reconcile_active_contracts,
)
from tests.test_gep_settlement_backend import (
    VERSION,
    create_board,
    create_identity,
    fresh_db,
    rollout,
    start_and_finalize,
)


@pytest.fixture
def use_provider():
    original = settings.provider

    def use():
        object.__setattr__(settings, "provider", "deadlock_api")

    yield use
    object.__setattr__(settings, "provider", original)


def history_row(board, user, match_id, *, offset=60, outcome=1):
    return {
        "account_id": user.account_id,
        "match_id": match_id,
        "start_time": int(board.locked_at.replace(tzinfo=timezone.utc).timestamp()) + offset,
        "match_mode": 1,
        "game_mode": 1,
        "match_duration_s": 2400,
        "player_kills": 4,
        "player_deaths": 3,
        "player_assists": 8,
        "player_match_outcome": outcome,
    }


def use_history(monkeypatch, rows, *, status=200, retry_after=None):
    monkeypatch.setattr(
        DeadlockApiProvider,
        "history",
        lambda self, account_id, **kwargs: HistoryResult(rows, False, status, retry_after),
    )
    monkeypatch.setattr(DeadlockApiProvider, "metadata", lambda self, match_id, **kwargs: None)


def sign(db, user):
    board, option = create_board(db, user, status="OFFERED", option_status="OFFERED")
    board = lock_board(db, user, [option.id], board.game_match_mode)
    board.locked_at = datetime.now(timezone.utc) - timedelta(hours=1)
    option.locked_at = board.locked_at
    db.commit()
    return board, option


def test_provider_signing_and_reconciler_ignore_offline_device_and_gep_flags(use_provider):
    use_provider()
    with fresh_db() as db, rollout():
        user, device = create_identity(db)
        device.last_seen_at = datetime.now(timezone.utc) - timedelta(days=7)
        db.commit()
        board, _ = sign(db, user)
        discovery = db.scalar(select(Job).where(Job.board_id == board.id, Job.type == "discover_match"))
        assert discovery is not None

        db.delete(discovery)
        db.commit()
        reconcile_active_contracts(db)
        assert db.scalar(select(Job).where(Job.board_id == board.id, Job.type == "discover_match"))

        result = start_gep_attempt_lease(
            db,
            device=device,
            user=user,
            session_id="provider-regression-test",
            steam_id64=user.steam_id64,
            game_match_mode=board.game_match_mode,
            companion_version=VERSION,
        )
        assert result["eligible"] is False
        assert db.scalar(select(CompanionAttemptLease)) is None
        assert not _gep_managed_direct_settlement(device, user)


def test_provider_mode_accepts_independent_finality_instead_of_client_attestation(use_provider):
    use_provider()
    with rollout():
        match = Match(
            provider="overwolf_gep",
            is_final=True,
            settlement_source=GEP_SETTLEMENT_SOURCE,
            integrity_status=GEP_INTEGRITY_CLIENT_ATTESTED,
        )
        assert not _has_trusted_finality(match)
        match.provider = "deadlock_api"
        assert _has_trusted_finality(match)


def test_old_companion_lookup_allows_history_to_claim_and_reward_once(monkeypatch, use_provider):
    use_provider()
    with fresh_db() as db:
        user, _ = create_identity(db)
        board, option = sign(db, user)
        old_id, penalized_id, valid_id = 900_770_000, 900_770_001, 900_770_002
        exact_hint = enqueue_job(
            db,
            "resolve_companion_match_auto",
            {"user_id": user.id, "mode_hint": board.game_match_mode, "external_match_id": old_id},
            "stale-companion-lookup",
            run_after=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        discovery = db.scalar(select(Job).where(Job.board_id == board.id, Job.type == "discover_match"))
        use_history(
            monkeypatch,
            [
                history_row(board, user, old_id, offset=-60),
                history_row(board, user, penalized_id, offset=10, outcome=3),
                history_row(board, user, valid_id),
            ],
        )
        handle_discover(db, discovery)
        assert board.attempts_used == 1
        candidate = db.scalar(select(BoardMatchCandidate).where(BoardMatchCandidate.board_id == board.id))
        assert candidate.status == "BOUND"
        assert db.get(Match, candidate.match_id).external_match_id == valid_id

        exact_hint.payload = {**exact_hint.payload, "external_match_id": valid_id}
        handle_resolve_companion_match_auto(db, exact_hint)
        evaluation, = db.scalars(select(Job).where(Job.board_id == board.id, Job.type == "evaluate_match")).all()
        handle_evaluate(db, evaluation)
        handle_evaluate(db, evaluation)
        while dispatch_outbox(db):
            pass
        assert option.status == "COMPLETED"
        assert board.attempts_used == 1
        assert user.xp == option.reward_xp
        assert len(db.scalars(select(RewardLedgerEntry).where(RewardLedgerEntry.user_id == user.id)).all()) == 1


def test_legacy_gep_job_waits_for_provider_confirmation(monkeypatch, use_provider):
    with fresh_db() as db, rollout():
        user, device = create_identity(db)
        board, _ = create_board(db, user)
        match_id = 900_770_003
        start_and_finalize(db, user, device, session_id="provider-legacy-match-job", match_id=match_id)
        job = db.scalar(select(Job).where(Job.type == "settle_gep_match"))
        use_provider()
        use_history(monkeypatch, [])
        with pytest.raises(CompanionMatchNotReady):
            handle_settle_gep_match(db, job)
        assert board.attempts_used == 0
        assert db.scalar(select(Match).where(Match.external_match_id == match_id)) is None

        board.locked_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        use_history(monkeypatch, [history_row(board, user, match_id)])
        job.attempts = 12
        handle_settle_gep_match(db, job)
        assert board.attempts_used == 1
        match = db.scalar(select(Match).where(Match.external_match_id == match_id))
        assert match.provider == "deadlock_api"


def test_history_rate_limit_reaches_discovery_scheduler(monkeypatch, use_provider):
    use_provider()
    with fresh_db() as db:
        user, _ = create_identity(db)
        board, _ = sign(db, user)
        use_history(monkeypatch, [], status=429, retry_after=1800)
        discovery = db.scalar(select(Job).where(Job.board_id == board.id, Job.type == "discover_match"))
        with pytest.raises(NoMatchYet) as caught:
            handle_discover(db, discovery)
        assert caught.value.retry_after == 1800
        assert board.attempts_used == 0



def test_two_players_keep_separate_scoring_status(use_provider):
    from app.models import MatchParticipant
    from app.services.evaluator import _result
    from app.services.normalization import normalize_deadlock_match
    from app.worker import store_normalized_match

    use_provider()
    with fresh_db() as db:
        owner, _ = create_identity(db)
        board, option = sign(db, owner)
        match_id = 900_770_004
        first = history_row(board, owner, match_id)
        penalty = dict(first, account_id=owner.account_id + 1, player_match_outcome=3)
        match = store_normalized_match(db, normalize_deadlock_match(owner.account_id, first, None))
        other = store_normalized_match(db, normalize_deadlock_match(penalty["account_id"], penalty, None))
        assert other.id == match.id

        players = {
            participant.account_id: participant
            for participant in db.scalars(select(MatchParticipant).where(MatchParticipant.match_id == match.id))
        }
        assert _result(option, match, players[owner.account_id]).status == "COMPLETED"
        assert _result(option, match, players[penalty["account_id"]]).status == "UNVERIFIABLE"


def test_postgresql_concurrent_first_record_keeps_both_participants():
    import os
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from uuid import uuid4

    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from sqlalchemy.schema import CreateSchema, DropSchema

    from app.db import Base
    from app.models import MatchParticipant
    from app.worker import store_normalized_match

    url = os.getenv("MATCH_VERIFICATION_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set MATCH_VERIFICATION_TEST_DATABASE_URL for the PostgreSQL test")
    schema = f"match_verification_{uuid4().hex}"
    engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})
    assert engine.dialect.name == "postgresql"
    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))
        Base.metadata.create_all(connection)

    barrier = Barrier(2)

    @event.listens_for(engine, "after_cursor_execute")
    def wait_after_first_lookup(conn, cursor, statement, parameters, context, executemany):
        # Both connections must see the miss before either inserts.
        if "matches.external_match_id =" in statement and not conn.info.get("match_lookup_seen"):
            conn.info["match_lookup_seen"] = True
            barrier.wait(timeout=10)

    def store(account_id):
        with Session(engine) as db:
            return store_normalized_match(
                db,
                {
                    "external_match_id": 900_770_005,
                    "provider": "deadlock_api",
                    "is_final": True,
                    "scoring_status": "SCORED",
                    "participant": {"account_id": account_id, "kills": account_id},
                },
            ).id

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first, second = executor.map(store, (42, 43))
        assert first == second
        with Session(engine) as db:
            participants = db.scalars(select(MatchParticipant).where(MatchParticipant.match_id == first))
            assert {participant.account_id: participant.kills for participant in participants} == {42: 42, 43: 43}
    finally:
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        engine.dispose()



def test_companion_hint_checks_exact_match_before_background_history(monkeypatch, use_provider):
    from app.services.companion import _register_direct_match_job

    use_provider()
    with fresh_db() as db, rollout():
        user, device = create_identity(db)
        board, option = sign(db, user)
        match_id = 900_770_006
        _register_direct_match_job(
            db,
            device=device,
            user=user,
            mode=board.game_match_mode,
            match_id=match_id,
            identity_ok=True,
        )
        db.commit()
        exact_hint = db.scalar(select(Job).where(Job.type == "resolve_companion_match_auto"))
        assert exact_hint is not None

        def metadata(self, external_match_id, *, disable_steam=False):
            assert external_match_id == match_id and disable_steam
            return {
                "match_info": {
                    "match_id": match_id,
                    "start_time": int(board.locked_at.replace(tzinfo=timezone.utc).timestamp()) + 60,
                    "match_mode": 1,
                    "game_mode": 1,
                    "duration_s": 2400,
                    "players": [{"account_id": user.account_id, "assists": 8, "player_match_outcome": 1}],
                },
            }

        def unexpected_history(self, account_id, **kwargs):
            pytest.fail("Exact independent metadata should avoid a history request")

        monkeypatch.setattr(DeadlockApiProvider, "metadata", metadata)
        monkeypatch.setattr(DeadlockApiProvider, "history", unexpected_history)
        handle_resolve_companion_match_auto(db, exact_hint)
        job = db.scalar(select(Job).where(Job.type == "discover_match"))
        handle_discover(db, job)

        assert board.attempts_used == 1
        assert option.status == "VERIFYING"
        candidate, = db.scalars(select(BoardMatchCandidate)).all()
        assert candidate.capture_source == "COMPANION_AUTO"
        assert candidate.status == "BOUND"


def test_exact_lookup_waits_on_provider_rate_limit(monkeypatch, use_provider):
    from app.services.providers import ProviderRateLimited

    use_provider()
    with fresh_db() as db:
        user, _ = create_identity(db)
        board, _ = sign(db, user)
        exact_hint = enqueue_job(
            db,
            "resolve_companion_match_auto",
            {"user_id": user.id, "mode_hint": board.game_match_mode, "external_match_id": 900_770_007},
            "rate-limited-companion-lookup",
        )
        fetches = []

        def rate_limited(self, match_id, **kwargs):
            fetches.append(match_id)
            raise ProviderRateLimited(retry_after=1100)

        monkeypatch.setattr(DeadlockApiProvider, "metadata", rate_limited)
        with pytest.raises(CompanionMatchNotReady) as caught:
            handle_resolve_companion_match_auto(db, exact_hint)
        assert caught.value.delay_seconds >= 1100
        assert len(fetches) == 1
        assert board.attempts_used == 0



def test_exact_metadata_cannot_override_explicit_history_penalty(monkeypatch, use_provider):
    use_provider()
    with fresh_db() as db:
        user, _ = create_identity(db)
        board, _ = sign(db, user)
        match_id = 900_770_008
        row = history_row(board, user, match_id, outcome=3)
        use_history(monkeypatch, [row])
        monkeypatch.setattr(
            DeadlockApiProvider,
            "metadata",
            lambda self, external_match_id, **kwargs: {
                "match_info": {
                    "match_id": match_id,
                    "start_time": row["start_time"],
                    "match_mode": 1,
                    "game_mode": 1,
                    "duration_s": 2400,
                    "match_result": 0,
                    "players": [{"account_id": user.account_id, "player_team": 0, "assists": 8}],
                },
            },
        )
        exact_hint = enqueue_job(
            db,
            "resolve_companion_match_auto",
            {"user_id": user.id, "mode_hint": board.game_match_mode, "external_match_id": match_id},
            "penalized-companion-lookup",
        )
        handle_resolve_companion_match_auto(db, exact_hint)
        assert board.attempts_used == 0
        assert db.scalar(select(BoardMatchCandidate)) is None




@pytest.mark.parametrize("body", [b'{"error":"rate limited"}', b"<html>Rate limited</html>"])
def test_history_preserves_retry_after_on_429_error_body(body):
    import httpx

    transport = httpx.MockTransport(
        lambda request: httpx.Response(429, content=body, headers={"Retry-After": "1800"})
    )
    provider = object.__new__(DeadlockApiProvider)
    with httpx.Client(transport=transport, base_url="https://api.deadlock-api.com") as client:
        provider.client = client
        result = provider.history(42)
    assert result.status_code == 429
    assert result.retry_after == 1800
    assert result.matches == []


def test_refresh_preserves_a_legacy_participants_status(use_provider):
    from app.models import MatchParticipant
    from app.worker import store_normalized_match

    use_provider()
    with fresh_db() as db:
        match = Match(
            external_match_id=900_770_009,
            provider="deadlock_api",
            mode_classifier_version="test",
            scoring_status="PENALIZED",
            is_final=True,
        )
        db.add(match)
        db.flush()
        legacy = MatchParticipant(match_id=match.id, account_id=42)
        db.add(legacy)
        db.commit()

        store_normalized_match(db, {
            "external_match_id": match.external_match_id,
            "provider": "deadlock_api",
            "scoring_status": "SCORED",
            "is_final": True,
            "participant": {"account_id": 43, "assists": 8},
        })
        assert legacy.scoring_status == "PENALIZED"
        assert match.scoring_status == "SCORED"


def test_provider_reconciles_an_active_board_with_a_client_only_baseline(use_provider):
    from app.worker import store_normalized_match

    use_provider()
    with fresh_db() as db:
        user, _ = create_identity(db)
        old = store_normalized_match(db, {
            "external_match_id": 9_999_999_999,
            "provider": "gep_fallback",
            "scoring_status": "UNVERIFIABLE",
            "participant": {"account_id": user.account_id},
        })
        board, _ = sign(db, user)
        assert board.baseline_match_id is None
        board.baseline_match_id = old.external_match_id
        db.commit()
        reconcile_active_contracts(db)
        assert board.baseline_match_id is None
