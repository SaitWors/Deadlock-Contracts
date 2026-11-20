"""Track expiring, single-use browser pairing sessions."""

import sqlalchemy as sa

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "companion_link_sessions",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("claimed_token_hash", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_companion_link_sessions_claimed_token_hash", "companion_link_sessions", ["claimed_token_hash"])
    op.create_index("ix_companion_link_sessions_expires_at", "companion_link_sessions", ["expires_at"])


def downgrade():
    op.drop_index("ix_companion_link_sessions_claimed_token_hash", table_name="companion_link_sessions")
    op.drop_index("ix_companion_link_sessions_expires_at", table_name="companion_link_sessions")
    op.drop_table("companion_link_sessions")
