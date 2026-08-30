"""add durable board match candidate queue

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "board_match_candidates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("board_id", sa.String(length=36), nullable=False),
        sa.Column("match_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=True),
        sa.Column("capture_source", sa.String(length=64), nullable=False),
        sa.Column("ignored_reason", sa.String(length=120), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("bound_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["board_id"], ["contract_boards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "board_id",
            "match_id",
            name="uq_board_match_candidate_board_match",
        ),
    )
    op.create_index(
        "ix_board_match_candidates_board_id",
        "board_match_candidates",
        ["board_id"],
    )
    op.create_index(
        "ix_board_match_candidates_match_id",
        "board_match_candidates",
        ["match_id"],
    )
    op.create_index(
        "ix_board_match_candidates_status",
        "board_match_candidates",
        ["status"],
    )
    op.create_index(
        "ix_board_match_candidates_captured_at",
        "board_match_candidates",
        ["captured_at"],
    )
    op.create_index(
        "ix_board_match_candidate_board_status",
        "board_match_candidates",
        ["board_id", "status"],
    )
    op.create_index(
        "uq_board_match_candidate_attempt",
        "board_match_candidates",
        ["board_id", "attempt_no"],
        unique=True,
        postgresql_where=sa.text("attempt_no IS NOT NULL"),
        sqlite_where=sa.text("attempt_no IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_board_match_candidate_attempt",
        table_name="board_match_candidates",
    )
    op.drop_index(
        "ix_board_match_candidate_board_status",
        table_name="board_match_candidates",
    )
    op.drop_index(
        "ix_board_match_candidates_captured_at",
        table_name="board_match_candidates",
    )
    op.drop_index(
        "ix_board_match_candidates_status",
        table_name="board_match_candidates",
    )
    op.drop_index(
        "ix_board_match_candidates_match_id",
        table_name="board_match_candidates",
    )
    op.drop_index(
        "ix_board_match_candidates_board_id",
        table_name="board_match_candidates",
    )
    op.drop_table("board_match_candidates")
