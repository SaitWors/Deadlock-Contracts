"""Retire only the untouched geometry release; never rewrite owned instances.

These fingerprints describe the accidental PR50 release, not today's roster.
Keep them frozen so later rules or artwork releases cannot broaden this repair.
"""
from collections.abc import Mapping
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import or_, select, update

from ..battle_models import BattleArtwork, BattleDefinitionVersion
from ..models import ArchiveCard, AuditLog

_RANKS = ("F", "E", "D", "C", "B", "A", "S", "SS", "SSS")
_ARTWORK = {
    "abrams": ("Abrams", "250e40a85db1ab97e2df8f4660be31b58a90a3ec512eb7fe058e4b855fb601fd"),
    "bebop": ("Bebop", "0c969c3e11a67434043ff92455796686329ac3e39b09a81fd2e9e73ac6ba80a8"),
    "dynamo": ("Dynamo", "9439989c8b3d07aa1a739fa035d01923ccff06a9a093c8bb90cea5a336d42571"),
    "haze": ("Haze", "e67262bc46e9e4b20a375e2daea10905fd048ba14a77fbfd876eaf5b20ffaf40"),
    "ivy": ("Ivy", "1dedfad388f99e19e1806f417af2da3df2c69bd93ca0f5cb7aaf379dc0f1796b"),
    "kelvin": ("Kelvin", "e8593f1dca9de18b05090712c49bfab1d5973ab6199d3d9a02782bdd9ed40899"),
    "seven": ("Seven", "ff1588c59170fed753eeb705323c8d837c61fb1e6195915b9f8e7ff3025e0128"),
    "infernus": ("Infernus", "381f297ff6b1695af835618e0136ec19cf8a5a74c4ea51bc0433c70873812d72"),
    "wraith": ("Wraith", "8569cb6286af2b14d7ff71c476047e406618d75e6a0eaae3f59e104edfbd947f"),
    "mcginnis": ("McGinnis", "4380317504e2f9910dec684ef887fea7824fdd1db989ee84d27878d9c64ae356"),
    "lady-geist": ("Lady Geist", "036cd28a49d3a629bde991747d431d876432ca51c50e23beadab4dc662419fd5"),
    "venator": ("Venator", "2fcf7c811d74867ff304a92c3877b3affc8001c64db5b41c9171e8eb618f1402"),
    "HIDDEN_KING": ("Hidden King: Court of Shadows", "43708bd4034508da40c10002a28ababc104bab19dfb07579d60988f323054a7c"),
    "ARCHMOTHER": ("Archmother: Glass Cathedral", "f1525eab3990b0466dded71029a214457bfe4e34ae1f1089779cc16b122781f7"),
}


def _identity(*parts):
    return str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:" + ":".join(parts)))


_FINGERPRINTS = {
    _identity("card", hero, rank): {
        "hero": hero, "rank": rank, "title": f"Bureau Arena · {name}", "image_digest": digest,
        "definition_id": _identity("definition", hero), "category": "BASE" if rank == "EX" else "HERO",
    }
    for hero, (name, digest) in _ARTWORK.items()
    for rank in (("EX",) if hero in {"HIDDEN_KING", "ARCHMOTHER"} else _RANKS)
}
_DEFAULTS = {
    "creator_id": None, "description": "Оригинальная символическая иллюстрация / Original symbolic artwork",
    "artist": "Bureau Arena", "source_url": "", "rights_confirmed": False,
    "crop_x": 50, "crop_y": 50, "zoom": 1.0, "frame_version": 1, "revision": 1,
    "review_note": "", "reviewed_by": None, "submitted_at": None,
}


def is_pristine_arena_card(card):
    """Recognize original bytes/metadata, including a status-only retired seed.

    Publication and battle approval are checked separately by the caller. An ID,
    title or stale cached digest alone must never identify curator artwork.
    """
    value = card.get if isinstance(card, Mapping) else lambda key: getattr(card, key, None)
    fingerprint = _FINGERPRINTS.get(str(value("id")))
    if not fingerprint or value("status") not in {"PUBLISHED", "ARCHIVED"}:
        return False
    expected = {**_DEFAULTS, **{key: fingerprint[key] for key in ("hero", "rank", "title", "image_digest")}}
    if any(value(key) != expected_value for key, expected_value in expected.items()):
        return False
    created = value("created_at")
    if created is None or created != value("updated_at") or created != value("published_at"):
        return False
    artwork = value("image_data")
    return bool(artwork and sha256(artwork).hexdigest() == fingerprint["image_digest"])


def retire_arena_placeholders(db):
    """Soft-archive pristine release rows in the caller's transaction, once.

    A matching approved original link and no moderation/approval audit are also
    required. Stored images, revisions, timestamps and every dependent row stay
    unchanged; owned instances remain usable and receipts keep their identities.
    """
    cards = ArchiveCard.__table__
    links = BattleArtwork.__table__
    definitions = BattleDefinitionVersion.__table__
    statement = select(cards, links.c.definition_id, definitions.c.key.label("definition_key"),
                       definitions.c.category.label("definition_category")).join(
        links, links.c.card_id == cards.c.id).join(definitions, definitions.c.id == links.c.definition_id).where(
        cards.c.id.in_(_FINGERPRINTS), cards.c.status == "PUBLISHED", links.c.approved.is_(True),
        definitions.c.approved.is_(True), definitions.c.version == 1).order_by(cards.c.id).with_for_update()
    with db.no_autoflush:
        candidates = list(db.execute(statement).mappings())
        if not candidates:
            return 0
        # Read after the card locks: a competing curator command can have logged
        # a no-op approval while this startup was waiting for its transaction.
        curated = set(db.scalars(select(AuditLog.entity_id).where(
            AuditLog.entity_id.in_([card["id"] for card in candidates]),
            or_(AuditLog.action.startswith("archive_card."), AuditLog.action == "arena.artwork_approval"))))
        identifiers = []
        for card in candidates:
            fingerprint = _FINGERPRINTS[card["id"]]
            if (card["id"] not in curated and is_pristine_arena_card(card)
                    and card["definition_id"] == fingerprint["definition_id"]
                    and card["definition_key"] == fingerprint["hero"]
                    and card["definition_category"] == fingerprint["category"]):
                identifiers.append(card["id"])
        if not identifiers:
            return 0
        db.execute(update(ArchiveCard).where(ArchiveCard.id.in_(identifiers)).values(
            status="ARCHIVED", updated_at=ArchiveCard.updated_at).execution_options(synchronize_session="fetch"))
        return len(identifiers)
