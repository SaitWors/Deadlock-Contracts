"""Arena persistence, separate from independently verified Valve matches."""
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column, synonym

from .db import Base
from .models import utcnow, uuid4


class BattleDefinitionVersion(Base):
    __tablename__ = "battle_definition_versions"
    __table_args__ = (UniqueConstraint("key", "version", name="uq_battle_definition_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(40), index=True)
    category: Mapped[str] = mapped_column(String(8))
    version: Mapped[int] = mapped_column(Integer, default=1)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    rules: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


@event.listens_for(BattleDefinitionVersion, "before_update")
def immutable_definition(mapper, connection, target):
    raise ValueError("Published battle definitions are immutable; append a version")


class BattleArtwork(Base):
    __tablename__ = "battle_artworks"
    card_id: Mapped[str] = mapped_column(ForeignKey("archive_cards.id", ondelete="CASCADE"), primary_key=True)
    definition_id: Mapped[str] = mapped_column(ForeignKey("battle_definition_versions.id", ondelete="RESTRICT"), index=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)


class BattleSquad(Base):
    __tablename__ = "battle_squads"
    __table_args__ = (UniqueConstraint("user_id", "scope", name="uq_battle_squad_owner_scope"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(8), default="REAL")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    base_item_id: Mapped[str | None] = mapped_column(ForeignKey("archive_items.id", ondelete="SET NULL"), nullable=True)
    slots: Mapped[list] = mapped_column(JSON, default=list)


class BattleAssignment(Base):
    __tablename__ = "battle_assignments"
    __table_args__ = (UniqueConstraint("user_id", "period_day", "slot", "scope", name="uq_battle_assignment_slot"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    period_day: Mapped[date] = mapped_column(Date)
    slot: Mapped[int] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String(16))
    scope: Mapped[str] = mapped_column(String(8), default="REAL")
    opponent: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="OPEN")
    match_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    winning_match_id = synonym("match_id")


class BattleMatch(Base):
    __tablename__ = "battle_matches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    opponent_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    mode: Mapped[str] = mapped_column(String(16))
    scope: Mapped[str] = mapped_column(String(8), default="REAL")
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    round: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[dict] = mapped_column(JSON)
    snapshot: Mapped[dict] = mapped_column(JSON)
    bot_plan: Mapped[list] = mapped_column(JSON, default=list)
    last_events: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(8), nullable=True)
    winner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assignment_id: Mapped[str | None] = mapped_column(ForeignKey("battle_assignments.id", ondelete="SET NULL"), nullable=True, index=True)
    season_id: Mapped[str | None] = mapped_column(ForeignKey("battle_seasons.id", ondelete="SET NULL"), nullable=True)
    reward_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    reward: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at = synonym("finished_at")


class BattleItemReservation(Base):
    __tablename__ = "battle_item_reservations"
    item_id: Mapped[str] = mapped_column(ForeignKey("archive_items.id", ondelete="CASCADE"), primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("battle_matches.id", ondelete="CASCADE"), index=True)


class BattleAction(Base):
    __tablename__ = "battle_actions"
    __table_args__ = (UniqueConstraint("match_id", "user_id", "request_key", name="uq_battle_action_request"),
                     UniqueConstraint("match_id", "round", "user_id", name="uq_battle_action_round"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    match_id: Mapped[str] = mapped_column(ForeignKey("battle_matches.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    request_key: Mapped[str] = mapped_column(String(36))
    round: Mapped[int] = mapped_column(Integer)
    signature: Mapped[str] = mapped_column(String(64))
    actions: Mapped[list] = mapped_column(JSON)
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BattleCommand(Base):
    __tablename__ = "battle_commands"
    __table_args__ = (UniqueConstraint("user_id", "request_key", name="uq_battle_command_request"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    request_key: Mapped[str] = mapped_column(String(36))
    signature: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON, default=dict)


class BattleRoom(Base):
    __tablename__ = "battle_rooms"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opponent_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    scope: Mapped[str] = mapped_column(String(8), default="REAL")
    status: Mapped[str] = mapped_column(String(16), default="WAITING")
    confirmations: Mapped[dict] = mapped_column(JSON, default=dict)
    match_id: Mapped[str | None] = mapped_column(ForeignKey("battle_matches.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BattleSeason(Base):
    __tablename__ = "battle_seasons"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(80))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=False)


class BattleRating(Base):
    __tablename__ = "battle_ratings"
    season_id: Mapped[str] = mapped_column(ForeignKey("battle_seasons.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    rating: Mapped[int] = mapped_column(Integer, default=1000)
    games: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    earned_title: Mapped[str] = mapped_column(String(24), default="RECRUIT")


class BattleQueue(Base):
    __tablename__ = "battle_queue"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    season_id: Mapped[str] = mapped_column(ForeignKey("battle_seasons.id", ondelete="CASCADE"), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    rating: Mapped[int] = mapped_column(Integer)
    budget: Mapped[int] = mapped_column(Integer)
    experience: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BattleShowcase(Base):
    __tablename__ = "battle_showcases"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    base_item_id: Mapped[str | None] = mapped_column(ForeignKey("archive_items.id", ondelete="SET NULL"), nullable=True)
    slots: Mapped[list] = mapped_column(JSON, default=list)


# Database boundaries remain effective for administrative scripts as well as HTTP.
for _model, _checks in (
    (BattleDefinitionVersion, ("version > 0", "category IN ('HERO', 'BASE')")),
    (BattleSquad, ("scope IN ('REAL', 'SANDBOX')", "revision > 0")),
    (BattleAssignment, ("scope IN ('REAL', 'SANDBOX')", "slot BETWEEN 1 AND 3", "mode IN ('ASSIGNED', 'HARD')", "status IN ('OPEN', 'COMPLETED')")),
    (BattleMatch, ("scope IN ('REAL', 'SANDBOX')", "revision > 0", "round BETWEEN 1 AND 12", "status IN ('ACTIVE', 'FINISHED')",
                   "mode IN ('TUTORIAL', 'TRAINING', 'ASSIGNED', 'HARD', 'TRIAL', 'WEEKLY', 'COPY', 'FRIENDLY', 'RANKED')")),
    # Legacy entries use the combat round; gwent-v1 entries use its global
    # command turn so several cards can be played within the same round.
    (BattleAction, ("round BETWEEN 1 AND 256",)),
    (BattleRoom, ("scope IN ('REAL', 'SANDBOX')", "status IN ('WAITING', 'STARTED', 'CLOSED')")),
    (BattleSeason, ("ends_at > starts_at",)),
    (BattleRating, ("games >= 0", "wins >= 0 AND wins <= games")),
    (BattleQueue, ("budget BETWEEN 0 AND 24", "experience >= 0")),
    (BattleShowcase, ("revision > 0",)),
):
    for _index, _expression in enumerate(_checks):
        _model.__table__.append_constraint(CheckConstraint(_expression, name=f"ck_{_model.__tablename__}_{_index}"))
