"""add bilingual mission authoring fields

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("mission_definitions", sa.Column("title_en", sa.String(length=160), nullable=True))
    op.add_column("mission_definitions", sa.Column("description_en", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mission_definitions", "description_en")
    op.drop_column("mission_definitions", "title_en")
