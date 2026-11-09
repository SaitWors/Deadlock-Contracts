"""Completion receipts add no invented historical XP or lifecycle changes."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_completion_result_migration_preserves_legacy_cases_and_round_trips_json():
    path = Path(__file__).parents[1] / "alembic/versions/0025_case_completion_result.py"
    spec = importlib.util.spec_from_file_location("completion_result_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE contract_boards (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
        connection.exec_driver_sql("INSERT INTO contract_boards VALUES ('legacy', 'SETTLED')")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.exec_driver_sql("SELECT id, status, completion_result FROM contract_boards").one() == (
            "legacy", "SETTLED", None,
        )
        table = sa.Table("contract_boards", sa.MetaData(), autoload_with=connection)
        receipt = {"replayable": False, "tasks": [{"id": "task", "xp": 40}],
                   "progression": {"before": None, "after": {"total_xp": 300}, "levels": []}}
        connection.execute(table.update().where(table.c.id == "legacy").values(completion_result=receipt))
        assert connection.scalar(sa.select(table.c.completion_result)) == receipt
        migration.downgrade()
        assert connection.exec_driver_sql("SELECT id, status FROM contract_boards").one() == ("legacy", "SETTLED")
        assert "completion_result" not in {column["name"] for column in sa.inspect(connection).get_columns("contract_boards")}
    engine.dispose()
