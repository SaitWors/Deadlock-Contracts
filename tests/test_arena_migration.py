"""The arena migration is additive and matches the current ORM schema."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.db import Base
from app import models  # noqa: F401


def test_arena_migration_round_trip_preserves_existing_money_and_receipts():
    module_path = Path(__file__).parents[1] / "alembic/versions/0022_bureau_arena.py"
    specification = importlib.util.spec_from_file_location("arena_migration", module_path)
    migration = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    fresh = lambda name: name.startswith(("battle_", "economy_")) or name == "pack_guarantee_states"
    existing_tables = [table for table in Base.metadata.sorted_tables if not fresh(table.name)]
    Base.metadata.create_all(engine, tables=existing_tables)
    with engine.begin() as connection:
        users, ledger = Base.metadata.tables["users"], Base.metadata.tables["archive_ledger"]
        operations = Base.metadata.tables["archive_operations"]
        connection.execute(users.insert().values(id="preserved", display_name="Existing player"))
        connection.execute(ledger.insert().values(id="money", user_id="preserved", source="cipher:preserved",
                                                  reason="CIPHER", delta=150, scope="REAL"))
        receipt = {"items": [{"id": "old-card"}], "balance_after": 150}
        connection.execute(operations.insert().values(id="operation", user_id="preserved", request_key="old-key",
            signature="old-hash", kind="DIRECT_CARD", scope="REAL", result=receipt))
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.upgrade()
            assert compare_metadata(context, Base.metadata) == []
            migration.downgrade()
            assert not any(fresh(name) for name in sa.inspect(connection).get_table_names())
            migration.upgrade()
            assert compare_metadata(context, Base.metadata) == []
        assert connection.scalar(sa.select(sa.func.sum(ledger.c.delta))) == 150
        assert connection.scalar(sa.select(operations.c.result)) == receipt
    engine.dispose()
