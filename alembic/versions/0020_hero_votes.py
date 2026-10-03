"""Community hero poll campaigns and cached observations.

Revision ID: 0020
Revises: 0019
"""
import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("hero_vote_campaigns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title_ru", sa.String(120), nullable=False),
        sa.Column("title_en", sa.String(120), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
        sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("active_slot", sa.String(8), unique=True),
        sa.Column("visible", sa.Boolean(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision > 0", name="ck_hero_vote_revision"))
    op.create_table("hero_vote_sources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("campaign_id", sa.String(36), sa.ForeignKey("hero_vote_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(24), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("next_refresh_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("lease_token", sa.String(36)),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("campaign_id", "provider", name="uq_hero_vote_source"))
    op.create_index("ix_hero_vote_sources_campaign_id", "hero_vote_sources", ["campaign_id"])
    op.create_table("hero_vote_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("hero_vote_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_hero_vote_snapshot_history", "hero_vote_snapshots", ["source_id", "observed_at"])


def downgrade():
    op.drop_index("ix_hero_vote_snapshot_history", table_name="hero_vote_snapshots")
    op.drop_table("hero_vote_snapshots")
    op.drop_index("ix_hero_vote_sources_campaign_id", table_name="hero_vote_sources")
    op.drop_table("hero_vote_sources")
    op.drop_table("hero_vote_campaigns")
