"""Versioned pack rules, immutable receipts and a privately owned card inventory."""
from __future__ import annotations

import hashlib
import json
import secrets
from collections import Counter
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import Integer, func, select
from sqlalchemy.orm import undefer

from ..models import (ArchiveCard, ArchiveFavorite, ArchiveItem, ArchiveLedger, ArchiveOperation, ArchivePack,
                      ArchivePackVersion, ArchiveShowcase, AuditLog, PublicProfile)
from .archive import ECONOMY_SCOPES, HEROES, MAX_BALANCE, RANKS, aware, battle_metadata, card_payload, lock_user, wallet_state
from . import pack_rules

# Internal collection balance, not a cash value or an external market estimate.
DIRECT_COST = {**dict(zip(pack_rules.RANKS, (25, 40, 70, 120, 220, 380, 700, 1300, 2600))), "EX": 1800}
DEFAULT_WEIGHTS = dict(zip(pack_rules.RANKS, (2000, 1600, 1200, 900, 600, 350, 150, 60, 15)))
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
    statement = select(ArchiveCard).options(undefer(ArchiveCard.image_data)).where(
        ArchiveCard.id.in_([entry["card_id"] for entry in entries])).order_by(ArchiveCard.id)
    if lock:
        statement = statement.with_for_update(read=True).execution_options(populate_existing=True)
    return {card.id: card for card in db.scalars(statement)}


def collectible_pack_card(card):
    from .arena_catalog_repair import is_pristine_arena_card
    return bool(card.status == "PUBLISHED" and card.hero in HEROES and card.rank in RANKS
                and card.image_digest and card.image_data and not is_pristine_arena_card(card))


def ready_pool(entries, cards):
    return bool(entries) and all(entry["card_id"] in cards and collectible_pack_card(cards[entry["card_id"]])
                                 for entry in entries)


def ready_v2_pool(db, entries, cards, *, lock=False):
    if not entries or not ready_pool(entries, cards) or {entry["rank"] for entry in entries} != set(pack_rules.RANKS):
        return False
    groups = {}
    for entry in entries:
        card = cards[entry["card_id"]]
        if (card.rank != entry["rank"] or card.hero != entry["hero"]
                or type(entry["weight"]) is not int or not 1 <= entry["weight"] <= 10000):
            return False
        variant = (entry["rank"], entry["hero"])
        if groups.setdefault(variant, entry["weight"]) != entry["weight"]:
            return False
    return True


def configuration(db, payload):
    entries = [{"card_id": str(entry.card_id), "weight": entry.weight} for entry in payload.entries]
    cards = cards_for_pool(db, entries, lock=True)
    if not ready_pool(entries, cards):
        raise HTTPException(422, "В состав можно включить только опубликованные карточки с изображением / Published artwork required")
    for entry in entries:
        entry["rank"] = cards[entry["card_id"]].rank
    if any(entry["rank"] == "EX" for entry in entries):
        raise HTTPException(422, "EX не входит в обычные конверты / EX bases are excluded from ordinary packs")
    kind = getattr(payload, "kind", "LEGACY")
    if kind in pack_rules.PRESETS:
        preset = pack_rules.PRESETS[kind]
        if payload.price != preset["price"] or payload.draws != len(preset["slots"]) or payload.starter:
            raise HTTPException(422, "Цена и слоты версии 2 фиксированы / Typed pack price and slots are fixed")
        for entry in entries:
            entry["hero"] = cards[entry["card_id"]].hero
        if not ready_v2_pool(db, entries, cards, lock=True):
            raise HTTPException(422, "Нужны опубликованные варианты всех рангов с единым весом героя / All collectible hero ranks required")
        return {"title": payload.title, "description": payload.description, "price": payload.price,
                "draws": payload.draws, "entries": entries, "price_model": 3, "kind": kind,
                "rule_version": pack_rules.RULE_VERSION, "slots": list(preset["slots"])}
    return {"title": payload.title, "description": payload.description, "price": payload.price,
            "draws": payload.draws, "entries": entries, "price_model": PRICE_MODEL}


def v2_recommendation(config):
    value = sum(sum(DIRECT_COST[row["rank"]] * row["weight"] for row in pack_rules.slot_odds(slot)) / 10000
                for slot in config["slots"])
    return {"price": config["price"], "model": 3, "discount_percent": round((1 - config["price"] / value) * 100, 2),
            "expected_direct_cost": round(value, 2), "guarantees_included": False,
            "weeks_at_150": round(config["price"] / 150, 2), "weeks_at_330": round(config["price"] / 330, 2),
            "weeks_at_610": round(config["price"] / 610, 2), "weeks_at_840": round(config["price"] / 840, 2),
            "direct_costs": DIRECT_COST}


def guarantee_state(db, user_id, scope, *, lock=False):
    from ..pack_models import PackGuaranteeState
    if user_id is None:
        return None
    statement = select(PackGuaranteeState).where(PackGuaranteeState.user_id == user_id, PackGuaranteeState.scope == scope)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return db.scalar(statement)


def guarantee_payload(state, scope, first_slot="ORDINARY"):
    counters = {key: getattr(state, key, 0) for key in pack_rules.THRESHOLDS}
    minimum = pack_rules.minimum_rank(counters)
    return {"scope": scope, "revision": getattr(state, "revision", 0), **counters,
            "thresholds": {"a": 30, "s": 120, "sss": 360}, "next_minimum_rank": minimum,
            "next_slot_odds": pack_rules.slot_odds(first_slot, minimum)}


def pack_version(db, pack):
    return db.scalar(select(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id,
                                                    ArchivePackVersion.revision == pack.revision))


def pack_payload(db, pack, *, detailed=False, version=None, user_id=None, scope="REAL"):
    version = version or pack_version(db, pack)
    config = version.config
    cards = cards_for_pool(db, config["entries"])
    metadata = battle_metadata(db, cards.values())
    is_v2 = config.get("rule_version") == pack_rules.RULE_VERSION
    ready = bool(ready_v2_pool(db, config["entries"], cards) if is_v2 else ready_pool(config["entries"], cards))
    cover = next((card for card in cards.values() if card.status == "PUBLISHED"), None)
    result = {"id": pack.id, "revision": pack.revision, "active": pack.active, "starter": pack.starter,
              "title": config["title"], "description": config["description"], "price": config["price"],
              "draws": config["draws"], "card_count": len(config["entries"]), "ready": ready,
              "odds": pack_rules.slot_odds("ORDINARY") if is_v2 else rank_odds(config["entries"]),
              "recommendation": v2_recommendation(config) if is_v2 else recommendation(config["entries"], config["draws"]),
              "kind": config.get("kind", "LEGACY"),
              "cover": card_payload(cover, battle=metadata.get(cover.id)) if cover else None}
    if is_v2:
        result.update(rule_version=pack_rules.RULE_VERSION,
                      slots=[{"kind": slot, "odds": pack_rules.slot_odds(slot)} for slot in config["slots"]],
                      guarantees=guarantee_payload(guarantee_state(db, user_id, scope), scope, config["slots"][0]))
    if detailed:
        total = sum(entry["weight"] for entry in config["entries"])
        variants = {(entry["rank"], entry.get("hero")): entry["weight"] for entry in config["entries"]}
        def percent(entry):
            if not is_v2:
                return round(entry["weight"] * 100 / total, 4)
            probability = next(row["percent"] for row in pack_rules.slot_odds("ORDINARY") if row["rank"] == entry["rank"])
            variant_total = sum(weight for (rank, _), weight in variants.items() if rank == entry["rank"])
            artworks = sum(other["rank"] == entry["rank"] and other["hero"] == entry["hero"] for other in config["entries"])
            return round(probability * entry["weight"] / variant_total / artworks, 6)
        result["entries"] = [{**entry, "percent": percent(entry),
                              "card": card_payload(cards[entry["card_id"]], battle=metadata.get(entry["card_id"])) if entry["card_id"] in cards else None}
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
    metadata = battle_metadata(db, cards)
    basis, remainder = divmod(paid, len(cards))
    test = operation.scope == "SANDBOX"
    for i, card in enumerate(cards):
        item = ArchiveItem(user_id=operation.user_id, card_id=card.id, operation_id=operation.id,
                           cost_basis=basis + (i < remainder), test_grant=test, scope=operation.scope)
        db.add(item)
        db.flush()
        results.append({"id": item.id, "card": card_payload(card, battle=metadata.get(card.id)), "duplicate": card.id in existing,
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
    inputs = {"pack_id": pack_id, "revision": payload.revision}
    if getattr(payload, "guarantee_revision", None) is not None:
        inputs["guarantee_revision"] = payload.guarantee_revision
    operation, replay = begin(db, user_id, kind, payload.request_key,
                              inputs, scope=payload.scope)
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
    if config.get("rule_version") == pack_rules.RULE_VERSION:
        return open_v2(db, operation, pack, version, cards, payload)
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


def open_v2(db, operation, pack, version, cards, payload):
    from ..pack_models import PackGuaranteeState
    config = version.config
    if payload.starter or not ready_v2_pool(db, config["entries"], cards, lock=True):
        raise HTTPException(409, "Не все обещанные ранги доступны / Promised pack ranks unavailable")
    if wallet_state(db, operation.user_id, operation.scope)["available_balance"] < config["price"]:
        raise HTTPException(409, "Недостаточно жетонов / Not enough tokens")
    state = guarantee_state(db, operation.user_id, operation.scope, lock=True)
    before = guarantee_payload(state, operation.scope, config["slots"][0])
    if getattr(payload, "guarantee_revision", None) != before["revision"]:
        raise HTTPException(409, "Гарантии изменились. Обновите конверт / Guarantees changed; refresh before paying")
    if state is None:
        state = PackGuaranteeState(user_id=operation.user_id, scope=operation.scope, without_a=0, without_s=0,
                                   without_sss=0, revision=0)
        db.add(state)
    counters = {key: before[key] for key in pack_rules.THRESHOLDS}
    draws = []
    selected = []
    for slot in config["slots"]:
        draw, counters = pack_rules.draw_slot(slot, counters, secrets.randbelow)
        selected.append(cards[pack_rules.choose_artwork(config["entries"], draw["rank"], secrets.randbelow)])
        draws.append(draw)
    for key, value in counters.items():
        setattr(state, key, value)
    state.revision += 1
    operation.pack_version_id = version.id
    result = issue(db, operation, selected, config["price"])
    result = [{**item, **draw} for item, draw in zip(result, draws)]
    return finish(db, operation, delta=-config["price"], items=result, extra={"pack": {
        "id": pack.id, "title": config["title"], "revision": pack.revision, "price": config["price"],
        "version_id": version.id,
        "draws": config["draws"], "kind": config["kind"], "rule_version": pack_rules.RULE_VERSION,
        "odds": pack_rules.slot_odds("ORDINARY"),
        "slots": [{"kind": slot, "odds": pack_rules.slot_odds(slot)} for slot in config["slots"]],
        "guarantee_before": before, "guarantee_after": guarantee_payload(state, operation.scope, config["slots"][0])}})


def _preset_config(kind, entries):
    preset = pack_rules.PRESETS[kind]
    return {"kind": kind, "rule_version": pack_rules.RULE_VERSION, "price_model": 3,
            "title": preset["title"], "description": "Оплаченные карты с общими гарантиями / Paid cards with shared guarantees",
            "price": preset["price"], "draws": len(preset["slots"]), "slots": list(preset["slots"]), "entries": entries}


def _pristine_synthetic_preset(db, pack, version, kind):
    """Recognize only the exact shipped preset, leaving curator decisions alone."""
    from .battle_catalog import card_id
    if (pack.creator_id is not None or not pack.active or pack.starter or pack.revision != 1
            or version is None or version.id != str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2-version:" + kind))):
        return False
    # Freeze the released roster: later battle rule additions are not old seed entries.
    heroes = ("abrams", "bebop", "dynamo", "haze", "ivy", "kelvin", "seven", "infernus", "wraith", "mcginnis", "lady-geist", "venator")
    entries = [{"card_id": card_id(hero, rank), "hero": hero, "rank": rank, "weight": 1}
               for rank in RANKS for hero in heroes]
    entries.sort(key=lambda entry: (entry["rank"], entry["hero"], entry["card_id"]))
    if version.config != _preset_config(kind, entries):
        return False
    if db.scalar(select(func.count()).select_from(ArchivePackVersion).where(ArchivePackVersion.pack_id == pack.id)) != 1:
        return False
    return db.scalar(select(AuditLog.id).where(AuditLog.entity_id == pack.id,
        AuditLog.action.in_(("archive.pack_created", "archive.pack_updated", "archive.pack_paused"))).limit(1)) is None


def seed_pack_v2(db):
    """Seed original collection pools; append repairs only to untouched system presets."""
    from sqlalchemy.dialects.postgresql import insert as postgresql_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    dialect = db.get_bind().dialect.name
    insert = {"postgresql": postgresql_insert, "sqlite": sqlite_insert}.get(dialect)
    if insert is None:
        raise RuntimeError(f"Pack seeding does not support {dialect}")
    rows = db.scalars(select(ArchiveCard).options(undefer(ArchiveCard.image_data)).where(
        ArchiveCard.status == "PUBLISHED", ArchiveCard.rank.in_(pack_rules.RANKS), ArchiveCard.hero.in_(HEROES),
        ArchiveCard.image_digest.is_not(None)).order_by(ArchiveCard.rank, ArchiveCard.hero, ArchiveCard.id)).all()
    entries = [{"card_id": card.id, "hero": card.hero, "rank": card.rank, "weight": 1}
               for card in rows if collectible_pack_card(card)]
    if {entry["rank"] for entry in entries} != set(pack_rules.RANKS):
        return
    for kind in pack_rules.PRESETS:
        pack_id = str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2:" + kind))
        config = _preset_config(kind, entries)
        created = db.execute(insert(ArchivePack).values(id=pack_id, revision=1, active=True, starter=False)
                             .on_conflict_do_nothing(index_elements=["id"])).rowcount
        pack = db.scalar(select(ArchivePack).where(ArchivePack.id == pack_id).with_for_update().execution_options(populate_existing=True))
        version = pack_version(db, pack)
        if created:
            db.execute(insert(ArchivePackVersion).values(id=str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2-version:" + kind)),
                       pack_id=pack_id, revision=1, config=config).on_conflict_do_nothing(index_elements=["pack_id", "revision"]))
        elif _pristine_synthetic_preset(db, pack, version, kind):
            db.execute(insert(ArchivePackVersion).values(id=str(uuid5(NAMESPACE_URL, "deadlock-contracts:pack-v2-original-art-version:" + kind)),
                       pack_id=pack_id, revision=2, config=config).on_conflict_do_nothing(index_elements=["pack_id", "revision"]))
            pack.revision = 2
            db.flush()


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
    if card.rank == "EX" and not owner:
        from .battle_service import assert_ex_purchase
        assert_ex_purchase(db, user_id, card, payload.scope)
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
    from .battle_service import is_item_reserved
    if is_item_reserved(db, item.id):
        raise HTTPException(409, "Экземпляр используется в бою / Item is reserved by a battle")
    count = db.scalar(select(func.count()).select_from(ArchiveItem).where(ArchiveItem.user_id == user_id,
                      ArchiveItem.card_id == item.card_id, ArchiveItem.state == "OWNED", ArchiveItem.scope == payload.scope))
    if count < 2:
        raise HTTPException(409, "Последний экземпляр остаётся в коллекции / Keep the last copy")
    if item.cost_basis < 5:
        raise HTTPException(409, "Бесплатный или слишком дешёвый экземпляр не даёт жетонов / This copy has no token refund")
    item.state = "RECYCLED"
    from .battle_service import invalidate_item_squads
    invalidate_item_squads(db, user_id, item.id)
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
    from ..battle_models import BattleItemReservation, BattleMatch
    reserved = select(BattleItemReservation.item_id).join(BattleMatch, BattleMatch.id == BattleItemReservation.match_id).where(
        BattleItemReservation.item_id == ArchiveItem.id, BattleMatch.status == "ACTIVE").exists()
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
    metadata = battle_metadata(db, [row[0] for row in rows])
    result = []
    for card, quantity, test_count, is_favorite in rows:
        duplicate = db.scalar(select(ArchiveItem).where(ArchiveItem.user_id == user_id, ArchiveItem.card_id == card.id,
                          ArchiveItem.state == "OWNED", ArchiveItem.cost_basis >= 5, ArchiveItem.scope == scope, ~reserved)
                          .order_by(ArchiveItem.cost_basis.desc(), ArchiveItem.id).limit(1)) if quantity > 1 else None
        result.append({"card": card_payload(card, battle=metadata.get(card.id)), "quantity": quantity, "test_count": test_count, "scope": scope,
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
