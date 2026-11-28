"""Minimal browser activity records. Authoritative actions stay in their domain tables."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class FoundationAnalyticsEvent(Base):
    __tablename__ = "foundation_analytics_events"
    __table_args__ = (
        Index("ix_foundation_analytics_events_occurred_at", "occurred_at"),
        Index("ix_foundation_analytics_events_user_name_time", "user_id", "name", "occurred_at"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
