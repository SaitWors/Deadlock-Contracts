"""Paid-card guarantee progress is shared by v2 packs and isolated by scope."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import utcnow, uuid4


class PackGuaranteeState(Base):
    __tablename__ = "pack_guarantee_states"
    __table_args__ = (
        UniqueConstraint("user_id", "scope", name="uq_pack_guarantee_user_scope"),
        CheckConstraint("scope IN ('REAL', 'SANDBOX')", name="ck_pack_guarantee_scope"),
        CheckConstraint("without_a >= 0 AND without_a < 30 AND without_s >= 0 AND without_s < 120 "
                        "AND without_sss >= 0 AND without_sss < 360", name="ck_pack_guarantee_counters"),
        CheckConstraint("revision >= 0", name="ck_pack_guarantee_revision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(8), default="REAL", server_default="REAL")
    without_a: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    without_s: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    without_sss: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
