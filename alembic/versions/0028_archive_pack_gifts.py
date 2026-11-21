"""Store recipient entitlements for owner-gifted packs."""

import sqlalchemy as sa

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "archive_pack_gifts",
        sa.Column("grant_id", sa.String(36), sa.ForeignKey("archive_operations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("remaining", sa.Integer(), nullable=False),
        sa.CheckConstraint("remaining BETWEEN 0 AND 10", name="ck_archive_pack_gift_remaining"),
    )


def downgrade():
    op.drop_table("archive_pack_gifts")
