"""Resolve combat rules without requiring a second artwork collection."""
from sqlalchemy import select

from ..battle_models import BattleArtwork, BattleDefinitionVersion
from .card_battle import HEROES, RANKS


def definitions_for_cards(db, cards):
    cards = {card.id: card for card in cards if card is not None}
    if not cards:
        return {}
    links = {link.card_id: link for link in db.scalars(select(BattleArtwork).where(BattleArtwork.card_id.in_(cards)))}
    definitions = list(db.scalars(select(BattleDefinitionVersion).where(
        BattleDefinitionVersion.id.in_([link.definition_id for link in links.values()])
        | ((BattleDefinitionVersion.key.in_({card.hero for card in cards.values()}))
           & BattleDefinitionVersion.approved.is_(True) & (BattleDefinitionVersion.category == "HERO"))
    ).order_by(BattleDefinitionVersion.version.desc(), BattleDefinitionVersion.id)))
    by_id = {definition.id: definition for definition in definitions}
    defaults = {}
    for definition in definitions:
        if definition.approved and definition.category == "HERO" and definition.key in HEROES:
            defaults.setdefault(definition.key, definition)
    result = {}
    for card in cards.values():
        link = links.get(card.id)
        # Explicit approvals, revocations and chosen historical versions win.
        definition = by_id.get(link.definition_id) if link and link.approved else None
        if link is None and card.status in {"PUBLISHED", "ARCHIVED"} and card.rank in RANKS and card.hero in HEROES:
            definition = defaults.get(card.hero)
        if (definition and definition.approved and definition.key == card.hero
                and ((definition.category == "HERO" and card.hero in HEROES and card.rank in RANKS)
                     or (definition.category == "BASE" and card.rank == "EX"))):
            result[card.id] = definition
    return result
