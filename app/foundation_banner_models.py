from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class FoundationBanner(Base):
    __tablename__ = "foundation_banners"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), default="favorite_hero", server_default="favorite_hero")
    selected_card_id: Mapped[str | None] = mapped_column(ForeignKey("archive_cards.id", ondelete="SET NULL"))
    daily_card_id: Mapped[str | None] = mapped_column(ForeignKey("archive_cards.id", ondelete="SET NULL"))
    daily_date: Mapped[date | None] = mapped_column(Date)
    daily_account_id: Mapped[int | None] = mapped_column(BigInteger)
    stat_account_id: Mapped[int | None] = mapped_column(BigInteger)
    hero_id: Mapped[int | None] = mapped_column(Integer)
    hero_observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_refresh_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_pause_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
