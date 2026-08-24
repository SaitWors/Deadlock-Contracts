from __future__ import annotations

import ipaddress
import hashlib
import logging
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from http.cookies import SimpleCookie
from typing import Any

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
log = logging.getLogger(__name__)


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                retry_after = max(1, int(window_seconds - (now - events[0])))
                return False, retry_after
            events.append(now)
            # Opportunistic cleanup prevents unbounded growth on small servers.
            if len(self._events) > 20_000:
                for old_key in list(self._events)[:2_000]:
                    old_events = self._events[old_key]
                    while old_events and old_events[0] <= cutoff:
                        old_events.popleft()
                    if not old_events:
                        self._events.pop(old_key, None)
            return True, 0


class SharedSlidingWindowLimiter:
    SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = ttl
  if oldest[2] then retry = math.max(1, math.ceil(ttl - (now - tonumber(oldest[2])))) end
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl + 1)
return {1, 0}
"""

    def __init__(self, url: str, fallback: SlidingWindowLimiter) -> None:
        from redis.asyncio import Redis

        self._redis = Redis.from_url(url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1)
        self._fallback = fallback

    async def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.time()
        try:
            result = await self._redis.eval(
                self.SCRIPT,
                1,
                f"dc:rate:{key}",
                now,
                now - window_seconds,
                limit,
                window_seconds,
                f"{now:.6f}:{secrets.token_hex(8)}",
            )
            return bool(int(result[0])), int(result[1])
        except Exception:
            log.exception("Shared rate limiter unavailable; using process-local fallback")
            return self._fallback.allow(key, limit, window_seconds)

    async def ping(self) -> bool:
        try:
            return bool(await self._redis.ping())
        except Exception:
            log.exception("Shared rate limiter readiness check failed")
            return False


_local_limiter = SlidingWindowLimiter()
_limiter = SharedSlidingWindowLimiter(settings.rate_limit_redis_url, _local_limiter) if settings.rate_limit_redis_url else None


async def rate_limiter_ready() -> bool:
    if _limiter is None:
        return not settings.is_production
    return await _limiter.ping()


def _peer_is_trusted_proxy(scope: Scope) -> bool:
    client = scope.get("client")
    if not client:
        return False
    try:
        address = ipaddress.ip_address(str(client[0]))
        return any(address in ipaddress.ip_network(value, strict=False) for value in settings.trusted_proxy_networks)
    except ValueError:
        return False


def _client_ip(scope: Scope, headers: Headers) -> str:
    raw = ""
    if settings.trust_proxy_headers and _peer_is_trusted_proxy(scope):
        raw = headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if not raw:
        client = scope.get("client")
        raw = str(client[0]) if client else "unknown"
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return "unknown"


def _rate_rule(path: str) -> tuple[str, int, int] | None:
    if path.startswith("/static/") or path in {"/favicon.ico", "/robots.txt"}:
        return None
    if path == "/auth/steam" or path == "/auth/steam/callback":
        return "auth", settings.auth_rate_limit_per_10_minutes, 600
    if path == "/api/reviewer/access":
        return "overwolf-qa", 6, 900
    if path == "/api/admin/auth/totp":
        return "admin-totp", 8, 600
    if path == "/api/matches/sync":
        return "sync", settings.sync_rate_limit_per_hour, 3600
    if path in {"/api/companion/pairing/start", "/api/companion/pairing/claim"}:
        return "companion-pairing", 20, 600
    if path == "/api/companion/heartbeat":
        return "companion-heartbeat", 180, 60
    if path.startswith("/api/desktop/v1/"):
        return "companion-desktop", 240, 60
    return "global", settings.global_rate_limit_per_minute, 60


def _rate_identities(bucket: str, ip: str, headers: Headers) -> list[str]:
    """Apply both network and authenticated-principal buckets when possible."""
    identities = [f"{bucket}:ip:{ip}"]
    authorization = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
            identities.append(f"{bucket}:device:{digest}")
            return identities

    cookie_header = headers.get("cookie", "")
    if cookie_header:
        try:
            cookies = SimpleCookie()
            cookies.load(cookie_header)
            for name in ("__Host-dc_session", "dc_session"):
                if name in cookies and cookies[name].value:
                    digest = hashlib.sha256(cookies[name].value.encode("utf-8")).hexdigest()[:24]
                    identities.append(f"{bucket}:session:{digest}")
                    break
        except Exception:
            # Invalid Cookie syntax falls back to the IP bucket.
            pass
    return identities


def _origin_allowed(headers: Headers) -> bool:
    origin = headers.get("origin")
    if origin:
        return origin.rstrip("/") == settings.app_origin
    referer = headers.get("referer")
    if referer:
        return referer == settings.app_origin or referer.startswith(settings.app_origin + "/")
    # Non-browser clients cannot authenticate without a CSRF token anyway. A
    # missing Origin is tolerated for same-origin browser implementations that
    # omit it, while the token remains mandatory at the endpoint layer.
    return True


class RequestSecurityMiddleware:
    """ASGI guard for request size, basic rate limiting and origin checks."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        request_id = headers.get("x-request-id", "")
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", request_id):
            request_id = secrets.token_hex(12)
        scope.setdefault("state", {})["request_id"] = request_id

        content_length = headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.max_request_body_bytes:
                    await self._reject(send, 413, "Запрос слишком большой", request_id)
                    return
            except ValueError:
                await self._reject(send, 400, "Некорректный Content-Length", request_id)
                return

        bearer_client_path = path.startswith("/api/companion/") or path.startswith("/api/desktop/v1/")
        if method in UNSAFE_METHODS and path.startswith("/api/") and not bearer_client_path and not _origin_allowed(headers):
            await self._reject(send, 403, "Источник запроса не разрешён", request_id)
            return

        rule = _rate_rule(path)
        if rule:
            bucket, limit, window = rule
            ip = _client_ip(scope, headers)
            for identity in _rate_identities(bucket, ip, headers):
                if _limiter is not None:
                    allowed, retry_after = await _limiter.allow(identity, limit, window)
                else:
                    allowed, retry_after = _local_limiter.allow(identity, limit, window)
                if not allowed:
                    await self._reject(send, 429, "Слишком много запросов. Повторите позже.", request_id, retry_after)
                    return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > settings.max_request_body_bytes:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            await self._reject(send, 413, "Запрос слишком большой", request_id)

    @staticmethod
    async def _reject(
        send: Send,
        status_code: int,
        detail: str,
        request_id: str,
        retry_after: int | None = None,
    ) -> None:
        import json

        codes = {
            400: "BAD_REQUEST",
            403: "ORIGIN_REJECTED",
            413: "PAYLOAD_TOO_LARGE",
            429: "RATE_LIMITED",
        }
        code = codes.get(status_code, f"HTTP_{status_code}")
        error = {"code": code, "message_key": f"errors.{code.lower()}", "message": detail}
        body = json.dumps(
            {"detail": detail, **error, "error": error, "request_id": request_id},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        headers = [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"content-length", str(len(body)).encode("ascii")),
            (b"x-request-id", request_id.encode("latin-1", "ignore")),
            (b"cache-control", b"no-store"),
            (b"x-content-type-options", b"nosniff"),
        ]
        if retry_after is not None:
            headers.append((b"retry-after", str(retry_after).encode("ascii")))
        await send({"type": "http.response.start", "status": status_code, "headers": headers})
        await send({"type": "http.response.body", "body": body, "more_body": False})


class RequestBodyTooLarge(Exception):
    pass


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                request_id = scope.get("state", {}).get("request_id")
                csp = (
                    "default-src 'self'; "
                    "base-uri 'none'; "
                    "object-src 'none'; "
                    "frame-ancestors 'none'; "
                    "form-action 'self' https://steamcommunity.com; "
                    "script-src 'self'; "
                    "style-src-elem 'self'; "
                    "style-src-attr 'unsafe-inline'; "
                    "font-src 'self'; "
                    "connect-src 'self'; "
                    "img-src 'self' data: ""https://avatars.steamstatic.com "
                    "https://avatars.akamai.steamstatic.com "
                    "https://avatars.cloudflare.steamstatic.com "
                    "https://avatars.fastly.steamstatic.com "
                    "https://*.steamstatic.com "
                    "https://*.steamusercontent.com "
                    "https://steamcdn-a.akamaihd.net; "
                    "manifest-src 'self'"
                )
                if settings.is_production:
                    csp += "; upgrade-insecure-requests"
                additions = {
                    "content-security-policy": csp,
                    "x-content-type-options": "nosniff",
                    "x-frame-options": "DENY",
                    "referrer-policy": "no-referrer",
                    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
                    "cross-origin-opener-policy": "same-origin",
                    "cross-origin-resource-policy": "same-origin",
                    "x-permitted-cross-domain-policies": "none",
                }
                if settings.is_production:
                    additions["strict-transport-security"] = "max-age=31536000"
                if path.startswith("/api/") or path.startswith("/auth/"):
                    additions["cache-control"] = "no-store"
                elif path.startswith("/static/assets/"):
                    additions["cache-control"] = "public, max-age=86400"
                else:
                    additions["cache-control"] = "no-cache"
                if request_id:
                    additions["x-request-id"] = request_id
                existing = {key.lower() for key, _ in headers}
                for key, value in additions.items():
                    raw_key = key.encode("latin-1")
                    if raw_key not in existing:
                        headers.append((raw_key, value.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
