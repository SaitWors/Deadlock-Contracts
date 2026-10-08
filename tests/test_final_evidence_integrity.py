from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base
from app.models import (
    BoardOption,
    CompanionAttemptLease,
    CompanionDevice,
    CompanionEvent,
    CompanionMatchEvidence,
    ContractBoard,
    Evaluation,
    Job,
    Match,
    MatchParticipant,
    MissionDefinition,
    RewardLedgerEntry,
    User,
)
from app.services.companion import record_snapshot
from app.services.gep_settlement import (
    GEP_SETTLEMENT_MIN_COMPANION_VERSION,
    finalize_gep_match,
    normalized_gep_match_from_evidence,
    start_gep_attempt_lease,
)
from app.worker import (
    dispatch_outbox,
    handle_evaluate,
    handle_settle_gep_match,
)


STEAM_ID = 76561198736917392
ACCOUNT_ID = 736917392
MATCH_ID = 103000001
SESSION_ID = "gep-integrity-session-001"
VERSION = GEP_SETTLEMENT_MIN_COMPANION_VERSION
FINAL_STATS = {
    "hero_id": 10,
    "kills": 4,
    "deaths": 3,
    "assists": 8,
    "hero_damage": 13054,
    "object_damage": 5082,
    "healing": 13222,
    "souls": 34000,
}
# SHA-256 of the hand-written v9 payload for the constants above: schema=9,
# policy=gep-settlement-v1, STANDARD, match_end, clock=990, sequence=50,
# local_team=winning_team=AMBER. This expectation does not use production code.
FINAL_HASH = "59c0127e978db9870d969be7f3c503dfdd3977f958397a11b05d143474ead4b6"


@pytest.fixture
def case():
    saved = {
        name: getattr(settings, name)
        for name in ("gep_settlement_enabled", "gep_settlement_allow_all")
    }
    for name in saved:
        object.__setattr__(settings, name, True)

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    try:
        user = User(
            steam_id64=STEAM_ID,
            account_id=ACCOUNT_ID,
            display_name="Final integrity test",
            status="ACTIVE",
            xp=0,
        )
        db.add(user)
        db.flush()
        device = CompanionDevice(
            user_id=user.id,
            device_id="integrity-device",
            token_hash="c" * 64,
            label="Final device",
            version=VERSION,
            identity_ok=True,
        )
        other_device = CompanionDevice(
            user_id=user.id,
            device_id="integrity-other-device",
            token_hash="d" * 64,
            label="Other paired device",
            version=VERSION,
            identity_ok=True,
        )
        mission = MissionDefinition(
            key="final-integrity-assists",
            version=1,
            title="Get seven assists",
            description="Get seven assists",
            metric="player.assists",
            operator="gte",
            target=7,
            reward_xp=55,
            required_capabilities=["summary.assists"],
            game_match_mode="STANDARD",
            status="PUBLISHED",
        )
        db.add_all([device, other_device, mission])
        db.flush()
        now = datetime.now(timezone.utc)
        board = ContractBoard(
            user_id=user.id,
            board_date=now.date(),
            status="LOCKED",
            game_match_mode="STANDARD",
            seed="final-integrity-board",
            attempts_used=0,
            max_attempts=3,
            locked_at=now - timedelta(seconds=30),
            expires_at=now + timedelta(hours=24),
        )
        db.add(board)
        db.flush()
        option = BoardOption(
            board_id=board.id,
            mission_definition_id=mission.id,
            rendered_title="Get seven assists",
            rendered_description="Get seven assists",
            metric="player.assists",
            operator="gte",
            target=7,
            reward_xp=55,
            required_capabilities=["summary.assists"],
            required_game_match_mode="STANDARD",
            conditions=[{
                "metric": "player.assists",
                "operator": "gte",
                "target": 7,
                "capabilities": ["summary.assists"],
            }],
            selected=True,
            status="LOCKED",
            locked_at=board.locked_at,
        )
        db.add(option)
        db.commit()
        started = start_gep_attempt_lease(
            db,
            device=device,
            user=user,
            session_id=SESSION_ID,
            steam_id64=STEAM_ID,
            game_match_mode="STANDARD",
            companion_version=VERSION,
        )
        yield SimpleNamespace(
            db=db, user=user, device=device, other_device=other_device,
            board=board, option=option, started=started,
        )
    finally:
        db.close()
        engine.dispose()
        for name, value in saved.items():
            object.__setattr__(settings, name, value)


def _finalize(case, stats=None, *, db=None):
    return finalize_gep_match(
        db or case.db,
        device=case.device,
        user=case.user,
        session_id=SESSION_ID,
        attempt_nonce=case.started["attempt_nonce"],
        steam_id64=STEAM_ID,
        match_id=MATCH_ID,
        terminal_signal="match_end",
        match_clock_s=990,
        final_sequence=50,
        live_stats=FINAL_STATS if stats is None else stats,
        local_team="AMBER",
        winning_team="AMBER",
        companion_version=VERSION,
    )


def _heartbeat(case, *, device=None, stats=None, db=None, steam_id64=STEAM_ID, mode="ranked"):
    return record_snapshot(
        db or case.db,
        device or case.device,
        case.user,
        game_running=True,
        steam_id64=steam_id64,
        phase="playing",
        game_mode_raw=mode,
        match_id=MATCH_ID,
        gep_version="test-gep",
        version=VERSION,
        live_stats={"hero_id": 2, "assists": 1, "kills": 1} if stats is None else stats,
        session_id=SESSION_ID,
        match_clock_s=60,
    )


def _evidence(case):
    return case.db.scalar(select(CompanionMatchEvidence).where(
        CompanionMatchEvidence.user_id == case.user.id,
        CompanionMatchEvidence.external_match_id == MATCH_ID,
    ))


def _snapshot(evidence):
    return {
        column.name: getattr(evidence, column.name)
        for column in CompanionMatchEvidence.__table__.columns
    }


def _normalize(case, evidence):
    return normalized_gep_match_from_evidence(
        lease=case.db.get(CompanionAttemptLease, case.started["lease_id"]),
        evidence=evidence,
        user=case.user,
    )


@pytest.mark.parametrize("other_device", [False, True], ids=["same-device", "paired-device"])
def test_late_heartbeat_preserves_final_snapshot_and_normalized_facts(case, other_device):
    _finalize(case)
    evidence = _evidence(case)
    assert evidence.final_payload_hash == FINAL_HASH
    snapshot = _snapshot(evidence)
    normalized = _normalize(case, evidence)

    _heartbeat(case, device=case.other_device if other_device else case.device)
    case.db.refresh(evidence)

    # A delayed live sample must not change identity/device, mode, hero, stats,
    # capture/finality times or the facts represented by the accepted hash.
    assert _snapshot(evidence) == snapshot
    assert _normalize(case, evidence) == normalized
    event = case.db.scalar(select(CompanionEvent).order_by(CompanionEvent.created_at.desc()))
    assert event.payload["live_stats"]["assists"] == 1
    assert event.game_match_mode == "RANKED"

def test_late_heartbeat_does_not_change_assists_contract_outcome(case):
    _finalize(case)
    _heartbeat(case, mode="standard")
    settlement = case.db.scalar(select(Job).where(Job.type == "settle_gep_match"))
    handle_settle_gep_match(case.db, settlement)
    match = case.db.scalar(select(Match).where(Match.external_match_id == MATCH_ID))
    participant = case.db.scalar(select(MatchParticipant).where(
        MatchParticipant.match_id == match.id,
        MatchParticipant.account_id == ACCOUNT_ID,
    ))
    assert match.integrity_status == "CLIENT_ATTESTED_GEP"
    assert match.raw_summary["gep_settlement"]["independent_provider"] is False
    evaluation_job = case.db.scalar(select(Job).where(
        Job.type == "evaluate_match", Job.board_id == case.board.id,
    ))
    handle_evaluate(case.db, evaluation_job)
    case.db.refresh(case.option)
    assert case.option.status == "COMPLETED"
    assert participant.assists == 8
    evaluation = case.db.scalar(select(Evaluation).where(Evaluation.assignment_id == case.option.id))
    assert evaluation.facts[0]["value"] == 8
    assert dispatch_outbox(case.db) is True
    case.db.refresh(case.user)
    assert case.user.xp == 55


def test_identity_mismatch_heartbeat_preserves_final_identity_and_raw_facts(case):
    _finalize(case)
    evidence = _evidence(case)
    snapshot = _snapshot(evidence)
    normalized = _normalize(case, evidence)

    _heartbeat(case, steam_id64=76561198000000000)
    case.db.refresh(evidence)

    assert _snapshot(evidence) == snapshot
    assert _normalize(case, evidence) == normalized
    event = case.db.scalar(select(CompanionEvent))
    assert event.payload["identity_ok"] is False


def test_final_missing_metrics_do_not_inherit_live_stats_or_capabilities(case):
    _heartbeat(case, stats={**FINAL_STATS, "assists": 42})
    assert _evidence(case).assists == 42

    _finalize(case, {"kills": 4})
    evidence = _evidence(case)
    normalized = _normalize(case, evidence)

    assert evidence.assists is None
    assert evidence.hero_id is None
    assert evidence.healing is None
    assert normalized["participant"] == {
        "account_id": ACCOUNT_ID,
        "steam_id64": STEAM_ID,
        "hero_id": None,
        "team": None,
        "won": True,
        "kills": 4,
        "deaths": None,
        "assists": None,
        "net_worth": None,
        "hero_damage": None,
        "object_damage": None,
        "healing": None,
    }
    assert normalized["capabilities"] == ["summary.duration", "summary.kills", "summary.result"]


@pytest.mark.parametrize(("field", "value"), [
    ("hero_id", 2), ("kills", 1), ("deaths", 1), ("assists", 1),
    ("hero_damage", 1), ("object_damage", 1), ("healing", 1), ("souls", 1),
    ("steam_id64", 76561198000000000), ("game_match_mode", "RANKED"),
    ("gep_session_id", "different-session-001"), ("external_match_id", MATCH_ID + 1),
    ("terminal_signal", "phase_postgame"), ("gep_match_clock_s", 60),
    ("final_sequence", 49), ("gep_local_team", "SAPPHIRE"),
    ("gep_winning_team", "SAPPHIRE"),
    ("final_payload_hash", "0" * 64), ("final_payload_hash", None),
    pytest.param("final_payload_hash", "é" * 64, id="non-ascii-hash"),
    ("server_finalized_at", None), ("attempt_nonce_hash", "0" * 64),
    ("device_id", "different-device"),
])
def test_normalization_rejects_tampered_final_evidence(case, field, value):
    _finalize(case)
    evidence = _evidence(case)
    setattr(evidence, field, value)
    case.db.commit()
    case.db.refresh(evidence)

    with pytest.raises(ValueError):
        _normalize(case, evidence)


@pytest.mark.parametrize(("field", "value"), [("assists", 1), ("final_payload_hash", "0" * 64)])
def test_settlement_rejects_hash_drift_without_match_or_reward(case, field, value):
    _finalize(case)
    evidence = _evidence(case)
    setattr(evidence, field, value)
    case.db.commit()
    settlement = case.db.scalar(select(Job).where(Job.type == "settle_gep_match"))

    with pytest.raises(ValueError):
        handle_settle_gep_match(case.db, settlement)

    assert case.db.scalar(select(Match)) is None
    assert case.db.scalar(select(Evaluation)) is None
    assert case.db.scalar(select(RewardLedgerEntry)) is None
    case.db.refresh(case.board)
    assert case.board.status == "LOCKED"
    assert case.board.attempts_used == 0


def test_repeated_finalization_after_late_heartbeat_is_valid_and_unchanged(case):
    first = _finalize(case)
    evidence = _evidence(case)
    snapshot = _snapshot(evidence)
    _heartbeat(case, device=case.other_device)

    repeated = _finalize(case)
    case.db.refresh(evidence)

    assert repeated["accepted"] is True
    assert repeated["idempotent"] is True
    assert repeated["evidence_id"] == first["evidence_id"]
    assert _snapshot(evidence) == snapshot
    assert _normalize(case, evidence)["participant"]["assists"] == 8
    assert case.db.scalar(select(func.count()).select_from(Job).where(Job.type == "settle_gep_match")) == 1


def test_repeated_finalization_rejects_corrupted_persisted_final(case):
    _finalize(case)
    evidence = _evidence(case)
    evidence.assists = 1
    case.db.commit()

    with pytest.raises(HTTPException) as exc:
        _finalize(case)
    assert exc.value.status_code == 409


def test_cached_live_evidence_is_refreshed_before_late_heartbeat_write(case):
    _heartbeat(case)
    evidence = _evidence(case)
    with Session(case.db.get_bind(), expire_on_commit=False) as stale_db:
        stale = stale_db.get(CompanionMatchEvidence, evidence.id)
        assert stale.evidence_schema_version == 8
        stale_db.commit()

        _finalize(case)
        case.db.refresh(evidence)
        snapshot = _snapshot(evidence)
        assert stale.evidence_schema_version == 8

        _heartbeat(case, db=stale_db, stats={"assists": 2})
        case.db.refresh(evidence)

    assert _snapshot(evidence) == snapshot
    assert _normalize(case, evidence)["participant"]["assists"] == 8


def test_cached_live_evidence_is_refreshed_before_repeated_finalization(case):
    _heartbeat(case)
    evidence = _evidence(case)
    with Session(case.db.get_bind(), expire_on_commit=False) as stale_db:
        stale = stale_db.get(CompanionMatchEvidence, evidence.id)
        stale_lease = stale_db.get(CompanionAttemptLease, case.started["lease_id"])
        assert stale.evidence_schema_version == 8
        assert stale_lease.status == "ISSUED_ACTIVE"
        stale_db.commit()

        first = _finalize(case)
        case.db.refresh(evidence)
        snapshot = _snapshot(evidence)
        repeated = _finalize(case, db=stale_db)
        case.db.refresh(evidence)

    assert repeated["idempotent"] is True
    assert repeated["evidence_id"] == first["evidence_id"]
    assert _snapshot(evidence) == snapshot


def test_settlement_refreshes_cached_live_lease_and_evidence(case):
    _heartbeat(case, mode="standard")
    evidence = _evidence(case)
    with Session(case.db.get_bind(), expire_on_commit=False) as stale_db:
        stale = stale_db.get(CompanionMatchEvidence, evidence.id)
        stale_lease = stale_db.get(CompanionAttemptLease, case.started["lease_id"])
        assert stale.assists == 1
        assert stale.evidence_schema_version == 8
        assert stale_lease.status == "ISSUED_ACTIVE"
        stale_db.commit()

        _finalize(case)
        settlement = stale_db.scalar(select(Job).where(Job.type == "settle_gep_match"))
        handle_settle_gep_match(stale_db, settlement)

    match = case.db.scalar(select(Match).where(Match.external_match_id == MATCH_ID))
    participant = case.db.scalar(select(MatchParticipant).where(
        MatchParticipant.match_id == match.id,
        MatchParticipant.account_id == ACCOUNT_ID,
    ))
    assert match.provider_payload_hash == FINAL_HASH
    assert participant.assists == 8
    assert match.integrity_status == "CLIENT_ATTESTED_GEP"
    case.db.refresh(case.board)
    case.db.refresh(case.option)
    assert case.board.attempts_used == 1
    assert case.option.status == "VERIFYING"
