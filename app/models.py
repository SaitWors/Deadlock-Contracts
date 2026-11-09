from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def uuid4() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    steam_id64: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True, index=True)
    account_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), default="Player")
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    locale: Mapped[str] = mapped_column(String(16), default="ru")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    xp: Mapped[int] = mapped_column(Integer, default=0)
    # Authorization role and presentation-only public badges. OWNER is never stored here.
    access_role: Mapped[str] = mapped_column(String(24), default="PLAYER", index=True)
    public_badges: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ArchiveCard(Base):
    __tablename__ = "archive_cards"
    __table_args__ = (CheckConstraint("revision > 0", name="ck_archive_card_revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    hero: Mapped[str] = mapped_column(String(40), index=True)
    rank: Mapped[str] = mapped_column(String(3), index=True)
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(600), default="")
    artist: Mapped[str] = mapped_column(String(100), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    image_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    crop_x: Mapped[int] = mapped_column(Integer, default=50)
    crop_y: Mapped[int] = mapped_column(Integer, default=50)
    zoom: Mapped[float] = mapped_column(Float, default=1.0)
    frame_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    review_note: Mapped[str] = mapped_column(String(600), default="")
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArchiveCipher(Base):
    __tablename__ = "archive_ciphers"
    __table_args__ = (UniqueConstraint("user_id", "week", "slot", name="uq_archive_cipher_slot"),
                     CheckConstraint("slot BETWEEN 1 AND 5", name="ck_archive_cipher_slot"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week: Mapped[date] = mapped_column(Date)
    slot: Mapped[int] = mapped_column(Integer)
    solution: Mapped[list[int]] = mapped_column(JSON)
    guesses: Mapped[list[list[int]]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArchiveLedger(Base):
    __tablename__ = "archive_ledger"
    __table_args__ = (UniqueConstraint("user_id", "source", name="uq_archive_ledger_source"),
                     CheckConstraint("scope IN ('REAL', 'SANDBOX')", name="ck_archive_ledger_scope"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(32))
    delta: Mapped[int] = mapped_column(Integer)
    scope: Mapped[str] = mapped_column(String(8), default="REAL", server_default="REAL")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArchivePack(Base):
    __tablename__ = "archive_packs"
    __table_args__ = (CheckConstraint("revision > 0", name="ck_archive_pack_revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    creator_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    starter: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArchivePackVersion(Base):
    __tablename__ = "archive_pack_versions"
    __table_args__ = (UniqueConstraint("pack_id", "revision", name="uq_archive_pack_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    pack_id: Mapped[str] = mapped_column(ForeignKey("archive_packs.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    # Immutable configuration, including its title, price, draw count and weighted pool.
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArchiveOperation(Base):
    __tablename__ = "archive_operations"
    __table_args__ = (
        UniqueConstraint("user_id", "request_key", name="uq_archive_operation_request"),
        UniqueConstraint("user_id", "benefit_key", name="uq_archive_operation_benefit"),
        CheckConstraint("scope IN ('REAL', 'SANDBOX')", name="ck_archive_operation_scope"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    request_key: Mapped[str] = mapped_column(String(36))
    signature: Mapped[str] = mapped_column(String(64))
    benefit_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    scope: Mapped[str] = mapped_column(String(8), default="REAL", server_default="REAL")
    pack_version_id: Mapped[str | None] = mapped_column(ForeignKey("archive_pack_versions.id", ondelete="RESTRICT"), nullable=True)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArchiveItem(Base):
    __tablename__ = "archive_items"
    __table_args__ = (
        CheckConstraint("cost_basis >= 0", name="ck_archive_item_cost"),
        CheckConstraint("scope IN ('REAL', 'SANDBOX')", name="ck_archive_item_scope"),
        Index("ix_archive_items_owner_card_state", "user_id", "card_id", "state"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    card_id: Mapped[str] = mapped_column(ForeignKey("archive_cards.id", ondelete="RESTRICT"), index=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey("archive_operations.id", ondelete="CASCADE"))
    cost_basis: Mapped[int] = mapped_column(Integer, default=0)
    test_grant: Mapped[bool] = mapped_column(Boolean, default=False)
    scope: Mapped[str] = mapped_column(String(8), default="REAL", server_default="REAL")
    state: Mapped[str] = mapped_column(String(16), default="OWNED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArchiveFavorite(Base):
    __tablename__ = "archive_favorites"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    card_id: Mapped[str] = mapped_column(ForeignKey("archive_cards.id", ondelete="CASCADE"), primary_key=True)


class ArchiveShowcase(Base):
    __tablename__ = "archive_showcases"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    card_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class PublicProfile(Base):
    __tablename__ = "public_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_public_profile_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    headline: Mapped[str] = mapped_column(String(96), default="")
    bio: Mapped[str] = mapped_column(String(360), default="")
    theme: Mapped[str] = mapped_column(String(24), default="DOSSIER")
    showcase_order: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["contracts", "achievements", "bureau"])
    pinned_contract_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    featured_achievement: Mapped[str | None] = mapped_column(String(32), nullable=True)
    show_achievements: Mapped[bool] = mapped_column(Boolean, default=True)
    show_bureau: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    show_stats: Mapped[bool] = mapped_column(Boolean, default=True)
    show_showcase: Mapped[bool] = mapped_column(Boolean, default=True)
    show_links: Mapped[bool] = mapped_column(Boolean, default=True)
    links: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CompanionPairing(Base):
    __tablename__ = "companion_pairings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_companion_pairing_user"),
    )

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_device_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CompanionDevice(Base):
    __tablename__ = "companion_devices"
    __table_args__ = (UniqueConstraint("user_id", "device_id", name="uq_companion_user_device"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(120), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(120), default="Deadlock Contracts Companion")
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    game_running: Mapped[bool] = mapped_column(Boolean, default=False)
    phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    game_match_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    game_mode_raw: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    current_match_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    gep_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    identity_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CompanionEvent(Base):
    __tablename__ = "companion_events"
    __table_args__ = (
        UniqueConstraint(
            "device_id",
            "client_event_id",
            name="uq_companion_event_device_client",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    device_id: Mapped[str] = mapped_column(ForeignKey("companion_devices.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_event_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    external_match_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    game_match_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class CompanionMatchEvidence(Base):
    __tablename__ = "companion_match_evidence"
    __table_args__ = (UniqueConstraint("user_id", "external_match_id", name="uq_companion_evidence_user_match"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("companion_devices.id", ondelete="CASCADE"), index=True)
    external_match_id: Mapped[int] = mapped_column(BigInteger, index=True)
    game_match_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    steam_id64: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    hero_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kills: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deaths: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assists: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hero_damage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    object_damage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    healing: Mapped[int | None] = mapped_column(Integer, nullable=True)
    souls: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Evidence v8 rows are legacy diagnostic evidence. Evidence v9 will
    # populate the session/lease/finality fields below explicitly.
    evidence_schema_version: Mapped[int] = mapped_column(Integer, default=8)
    # Do not reuse legacy companion_match_evidence.session_id.
    # That pre-Alembic field remains unmanaged by the ORM migration model.
    # Evidence v9 gets its own immutable GEP session identifier.
    gep_session_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    attempt_nonce_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    terminal_signal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    terminal_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    final_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gep_match_clock_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gep_local_team: Mapped[str | None] = mapped_column(String(16), nullable=True)
    gep_winning_team: Mapped[str | None] = mapped_column(String(16), nullable=True)
    integrity_status: Mapped[str] = mapped_column(
        String(32),
        default="LEGACY_DIAGNOSTIC",
        index=True,
    )

    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CompanionAttemptLease(Base):
    """Server-issued eligibility lease for one immutable Companion session.

    The table is intentionally usable for both active and queued sessions.
    A VERIFYING board may therefore receive ISSUED_QUEUED without consuming
    another contract attempt. Sessions with no eligible board may still be
    persisted as INELIGIBLE so a board locked mid-match cannot retroactively
    claim that match.
    """

    __tablename__ = "companion_attempt_leases"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "session_id",
            name="uq_companion_attempt_lease_user_session",
        ),
        UniqueConstraint(
            "attempt_nonce_hash",
            name="uq_companion_attempt_lease_nonce",
        ),
        Index(
            "ix_companion_attempt_lease_board_status",
            "board_id",
            "status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    device_id: Mapped[str] = mapped_column(
        ForeignKey("companion_devices.id", ondelete="CASCADE"),
        index=True,
    )

    # Nullable by design: an INELIGIBLE session is recorded even when no
    # suitable board existed when match_start reached the backend.
    board_id: Mapped[str | None] = mapped_column(
        ForeignKey("contract_boards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    session_id: Mapped[str] = mapped_column(String(80), index=True)
    attempt_nonce_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    game_match_mode: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        index=True,
    )
    external_match_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
        index=True,
    )

    # States:
    # ISSUED_ACTIVE, ISSUED_QUEUED, INELIGIBLE,
    # CONSUMED, CONSUMED_QUEUED, VOID, REJECTED.
    status: Mapped[str] = mapped_column(String(32), index=True)
    ineligible_reason: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
    )

    server_first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        index=True,
    )
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    voided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SessionToken(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Short-lived TOTP elevation belongs to the browser session, not the user.
    admin_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_totp_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    user: Mapped[User] = relationship()


class OpenIDState(Base):
    __tablename__ = "openid_states"

    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MissionDefinition(Base):
    __tablename__ = "mission_definitions"
    __table_args__ = (UniqueConstraint("key", "version", name="uq_mission_key_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(80), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    metric: Mapped[str] = mapped_column(String(120))
    operator: Mapped[str] = mapped_column(String(16))
    target: Mapped[float] = mapped_column(Float)
    reward_xp: Mapped[int] = mapped_column(Integer)
    base_xp: Mapped[int] = mapped_column(Integer, default=80)
    difficulty: Mapped[str] = mapped_column(String(24), default="FOCUSED", index=True)
    rarity: Mapped[str] = mapped_column(String(24), default="COMMON", index=True)
    drop_weight: Mapped[float] = mapped_column(Float, default=1.0)
    drop_chance_pct: Mapped[float] = mapped_column(Float, default=25.0)
    category: Mapped[str] = mapped_column(String(32), default="COMBAT", index=True)
    required_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    game_match_mode: Mapped[str] = mapped_column(String(32), default="STANDARD", index=True)
    ranked_policy: Mapped[str] = mapped_column(String(32), default="STANDARD_ONLY")
    status: Mapped[str] = mapped_column(String(32), default="PUBLISHED")
    safety_classification: Mapped[str] = mapped_column(String(32), default="WIN_ALIGNED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlayerBureau(Base):
    __tablename__ = "player_bureaus"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64))
    tagline: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(String(1200), default="")
    rules: Mapped[str] = mapped_column(String(1200), default="")
    language: Mapped[str] = mapped_column(String(8), default="ru")
    theme: Mapped[str] = mapped_column(String(24), default="DOSSIER")
    recruitment: Mapped[str] = mapped_column(String(24), default="APPLICATION")
    appearance: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    role_titles: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    welcome: Mapped[str] = mapped_column(String(500), default="", server_default="")
    listed: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    design_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    avatar_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    avatar_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cover_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    cover_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    moderation_note: Mapped[str] = mapped_column(String(1000), default="")
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BureauMembership(Base):
    __tablename__ = "bureau_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str] = mapped_column(ForeignKey("player_bureaus.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(24), default="OPERATIVE")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BureauApplication(Base):
    __tablename__ = "bureau_applications"
    __table_args__ = (UniqueConstraint("bureau_id", "user_id", name="uq_bureau_application"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str] = mapped_column(ForeignKey("player_bureaus.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BureauMembershipPeriod(Base):
    """Historical spells survive leaving; deleted accounts are anonymized."""
    __tablename__ = "bureau_membership_periods"
    __table_args__ = (Index("uq_bureau_open_period", "user_id", unique=True,
                           postgresql_where=text("left_at IS NULL"), sqlite_where=text("left_at IS NULL")),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str | None] = mapped_column(ForeignKey("player_bureaus.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BureauBan(Base):
    __tablename__ = "bureau_bans"
    __table_args__ = (UniqueConstraint("bureau_id", "user_id", name="uq_bureau_ban"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str] = mapped_column(ForeignKey("player_bureaus.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(300))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BureauReport(Base):
    __tablename__ = "bureau_reports"
    __table_args__ = (Index("uq_bureau_open_report", "bureau_id", "reporter_id", "kind", unique=True,
                           postgresql_where=text("status = 'OPEN'"), sqlite_where=text("status = 'OPEN'")),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str | None] = mapped_column(ForeignKey("player_bureaus.id", ondelete="SET NULL"), index=True)
    reporter_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    bureau_name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(24))
    message: Mapped[str] = mapped_column(String(1000))
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="OPEN", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    decision: Mapped[str] = mapped_column(String(24), default="")
    decision_note: Mapped[str] = mapped_column(String(1000), default="")
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BureauOperation(Base):
    __tablename__ = "bureau_operations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    bureau_id: Mapped[str | None] = mapped_column(ForeignKey("player_bureaus.id", ondelete="SET NULL"), index=True)
    template: Mapped[str] = mapped_column(String(24))
    target: Mapped[int] = mapped_column(Integer)
    min_contributors: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    contributors: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    cancel_reason: Mapped[str] = mapped_column(String(1000), default="")


class BureauOperationParticipant(Base):
    __tablename__ = "bureau_operation_participants"
    __table_args__ = (UniqueConstraint("operation_id", "user_id", name="uq_bureau_operation_player"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    operation_id: Mapped[str] = mapped_column(ForeignKey("bureau_operations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    earned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BureauContribution(Base):
    __tablename__ = "bureau_contributions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    operation_id: Mapped[str] = mapped_column(ForeignKey("bureau_operations.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("bureau_operation_participants.id", ondelete="CASCADE"), index=True)
    source_key: Mapped[str] = mapped_column(String(36), unique=True)
    source_option_id: Mapped[str | None] = mapped_column(ForeignKey("board_options.id", ondelete="SET NULL"))
    credited: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BureauContributionEvent(Base):
    __tablename__ = "bureau_contribution_events"
    __table_args__ = (UniqueConstraint("contribution_id", "revision", name="uq_bureau_contribution_revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    contribution_id: Mapped[str] = mapped_column(ForeignKey("bureau_contributions.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ContractBoard(Base):
    __tablename__ = "contract_boards"
    __table_args__ = (
        UniqueConstraint("user_id", "board_date", "game_match_mode", name="uq_board_user_date_mode"),
        Index(
            "uq_contract_active_user_mode",
            "user_id",
            "game_match_mode",
            unique=True,
            postgresql_where=text(
                "status IN ('LOCKED', 'VERIFYING', 'REVIEW_REQUIRED')"
            ),
            sqlite_where=text(
                "status IN ('LOCKED', 'VERIFYING', 'REVIEW_REQUIRED')"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    board_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(32), default="OFFERED")
    game_match_mode: Mapped[str] = mapped_column(String(32), default="STANDARD")
    seed: Mapped[str] = mapped_column(String(128))
    generation: Mapped[int] = mapped_column(Integer, default=0)
    generator_version: Mapped[str] = mapped_column(String(32), default="contracts-3.0.0-alpha.1")
    generator_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    baseline_match_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    attempts_used: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    offered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completion_result: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user: Mapped[User] = relationship()
    options: Mapped[list[BoardOption]] = relationship(back_populates="board", cascade="all, delete-orphan")


class BoardOption(Base):
    __tablename__ = "board_options"
    __table_args__ = (UniqueConstraint("board_id", "mission_definition_id", name="uq_board_mission"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    board_id: Mapped[str] = mapped_column(ForeignKey("contract_boards.id", ondelete="CASCADE"), index=True)
    mission_definition_id: Mapped[str] = mapped_column(ForeignKey("mission_definitions.id"), index=True)
    rendered_title: Mapped[str] = mapped_column(String(160))
    rendered_description: Mapped[str] = mapped_column(Text)
    metric: Mapped[str] = mapped_column(String(120))
    operator: Mapped[str] = mapped_column(String(16))
    target: Mapped[float] = mapped_column(Float)
    reward_xp: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[str] = mapped_column(String(24), default="FOCUSED")
    rarity: Mapped[str] = mapped_column(String(24), default="COMMON")
    drop_chance_pct: Mapped[float] = mapped_column(Float, default=25.0)
    category: Mapped[str] = mapped_column(String(32), default="COMBAT")
    conditions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    generator_meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    required_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    required_game_match_mode: Mapped[str] = mapped_column(String(32), default="STANDARD")
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="OFFERED", index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bound_match_id: Mapped[str | None] = mapped_column(ForeignKey("matches.id"), nullable=True, index=True)
    final_evaluation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    progress_current: Mapped[float | None] = mapped_column(Float, nullable=True)
    progress_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    board: Mapped[ContractBoard] = relationship(back_populates="options")
    mission: Mapped[MissionDefinition] = relationship()
    match: Mapped[Match | None] = relationship()


class BoardMatchCandidate(Base):
    __tablename__ = "board_match_candidates"
    __table_args__ = (
        UniqueConstraint(
            "board_id",
            "match_id",
            name="uq_board_match_candidate_board_match",
        ),
        Index(
            "uq_board_match_candidate_attempt",
            "board_id",
            "attempt_no",
            unique=True,
            postgresql_where=text("attempt_no IS NOT NULL"),
            sqlite_where=text("attempt_no IS NOT NULL"),
        ),
        Index(
            "ix_board_match_candidate_board_status",
            "board_id",
            "status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    board_id: Mapped[str] = mapped_column(
        ForeignKey("contract_boards.id", ondelete="CASCADE"),
        index=True,
    )
    match_id: Mapped[str] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="CAPTURED", index=True)
    attempt_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    capture_source: Mapped[str] = mapped_column(String(64))
    ignored_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        index=True,
    )
    bound_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )



class DailyRefreshState(Base):
    __tablename__ = "daily_refresh_state"
    __table_args__ = (UniqueConstraint("user_id", "board_date", name="uq_refresh_user_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    board_date: Mapped[date] = mapped_column(Date, index=True)
    free_rerolls_used: Mapped[int] = mapped_column(Integer, default=0)
    last_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AutoReviewCase(Base):
    __tablename__ = "auto_review_cases"
    __table_args__ = (
        UniqueConstraint("board_id", "match_id", name="uq_auto_review_board_match"),
        Index(
            "ix_auto_review_cases_status_priority_created",
            "status",
            "priority",
            "created_at",
        ),
        Index(
            "ix_auto_review_cases_claim_owner_expiry",
            "claimed_by_user_id",
            "claim_expires_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    board_id: Mapped[str] = mapped_column(ForeignKey("contract_boards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    reasons: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    claimed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            name="fk_auto_review_cases_claimed_by_user",
        ),
        nullable=True,
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    priority: Mapped[int] = mapped_column(Integer, default=50)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    external_match_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(64))
    provider_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    game_match_mode: Mapped[str] = mapped_column(String(32), default="UNKNOWN", index=True)
    provider_mode_raw: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mode_classifier_version: Mapped[str] = mapped_column(String(64))
    mode_confidence: Mapped[str] = mapped_column(String(32), default="LOW")
    scoring_status: Mapped[str] = mapped_column(String(32), default="SCORED")
    game_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=True)
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    raw_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # New trust/audit metadata. Existing rows are deliberately NOT upgraded
    # to SERVER_VERIFIED merely because the columns now exist.
    settlement_source: Mapped[str] = mapped_column(
        String(32),
        default="LEGACY",
        index=True,
    )
    integrity_status: Mapped[str] = mapped_column(
        String(32),
        default="LEGACY_DIAGNOSTIC",
        index=True,
    )
    audit_status: Mapped[str] = mapped_column(
        String(32),
        default="NOT_REQUESTED",
        index=True,
    )
    audited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    participants: Mapped[list[MatchParticipant]] = relationship(back_populates="match", cascade="all, delete-orphan")


class MatchParticipant(Base):
    __tablename__ = "match_participants"
    __table_args__ = (UniqueConstraint("match_id", "account_id", name="uq_match_account"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(BigInteger, index=True)
    steam_id64: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    hero_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team: Mapped[int | None] = mapped_column(Integer, nullable=True)
    won: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    kills: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deaths: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assists: Mapped[int | None] = mapped_column(Integer, nullable=True)
    net_worth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hero_damage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    object_damage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    healing: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    match: Mapped[Match] = relationship(back_populates="participants")


class Evaluation(Base):
    __tablename__ = "evaluations"
    __table_args__ = (UniqueConstraint("assignment_id", "revision", name="uq_evaluation_revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("board_options.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32))
    evidence_level: Mapped[str] = mapped_column(String(32), default="VERIFIED_SUMMARY")
    evaluator_version: Mapped[str] = mapped_column(String(64))
    progress_current: Mapped[float | None] = mapped_column(Float, nullable=True)
    progress_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    explanation: Mapped[str] = mapped_column(Text)
    facts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RewardLedgerEntry(Base):
    __tablename__ = "reward_ledger"
    __table_args__ = (UniqueConstraint("source_type", "source_id", name="uq_reward_source"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str] = mapped_column(String(64))
    asset: Mapped[str] = mapped_column(String(32), default="XP")
    delta: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    policy_version: Mapped[str] = mapped_column(String(32), default="xp-1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    type: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    board_id: Mapped[str | None] = mapped_column(
        ForeignKey("contract_boards.id", ondelete="SET NULL"), nullable=True, index=True
    )
    match_id: Mapped[str | None] = mapped_column(
        ForeignKey("matches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    game_match_mode: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=20)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(180), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    attempts: Mapped[int] = mapped_column(Integer, default=0)

    run_after: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        index=True,
    )
    dead_lettered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )


class TelegramModeratorBinding(Base):
    __tablename__ = "telegram_moderator_bindings"
    __table_args__ = (
        Index(
            "uq_telegram_moderator_bindings_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
        Index(
            "uq_telegram_moderator_bindings_active_telegram_user",
            "telegram_user_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
        Index("ix_telegram_moderator_bindings_user_revoked","user_id","revoked_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    telegram_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    telegram_first_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class TelegramLinkToken(Base):
    __tablename__ = "telegram_link_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        UniqueConstraint("outbox_event_id","destination","destination_key",name="uq_notification_delivery_destination"),
        Index("ix_notification_delivery_state_run_after","state","run_after"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    outbox_event_id: Mapped[str] = mapped_column(ForeignKey("outbox_events.id", ondelete="CASCADE"), index=True)
    destination: Mapped[str] = mapped_column(String(32), index=True)
    destination_key: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class TelegramUpdateReceipt(Base):
    __tablename__ = "telegram_update_receipts"
    update_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    update_type: Mapped[str] = mapped_column(String(32), index=True)
    state: Mapped[str] = mapped_column(String(32), index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ModerationDecisionDraft(Base):
    __tablename__ = "moderation_decision_drafts"
    __table_args__ = (
        UniqueConstraint("review_id","actor_user_id","source",name="uq_moderation_decision_draft_actor_source"),
        Index("ix_moderation_decision_draft_expiry","expires_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    review_id: Mapped[str] = mapped_column(ForeignKey("auto_review_cases.id", ondelete="CASCADE"), index=True)
    actor_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16))
    decisions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SystemAnnouncement(Base):
    """Immutable-after-publication system message managed by staff."""

    __tablename__ = "system_announcements"
    __table_args__ = (
        Index(
            "ix_system_announcements_public_window",
            "status",
            "starts_at",
            "ends_at",
            "priority",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    status: Mapped[str] = mapped_column(String(24), default="DRAFT", index=True)
    severity: Mapped[str] = mapped_column(String(24), index=True)
    presentation: Mapped[str] = mapped_column(String(24))
    effect: Mapped[str] = mapped_column(String(32), default="NONE")
    dismiss_policy: Mapped[str] = mapped_column(
        String(24),
        default="DISMISSIBLE",
    )

    title_ru: Mapped[str] = mapped_column(String(160))
    body_ru: Mapped[str] = mapped_column(Text)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    body_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    cta_label_ru: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cta_label_en: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cta_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    surfaces: Mapped[list[str]] = mapped_column(JSON, default=list)
    audiences: Mapped[list[str]] = mapped_column(JSON, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=50, index=True)
    show_countdown: Mapped[bool] = mapped_column(Boolean, default=False)

    starts_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    revision: Mapped[int] = mapped_column(Integer, default=1)
    supersedes_id: Mapped[str | None] = mapped_column(
        ForeignKey("system_announcements.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )
    updated_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )
    published_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    cancelled_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class SystemAnnouncementReceipt(Base):
    """Per-user state for one published announcement revision and surface."""

    __tablename__ = "system_announcement_receipts"
    __table_args__ = (
        UniqueConstraint(
            "announcement_id",
            "revision",
            "user_id",
            "surface",
            name="uq_announcement_receipt_subject",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    announcement_id: Mapped[str] = mapped_column(
        ForeignKey("system_announcements.id", ondelete="CASCADE"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    surface: Mapped[str] = mapped_column(String(32))
    first_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    impression_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class HeroVoteCampaign(Base):
    __tablename__ = "hero_vote_campaigns"
    __table_args__ = (CheckConstraint("revision > 0", name="ck_hero_vote_revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    title_ru: Mapped[str] = mapped_column(String(120))
    title_en: Mapped[str] = mapped_column(String(120))
    candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A nullable unique slot serializes activation without restricting drafts/history.
    active_slot: Mapped[str | None] = mapped_column(String(8), unique=True, nullable=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class HeroVoteSource(Base):
    __tablename__ = "hero_vote_sources"
    __table_args__ = (UniqueConstraint("campaign_id", "provider", name="uq_hero_vote_source"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("hero_vote_campaigns.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(24))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="PENDING")
    next_refresh_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HeroVoteSnapshot(Base):
    __tablename__ = "hero_vote_snapshots"
    __table_args__ = (Index("ix_hero_vote_snapshot_history", "source_id", "observed_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    source_id: Mapped[str] = mapped_column(ForeignKey("hero_vote_sources.id", ondelete="CASCADE"))
    counts: Mapped[dict[str, int]] = mapped_column(JSON)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvidenceSubmission(Base):
    __tablename__ = "evidence_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    board_id: Mapped[str] = mapped_column(ForeignKey("contract_boards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    channel: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    match_ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hero_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    external_reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EvidenceFile(Base):
    __tablename__ = "evidence_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    submission_id: Mapped[str] = mapped_column(ForeignKey("evidence_submissions.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(180))
    storage_name: Mapped[str] = mapped_column(String(180), unique=True)
    mime_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# Register the focused economy models for metadata creation and Alembic parity.
from . import coin_models as coin_models  # noqa: E402,F401
from . import economy_models as economy_models  # noqa: E402,F401
from . import battle_models as battle_models  # noqa: E402,F401
from . import pack_models as pack_models  # noqa: E402,F401
