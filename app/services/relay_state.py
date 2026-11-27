from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import ContractRelayConnection, utcnow
from ..relay_models import RelayFriendship, RelayNode


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return utc(value).isoformat() if value else None


def friendship_query():
    return (
        select(RelayFriendship)
        .join(RelayNode, RelayNode.id == RelayFriendship.node_id)
        .where(RelayNode.enabled.is_(True), RelayNode.friendship_writes.is_(True), RelayNode.token_hash.is_not(None))
    )


def observation_allowed(connection: ContractRelayConnection, observed_at: datetime) -> bool:
    instant = utc(observed_at)
    return instant >= utc(connection.consented_at) and (
        connection.friendship_cleared_at is None or instant > utc(connection.friendship_cleared_at)
    )


def summarize_connection(connection: ContractRelayConnection, observations: list[RelayFriendship], now: datetime) -> dict:
    cutoff = now - timedelta(hours=24)
    latest = []
    if connection.friendship_confirmed_at:
        latest.append((utc(connection.friendship_confirmed_at), "connected", "manual"))
    latest.extend(
        (utc(row.observed_at), row.state, "steam_web_api" if row.source == "steam_web_api" else "relay_manual")
        for row in observations
        if utc(row.observed_at) >= cutoff and observation_allowed(connection, row.observed_at)
    )
    observed_at, state, source = max(latest, default=(None, "pending", None))
    return {
        "status": "pending" if state == "unknown" else state,
        "friendship_source": source,
        "friendship_observed_at": iso(observed_at),
    }


def connection_status(db: Session, connection: ContractRelayConnection) -> dict:
    observations = []
    if settings.relay_enabled:
        observations = list(db.scalars(friendship_query().where(RelayFriendship.connection_id == connection.id)))
    return summarize_connection(connection, observations, utcnow())
