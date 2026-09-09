"""Persistent bureau presentation and bounded, replaceable media.

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("player_bureaus", sa.Column("appearance", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("player_bureaus", sa.Column("role_titles", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("player_bureaus", sa.Column("welcome", sa.String(500), nullable=False, server_default=""))
    op.add_column("player_bureaus", sa.Column("listed", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("player_bureaus", sa.Column("design_revision", sa.Integer(), nullable=False, server_default="1"))
    for kind in ("avatar", "cover"):
        op.add_column("player_bureaus", sa.Column(f"{kind}_data", sa.LargeBinary(), nullable=True))
        op.add_column("player_bureaus", sa.Column(f"{kind}_digest", sa.String(64), nullable=True))


def downgrade():
    for column in ("cover_digest", "cover_data", "avatar_digest", "avatar_data", "design_revision", "listed", "welcome", "role_titles", "appearance"):
        op.drop_column("player_bureaus", column)
