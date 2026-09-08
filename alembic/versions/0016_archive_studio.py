"""Card studio, cipher rounds and a separate archive-token ledger.

Revision ID: 0016
Revises: 0015
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("archive_cards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("creator_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("hero", sa.String(40), nullable=False),
        sa.Column("rank", sa.String(3), nullable=False),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("description", sa.String(600), nullable=False),
        sa.Column("artist", sa.String(100), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=False),
        sa.Column("rights_confirmed", sa.Boolean(), nullable=False),
        sa.Column("image_data", sa.LargeBinary(), nullable=True),
        sa.Column("image_digest", sa.String(64), nullable=True),
        sa.Column("crop_x", sa.Integer(), nullable=False),
        sa.Column("crop_y", sa.Integer(), nullable=False),
        sa.Column("zoom", sa.Float(), nullable=False),
        sa.Column("frame_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("review_note", sa.String(600), nullable=False),
        sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("revision > 0", name="ck_archive_card_revision"),
    )
    for name in ("creator_id", "hero", "rank", "status"):
        op.create_index("ix_archive_cards_" + name, "archive_cards", [name])
    op.create_table("archive_ciphers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("week", sa.Date(), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("solution", sa.JSON(), nullable=False),
        sa.Column("guesses", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "week", "slot", name="uq_archive_cipher_slot"),
        sa.CheckConstraint("slot BETWEEN 1 AND 5", name="ck_archive_cipher_slot"),
    )
    op.create_index("ix_archive_ciphers_user_id", "archive_ciphers", ["user_id"])
    op.create_table("archive_ledger",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "source", name="uq_archive_ledger_source"),
    )
    op.create_index("ix_archive_ledger_user_id", "archive_ledger", ["user_id"])


def downgrade():
    op.drop_table("archive_ledger")
    op.drop_table("archive_ciphers")
    op.drop_table("archive_cards")
