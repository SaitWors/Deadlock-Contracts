"""Preserve explicit Relay opt-outs across incoming Steam requests."""

import sqlalchemy as sa

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("relay_auto_enrollment_blocked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade():
    op.drop_column("users", "relay_auto_enrollment_blocked")
