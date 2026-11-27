from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class RelayNode(Base):
    __tablename__ = "relay_nodes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    token_hash: Mapped[str | None] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean)
    friendship_writes: Mapped[bool] = mapped_column(Boolean)
    last_observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_successful_cycle_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    agent_version: Mapped[str | None] = mapped_column(String(32))
    ingest: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))


class RelayHeartbeat(Base):
    __tablename__ = "relay_heartbeats"
    __table_args__ = (Index("ix_relay_heartbeats_node_time", "node_id", "observed_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("relay_nodes.id", ondelete="CASCADE"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    events: Mapped[list] = mapped_column(JSON)
    container_status: Mapped[str] = mapped_column(String(16))


class RelayFriendship(Base):
    __tablename__ = "relay_friendships"

    connection_id: Mapped[str] = mapped_column(
        ForeignKey("contract_relay_connections.id", ondelete="CASCADE"), primary_key=True,
    )
    node_id: Mapped[str] = mapped_column(ForeignKey("relay_nodes.id", ondelete="CASCADE"), primary_key=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(16))
