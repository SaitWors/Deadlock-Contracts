from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, text
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


class PublicProfile(Base):
    __tablename__ = "public_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_public_profile_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    headline: Mapped[str] = mapped_column(String(96), default="")
    bio: Mapped[str] = mapped_column(String(360), default="")
    theme: Mapped[str] = mapped_column(String(24), default="DOSSIER")
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
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


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
    __table_args__ = (UniqueConstraint("board_id", "match_id", name="uq_auto_review_board_match"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    board_id: Mapped[str] = mapped_column(ForeignKey("contract_boards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    reasons: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
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
