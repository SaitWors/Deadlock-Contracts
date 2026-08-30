"""add final GEP Evidence v9 facts

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-30

The prefixed column names intentionally avoid the unmanaged legacy
Companion evidence fields that already exist in production.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "gep_match_clock_s",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "gep_local_team",
            sa.String(length=16),
            nullable=True,
        ),
    )

    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "gep_winning_team",
            sa.String(length=16),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "companion_match_evidence",
        "gep_winning_team",
    )

    op.drop_column(
        "companion_match_evidence",
        "gep_local_team",
    )

    op.drop_column(
        "companion_match_evidence",
        "gep_match_clock_s",
    )
