"""Attach a private Steam Quick Invite to current Relay consent."""

import sqlalchemy as sa

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("contract_relay_connections", sa.Column("quick_invite_url", sa.String(128)))
    op.add_column("contract_relay_connections", sa.Column("quick_invite_expires_at", sa.DateTime(timezone=True)))
    op.create_index("uq_relay_quick_invite_url", "contract_relay_connections", ["quick_invite_url"], unique=True)


def downgrade():
    op.drop_index("uq_relay_quick_invite_url", table_name="contract_relay_connections")
    op.drop_column("contract_relay_connections", "quick_invite_expires_at")
    op.drop_column("contract_relay_connections", "quick_invite_url")
