"""add admin review claims and priority

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-03

Stage 3 adds short-lived staff claims to AutoReviewCase. Claims are advisory
coordination state; the final ModerationService transaction still uses
SELECT ... FOR UPDATE before applying a decision.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "auto_review_cases",
        sa.Column(
            "claimed_by_user_id",
            sa.String(length=36),
            nullable=True,
        ),
    )
    op.add_column(
        "auto_review_cases",
        sa.Column(
            "claimed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "auto_review_cases",
        sa.Column(
            "claim_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "auto_review_cases",
        sa.Column(
            "priority",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("50"),
        ),
    )

    op.create_foreign_key(
        "fk_auto_review_cases_claimed_by_user",
        "auto_review_cases",
        "users",
        ["claimed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_index(
        "ix_auto_review_cases_status_priority_created",
        "auto_review_cases",
        ["status", "priority", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_auto_review_cases_claim_owner_expiry",
        "auto_review_cases",
        ["claimed_by_user_id", "claim_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_auto_review_cases_claim_owner_expiry",
        table_name="auto_review_cases",
    )
    op.drop_index(
        "ix_auto_review_cases_status_priority_created",
        table_name="auto_review_cases",
    )
    op.drop_constraint(
        "fk_auto_review_cases_claimed_by_user",
        "auto_review_cases",
        type_="foreignkey",
    )
    op.drop_column("auto_review_cases", "priority")
    op.drop_column("auto_review_cases", "claim_expires_at")
    op.drop_column("auto_review_cases", "claimed_at")
    op.drop_column("auto_review_cases", "claimed_by_user_id")
