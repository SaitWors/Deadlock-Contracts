"""Manual collection grants and redemption of recipient-owned pack gifts."""

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import ArchiveCard, ArchiveOperation, ArchivePack, ArchivePackVersion
from ..pack_models import ArchivePackGift
from . import archive_packs as packs, pack_rules
from .arena_catalog_repair import is_pristine_arena_card


def grant_card(db: Session, actor_id: str, recipient_id: str, card_id: str, payload) -> dict:
    inputs = {"actor_id": actor_id, "card_id": card_id, "revision": payload.revision,
              "quantity": payload.quantity, "reason": payload.reason}
    operation, replay = packs.begin(db, recipient_id, "OWNER_CARD_GIFT", payload.request_key, inputs)
    if replay:
        return packs.receipt_payload(operation)
    card = db.scalar(select(ArchiveCard).where(ArchiveCard.id == card_id).with_for_update(read=True))
    if (not card or card.revision != payload.revision or card.status != "PUBLISHED"
            or not card.image_digest or not card.image_data or is_pristine_arena_card(card)):
        raise HTTPException(409, "Карточка изменилась или недоступна / Card changed or unavailable")
    items = packs.issue(db, operation, [card] * payload.quantity)
    packs.audit(db, actor_id, "owner_grant_card_to_player", operation.id, {**inputs, "recipient_id": recipient_id})
    return packs.finish(db, operation, items=items)


def _available_pool(db: Session, pack_id: str, *, revision=None, version=None):
    pack = db.scalar(select(ArchivePack).where(ArchivePack.id == pack_id).with_for_update(read=True))
    if not pack or not pack.active or (revision is not None and pack.revision != revision):
        raise HTTPException(409, "Конверт изменился или недоступен / Pack changed or unavailable")
    version = version or packs.pack_version(db, pack)
    if not version:
        raise HTTPException(409, "Состав конверта недоступен / Pack content unavailable")
    entries = version.config["entries"]
    cards = packs.cards_for_pool(db, entries, lock=True)
    if version.config.get("rule_version") == pack_rules.RULE_VERSION:
        ready = packs.ready_v2_pool(db, entries, cards)
    else:
        ready = packs.ready_pool(entries, cards)
    if not ready:
        raise HTTPException(409, "Состав конверта недоступен / Pack content unavailable")
    return version, cards


def grant_pack(db: Session, actor_id: str, recipient_id: str, pack_id: str, payload) -> dict:
    inputs = {"actor_id": actor_id, "pack_id": pack_id, "revision": payload.revision,
              "quantity": payload.quantity, "reason": payload.reason}
    operation, replay = packs.begin(db, recipient_id, "OWNER_PACK_GIFT", payload.request_key, inputs)
    if replay:
        return packs.receipt_payload(operation)
    version, _ = _available_pool(db, pack_id, revision=payload.revision)
    operation.pack_version_id = version.id
    db.add(ArchivePackGift(grant_id=operation.id, remaining=payload.quantity))
    packs.audit(db, actor_id, "owner_grant_pack_to_player", operation.id, {**inputs, "recipient_id": recipient_id})
    return packs.finish(db, operation, extra={"quantity": payload.quantity})


def list_gifts(db: Session, recipient_id: str) -> dict:
    rows = db.execute(
        select(ArchivePackGift, ArchivePackVersion, ArchivePack.active)
        .join(ArchiveOperation, ArchiveOperation.id == ArchivePackGift.grant_id)
        .join(ArchivePackVersion, ArchivePackVersion.id == ArchiveOperation.pack_version_id)
        .join(ArchivePack, ArchivePack.id == ArchivePackVersion.pack_id)
        .where(ArchiveOperation.user_id == recipient_id, ArchivePackGift.remaining > 0)
        .order_by(ArchiveOperation.created_at, ArchiveOperation.id)
    )
    return {"items": [
        {"id": gift.grant_id, "remaining": gift.remaining, "active": active,
         "title": version.config["title"], "draws": version.config["draws"]}
        for gift, version, active in rows
    ]}


def open_gift(db: Session, recipient_id: str, gift_id: str, payload) -> dict:
    operation, replay = packs.begin(db, recipient_id, "GIFT_PACK_OPEN", payload.request_key,
                                    {"gift_id": gift_id, "remaining": payload.remaining})
    if replay:
        return packs.receipt_payload(operation)
    row = db.execute(
        select(ArchivePackGift, ArchivePackVersion)
        .join(ArchiveOperation, ArchiveOperation.id == ArchivePackGift.grant_id)
        .join(ArchivePackVersion, ArchivePackVersion.id == ArchiveOperation.pack_version_id)
        .where(ArchivePackGift.grant_id == gift_id, ArchiveOperation.user_id == recipient_id)
    ).one_or_none()
    if not row:
        raise HTTPException(404, "Подарок не найден / Gift not found")
    gift, version = row
    if gift.remaining != payload.remaining:
        raise HTTPException(409, "Количество конвертов изменилось. Обнови список / Refresh your gifts")
    version, cards = _available_pool(db, version.pack_id, version=version)
    claimed = db.execute(update(ArchivePackGift).where(
        ArchivePackGift.grant_id == gift_id, ArchivePackGift.remaining == payload.remaining,
    ).values(remaining=ArchivePackGift.remaining - 1)).rowcount
    if claimed != 1:
        raise HTTPException(409, "Количество конвертов изменилось. Обнови список / Refresh your gifts")
    return packs.finish_free_pack(db, operation, version, cards, extra={"gift_id": gift_id})
