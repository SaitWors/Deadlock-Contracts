"""Retire untouched PR50 geometry without rewriting any collection history.

Revision ID: 0023
Revises: 0022

The release fingerprints are intentionally frozen here. Do not import today's
catalogue, rules or startup repair into a historical migration.
"""
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

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


def _pristine(card):
    fingerprint = _FINGERPRINTS[card["id"]]
    expected = {**_DEFAULTS, **{key: fingerprint[key] for key in ("hero", "rank", "title", "image_digest")}}
    if any(card[key] != expected_value for key, expected_value in expected.items()):
        return False
    created = card["created_at"]
    if created is None or created != card["updated_at"] or created != card["published_at"]:
        return False
    artwork = card["image_data"]
    return bool(artwork and sha256(artwork).hexdigest() == fingerprint["image_digest"])


def upgrade():
    bind = op.get_bind()
    # Reflect the existing storage only; this revision adds no schema or rows.
    metadata = sa.MetaData()
    cards = sa.Table("archive_cards", metadata, autoload_with=bind)
    links = sa.Table("battle_artworks", metadata, autoload_with=bind)
    definitions = sa.Table("battle_definition_versions", metadata, autoload_with=bind)
    audit = sa.Table("audit_logs", metadata, autoload_with=bind)
    statement = sa.select(cards, links.c.definition_id, definitions.c.key.label("definition_key"),
                          definitions.c.category.label("definition_category")).join(
        links, links.c.card_id == cards.c.id).join(definitions, definitions.c.id == links.c.definition_id).where(
        cards.c.id.in_(_FINGERPRINTS), cards.c.status == "PUBLISHED", links.c.approved.is_(True),
        definitions.c.approved.is_(True), definitions.c.version == 1).order_by(cards.c.id).with_for_update()
    candidates = list(bind.execute(statement).mappings())
    if not candidates:
        return
    curated = set(bind.scalars(sa.select(audit.c.entity_id).where(
        audit.c.entity_id.in_([card["id"] for card in candidates]),
        sa.or_(audit.c.action.startswith("archive_card."), audit.c.action == "arena.artwork_approval"))))
    identifiers = []
    for card in candidates:
        fingerprint = _FINGERPRINTS[card["id"]]
        if (card["id"] not in curated and _pristine(card)
                and card["definition_id"] == fingerprint["definition_id"]
                and card["definition_key"] == fingerprint["hero"]
                and card["definition_category"] == fingerprint["category"]):
            identifiers.append(card["id"])
    if identifiers:
        # Keep the original bytes, revision and timestamps for history and for
        # recognizing these exact placeholders in future presentation/pool code.
        bind.execute(cards.update().where(cards.c.id.in_(identifiers)).values(status="ARCHIVED"))


def downgrade():
    # A data-only retirement must never resurrect the accidental public release.
    pass
