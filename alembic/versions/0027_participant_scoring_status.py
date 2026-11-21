"""Record the provider's scoring status for each participant."""

import sqlalchemy as sa

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("match_participants", sa.Column("scoring_status", sa.String(32), nullable=True))


def downgrade():
    op.drop_column("match_participants", "scoring_status")
