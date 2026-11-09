"""Keep the actual case completion result for later replays.

Revision ID: 0025
Revises: 0024
"""
import sqlalchemy as sa

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("contract_boards", sa.Column("completion_result", sa.JSON(none_as_null=True), nullable=True))


def downgrade():
    with op.batch_alter_table("contract_boards") as batch:
        batch.drop_column("completion_result")
