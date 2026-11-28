"""Store short-lived browser activity needed for Foundation product metrics."""
import sqlalchemy as sa

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "foundation_analytics_events",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("event_id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_foundation_analytics_events_occurred_at",
        "foundation_analytics_events",
        ["occurred_at"],
    )
    op.create_index(
        "ix_foundation_analytics_events_user_name_time",
        "foundation_analytics_events",
        ["user_id", "name", "occurred_at"],
    )


def downgrade():
    op.drop_table("foundation_analytics_events")
