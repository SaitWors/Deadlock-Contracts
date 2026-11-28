"""Persist overview banner preferences, rotation and provider refreshes."""
from alembic import op
import sqlalchemy as sa


revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("archive_cards", sa.Column("banner_artwork", sa.Boolean(), nullable=False,
                                             server_default=sa.false()))
    op.create_table(
        "foundation_banners",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False, server_default="favorite_hero"),
        sa.Column("selected_card_id", sa.String(36), sa.ForeignKey("archive_cards.id", ondelete="SET NULL")),
        sa.Column("daily_card_id", sa.String(36), sa.ForeignKey("archive_cards.id", ondelete="SET NULL")),
        sa.Column("daily_date", sa.Date()),
        sa.Column("daily_account_id", sa.BigInteger()),
        sa.Column("stat_account_id", sa.BigInteger()),
        sa.Column("hero_id", sa.Integer()),
        sa.Column("hero_observed_at", sa.DateTime(timezone=True)),
        sa.Column("next_refresh_at", sa.DateTime(timezone=True)),
        sa.Column("refresh_lease_until", sa.DateTime(timezone=True)),
        sa.Column("provider_pause_until", sa.DateTime(timezone=True)),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_foundation_banners_provider_pause_until", "foundation_banners", ["provider_pause_until"])


def downgrade() -> None:
    op.drop_table("foundation_banners")
    op.drop_column("archive_cards", "banner_artwork")
