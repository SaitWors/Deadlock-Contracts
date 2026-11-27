"""Bounded local data and authenticated Relay transport."""

from __future__ import annotations

import json
import math
import os
import re
import ssl
import tempfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID


PROTOCOL = 1
API_PREFIX = "/api/internal/relay/v1"
MAX_JSON = 128 * 1024
CONTAINER_STATES = {
    "running", "exited", "dead", "created", "restarting", "paused", "removing", "missing", "unknown",
}
GC_STATES = {"recent", "stale", "missing", "unavailable"}
DOCKER_ERRORS = {"docker_inspect_failed", "docker_logs_failed"}
INGEST_TIMES = {
    "observed_at", "container_started_at", "last_gc_event_at", "last_metadata_quota_signal_at",
    "last_history_rate_limit_at",
}
FRIEND_STATES = {"connected", "disconnected", "unknown", "error"}


def utc(value: object) -> datetime:
    if not isinstance(value, str) or not 1 <= len(value) <= 40:
        raise ValueError("invalid UTC observation")
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() != timezone.utc.utcoffset(None):
        raise ValueError("expected UTC observation")
    return parsed


def identifier(value: object) -> str:
    if not isinstance(value, str) or len(value) != 36 or str(UUID(value)) != value:
        raise ValueError("invalid connection identifier")
    return value


def read_limited(path: Path, limit: int = MAX_JSON) -> bytes:
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise ValueError("local file exceeds size limit")
    return data


def read_json(path: Path) -> dict:
    result = json.loads(read_limited(path))
    if not isinstance(result, dict):
        raise ValueError("expected a JSON object")
    return result


def atomic_json(path: Path, payload: dict, mode: int = 0o600) -> None:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    if len(encoded) > MAX_JSON:
        raise ValueError("JSON exceeds size limit")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        if hasattr(os, "O_DIRECTORY"):
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def ingest_snapshot(payload: dict) -> dict:
    """Reconstruct the typed observation before it crosses the network."""
    container = payload.get("container_status")
    gc = payload.get("gc_logs")
    if not isinstance(container, str) or container not in CONTAINER_STATES or not isinstance(gc, str) or gc not in GC_STATES:
        raise ValueError("invalid Ingest status")
    result = {"container_status": container, "gc_logs": gc}
    for field in INGEST_TIMES:
        if field in payload:
            result[field] = utc(payload[field]).isoformat()
    if "last_salt_upload" in payload:
        upload = payload["last_salt_upload"]
        if not isinstance(upload, dict) or type(upload.get("count")) is not int or not 1 <= upload["count"] <= 100_000:
            raise ValueError("invalid upload count")
        result["last_salt_upload"] = {"at": utc(upload.get("at")).isoformat(), "count": upload["count"]}
    metrics = payload.get("metrics")
    if isinstance(metrics, dict):
        allowed = {}
        cpu = metrics.get("cpu_percent")
        ram = metrics.get("ram_bytes")
        if type(cpu) in (int, float) and math.isfinite(cpu) and 0 <= cpu <= 100_000:
            allowed["cpu_percent"] = cpu
        if type(ram) is int and 0 <= ram < 2**63:
            allowed["ram_bytes"] = ram
        if allowed:
            result["metrics"] = allowed
    return result


class RequestFailed(Exception):
    def __init__(self, status: int | None = None, retry_after: float = 0):
        self.status = status
        self.retry_after = retry_after
        super().__init__("Relay request failed")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retry_after_seconds(value: str | None) -> float:
    if value is None:
        return 0
    try:
        if value.isascii() and value.isdecimal() and len(value) <= 10:
            return int(value)
        return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return 0


class RelayClient:
    def __init__(self, base_url: str, token_file: Path):
        parts = urlsplit(base_url)
        if (
            parts.scheme != "https" or not parts.hostname or parts.username is not None or parts.password is not None
            or parts.query or parts.fragment or parts.path not in ("", "/") or parts.port == 0
            or any(ch.isspace() for ch in base_url)
        ):
            raise ValueError("expected a canonical HTTPS origin with no credentials or path")
        self.origin = base_url.rstrip("/")
        self.token_file = token_file
        self.opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

    def request(
        self, path: str, payload: dict | None = None, after: str | None = None, *, automatic: bool = False,
    ) -> dict:
        try:
            token = read_limited(self.token_file, 256).decode("ascii").strip()
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}\.[A-Za-z0-9_-]{43}", token):
                raise ValueError("invalid node token")
            url = self.origin + API_PREFIX + path
            query = {}
            if after:
                query["after"] = identifier(after)
            if automatic:
                query["automatic"] = "true"
            if query:
                url += "?" + urlencode(query)
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            body = None
            if payload is not None:
                headers["Content-Type"] = "application/json"
                body = json.dumps(payload, allow_nan=False).encode()
            req = Request(url, data=body, headers=headers)
            with self.opener.open(req, timeout=10) as response:
                data = response.read(MAX_JSON + 1)
            if len(data) > MAX_JSON:
                raise ValueError("Relay response exceeds size limit")
            result = json.loads(data)
            if not isinstance(result, dict) or type(result.get("protocol_version")) is not int or result["protocol_version"] != PROTOCOL:
                raise ValueError("invalid Relay response")
            if path == "/admissions":
                decision = result.get("decision")
                if decision == "allowed":
                    identifier(result.get("connection_id"))
                elif decision not in ("ineligible", "full") or result.get("connection_id") is not None:
                    raise ValueError("invalid Relay admission decision")
            elif payload is not None and (type(result.get("applied")) is not int or result["applied"] < 0):
                raise ValueError("invalid Relay acknowledgement")
            return result
        except HTTPError as error:
            with error:
                delay = retry_after_seconds(error.headers.get("Retry-After")) if error.headers else 0
            raise RequestFailed(error.code, delay) from None
        except (OSError, URLError, HTTPException, ValueError, RecursionError):
            raise RequestFailed() from None
