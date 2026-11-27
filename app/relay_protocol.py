from __future__ import annotations

import hashlib
import hmac
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from anyio import from_thread
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuditLog, ContractRelayConnection, User, utcnow
from .relay_credentials import NODE_PATTERN
from .relay_models import RelayFriendship, RelayHeartbeat, RelayNode
from .security import rate_limit_allow
from .services.auth import require_csrf
from .services.relay_effectiveness import summary as effectiveness_summary
from .services.relay_state import friendship_query, iso, observation_allowed, summarize_connection, utc


PREFIX = "/api/internal/relay/v1"
ADMIN = "/api/admin/contract-relay"
MAX_AGE = timedelta(hours=24)
CLOCK_SKEW = timedelta(minutes=2)
FRESHNESS = timedelta(minutes=5)
PAGE_SIZE = 200
HISTORY_SIZE = 100
TOKEN = re.compile(rf"(?i:Bearer) (({NODE_PATTERN})\.[A-Za-z0-9_-]{{43}})")
VERSION = Annotated[str, Field(pattern=r"^[0-9][A-Za-z0-9.+-]{0,31}$")]
Count = Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]
ContainerStatus = Literal["running", "exited", "dead", "created", "restarting", "paused", "removing", "missing", "unknown"]
EventCode = Literal["host_snapshot_invalid", "host_snapshot_unavailable", "participant_sync_failed", "friendship_sync_failed"]
log = logging.getLogger(__name__)
router = APIRouter(prefix=PREFIX)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Upload(Strict):
    at: AwareDatetime
    count: Annotated[int, Field(strict=True, gt=0, le=2**31 - 1)]


class Metrics(Strict):
    metadata_used: Count | None = None
    metadata_available: Count | None = None
    history_used: Count | None = None
    history_available: Count | None = None
    cpu_percent: Annotated[float, Field(ge=0, le=1000)] | None = None
    ram_bytes: Annotated[int, Field(strict=True, ge=0, le=2**53 - 1)] | None = None


class IngestObservation(Strict):
    container_status: ContainerStatus
    gc_logs: Literal["recent", "stale", "missing", "unavailable"]
    observed_at: AwareDatetime | None = None
    container_started_at: AwareDatetime | None = None
    last_gc_event_at: AwareDatetime | None = None
    last_metadata_quota_signal_at: AwareDatetime | None = None
    last_history_rate_limit_at: AwareDatetime | None = None
    last_salt_upload: Upload | None = None
    ingest_version: VERSION | None = None
    steam_session: Literal["unknown", "active", "expired", "unavailable"] | None = None
    metrics: Metrics | None = None
    error: Literal["docker_inspect_failed", "docker_logs_failed"] | None = None


def _protocol_version(value):
    if type(value) is not int or value != 1:
        raise ValueError("Unsupported Relay protocol version")
    return value


ProtocolVersion = Annotated[Literal[1], BeforeValidator(_protocol_version)]


class Heartbeat(Strict):
    protocol_version: ProtocolVersion
    agent_version: VERSION
    observed_at: AwareDatetime
    ingest: IngestObservation
    events: Annotated[list[EventCode], Field(max_length=4)] = Field(default_factory=list)
    last_successful_cycle_at: AwareDatetime | None = None


class Friendship(Strict):
    connection_id: UUID
    observed_at: AwareDatetime
    state: Literal["connected", "disconnected", "unknown", "error"]
    source: Literal["manual"]


class FriendshipBatch(Strict):
    protocol_version: ProtocolVersion
    observations: Annotated[list[Friendship], Field(min_length=1, max_length=100)]


class NodeAction(Strict):
    action: Literal["enable", "disable", "revoke"]


def _unauthorized() -> HTTPException:
    return HTTPException(401, "Relay authentication failed", headers={"WWW-Authenticate": "Bearer"})


def _authorized(node: RelayNode | None, digest: str) -> bool:
    expected = (node.token_hash if node else None) or ("0" * 64)
    matches = hmac.compare_digest(expected, digest)
    return bool(matches and node and node.enabled and node.token_hash)


def _authenticate(request: Request, response: Response, db: Session, *, write: bool = False) -> RelayNode:
    response.headers["Cache-Control"] = "private, no-store"
    if not settings.relay_enabled or (settings.is_production and request.url.scheme != "https"):
        raise _unauthorized()
    auth = TOKEN.fullmatch(request.headers.get("Authorization", ""))
    if auth is None:
        raise _unauthorized()
    token, node_id = auth.groups()
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    node = db.get(RelayNode, node_id)
    if not _authorized(node, digest):
        raise _unauthorized()
    allowed, retry = from_thread.run(rate_limit_allow, f"relay:node:{node_id}", 60, 60)
    if not allowed:
        raise HTTPException(429, "Relay request limit exceeded", headers={"Retry-After": str(retry)})
    if write:
        node = db.get(RelayNode, node_id, populate_existing=True, with_for_update=True)
        if not _authorized(node, digest):
            raise _unauthorized()
    return node


def _accepted(applied: int) -> dict:
    return {"protocol_version": 1, "applied": applied}


def _check_time(observed_at: datetime, now: datetime) -> None:
    if not now - MAX_AGE <= observed_at <= now + CLOCK_SKEW:
        raise HTTPException(422, "Relay observation is outside the allowed time window")


@router.get("/participants")
def participants(request: Request, response: Response, after: UUID | None = None, db: Session = Depends(get_db)) -> dict:
    node = _authenticate(request, response, db)
    if not node.friendship_writes:
        raise HTTPException(403, "Relay credential may not read participant data")
    query = (
        select(ContractRelayConnection.id, User.steam_id64)
        .join(User, User.id == ContractRelayConnection.user_id)
        .where(User.status == "ACTIVE", User.steam_id64 > 0)
        .order_by(ContractRelayConnection.id)
        .limit(PAGE_SIZE + 1)
    )
    if after is not None:
        query = query.where(ContractRelayConnection.id > str(after))
    rows = db.execute(query).all()
    return {
        "protocol_version": 1,
        "participants": [{"connection_id": key, "steam_id64": str(steam_id)} for key, steam_id in rows[:PAGE_SIZE]],
        "next_cursor": rows[PAGE_SIZE - 1][0] if len(rows) > PAGE_SIZE else None,
    }


@router.post("/heartbeat")
def heartbeat(payload: Heartbeat, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    node = _authenticate(request, response, db, write=True)
    now = utcnow()
    _check_time(payload.observed_at, now)
    ingest = payload.ingest
    timestamps = (
        ingest.observed_at, ingest.container_started_at, ingest.last_gc_event_at,
        ingest.last_metadata_quota_signal_at, ingest.last_history_rate_limit_at,
        ingest.last_salt_upload.at if ingest.last_salt_upload else None, payload.last_successful_cycle_at,
    )
    if any(value and value > now + CLOCK_SKEW for value in timestamps):
        raise HTTPException(422, "Relay telemetry timestamp is in the future")
    if node.last_observed_at and payload.observed_at <= utc(node.last_observed_at):
        return _accepted(0)

    node.last_observed_at = payload.observed_at
    node.last_heartbeat_at = now
    node.agent_version = payload.agent_version
    if payload.last_successful_cycle_at and (
        node.last_successful_cycle_at is None or payload.last_successful_cycle_at > utc(node.last_successful_cycle_at)
    ):
        node.last_successful_cycle_at = payload.last_successful_cycle_at
    node.ingest = ingest.model_dump(mode="json", exclude_none=True)
    db.add(RelayHeartbeat(
        node_id=node.id, observed_at=payload.observed_at, received_at=now,
        events=sorted(set(payload.events)), container_status=ingest.container_status,
    ))
    db.flush()
    overflow = (
        select(RelayHeartbeat.id).where(RelayHeartbeat.node_id == node.id)
        .order_by(RelayHeartbeat.observed_at.desc()).offset(HISTORY_SIZE)
    )
    db.execute(delete(RelayHeartbeat).where(RelayHeartbeat.id.in_(overflow)))
    db.commit()
    return _accepted(1)


@router.post("/friendship-status")
def friendship_status(payload: FriendshipBatch, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    node = _authenticate(request, response, db, write=True)
    if not node.friendship_writes:
        raise HTTPException(403, "Relay credential may not submit friendship observations")
    now = utcnow()
    for item in payload.observations:
        _check_time(item.observed_at, now)

    # Lock the consent row while deciding whether the observation is still authorized.
    ids = {str(item.connection_id) for item in payload.observations}
    rows = db.scalars(
        select(ContractRelayConnection)
        .join(User, User.id == ContractRelayConnection.user_id)
        .where(ContractRelayConnection.id.in_(ids), User.status == "ACTIVE", User.steam_id64 > 0)
        .order_by(ContractRelayConnection.id)
        .with_for_update(of=ContractRelayConnection)
    )
    current = {row.id: row for row in rows}
    latest: dict[str, Friendship] = {}
    for item in payload.observations:
        key = str(item.connection_id)
        other = latest.get(key)
        if other is None or item.observed_at > other.observed_at:
            latest[key] = item
        elif item.observed_at == other.observed_at and item.state != other.state:
            raise HTTPException(422, "Conflicting Relay observations")

    applied = 0
    for key, item in latest.items():
        connection = current.get(key)
        if not connection or not observation_allowed(connection, item.observed_at):
            continue
        observation = db.get(RelayFriendship, (key, node.id))
        if observation is None:
            observation = RelayFriendship(connection_id=key, node_id=node.id)
            db.add(observation)
        elif item.observed_at <= utc(observation.observed_at):
            continue
        observation.state = item.state
        observation.observed_at = item.observed_at
        applied += 1

    if applied:
        db.commit()
        log.info("Relay friendship observations applied node=%s count=%s", node.id, applied)
    return _accepted(applied)


def _serialize_node(node: RelayNode, history: list[RelayHeartbeat], now: datetime) -> dict:
    effective = bool(settings.relay_enabled and node.enabled and node.token_hash)
    status = "disabled" if not effective else "unknown"
    if effective and node.last_heartbeat_at:
        status = "online" if utc(node.last_heartbeat_at) >= now - FRESHNESS else "stale"
    observed_at = (node.ingest or {}).get("observed_at")
    ingest_status = "unknown"
    if observed_at:
        ingest_status = "fresh" if datetime.fromisoformat(observed_at) >= now - FRESHNESS else "stale"
    return {
        "id": node.id, "enabled": node.enabled, "has_token": bool(node.token_hash),
        "friendship_writes": node.friendship_writes, "status": status, "ingest_status": ingest_status,
        "last_observed_at": iso(node.last_observed_at), "last_heartbeat_at": iso(node.last_heartbeat_at),
        "last_successful_cycle_at": iso(node.last_successful_cycle_at), "agent_version": node.agent_version,
        "ingest": node.ingest,
        "history": [
            {"observed_at": iso(row.observed_at), "received_at": iso(row.received_at),
             "events": row.events, "container_status": row.container_status}
            for row in history
        ],
    }


def build_admin_router(require_admin, require_owner) -> APIRouter:
    admin_router = APIRouter(prefix=ADMIN)

    @admin_router.get("")
    def overview(response: Response, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        now = utcnow()
        nodes = db.scalars(select(RelayNode).order_by(RelayNode.id)).all()
        history_by_node = defaultdict(list)
        for row in db.scalars(select(RelayHeartbeat).order_by(RelayHeartbeat.observed_at.desc())):
            if len(history_by_node[row.node_id]) < 20:
                history_by_node[row.node_id].append(row)
        observations = defaultdict(list)
        if settings.relay_enabled:
            for row in db.scalars(friendship_query()):
                observations[row.connection_id].append(row)
        counts = Counter({"connected": 0, "pending": 0, "disconnected": 0, "error": 0})
        for row in db.scalars(select(ContractRelayConnection).join(User, User.id == ContractRelayConnection.user_id)
                              .where(User.status == "ACTIVE", User.steam_id64 > 0)):
            counts[summarize_connection(row, observations[row.id], now)["status"]] += 1
        return {"integration_enabled": settings.relay_enabled, "participants": counts,
                "nodes": [_serialize_node(node, history_by_node[node.id], now) for node in nodes]}

    @admin_router.get("/effectiveness")
    def effectiveness(
        response: Response, days: Annotated[int, Query(ge=1, le=30)] = 7,
        admin: User = Depends(require_admin), db: Session = Depends(get_db),
    ) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        now = utcnow()
        return effectiveness_summary(db, now - timedelta(days=days), now, now=now)

    @admin_router.post("/nodes/{node_id}", dependencies=[Depends(require_csrf)])
    def manage_node(node_id: str, payload: NodeAction, owner: User = Depends(require_owner), db: Session = Depends(get_db)) -> dict:
        if not re.fullmatch(NODE_PATTERN, node_id):
            raise HTTPException(404, "Relay node not found")
        node = db.get(RelayNode, node_id, with_for_update=True)
        if not node:
            raise HTTPException(404, "Relay node not found")
        if payload.action == "enable" and not node.token_hash:
            raise HTTPException(409, "Install a Relay credential first")
        enabled = payload.action == "enable"
        if node.enabled != enabled or (payload.action == "revoke" and node.token_hash):
            node.enabled = enabled
            if payload.action == "revoke":
                node.token_hash = None
                db.execute(delete(RelayFriendship).where(RelayFriendship.node_id == node.id))
            db.add(AuditLog(user_id=owner.id, action=f"relay.node_{payload.action}",
                            entity_type="relay_node", entity_id=node.id, data={}))
            db.commit()
        return {"ok": True}

    return admin_router
