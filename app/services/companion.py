from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Header, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import (
    BoardOption,
    CompanionDevice,
    CompanionEvent,
    CompanionMatchEvidence,
    CompanionPairing,
    ContractBoard,
    Job,
    User,
)

CROCKFORD = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
VALID_MODES = {"STANDARD", "RANKED", "STREET_BRAWL"}
LIVE_STAT_LIMITS: dict[str, tuple[int, int]] = {
    "hero_id": (0, 10_000),
    "kills": (0, 500),
    "deaths": (0, 500),
    "assists": (0, 1_000),
    "hero_damage": (0, 100_000_000),
    "object_damage": (0, 100_000_000),
    "healing": (0, 100_000_000),
    "souls": (0, 10_000_000),
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def normalize_pairing_code(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_pairing_code() -> str:
    raw = "".join(secrets.choice(CROCKFORD) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def parse_game_mode(raw: Any) -> tuple[str, dict[str, Any] | None]:
    value = raw
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{"):
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError:
                value = stripped
    payload = value if isinstance(value, dict) else None
    if isinstance(value, dict):
        parts = [str(value.get("match_mode") or ""), str(value.get("game_mode") or "")]
        text = " ".join(parts).lower()
    else:
        text = str(value or "").lower()
    if "street" in text or "brawl" in text:
        return "STREET_BRAWL", payload
    if "ranked" in text and "unranked" not in text:
        return "RANKED", payload
    if "unranked" in text or "normal" in text or "standard" in text:
        return "STANDARD", payload
    return "UNKNOWN", payload


def _bounded_live_int(value: Any, low: int, high: int) -> int | None:
    if value in (None, ""):
        return None
    try:
        result = int(float(value))
    except (TypeError, ValueError):
        return None
    if result < low or result > high:
        return None
    return result


def sanitize_live_stats(stats: Any) -> dict[str, int | None] | None:
    """Keep only the local player's documented GEP roster facts.

    Overwolf payloads are client supplied from the backend's point of view, so
    values are bounded and never override final provider facts later.
    """
    if not isinstance(stats, dict):
        return None
    clean: dict[str, int | None] = {}
    aliases = {
        "hero_id": ("hero_id",),
        "kills": ("kills",),
        "deaths": ("deaths",),
        "assists": ("assists", "assist"),
        "hero_damage": ("hero_damage",),
        "object_damage": ("object_damage",),
        "healing": ("healing", "hero_healing"),
        "souls": ("souls", "net_worth"),
    }
    for field, names in aliases.items():
        raw = next((stats.get(name) for name in names if stats.get(name) not in (None, "")), None)
        low, high = LIVE_STAT_LIMITS[field]
        clean[field] = _bounded_live_int(raw, low, high)
    if not any(value is not None for value in clean.values()):
        return None
    return clean


def create_pairing(db: Session, user: User) -> tuple[str, CompanionPairing]:
    now = utcnow()
    db.execute(delete(CompanionPairing).where(CompanionPairing.user_id == user.id))
    for _ in range(10):
        code = new_pairing_code()
        item = CompanionPairing(
            code_hash=hash_secret(normalize_pairing_code(code)),
            user_id=user.id,
            expires_at=now + timedelta(minutes=settings.companion_pairing_ttl_minutes),
        )
        db.add(item)
        try:
            db.commit()
            db.refresh(item)
            return code, item
        except Exception:
            db.rollback()
    raise RuntimeError("Не удалось создать код привязки Companion")


def claim_pairing(db: Session, code: str, device_id: str, label: str, version: str | None) -> tuple[str, CompanionDevice, User]:
    normalized = normalize_pairing_code(code)
    if len(normalized) != 8:
        raise HTTPException(422, "Некорректный код привязки")
    now = utcnow()
    pairing = db.scalar(select(CompanionPairing).where(CompanionPairing.code_hash == hash_secret(normalized)).with_for_update())
    if not pairing or pairing.claimed_at is not None or (aware(pairing.expires_at) or now) <= now:
        raise HTTPException(410, "Код привязки истёк или уже использован")
    user = db.get(User, pairing.user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.status != "ACTIVE":
        raise HTTPException(403, "Аккаунт заблокирован")

    existing = db.scalar(
        select(CompanionDevice).where(
            CompanionDevice.user_id == user.id,
            CompanionDevice.device_id == device_id,
        ).with_for_update()
    )
    token = new_device_token()
    if existing:
        device = existing
        device.token_hash = hash_secret(token)
        device.label = label
        device.version = version
        device.revoked_at = None
        device.last_seen_at = now
    else:
        device = CompanionDevice(
            user_id=user.id,
            device_id=device_id,
            token_hash=hash_secret(token),
            label=label,
            version=version,
            last_seen_at=now,
        )
        db.add(device)
    pairing.claimed_at = now
    db.commit()
    db.refresh(device)
    return token, device, user


def get_device_by_token(db: Session, token: str) -> CompanionDevice:
    if not token or len(token) < 20:
        raise HTTPException(401, "Companion token отсутствует")
    device = db.scalar(select(CompanionDevice).where(CompanionDevice.token_hash == hash_secret(token)))
    if not device or device.revoked_at is not None:
        raise HTTPException(401, "Companion token недействителен")
    return device


def companion_authorization(authorization: str | None = Header(default=None)) -> tuple[CompanionDevice, User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется Bearer token Companion")
    token = authorization.split(" ", 1)[1].strip()
    db = SessionLocal()
    try:
        device = get_device_by_token(db, token)
        user = db.get(User, device.user_id)
        if not user:
            raise HTTPException(401, "Пользователь Companion не найден")
        db.expunge(device)
        db.expunge(user)
        return device, user
    finally:
        db.close()


def serialize_device(device: CompanionDevice | None) -> dict[str, Any]:
    now = utcnow()
    online = bool(
        device
        and device.revoked_at is None
        and device.last_seen_at
        and (now - (aware(device.last_seen_at) or now)).total_seconds() <= settings.companion_online_seconds
    )
    if not device:
        return {
            "paired": False,
            "online": False,
            "game_running": False,
            "phase": None,
            "game_match_mode": None,
            "current_match_id": None,
            "last_seen_at": None,
            "identity_ok": None,
            "version": None,
            "gep_version": None,
        }
    return {
        "paired": device.revoked_at is None,
        "online": online,
        "game_running": bool(device.game_running and online),
        "phase": device.phase,
        "game_match_mode": device.game_match_mode,
        "current_match_id": device.current_match_id,
        "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
        "identity_ok": device.identity_ok,
        "version": device.version,
        "gep_version": device.gep_version,
        "label": device.label,
    }


def wake_discovery(db: Session, user_id: str, mode: str | None) -> list[str]:
    filters = [
        ContractBoard.user_id == user_id,
        ContractBoard.status.in_(("LOCKED", "VERIFYING")),
    ]
    if mode in VALID_MODES:
        filters.append(ContractBoard.game_match_mode == mode)
    boards = list(
        db.scalars(
            select(ContractBoard).where(*filters)
        ).all()
    )
    now = utcnow()
    woken: list[str] = []
    for board in boards:
        job = db.scalar(select(Job).where(Job.idempotency_key == f"discover:{board.id}"))
        if job and job.status == "PENDING":
            job.run_after = now
            job.last_error = None
            woken.append(board.id)
    return woken


def _upsert_match_evidence(
    db: Session,
    *,
    device: CompanionDevice,
    user: User,
    mode: str,
    match_id: int,
    steam_id64: int | None,
    live_stats: dict[str, int | None] | None,
) -> CompanionMatchEvidence | None:
    if not live_stats:
        return None
    item = db.scalar(
        select(CompanionMatchEvidence).where(
            CompanionMatchEvidence.user_id == user.id,
            CompanionMatchEvidence.external_match_id == match_id,
        ).with_for_update()
    )
    if not item:
        item = CompanionMatchEvidence(
            user_id=user.id,
            device_id=device.id,
            external_match_id=match_id,
        )
        db.add(item)
    item.device_id = device.id
    if mode in VALID_MODES or not item.game_match_mode:
        item.game_match_mode = mode
    item.steam_id64 = steam_id64
    item.captured_at = utcnow()
    for field in LIVE_STAT_LIMITS:
        value = live_stats.get(field)
        if value is not None:
            setattr(item, field, value)
    return item


def _register_direct_match_job(
    db: Session,
    *,
    device: CompanionDevice,
    user: User,
    mode: str,
    match_id: int,
    identity_ok: bool | None,
) -> list[str]:
    """Queue one user-scoped resolver for a finalized exact Match ID.

    Final-v3 deliberately avoids board-scoped jobs. The worker first stores
    the exact finalized match, then decides which locked/review board owns it.
    Outcome alone is never a terminal signal because Deadlock GEP can briefly
    carry the previous match outcome after the current Match ID has changed.
    """
    if match_id <= 0:
        return []
    if user.steam_id64 is not None and identity_ok is not True:
        return []

    now = utcnow()
    key = f"companion-resolve-auto-final-v3:{user.id}:{match_id}"
    existing = db.scalar(select(Job).where(Job.idempotency_key == key))
    if existing:
        if existing.status == "FAILED":
            existing.status = "PENDING"
            existing.attempts = 0
            existing.run_after = now
            existing.last_error = None
        return []

    db.add(
        Job(
            type="resolve_companion_match_auto",
            payload={
                "user_id": user.id,
                "external_match_id": int(match_id),
                "device_id": device.id,
                "detected_at": now.isoformat(),
                "final_signal": True,
                "mode_hint": mode if mode in VALID_MODES else None,
            },
            status="PENDING",
            attempts=0,
            max_attempts=60,
            run_after=now + timedelta(seconds=max(0, settings.companion_finalization_grace_seconds)),
            idempotency_key=key,
        )
    )
    return []


def record_snapshot(
    db: Session,
    device: CompanionDevice,
    user: User,
    *,
    game_running: bool,
    steam_id64: int | None,
    phase: str | None,
    game_mode_raw: Any,
    match_id: int | None,
    gep_version: str | None,
    version: str | None,
    live_stats: Any = None,
    session_id: str | None = None,
    session_started_at: str | None = None,
    session_ended_at: str | None = None,
    session_start_reason: str | None = None,
    session_end_reason: str | None = None,
    match_clock_s: int | None = None,
    match_clock_observed_at: str | None = None,
    local_team: str | None = None,
    match_outcome: str | None = None,
    match_outcome_event_at: str | None = None,
    match_outcome_event_match_id: int | None = None,
    event_type: str = "heartbeat",
) -> tuple[CompanionDevice, list[str], list[str]]:
    now = utcnow()
    db_device = db.get(CompanionDevice, device.id)
    if not db_device or db_device.revoked_at is not None:
        raise HTTPException(401, "Companion отключён")
    mode, raw_payload = parse_game_mode(game_mode_raw)
    identity_ok = None
    if steam_id64 is not None and user.steam_id64 is not None:
        identity_ok = int(steam_id64) == int(user.steam_id64)
    db_device.last_seen_at = now
    db_device.game_running = bool(game_running)
    db_device.phase = phase[:64] if phase else None
    db_device.game_match_mode = mode
    db_device.game_mode_raw = raw_payload or ({"value": str(game_mode_raw)} if game_mode_raw not in (None, "") else None)
    db_device.current_match_id = int(match_id) if match_id else None
    db_device.gep_version = gep_version[:64] if gep_version else None
    db_device.version = version[:32] if version else db_device.version
    db_device.identity_ok = identity_ok

    clean_stats = sanitize_live_stats(live_stats)
    safe_payload = {
        "game_running": bool(game_running),
        "steam_id64": str(steam_id64) if steam_id64 else None,
        "game_mode_raw": db_device.game_mode_raw,
        "identity_ok": identity_ok,
        "live_stats": clean_stats,
        "session": {
            "id": session_id,
            "started_at": session_started_at,
            "ended_at": session_ended_at,
            "start_reason": session_start_reason,
            "end_reason": session_end_reason,
            "match_clock_s": match_clock_s,
            "match_clock_observed_at": match_clock_observed_at,
            "local_team": local_team,
            "match_outcome": match_outcome,
            "match_outcome_event_at": match_outcome_event_at,
            "match_outcome_event_match_id": int(match_outcome_event_match_id) if match_outcome_event_match_id else None,
        },
    }
    db.add(
        CompanionEvent(
            device_id=db_device.id,
            user_id=user.id,
            event_type=event_type[:64],
            external_match_id=db_device.current_match_id,
            game_match_mode=mode,
            phase=db_device.phase,
            payload=safe_payload,
        )
    )

    # Live GEP roster values are provisional.  Persist them throughout the
    # match, but do not create a resolver job until the Companion has an
    # explicit finalization signal.  Earlier versions registered a job on the
    # first heartbeat with Match ID, allowing a second live snapshot to be
    # mistaken for a final match when upstream metadata was still unavailable.
    # IMPORTANT: match_outcome is intentionally NOT a terminal signal. In
    # production Deadlock GEP we observed current match_id=99529660 while
    # match_outcome still referred to the previous match 99514255. The frozen
    # alpha.4 Companion only sends the winning team, not the outcome's embedded
    # match_id, so the backend cannot correlate that field safely.
    phase_value = str(phase or "").strip().lower()
    end_reason = str(session_end_reason or "").strip().lower()
    # Phase alone is insufficient: it may flicker or be replayed. Queue a
    # final resolver only from an explicit match_ended event or a persisted
    # session-end marker emitted by the Companion.
    final_snapshot = bool(
        event_type == "match_ended"
        or (
            session_ended_at
            and end_reason in {"match_end", "phase_postgame"}
        )
    )

    if db_device.current_match_id and (user.steam_id64 is None or identity_ok is True):
        _upsert_match_evidence(
            db,
            device=db_device,
            user=user,
            mode=mode,
            match_id=db_device.current_match_id,
            steam_id64=steam_id64,
            live_stats=clean_stats,
        )
        direct = (
            _register_direct_match_job(
                db,
                device=db_device,
                user=user,
                mode=mode,
                match_id=db_device.current_match_id,
                identity_ok=identity_ok,
            )
            if final_snapshot
            else []
        )
    else:
        direct = []

    woken = wake_discovery(db, user.id, mode) if match_id and event_type in {"match_started", "match_ended"} else []
    db.commit()
    db.refresh(db_device)
    return db_device, woken, direct
