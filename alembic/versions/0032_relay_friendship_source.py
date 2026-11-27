"""Preserve the source of automatic and manual Relay observations."""

import sqlalchemy as sa
from alembic import op


revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("relay_friendships", sa.Column("source", sa.String(16), nullable=False, server_default="manual"))


def downgrade():
    op.drop_column("relay_friendships", "source")
