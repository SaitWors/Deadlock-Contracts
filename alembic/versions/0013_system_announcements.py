"""system announcements and per-user receipts

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_announcements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("severity", sa.String(length=24), nullable=False),
        sa.Column("presentation", sa.String(length=24), nullable=False),
        sa.Column("effect", sa.String(length=32), nullable=False),
        sa.Column("dismiss_policy", sa.String(length=24), nullable=False),
        sa.Column("title_ru", sa.String(length=160), nullable=False),
        sa.Column("body_ru", sa.Text(), nullable=False),
        sa.Column("title_en", sa.String(length=160), nullable=True),
        sa.Column("body_en", sa.Text(), nullable=True),
        sa.Column("cta_label_ru", sa.String(length=64), nullable=True),
        sa.Column("cta_label_en", sa.String(length=64), nullable=True),
        sa.Column("cta_url", sa.Text(), nullable=True),
        sa.Column("surfaces", sa.JSON(), nullable=False),
        sa.Column("audiences", sa.JSON(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("show_countdown", sa.Boolean(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("supersedes_id", sa.String(length=36), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("updated_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("published_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("cancelled_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["supersedes_id"],
            ["system_announcements.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["published_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by_user_id"],
            ["users.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_system_announcements_status",
        "system_announcements",
        ["status"],
    )
    op.create_index(
        "ix_system_announcements_severity",
        "system_announcements",
        ["severity"],
    )
    op.create_index(
        "ix_system_announcements_priority",
        "system_announcements",
        ["priority"],
    )
    op.create_index(
        "ix_system_announcements_starts_at",
        "system_announcements",
        ["starts_at"],
    )
    op.create_index(
        "ix_system_announcements_ends_at",
        "system_announcements",
        ["ends_at"],
    )
    op.create_index(
        "ix_system_announcements_supersedes_id",
        "system_announcements",
        ["supersedes_id"],
    )
    op.create_index(
        "ix_system_announcements_created_by_user_id",
        "system_announcements",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_system_announcements_updated_by_user_id",
        "system_announcements",
        ["updated_by_user_id"],
    )
    op.create_index(
        "ix_system_announcements_public_window",
        "system_announcements",
        ["status", "starts_at", "ends_at", "priority"],
    )

    op.create_table(
        "system_announcement_receipts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("announcement_id", sa.String(length=36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("surface", sa.String(length=32), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("impression_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["announcement_id"],
            ["system_announcements.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "announcement_id",
            "revision",
            "user_id",
            "surface",
            name="uq_announcement_receipt_subject",
        ),
    )
    op.create_index(
        "ix_system_announcement_receipts_announcement_id",
        "system_announcement_receipts",
        ["announcement_id"],
    )
    op.create_index(
        "ix_system_announcement_receipts_user_id",
        "system_announcement_receipts",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_system_announcement_receipts_user_id",
        table_name="system_announcement_receipts",
    )
    op.drop_index(
        "ix_system_announcement_receipts_announcement_id",
        table_name="system_announcement_receipts",
    )
    op.drop_table("system_announcement_receipts")

    op.drop_index(
        "ix_system_announcements_public_window",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_updated_by_user_id",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_created_by_user_id",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_supersedes_id",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_ends_at",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_starts_at",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_priority",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_severity",
        table_name="system_announcements",
    )
    op.drop_index(
        "ix_system_announcements_status",
        table_name="system_announcements",
    )
    op.drop_table("system_announcements")
