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


def run_migrations_offline() -> None:
    """Render migrations without opening a database connection."""

    context.configure(
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