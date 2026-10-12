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
HERO_RANKS = RANKS
CATALOG_RANKS = (*HERO_RANKS, "EX")
BASES = {"HIDDEN_KING": "Тайный король / Hidden King", "ARCHMOTHER": "Архиматерь / Archmother"}
# Roster snapshot: https://deadlock-api.com/heroes, 2026-09-08, plus the six
# City Never Sleeps posters: https://www.playdeadlock.com/cityneversleeps.
# These are catalogue keys, deliberately not Valve numeric hero IDs.
HEROES = {name.lower().replace(" & ", "-").replace(" ", "-"): name for name in (
    "Abrams", "Apollo", "Baba", "Bebop", "Billy", "Calico", "Celeste", "Deadman Danny", "Drifter", "Dynamo",
    "Graves", "Grey Talon", "Haze", "Holliday", "Infernus", "Ivy", "Kelvin", "Lady Geist",
    "Lash", "McGinnis", "Mina", "Mirage", "Mo & Krill", "Nurse Harrow", "Paige", "Paradox", "Pocket",
    "Rat King", "Rem", "Seven", "Shiv", "Silver", "Sinclair", "Solomon", "The Doorman", "Venator", "Victor",
    "Vindicta", "Violet", "Viscous", "Vyper", "Warden", "Wraith", "Yamato",
)}
MAX_IMAGE_BYTES = 300_000
MAX_BALANCE = 1_000_000_000
ECONOMY_SCOPES = ("REAL", "SANDBOX")


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


def battle_metadata(db, cards):
    """Publication is independent of the explicit server-approved battle link."""
    from ..battle_models import BattleArtwork, BattleDefinitionVersion
    cards_by_id = {card.id: card for card in cards}
    if not cards_by_id:
        return {}
    rows = db.execute(select(BattleArtwork, BattleDefinitionVersion).join(
        BattleDefinitionVersion, BattleDefinitionVersion.id == BattleArtwork.definition_id).where(
        BattleArtwork.card_id.in_(cards_by_id), BattleArtwork.approved.is_(True), BattleDefinitionVersion.approved.is_(True))).all()
    result = {}
    for artwork, definition in rows:
        card = cards_by_id[artwork.card_id]
        expected = "BASE" if card.rank == "EX" else "HERO"
        if definition.key == card.hero and definition.category == expected and card.rank in CATALOG_RANKS:
            result[card.id] = {"category": expected, "battle_eligible": True, "definition_key": definition.key,
                               "definition_id": definition.id, "definition_version": definition.version}
    return result


def card_payload(card, *, private=False, staff=False, battle=None):
    from .archive_seed import is_release_poster
    result = {key: getattr(card, key) for key in (
        "id", "hero", "rank", "title", "description", "artist", "source_url", "crop_x", "crop_y", "zoom", "frame_version", "status", "revision")}
    result["hero_name"] = HEROES.get(card.hero, BASES.get(card.hero, card.hero))
    result.update(category="BASE" if card.rank == "EX" else "HERO", battle_eligible=False)
    result.update(battle or {})
    result["release_poster"] = is_release_poster(card)
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
    if payload.hero not in HEROES and payload.hero not in BASES:
        raise HTTPException(422, "Выберите героя из списка / Choose a listed hero")
    if (payload.rank == "EX") != (payload.hero in BASES):
        raise HTTPException(422, "Ранг EX предназначен для баз покровителей / EX is reserved for patron bases")
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


def wallet_state(db, user_id, scope="REAL"):
    if scope not in ECONOMY_SCOPES:
        raise HTTPException(422, "Unknown economy scope")
    net = db.scalar(select(func.coalesce(func.sum(ArchiveLedger.delta), 0)).where(
        ArchiveLedger.user_id == user_id, ArchiveLedger.scope == scope))
    return {"scope": scope, "net_balance": net, "available_balance": max(0, net), "debt": max(0, -net)}


def credit_wallet(db, user_id, source, reason, delta, scope="REAL"):
    """Append a bounded positive credit within the caller's locked transaction."""
    state = wallet_state(db, user_id, scope)
    if type(delta) is not int or delta <= 0:
        raise ValueError("A wallet credit must be a positive integer")
    if state["net_balance"] + delta > MAX_BALANCE:
        raise HTTPException(409, "Достигнут предел баланса / Balance limit reached")
    db.add(ArchiveLedger(user_id=user_id, source=source, reason=reason, delta=delta, scope=scope))


def wallet_payload(db, user_id, offset=0, scope="REAL"):
    week = week_start()
    rows = db.scalars(select(ArchiveCipher).where(ArchiveCipher.user_id == user_id, ArchiveCipher.week == week).order_by(ArchiveCipher.slot)).all()
    entries = db.scalars(select(ArchiveLedger).where(ArchiveLedger.user_id == user_id, ArchiveLedger.scope == scope)
        .order_by(ArchiveLedger.created_at.desc(), ArchiveLedger.id).offset(offset).limit(20)).all()
    wallets = {key: wallet_state(db, user_id, key) for key in ECONOMY_SCOPES}
    return {**wallets[scope], "balance": wallets[scope]["available_balance"], "wallets": wallets,
            "currency": "ARCHIVE_TOKEN", "weekly_limit": 5, "reward": 30,
            "completed": sum(item.status != "OPEN" for item in rows),
            "reset_at": datetime.combine(week + timedelta(days=7), datetime.min.time(), tzinfo=timezone.utc).isoformat(),
            "round": cipher_payload(next((item for item in rows if item.status == "OPEN"), None)),
            "history": [{"id": row.id, "delta": row.delta, "reason": row.reason, "scope": row.scope,
                         "source": row.source, "created_at": aware(row.created_at).isoformat()} for row in entries],
            "history_total": db.scalar(select(func.count()).select_from(ArchiveLedger).where(
                ArchiveLedger.user_id == user_id, ArchiveLedger.scope == scope))}
