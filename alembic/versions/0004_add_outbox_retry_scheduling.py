"""add outbox retry scheduling

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-20 20:47:04.339445

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column(
        "outbox_events",
        sa.Column(
            "run_after",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "outbox_events",
        sa.Column(
            "dead_lettered_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.execute(
        """
        UPDATE outbox_events
        SET run_after = created_at
        WHERE run_after IS NULL
        """
    )

    op.alter_column(
        "outbox_events",
        "run_after",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )

    op.create_index(
        "ix_outbox_events_run_after",
        "outbox_events",
        ["run_after"],
        unique=False,
    )
    op.create_index(
        "ix_outbox_events_dead_lettered_at",
        "outbox_events",
        ["dead_lettered_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_outbox_events_dead_lettered_at",
        table_name="outbox_events",
    )
    op.drop_index(
        "ix_outbox_events_run_after",
        table_name="outbox_events",
    )
    op.drop_column("outbox_events", "dead_lettered_at")
    op.drop_column("outbox_events", "run_after")