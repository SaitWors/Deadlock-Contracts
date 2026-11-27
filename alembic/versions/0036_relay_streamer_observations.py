"""Snapshot Relay scheduler class on newly observed matches."""

import sqlalchemy as sa

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("relay_match_observations", sa.Column("priority_streamer", sa.Boolean()))


def downgrade():
    op.drop_column("relay_match_observations", "priority_streamer")
