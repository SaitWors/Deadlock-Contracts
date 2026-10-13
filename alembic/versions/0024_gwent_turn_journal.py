"""Allow card turns while preserving the existing legacy action journal.

Revision ID: 0024
Revises: 0023
"""
import sqlalchemy as sa

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("battle_actions") as batch:
        batch.drop_constraint("ck_battle_actions_0", type_="check")
        batch.create_check_constraint("ck_battle_actions_0", "round BETWEEN 1 AND 256")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM battle_actions WHERE round > 12")):
        raise RuntimeError("Gwent turn history exists; refusing a downgrade that would destroy match history")
    with op.batch_alter_table("battle_actions") as batch:
        batch.drop_constraint("ck_battle_actions_0", type_="check")
        batch.create_check_constraint("ck_battle_actions_0", "round BETWEEN 1 AND 12")
