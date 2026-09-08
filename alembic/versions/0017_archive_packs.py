"""Versioned packs, inventory, receipts and an optional profile showcase.

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("archive_packs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("creator_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("starter", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision > 0", name="ck_archive_pack_revision"))
    op.create_index("ix_archive_packs_active", "archive_packs", ["active"])
    op.create_table("archive_pack_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("pack_id", sa.String(36), sa.ForeignKey("archive_packs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("pack_id", "revision", name="uq_archive_pack_version"))
    op.create_index("ix_archive_pack_versions_pack_id", "archive_pack_versions", ["pack_id"])
    op.create_table("archive_operations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_key", sa.String(36), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("benefit_key", sa.String(32), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("pack_version_id", sa.String(36), sa.ForeignKey("archive_pack_versions.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_key", name="uq_archive_operation_request"),
        sa.UniqueConstraint("user_id", "benefit_key", name="uq_archive_operation_benefit"))
    op.create_index("ix_archive_operations_user_id", "archive_operations", ["user_id"])
    op.create_table("archive_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("card_id", sa.String(36), sa.ForeignKey("archive_cards.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("operation_id", sa.String(36), sa.ForeignKey("archive_operations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cost_basis", sa.Integer(), nullable=False),
        sa.Column("test_grant", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("cost_basis >= 0", name="ck_archive_item_cost"))
    op.create_index("ix_archive_items_user_id", "archive_items", ["user_id"])
    op.create_index("ix_archive_items_card_id", "archive_items", ["card_id"])
    op.create_index("ix_archive_items_owner_card_state", "archive_items", ["user_id", "card_id", "state"])
    op.create_table("archive_showcases",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("card_ids", sa.JSON(), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False))


def downgrade():
    op.drop_table("archive_showcases")
    op.drop_table("archive_items")
    op.drop_table("archive_operations")
    op.drop_table("archive_pack_versions")
    op.drop_table("archive_packs")
