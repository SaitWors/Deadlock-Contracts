"""Insert-only battle rules, independent of the existing archive collection."""
from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ..battle_models import BattleDefinitionVersion
from ..models import utcnow
from .card_battle import BASES, HEROES


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, "deadlock-bureau-arena-v1:" + ":".join(parts)))


def card_id(key, rank):
    return identity("card", key, rank)


def seed_battle_catalogue(db):
    insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[db.get_bind().dialect.name]
    now = utcnow()
    definitions = []
    for key, rules in {**HEROES, **{key: value for key, value in BASES.items() if key != "ORDINARY"}}.items():
        category = "HERO" if key in HEROES else "BASE"
        definition_id = identity("definition", key)
        definitions.append(dict(id=definition_id, key=key, category=category, version=1, approved=True,
                                rules=deepcopy(rules), created_at=now))
    db.execute(insert(BattleDefinitionVersion).values(definitions).on_conflict_do_nothing(index_elements=["id"]))
    # Startup owns the transaction. Existing moderation/approval is never reset.
