"""Durable server activity facts backing the remaining bounded coin sources."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import utcnow, uuid4


class EconomyActivity(Base):
    __tablename__ = "economy_activities"
    __table_args__ = (UniqueConstraint("user_id", "kind", "source_id", name="uq_economy_activity_source"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[str] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EconomyRewardContext(Base):
    __tablename__ = "economy_reward_contexts"

    entitlement_id: Mapped[str] = mapped_column(ForeignKey("coin_entitlements.id", ondelete="CASCADE"), primary_key=True)
    activity_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    rule_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


@event.listens_for(EconomyActivity, "before_update")
@event.listens_for(EconomyRewardContext, "before_update")
def immutable_economy_fact(mapper, connection, target):
    raise ValueError("Economic source facts are immutable; correct the entitlement instead")
