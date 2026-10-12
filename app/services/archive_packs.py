"""Versioned pack rules, immutable receipts and a privately owned card inventory."""
from __future__ import annotations

import hashlib
import json
import secrets
from collections import Counter

from fastapi import HTTPException
from sqlalchemy import Integer, func, select

from ..models import (ArchiveCard, ArchiveFavorite, ArchiveItem, ArchiveLedger, ArchiveOperation, ArchivePack,
                      ArchivePackVersion, ArchiveShowcase, AuditLog, PublicProfile)
from .archive import ECONOMY_SCOPES, MAX_BALANCE, RANKS, aware, card_payload, lock_user, wallet_state

# Internal collection balance, not a cash value or an external market estimate.
DIRECT_COST = dict(zip(RANKS, (25, 40, 70, 120, 220, 380, 700, 1300, 2600)))
DEFAULT_WEIGHTS = dict(zip(RANKS, (2000, 1600, 1200, 900, 600, 350, 150, 60, 15)))
PRICE_MODEL = 2


def balance(db, user_id, scope="REAL"):
    return wallet_state(db, user_id, scope)["net_balance"]


def recommendation(entries, draws):
    total = sum(entry["weight"] for entry in entries)
    value = sum(DIRECT_COST[entry["rank"]] * entry["weight"] for entry in entries)
    # ceil(expected direct cost * 55% / 5) * 5, using integers throughout.
    denominator = total * 100 * 5
    price = max(5, ((draws * value * 55 + denominator - 1) // denominator) * 5)
    return {"price": price, "model": PRICE_MODEL, "discount_percent": 45,
            "expected_direct_cost": round(draws * value / total, 2),
            "weeks_at_150": round(price / 150, 2), "direct_costs": DIRECT_COST}


def rank_odds(entries):
    weights = Counter()
    for entry in entries:
        weights[entry["rank"]] += entry["weight"]
    total = sum(weights.values())
    return [{"rank": rank, "weight": weights[rank], "total_weight": total,
             "percent": round(weights[rank] * 100 / total, 4)} for rank in RANKS if weights[rank]]


def cards_for_pool(db, entries, *, lock=False):
    statement = select(ArchiveCard).where(ArchiveCard.id.in_([entry["card_id"] for entry in entries])).order_by(ArchiveCard.id)
    if lock:
        statement = statement.with_for_update(read=True).execution_options(populate_existing=True)
    return {card.id: card for card in db.scalars(statement)}


def ready_pool(entries, cards):
    return all(entry["card_id"] in cards and cards[entry["card_id"]].status == "PUBLISHED"
               and cards[entry["card_id"]].image_digest for entry in entries)


def configuration(db, payload):
    entries = [{"card_id": str(entry.card_id), "weight": entry.weight} for entry in payload.entries]
    cards = cards_for_pool(db, entries, lock=True)
    if not ready_pool(entries, cards):
        raise HTTPException(422, "В состав можно включить только опубликованные карточки с изображением / Published artwork required")
    for entry in entries:
        entry["rank"] = cards[entry["card_id"]].rank
    return {"title": payload.title, "description": payload.description, "price": payload.price,
            "draws": payload.draws, "entries": entries, "price_model": PRICE_MODEL}


def pack_version(db, pack):
    return db.scalar(select(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id,
                                                    ArchivePackVersion.revision == pack.revision))


def pack_payload(db, pack, *, detailed=False, version=None):
    version = version or pack_version(db, pack)
    config = version.config
    cards = cards_for_pool(db, config["entries"])
    ready = bool(ready_pool(config["entries"], cards))
    cover = next((card for card in cards.values() if card.status == "PUBLISHED"), None)
    result = {"id": pack.id, "revision": pack.revision, "active": pack.active, "starter": pack.starter,
              "title": config["title"], "description": config["description"], "price": config["price"],
              "draws": config["draws"], "card_count": len(config["entries"]), "ready": ready,
              "odds": rank_odds(config["entries"]), "recommendation": recommendation(config["entries"], config["draws"]),
              "cover": card_payload(cover) if cover else None}
    if detailed:
        total = sum(entry["weight"] for entry in config["entries"])
        result["entries"] = [{**entry, "percent": round(entry["weight"] * 100 / total, 4),
                              "card": card_payload(cards[entry["card_id"]]) if entry["card_id"] in cards else None}
                             for entry in config["entries"]]
    return result


def audit(db, user_id, action, entity_id, data):
    db.add(AuditLog(user_id=user_id, action="archive." + action, entity_type="archive",
                    entity_id=entity_id, data=data))


def receipt_payload(operation):
    # Scope was introduced after immutable receipts. Add its current provenance
    # to the response without altering the stored historical receipt.
    return {**operation.result, "scope": operation.scope}


def begin(db, user_id, kind, request_key, inputs, *, scope="REAL"):
    lock_user(db, user_id)
    if scope not in ECONOMY_SCOPES:
        raise HTTPException(422, "Unknown economy scope")
    def signature_for(values):
        return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    signature = signature_for({"kind": kind, **inputs, "scope": scope})
    existing = db.scalar(select(ArchiveOperation).where(ArchiveOperation.user_id == user_id,
                                                       ArchiveOperation.request_key == str(request_key)))
    if existing:
        # Migrated receipts retain their original hash and result. Their assigned
        # scope still has to match, so retries can never cross wallet boundaries.
        legacy = signature_for({"kind": kind, **inputs})
        if existing.scope != scope or existing.signature not in {signature, legacy}:
            raise HTTPException(409, "Этот ключ запроса уже использован для другого действия / Request key reused")
        return existing, True
    operation = ArchiveOperation(user_id=user_id, kind=kind, request_key=str(request_key), signature=signature, scope=scope)
    db.add(operation)
    db.flush()
    return operation, False


def finish(db, operation, *, delta=0, items=None, extra=None, allow_debt=False):
    current = balance(db, operation.user_id, operation.scope)
    if delta < 0 and not allow_debt and max(0, current) < -delta:
        raise HTTPException(409, "Недостаточно жетонов / Not enough tokens")
    if current + delta > MAX_BALANCE:
        raise HTTPException(409, "Достигнут предел баланса / Balance limit reached")
    if delta:
        db.add(ArchiveLedger(user_id=operation.user_id, source="operation:" + operation.id, reason=operation.kind,
                             delta=delta, scope=operation.scope))
    net = current + delta
    operation.result = {"id": operation.id, "kind": operation.kind, "scope": operation.scope, "delta": delta,
                        "balance_after": max(0, net), "net_balance": net, "available_balance": max(0, net), "debt": max(0, -net),
                        "items": items or [], "created_at": aware(operation.created_at).isoformat(), **(extra or {})}
    db.commit()
    return operation.result


def owns_card(db, user_id, card_id, scope="REAL"):
    return db.scalar(select(ArchiveItem.id).where(ArchiveItem.user_id == user_id, ArchiveItem.card_id == card_id,
                                                 ArchiveItem.state == "OWNED", ArchiveItem.scope == scope).limit(1)) is not None


def issue(db, operation, cards, paid=0):
    existing = set(db.scalars(select(ArchiveItem.card_id).where(ArchiveItem.user_id == operation.user_id,
                    ArchiveItem.card_id.in_([card.id for card in cards]), ArchiveItem.state == "OWNED",
                    ArchiveItem.scope == operation.scope)))
    results = []
    basis, remainder = divmod(paid, len(cards))
    test = operation.scope == "SANDBOX"
    for i, card in enumerate(cards):
        item = ArchiveItem(user_id=operation.user_id, card_id=card.id, operation_id=operation.id,
                           cost_basis=basis + (i < remainder), test_grant=test, scope=operation.scope)
        db.add(item)
        db.flush()
        results.append({"id": item.id, "card": card_payload(card), "duplicate": card.id in existing,
                        "scope": operation.scope, "test_grant": test, "recycle_value": item.cost_basis // 5})
        existing.add(card.id)
    return results


def choose(entries, draws):
    total = sum(entry["weight"] for entry in entries)
    output = []
    for _ in range(draws):
        ticket = secrets.randbelow(total)
        for entry in entries:
            ticket -= entry["weight"]
            if ticket < 0:
                output.append(entry["card_id"])
                break
    return output


def open_pack(db, user_id, pack_id, payload):
    kind = "STARTER_PACK" if payload.starter else "PACK_OPEN"
    operation, replay = begin(db, user_id, kind, payload.request_key,
                              {"pack_id": pack_id, "revision": payload.revision}, scope=payload.scope)
    if replay:
        return receipt_payload(operation)
    pack = db.scalar(select(ArchivePack).where(ArchivePack.id == pack_id).with_for_update())
    if not pack or not pack.active:
        raise HTTPException(409, "Конверт сейчас недоступен / Pack unavailable")
    if pack.revision != payload.revision:
        raise HTTPException(409, "Состав или цена изменились. Обновите конверт / Pack changed; refresh first")
    version = pack_version(db, pack)
    config = version.config
    cards = cards_for_pool(db, config["entries"], lock=True)
    if not ready_pool(config["entries"], cards):
        raise HTTPException(409, "Одна из карточек снята с публикации. Конверт приостановлен / Pack content unavailable")
    price = config["price"]
    if payload.starter:
        benefit_key = "starter" if payload.scope == "REAL" else "starter:sandbox"
        claimed = db.scalar(select(ArchiveOperation.id).where(ArchiveOperation.user_id == user_id,
                                                             ArchiveOperation.benefit_key == benefit_key))
        if not pack.starter or claimed:
            raise HTTPException(409, "Стартовый конверт недоступен или уже получен / Starter already claimed or unavailable")
        operation.benefit_key = benefit_key
        price = 0
    if price and wallet_state(db, user_id, payload.scope)["available_balance"] < price:
        raise HTTPException(409, "Недостаточно жетонов / Not enough tokens")
    operation.pack_version_id = version.id
    selected = [cards[card_id] for card_id in choose(config["entries"], config["draws"])]
    result = issue(db, operation, selected, price)
    return finish(db, operation, delta=-price, items=result, extra={"pack": {
        "id": pack.id, "title": config["title"], "revision": pack.revision, "price": price,
        "draws": config["draws"], "odds": rank_odds(config["entries"])}})


def acquire(db, user_id, card_id, payload, *, owner=False):
    kind = "OWNER_CARD" if owner else "DIRECT_CARD"
    inputs = {"card_id": card_id, "quantity": payload.quantity if owner else 1,
              "note": payload.note if owner else "", "expected_price": 0 if owner else payload.expected_price}
    operation, replay = begin(db, user_id, kind, payload.request_key, inputs, scope=payload.scope)
    if replay:
        return receipt_payload(operation)
    card = db.scalar(select(ArchiveCard).where(ArchiveCard.id == card_id).with_for_update(read=True))
    if not card or card.status != "PUBLISHED" or not card.image_digest:
        raise HTTPException(409, "Карточка сейчас недоступна / Card unavailable")
    price = 0 if owner else DIRECT_COST[card.rank]
    if not owner and payload.expected_price != price:
        raise HTTPException(409, "Цена изменилась. Обновите каталог / Price changed; refresh catalogue")
    if price and wallet_state(db, user_id, payload.scope)["available_balance"] < price:
        raise HTTPException(409, "Недостаточно жетонов / Not enough tokens")
    result = issue(db, operation, [card] * inputs["quantity"], price)
    if owner:
        audit(db, user_id, "owner_grant_card", operation.id, {**inputs, "scope": payload.scope, "recipient_id": user_id})
    return finish(db, operation, delta=-price, items=result)


def recycle(db, user_id, item_id, payload):
    operation, replay = begin(db, user_id, "RECYCLE", payload.request_key, {"item_id": item_id}, scope=payload.scope)
    if replay:
        return receipt_payload(operation)
    item = db.scalar(select(ArchiveItem).where(ArchiveItem.id == item_id, ArchiveItem.user_id == user_id,
                                               ArchiveItem.scope == payload.scope).with_for_update())
    if not item or item.state != "OWNED":
        raise HTTPException(409, "Этот экземпляр уже недоступен / Item unavailable")
    count = db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id,
                      ArchiveItem.card_id == item.card_id, ArchiveItem.state == "OWNED", ArchiveItem.scope == payload.scope))
    if count < 2:
        raise HTTPException(409, "Последний экземпляр остаётся в коллекции / Keep the last copy")
    if item.cost_basis < 5:
        raise HTTPException(409, "Бесплатный или слишком дешёвый экземпляр не даёт жетонов / This copy has no token refund")
    item.state = "RECYCLED"
    return finish(db, operation, delta=item.cost_basis // 5, extra={"recycled_item_id": item.id})


def favorite_card_ids(db, user_id, scope="REAL"):
    owned = select(ArchiveItem.id).where(ArchiveItem.user_id == user_id,
                                         ArchiveItem.card_id == ArchiveFavorite.card_id,
                                         ArchiveItem.state == "OWNED", ArchiveItem.scope == scope).exists()
    return list(db.scalars(select(ArchiveFavorite.card_id).where(ArchiveFavorite.user_id == user_id, owned)
                           .order_by(ArchiveFavorite.card_id)))


def set_favorite(db, user_id, card_id, favorite, scope="REAL"):
    lock_user(db, user_id)
    row = db.get(ArchiveFavorite, (user_id, card_id))
    if favorite:
        if not owns_card(db, user_id, card_id, scope):
            raise HTTPException(404, "Card not found")
        if row is None:
            db.add(ArchiveFavorite(user_id=user_id, card_id=card_id))
    elif row is not None:
        db.delete(row)
    db.commit()
    return {"card_id": card_id, "favorite": favorite}


def inventory(db, user_id, hero, rank, q, offset, favorites_only=False, scope="REAL"):
    count = func.count(ArchiveItem.id).label("quantity")
    favorite = select(ArchiveFavorite.card_id).where(ArchiveFavorite.user_id == user_id,
                                                      ArchiveFavorite.card_id == ArchiveCard.id).exists()
    statement = select(ArchiveCard, count, func.sum(ArchiveItem.test_grant.cast(Integer)).label("test_count"),
                       favorite.label("favorite")) \
        .join(ArchiveItem, ArchiveItem.card_id == ArchiveCard.id).where(ArchiveItem.user_id == user_id,
                ArchiveItem.state == "OWNED", ArchiveItem.scope == scope)
    if hero:
        statement = statement.where(ArchiveCard.hero == hero)
    if rank:
        statement = statement.where(ArchiveCard.rank == rank)
    if q:
        statement = statement.where(ArchiveCard.title.ilike("%" + q.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%", escape="\\"))
    if favorites_only:
        statement = statement.where(favorite)
    statement = statement.group_by(ArchiveCard.id)
    total = db.scalar(select(func.count()).select_from(statement.subquery()))
    rows = db.execute(statement.order_by(ArchiveCard.hero, ArchiveCard.rank, ArchiveCard.title, ArchiveCard.id).offset(offset).limit(18)).all()
    result = []
    for card, quantity, test_count, is_favorite in rows:
        duplicate = db.scalar(select(ArchiveItem).where(ArchiveItem.user_id == user_id, ArchiveItem.card_id == card.id,
                          ArchiveItem.state == "OWNED", ArchiveItem.cost_basis >= 5, ArchiveItem.scope == scope)
                          .order_by(ArchiveItem.cost_basis.desc(), ArchiveItem.id).limit(1)) if quantity > 1 else None
        result.append({"card": card_payload(card), "quantity": quantity, "test_count": test_count, "scope": scope,
                       "favorite": bool(is_favorite),
                       "recycle": {"id": duplicate.id, "value": duplicate.cost_basis // 5} if duplicate else None})
    return {"items": result, "total": total, "scope": scope}


def showcase_settings(db, user_id):
    row = db.get(ArchiveShowcase, user_id)
    profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user_id))
    return {"card_ids": row.card_ids if row else [], "is_public": bool(row and row.is_public),
            "revision": row.revision if row else 0, "profile_public": bool(profile and profile.is_public)}


def profile_cards(db, user_id, *, public_slug=None):
    row = db.get(ArchiveShowcase, user_id)
    visible = bool(row and row.is_public)
    if not row or (public_slug and not visible):
        return {"show_cards": visible, "cards": []}
    cards = {card.id: card for card in db.scalars(select(ArchiveCard).where(ArchiveCard.id.in_(row.card_ids)))}
    result = []
    for card_id in row.card_ids:
        if card_id not in cards or not owns_card(db, user_id, card_id):
            continue
        card = card_payload(cards[card_id])
        if public_slug:
            card["image_url"] = f"/api/public/players/{public_slug}/archive/cards/{card_id}/image"
        result.append(card)
    return {"show_cards": visible, "cards": result}
