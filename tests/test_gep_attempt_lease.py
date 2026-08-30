from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base
from app.main import app
from app.models import (
    CompanionAttemptLease,
    CompanionDevice,
    ContractBoard,
    User,
)
from app.services.gep_settlement import (
    GEP_SETTLEMENT_MIN_COMPANION_VERSION,
    start_gep_attempt_lease,
)


STEAM_ID = 76561198736917392
COMPANION_VERSION = GEP_SETTLEMENT_MIN_COMPANION_VERSION


@contextmanager
def rollout(
    *,
    enabled: bool = True,
    allow_all: bool = True,
    allowlist: tuple[str, ...] = (),
):
    old = {
        "gep_settlement_enabled": settings.gep_settlement_enabled,
        "gep_settlement_allow_all": settings.gep_settlement_allow_all,
        "gep_settlement_allowlist": settings.gep_settlement_allowlist,
    }

    object.__setattr__(
        settings,
        "gep_settlement_enabled",
        enabled,
    )
    object.__setattr__(
        settings,
        "gep_settlement_allow_all",
        allow_all,
    )
    object.__setattr__(
        settings,
        "gep_settlement_allowlist",
        allowlist,
    )

    try:
        yield
    finally:
        for name, value in old.items():
            object.__setattr__(
                settings,
                name,
                value,
            )


def fresh_db() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def create_identity(db: Session):
    user = User(
        steam_id64=STEAM_ID,
        account_id=736917392,
        display_name="Lease Test",
        status="ACTIVE",
    )
    db.add(user)
    db.flush()

    device = CompanionDevice(
        user_id=user.id,
        device_id="lease-test-device",
        token_hash="a" * 64,
        label="Lease Test Companion",
        version=COMPANION_VERSION,
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
    status: str,
    mode: str = "STANDARD",
    attempts_used: int = 0,
    max_attempts: int = 3,
) -> ContractBoard:
    now = datetime.now(timezone.utc)

    board = ContractBoard(
        user_id=user.id,
        board_date=now.date(),
        status=status,
        game_match_mode=mode,
        seed=f"lease-{status}-{attempts_used}",
        attempts_used=attempts_used,
        max_attempts=max_attempts,
        locked_at=now,
        expires_at=now + timedelta(hours=24),
    )

    db.add(board)
    db.commit()
    db.refresh(board)

    return board


def lease_count(db: Session) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(CompanionAttemptLease)
        )
        or 0
    )


def test_attempt_start_route_is_registered():
    routes = {
        (
            route.path,
            tuple(
                sorted(
                    getattr(route, "methods", None)
                    or ()
                )
            ),
        )
        for route in app.routes
        if getattr(route, "path", None)
    }

    assert any(
        path == "/api/companion/attempts/start"
        and "POST" in methods
        for path, methods in routes
    )


def test_rollout_disabled_creates_no_lease():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        with rollout(
            enabled=False,
            allow_all=False,
        ):
            result = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-disabled-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
            )

        assert result["enabled"] is False
        assert result["status"] == "DISABLED"
        assert result["reason"] == "FEATURE_DISABLED"
        assert result["attempt_nonce"] is None
        assert lease_count(db) == 0

    finally:
        db.close()


def test_alpha16_cannot_enter_gep_settlement():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        with rollout():
            result = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-alpha16-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version="0.5.2-alpha.16",
            )

        assert result["enabled"] is False
        assert result["status"] == "DISABLED"
        assert (
            result["reason"]
            == "COMPANION_VERSION_UNSUPPORTED"
        )
        assert lease_count(db) == 0

    finally:
        db.close()


def test_locked_board_issues_active_idempotent_nonce():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        board = create_board(
            db,
            user,
            status="LOCKED",
        )

        with rollout():
            first = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-active-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
                match_id=None,
            )

            second = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-active-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
                match_id=102700001,
            )

        db.refresh(board)

        assert first["status"] == "ISSUED_ACTIVE"
        assert first["eligible"] is True
        assert first["queued"] is False
        assert first["attempt_nonce"]
        assert second["attempt_nonce"] == first["attempt_nonce"]
        assert second["lease_id"] == first["lease_id"]
        assert second["match_id"] == "102700001"

        # Lease issuance itself NEVER consumes a contract attempt.
        assert board.attempts_used == 0
        assert lease_count(db) == 1

        lease = db.scalar(
            select(CompanionAttemptLease)
            .where(
                CompanionAttemptLease.id
                == first["lease_id"]
            )
        )

        assert lease is not None
        assert lease.attempt_nonce_hash
        assert (
            lease.attempt_nonce_hash
            != first["attempt_nonce"]
        )

    finally:
        db.close()


def test_verifying_board_issues_queued_without_attempt_increment():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        board = create_board(
            db,
            user,
            status="VERIFYING",
            attempts_used=1,
            max_attempts=3,
        )

        with rollout():
            result = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-queued-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
                match_id=102700002,
            )

        db.refresh(board)

        assert result["status"] == "ISSUED_QUEUED"
        assert result["eligible"] is True
        assert result["queued"] is True
        assert result["attempt_nonce"]
        assert result["board_id"] == board.id

        # This is the A -> B durable queue invariant.
        assert board.attempts_used == 1

    finally:
        db.close()


def test_ineligible_session_cannot_become_retroactively_eligible():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        with rollout():
            before_lock = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-before-lock-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
                match_id=102700003,
            )

            board = create_board(
                db,
                user,
                status="LOCKED",
            )

            after_lock = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-before-lock-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
                match_id=102700003,
            )

        assert before_lock["status"] == "INELIGIBLE"
        assert (
            before_lock["reason"]
            == "NO_ELIGIBLE_BOARD"
        )
        assert before_lock["attempt_nonce"] is None

        # Locking a board after match start must not rewrite history.
        assert after_lock["lease_id"] == before_lock["lease_id"]
        assert after_lock["status"] == "INELIGIBLE"
        assert (
            after_lock["reason"]
            == "NO_ELIGIBLE_BOARD"
        )
        assert after_lock["attempt_nonce"] is None

        db.refresh(board)
        assert board.attempts_used == 0
        assert lease_count(db) == 1

    finally:
        db.close()


def test_identity_mismatch_is_persisted_as_ineligible():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        create_board(
            db,
            user,
            status="LOCKED",
        )

        with rollout():
            result = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-wrong-steam-001",
                steam_id64=76561198000000000,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
            )

        assert result["status"] == "INELIGIBLE"
        assert (
            result["reason"]
            == "STEAM_IDENTITY_MISMATCH"
        )
        assert result["attempt_nonce"] is None
        assert lease_count(db) == 1

    finally:
        db.close()


def test_queued_reservations_cannot_exceed_remaining_attempts():
    db = fresh_db()

    try:
        user, device = create_identity(db)

        board = create_board(
            db,
            user,
            status="VERIFYING",
            attempts_used=2,
            max_attempts=3,
        )

        with rollout():
            first = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-last-queue-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
            )

            second = start_gep_attempt_lease(
                db,
                device=device,
                user=user,
                session_id="session-over-capacity-001",
                steam_id64=STEAM_ID,
                game_match_mode="STANDARD",
                companion_version=COMPANION_VERSION,
            )

        assert first["status"] == "ISSUED_QUEUED"

        assert second["status"] == "INELIGIBLE"
        assert (
            second["reason"]
            == "QUEUE_CAPACITY_EXHAUSTED"
        )
        assert second["attempt_nonce"] is None

        db.refresh(board)
        assert board.attempts_used == 2

    finally:
        db.close()
