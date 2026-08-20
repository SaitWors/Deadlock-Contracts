from __future__ import annotations

from sqlalchemy import Engine, text


POSTGRES_ALTERS = [
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS base_xp INTEGER NOT NULL DEFAULT 80",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS difficulty VARCHAR(24) NOT NULL DEFAULT 'FOCUSED'",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS rarity VARCHAR(24) NOT NULL DEFAULT 'COMMON'",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS drop_weight DOUBLE PRECISION NOT NULL DEFAULT 1.0",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS drop_chance_pct DOUBLE PRECISION NOT NULL DEFAULT 25.0",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'COMBAT'",
    "ALTER TABLE mission_definitions ADD COLUMN IF NOT EXISTS ranked_policy VARCHAR(32) NOT NULL DEFAULT 'STANDARD_ONLY'",
    "ALTER TABLE contract_boards ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE contract_boards ADD COLUMN IF NOT EXISTS attempts_used INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE contract_boards ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3",
    "ALTER TABLE contract_boards ADD COLUMN IF NOT EXISTS generator_version VARCHAR(32) NOT NULL DEFAULT 'legacy-v3'",
    "ALTER TABLE contract_boards ALTER COLUMN generator_version SET DEFAULT 'contracts-3.0.0-alpha.1'",
    "ALTER TABLE contract_boards ADD COLUMN IF NOT EXISTS generator_history JSON NOT NULL DEFAULT '[]'::json",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS difficulty VARCHAR(24) NOT NULL DEFAULT 'FOCUSED'",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS rarity VARCHAR(24) NOT NULL DEFAULT 'COMMON'",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS drop_chance_pct DOUBLE PRECISION NOT NULL DEFAULT 25.0",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'COMBAT'",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS conditions JSON NOT NULL DEFAULT '[]'::json",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64)",
    "ALTER TABLE board_options ADD COLUMN IF NOT EXISTS generator_meta JSON NOT NULL DEFAULT '{}'::json",
    "CREATE INDEX IF NOT EXISTS ix_board_options_fingerprint ON board_options (fingerprint)",
    "ALTER TABLE contract_boards DROP CONSTRAINT IF EXISTS uq_board_user_date",
    "ALTER TABLE contract_boards DROP CONSTRAINT IF EXISTS uq_board_user_date_mode",
    "ALTER TABLE contract_boards ADD CONSTRAINT uq_board_user_date_mode UNIQUE (user_id, board_date, game_match_mode)",
]


POSTGRES_ADMIN_RBAC_ALTERS = [
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS admin_verified_at TIMESTAMPTZ",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS admin_totp_step BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS access_role VARCHAR(24) NOT NULL DEFAULT 'PLAYER'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS public_badges JSON NOT NULL DEFAULT '[]'::json",
    "CREATE INDEX IF NOT EXISTS ix_users_access_role ON users (access_role)",
]


def ensure_v03_schema(engine: Engine) -> None:
    """Small in-place bridge from the v0.2 preview schema.

    Fresh installs are created by SQLAlchemy metadata. Existing PostgreSQL
    installs need explicit ALTER statements because create_all() never changes
    an already existing table. This bridge is intentionally additive and keeps
    v0.2 data readable.
    """
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as connection:
        # web and worker may start together; serialize additive DDL.
        connection.execute(text("SELECT pg_advisory_xact_lock(440012)"))
        for statement in POSTGRES_ALTERS:
            connection.execute(text(statement))
        for statement in POSTGRES_ADMIN_RBAC_ALTERS:
            connection.execute(text(statement))
