from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from . import models  # noqa: F401
from .db import Base, engine


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config() -> Config:
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(PROJECT_ROOT / "alembic"),
    )
    return config


def main() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError(
            "Production migration runner requires PostgreSQL"
        )

    tables = set(inspect(engine).get_table_names())
    config = _alembic_config()

    # Brand-new database: current ORM metadata is already equivalent
    # to Alembic head, so create it once and register the head revision.
    if not tables:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")
        print("Database initialized and stamped at Alembic head")
        return

    # Never guess the revision of an existing legacy database.
    if "alembic_version" not in tables:
        raise RuntimeError(
            "Existing database has no Alembic revision. "
            "Explicit legacy adoption is required before startup."
        )

    command.upgrade(config, "head")
    print("Database upgraded to Alembic head")


if __name__ == "__main__":
    main()
