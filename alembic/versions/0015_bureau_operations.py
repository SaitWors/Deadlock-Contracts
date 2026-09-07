"""Bureau moderation, historical membership and operation contribution ledger.

Revision ID: 0015
Revises: 0014
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('bureau_bans',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('bureau_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('reason', sa.String(length=300), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['bureau_id'], ['player_bureaus.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('bureau_id', 'user_id', name='uq_bureau_ban')
    )
    op.create_index(op.f('ix_bureau_bans_bureau_id'), 'bureau_bans', ['bureau_id'], unique=False)
    op.create_index(op.f('ix_bureau_bans_user_id'), 'bureau_bans', ['user_id'], unique=False)
    op.create_table('bureau_membership_periods',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('bureau_id', sa.String(length=36), nullable=True),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['bureau_id'], ['player_bureaus.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bureau_membership_periods_bureau_id'), 'bureau_membership_periods', ['bureau_id'], unique=False)
    op.create_index(op.f('ix_bureau_membership_periods_user_id'), 'bureau_membership_periods', ['user_id'], unique=False)
    op.create_index('uq_bureau_open_period', 'bureau_membership_periods', ['user_id'], unique=True, postgresql_where=sa.text('left_at IS NULL'), sqlite_where=sa.text('left_at IS NULL'))
    op.create_table('bureau_operations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('bureau_id', sa.String(length=36), nullable=True),
    sa.Column('template', sa.String(length=24), nullable=False),
    sa.Column('target', sa.Integer(), nullable=False),
    sa.Column('min_contributors', sa.Integer(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('contributors', sa.Integer(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('cancel_reason', sa.String(length=1000), nullable=False),
    sa.ForeignKeyConstraint(['bureau_id'], ['player_bureaus.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bureau_operations_bureau_id'), 'bureau_operations', ['bureau_id'], unique=False)
    op.create_index(op.f('ix_bureau_operations_checked_at'), 'bureau_operations', ['checked_at'], unique=False)
    op.create_table('bureau_reports',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('bureau_id', sa.String(length=36), nullable=True),
    sa.Column('reporter_id', sa.String(length=36), nullable=True),
    sa.Column('bureau_name', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('message', sa.String(length=1000), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('decision', sa.String(length=24), nullable=False),
    sa.Column('decision_note', sa.String(length=1000), nullable=False),
    sa.Column('decided_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['bureau_id'], ['player_bureaus.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bureau_reports_bureau_id'), 'bureau_reports', ['bureau_id'], unique=False)
    op.create_index(op.f('ix_bureau_reports_reporter_id'), 'bureau_reports', ['reporter_id'], unique=False)
    op.create_index(op.f('ix_bureau_reports_status'), 'bureau_reports', ['status'], unique=False)
    op.create_index('uq_bureau_open_report', 'bureau_reports', ['bureau_id', 'reporter_id', 'kind'], unique=True, postgresql_where=sa.text("status = 'OPEN'"), sqlite_where=sa.text("status = 'OPEN'"))
    op.create_table('bureau_operation_participants',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('operation_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('earned_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['operation_id'], ['bureau_operations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('operation_id', 'user_id', name='uq_bureau_operation_player')
    )
    op.create_index(op.f('ix_bureau_operation_participants_operation_id'), 'bureau_operation_participants', ['operation_id'], unique=False)
    op.create_index(op.f('ix_bureau_operation_participants_user_id'), 'bureau_operation_participants', ['user_id'], unique=False)
    op.create_table('bureau_contributions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('operation_id', sa.String(length=36), nullable=False),
    sa.Column('participant_id', sa.String(length=36), nullable=False),
    sa.Column('source_key', sa.String(length=36), nullable=False),
    sa.Column('source_option_id', sa.String(length=36), nullable=True),
    sa.Column('credited', sa.Boolean(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('played_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['operation_id'], ['bureau_operations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['participant_id'], ['bureau_operation_participants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_option_id'], ['board_options.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_key')
    )
    op.create_index(op.f('ix_bureau_contributions_operation_id'), 'bureau_contributions', ['operation_id'], unique=False)
    op.create_index(op.f('ix_bureau_contributions_participant_id'), 'bureau_contributions', ['participant_id'], unique=False)
    op.create_table('bureau_contribution_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('contribution_id', sa.String(length=36), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(length=24), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contribution_id'], ['bureau_contributions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('contribution_id', 'revision', name='uq_bureau_contribution_revision')
    )
    op.create_index(op.f('ix_bureau_contribution_events_contribution_id'), 'bureau_contribution_events', ['contribution_id'], unique=False)
    op.add_column('player_bureaus', sa.Column('status', sa.String(length=24), nullable=False, server_default='ACTIVE'))
    op.add_column('player_bureaus', sa.Column('moderation_note', sa.String(length=1000), nullable=False, server_default=''))
    op.create_index(op.f('ix_player_bureaus_status'), 'player_bureaus', ['status'], unique=False)
    op.execute(sa.text("INSERT INTO bureau_membership_periods (id, bureau_id, user_id, joined_at) SELECT id, bureau_id, user_id, joined_at FROM bureau_memberships"))
    with op.batch_alter_table("player_bureaus") as batch:
        batch.alter_column("status", server_default=None)
        batch.alter_column("moderation_note", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f('ix_player_bureaus_status'), table_name='player_bureaus')
    op.drop_column('player_bureaus', 'moderation_note')
    op.drop_column('player_bureaus', 'status')
    op.drop_index(op.f('ix_bureau_contribution_events_contribution_id'), table_name='bureau_contribution_events')
    op.drop_table('bureau_contribution_events')
    op.drop_index(op.f('ix_bureau_contributions_participant_id'), table_name='bureau_contributions')
    op.drop_index(op.f('ix_bureau_contributions_operation_id'), table_name='bureau_contributions')
    op.drop_table('bureau_contributions')
    op.drop_index(op.f('ix_bureau_operation_participants_user_id'), table_name='bureau_operation_participants')
    op.drop_index(op.f('ix_bureau_operation_participants_operation_id'), table_name='bureau_operation_participants')
    op.drop_table('bureau_operation_participants')
    op.drop_index('uq_bureau_open_report', table_name='bureau_reports', postgresql_where=sa.text("status = 'OPEN'"), sqlite_where=sa.text("status = 'OPEN'"))
    op.drop_index(op.f('ix_bureau_reports_status'), table_name='bureau_reports')
    op.drop_index(op.f('ix_bureau_reports_reporter_id'), table_name='bureau_reports')
    op.drop_index(op.f('ix_bureau_reports_bureau_id'), table_name='bureau_reports')
    op.drop_table('bureau_reports')
    op.drop_index(op.f('ix_bureau_operations_checked_at'), table_name='bureau_operations')
    op.drop_index(op.f('ix_bureau_operations_bureau_id'), table_name='bureau_operations')
    op.drop_table('bureau_operations')
    op.drop_index('uq_bureau_open_period', table_name='bureau_membership_periods', postgresql_where=sa.text('left_at IS NULL'), sqlite_where=sa.text('left_at IS NULL'))
    op.drop_index(op.f('ix_bureau_membership_periods_user_id'), table_name='bureau_membership_periods')
    op.drop_index(op.f('ix_bureau_membership_periods_bureau_id'), table_name='bureau_membership_periods')
    op.drop_table('bureau_membership_periods')
    op.drop_index(op.f('ix_bureau_bans_user_id'), table_name='bureau_bans')
    op.drop_index(op.f('ix_bureau_bans_bureau_id'), table_name='bureau_bans')
    op.drop_table('bureau_bans')
