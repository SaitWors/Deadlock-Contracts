from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import worker
from app.config import settings
from app.contract_relay import opt_in, opt_out
from app.db import Base
from app.models import OutboxEvent, User
from app.relay_models import RelayNode
from app.services import relay_notifications as notifications


NOW = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


@pytest.fixture
def configured(monkeypatch):
    result = replace(
        settings,
        relay_enabled=True,
        relay_notifications_enabled=True,
        relay_n8n_webhook_url="https://n8n.example.org/webhook/relay-alerts",
        relay_n8n_webhook_secret="test_" + "x" * 40,
    )
    monkeypatch.setattr(notifications, "settings", result)
    monkeypatch.setattr(worker, "settings", result)
    return result


def _node(db, *, updated_at, **ingest):
    node = RelayNode(
        id="mcg", token_hash="f" * 64, enabled=True, friendship_writes=False,
        last_heartbeat_at=updated_at,
        ingest={"observed_at": updated_at.isoformat(), **ingest},
    )
    db.add(node)
    db.commit()
    return node


def _events(db):
    return list(db.scalars(select(OutboxEvent).order_by(OutboxEvent.created_at)))


def _types(db):
    return [event.payload["type"] for event in _events(db)]


def test_maintenance_queues_a_stale_episode_and_daily_summary_once(db, configured):
    _node(db, updated_at=NOW - timedelta(minutes=6), container_status="exited", steam_session="expired")
    notifications.collect(db, NOW)
    db.commit()
    notifications.collect(db, NOW + timedelta(hours=2))
    db.commit()

    assert _types(db) == ["heartbeat_stale", "daily_summary"]
    assert _events(db)[0].payload["node_id"] == "mcg"
    assert "2026-11-26" in _events(db)[1].payload["message"]


def test_fresh_diagnostics_are_distinct_and_deduplicated(db, configured):
    node = _node(
        db, updated_at=NOW, container_status="exited", steam_session="expired",
        last_history_rate_limit_at=(NOW - timedelta(minutes=1)).isoformat(),
        metrics={"metadata_available": 0},
    )
    notifications.collect(db, NOW)
    db.commit()
    later = NOW + timedelta(minutes=2)
    node.last_heartbeat_at = later
    node.ingest = {**node.ingest, "observed_at": later.isoformat()}
    db.commit()
    notifications.collect(db, later)
    db.commit()

    assert _types(db) == [
        "ingest_stopped", "steam_session_expired", "history_rate_limited",
        "metadata_quota_exhausted", "daily_summary",
    ]


def test_missing_telemetry_does_not_claim_steam_expiry_or_quota(db, configured):
    _node(
        db, updated_at=NOW, container_status="unknown", steam_session="unavailable",
        last_history_rate_limit_at=(NOW - timedelta(hours=3)).isoformat(),
        metrics={"metadata_available": None},
    )
    notifications.collect(db, NOW)
    db.commit()

    assert _types(db) == ["daily_summary"]


def test_opt_in_queues_once_without_player_identifiers(db, configured):
    user = User(display_name="Private", steam_id64=76561197960265737, account_id=9)
    db.add(user)
    db.commit()
    opt_in(Response(), user, db)
    opt_in(Response(), user, db)
    opt_out(Response(), user, db)
    opt_in(Response(), user, db)

    assert _types(db) == ["new_application"]
    payload = _events(db)[0].payload
    assert set(payload) == {"type", "message", "occurred_at"}
    assert "Private" not in str(payload)
    assert "76561197960265737" not in str(payload)


def test_disabled_feature_keeps_pending_delivery_in_outbox(db, configured, monkeypatch):
    notifications.collect(db, NOW)
    db.commit()
    disabled = replace(configured, relay_notifications_enabled=False)
    monkeypatch.setattr(notifications, "settings", disabled)
    notifications.collect(db, NOW + timedelta(days=1))
    db.commit()
    assert _types(db) == ["daily_summary"]
    assert worker.dispatch_outbox(db) is False
    assert _events(db)[0].published_at is None


def test_delivery_marks_only_explicit_n8n_ack_and_reuses_event_id(db, configured, monkeypatch):
    notifications.collect(db, NOW)
    db.commit()
    monkeypatch.setattr(worker, "utcnow", lambda: NOW + timedelta(minutes=5))
    event = _events(db)[0]
    requests = []
    statuses = iter([200, 204])

    def receive(request):
        requests.append(request)
        return httpx.Response(next(statuses))

    client_class = httpx.Client
    monkeypatch.setattr(
        notifications.httpx, "Client",
        lambda **options: client_class(transport=httpx.MockTransport(receive), **options),
    )

    assert worker.dispatch_outbox(db) is True
    db.refresh(event)
    assert event.attempts == 1 and event.published_at is None
    event.run_after = NOW
    db.commit()
    assert worker.dispatch_outbox(db) is True
    db.refresh(event)
    assert event.published_at is not None
    assert requests[0].content == requests[1].content
    assert requests[0].headers["idempotency-key"] == event.id
    assert requests[0].headers["x-relay-webhook-secret"] == configured.relay_n8n_webhook_secret
    assert configured.relay_n8n_webhook_secret.encode() not in requests[0].content


def test_worker_requires_https_webhook_and_separate_secret(configured):
    worker_settings = replace(configured, service_role="worker")
    worker_settings.validate()
    with pytest.raises(RuntimeError, match="CONTRACT_RELAY_N8N_WEBHOOK_URL"):
        replace(worker_settings, relay_n8n_webhook_url="https://example.org/webhook?q=secret").validate()
    with pytest.raises(RuntimeError, match="CONTRACT_RELAY_N8N_WEBHOOK_SECRET"):
        replace(worker_settings, relay_n8n_webhook_secret="short").validate()
