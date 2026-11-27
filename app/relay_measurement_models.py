from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class RelayMatchObservation(Base):
    __tablename__ = "relay_match_observations"
    __table_args__ = (Index("ix_relay_match_observations_observed_at", "observed_at"),)

    board_id: Mapped[str] = mapped_column(
        ForeignKey("contract_boards.id", ondelete="CASCADE"), primary_key=True,
    )
    match_id: Mapped[str] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True,
    )
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    relay_cohort: Mapped[str] = mapped_column(String(32))
    priority_streamer: Mapped[bool | None] = mapped_column(Boolean)
