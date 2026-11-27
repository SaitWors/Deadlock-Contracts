"""Expire provisional Relay pilot places without losing their consent IDs."""

import sqlalchemy as sa

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "contract_relay_connections", sa.Column("auto_enrollment_expires_at", sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_column("contract_relay_connections", "auto_enrollment_expires_at")
