"""Signed economic policies and durable, separately deliverable coin decisions."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import utcnow, uuid4


class CoinPolicySnapshot(Base):
    __tablename__ = "coin_policy_snapshots"
    __table_args__ = (
        UniqueConstraint("assignment_id", name="uq_coin_policy_assignment"),
        CheckConstraint("amount >= 0 AND case_bonus >= 0", name="ck_coin_policy_amount"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("board_options.id", ondelete="CASCADE"), index=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("contract_boards.id", ondelete="CASCADE"), index=True)
    policy_version: Mapped[str] = mapped_column(String(32))
    mode: Mapped[str] = mapped_column(String(32))
    difficulty: Mapped[str] = mapped_column(String(24))
    amount: Mapped[int] = mapped_column(Integer)
    case_bonus: Mapped[int] = mapped_column(Integer)
    selected_count: Mapped[int] = mapped_column(Integer)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


@event.listens_for(CoinPolicySnapshot, "before_update")
def _immutable_signed_policy(mapper, connection, target):
    raise ValueError("A signed coin policy cannot be changed")


class CoinEntitlement(Base):
    __tablename__ = "coin_entitlements"
    __table_args__ = (
        UniqueConstraint("user_id", "source_type", "source_id", name="uq_coin_entitlement_source"),
        CheckConstraint("nominal_amount >= 0 AND amount >= 0 AND amount <= nominal_amount", name="ck_coin_entitlement_amount"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[str] = mapped_column(String(36))
    policy_version: Mapped[str] = mapped_column(String(32))
    policy_snapshot_id: Mapped[str | None] = mapped_column(ForeignKey("coin_policy_snapshots.id", ondelete="SET NULL"), nullable=True)
    evaluation_id: Mapped[str | None] = mapped_column(ForeignKey("evaluations.id", ondelete="SET NULL"), nullable=True)
    match_id: Mapped[str | None] = mapped_column(ForeignKey("matches.id", ondelete="SET NULL"), nullable=True)
    period_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_week: Mapped[date | None] = mapped_column(Date, nullable=True)
    nominal_amount: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)
    eligible: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24))
    ledger_source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CoinQuota(Base):
    __tablename__ = "coin_quotas"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "period_kind", "period_start", name="uq_coin_quota_period"),
        CheckConstraint("used >= 0", name="ck_coin_quota_used"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(24), default="CONTRACT")
    period_kind: Mapped[str] = mapped_column(String(8))
    period_start: Mapped[date] = mapped_column(Date)
    used: Mapped[int] = mapped_column(Integer, default=0)


class CoinCorrection(Base):
    __tablename__ = "coin_corrections"
    __table_args__ = (
        UniqueConstraint("user_id", "request_key", name="uq_coin_correction_request"),
        UniqueConstraint("entitlement_id", name="uq_coin_correction_entitlement"),
        CheckConstraint("delta <= 0", name="ck_coin_correction_delta"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    entitlement_id: Mapped[str] = mapped_column(ForeignKey("coin_entitlements.id", ondelete="CASCADE"), index=True)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    request_key: Mapped[str] = mapped_column(String(36))
    reason: Mapped[str] = mapped_column(String(300))
    delta: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
