from __future__ import annotations

from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..config import settings
from ..models import ContractRelayConnection, OutboxEvent, User
from ..relay_models import RelayNode
from .relay_state import FRESHNESS, iso, utc


EVENT_TYPE = "contract_relay.operator_notification"
STOPPED = {"exited", "dead", "created", "paused", "removing", "missing"}
QUOTA_SIGNALS = {
    "history": ("last_history_rate_limit_at", "Steam GC ограничил запросы истории матчей"),
    "metadata": ("last_metadata_quota_signal_at", "Ingest сообщил об ограничении запросов метаданных"),
}
QUOTA_NAMES = {"history": "истории матчей", "metadata": "метаданных"}


def enabled() -> bool:
    return settings.relay_enabled and settings.relay_notifications_enabled


def _payload(kind: str, message: str, observed_at: datetime) -> dict:
    return {"type": kind, "message": f"Contract Relay — {message}", "occurred_at": iso(observed_at)}


def queue_application(db: Session, *, user_id: str, now: datetime) -> None:
    if enabled():
        _queue(
            db, kind="new_application",
            message="новая заявка на участие. Откройте раздел Contract Relay в админке.",
            key=f"{user_id}/{utc(now).date().isoformat()}", now=now,
        )


def _observed_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return utc(parsed) if parsed.tzinfo is not None else None


def _recent(value: datetime | None, now: datetime, age: timedelta) -> bool:
    return value is not None and now - age <= value <= now + FRESHNESS


def _event_id(entity: str, kind: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"deadlock-contracts/relay/{entity}/{kind}/{key}"))


def _queue(
    db: Session, *, kind: str, message: str, key: str, now: datetime,
    node: RelayNode | None = None, observed_at: datetime | None = None,
) -> None:
    entity = node.id if node else "contract_relay"
    payload = _payload(kind, message, observed_at or now)
    if node:
        payload["node_id"] = node.id
    insert = postgresql_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(
        insert(OutboxEvent).values(
            id=_event_id(entity, kind, key), event_type=EVENT_TYPE, aggregate_id=entity,
            payload=payload, created_at=now, run_after=now,
        ).on_conflict_do_nothing(index_elements=[OutboxEvent.id])
    )


def _collect_node(db: Session, node: RelayNode, now: datetime) -> str:
    heartbeat_at = utc(node.last_heartbeat_at) if node.last_heartbeat_at else None
    if heartbeat_at is None:
        return "нет heartbeat"
    if not _recent(heartbeat_at, now, FRESHNESS):
        _queue(
            db, kind="heartbeat_stale", message=f"нет свежего heartbeat от {node.id}",
            key=heartbeat_at.isoformat(), now=now, node=node,
        )
        return "heartbeat устарел"

    ingest = node.ingest or {}
    observed_at = _observed_timestamp(ingest.get("observed_at"))
    if not _recent(observed_at, now, FRESHNESS):
        return "нет свежего наблюдения Ingest"

    # Remind at most once per UTC hour while a fresh observation reports an ongoing problem.
    hour = now.strftime("%Y-%m-%dT%H")
    container_status = ingest.get("container_status")
    if container_status in STOPPED:
        _queue(
            db, kind="ingest_stopped", message=f"Ingest на {node.id} остановлен ({container_status})",
            key=hour, now=now, node=node, observed_at=observed_at,
        )
    if ingest.get("steam_session") == "expired":
        _queue(
            db, kind="steam_session_expired", message=f"наблюдение на {node.id} подтвердило истечение Steam-сессии",
            key=hour, now=now, node=node, observed_at=observed_at,
        )
    metrics = ingest.get("metrics") or {}
    for quota, (field, message) in QUOTA_SIGNALS.items():
        signal_at = _observed_timestamp(ingest.get(field))
        available = metrics.get(f"{quota}_available")
        if type(available) is int and available == 0:
            _queue(
                db, kind=f"{quota}_quota_exhausted", message=f"квота {QUOTA_NAMES[quota]} на {node.id} исчерпана",
                key=hour, now=now, node=node, observed_at=observed_at,
            )
        elif signal_at and _recent(signal_at, now, timedelta(hours=1)):
            _queue(
                db, kind=f"{quota}_rate_limited", message=f"{message} на {node.id}",
                key=signal_at.isoformat(), now=now, node=node, observed_at=signal_at,
            )
    return f"Ingest {container_status or 'unknown'}"


def collect(db: Session, now: datetime) -> None:
    if not enabled():
        return
    now = utc(now)
    nodes = db.scalars(select(RelayNode).where(
        RelayNode.enabled.is_(True), RelayNode.token_hash.is_not(None),
    ).order_by(RelayNode.id))
    states = [f"{node.id} — {_collect_node(db, node, now)}" for node in nodes]

    day_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_end - timedelta(days=1)
    day = day_start.date().isoformat()
    if db.get(OutboxEvent, _event_id("contract_relay", "daily_summary", day)):
        return
    applications = db.scalar(select(func.count()).select_from(OutboxEvent).where(
        OutboxEvent.event_type == EVENT_TYPE,
        OutboxEvent.payload["type"].as_string() == "new_application",
        OutboxEvent.created_at >= day_start,
        OutboxEvent.created_at < day_end,
    ))
    participants = db.scalar(select(func.count()).select_from(ContractRelayConnection).join(
        User, User.id == ContractRelayConnection.user_id,
    ).where(User.status == "ACTIVE", User.steam_id64 > 0))
    lines = [
        f"сводка за {day} UTC",
        f"Зарегистрировано новых заявок: {applications}",
        f"Активных подключений на момент сводки: {participants}",
        *states[:10],
    ]
    if not states:
        lines.append("Активных узлов нет")
    elif len(states) > 10:
        lines.append(f"Остальные узлы доступны в админке ({len(states) - 10})")
    _queue(db, kind="daily_summary", message="\n".join(lines), key=day, now=now)


class RelayNotificationDeliveryError(RuntimeError):
    pass


def send(event: OutboxEvent) -> None:
    headers = {
        "X-Relay-Webhook-Secret": settings.relay_n8n_webhook_secret,
        "Idempotency-Key": event.id,
    }
    data = {**event.payload, "schema_version": 1, "event_id": event.id}
    try:
        with httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client:
            response = client.post(settings.relay_n8n_webhook_url, json=data, headers=headers)
    except httpx.HTTPError:
        raise RelayNotificationDeliveryError("Relay n8n webhook request failed") from None
    if response.status_code != 204:
        raise RelayNotificationDeliveryError(f"Relay n8n webhook returned HTTP {response.status_code}")
