"""Insert-only original symbolic art and separately approved rules definitions."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ..battle_models import BattleArtwork, BattleDefinitionVersion
from ..models import ArchiveCard, utcnow
from .card_battle import BASES, HEROES, RANKS

ASSETS = Path(__file__).resolve().parents[1] / "data/archive/bureau-arena"


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:" + ":".join(parts)))


def card_id(key, rank):
    return identity("card", key, rank)


def seed_battle_catalogue(db):
    insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[db.get_bind().dialect.name]
    now = utcnow()
    definitions, cards, links = [], [], []
    for key, rules in {**HEROES, **{key: value for key, value in BASES.items() if key != "ORDINARY"}}.items():
        category = "HERO" if key in HEROES else "BASE"
        definition_id = identity("definition", key)
        definitions.append(dict(id=definition_id, key=key, category=category, version=1, approved=True,
                                rules=deepcopy(rules), created_at=now))
        artwork = (ASSETS / f"{key}.webp").read_bytes()
        name = rules["name"] if category == "HERO" else rules["name"]["en"]
        for rank in RANKS if category == "HERO" else ("EX",):
            identifier = card_id(key, rank)
            cards.append(dict(id=identifier, hero=key, rank=rank, title=f"Bureau Arena · {name}"[:80],
                description="Оригинальная символическая иллюстрация / Original symbolic artwork",
                artist="Bureau Arena", source_url="", rights_confirmed=False,
                image_data=artwork, image_digest=sha256(artwork).hexdigest(), status="PUBLISHED",
                revision=1, created_at=now, updated_at=now, published_at=now))
            links.append(dict(card_id=identifier, definition_id=definition_id, approved=True))
    for model, rows, keys in ((BattleDefinitionVersion, definitions, ["id"]), (ArchiveCard, cards, ["id"]),
                              (BattleArtwork, links, ["card_id"])):
        db.execute(insert(model).values(rows).on_conflict_do_nothing(index_elements=keys))
    # Startup owns the transaction. Existing moderation/approval is never reset.
