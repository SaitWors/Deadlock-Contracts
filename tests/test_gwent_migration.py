"""The turn journal migration expands constraints without losing old actions."""
import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError


def test_upgrade_preserves_legacy_turns_and_refuses_lossy_downgrade():
    path = Path(__file__).parents[1] / "alembic/versions/0024_gwent_turn_journal.py"
    spec = importlib.util.spec_from_file_location("gwent_turn_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE battle_actions (id TEXT PRIMARY KEY, round INTEGER NOT NULL, CONSTRAINT ck_battle_actions_0 CHECK (round BETWEEN 1 AND 12))")
        connection.exec_driver_sql("INSERT INTO battle_actions VALUES ('legacy', 12)")
        with pytest.raises(IntegrityError):
            connection.exec_driver_sql("INSERT INTO battle_actions VALUES ('new', 21)")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.exec_driver_sql("INSERT INTO battle_actions VALUES ('new', 21)")
        assert connection.exec_driver_sql("SELECT id, round FROM battle_actions ORDER BY id").all() == [("legacy", 12), ("new", 21)]
        with pytest.raises(RuntimeError, match="history"):
            migration.downgrade()
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM battle_actions").scalar() == 2
        connection.exec_driver_sql("DELETE FROM battle_actions WHERE id = 'new'")
        migration.downgrade()
        with pytest.raises(IntegrityError):
            connection.exec_driver_sql("INSERT INTO battle_actions VALUES ('invalid', 13)")
        assert connection.exec_driver_sql("SELECT round FROM battle_actions").scalar() == 12
    engine.dispose()
