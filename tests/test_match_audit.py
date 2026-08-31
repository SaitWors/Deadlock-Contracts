from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import Integer, create_engine, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base
from app.models import (
    CompanionAttemptLease,
    CompanionMatchEvidence,
    Job,
    Match,
    MatchParticipant,
    RewardLedgerEntry,
    User,
)
from app.services.gep_settlement import (
    GEP_INTEGRITY_CLIENT_ATTESTED,
    GEP_SETTLEMENT_SOURCE,
    normalized_gep_match_from_evidence,
)
from app.services.match_audit import (
    MatchAuditPending,
    reconcile_match_audits,
    run_match_audit_job,
    schedule_gep_match_audit,
)
from app.services.providers import ProviderError
from app.worker import process_job


STEAM_ID = 76561198736917392
ACCOUNT_ID = 736917392


@contextmanager
def audit_settings(
    *,
    enabled: bool = True,
    max_attempts: int = 3,
    retry_seconds: int = 60,
):
    old = {
        "match_audit_enabled":
            settings.match_audit_enabled,
        "match_audit_max_attempts":
            settings.match_audit_max_attempts,
        "match_audit_retry_seconds":
            settings.match_audit_retry_seconds,
    }

    object.__setattr__(
        settings,
        "match_audit_enabled",
        enabled,
    )
    object.__setattr__(
        settings,
        "match_audit_max_attempts",
        max_attempts,
    )
    object.__setattr__(
        settings,
        "match_audit_retry_seconds",
        retry_seconds,
    )

    try:
        yield
    finally:
        for key, value in old.items():
            object.__setattr__(
                settings,
                key,
                value,
            )


def fresh_db() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={
            "check_same_thread": False
        },
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def create_gep_match(
    db: Session,
) -> tuple[
    User,
    Match,
    MatchParticipant,
]:
    user = User(
        steam_id64=STEAM_ID,
        account_id=ACCOUNT_ID,
        display_name="Audit Test",
        status="ACTIVE",
        xp=777,
    )
    db.add(user)
    db.flush()

    match = Match(
        external_match_id=102900001,
        provider="overwolf_gep",
        started_at=(
            datetime.now(timezone.utc)
            - timedelta(minutes=17)
        ),
        ended_at=datetime.now(timezone.utc),
        duration_s=990,
        game_match_mode="STANDARD",
        provider_mode_raw="overwolf-gep:STANDARD",
        mode_classifier_version="gep-settlement-v1",
        mode_confidence="HIGH",
        scoring_status="SCORED",
        is_final=True,
        capabilities=[
            "summary.kills",
            "summary.deaths",
            "summary.assists",
            "summary.net_worth",
            "summary.hero_damage",
            "summary.object_damage",
            "summary.healing",
            "summary.result",
        ],
        settlement_source=GEP_SETTLEMENT_SOURCE,
        integrity_status=GEP_INTEGRITY_CLIENT_ATTESTED,
        audit_status="NOT_REQUESTED",
        raw_summary={
            "gep_settlement": {
                "policy_version": "gep-settlement-v1"
            }
        },
    )
    db.add(match)
    db.flush()

    participant = MatchParticipant(
        match_id=match.id,
        account_id=ACCOUNT_ID,
        steam_id64=STEAM_ID,
        hero_id=10,
        team=None,
        won=True,
        kills=4,
        deaths=3,
        assists=8,
        net_worth=34000,
        hero_damage=13054,
        object_damage=5082,
        healing=13222,
    )
    db.add(participant)

    db.add(
        RewardLedgerEntry(
            user_id=user.id,
            source_type="assignment",
            source_id="audit-existing-reward",
            delta=55,
            balance_after=777,
            policy_version="xp-v3",
        )
    )

    db.commit()
    db.refresh(user)
    db.refresh(match)
    db.refresh(participant)

    return user, match, participant


def matching_provider_payload(
    match: Match,
    *,
    assists: int = 8,
) -> dict:
    return {
        "external_match_id":
            int(match.external_match_id),
        "provider": "deadlock_api",
        "duration_s": 995,
        "game_match_mode": "STANDARD",
        "provider_mode_raw":
            "match_mode=1, game_mode=1",
        "participant": {
            "account_id": ACCOUNT_ID,
            "steam_id64": STEAM_ID,
            "hero_id": 10,
            "team": 3,
            "won": True,
            "kills": 4,
            "deaths": 3,
            "assists": assists,
            "net_worth": 34000,
            "hero_damage": 13054,
            "object_damage": 5082,
            "healing": 13222,
        },
    }


class MatchingProvider:
    payload: dict | None = None

    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type,
        exc,
        traceback,
    ):
        return None

    def fetch_match_by_id(
        self,
        account_id: int,
        match_id: int,
        *,
        disable_steam: bool = False,
        consult_history: bool = True,
    ):
        assert account_id == ACCOUNT_ID
        assert match_id == 102900001
        assert consult_history is True
        return self.payload


class UnavailableProvider:
    def __enter__(self):
        return self

    def __exit__(
        self,
        exc_type,
        exc,
        traceback,
    ):
        return None

    def fetch_match_by_id(
        self,
        *args,
        **kwargs,
    ):
        raise ProviderError(
            "provider unavailable for test"
        )


def reward_count(
    db: Session,
) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(RewardLedgerEntry)
        )
        or 0
    )


def test_audit_disabled_is_a_true_noop():
    db = fresh_db()

    try:
        user, match, _ = create_gep_match(db)

        with audit_settings(enabled=False):
            job = schedule_gep_match_audit(
                db,
                match,
                user.id,
            )

        db.refresh(match)

        assert job is None
        assert match.audit_status == "NOT_REQUESTED"
        assert match.audited_at is None
        assert user.xp == 777
        assert reward_count(db) == 1

    finally:
        db.close()


def test_audit_confirmed_is_observational_only(
    monkeypatch,
):
    db = fresh_db()

    try:
        user, match, _ = create_gep_match(db)
        original_provider = match.provider
        original_capabilities = list(match.capabilities)
        original_integrity = match.integrity_status

        MatchingProvider.payload = (
            matching_provider_payload(match)
        )

        monkeypatch.setattr(
            "app.services.match_audit.DeadlockApiProvider",
            MatchingProvider,
        )

        with audit_settings():
            job = schedule_gep_match_audit(
                db,
                match,
                user.id,
            )

            assert job is not None
            assert job.type == "audit_match"
            assert job.match_id == match.id

            job.attempts = 1
            db.commit()

            process_job(db, job)

        db.refresh(match)
        db.refresh(user)

        assert match.audit_status == "CONFIRMED"
        assert match.audited_at is not None

        audit = match.raw_summary["audit"]
        assert audit["status"] == "CONFIRMED"
        assert audit["non_authoritative"] is True
        assert audit["settlement_affected"] is False
        assert audit["reward_affected"] is False
        assert audit["mismatches"] == []

        # External audit must never replace GEP settlement facts.
        assert match.provider == original_provider
        assert match.capabilities == original_capabilities
        assert match.integrity_status == original_integrity
        assert match.settlement_source == GEP_SETTLEMENT_SOURCE

        # And it must never mutate rewards.
        assert user.xp == 777
        assert reward_count(db) == 1

    finally:
        db.close()


def test_audit_mismatch_never_revokes_xp(
    monkeypatch,
):
    db = fresh_db()

    try:
        user, match, _ = create_gep_match(db)

        MatchingProvider.payload = (
            matching_provider_payload(
                match,
                assists=99,
            )
        )

        monkeypatch.setattr(
            "app.services.match_audit.DeadlockApiProvider",
            MatchingProvider,
        )

        with audit_settings():
            job = schedule_gep_match_audit(
                db,
                match,
                user.id,
            )
            assert job is not None
            job.attempts = 1
            db.commit()

            run_match_audit_job(
                db,
                job,
            )

        db.refresh(match)
        db.refresh(user)

        assert match.audit_status == "MISMATCH"
        assert "assists" in (
            match.raw_summary["audit"]["mismatches"]
        )

        # MISMATCH is diagnostic in Alpha.11.
        assert user.xp == 777
        assert reward_count(db) == 1
        assert match.scoring_status == "SCORED"
        assert (
            match.integrity_status
            == GEP_INTEGRITY_CLIENT_ATTESTED
        )

    finally:
        db.close()


def test_provider_outage_retries_then_becomes_unavailable(
    monkeypatch,
):
    db = fresh_db()

    try:
        user, match, _ = create_gep_match(db)

        monkeypatch.setattr(
            "app.services.match_audit.DeadlockApiProvider",
            UnavailableProvider,
        )

        with audit_settings(
            max_attempts=2,
            retry_seconds=60,
        ):
            job = schedule_gep_match_audit(
                db,
                match,
                user.id,
            )
            assert job is not None

            job.max_attempts = 2
            job.attempts = 1
            db.commit()

            with pytest.raises(
                MatchAuditPending
            ) as exc:
                run_match_audit_job(
                    db,
                    job,
                )

            assert exc.value.delay_seconds == 60

            db.refresh(match)
            assert match.audit_status == "PENDING"
            assert user.xp == 777
            assert reward_count(db) == 1

            # Last retry exhausts only the audit budget.
            job.attempts = 2
            db.commit()

            run_match_audit_job(
                db,
                job,
            )

        db.refresh(match)
        db.refresh(user)

        assert match.audit_status == "UNAVAILABLE"
        assert match.audited_at is not None
        assert user.xp == 777
        assert reward_count(db) == 1

    finally:
        db.close()


def test_reconciler_backfills_not_requested_gep_audits():
    db = fresh_db()

    try:
        _, match, _ = create_gep_match(db)

        with audit_settings(enabled=True):
            scheduled = reconcile_match_audits(
                db
            )

        db.refresh(match)

        assert scheduled == 1
        assert match.audit_status == "PENDING"

        job = db.scalar(
            select(Job).where(
                Job.type == "audit_match",
                Job.match_id == match.id,
            )
        )

        assert job is not None

    finally:
        db.close()


def test_gep_team_name_is_not_written_into_integer_team_column():
    assert isinstance(
        MatchParticipant.__table__.c.team.type,
        Integer,
    )

    now = datetime.now(timezone.utc)

    user = User(
        id="user-team-test",
        steam_id64=STEAM_ID,
        account_id=ACCOUNT_ID,
        display_name="Team Test",
        status="ACTIVE",
    )

    lease = CompanionAttemptLease(
        id="lease-team-test",
        user_id=user.id,
        device_id="device-team-test",
        board_id="board-team-test",
        session_id="gep-session-team-test",
        attempt_nonce_hash="a" * 64,
        game_match_mode="STANDARD",
        external_match_id=102900002,
        status="CONSUMED",
        server_first_seen_at=(
            now - timedelta(minutes=17)
        ),
    )

    evidence = CompanionMatchEvidence(
        id="evidence-team-test",
        user_id=user.id,
        device_id="device-team-test",
        external_match_id=102900002,
        steam_id64=STEAM_ID,
        hero_id=10,
        kills=4,
        deaths=3,
        assists=8,
        hero_damage=13054,
        object_damage=5082,
        healing=13222,
        souls=34000,
        evidence_schema_version=9,
        gep_session_id=lease.session_id,
        attempt_nonce_hash=lease.attempt_nonce_hash,
        terminal_signal="match_end",
        server_first_seen_at=lease.server_first_seen_at,
        server_finalized_at=now,
        final_sequence=50,
        final_payload_hash="b" * 64,
        gep_match_clock_s=990,
        gep_local_team="AMBER",
        gep_winning_team="AMBER",
        integrity_status=GEP_INTEGRITY_CLIENT_ATTESTED,
    )

    normalized = normalized_gep_match_from_evidence(
        lease=lease,
        evidence=evidence,
        user=user,
    )

    # Team names remain in raw GEP evidence for diagnostics/result derivation.
    assert (
        normalized["raw_summary"]
        ["gep_settlement"]
        ["local_team"]
        == "AMBER"
    )

    # PostgreSQL column is Integer; never send "AMBER"/"SAPPHIRE" into it.
    assert normalized["participant"]["team"] is None
    assert normalized["participant"]["won"] is True



def test_reconciler_does_not_reschedule_existing_pending_audit():
    db = fresh_db()

    try:
        _, match, _ = create_gep_match(db)

        with audit_settings(
            enabled=True,
            max_attempts=3,
            retry_seconds=60,
        ):
            first = reconcile_match_audits(db)
            assert first == 1

            db.refresh(match)
            first_report = dict(match.raw_summary["audit"])

            job = db.scalar(
                select(Job).where(
                    Job.type == "audit_match",
                    Job.match_id == match.id,
                )
            )
            assert job is not None

            first_run_after = job.run_after
            first_attempts = job.attempts

            second = reconcile_match_audits(db)

        assert second == 0

        db.refresh(match)
        db.refresh(job)

        assert match.raw_summary["audit"] == first_report
        assert job.run_after == first_run_after
        assert job.attempts == first_attempts

    finally:
        db.close()
