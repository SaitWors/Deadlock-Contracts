"""Persist Relay service credentials and bounded node observations."""

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "relay_nodes",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("token_hash", sa.String(64)),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("friendship_writes", sa.Boolean(), nullable=False),
        sa.Column("last_observed_at", sa.DateTime(timezone=True)),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("last_successful_cycle_at", sa.DateTime(timezone=True)),
        sa.Column("agent_version", sa.String(32)),
        sa.Column("ingest", sa.JSON()),
    )
    op.create_table(
        "relay_heartbeats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("node_id", sa.String(32), sa.ForeignKey("relay_nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("container_status", sa.String(16), nullable=False),
    )
    op.create_index("ix_relay_heartbeats_node_time", "relay_heartbeats", ["node_id", "observed_at"])
    op.create_table(
        "relay_friendships",
        sa.Column("connection_id", sa.String(36), sa.ForeignKey("contract_relay_connections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("node_id", sa.String(32), sa.ForeignKey("relay_nodes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
    )


def downgrade():
    op.drop_table("relay_friendships")
    op.drop_table("relay_heartbeats")
    op.drop_table("relay_nodes")
