from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy import pool

from app.config import settings
from app.db import Base
from app import models  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


# Importing app.models registers all ORM tables on Base.metadata.
target_metadata = Base.metadata

LEGACY_COMPANION_EVIDENCE_COLUMNS = frozenset(
    {
        "session_id",
        "start_reason",
        "is_final",
        "finalized_at",
        "duration_s",
        "started_at",
        "winning_team",
        "game_mode_raw",
        "max_match_clock_s",
        "ended_at",
        "local_team",
        "final_reason",
    }
)

LEGACY_COMPANION_EVIDENCE_INDEXES = frozenset(
    {
        "ix_companion_match_evidence_is_final",
        "ix_companion_match_evidence_session_id",
    }
)


def include_object(
    obj,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to,
) -> bool:
    """Preserve pre-Alembic Companion evidence fields as unmanaged legacy data."""

    if not reflected:
        return True

    table = getattr(obj, "table", None)
    table_name = getattr(table, "name", None)

    if table_name != "companion_match_evidence":
        return True

    if (
        type_ == "column"
        and name in LEGACY_COMPANION_EVIDENCE_COLUMNS
    ):
        return False

    if (
        type_ == "index"
        and name in LEGACY_COMPANION_EVIDENCE_INDEXES
    ):
        return False

    return True


def run_migrations_offline() -> None:
    """Render migrations without opening a database connection."""

    context.configure(
        include_object=include_object,
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against the configured database."""

    connectable = create_engine(
        settings.database_url,
        poolclass=pool.NullPool,
    )

    try:
        with connectable.connect() as connection:
            context.configure(
                include_object=include_object,
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()