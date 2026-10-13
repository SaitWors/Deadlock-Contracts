"""Choose existing illustrated archive cards without creating collection art."""
from copy import deepcopy
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import undefer

from ..models import ArchiveCard
from .archive import card_payload
from .arena_catalog_repair import is_pristine_arena_card
from .battle_definitions import definitions_for_cards
from .card_battle import HEROES, RANKS, RULES

STARTER = ("abrams", "bebop", "dynamo", "haze", "ivy", "seven")


def _illustrated_cards(db, keys, *, lock=False):
    """Load artwork and authoritative approvals in three batched queries."""
    if not keys:
        return [], {}
    query = select(ArchiveCard).options(undefer(ArchiveCard.image_data)).where(
        ArchiveCard.hero.in_(keys), ArchiveCard.rank.in_([*RANKS, "EX"]),
        ArchiveCard.status == "PUBLISHED", ArchiveCard.image_digest.is_not(None),
        ArchiveCard.image_digest != "").order_by(ArchiveCard.hero, ArchiveCard.id)
    if lock:
        query = query.with_for_update(read=True).execution_options(populate_existing=True)
    cards = list(db.scalars(query))
    definitions = definitions_for_cards(db, cards)
    return [card for card in cards if card.id in definitions and card.image_data
            and not is_pristine_arena_card(card)], definitions


def _cost(card):
    return RANKS[card.rank]["cost"]


def _tie(user_id, kind, key):
    return sha256(f"battle-starter-v1:{user_id or ''}:{kind}:{key}".encode()).hexdigest()


def starter_cards(db, *, user_id=None, lock=False) -> dict[str, ArchiveCard]:
    """Return six distinct, least-cost source cards, or an empty unavailable set.

    The complete original F starter keeps its established slot order. Other
    equal-cost heroes and designs vary deterministically per player; issuing and
    replaying the immutable claim receipt remains the caller's responsibility.
    """
    cards, _ = _illustrated_cards(db, list(HEROES), lock=lock)
    cards = [card for card in cards if card.rank in RANKS]
    choices = {}
    for card in sorted(cards, key=lambda card: (_cost(card), _tie(user_id, "art", card.id), card.id)):
        choices.setdefault(card.hero, card)
    if all(key in choices and choices[key].rank == "F" for key in STARTER):
        return {key: choices[key] for key in STARTER}
    keys = sorted(choices, key=lambda key: (_cost(choices[key]), _tie(user_id, "hero", key), key))[:6]
    selected = {key: choices[key] for key in keys}
    if (len(selected) != 6 or sum(_cost(card) for card in selected.values()) > RULES["budget"]
            or sum(card.rank == "SSS" for card in selected.values()) > 2):
        return {}
    return selected


def decorate_rules(db, rules) -> dict:
    """Copy catalogue rules and attach only published same-hero source artwork."""
    result = deepcopy(rules)
    for group in ("heroes", "bases"):
        for definition in result.get(group, {}).values():
            definition.pop("image_url", None)
            definition.pop("card", None)
    cards, definitions = _illustrated_cards(db, [*result.get("heroes", {}), *result.get("bases", {})])
    for card in sorted(cards, key=lambda card: (0 if card.rank == "EX" else _cost(card), card.id)):
        group = "bases" if card.rank == "EX" else "heroes"
        hero = result.get(group, {}).get(card.hero)
        if hero is None or hero.get("image_url"):
            continue
        definition = definitions[card.id]
        payload = card_payload(card, battle={"category": definition.category, "battle_eligible": True,
            "definition_key": definition.key, "definition_id": definition.id, "definition_version": definition.version})
        hero.update(image_url=payload["image_url"], card=payload)
    return result
