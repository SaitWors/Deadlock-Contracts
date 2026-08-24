"""add Companion pairing and heartbeat idempotency

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "companion_pairings",
        sa.Column("claimed_device_id", sa.String(length=120), nullable=True),
    )

    # A legacy race could leave more than one unclaimed code for one user.
    # Preserve only the newest row before enforcing one active pairing record.
    op.execute(
        """
        DELETE FROM companion_pairings
        WHERE code_hash IN (
            SELECT code_hash
            FROM (
                SELECT
                    code_hash,
                    row_number() OVER (
                        PARTITION BY user_id
                        ORDER BY created_at DESC, code_hash DESC
                    ) AS row_number
                FROM companion_pairings
            ) AS ranked
            WHERE ranked.row_number > 1
        )
        """
    )
    op.create_unique_constraint(
        "uq_companion_pairing_user",
        "companion_pairings",
        ["user_id"],
    )

    op.add_column(
        "companion_events",
        sa.Column("client_event_id", sa.String(length=80), nullable=True),
    )
    op.create_unique_constraint(
        "uq_companion_event_device_client",
        "companion_events",
        ["device_id", "client_event_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_companion_event_device_client",
        "companion_events",
        type_="unique",
    )
    op.drop_column("companion_events", "client_event_id")
    op.drop_constraint(
        "uq_companion_pairing_user",
        "companion_pairings",
        type_="unique",
    )
    op.drop_column("companion_pairings", "claimed_device_id")
