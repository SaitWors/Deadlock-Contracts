"""Browser archive: authored designs and a separate, bounded currency ledger."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import warnings
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select

from ..models import ArchiveCard, ArchiveCipher, ArchiveLedger, AuditLog, User, utcnow

RANKS = ("F", "E", "D", "C", "B", "A", "S", "SS", "SSS")
# Roster snapshot: https://deadlock-api.com/heroes, 2026-09-08.
# These are catalogue keys, deliberately not Valve numeric hero IDs.
HEROES = {name.lower().replace(" & ", "-").replace(" ", "-"): name for name in (
    "Abrams", "Apollo", "Bebop", "Billy", "Calico", "Celeste", "Drifter", "Dynamo",
    "Graves", "Grey Talon", "Haze", "Holliday", "Infernus", "Ivy", "Kelvin", "Lady Geist",
    "Lash", "McGinnis", "Mina", "Mirage", "Mo & Krill", "Paige", "Paradox", "Pocket",
    "Rem", "Seven", "Shiv", "Silver", "Sinclair", "The Doorman", "Venator", "Victor",
    "Vindicta", "Viscous", "Vyper", "Warden", "Wraith", "Yamato",
)}
MAX_IMAGE_BYTES = 300_000


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def week_start(now=None):
    today = (now or utcnow()).date()
    return today - timedelta(days=today.weekday())


def lock_user(db, user_id):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if not user or user.status != "ACTIVE":
        raise HTTPException(403, "Аккаунт недоступен / Account unavailable")
    return user


def image_bytes(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("size")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as opened:
                if opened.format not in {"PNG", "JPEG", "WEBP"} or getattr(opened, "n_frames", 1) != 1:
                    raise ValueError("format")
                if min(opened.size) < 240 or max(opened.size) > 2048 or opened.width * opened.height > 4_000_000:
                    raise ValueError("dimensions")
                opened.load()
                clean = ImageOps.exif_transpose(opened).convert("RGB")
                clean.thumbnail((960, 960), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                # No EXIF, ICC profile, comments, external links or original bytes survive.
                clean.save(output, format="WEBP", quality=82, method=4)
        result = output.getvalue()
        if len(result) > MAX_IMAGE_BYTES:
            raise ValueError("size")
        return result
    except (ValueError, OSError, binascii.Error, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(422, "Нужен статичный PNG/JPEG/WebP до 300 КБ, от 240 до 2048 px / Invalid image") from None


def card_payload(card, *, private=False, staff=False):
    result = {key: getattr(card, key) for key in (
        "id", "hero", "rank", "title", "description", "artist", "source_url", "crop_x", "crop_y", "zoom", "frame_version", "status", "revision")}
    result["hero_name"] = HEROES.get(card.hero, card.hero)
    prefix = "/api/admin/archive/cards" if staff else "/api/archive/cards"
    result["image_url"] = f"{prefix}/{card.id}/image?r={card.revision}" if card.image_digest else None
    result["published_at"] = aware(card.published_at).isoformat() if card.published_at else None
    if private:
        result.update(rights_confirmed=card.rights_confirmed, review_note=card.review_note)
    return result


def audit(db, user_id, card, action, **data):
    db.add(AuditLog(user_id=user_id, action="archive_card." + action, entity_type="archive_card",
                    entity_id=card.id, data={"revision": card.revision, **data}))


def set_design(card, payload):
    if payload.hero not in HEROES:
        raise HTTPException(422, "Выберите героя из списка / Choose a listed hero")
    for field in ("hero", "rank", "title", "description", "artist", "source_url", "rights_confirmed", "crop_x", "crop_y", "zoom"):
        setattr(card, field, getattr(payload, field))
    if payload.image is not None:
        card.image_data = image_bytes(payload.image)
        card.image_digest = hashlib.sha256(card.image_data).hexdigest()
    card.updated_at = utcnow()


def feedback(solution, symbols):
    exact = sum(a == b for a, b in zip(solution, symbols))
    return {"exact": exact, "misplaced": len(set(solution) & set(symbols)) - exact}


def cipher_payload(item):
    if not item:
        return None
    return {"id": item.id, "slot": item.slot, "status": item.status, "revision": item.revision,
            "guesses": [{"symbols": guess, **feedback(item.solution, guess)} for guess in item.guesses],
            "solution": item.solution if len(item.guesses) >= 6 or item.status != "OPEN" else None}


def wallet_payload(db, user_id, offset=0):
    week = week_start()
    rows = db.scalars(select(ArchiveCipher).where(ArchiveCipher.user_id == user_id, ArchiveCipher.week == week).order_by(ArchiveCipher.slot)).all()
    entries = db.scalars(select(ArchiveLedger).where(ArchiveLedger.user_id == user_id)
        .order_by(ArchiveLedger.created_at.desc(), ArchiveLedger.id).offset(offset).limit(20)).all()
    return {"balance": db.scalar(select(func.coalesce(func.sum(ArchiveLedger.delta), 0)).where(ArchiveLedger.user_id == user_id)),
            "currency": "ARCHIVE_TOKEN", "weekly_limit": 5, "reward": 30,
            "completed": sum(item.status != "OPEN" for item in rows),
            "reset_at": datetime.combine(week + timedelta(days=7), datetime.min.time(), tzinfo=timezone.utc).isoformat(),
            "round": cipher_payload(next((item for item in rows if item.status == "OPEN"), None)),
            "history": [{"id": row.id, "delta": row.delta, "reason": row.reason, "created_at": aware(row.created_at).isoformat()} for row in entries],
            "history_total": db.scalar(select(func.count()).select_from(ArchiveLedger).where(ArchiveLedger.user_id == user_id))}
