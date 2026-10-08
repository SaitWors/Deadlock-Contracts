from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    CompanionAttemptLease,
    CompanionDevice,
    CompanionMatchEvidence,
    ContractBoard,
    Job,
    User,
)
from .companion import (
    LIVE_STAT_LIMITS,
    companion_version_supported,
    hash_secret,
    sanitize_live_stats,
)
from .jobs import enqueue_job


GEP_SETTLEMENT_POLICY_VERSION = "gep-settlement-v1"
GEP_SETTLEMENT_MIN_COMPANION_VERSION = "0.5.2-alpha.17"

GEP_SETTLEMENT_SOURCE = "OVERWOLF_GEP"
GEP_INTEGRITY_CLIENT_ATTESTED = "CLIENT_ATTESTED_GEP"

GEP_ATTEMPT_LEASE_TTL = timedelta(hours=8)

VALID_GEP_MODES = {
    "STANDARD",
    "RANKED",
    "STREET_BRAWL",
}

VALID_TEAMS = {
    "AMBER",
    "SAPPHIRE",
}

ELIGIBLE_LEASE_STATES = {
    "ISSUED_ACTIVE",
    "ISSUED_QUEUED",
}

FINALIZED_LEASE_STATES = {
    "CONSUMED",
    "CONSUMED_QUEUED",
}

QUEUED_RESERVATION_STATES = {
    "ISSUED_QUEUED",
    "CONSUMED_QUEUED",
}

SESSION_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9._:-]{8,80}$"
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(
    value: datetime | None,
) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def _account_rollout_allowed(
    user: User,
) -> bool:
    if not settings.gep_settlement_enabled:
        return False

    if settings.gep_settlement_allow_all:
        return True

    steam_id = str(user.steam_id64 or "")

    return bool(
        steam_id
        and steam_id
        in settings.gep_settlement_allowlist
    )


def _rollout_allowed(
    user: User,
    companion_version: str | None,
) -> tuple[bool, str | None]:
    if not settings.gep_settlement_enabled:
        return False, "FEATURE_DISABLED"

    if not companion_version_supported(
        companion_version,
        GEP_SETTLEMENT_MIN_COMPANION_VERSION,
    ):
        return (
            False,
            "COMPANION_VERSION_UNSUPPORTED",
        )

    if not _account_rollout_allowed(user):
        return False, "ROLLOUT_NOT_ALLOWED"

    return True, None


def gep_settlement_managed_user(
    db: Session,
    user: User,
) -> bool:
    """Whether new attempts for this account belong to the GEP pipeline."""

    if not _account_rollout_allowed(user):
        return False

    devices = list(
        db.scalars(
            select(CompanionDevice).where(
                CompanionDevice.user_id == user.id,
                CompanionDevice.revoked_at.is_(None),
            )
        ).all()
    )

    return any(
        companion_version_supported(
            device.version,
            GEP_SETTLEMENT_MIN_COMPANION_VERSION,
        )
        for device in devices
    )


def _derive_attempt_nonce(
    *,
    user_id: str,
    device_id: str,
    session_id: str,
) -> str:
    message = (
        "gep-attempt-lease-v1:"
        f"{user_id}:"
        f"{device_id}:"
        f"{session_id}"
    ).encode("utf-8")

    digest = hmac.new(
        settings.session_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).digest()

    return (
        base64.urlsafe_b64encode(digest)
        .decode("ascii")
        .rstrip("=")
    )


def _disabled_payload(
    reason: str,
) -> dict[str, Any]:
    return {
        "enabled": False,
        "policy_version":
            GEP_SETTLEMENT_POLICY_VERSION,
        "minimum_companion_version":
            GEP_SETTLEMENT_MIN_COMPANION_VERSION,
        "status": "DISABLED",
        "reason": reason,
        "eligible": False,
        "queued": False,
        "lease_id": None,
        "board_id": None,
        "attempt_nonce": None,
        "expires_at": None,
        "server_time": utcnow().isoformat(),
    }


def _lease_payload(
    lease: CompanionAttemptLease,
    *,
    nonce: str | None,
) -> dict[str, Any]:
    status = str(
        lease.status or ""
    ).upper()

    eligible = (
        status in ELIGIBLE_LEASE_STATES
    )

    return {
        "enabled": True,
        "policy_version":
            GEP_SETTLEMENT_POLICY_VERSION,
        "minimum_companion_version":
            GEP_SETTLEMENT_MIN_COMPANION_VERSION,
        "status": status,
        "reason": lease.ineligible_reason,
        "eligible": eligible,
        "queued":
            status == "ISSUED_QUEUED",
        "lease_id": lease.id,
        "board_id": lease.board_id,
        "session_id": lease.session_id,
        "game_match_mode":
            lease.game_match_mode,
        "match_id": (
            str(lease.external_match_id)
            if lease.external_match_id
            is not None
            else None
        ),
        "attempt_nonce": (
            nonce if eligible else None
        ),
        "server_first_seen_at": (
            aware(
                lease.server_first_seen_at
            ).isoformat()
            if lease.server_first_seen_at
            else None
        ),
        "issued_at": (
            aware(
                lease.issued_at
            ).isoformat()
            if lease.issued_at
            else None
        ),
        "expires_at": (
            aware(
                lease.expires_at
            ).isoformat()
            if lease.expires_at
            else None
        ),
        "server_time":
            utcnow().isoformat(),
    }


def _suppress_discovery_jobs(
    db: Session,
    board_id: str,
) -> None:
    """Stop provider polling once an Alpha.17 GEP lease owns the attempt."""

    jobs = list(
        db.scalars(
            select(Job).where(
                Job.type == "discover_match",
                Job.board_id == board_id,
                Job.status.in_(
                    ("PENDING", "FAILED")
                ),
            )
        ).all()
    )

    for job in jobs:
        job.status = "DONE"
        job.locked_at = None
        job.locked_by = None
        job.last_error = (
            "Suppressed by "
            "Companion-first GEP settlement"
        )


def _existing_lease_response(
    db: Session,
    lease: CompanionAttemptLease,
    *,
    device: CompanionDevice,
    user: User,
    session_id: str,
    mode: str,
    match_id: int | None,
    identity_ok: bool,
) -> dict[str, Any]:
    if lease.device_id != device.id:
        raise HTTPException(
            409,
            "GEP session уже принадлежит "
            "другому Companion устройству",
        )

    if str(
        lease.game_match_mode or ""
    ) != mode:
        raise HTTPException(
            409,
            "GEP session уже зарегистрирована "
            "для другого режима",
        )

    if (
        lease.external_match_id is not None
        and match_id is not None
        and int(lease.external_match_id)
        != int(match_id)
    ):
        raise HTTPException(
            409,
            "GEP session уже связана "
            "с другим Match ID",
        )

    if (
        str(
            lease.status or ""
        ).upper()
        in ELIGIBLE_LEASE_STATES
        and not identity_ok
    ):
        raise HTTPException(
            409,
            "Steam identity GEP session "
            "не совпадает с аккаунтом",
        )

    if (
        lease.external_match_id is None
        and match_id is not None
    ):
        lease.external_match_id = int(
            match_id
        )

    now = utcnow()

    if (
        str(
            lease.status or ""
        ).upper()
        in ELIGIBLE_LEASE_STATES
        and aware(
            lease.expires_at
        ) is not None
        and aware(
            lease.expires_at
        ) <= now
    ):
        lease.status = "VOID"
        lease.ineligible_reason = (
            "LEASE_EXPIRED"
        )
        lease.voided_at = now

        db.commit()
        db.refresh(lease)

        return _lease_payload(
            lease,
            nonce=None,
        )

    nonce = None

    if (
        str(
            lease.status or ""
        ).upper()
        in ELIGIBLE_LEASE_STATES
    ):
        nonce = _derive_attempt_nonce(
            user_id=user.id,
            device_id=device.id,
            session_id=session_id,
        )

        expected_hash = hash_secret(
            nonce
        )

        if (
            lease.attempt_nonce_hash
            and not hmac.compare_digest(
                lease.attempt_nonce_hash,
                expected_hash,
            )
        ):
            raise HTTPException(
                409,
                "GEP lease nonce "
                "integrity mismatch",
            )

        if not lease.attempt_nonce_hash:
            lease.attempt_nonce_hash = (
                expected_hash
            )

    db.commit()
    db.refresh(lease)

    return _lease_payload(
        lease,
        nonce=nonce,
    )


def start_gep_attempt_lease(
    db: Session,
    *,
    device: CompanionDevice,
    user: User,
    session_id: str,
    steam_id64: int,
    game_match_mode: str,
    companion_version: str | None,
    match_id: int | None = None,
) -> dict[str, Any]:
    """Register match-start eligibility before result/stat facts exist."""

    session_id = str(
        session_id or ""
    ).strip()

    if not SESSION_ID_PATTERN.fullmatch(
        session_id
    ):
        raise HTTPException(
            422,
            "Некорректный GEP session_id",
        )

    mode = str(
        game_match_mode or ""
    ).strip().upper()

    if mode not in VALID_GEP_MODES:
        raise HTTPException(
            422,
            "Некорректный режим GEP session",
        )

    if (
        match_id is not None
        and int(match_id) <= 0
    ):
        raise HTTPException(
            422,
            "Некорректный Match ID",
        )

    allowed, rollout_reason = (
        _rollout_allowed(
            user,
            companion_version,
        )
    )

    if not allowed:
        return _disabled_payload(
            rollout_reason
            or "ROLLOUT_NOT_ALLOWED"
        )

    now = utcnow()

    db_user = db.scalar(
        select(User)
        .where(
            User.id == user.id
        )
        .with_for_update()
    )

    if not db_user:
        raise HTTPException(
            401,
            "Пользователь Companion "
            "не найден",
        )

    if str(
        db_user.status or ""
    ).upper() != "ACTIVE":
        raise HTTPException(
            403,
            "Аккаунт недоступен",
        )

    db_device = db.scalar(
        select(CompanionDevice)
        .where(
            CompanionDevice.id
            == device.id,
            CompanionDevice.user_id
            == db_user.id,
        )
        .with_for_update()
    )

    if (
        not db_device
        or db_device.revoked_at
        is not None
    ):
        raise HTTPException(
            401,
            "Companion отключён",
        )

    identity_ok = bool(
        db_user.steam_id64 is not None
        and int(steam_id64)
        == int(db_user.steam_id64)
    )

    db_device.identity_ok = (
        identity_ok
    )
    db_device.last_seen_at = now

    if companion_version:
        db_device.version = (
            companion_version[:32]
        )

    existing = db.scalar(
        select(
            CompanionAttemptLease
        )
        .where(
            CompanionAttemptLease.user_id
            == db_user.id,
            CompanionAttemptLease.session_id
            == session_id,
        )
        .with_for_update()
    )

    if existing:
        return _existing_lease_response(
            db,
            existing,
            device=db_device,
            user=db_user,
            session_id=session_id,
            mode=mode,
            match_id=match_id,
            identity_ok=identity_ok,
        )

    lease_status = "INELIGIBLE"
    reason: str | None = None
    board: ContractBoard | None = None

    if db_user.steam_id64 is None:
        reason = (
            "ACCOUNT_STEAM_ID_UNAVAILABLE"
        )

    elif not identity_ok:
        reason = (
            "STEAM_IDENTITY_MISMATCH"
        )

    else:
        board = db.scalar(
            select(ContractBoard)
            .where(
                ContractBoard.user_id
                == db_user.id,
                ContractBoard.game_match_mode
                == mode,
                ContractBoard.status.in_(
                    ("LOCKED", "VERIFYING")
                ),
                ContractBoard.expires_at
                > now,
            )
            .order_by(
                ContractBoard.locked_at
                .desc(),
                ContractBoard.created_at
                .desc(),
            )
            .limit(1)
            .with_for_update()
        )

        if board is None:
            reason = (
                "NO_ELIGIBLE_BOARD"
            )

        elif (
            int(board.attempts_used)
            >= int(board.max_attempts)
        ):
            reason = (
                "ATTEMPTS_EXHAUSTED"
            )

        elif (
            str(
                board.status
            ).upper()
            == "LOCKED"
        ):
            lease_status = (
                "ISSUED_ACTIVE"
            )

        elif (
            str(
                board.status
            ).upper()
            == "VERIFYING"
        ):
            remaining_attempts = max(
                0,
                int(board.max_attempts)
                - int(
                    board.attempts_used
                ),
            )

            queued_reservations = int(
                db.scalar(
                    select(func.count())
                    .select_from(
                        CompanionAttemptLease
                    )
                    .where(
                        CompanionAttemptLease
                        .board_id
                        == board.id,
                        CompanionAttemptLease
                        .status.in_(
                            tuple(
                                QUEUED_RESERVATION_STATES
                            )
                        ),
                    )
                )
                or 0
            )

            if (
                queued_reservations
                >= remaining_attempts
            ):
                reason = (
                    "QUEUE_CAPACITY_EXHAUSTED"
                )
            else:
                lease_status = (
                    "ISSUED_QUEUED"
                )

        else:
            reason = (
                "BOARD_NOT_ELIGIBLE"
            )

    eligible = (
        lease_status
        in ELIGIBLE_LEASE_STATES
    )

    nonce = None
    nonce_hash = None
    issued_at = None
    expires_at = None

    if eligible:
        nonce = _derive_attempt_nonce(
            user_id=db_user.id,
            device_id=db_device.id,
            session_id=session_id,
        )

        nonce_hash = hash_secret(
            nonce
        )

        issued_at = now
        expires_at = (
            now
            + GEP_ATTEMPT_LEASE_TTL
        )

        if board is not None:
            board_expiry = aware(
                board.expires_at
            )

            if (
                board_expiry
                is not None
                and board_expiry
                < expires_at
            ):
                expires_at = (
                    board_expiry
                )

            _suppress_discovery_jobs(
                db,
                board.id,
            )

    lease = CompanionAttemptLease(
        user_id=db_user.id,
        device_id=db_device.id,
        board_id=(
            board.id
            if board
            else None
        ),
        session_id=session_id,
        attempt_nonce_hash=nonce_hash,
        game_match_mode=mode,
        external_match_id=(
            int(match_id)
            if match_id is not None
            else None
        ),
        status=lease_status,
        ineligible_reason=reason,
        server_first_seen_at=now,
        issued_at=issued_at,
        expires_at=expires_at,
    )

    db.add(lease)

    try:
        db.commit()
        db.refresh(lease)

    except IntegrityError:
        db.rollback()

        race = db.scalar(
            select(
                CompanionAttemptLease
            )
            .where(
                CompanionAttemptLease
                .user_id
                == db_user.id,
                CompanionAttemptLease
                .session_id
                == session_id,
            )
        )

        if race is None:
            raise

        return (
            _existing_lease_response(
                db,
                race,
                device=db_device,
                user=db_user,
                session_id=session_id,
                mode=mode,
                match_id=match_id,
                identity_ok=identity_ok,
            )
        )

    return _lease_payload(
        lease,
        nonce=nonce,
    )


def _canonical_final_payload(
    *,
    session_id: str,
    match_id: int,
    steam_id64: int,
    mode: str,
    terminal_signal: str,
    match_clock_s: int,
    final_sequence: int,
    live_stats: dict[str, int | None],
    local_team: str | None,
    winning_team: str | None,
) -> dict[str, Any]:
    return {
        "schema": 9,
        "policy":
            GEP_SETTLEMENT_POLICY_VERSION,
        "session_id": session_id,
        "match_id": int(match_id),
        "steam_id64":
            int(steam_id64),
        "game_match_mode": mode,
        "terminal_signal":
            terminal_signal,
        "match_clock_s":
            int(match_clock_s),
        "final_sequence":
            int(final_sequence),
        "live_stats": {
            key: live_stats.get(key)
            for key in sorted(
                live_stats
            )
        },
        "local_team": local_team,
        "winning_team":
            winning_team,
    }


def _payload_hash(
    payload: dict[str, Any],
) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return hashlib.sha256(
        encoded
    ).hexdigest()


def _validated_final_payload(
    *,
    lease: CompanionAttemptLease,
    evidence: CompanionMatchEvidence,
    user: User,
) -> dict[str, Any]:
    """Verify persisted final facts without changing client-attested trust."""
    if (
        int(evidence.evidence_schema_version or 0) != 9
        or evidence.integrity_status != GEP_INTEGRITY_CLIENT_ATTESTED
        or evidence.server_finalized_at is None
    ):
        raise ValueError("Evidence не прошёл CLIENT_ATTESTED_GEP final validation")

    if (
        lease.user_id != user.id
        or evidence.user_id != user.id
        or evidence.device_id != lease.device_id
        or evidence.gep_session_id != lease.session_id
        or not lease.attempt_nonce_hash
        or evidence.attempt_nonce_hash != lease.attempt_nonce_hash
        or evidence.external_match_id != lease.external_match_id
        or evidence.game_match_mode != lease.game_match_mode
    ):
        raise ValueError("Lease/Evidence integrity mismatch")

    if (
        evidence.steam_id64 is None
        or user.steam_id64 is None
        or evidence.steam_id64 != user.steam_id64
    ):
        raise ValueError("Evidence v9 Steam identity integrity mismatch")

    try:
        canonical = _canonical_final_payload(
            session_id=evidence.gep_session_id,
            match_id=evidence.external_match_id,
            steam_id64=evidence.steam_id64,
            mode=evidence.game_match_mode,
            terminal_signal=evidence.terminal_signal,
            match_clock_s=evidence.gep_match_clock_s,
            final_sequence=evidence.final_sequence,
            live_stats={
                field: getattr(evidence, field)
                for field in LIVE_STAT_LIMITS
            },
            local_team=evidence.gep_local_team,
            winning_team=evidence.gep_winning_team,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Evidence v9 final payload integrity mismatch") from exc

    if (
        not re.fullmatch(r"[0-9a-f]{64}", evidence.final_payload_hash or "")
        or not hmac.compare_digest(evidence.final_payload_hash, _payload_hash(canonical))
    ):
        raise ValueError("Evidence v9 final payload hash integrity mismatch")

    return canonical


def _finalize_response(
    lease: CompanionAttemptLease,
    evidence: CompanionMatchEvidence,
    *,
    idempotent: bool,
) -> dict[str, Any]:
    return {
        "ok": True,
        "accepted": True,
        "idempotent": idempotent,
        "policy_version":
            GEP_SETTLEMENT_POLICY_VERSION,
        "integrity_status":
            evidence.integrity_status,
        "settlement_source":
            GEP_SETTLEMENT_SOURCE,
        "lease_id": lease.id,
        "board_id": lease.board_id,
        "evidence_id": evidence.id,
        "session_id":
            evidence.gep_session_id,
        "match_id":
            str(
                evidence.external_match_id
            ),
        "status":
            lease.status,
        "queued": (
            lease.status
            == "CONSUMED_QUEUED"
        ),
        "server_finalized_at": (
            aware(
                evidence.server_finalized_at
            ).isoformat()
            if evidence.server_finalized_at
            else None
        ),
        "server_time":
            utcnow().isoformat(),
    }


def finalize_gep_match(
    db: Session,
    *,
    device: CompanionDevice,
    user: User,
    session_id: str,
    attempt_nonce: str,
    steam_id64: int,
    match_id: int,
    terminal_signal: str,
    match_clock_s: int,
    final_sequence: int,
    live_stats: dict[str, Any],
    local_team: str | None,
    winning_team: str | None,
    companion_version: str | None,
) -> dict[str, Any]:
    """Persist immutable Evidence v9 and queue server settlement."""

    allowed, reason = (
        _rollout_allowed(
            user,
            companion_version,
        )
    )

    if not allowed:
        raise HTTPException(
            409,
            "GEP settlement недоступен: "
            f"{reason}",
        )

    session_id = str(
        session_id or ""
    ).strip()

    if not SESSION_ID_PATTERN.fullmatch(
        session_id
    ):
        raise HTTPException(
            422,
            "Некорректный GEP session_id",
        )

    if (
        int(match_id) <= 0
        or int(match_clock_s) <= 0
        or int(match_clock_s)
        > 6 * 60 * 60
        or int(final_sequence) <= 0
    ):
        raise HTTPException(
            422,
            "Некорректные terminal "
            "параметры GEP",
        )

    signal = str(
        terminal_signal or ""
    ).strip().lower()

    # Evidence v9 settlement accepts only the documented explicit
    # Overwolf match_end event as terminal authority.
    if signal != "match_end":
        raise HTTPException(
            422,
            "Для GEP settlement требуется "
            "явный match_end",
        )

    clean_stats = sanitize_live_stats(
        live_stats
    )

    if not clean_stats:
        raise HTTPException(
            422,
            "Финальная GEP статистика "
            "отсутствует",
        )

    normalized_local = str(
        local_team or ""
    ).strip().upper() or None

    normalized_winner = str(
        winning_team or ""
    ).strip().upper() or None

    if normalized_local is not None:
        if normalized_local not in VALID_TEAMS:
            raise HTTPException(
                422,
                "Некорректная локальная команда",
            )

    if normalized_winner is not None:
        if normalized_winner not in VALID_TEAMS:
            raise HTTPException(
                422,
                "Некорректная winning team",
            )

    if (
        normalized_local is None
    ) != (
        normalized_winner is None
    ):
        raise HTTPException(
            422,
            "local_team и winning_team "
            "должны передаваться вместе",
        )

    now = utcnow()

    db_user = db.scalar(
        select(User)
        .where(
            User.id == user.id
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if not db_user:
        raise HTTPException(
            401,
            "Пользователь Companion "
            "не найден",
        )

    if (
        db_user.steam_id64 is None
        or int(steam_id64)
        != int(db_user.steam_id64)
    ):
        raise HTTPException(
            409,
            "Steam identity финального "
            "GEP payload не совпадает",
        )

    db_device = db.scalar(
        select(CompanionDevice)
        .where(
            CompanionDevice.id
            == device.id,
            CompanionDevice.user_id
            == db_user.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if (
        not db_device
        or db_device.revoked_at
        is not None
    ):
        raise HTTPException(
            401,
            "Companion отключён",
        )

    lease = db.scalar(
        select(
            CompanionAttemptLease
        )
        .where(
            CompanionAttemptLease
            .user_id
            == db_user.id,
            CompanionAttemptLease
            .session_id
            == session_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if not lease:
        raise HTTPException(
            409,
            "GEP attempt lease не найден",
        )

    if lease.device_id != db_device.id:
        raise HTTPException(
            409,
            "GEP lease принадлежит "
            "другому устройству",
        )

    lease_status = str(
        lease.status or ""
    ).upper()

    if lease_status == "INELIGIBLE":
        raise HTTPException(
            409,
            "Эта GEP session не была "
            "допущена к контракту",
        )

    if lease_status in {
        "VOID",
        "REJECTED",
    }:
        raise HTTPException(
            409,
            "GEP lease уже недействителен",
        )

    if (
        lease_status
        in ELIGIBLE_LEASE_STATES
        and aware(
            lease.expires_at
        ) is not None
        and aware(
            lease.expires_at
        ) <= now
    ):
        lease.status = "VOID"
        lease.ineligible_reason = (
            "LEASE_EXPIRED"
        )
        lease.voided_at = now
        db.commit()

        raise HTTPException(
            409,
            "GEP lease истёк",
        )

    if not lease.attempt_nonce_hash:
        raise HTTPException(
            409,
            "GEP lease не содержит nonce",
        )

    supplied_nonce_hash = hash_secret(
        str(attempt_nonce or "")
    )

    if not hmac.compare_digest(
        lease.attempt_nonce_hash,
        supplied_nonce_hash,
    ):
        raise HTTPException(
            409,
            "Некорректный attempt nonce",
        )

    if (
        lease.external_match_id
        is not None
        and int(
            lease.external_match_id
        ) != int(match_id)
    ):
        raise HTTPException(
            409,
            "GEP session уже связана "
            "с другим Match ID",
        )

    if lease.board_id is None:
        raise HTTPException(
            409,
            "GEP lease не связан "
            "с контрактным делом",
        )

    mode = str(
        lease.game_match_mode or ""
    ).upper()

    if mode not in VALID_GEP_MODES:
        raise HTTPException(
            409,
            "GEP lease содержит "
            "некорректный режим",
        )

    canonical = (
        _canonical_final_payload(
            session_id=session_id,
            match_id=int(match_id),
            steam_id64=int(
                steam_id64
            ),
            mode=mode,
            terminal_signal=signal,
            match_clock_s=int(
                match_clock_s
            ),
            final_sequence=int(
                final_sequence
            ),
            live_stats=clean_stats,
            local_team=normalized_local,
            winning_team=normalized_winner,
        )
    )

    final_hash = _payload_hash(
        canonical
    )

    evidence = db.scalar(
        select(
            CompanionMatchEvidence
        )
        .where(
            CompanionMatchEvidence.user_id
            == db_user.id,
            CompanionMatchEvidence
            .external_match_id
            == int(match_id),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if (
        evidence
        and int(
            evidence.evidence_schema_version
            or 0
        ) >= 9
        and evidence.server_finalized_at
        is not None
    ):
        try:
            _validated_final_payload(lease=lease, evidence=evidence, user=db_user)
        except ValueError as exc:
            raise HTTPException(409, "Immutable Evidence v9 integrity mismatch") from exc

        same_finalization = bool(
            evidence.gep_session_id
            == session_id
            and evidence.attempt_nonce_hash
            == lease.attempt_nonce_hash
            and evidence.final_payload_hash
            == final_hash
        )

        if not same_finalization:
            raise HTTPException(
                409,
                "Match ID уже имеет другой "
                "immutable Evidence v9 payload",
            )

        if lease_status not in (
            FINALIZED_LEASE_STATES
        ):
            lease.status = (
                "CONSUMED_QUEUED"
                if lease_status
                == "ISSUED_QUEUED"
                else "CONSUMED"
            )

            lease.consumed_at = (
                lease.consumed_at
                or now
            )

        enqueue_job(
            db,
            "settle_gep_match",
            {
                "user_id": db_user.id,
                "board_id": lease.board_id,
                "lease_id": lease.id,
                "evidence_id":
                    evidence.id,
                "external_match_id":
                    int(match_id),
                "mode_hint": mode,
            },
            (
                "settle-gep-v1:"
                f"{lease.id}:"
                f"{int(match_id)}"
            ),
            max_attempts=30,
            commit=False,
        )

        db.commit()
        db.refresh(evidence)
        db.refresh(lease)

        return _finalize_response(
            lease,
            evidence,
            idempotent=True,
        )

    if (
        lease_status
        in FINALIZED_LEASE_STATES
    ):
        raise HTTPException(
            409,
            "GEP lease уже consumed, "
            "но Evidence v9 не совпадает",
        )

    if (
        lease_status
        not in ELIGIBLE_LEASE_STATES
    ):
        raise HTTPException(
            409,
            "GEP lease нельзя финализировать "
            f"из состояния {lease_status}",
        )

    if evidence is None:
        evidence = (
            CompanionMatchEvidence(
                user_id=db_user.id,
                device_id=db_device.id,
                external_match_id=int(
                    match_id
                ),
            )
        )
        db.add(evidence)

    evidence.device_id = (
        db_device.id
    )
    evidence.game_match_mode = mode
    evidence.steam_id64 = int(
        steam_id64
    )

    # Final absence is authoritative too: never inherit a live observation
    # that was not present in the accepted canonical final payload.
    for field in LIVE_STAT_LIMITS:
        setattr(evidence, field, clean_stats.get(field))

    evidence.evidence_schema_version = 9
    evidence.gep_session_id = (
        session_id
    )
    evidence.attempt_nonce_hash = (
        lease.attempt_nonce_hash
    )
    evidence.terminal_signal = signal
    evidence.terminal_at = now
    evidence.server_first_seen_at = (
        lease.server_first_seen_at
    )
    evidence.server_finalized_at = now
    evidence.final_sequence = int(
        final_sequence
    )
    evidence.final_payload_hash = (
        final_hash
    )
    evidence.gep_match_clock_s = int(
        match_clock_s
    )
    evidence.gep_local_team = (
        normalized_local
    )
    evidence.gep_winning_team = (
        normalized_winner
    )
    evidence.integrity_status = (
        GEP_INTEGRITY_CLIENT_ATTESTED
    )
    evidence.captured_at = now
    evidence.updated_at = now

    lease.external_match_id = int(
        match_id
    )
    lease.status = (
        "CONSUMED_QUEUED"
        if lease_status
        == "ISSUED_QUEUED"
        else "CONSUMED"
    )
    lease.consumed_at = now

    db.flush()

    enqueue_job(
        db,
        "settle_gep_match",
        {
            "user_id": db_user.id,
            "board_id": lease.board_id,
            "lease_id": lease.id,
            "evidence_id": evidence.id,
            "external_match_id":
                int(match_id),
            "mode_hint": mode,
        },
        (
            "settle-gep-v1:"
            f"{lease.id}:"
            f"{int(match_id)}"
        ),
        max_attempts=30,
        commit=False,
    )

    db.commit()
    db.refresh(evidence)
    db.refresh(lease)

    return _finalize_response(
        lease,
        evidence,
        idempotent=False,
    )


def normalized_gep_match_from_evidence(
    *,
    lease: CompanionAttemptLease,
    evidence: CompanionMatchEvidence,
    user: User,
) -> dict[str, Any]:
    """Translate validated Evidence v9 into server-scored match facts."""

    if user.account_id is None:
        raise ValueError(
            "У пользователя отсутствует "
            "Deadlock account_id"
        )

    canonical = _validated_final_payload(lease=lease, evidence=evidence, user=user)
    final_stats = canonical["live_stats"]

    mode = str(
        canonical["game_match_mode"] or ""
    ).upper()

    if mode not in VALID_GEP_MODES:
        raise ValueError(
            "Evidence v9 содержит "
            "неизвестный режим"
        )

    if (
        lease.external_match_id
        is None
        or int(
            lease.external_match_id
        )
        != int(
            evidence.external_match_id
        )
    ):
        raise ValueError(
            "Lease/Evidence Match ID mismatch"
        )

    capabilities: set[str] = set()

    field_caps = {
        "kills":
            "summary.kills",
        "deaths":
            "summary.deaths",
        "assists":
            "summary.assists",
        "souls":
            "summary.net_worth",
        "hero_damage":
            "summary.hero_damage",
        "object_damage":
            "summary.object_damage",
    }

    for field, capability in (
        field_caps.items()
    ):
        if final_stats[field] is not None:
            capabilities.add(
                capability
            )

    if final_stats["healing"] is not None:
        capabilities.update(
            {
                "summary.healing",
                "summary.scoreboard_healing",
                "gep.scoreboard_healing",
            }
        )

    duration_s = (
        int(
            canonical["match_clock_s"]
        )
        if canonical["match_clock_s"]
        is not None
        else None
    )

    if duration_s is not None:
        capabilities.add(
            "summary.duration"
        )

    local_team = str(
        canonical["local_team"]
        or ""
    ).upper() or None

    winning_team = str(
        canonical["winning_team"]
        or ""
    ).upper() or None

    won: bool | None = None

    if (
        local_team in VALID_TEAMS
        and winning_team in VALID_TEAMS
    ):
        won = (
            local_team
            == winning_team
        )

        capabilities.add(
            "summary.result"
        )

    started_at = aware(
        lease.server_first_seen_at
    )

    ended_at = aware(
        evidence.server_finalized_at
    )

    if started_at is None:
        raise ValueError(
            "Lease не содержит "
            "server_first_seen_at"
        )

    if ended_at is None:
        raise ValueError(
            "Evidence не содержит "
            "server finalization time"
        )

    return {
        "external_match_id": int(
            canonical["match_id"]
        ),
        "provider": "overwolf_gep",
        "provider_payload_hash":
            evidence.final_payload_hash,
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_s": duration_s,
        "game_match_mode": mode,
        "provider_mode_raw":
            f"overwolf-gep:{mode}",
        "mode_classifier_version":
            GEP_SETTLEMENT_POLICY_VERSION,
        "mode_confidence": "HIGH",
        "scoring_status": "SCORED",
        "game_version": None,
        "is_final": True,
        "capabilities":
            sorted(capabilities),
        "settlement_source":
            GEP_SETTLEMENT_SOURCE,
        "integrity_status":
            GEP_INTEGRITY_CLIENT_ATTESTED,
        "audit_status":
            "NOT_REQUESTED",
        "raw_summary": {
            "gep_settlement": {
                "policy_version":
                    GEP_SETTLEMENT_POLICY_VERSION,
                "evidence_schema_version":
                    9,
                "integrity_status":
                    GEP_INTEGRITY_CLIENT_ATTESTED,
                "settlement_source":
                    GEP_SETTLEMENT_SOURCE,
                "lease_id":
                    lease.id,
                "session_id":
                    canonical["session_id"],
                "final_payload_hash":
                    evidence.final_payload_hash,
                "terminal_signal":
                    canonical["terminal_signal"],
                "final_sequence":
                    canonical["final_sequence"],
                "server_first_seen_at":
                    started_at.isoformat(),
                "server_finalized_at":
                    ended_at.isoformat(),
                "match_clock_s":
                    duration_s,
                "local_team":
                    local_team,
                "winning_team":
                    winning_team,
                "independent_provider":
                    False,
            }
        },
        "participant": {
            "account_id":
                int(user.account_id),
            "steam_id64": canonical["steam_id64"],
            "hero_id":
                final_stats["hero_id"],
            # MatchParticipant.team is an Integer provider field.
            # Overwolf exposes AMBER/SAPPHIRE names here; keep those names
            # in raw_summary and derive `won`, but never write a string into
            # the PostgreSQL integer column.
            "team": None,
            "won": won,
            "kills":
                final_stats["kills"],
            "deaths":
                final_stats["deaths"],
            "assists":
                final_stats["assists"],
            "net_worth":
                final_stats["souls"],
            "hero_damage":
                final_stats["hero_damage"],
            "object_damage":
                final_stats["object_damage"],
            "healing":
                final_stats["healing"],
        },
    }
