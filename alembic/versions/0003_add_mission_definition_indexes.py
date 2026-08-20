"""add mission definition indexes

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-20 20:21:30.595933

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = (
    ("ix_mission_definitions_category", "category"),
    ("ix_mission_definitions_difficulty", "difficulty"),
    ("ix_mission_definitions_game_match_mode", "game_match_mode"),
    ("ix_mission_definitions_rarity", "rarity"),
)


def upgrade() -> None:
    for index_name, column_name in INDEXES:
        op.create_index(
            index_name,
            "mission_definitions",
            [column_name],
            unique=False,
            if_not_exists=True,
        )


def downgrade() -> None:
    for index_name, _ in reversed(INDEXES):
        op.drop_index(
            index_name,
            table_name="mission_definitions",
            if_exists=True,
        )