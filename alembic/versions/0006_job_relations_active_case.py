"""normalize job relations and enforce one active case per mode

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("user_id", sa.String(length=36), nullable=True))
    op.add_column("jobs", sa.Column("board_id", sa.String(length=36), nullable=True))
    op.add_column("jobs", sa.Column("match_id", sa.String(length=36), nullable=True))
    op.add_column("jobs", sa.Column("game_match_mode", sa.String(length=32), nullable=True))

    # Backfill only values that resolve to real domain rows. Resolver jobs can
    # carry an external numeric Match ID, which must never enter jobs.match_id.
    op.execute(
        """
        UPDATE jobs AS job
        SET user_id = users.id
        FROM users
        WHERE job.payload->>'user_id' = users.id
        """
    )
    op.execute(
        """
        UPDATE jobs AS job
        SET board_id = boards.id,
            user_id = COALESCE(job.user_id, boards.user_id),
            game_match_mode = COALESCE(
                NULLIF(UPPER(job.payload->>'mode_hint'), ''),
                boards.game_match_mode
            )
        FROM contract_boards AS boards
        WHERE job.payload->>'board_id' = boards.id
        """
    )
    op.execute(
        """
        UPDATE jobs AS job
        SET match_id = matches.id
        FROM matches
        WHERE job.type IN ('bind_match', 'evaluate_match', 'refresh_review_match')
          AND job.payload->>'match_id' = matches.id
        """
    )
    op.execute(
        """
        UPDATE jobs
        SET game_match_mode = UPPER(
            COALESCE(payload->>'mode_hint', payload->>'mode')
        )
        WHERE game_match_mode IS NULL
          AND COALESCE(payload->>'mode_hint', payload->>'mode') IS NOT NULL
        """
    )

    op.create_foreign_key(
        "fk_jobs_user_id",
        "jobs",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_jobs_board_id",
        "jobs",
        "contract_boards",
        ["board_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_jobs_match_id",
        "jobs",
        "matches",
        ["match_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_jobs_user_id", "jobs", ["user_id"])
    op.create_index("ix_jobs_board_id", "jobs", ["board_id"])
    op.create_index("ix_jobs_match_id", "jobs", ["match_id"])
    op.create_index("ix_jobs_game_match_mode", "jobs", ["game_match_mode"])

    # If an earlier race created two active cases, preserve the oldest case
    # (the same rule used by the application) and void newer duplicates without
    # counting them as player failures or granting XP.
    duplicate_cases = """
        SELECT id
        FROM (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY user_id, game_match_mode
                    ORDER BY locked_at ASC NULLS LAST, created_at ASC, id ASC
                ) AS row_number
            FROM contract_boards
            WHERE status IN ('LOCKED', 'VERIFYING', 'REVIEW_REQUIRED')
        ) AS ranked
        WHERE ranked.row_number > 1
    """
    op.execute(
        f"""
        UPDATE board_options
        SET status = 'VOID',
            settled_at = CURRENT_TIMESTAMP,
            explanation = COALESCE(
                explanation,
                'Duplicate active case repaired during schema migration; no loss or reward.'
            )
        WHERE board_id IN ({duplicate_cases})
          AND selected = TRUE
          AND status NOT IN ('COMPLETED', 'FAILED', 'VOID', 'EXPIRED')
        """
    )
    op.execute(
        f"""
        UPDATE auto_review_cases
        SET status = 'RESOLVED',
            reviewer_note = COALESCE(
                reviewer_note,
                'Duplicate active case repaired during schema migration.'
            ),
            reviewed_at = CURRENT_TIMESTAMP
        WHERE board_id IN ({duplicate_cases})
          AND status IN ('PENDING', 'NEEDS_INFO', 'WAITING_PROVIDER')
        """
    )
    op.execute(
        f"""
        UPDATE jobs
        SET status = 'DONE',
            locked_at = NULL,
            locked_by = NULL,
            last_error = 'Duplicate active case closed during schema migration'
        WHERE board_id IN ({duplicate_cases})
          AND status IN ('PENDING', 'RUNNING', 'FAILED')
        """
    )
    op.execute(
        f"""
        UPDATE contract_boards
        SET status = 'EXPIRED'
        WHERE id IN ({duplicate_cases})
        """
    )

    op.create_index(
        "uq_contract_active_user_mode",
        "contract_boards",
        ["user_id", "game_match_mode"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('LOCKED', 'VERIFYING', 'REVIEW_REQUIRED')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_contract_active_user_mode", table_name="contract_boards")
    op.drop_index("ix_jobs_game_match_mode", table_name="jobs")
    op.drop_index("ix_jobs_match_id", table_name="jobs")
    op.drop_index("ix_jobs_board_id", table_name="jobs")
    op.drop_index("ix_jobs_user_id", table_name="jobs")
    op.drop_constraint("fk_jobs_match_id", "jobs", type_="foreignkey")
    op.drop_constraint("fk_jobs_board_id", "jobs", type_="foreignkey")
    op.drop_constraint("fk_jobs_user_id", "jobs", type_="foreignkey")
    op.drop_column("jobs", "game_match_mode")
    op.drop_column("jobs", "match_id")
    op.drop_column("jobs", "board_id")
    op.drop_column("jobs", "user_id")
