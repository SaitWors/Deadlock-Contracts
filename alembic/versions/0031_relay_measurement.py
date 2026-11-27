"""Record prospective Contract Relay measurement observations."""

import sqlalchemy as sa

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("matches", sa.Column("relay_provider_metadata_observed_at", sa.DateTime(timezone=True)))
    op.create_table(
        "relay_match_observations",
        sa.Column("board_id", sa.String(36), sa.ForeignKey("contract_boards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("match_id", sa.String(36), sa.ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("relay_cohort", sa.String(32), nullable=False),
    )
    op.create_index("ix_relay_match_observations_observed_at", "relay_match_observations", ["observed_at"])


def downgrade():
    op.drop_index("ix_relay_match_observations_observed_at", table_name="relay_match_observations")
    op.drop_table("relay_match_observations")
    op.drop_column("matches", "relay_provider_metadata_observed_at")
