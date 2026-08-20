"""add contract board baseline match id

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-20 18:59:36.246427

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add match baseline used when a contract board is locked."""
    op.add_column(
        "contract_boards",
        sa.Column(
            "baseline_match_id",
            sa.BigInteger(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Remove the contract-board match baseline."""
    op.drop_column(
        "contract_boards",
        "baseline_match_id",
    )