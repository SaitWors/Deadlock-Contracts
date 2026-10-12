"""Bureau arena, bounded browser rewards and typed pack guarantees.

Revision ID: 0022
Revises: 0021
"""
import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('battle_definition_versions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('category', sa.String(length=8), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('approved', sa.Boolean(), nullable=False),
    sa.Column('rules', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("category IN ('HERO', 'BASE')", name='ck_battle_definition_versions_1'),
    sa.CheckConstraint('version > 0', name='ck_battle_definition_versions_0'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key', 'version', name='uq_battle_definition_version')
    )
    op.create_index(op.f('ix_battle_definition_versions_key'), 'battle_definition_versions', ['key'], unique=False)
    op.create_table('battle_seasons',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=80), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.CheckConstraint('ends_at > starts_at', name='ck_battle_seasons_0'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('battle_assignments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('period_day', sa.Date(), nullable=False),
    sa.Column('slot', sa.Integer(), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('scope', sa.String(length=8), nullable=False),
    sa.Column('opponent', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('match_id', sa.String(length=36), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("mode IN ('ASSIGNED', 'HARD')", name='ck_battle_assignments_2'),
    sa.CheckConstraint("scope IN ('REAL', 'SANDBOX')", name='ck_battle_assignments_0'),
    sa.CheckConstraint("status IN ('OPEN', 'COMPLETED')", name='ck_battle_assignments_3'),
    sa.CheckConstraint('slot BETWEEN 1 AND 3', name='ck_battle_assignments_1'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'period_day', 'slot', 'scope', name='uq_battle_assignment_slot')
    )
    op.create_index(op.f('ix_battle_assignments_user_id'), 'battle_assignments', ['user_id'], unique=False)
    op.create_table('battle_commands',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('request_key', sa.String(length=36), nullable=False),
    sa.Column('signature', sa.String(length=64), nullable=False),
    sa.Column('response', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'request_key', name='uq_battle_command_request')
    )
    op.create_index(op.f('ix_battle_commands_user_id'), 'battle_commands', ['user_id'], unique=False)
    op.create_table('battle_queue',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('season_id', sa.String(length=36), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('rating', sa.Integer(), nullable=False),
    sa.Column('budget', sa.Integer(), nullable=False),
    sa.Column('experience', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('budget BETWEEN 0 AND 24', name='ck_battle_queue_0'),
    sa.CheckConstraint('experience >= 0', name='ck_battle_queue_1'),
    sa.ForeignKeyConstraint(['season_id'], ['battle_seasons.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index(op.f('ix_battle_queue_season_id'), 'battle_queue', ['season_id'], unique=False)
    op.create_table('battle_ratings',
    sa.Column('season_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('rating', sa.Integer(), nullable=False),
    sa.Column('games', sa.Integer(), nullable=False),
    sa.Column('wins', sa.Integer(), nullable=False),
    sa.Column('earned_title', sa.String(length=24), nullable=False),
    sa.CheckConstraint('games >= 0', name='ck_battle_ratings_0'),
    sa.CheckConstraint('wins >= 0 AND wins <= games', name='ck_battle_ratings_1'),
    sa.ForeignKeyConstraint(['season_id'], ['battle_seasons.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('season_id', 'user_id')
    )
    op.create_table('economy_activities',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('data', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'kind', 'source_id', name='uq_economy_activity_source')
    )
    op.create_index(op.f('ix_economy_activities_occurred_at'), 'economy_activities', ['occurred_at'], unique=False)
    op.create_index(op.f('ix_economy_activities_user_id'), 'economy_activities', ['user_id'], unique=False)
    op.create_table('pack_guarantee_states',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('scope', sa.String(length=8), server_default='REAL', nullable=False),
    sa.Column('without_a', sa.Integer(), server_default='0', nullable=False),
    sa.Column('without_s', sa.Integer(), server_default='0', nullable=False),
    sa.Column('without_sss', sa.Integer(), server_default='0', nullable=False),
    sa.Column('revision', sa.Integer(), server_default='0', nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("scope IN ('REAL', 'SANDBOX')", name='ck_pack_guarantee_scope'),
    sa.CheckConstraint('revision >= 0', name='ck_pack_guarantee_revision'),
    sa.CheckConstraint('without_a >= 0 AND without_a < 30 AND without_s >= 0 AND without_s < 120 AND without_sss >= 0 AND without_sss < 360', name='ck_pack_guarantee_counters'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'scope', name='uq_pack_guarantee_user_scope')
    )
    op.create_index(op.f('ix_pack_guarantee_states_user_id'), 'pack_guarantee_states', ['user_id'], unique=False)
    op.create_table('battle_artworks',
    sa.Column('card_id', sa.String(length=36), nullable=False),
    sa.Column('definition_id', sa.String(length=36), nullable=False),
    sa.Column('approved', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['card_id'], ['archive_cards.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['definition_id'], ['battle_definition_versions.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('card_id')
    )
    op.create_index(op.f('ix_battle_artworks_definition_id'), 'battle_artworks', ['definition_id'], unique=False)
    op.create_table('battle_matches',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('opponent_user_id', sa.String(length=36), nullable=True),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('scope', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('round', sa.Integer(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('state', sa.JSON(), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('bot_plan', sa.JSON(), nullable=False),
    sa.Column('last_events', sa.JSON(), nullable=False),
    sa.Column('result', sa.JSON(), nullable=True),
    sa.Column('outcome', sa.String(length=8), nullable=True),
    sa.Column('winner_user_id', sa.String(length=36), nullable=True),
    sa.Column('assignment_id', sa.String(length=36), nullable=True),
    sa.Column('season_id', sa.String(length=36), nullable=True),
    sa.Column('reward_eligible', sa.Boolean(), nullable=False),
    sa.Column('reward', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("mode IN ('TUTORIAL', 'TRAINING', 'ASSIGNED', 'HARD', 'TRIAL', 'WEEKLY', 'COPY', 'FRIENDLY', 'RANKED')", name='ck_battle_matches_4'),
    sa.CheckConstraint("scope IN ('REAL', 'SANDBOX')", name='ck_battle_matches_0'),
    sa.CheckConstraint("status IN ('ACTIVE', 'FINISHED')", name='ck_battle_matches_3'),
    sa.CheckConstraint('revision > 0', name='ck_battle_matches_1'),
    sa.CheckConstraint('round BETWEEN 1 AND 12', name='ck_battle_matches_2'),
    sa.ForeignKeyConstraint(['assignment_id'], ['battle_assignments.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['opponent_user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['season_id'], ['battle_seasons.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['winner_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_battle_matches_assignment_id'), 'battle_matches', ['assignment_id'], unique=False)
    op.create_index(op.f('ix_battle_matches_opponent_user_id'), 'battle_matches', ['opponent_user_id'], unique=False)
    op.create_index(op.f('ix_battle_matches_status'), 'battle_matches', ['status'], unique=False)
    op.create_index(op.f('ix_battle_matches_user_id'), 'battle_matches', ['user_id'], unique=False)
    op.create_table('battle_actions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('match_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('request_key', sa.String(length=36), nullable=False),
    sa.Column('round', sa.Integer(), nullable=False),
    sa.Column('signature', sa.String(length=64), nullable=False),
    sa.Column('actions', sa.JSON(), nullable=False),
    sa.Column('response', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('round BETWEEN 1 AND 12', name='ck_battle_actions_0'),
    sa.ForeignKeyConstraint(['match_id'], ['battle_matches.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('match_id', 'round', 'user_id', name='uq_battle_action_round'),
    sa.UniqueConstraint('match_id', 'user_id', 'request_key', name='uq_battle_action_request')
    )
    op.create_index(op.f('ix_battle_actions_match_id'), 'battle_actions', ['match_id'], unique=False)
    op.create_index(op.f('ix_battle_actions_user_id'), 'battle_actions', ['user_id'], unique=False)
    op.create_table('battle_rooms',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('opponent_user_id', sa.String(length=36), nullable=True),
    sa.Column('scope', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('confirmations', sa.JSON(), nullable=False),
    sa.Column('match_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("scope IN ('REAL', 'SANDBOX')", name='ck_battle_rooms_0'),
    sa.CheckConstraint("status IN ('WAITING', 'STARTED', 'CLOSED')", name='ck_battle_rooms_1'),
    sa.ForeignKeyConstraint(['match_id'], ['battle_matches.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['opponent_user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_battle_rooms_code'), 'battle_rooms', ['code'], unique=True)
    op.create_index(op.f('ix_battle_rooms_user_id'), 'battle_rooms', ['user_id'], unique=False)
    op.create_table('battle_item_reservations',
    sa.Column('item_id', sa.String(length=36), nullable=False),
    sa.Column('match_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['archive_items.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['match_id'], ['battle_matches.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id')
    )
    op.create_index(op.f('ix_battle_item_reservations_match_id'), 'battle_item_reservations', ['match_id'], unique=False)
    op.create_table('battle_showcases',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('is_public', sa.Boolean(), nullable=False),
    sa.Column('base_item_id', sa.String(length=36), nullable=True),
    sa.Column('slots', sa.JSON(), nullable=False),
    sa.CheckConstraint('revision > 0', name='ck_battle_showcases_0'),
    sa.ForeignKeyConstraint(['base_item_id'], ['archive_items.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('battle_squads',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('scope', sa.String(length=8), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('base_item_id', sa.String(length=36), nullable=True),
    sa.Column('slots', sa.JSON(), nullable=False),
    sa.CheckConstraint("scope IN ('REAL', 'SANDBOX')", name='ck_battle_squads_0'),
    sa.CheckConstraint('revision > 0', name='ck_battle_squads_1'),
    sa.ForeignKeyConstraint(['base_item_id'], ['archive_items.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'scope', name='uq_battle_squad_owner_scope')
    )
    op.create_index(op.f('ix_battle_squads_user_id'), 'battle_squads', ['user_id'], unique=False)
    op.create_table('economy_reward_contexts',
    sa.Column('entitlement_id', sa.String(length=36), nullable=False),
    sa.Column('activity_ids', sa.JSON(), nullable=False),
    sa.Column('rule_data', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['entitlement_id'], ['coin_entitlements.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('entitlement_id')
    )


def downgrade():
    op.drop_table('economy_reward_contexts')
    op.drop_table('battle_squads')
    op.drop_table('battle_showcases')
    op.drop_table('battle_item_reservations')
    op.drop_table('battle_rooms')
    op.drop_table('battle_actions')
    op.drop_table('battle_matches')
    op.drop_table('battle_artworks')
    op.drop_table('pack_guarantee_states')
    op.drop_table('economy_activities')
    op.drop_table('battle_ratings')
    op.drop_table('battle_queue')
    op.drop_table('battle_commands')
    op.drop_table('battle_assignments')
    op.drop_table('battle_seasons')
    op.drop_table('battle_definition_versions')
