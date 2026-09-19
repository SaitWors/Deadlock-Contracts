"""Private account favorites for owned archive card designs.

Revision ID: 0019
Revises: 0018
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("archive_favorites",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("card_id", sa.String(36), sa.ForeignKey("archive_cards.id", ondelete="CASCADE"), primary_key=True))


def downgrade():
    op.drop_table("archive_favorites")
