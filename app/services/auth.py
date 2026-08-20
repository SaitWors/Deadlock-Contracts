from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import OpenIDState, SessionToken, User

log = logging.getLogger(__name__)

COOKIE_NAME = "__Host-dc_session" if settings.cookie_secure else "dc_session"
OPENID_COOKIE_NAME = "__Host-dc_openid_state" if settings.cookie_secure else "dc_openid_state"
REVIEWER_COOKIE_NAME = "__Host-dc_ow_qa" if settings.cookie_secure else "dc_ow_qa"
STEAM_ID64_BASE = 76561197960265728
STEAM_OPENID_NS = "http://specs.openid.net/auth/2.0"
STEAM_CLAIM_PREFIX = "https://steamcommunity.com/openid/id/"
STEAM_AVATAR_HOSTS = {
    "avatars.akamai.steamstatic.com",
    "avatars.cloudflare.steamstatic.com",
    "avatars.fastly.steamstatic.com",
    "steamcdn-a.akamaihd.net",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_secret(value: str, purpose: str) -> str:
    return hmac.new(
        settings.session_secret.encode("utf-8"),
        f"{purpose}:{value}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def hash_token(token: str) -> str:
    return hash_secret(token, "session")


def csrf_token(token: str) -> str:
    return hash_secret(token, "csrf")


def _cookie_options(max_age: int) -> dict:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "max_age": max_age,
        "path": "/",
    }


def create_session(db: Session, user: User, response: Response, old_token: str | None = None) -> None:
    # Rotate the browser session after authentication and cap the number of
    # active sessions to limit the effect of a forgotten/stolen token.
    if old_token:
        old = db.get(SessionToken, hash_token(old_token))
        if old:
            db.delete(old)

    now = utcnow()
    db.execute(delete(SessionToken).where(SessionToken.expires_at <= now))
    existing = list(
        db.scalars(
            select(SessionToken)
            .where(SessionToken.user_id == user.id)
            .order_by(SessionToken.created_at.desc())
        ).all()
    )
    for stale in existing[9:]:
        db.delete(stale)

    token = secrets.token_urlsafe(48)
    db.add(
        SessionToken(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=now + timedelta(days=settings.session_ttl_days),
        )
    )
    db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        **_cookie_options(settings.session_ttl_days * 86400),
    )


def clear_session(db: Session, response: Response, token: str | None) -> None:
    if token:
        stored = db.get(SessionToken, hash_token(token))
        if stored:
            db.delete(stored)
            db.commit()
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        secure=settings.cookie_secure,
        samesite="lax",
    )


def current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or len(raw) > 256:
        return None
    session = db.get(SessionToken, hash_token(raw))
    if not session:
        return None

    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    now = utcnow()
    if expires <= now:
        db.delete(session)
        db.commit()
        return None

    last_seen = session.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if now - last_seen > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()

    user = db.get(User, session.user_id)
    if not user or user.status != "ACTIVE":
        return None
    return user


def require_user(user: User | None = Depends(current_user_optional)) -> User:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется вход через Steam")
    return user


def csrf_for_request(request: Request) -> str | None:
    raw = request.cookies.get(COOKIE_NAME)
    return csrf_token(raw) if raw else None


def require_csrf(request: Request) -> None:
    raw = request.cookies.get(COOKIE_NAME)
    supplied = request.headers.get("X-CSRF-Token", "")
    if not raw or not supplied or len(supplied) > 128:
        raise HTTPException(status_code=403, detail="Проверка безопасности запроса не пройдена")
    expected = csrf_token(raw)
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=403, detail="Проверка безопасности запроса не пройдена")


def _qa_access_deadline() -> datetime | None:
    raw = settings.overwolf_qa_access_until.strip()
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if value.tzinfo is None:
        return None
    return value.astimezone(timezone.utc)


def reviewer_access_available() -> bool:
    deadline = _qa_access_deadline()
    return bool(settings.overwolf_qa_access_enabled and deadline is not None and utcnow() < deadline)


def verify_reviewer_access_code(code: str) -> bool:
    if not reviewer_access_available():
        return False
    if len(code) < 32 or len(code) > 128:
        return False
    candidate = hashlib.sha256(code.encode("utf-8")).hexdigest()
    expected = settings.overwolf_qa_access_code_hash
    return bool(re.fullmatch(r"[0-9a-f]{64}", expected) and hmac.compare_digest(candidate, expected))


def issue_reviewer_access(response: Response) -> None:
    deadline = _qa_access_deadline()
    if deadline is None:
        raise RuntimeError("Overwolf QA access is not configured")
    now = utcnow()
    # A reviewer grant is deliberately short lived even when the overall QA
    # window is longer. It is consumed immediately after successful Steam login.
    cookie_deadline = min(deadline, now + timedelta(hours=8))
    max_age = int((cookie_deadline - now).total_seconds())
    if max_age <= 0:
        raise RuntimeError("Overwolf QA access has expired")
    expires = int(cookie_deadline.timestamp())
    nonce = secrets.token_urlsafe(18)
    payload = f"{expires}.{nonce}"
    signature = hash_secret(payload, "overwolf-qa-access")
    response.set_cookie(REVIEWER_COOKIE_NAME, f"{payload}.{signature}", **_cookie_options(max_age))


def has_reviewer_access(request: Request) -> bool:
    if not reviewer_access_available():
        return False
    raw = request.cookies.get(REVIEWER_COOKIE_NAME, "")
    if not raw or len(raw) > 256:
        return False
    parts = raw.split(".")
    if len(parts) != 3:
        return False
    expires_text, nonce, signature = parts
    if not expires_text.isdigit() or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", nonce):
        return False
    payload = f"{expires_text}.{nonce}"
    expected = hash_secret(payload, "overwolf-qa-access")
    if not hmac.compare_digest(expected, signature):
        return False
    deadline = _qa_access_deadline()
    if deadline is None:
        return False
    expires = int(expires_text)
    return int(utcnow().timestamp()) < expires <= int(deadline.timestamp())


def clear_reviewer_access(response: Response) -> None:
    response.delete_cookie(REVIEWER_COOKIE_NAME, path="/", secure=settings.cookie_secure, samesite="lax")


def _openid_return_to(state: str) -> str:
    return f"{settings.app_base_url}/auth/steam/callback?{urlencode({'state': state})}"


def steam_login_url(state: str) -> str:
    params = {
        "openid.ns": STEAM_OPENID_NS,
        "openid.mode": "checkid_setup",
        "openid.return_to": _openid_return_to(state),
        "openid.realm": settings.app_base_url + "/",
        "openid.identity": STEAM_OPENID_NS + "/identifier_select",
        "openid.claimed_id": STEAM_OPENID_NS + "/identifier_select",
    }
    return settings.steam_openid_url + "?" + urlencode(params)


def begin_steam_login(db: Session, response: Response) -> str:
    now = utcnow()
    db.execute(delete(OpenIDState).where(OpenIDState.expires_at <= now))
    state = secrets.token_urlsafe(32)
    db.add(OpenIDState(state_hash=hash_secret(state, "openid-state"), expires_at=now + timedelta(minutes=10)))
    db.commit()
    response.set_cookie(
        OPENID_COOKIE_NAME,
        state,
        **_cookie_options(600),
    )
    return steam_login_url(state)


def _consume_openid_state(request: Request, db: Session) -> str:
    state = request.query_params.get("state", "")
    cookie_state = request.cookies.get(OPENID_COOKIE_NAME, "")
    if not state or len(state) > 128 or not hmac.compare_digest(state, cookie_state):
        raise HTTPException(400, "Сессия входа устарела или была подменена. Начните вход заново.")
    stored = db.get(OpenIDState, hash_secret(state, "openid-state"))
    if not stored:
        raise HTTPException(400, "Сессия входа уже использована или устарела. Начните вход заново.")
    expires = stored.expires_at if stored.expires_at.tzinfo else stored.expires_at.replace(tzinfo=timezone.utc)
    db.delete(stored)
    db.commit()
    if expires <= utcnow():
        raise HTTPException(400, "Сессия входа устарела. Начните вход заново.")
    return state


def _single_query_params(request: Request) -> dict[str, str]:
    result: dict[str, str] = {}
    counts: dict[str, int] = {}
    for key, value in request.query_params.multi_items():
        counts[key] = counts.get(key, 0) + 1
        if counts[key] > 1 and (key.startswith("openid.") or key == "state"):
            raise HTTPException(400, "Некорректный ответ Steam")
        result[key] = value
    return result


def verify_steam_callback(request: Request, db: Session) -> int:
    state = _consume_openid_state(request, db)
    params = _single_query_params(request)
    claimed_id = params.get("openid.claimed_id", "")
    identity = params.get("openid.identity", "")

    if params.get("openid.mode") != "id_res":
        raise HTTPException(400, "Steam не подтвердил вход")
    if params.get("openid.ns") != STEAM_OPENID_NS:
        raise HTTPException(400, "Некорректное пространство имён OpenID")
    if params.get("openid.op_endpoint") != settings.steam_openid_url:
        raise HTTPException(400, "Ответ получен не от ожидаемого OpenID endpoint")
    if params.get("openid.return_to") != _openid_return_to(state):
        raise HTTPException(400, "OpenID return_to не совпадает с ожидаемым адресом")
    if not params.get("openid.response_nonce"):
        raise HTTPException(400, "В ответе Steam отсутствует nonce")
    if not claimed_id or claimed_id != identity:
        raise HTTPException(400, "Steam не вернул согласованный идентификатор")

    check = {key: value for key, value in params.items() if key.startswith("openid.")}
    check["openid.mode"] = "check_authentication"
    timeout = httpx.Timeout(settings.request_timeout_seconds, connect=settings.request_connect_timeout_seconds)
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            headers={"User-Agent": f"Deadlock-Contracts/{settings.app_version}"},
        ) as client:
            response = client.post(settings.steam_openid_url, data=check)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Steam OpenID verification failed: %s", type(exc).__name__)
        raise HTTPException(502, "Steam временно не отвечает. Повторите вход позже.") from exc

    fields: dict[str, str] = {}
    for line in response.text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    if fields.get("is_valid") != "true":
        raise HTTPException(401, "Подпись Steam OpenID недействительна")

    match = re.fullmatch(r"https://steamcommunity\.com/openid/id/(\d{17,20})", claimed_id)
    if not match:
        raise HTTPException(400, "Некорректный SteamID в OpenID-ответе")
    steam_id64 = int(match.group(1))
    if steam_id64 < STEAM_ID64_BASE:
        raise HTTPException(400, "Некорректный SteamID")
    return steam_id64


def _safe_display_name(value: object, fallback: str) -> str:
    text = str(value or "").strip()
    text = "".join(ch for ch in text if ch >= " " and ch != "\x7f")
    return text[:120] or fallback


def _safe_avatar_url(value: object) -> str | None:
    """Accept only HTTPS avatar URLs hosted by Steam/Valve CDNs."""

    if not isinstance(value, str):
        return None

    value = value.strip()

    if not value:
        return None

    from urllib.parse import urlparse

    try:
        parsed = urlparse(value)
    except Exception:
        return None

    if parsed.scheme.lower() != "https":
        return None

    host = (parsed.hostname or "").lower().rstrip(".")

    allowed = (
        host == "avatars.steamstatic.com"
        or host.endswith(".steamstatic.com")
        or host == "steamcdn-a.akamaihd.net"
        or host.endswith(".steamusercontent.com")
    )

    if not allowed:
        return None

    return value

def fetch_steam_profile(steam_id64: int) -> tuple[str, str | None]:
    fallback = f"Steam {steam_id64}"
    if not settings.steam_web_api_key:
        return fallback, None
    timeout = httpx.Timeout(settings.request_timeout_seconds, connect=settings.request_connect_timeout_seconds)
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            headers={
                "User-Agent": f"Deadlock-Contracts/{settings.app_version}",
                "X-WebApi-Key": settings.steam_web_api_key,
            },
        ) as client:
            response = client.get(
                "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
                params={"steamids": str(steam_id64)},
            )
            response.raise_for_status()
            players = response.json().get("response", {}).get("players", [])
            if players and isinstance(players[0], dict):
                player = players[0]
                return _safe_display_name(player.get("personaname"), fallback), _safe_avatar_url(player.get("avatarfull"))
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        log.info("Steam profile enrichment unavailable: %s", type(exc).__name__)
    return fallback, None


def get_or_create_steam_user(db: Session, steam_id64: int) -> User:
    user = db.scalar(select(User).where(User.steam_id64 == steam_id64))
    display_name, avatar_url = fetch_steam_profile(steam_id64)
    if not user:
        user = User(
            steam_id64=steam_id64,
            account_id=steam_id64 - STEAM_ID64_BASE,
            display_name=display_name,
            avatar_url=avatar_url,
        )
        db.add(user)
    else:
        user.display_name = display_name
        user.avatar_url = avatar_url
        user.status = "ACTIVE"
    db.commit()
    db.refresh(user)
    return user
