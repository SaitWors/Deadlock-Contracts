"""Player bureaus and profile showcases.

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    additions = [
        sa.Column("showcase_order", sa.JSON(), nullable=False, server_default='["contracts", "achievements", "bureau"]'),
        sa.Column("pinned_contract_ids", sa.JSON(), nullable=False, server_default='[]'),
        sa.Column("featured_achievement", sa.String(32), nullable=True),
        sa.Column("show_achievements", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("show_bureau", sa.Boolean(), nullable=False, server_default=sa.false()),
    ]
    for column in additions:
        op.add_column("public_profiles", column)
    with op.batch_alter_table("public_profiles") as batch:
        for column in additions:
            if column.server_default is not None:
                batch.alter_column(column.name, server_default=None)

    op.create_table(
        "player_bureaus",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("slug", sa.String(40), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("tagline", sa.String(120), nullable=False),
        sa.Column("description", sa.String(1200), nullable=False),
        sa.Column("rules", sa.String(1200), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("theme", sa.String(24), nullable=False),
        sa.Column("recruitment", sa.String(24), nullable=False),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_player_bureaus_slug", "player_bureaus", ["slug"], unique=True)
    op.create_index("ix_player_bureaus_owner_user_id", "player_bureaus", ["owner_user_id"])
    op.create_table(
        "bureau_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("bureau_id", sa.String(36), sa.ForeignKey("player_bureaus.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bureau_memberships_bureau_id", "bureau_memberships", ["bureau_id"])
    op.create_index("ix_bureau_memberships_user_id", "bureau_memberships", ["user_id"], unique=True)
    op.create_table(
        "bureau_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("bureau_id", sa.String(36), sa.ForeignKey("player_bureaus.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("bureau_id", "user_id", name="uq_bureau_application"),
    )
    op.create_index("ix_bureau_applications_bureau_id", "bureau_applications", ["bureau_id"])
    op.create_index("ix_bureau_applications_user_id", "bureau_applications", ["user_id"])


def downgrade() -> None:
    op.drop_table("bureau_applications")
    op.drop_table("bureau_memberships")
    op.drop_table("player_bureaus")
    with op.batch_alter_table("public_profiles") as batch:
        for name in ("show_bureau", "show_achievements", "featured_achievement", "pinned_contract_ids", "showcase_order"):
            batch.drop_column(name)
