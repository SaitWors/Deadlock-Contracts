from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base
from app.models import (
    BoardMatchCandidate,
    BoardOption,
    CompanionAttemptLease,
    CompanionDevice,
    CompanionMatchEvidence,
    ContractBoard,
    Job,
    Match,
    MatchParticipant,
    MissionDefinition,
    PublicProfile,
    User,
)
from app.services.boards import lock_board
from app.services.gep_settlement import (
    GEP_INTEGRITY_CLIENT_ATTESTED,
    GEP_SETTLEMENT_MIN_COMPANION_VERSION,
    finalize_gep_match,
    start_gep_attempt_lease,
)
from app.services.leaderboard import public_leaderboard
from app.worker import (
    dispatch_outbox,
    handle_evaluate,
    handle_promote_board_match_candidate,
    handle_settle_gep_match,
)


STEAM_ID = 76561198736917392
ACCOUNT_ID = 736917392
VERSION = GEP_SETTLEMENT_MIN_COMPANION_VERSION


@contextmanager
def rollout():
    old = {
        "gep_settlement_enabled":
            settings.gep_settlement_enabled,
        "gep_settlement_allow_all":
            settings.gep_settlement_allow_all,
        "gep_settlement_allowlist":
            settings.gep_settlement_allowlist,
        "gep_settlement_leaderboard_eligible":
            settings.gep_settlement_leaderboard_eligible,
    }

    object.__setattr__(
        settings,
        "gep_settlement_enabled",
        True,
    )
    object.__setattr__(
        settings,
        "gep_settlement_allow_all",
        True,
    )
    object.__setattr__(
        settings,
        "gep_settlement_allowlist",
        (),
    )
    object.__setattr__(
        settings,
        "gep_settlement_leaderboard_eligible",
        False,
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


def create_identity(
    db: Session,
) -> tuple[User, CompanionDevice]:
    user = User(
        steam_id64=STEAM_ID,
        account_id=ACCOUNT_ID,
        display_name="GEP Backend Test",
        status="ACTIVE",
        xp=0,
    )
    db.add(user)
    db.flush()

    device = CompanionDevice(
        user_id=user.id,
        device_id="gep-backend-test-device",
        token_hash="b" * 64,
        label="Alpha17 Test",
        version=VERSION,
        identity_ok=True,
    )

    db.add(device)
    db.commit()

    db.refresh(user)
    db.refresh(device)

    return user, device


def create_board(
    db: Session,
    user: User,
    *,
    status: str = "LOCKED",
    option_status: str = "LOCKED",
    target: float = 7,
    attempts_used: int = 0,
    max_attempts: int = 3,
) -> tuple[
    ContractBoard,
    BoardOption,
]:
    now = datetime.now(timezone.utc)

    mission = MissionDefinition(
        key=f"gep-test-{uuid4()}",
        version=2,
        title="GEP assists",
        description="Get assists",
        metric="player.assists",
        operator="gte",
        target=target,
        reward_xp=55,
        required_capabilities=[
            "summary.assists"
        ],
        game_match_mode="STANDARD",
        status="PUBLISHED",
    )

    db.add(mission)
    db.flush()

    board = ContractBoard(
        user_id=user.id,
        board_date=now.date(),
        status=status,
        game_match_mode="STANDARD",
        seed=f"gep-board-{uuid4()}",
        attempts_used=attempts_used,
        max_attempts=max_attempts,
        locked_at=(
            now - timedelta(seconds=30)
            if status != "OFFERED"
            else None
        ),
        expires_at=(
            now + timedelta(hours=24)
        ),
    )

    db.add(board)
    db.flush()

    option = BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title="GEP assists",
        rendered_description="Get assists",
        metric="player.assists",
        operator="gte",
        target=target,
        reward_xp=55,
        required_capabilities=[
            "summary.assists"
        ],
        required_game_match_mode="STANDARD",
        conditions=[
            {
                "metric": "player.assists",
                "operator": "gte",
                "target": target,
                "capabilities": [
                    "summary.assists"
                ],
            }
        ],
        selected=(
            status != "OFFERED"
        ),
        status=option_status,
        locked_at=(
            board.locked_at
            if status != "OFFERED"
            else None
        ),
    )

    db.add(option)
    db.commit()

    db.refresh(board)
    db.refresh(option)

    return board, option


def final_stats(
    assists: int = 8,
) -> dict:
    return {
        "hero_id": 10,
        "kills": 4,
        "deaths": 3,
        "assists": assists,
        "hero_damage": 13054,
        "object_damage": 5082,
        "healing": 13222,
        "souls": 34000,
    }


def start_and_finalize(
    db: Session,
    user: User,
    device: CompanionDevice,
    *,
    session_id: str,
    match_id: int,
    assists: int = 8,
):
    lease = start_gep_attempt_lease(
        db,
        device=device,
        user=user,
        session_id=session_id,
        steam_id64=STEAM_ID,
        game_match_mode="STANDARD",
        companion_version=VERSION,
    )

    assert lease["eligible"] is True
    assert lease["attempt_nonce"]

    result = finalize_gep_match(
        db,
        device=device,
        user=user,
        session_id=session_id,
        attempt_nonce=lease["attempt_nonce"],
        steam_id64=STEAM_ID,
        match_id=match_id,
        terminal_signal="match_end",
        match_clock_s=990,
        final_sequence=50,
        live_stats=final_stats(
            assists
        ),
        local_team="AMBER",
        winning_team="AMBER",
        companion_version=VERSION,
    )

    return lease, result


def test_gep_active_match_settles_contract_and_xp_without_provider():
    db = fresh_db()

    try:
        user, device = create_identity(
            db
        )

        board, option = create_board(
            db,
            user,
        )

        profile = PublicProfile(
            user_id=user.id,
            slug="gep-backend-test",
            is_public=True,
            show_stats=True,
        )
        db.add(profile)
        db.commit()

        with rollout():
            lease, final = (
                start_and_finalize(
                    db,
                    user,
                    device,
                    session_id=(
                        "gep-session-active-001"
                    ),
                    match_id=102800001,
                )
            )

            assert (
                lease["status"]
                == "ISSUED_ACTIVE"
            )
            assert (
                final["status"]
                == "CONSUMED"
            )

            evidence = db.get(
                CompanionMatchEvidence,
                final["evidence_id"],
            )

            assert evidence is not None
            assert (
                evidence.evidence_schema_version
                == 9
            )
            assert (
                evidence.integrity_status
                == GEP_INTEGRITY_CLIENT_ATTESTED
            )
            assert (
                evidence.gep_match_clock_s
                == 990
            )
            assert (
                evidence.gep_local_team
                == "AMBER"
            )
            assert (
                evidence.gep_winning_team
                == "AMBER"
            )

            settle_job = db.scalar(
                select(Job).where(
                    Job.type
                    == "settle_gep_match"
                )
            )

            assert settle_job is not None

            handle_settle_gep_match(
                db,
                settle_job,
            )

            match = db.scalar(
                select(Match).where(
                    Match.external_match_id
                    == 102800001
                )
            )

            assert match is not None
            assert (
                match.integrity_status
                == GEP_INTEGRITY_CLIENT_ATTESTED
            )
            assert (
                match.settlement_source
                == "OVERWOLF_GEP"
            )
            assert (
                match.scoring_status
                == "SCORED"
            )
            assert (
                "summary.assists"
                in match.capabilities
            )

            participant = db.scalar(
                select(
                    MatchParticipant
                ).where(
                    MatchParticipant.match_id
                    == match.id,
                    MatchParticipant.account_id
                    == ACCOUNT_ID,
                )
            )

            assert participant is not None
            assert participant.assists == 8
            assert participant.won is True

            db.refresh(board)
            db.refresh(option)

            assert board.attempts_used == 1
            assert option.status == "VERIFYING"

            evaluation_job = db.scalar(
                select(Job).where(
                    Job.type
                    == "evaluate_match",
                    Job.board_id
                    == board.id,
                    Job.match_id
                    == match.id,
                )
            )

            assert evaluation_job is not None

            handle_evaluate(
                db,
                evaluation_job,
            )

            db.refresh(board)
            db.refresh(option)

            assert option.status == "COMPLETED"
            assert board.status == "SETTLED"

            assert dispatch_outbox(db) is True

            db.refresh(user)
            assert user.xp == 55

            # Default policy: internal XP is valid but does not enter
            # the public verified leaderboard yet.
            hidden = public_leaderboard(
                db,
                "all_time",
            )
            assert hidden["rows"] == []

            object.__setattr__(
                settings,
                "gep_settlement_leaderboard_eligible",
                True,
            )

            visible = public_leaderboard(
                db,
                "all_time",
            )

            assert len(
                visible["rows"]
            ) == 1
            assert (
                visible["rows"][0]["score"]
                == 55
            )

    finally:
        db.close()


def test_finalize_is_idempotent_but_conflicting_replay_is_rejected():
    db = fresh_db()

    try:
        user, device = create_identity(
            db
        )
        create_board(
            db,
            user,
        )

        with rollout():
            lease, first = (
                start_and_finalize(
                    db,
                    user,
                    device,
                    session_id=(
                        "gep-session-replay-001"
                    ),
                    match_id=102800002,
                )
            )

            second = finalize_gep_match(
                db,
                device=device,
                user=user,
                session_id=(
                    "gep-session-replay-001"
                ),
                attempt_nonce=(
                    lease["attempt_nonce"]
                ),
                steam_id64=STEAM_ID,
                match_id=102800002,
                terminal_signal="match_end",
                match_clock_s=990,
                final_sequence=50,
                live_stats=final_stats(8),
                local_team="AMBER",
                winning_team="AMBER",
                companion_version=VERSION,
            )

            assert (
                first["evidence_id"]
                == second["evidence_id"]
            )
            assert second["idempotent"] is True

            with pytest.raises(
                HTTPException
            ) as exc:
                finalize_gep_match(
                    db,
                    device=device,
                    user=user,
                    session_id=(
                        "gep-session-replay-001"
                    ),
                    attempt_nonce=(
                        lease["attempt_nonce"]
                    ),
                    steam_id64=STEAM_ID,
                    match_id=102800002,
                    terminal_signal="match_end",
                    match_clock_s=990,
                    final_sequence=51,
                    live_stats=final_stats(9),
                    local_team="AMBER",
                    winning_team="AMBER",
                    companion_version=VERSION,
                )

            assert exc.value.status_code == 409

    finally:
        db.close()


def test_queued_match_is_captured_then_promoted_without_early_attempt_increment():
    db = fresh_db()

    try:
        user, device = create_identity(
            db
        )

        board, option = create_board(
            db,
            user,
            status="VERIFYING",
            option_status="VERIFYING",
            attempts_used=1,
            max_attempts=3,
        )

        prior = Match(
            external_match_id=102700000,
            provider="deadlock_api",
            started_at=(
                board.locked_at
                + timedelta(seconds=10)
            ),
            ended_at=(
                board.locked_at
                + timedelta(minutes=15)
            ),
            duration_s=890,
            game_match_mode="STANDARD",
            provider_mode_raw="provider",
            mode_classifier_version="provider-v1",
            mode_confidence="HIGH",
            scoring_status="SCORED",
            is_final=True,
            capabilities=[
                "summary.assists"
            ],
        )

        db.add(prior)
        db.flush()

        db.add(
            MatchParticipant(
                match_id=prior.id,
                account_id=ACCOUNT_ID,
                steam_id64=STEAM_ID,
                assists=3,
            )
        )

        option.bound_match_id = prior.id
        db.commit()

        with rollout():
            lease, final = (
                start_and_finalize(
                    db,
                    user,
                    device,
                    session_id=(
                        "gep-session-queued-001"
                    ),
                    match_id=102800003,
                )
            )

            assert (
                lease["status"]
                == "ISSUED_QUEUED"
            )
            assert (
                final["status"]
                == "CONSUMED_QUEUED"
            )

            settle_job = db.scalar(
                select(Job).where(
                    Job.type
                    == "settle_gep_match"
                )
            )

            handle_settle_gep_match(
                db,
                settle_job,
            )

            match = db.scalar(
                select(Match).where(
                    Match.external_match_id
                    == 102800003
                )
            )

            candidate = db.scalar(
                select(
                    BoardMatchCandidate
                ).where(
                    BoardMatchCandidate.board_id
                    == board.id,
                    BoardMatchCandidate.match_id
                    == match.id,
                )
            )

            assert candidate is not None
            assert candidate.status == "CAPTURED"
            assert candidate.attempt_no is None

            db.refresh(board)
            assert board.attempts_used == 1

            promotion = db.scalar(
                select(Job).where(
                    Job.type
                    == "promote_board_match_candidate",
                    Job.board_id
                    == board.id,
                )
            )

            assert promotion is not None

            # Previous attempt resolves and releases the retryable contract.
            option.status = "LOCKED"
            option.bound_match_id = None
            board.status = "LOCKED"
            db.commit()

            handle_promote_board_match_candidate(
                db,
                promotion,
            )

            db.refresh(board)
            db.refresh(option)
            db.refresh(candidate)

            assert board.attempts_used == 2
            assert candidate.status == "BOUND"
            assert candidate.attempt_no == 2
            assert option.status == "VERIFYING"
            assert option.bound_match_id == match.id

    finally:
        db.close()


def test_failed_gep_attempt_releases_contract_without_provider_discovery():
    db = fresh_db()

    try:
        user, device = create_identity(
            db
        )

        board, option = create_board(
            db,
            user,
            target=99,
        )

        with rollout():
            _, final = start_and_finalize(
                db,
                user,
                device,
                session_id=(
                    "gep-session-fail-001"
                ),
                match_id=102800004,
                assists=8,
            )

            settle_job = db.scalar(
                select(Job).where(
                    Job.type
                    == "settle_gep_match"
                )
            )

            handle_settle_gep_match(
                db,
                settle_job,
            )

            match = db.scalar(
                select(Match).where(
                    Match.external_match_id
                    == 102800004
                )
            )

            evaluation_job = db.scalar(
                select(Job).where(
                    Job.type
                    == "evaluate_match",
                    Job.board_id
                    == board.id,
                    Job.match_id
                    == match.id,
                )
            )

            handle_evaluate(
                db,
                evaluation_job,
            )

            db.refresh(board)
            db.refresh(option)

            assert option.status == "LOCKED"
            assert option.bound_match_id is None
            assert board.status == "LOCKED"
            assert board.attempts_used == 1

            discoveries = list(
                db.scalars(
                    select(Job).where(
                        Job.type
                        == "discover_match",
                        Job.board_id
                        == board.id,
                        Job.status.in_(
                            (
                                "PENDING",
                                "RUNNING",
                            )
                        ),
                    )
                ).all()
            )

            assert discoveries == []

            assert (
                final["integrity_status"]
                == GEP_INTEGRITY_CLIENT_ATTESTED
            )

    finally:
        db.close()


def test_lock_board_does_not_create_provider_discovery_for_alpha17_managed_user():
    db = fresh_db()

    try:
        user, _ = create_identity(
            db
        )

        board, option = create_board(
            db,
            user,
            status="OFFERED",
            option_status="OFFERED",
        )

        with rollout():
            locked = lock_board(
                db,
                user,
                [option.id],
                "STANDARD",
            )

            assert locked.status == "LOCKED"

            discoveries = list(
                db.scalars(
                    select(Job).where(
                        Job.type
                        == "discover_match",
                        Job.board_id
                        == board.id,
                    )
                ).all()
            )

            assert discoveries == []

    finally:
        db.close()
