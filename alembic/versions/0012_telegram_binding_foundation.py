"""telegram binding and notification persistence foundation

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table(
        "telegram_moderator_bindings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("telegram_username", sa.String(length=64), nullable=True),
        sa.Column("telegram_first_name", sa.String(length=128), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telegram_moderator_bindings_user_id", "telegram_moderator_bindings", ["user_id"])
    op.create_index("ix_telegram_moderator_bindings_telegram_user_id", "telegram_moderator_bindings", ["telegram_user_id"])
    op.create_index("ix_telegram_moderator_bindings_revoked_at", "telegram_moderator_bindings", ["revoked_at"])
    op.create_index("ix_telegram_moderator_bindings_user_revoked", "telegram_moderator_bindings", ["user_id", "revoked_at"])
    op.create_index(
        "uq_telegram_moderator_bindings_active_user",
        "telegram_moderator_bindings",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "uq_telegram_moderator_bindings_active_telegram_user",
        "telegram_moderator_bindings",
        ["telegram_user_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    op.create_table(
        "telegram_link_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telegram_link_tokens_user_id", "telegram_link_tokens", ["user_id"])
    op.create_index("ix_telegram_link_tokens_token_hash", "telegram_link_tokens", ["token_hash"], unique=True)
    op.create_index("ix_telegram_link_tokens_expires_at", "telegram_link_tokens", ["expires_at"])
    op.create_index("ix_telegram_link_tokens_used_at", "telegram_link_tokens", ["used_at"])

    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("outbox_event_id", sa.String(length=36), nullable=False),
        sa.Column("destination", sa.String(length=32), nullable=False),
        sa.Column("destination_key", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("run_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("provider_message_id", sa.String(length=128), nullable=True),
        sa.Column("provider_metadata", sa.JSON(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["outbox_event_id"], ["outbox_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_event_id", "destination", "destination_key", name="uq_notification_delivery_destination"),
    )
    op.create_index("ix_notification_deliveries_outbox_event_id", "notification_deliveries", ["outbox_event_id"])
    op.create_index("ix_notification_deliveries_destination", "notification_deliveries", ["destination"])
    op.create_index("ix_notification_deliveries_state", "notification_deliveries", ["state"])
    op.create_index("ix_notification_deliveries_run_after", "notification_deliveries", ["run_after"])
    op.create_index("ix_notification_deliveries_provider_message_id", "notification_deliveries", ["provider_message_id"])
    op.create_index("ix_notification_delivery_state_run_after", "notification_deliveries", ["state", "run_after"])

    op.create_table(
        "telegram_update_receipts",
        sa.Column("update_id", sa.BigInteger(), nullable=False),
        sa.Column("update_type", sa.String(length=32), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("update_id"),
    )
    op.create_index("ix_telegram_update_receipts_update_type", "telegram_update_receipts", ["update_type"])
    op.create_index("ix_telegram_update_receipts_state", "telegram_update_receipts", ["state"])

    op.create_table(
        "moderation_decision_drafts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("review_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("decisions", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["review_id"], ["auto_review_cases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "actor_user_id", "source", name="uq_moderation_decision_draft_actor_source"),
    )
    op.create_index("ix_moderation_decision_drafts_review_id", "moderation_decision_drafts", ["review_id"])
    op.create_index("ix_moderation_decision_drafts_actor_user_id", "moderation_decision_drafts", ["actor_user_id"])
    op.create_index("ix_moderation_decision_draft_expiry", "moderation_decision_drafts", ["expires_at"])

def downgrade() -> None:
    op.drop_index("ix_moderation_decision_draft_expiry", table_name="moderation_decision_drafts")
    op.drop_index("ix_moderation_decision_drafts_actor_user_id", table_name="moderation_decision_drafts")
    op.drop_index("ix_moderation_decision_drafts_review_id", table_name="moderation_decision_drafts")
    op.drop_table("moderation_decision_drafts")
    op.drop_index("ix_telegram_update_receipts_state", table_name="telegram_update_receipts")
    op.drop_index("ix_telegram_update_receipts_update_type", table_name="telegram_update_receipts")
    op.drop_table("telegram_update_receipts")
    op.drop_index("ix_notification_delivery_state_run_after", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_provider_message_id", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_run_after", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_state", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_destination", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_outbox_event_id", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")
    op.drop_index("ix_telegram_link_tokens_used_at", table_name="telegram_link_tokens")
    op.drop_index("ix_telegram_link_tokens_expires_at", table_name="telegram_link_tokens")
    op.drop_index("ix_telegram_link_tokens_token_hash", table_name="telegram_link_tokens")
    op.drop_index("ix_telegram_link_tokens_user_id", table_name="telegram_link_tokens")
    op.drop_table("telegram_link_tokens")
    op.drop_index("uq_telegram_moderator_bindings_active_telegram_user", table_name="telegram_moderator_bindings")
    op.drop_index("uq_telegram_moderator_bindings_active_user", table_name="telegram_moderator_bindings")
    op.drop_index("ix_telegram_moderator_bindings_user_revoked", table_name="telegram_moderator_bindings")
    op.drop_index("ix_telegram_moderator_bindings_revoked_at", table_name="telegram_moderator_bindings")
    op.drop_index("ix_telegram_moderator_bindings_telegram_user_id", table_name="telegram_moderator_bindings")
    op.drop_index("ix_telegram_moderator_bindings_user_id", table_name="telegram_moderator_bindings")
    op.drop_table("telegram_moderator_bindings")
