"""add Companion-first settlement foundation

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-30

This migration is intentionally additive. Existing client-derived matches are
NOT promoted to server-verified trust. Legacy rows receive conservative trust
labels and the current settlement path remains unchanged.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "evidence_schema_version",
            sa.Integer(),
            nullable=False,
            server_default="8",
        ),
    )
    # Production contains a pre-Alembic legacy `session_id` column.
    # Never reuse or mutate it for Evidence v9.
    op.add_column(
        "companion_match_evidence",
        sa.Column("gep_session_id", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column("attempt_nonce_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column("terminal_signal", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column("terminal_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "server_first_seen_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "server_finalized_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column("final_sequence", sa.Integer(), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column("final_payload_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "companion_match_evidence",
        sa.Column(
            "integrity_status",
            sa.String(length=32),
            nullable=False,
            server_default="LEGACY_DIAGNOSTIC",
        ),
    )

    op.create_index(
        "ix_companion_match_evidence_gep_session_id",
        "companion_match_evidence",
        ["gep_session_id"],
    )
    op.create_index(
        "ix_companion_match_evidence_attempt_nonce_hash",
        "companion_match_evidence",
        ["attempt_nonce_hash"],
    )
    op.create_index(
        "ix_companion_match_evidence_integrity_status",
        "companion_match_evidence",
        ["integrity_status"],
    )

    op.create_table(
        "companion_attempt_leases",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=False),
        sa.Column("board_id", sa.String(length=36), nullable=True),
        sa.Column("session_id", sa.String(length=80), nullable=False),
        sa.Column("attempt_nonce_hash", sa.String(length=64), nullable=True),
        sa.Column("game_match_mode", sa.String(length=32), nullable=True),
        sa.Column("external_match_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("ineligible_reason", sa.String(length=120), nullable=True),
        sa.Column(
            "server_first_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["companion_devices.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["board_id"],
            ["contract_boards.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "session_id",
            name="uq_companion_attempt_lease_user_session",
        ),
        sa.UniqueConstraint(
            "attempt_nonce_hash",
            name="uq_companion_attempt_lease_nonce",
        ),
    )

    op.create_index(
        "ix_companion_attempt_leases_user_id",
        "companion_attempt_leases",
        ["user_id"],
    )
    op.create_index(
        "ix_companion_attempt_leases_device_id",
        "companion_attempt_leases",
        ["device_id"],
    )
    op.create_index(
        "ix_companion_attempt_leases_board_id",
        "companion_attempt_leases",
        ["board_id"],
    )
    op.create_index(
        "ix_companion_attempt_leases_session_id",
        "companion_attempt_leases",
        ["session_id"],
    )
    op.create_index(
        "ix_companion_attempt_leases_game_match_mode",
        "companion_attempt_leases",
        ["game_match_mode"],
    )
    op.create_index(
        "ix_companion_attempt_leases_external_match_id",
        "companion_attempt_leases",
        ["external_match_id"],
    )
    op.create_index(
        "ix_companion_attempt_leases_status",
        "companion_attempt_leases",
        ["status"],
    )
    op.create_index(
        "ix_companion_attempt_leases_server_first_seen_at",
        "companion_attempt_leases",
        ["server_first_seen_at"],
    )
    op.create_index(
        "ix_companion_attempt_leases_expires_at",
        "companion_attempt_leases",
        ["expires_at"],
    )
    op.create_index(
        "ix_companion_attempt_lease_board_status",
        "companion_attempt_leases",
        ["board_id", "status"],
    )

    # Conservative legacy backfill. 0009 must never silently convert an
    # existing gep_fallback/client-only Match into a trusted GEP settlement.
    op.add_column(
        "matches",
        sa.Column(
            "settlement_source",
            sa.String(length=32),
            nullable=False,
            server_default="LEGACY",
        ),
    )
    op.add_column(
        "matches",
        sa.Column(
            "integrity_status",
            sa.String(length=32),
            nullable=False,
            server_default="LEGACY_DIAGNOSTIC",
        ),
    )
    op.add_column(
        "matches",
        sa.Column(
            "audit_status",
            sa.String(length=32),
            nullable=False,
            server_default="NOT_REQUESTED",
        ),
    )
    op.add_column(
        "matches",
        sa.Column("audited_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "ix_matches_settlement_source",
        "matches",
        ["settlement_source"],
    )
    op.create_index(
        "ix_matches_integrity_status",
        "matches",
        ["integrity_status"],
    )
    op.create_index(
        "ix_matches_audit_status",
        "matches",
        ["audit_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_matches_audit_status", table_name="matches")
    op.drop_index("ix_matches_integrity_status", table_name="matches")
    op.drop_index("ix_matches_settlement_source", table_name="matches")

    op.drop_column("matches", "audited_at")
    op.drop_column("matches", "audit_status")
    op.drop_column("matches", "integrity_status")
    op.drop_column("matches", "settlement_source")

    op.drop_index(
        "ix_companion_attempt_lease_board_status",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_expires_at",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_server_first_seen_at",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_status",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_external_match_id",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_game_match_mode",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_session_id",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_board_id",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_device_id",
        table_name="companion_attempt_leases",
    )
    op.drop_index(
        "ix_companion_attempt_leases_user_id",
        table_name="companion_attempt_leases",
    )

    op.drop_table("companion_attempt_leases")

    op.drop_index(
        "ix_companion_match_evidence_integrity_status",
        table_name="companion_match_evidence",
    )
    op.drop_index(
        "ix_companion_match_evidence_attempt_nonce_hash",
        table_name="companion_match_evidence",
    )
    op.drop_index(
        "ix_companion_match_evidence_gep_session_id",
        table_name="companion_match_evidence",
    )

    op.drop_column("companion_match_evidence", "integrity_status")
    op.drop_column("companion_match_evidence", "final_payload_hash")
    op.drop_column("companion_match_evidence", "final_sequence")
    op.drop_column("companion_match_evidence", "server_finalized_at")
    op.drop_column("companion_match_evidence", "server_first_seen_at")
    op.drop_column("companion_match_evidence", "terminal_at")
    op.drop_column("companion_match_evidence", "terminal_signal")
    op.drop_column("companion_match_evidence", "attempt_nonce_hash")
    op.drop_column("companion_match_evidence", "gep_session_id")
    op.drop_column("companion_match_evidence", "evidence_schema_version")
