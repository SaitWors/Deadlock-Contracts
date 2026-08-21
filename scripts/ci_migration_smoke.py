from __future__ import annotations

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from app.db import engine


def current_revision() -> str:
    with engine.connect() as connection:
        revision = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()

    return str(revision)


def main() -> None:
    config = Config("alembic.ini")
    scripts = ScriptDirectory.from_config(config)

    heads = scripts.get_heads()
    if len(heads) != 1:
        raise RuntimeError(
            f"Expected exactly one Alembic head, got: {heads}"
        )

    head = heads[0]
    revision = scripts.get_revision(head)

    if revision is None:
        raise RuntimeError(f"Alembic head {head!r} not found")

    parent = revision.down_revision
    if not isinstance(parent, str):
        raise RuntimeError(
            f"Latest migration must have one parent, got: {parent!r}"
        )

    before = current_revision()
    if before != head:
        raise RuntimeError(
            f"Database must begin at head {head}, got {before}"
        )

    print(f"Downgrade smoke: {head} -> {parent}")
    command.downgrade(config, parent)

    downgraded = current_revision()
    if downgraded != parent:
        raise RuntimeError(
            f"Expected revision {parent}, got {downgraded}"
        )

    print(f"Upgrade smoke: {parent} -> {head}")
    command.upgrade(config, "head")

    upgraded = current_revision()
    if upgraded != head:
        raise RuntimeError(
            f"Expected revision {head}, got {upgraded}"
        )

    command.check(config)

    print(
        f"Migration smoke OK: "
        f"{head} -> {parent} -> {head}"
    )


if __name__ == "__main__":
    main()