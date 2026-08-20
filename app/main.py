from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import secrets
import urllib.error
import urllib.request
from urllib.parse import urlparse
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, exists, func, or_, select, text
from sqlalchemy.orm import Session, selectinload
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .models import (
    AuditLog,
    AutoReviewCase,
    EvidenceFile,
    EvidenceSubmission,
    BoardOption,
    CompanionDevice,
    CompanionEvent,
    CompanionMatchEvidence,
    CompanionPairing,
    ContractBoard,
    Evaluation,
    Job,
    Match,
    MatchParticipant,
    MissionDefinition,
    OpenIDState,
    PublicProfile,
    RewardLedgerEntry,
    SessionToken,
    User,
)
from .security import RequestSecurityMiddleware, SecurityHeadersMiddleware
from .services.auth import (
    COOKIE_NAME,
    OPENID_COOKIE_NAME,
    begin_steam_login,
    clear_reviewer_access,
    clear_session,
    create_session,
    csrf_for_request,
    current_user_optional,
    fetch_steam_profile,
    get_or_create_steam_user,
    hash_token,
    has_reviewer_access,
    issue_reviewer_access,
    require_csrf,
    require_user,
    reviewer_access_available,
    verify_reviewer_access_code,
    verify_steam_callback,
)
from .services.companion import claim_pairing, create_pairing, get_device_by_token, record_snapshot, serialize_device
from .services.contract_factory import GENERATOR_VERSION, generate_contracts_v2, preview_payload
from .services.boards import GAME_MODES, ensure_daily_board, ensure_daily_boards, lock_board, normalize_mode, refresh_summary, reroll_board, serialize_board, today_utc, upgrade_offered_boards_to_contracts_v2
from .services.jobs import enqueue_job
from .services.seed import seed_missions
from .services.totp import verify_totp
from .services.progression import user_progression
from .services.adaptive_profile import build_adaptive_profile
from .services.leaderboard import TRUSTED_REWARD_SOURCES, public_leaderboard as build_public_leaderboard
from .services.schema import ensure_v03_schema

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OverwolfQaAccessRequest(StrictModel):
    code: str = Field(min_length=32, max_length=128)


class LockRequest(StrictModel):
    option_ids: list[UUID] = Field(min_length=1, max_length=3)
    mode: Literal["STANDARD", "RANKED", "STREET_BRAWL"] = "STANDARD"


class MockMatchRequest(StrictModel):
    scenario: Literal["success", "mixed", "failure", "unknown_mode", "missing_data"] = "success"
    mode: Literal["STANDARD", "RANKED", "STREET_BRAWL"] = "STANDARD"




class AutoReviewDecisionItem(StrictModel):
    option_id: UUID
    status: Literal["COMPLETED", "FAILED", "VOID"]
    progress_current: float | None = None
    explanation: str = Field(min_length=5, max_length=800)


class AutoReviewDecisionRequest(StrictModel):
    status: Literal["RESOLVED", "REJECTED"] = "RESOLVED"
    reviewer_note: str = Field(default="", max_length=1500)
    options: list[AutoReviewDecisionItem] = Field(default_factory=list, max_length=3)


class AdminTotpRequest(StrictModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class AdminJobRetryRequest(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


class AdminIdentityUpdateRequest(StrictModel):
    access_role: Literal["PLAYER", "TESTER", "ADMIN"]
    badges: list[Literal["DEVELOPER", "STREAMER", "EARLY_TESTER", "CONTRIBUTOR"]] = Field(default_factory=list, max_length=4)


class AdminUserStatusRequest(StrictModel):
    status: Literal["ACTIVE", "SUSPENDED"]
    reason: str = Field(min_length=3, max_length=300)


class AdminXpAdjustRequest(StrictModel):
    delta: int = Field(ge=-100000, le=100000)
    reason: str = Field(min_length=3, max_length=300)


class AdminMissionUpdateRequest(StrictModel):
    title: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, min_length=5, max_length=1200)
    target: float | None = Field(default=None, ge=0, le=100000000)
    reward_xp: int | None = Field(default=None, ge=0, le=10000)
    base_xp: int | None = Field(default=None, ge=0, le=10000)
    difficulty: Literal["LIGHT", "FOCUSED", "HARD", "EXTREME"] | None = None
    rarity: Literal["COMMON", "UNCOMMON", "RARE", "EPIC"] | None = None
    drop_weight: float | None = Field(default=None, gt=0, le=100)
    drop_chance_pct: float | None = Field(default=None, ge=0, le=100)
    category: Literal["COMBAT", "SUPPORT", "ECONOMY", "SURVIVAL"] | None = None
    status: Literal["PUBLISHED", "DISABLED"] | None = None


class PublicProfileUpdateRequest(StrictModel):
    slug: str = Field(min_length=3, max_length=32, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    headline: str = Field(default="", max_length=96)
    bio: str = Field(default="", max_length=360)
    theme: Literal["DOSSIER", "NOIR", "SIGNAL"] = "DOSSIER"
    is_public: bool = False
    show_stats: bool = True
    show_showcase: bool = True
    show_links: bool = True
    links: dict[str, str] = Field(default_factory=dict)


class AdminGeneratorPreviewRequest(StrictModel):
    mode: Literal["STANDARD", "RANKED", "STREET_BRAWL"]
    boards: int = Field(default=10, ge=1, le=40)
    seed_prefix: str = Field(default="admin-preview", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")


class CompanionClaimRequest(StrictModel):
    code: str = Field(min_length=8, max_length=12)
    device_id: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    label: str = Field(default="Deadlock Contracts Companion", min_length=3, max_length=120)
    version: str | None = Field(default=None, max_length=32)


class CompanionLiveStats(StrictModel):
    hero_id: int | None = Field(default=None, ge=0, le=10_000)
    kills: int | None = Field(default=None, ge=0, le=500)
    deaths: int | None = Field(default=None, ge=0, le=500)
    assists: int | None = Field(default=None, ge=0, le=1_000)
    hero_damage: int | None = Field(default=None, ge=0, le=100_000_000)
    object_damage: int | None = Field(default=None, ge=0, le=100_000_000)
    healing: int | None = Field(default=None, ge=0, le=100_000_000)
    souls: int | None = Field(default=None, ge=0, le=10_000_000)


class CompanionHeartbeatRequest(StrictModel):
    game_running: bool = False
    steam_id64: int | None = None
    phase: str | None = Field(default=None, max_length=64)
    game_mode: dict[str, Any] | str | None = None
    match_id: int | None = Field(default=None, ge=1)
    gep_version: str | None = Field(default=None, max_length=64)
    version: str | None = Field(default=None, max_length=32)
    live_stats: CompanionLiveStats | None = None
    # Companion v0.4.0-alpha.4 (Evidence schema v6) adds session telemetry.
    # Keep StrictModel/default-deny semantics, but explicitly accept only the
    # frozen submitted build's documented fields. This prevents 422 responses
    # without opening the endpoint to arbitrary extra payload keys.
    session_id: str | None = Field(default=None, max_length=96)
    session_started_at: str | None = Field(default=None, max_length=64)
    session_ended_at: str | None = Field(default=None, max_length=64)
    session_start_reason: str | None = Field(default=None, max_length=64)
    session_end_reason: str | None = Field(default=None, max_length=64)
    match_clock_s: int | None = Field(default=None, ge=0, le=6 * 60 * 60)
    match_clock_observed_at: str | None = Field(default=None, max_length=64)
    local_team: Literal["AMBER", "SAPPHIRE"] | None = None
    match_outcome: Literal["AMBER", "SAPPHIRE"] | None = None
    # Evidence schema v7: the Companion records when Deadlock emitted an actual
    # match_outcome info-update while one exact Match ID was current. A plain
    # cached/getInfo winner label stays diagnostic-only because it can belong
    # to the previous match.
    match_outcome_event_at: str | None = Field(default=None, max_length=64)
    match_outcome_event_match_id: int | None = Field(default=None, ge=1)
    event_type: Literal["heartbeat", "game_started", "game_stopped", "match_started", "match_ended", "phase_changed"] = "heartbeat"


class DeleteAccountRequest(StrictModel):
    confirmation: Literal["DELETE"]


class EvidenceFileInput(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
    data_base64: str = Field(min_length=32, max_length=5_000_000)


class EvidenceSubmitRequest(StrictModel):
    board_id: UUID
    channel: Literal["TELEGRAM", "DISCORD"]
    notes: str = Field(default="", max_length=1500)
    hero_name: str = Field(default="", max_length=80)
    match_started_at: datetime | None = None
    match_ended_at: datetime | None = None
    files: list[EvidenceFileInput] = Field(min_length=1, max_length=4)
    attestation: Literal[True]


class EvidenceDecisionItem(StrictModel):
    option_id: UUID
    status: Literal["COMPLETED", "FAILED", "UNVERIFIABLE"]
    progress_current: float | None = None
    explanation: str = Field(min_length=5, max_length=800)


class EvidenceDecisionRequest(StrictModel):
    status: Literal["APPROVED", "REJECTED", "NEEDS_INFO"]
    reviewer_note: str = Field(default="", max_length=1500)
    options: list[EvidenceDecisionItem] = Field(default_factory=list, max_length=3)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    Base.metadata.create_all(engine)
    ensure_v03_schema(engine)
    Path(settings.evidence_dir).mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        seed_missions(db)
        upgraded_boards = upgrade_offered_boards_to_contracts_v2(db)
        if upgraded_boards:
            log.info("Contracts 2.0 upgraded %s offered legacy boards", upgraded_boards)
        db.execute(delete(SessionToken).where(SessionToken.expires_at <= now))
        db.execute(delete(OpenIDState).where(OpenIDState.expires_at <= now))
        db.execute(delete(CompanionPairing).where(CompanionPairing.expires_at <= now))
        companion_cutoff = now - timedelta(days=settings.companion_event_retention_days)
        db.execute(delete(CompanionEvent).where(CompanionEvent.created_at < companion_cutoff))
        db.execute(delete(CompanionMatchEvidence).where(CompanionMatchEvidence.captured_at < companion_cutoff))
        cutoff = now - timedelta(days=settings.evidence_retention_days)
        old_evidence = list(
            db.scalars(
                select(EvidenceFile)
                .join(EvidenceSubmission, EvidenceSubmission.id == EvidenceFile.submission_id)
                .where(EvidenceSubmission.created_at < cutoff)
            ).all()
        )
        for evidence in old_evidence:
            (Path(settings.evidence_dir) / evidence.storage_name).unlink(missing_ok=True)
            db.delete(evidence)
        db.commit()
    yield


app = FastAPI(
    title="Deadlock Contracts API",
    version=settings.app_version,
    debug=False,
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    max_age=600,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts))
app.add_middleware(RequestSecurityMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    log.exception("Unhandled request error id=%s path=%s", request_id, request.url.path)
    if request.url.path.startswith("/api/"):
        return JSONResponse(
            {"detail": "Внутренняя ошибка сервиса", "request_id": request_id},
            status_code=500,
        )
    return JSONResponse({"detail": "Internal Server Error"}, status_code=500)


@app.exception_handler(HTTPException)
async def safe_http_exception(request: Request, exc: HTTPException):
    return await http_exception_handler(request, exc)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "deadlock-contracts", "version": settings.app_version}


@app.get("/api/ready")
def ready(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ready"}


@app.get("/api/status")
def status() -> dict:
    return {
        "version": settings.app_version,
        "environment": settings.app_env,
        "mode": "THREE_MODE",
        "post_match_only": True,
        "steam_login_available": True,
        "steam_profile_enrichment": bool(settings.steam_web_api_key),
        "closed_alpha": settings.closed_alpha,
        "overwolf_qa_reviewer_gateway": reviewer_access_available(),
        "provider_configured": settings.provider == "deadlock_api",
        "deadlock_api_key_configured": bool(settings.deadlock_api_key),
        "contact_email": settings.contact_email or None,
    }


@app.post("/api/auth/demo")
def demo_login(response: Response, request: Request, db: Session = Depends(get_db)) -> dict:
    if not settings.allow_demo_auth:
        raise HTTPException(404, "Демо-авторизация отключена")
    steam_id64 = 76561198083722456
    user = db.scalar(select(User).where(User.steam_id64 == steam_id64))
    if not user:
        user = User(
            steam_id64=steam_id64,
            account_id=steam_id64 - 76561197960265728,
            display_name="Local Investigator",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    create_session(db, user, response, request.cookies.get(COOKIE_NAME))
    return {"authenticated": True, "user": serialize_user(user)}


@app.post("/api/reviewer/access")
def overwolf_qa_access(payload: OverwolfQaAccessRequest, response: Response) -> dict[str, bool]:
    if not reviewer_access_available():
        # Do not advertise a dormant reviewer gateway outside the active QA window.
        raise HTTPException(404, "Overwolf QA access is not available")
    if not verify_reviewer_access_code(payload.code):
        log.warning("Rejected Overwolf QA access attempt")
        raise HTTPException(403, "Invalid or expired QA access code")
    issue_reviewer_access(response)
    response.headers["Cache-Control"] = "no-store"
    return {"authorized": True}


@app.get("/auth/steam")
def steam_login(db: Session = Depends(get_db)) -> RedirectResponse:
    response = RedirectResponse("/", status_code=302)
    response.headers["Location"] = begin_steam_login(db, response)
    return response


@app.get("/auth/steam/callback")
def steam_callback(request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    # Reviewer authorization is deliberately checked before Steam verification,
    # but only becomes useful after a valid Steam OpenID callback. It bypasses
    # only the Closed Alpha allowlist, never RBAC/admin authorization.
    qa_access = has_reviewer_access(request)
    try:
        steam_id64 = verify_steam_callback(request, db)
        allowlisted = str(steam_id64) in settings.alpha_allowed_steam_ids
        if settings.closed_alpha and not allowlisted and not qa_access:
            raise HTTPException(403, "Закрытая альфа: этот Steam-аккаунт пока не приглашён")
        user = get_or_create_steam_user(db, steam_id64)
        if user.status != "ACTIVE":
            raise HTTPException(403, "account_suspended")
    except HTTPException as exc:
        if exc.status_code >= 500:
            code = "steam_unavailable"
        elif exc.status_code == 403 and exc.detail == "account_suspended":
            code = "account_suspended"
        elif exc.status_code == 403:
            code = "closed_alpha"
        else:
            code = "steam_rejected"
        response = RedirectResponse(f"/?auth_error={code}", status_code=303)
        response.delete_cookie(
            OPENID_COOKIE_NAME,
            path="/",
            secure=settings.cookie_secure,
            samesite="lax",
        )
        return response
    response = RedirectResponse("/?login=ok", status_code=303)
    response.delete_cookie(
        OPENID_COOKIE_NAME,
        path="/",
        secure=settings.cookie_secure,
        samesite="lax",
    )
    create_session(db, user, response, request.cookies.get(COOKIE_NAME))
    if qa_access:
        # One-shot reviewer grant: after a successful Steam login the temporary
        # cookie is consumed. The normal authenticated player session remains.
        clear_reviewer_access(response)
    db.add(AuditLog(
        user_id=user.id,
        action="auth.login.overwolf_qa" if qa_access else "auth.login",
        entity_type="user",
        entity_id=user.id,
        data={"access_path": "overwolf_qa"} if qa_access else {},
    ))
    db.commit()
    return response


@app.post("/api/auth/logout", dependencies=[Depends(require_csrf)])
def logout(response: Response, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    db.add(AuditLog(user_id=user.id, action="auth.logout", entity_type="user", entity_id=user.id, data={}))
    db.commit()
    clear_session(db, response, request.cookies.get(COOKIE_NAME))
    return {"ok": True}


ACCESS_ROLES = {"PLAYER", "TESTER", "ADMIN"}
PUBLIC_BADGES = {"DEVELOPER", "STREAMER", "EARLY_TESTER", "CONTRIBUTOR"}
BADGE_ORDER = ("CREATOR", "ADMIN", "DEVELOPER", "STREAMER", "EARLY_TESTER", "TESTER", "CONTRIBUTOR", "PLAYER")


def _effective_access_role(user: User) -> str:
    # OWNER is derived exclusively from the server-side SteamID allowlist.
    # A database write or browser request cannot manufacture/remove OWNER.
    if str(user.steam_id64 or "") in settings.admin_steam_ids:
        return "OWNER"
    role = str(getattr(user, "access_role", "PLAYER") or "PLAYER").upper()
    return role if role in ACCESS_ROLES else "PLAYER"


def _display_badges(user: User) -> list[str]:
    role = _effective_access_role(user)
    automatic = {
        "OWNER": "CREATOR",
        "ADMIN": "ADMIN",
        "TESTER": "TESTER",
        "PLAYER": "PLAYER",
    }[role]
    stored = {
        str(item).upper()
        for item in (getattr(user, "public_badges", None) or [])
        if str(item).upper() in PUBLIC_BADGES
    }
    badges = {automatic, *stored}
    return [item for item in BADGE_ORDER if item in badges]


PROFILE_LINK_HOSTS: dict[str, tuple[str, ...]] = {
    "twitch": ("twitch.tv", "www.twitch.tv"),
    "youtube": ("youtube.com", "www.youtube.com", "youtu.be"),
    "telegram": ("t.me", "telegram.me"),
    "discord": ("discord.gg", "discord.com", "www.discord.com"),
}


def _clean_profile_links(values: dict[str, str] | None) -> dict[str, str]:
    result: dict[str, str] = {}
    normalized = {str(key).strip().lower(): raw for key, raw in (values or {}).items()}
    unknown = sorted(set(normalized) - set(PROFILE_LINK_HOSTS))
    if unknown:
        raise HTTPException(422, f"Неподдерживаемый social link: {unknown[0]}")
    for key, raw in normalized.items():
        value = str(raw or "").strip()
        if not value:
            continue
        if len(value) > 240:
            raise HTTPException(422, f"Ссылка {key} слишком длинная")
        parsed = urlparse(value)
        if parsed.scheme not in {"https"} or (parsed.hostname or "").lower() not in PROFILE_LINK_HOSTS[key]:
            raise HTTPException(422, f"Для {key} разрешена только официальная HTTPS-ссылка")
        result[key] = value
    return result


def _profile_showcase(db: Session, user: User, limit: int = 3) -> list[dict]:
    rows = db.execute(
        select(BoardOption, ContractBoard, Match)
        .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
        .outerjoin(Match, Match.id == BoardOption.bound_match_id)
        .where(
            ContractBoard.user_id == user.id,
            BoardOption.selected.is_(True),
            BoardOption.status == "COMPLETED",
        )
        .order_by(BoardOption.reward_xp.desc(), BoardOption.settled_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": option.id,
            "title": option.rendered_title,
            "description": option.rendered_description,
            "mode": board.game_match_mode,
            "difficulty": option.difficulty,
            "rarity": option.rarity,
            "reward_xp": option.reward_xp,
            "explanation": option.explanation,
            "match_id": match.external_match_id if match else None,
            "settled_at": option.settled_at.isoformat() if option.settled_at else None,
        }
        for option, board, match in rows
    ]


def _public_profile_payload(db: Session, user: User, profile: PublicProfile, *, private: bool = False) -> dict:
    progression = user_progression(db, user)
    payload = {
        "slug": profile.slug,
        "headline": profile.headline,
        "bio": profile.bio,
        "theme": profile.theme,
        "is_public": bool(profile.is_public),
        "show_stats": bool(profile.show_stats),
        "show_showcase": bool(profile.show_showcase),
        "show_links": bool(profile.show_links),
        "links": dict(profile.links or {}) if (private or profile.show_links) else {},
        "player": {
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "badges": _display_badges(user),
            "level": progression["level"],
            # XP is a progression statistic; respect the public stats toggle.
            "xp": user.xp if (private or profile.show_stats) else None,
            # Account creation time is useful in the private editor but is not
            # needed to render a public dossier. Keep the public payload lean.
            "joined_at": user.created_at.isoformat() if (private and user.created_at) else None,
        },
        "stats": {
            "contracts_completed": progression["contracts_completed"],
            "contracts_failed": progression["contracts_failed"],
            "mode_stats": progression["mode_stats"],
            "hardest_completed": progression["hardest_completed"],
        } if (private or profile.show_stats) else None,
        "showcase": _profile_showcase(db, user) if (private or profile.show_showcase) else [],
        "public_url": f"/u/{profile.slug}" if profile.is_public else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }
    return payload


def _suggest_profile_slug(user: User) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (user.display_name or "player").lower()).strip("-")
    suffix = str(user.account_id or user.steam_id64 or "player")[-6:]
    base = (base[:24] or "player").strip("-")
    return f"{base}-{suffix}"[:32].strip("-")


def serialize_user(user: User) -> dict:
    role = _effective_access_role(user)
    return {
        "id": user.id,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "xp": user.xp,
        "status": user.status,
        "access_role": role,
        "badges": _display_badges(user),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_admin": role in {"OWNER", "ADMIN"},
        "can_manage_roles": role == "OWNER",
    }


@app.get("/api/me")
def me(request: Request, user: User | None = Depends(current_user_optional)) -> dict:
    return {
        "authenticated": bool(user),
        "user": serialize_user(user) if user else None,
        "csrf_token": csrf_for_request(request) if user else None,
        "release": {
            "version": settings.app_version,
            "label": "0.9.13-rc1 Admin Console MAX",
            "post_match_only": True,
            "modes": list(GAME_MODES),
            "manual_verification": False,
            "companion_download_url": settings.companion_download_url or None,
        },
    }


def _provider_status(db: Session, board_id: str) -> dict | None:
    board = db.get(ContractBoard, board_id)

    if not board:
        return None

    selected = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board_id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )

    all_bound_ids = {
        option.bound_match_id
        for option in selected
        if option.bound_match_id
    }

    active_bound_ids = {
        option.bound_match_id
        for option in selected
        if option.bound_match_id
        and option.status not in {"COMPLETED", "FAILED"}
    }

    if board.status == "SETTLED":
        external_id = None

        if all_bound_ids:
            matches = [
                db.get(Match, match_id)
                for match_id in all_bound_ids
            ]
            matches = [item for item in matches if item]

            if matches:
                external_id = max(
                    matches,
                    key=lambda item: item.external_match_id,
                ).external_match_id

        return {
            "phase": "SETTLED",
            "message": (
                f"Дело закрыто. Использовано матчей: "
                f"{board.attempts_used}/{board.max_attempts}."
            ),
            "match_id": external_id,
        }

    if active_bound_ids:
        match = db.get(
            Match,
            next(iter(active_bound_ids)),
        )

        external_id = (
            match.external_match_id
            if match
            else None
        )

        if board.status == "REVIEW_REQUIRED":
            return {
                "phase": "REVIEW_REQUIRED",
                "message": (
                    f"Матч #{external_id} найден. "
                    f"Часть данных уточняется автоматически."
                    if external_id
                    else "Матч найден. Часть данных уточняется автоматически."
                ),
                "match_id": external_id,
            }

        return {
            "phase": "VERIFYING",
            "message": (
                f"Проверяем попытку "
                f"{board.attempts_used}/{board.max_attempts}. "
                f"Матч #{external_id}."
                if external_id
                else
                f"Проверяем попытку "
                f"{board.attempts_used}/{board.max_attempts}."
            ),
            "match_id": external_id,
        }

    direct_jobs = list(
        db.scalars(
            select(Job)
            .where(
                Job.type == "resolve_companion_match"
            )
            .order_by(Job.created_at.desc())
            .limit(100)
        ).all()
    )

    direct = next(
        (
            item
            for item in direct_jobs
            if str(
                (item.payload or {}).get("board_id") or ""
            ) == board_id
        ),
        None,
    )

    if direct and direct.status in {"PENDING", "RUNNING"}:
        external_id = (
            direct.payload or {}
        ).get("external_match_id")

        return {
            "phase": "MATCH_DETECTED",
            "message": (
                f"Компаньон обнаружил матч #{external_id}. "
                f"Получаем итоговую статистику."
            ),
            "match_id": external_id,
            "attempts": direct.attempts,
            "next_check_at": (
                direct.run_after.isoformat()
                if direct.status == "PENDING"
                else None
            ),
        }

    jobs = list(
        db.scalars(
            select(Job)
            .where(Job.type == "discover_match")
            .order_by(Job.created_at.desc())
            .limit(100)
        ).all()
    )

    job = next(
        (
            item
            for item in jobs
            if str(
                (item.payload or {}).get("board_id") or ""
            ) == board_id
        ),
        None,
    )

    if not job:
        return None

    next_attempt = min(
        board.attempts_used + 1,
        board.max_attempts,
    )

    return {
        "phase": "SEARCHING",
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "next_check_at": (
            job.run_after.isoformat()
            if job.status == "PENDING"
            else None
        ),
        "message": (
            f"Ищем матч для попытки "
            f"{next_attempt}/{board.max_attempts}. "
            f"Ничего нажимать не нужно."
        ),
        "delayed_by_provider": bool(job.last_error),
    }


def _is_admin(user: User) -> bool:
    return _effective_access_role(user) in {"OWNER", "ADMIN"}


def _require_admin_identity(user: User = Depends(require_user)) -> User:
    if not _is_admin(user):
        raise HTTPException(403, "Требуется доступ администратора")
    return user


def _admin_browser_session(request: Request, db: Session) -> SessionToken:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or len(raw) > 256:
        raise HTTPException(401, "Административная сессия отсутствует")
    item = db.get(SessionToken, hash_token(raw))
    if not item:
        raise HTTPException(401, "Административная сессия устарела")
    return item


def _admin_elevation_expires(item: SessionToken) -> datetime | None:
    verified = item.admin_verified_at
    if verified is None:
        return None
    if verified.tzinfo is None:
        verified = verified.replace(tzinfo=timezone.utc)
    return verified + timedelta(minutes=settings.admin_session_ttl_minutes)


def _require_admin(
    request: Request,
    user: User = Depends(_require_admin_identity),
    db: Session = Depends(get_db),
) -> User:
    session = _admin_browser_session(request, db)
    expires_at = _admin_elevation_expires(session)
    now = datetime.now(timezone.utc)
    if expires_at is None or expires_at <= now:
        raise HTTPException(403, "Требуется подтверждение TOTP для административного доступа")
    return user


def _require_owner(admin: User = Depends(_require_admin)) -> User:
    if _effective_access_role(admin) != "OWNER":
        raise HTTPException(403, "Требуется доступ владельца проекта")
    return admin


def _safe_file_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return (cleaned or "evidence")[:120]


def _notify_review_channel(submission: EvidenceSubmission, user: User, board: ContractBoard) -> str | None:
    admin_url = f"{settings.app_base_url}/#admin-evidence-{submission.id}"
    text = (
        f"New manual verification #{submission.id[:8]}\n"
        f"Player: {user.display_name} ({user.account_id})\n"
        f"Board: {board.board_date.isoformat()}\n"
        f"Channel: {submission.channel}\n"
        f"Review: {admin_url}"
    )
    try:
        if submission.channel == "TELEGRAM":
            if not settings.telegram_bot_token or not settings.telegram_review_chat_id:
                return "Проверка через Telegram не настроена"
            url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
            body = json.dumps({"chat_id": settings.telegram_review_chat_id, "text": text, "disable_web_page_preview": True}).encode()
        else:
            if not settings.discord_review_webhook_url:
                return "Проверка через Discord не настроена"
            url = settings.discord_review_webhook_url
            body = json.dumps({"content": text, "allowed_mentions": {"parse": []}}).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", "User-Agent": "DeadlockContracts/0.9.2"})
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status not in {200, 204}:
                return f"Notification returned HTTP {response.status}"
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
        return f"Notification failed: {type(exc).__name__}"
    return None


def _serialize_submission(db: Session, item: EvidenceSubmission, viewer: User) -> dict[str, Any]:
    files = list(db.scalars(select(EvidenceFile).where(EvidenceFile.submission_id == item.id).order_by(EvidenceFile.created_at)).all())
    board = db.scalar(select(ContractBoard).options(selectinload(ContractBoard.options)).where(ContractBoard.id == item.board_id))
    owner = db.get(User, item.user_id)
    return {
        "id": item.id, "board_id": item.board_id, "channel": item.channel, "status": item.status,
        "notes": item.notes, "hero_name": item.hero_name,
        "match_started_at": item.match_started_at.isoformat() if item.match_started_at else None,
        "match_ended_at": item.match_ended_at.isoformat() if item.match_ended_at else None,
        "reviewer_note": item.reviewer_note, "decision_payload": item.decision_payload,
        "created_at": item.created_at.isoformat(), "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
        "player": {"display_name": owner.display_name if owner else "Unknown", "account_id": owner.account_id if owner else None},
        "contracts": [{"id": o.id, "title": o.rendered_title, "description": o.rendered_description, "target": o.target, "metric": o.metric, "reward_xp": o.reward_xp, "status": o.status} for o in (board.options if board else []) if o.selected],
        "files": [{"id": f.id, "name": f.original_name, "mime_type": f.mime_type, "size_bytes": f.size_bytes, "url": f"/api/evidence/files/{f.id}"} for f in files],
        "can_review": _is_admin(viewer),
    }


def _companion_from_request(
    request: Request,
    db: Session,
) -> tuple[CompanionDevice, User]:
    authorization = request.headers.get("authorization", "")

    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется Bearer token Companion")

    device = get_device_by_token(
        db,
        authorization.split(" ", 1)[1].strip(),
    )

    owner = db.get(User, device.user_id)

    if not owner:
        raise HTTPException(401, "Владелец Companion не найден")

    if str(owner.status or "").upper() != "ACTIVE":
        raise HTTPException(403, "Аккаунт недоступен")

    return device, owner


DESKTOP_API_VERSION = "desktop.v1"
DESKTOP_SCHEMA_VERSION = 1
DESKTOP_ACTIVE_BOARD_STATES = {"LOCKED", "VERIFYING", "REVIEW_REQUIRED"}

def _desktop_context(
    request: Request,
    db: Session,
) -> tuple[CompanionDevice, User]:
    return _companion_from_request(request, db)

def _history_items(db: Session, user: User, limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(200, int(limit)))
    options = list(
        db.scalars(
            select(BoardOption)
            .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
            .options(selectinload(BoardOption.match), selectinload(BoardOption.board))
            .where(ContractBoard.user_id == user.id, BoardOption.selected.is_(True))
            .order_by(BoardOption.created_at.desc())
            .limit(safe_limit)
        ).all()
    )

    evaluation_ids = {option.final_evaluation_id for option in options if option.final_evaluation_id}
    evaluations = (
        list(db.scalars(select(Evaluation).where(Evaluation.id.in_(evaluation_ids))).all())
        if evaluation_ids
        else []
    )
    evaluations_by_id = {item.id: item for item in evaluations}

    evaluation_match_ids = {item.match_id for item in evaluations if item.match_id}
    evaluation_matches = (
        list(db.scalars(select(Match).where(Match.id.in_(evaluation_match_ids))).all())
        if evaluation_match_ids
        else []
    )
    matches_by_id = {item.id: item for item in evaluation_matches}

    assignment_ids = [option.id for option in options]
    ledger_entries = (
        list(
            db.scalars(
                select(RewardLedgerEntry).where(
                    RewardLedgerEntry.user_id == user.id,
                    RewardLedgerEntry.source_id.in_(assignment_ids),
                    RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES),
                )
            ).all()
        )
        if assignment_ids
        else []
    )
    ledger_by_assignment: dict[str, list[RewardLedgerEntry]] = {}
    for entry in ledger_entries:
        ledger_by_assignment.setdefault(entry.source_id, []).append(entry)

    items: list[dict[str, Any]] = []
    for option in options:
        evaluation = evaluations_by_id.get(option.final_evaluation_id or "")
        evaluation_match = matches_by_id.get(evaluation.match_id) if evaluation else None
        rewards = ledger_by_assignment.get(option.id, [])
        xp_rewards = [entry for entry in rewards if (entry.asset or "XP") == "XP"]
        reward_granted_xp = sum(int(entry.delta or 0) for entry in xp_rewards)
        reward_granted_at = max((entry.created_at for entry in xp_rewards), default=None)
        current_match_id = option.match.external_match_id if option.match else None
        last_attempt_match_id = current_match_id if current_match_id is not None else (evaluation_match.external_match_id if evaluation_match else None)

        items.append(
            {
                "assignment_id": option.id,
                "board_id": option.board_id,
                "game_match_mode": option.board.game_match_mode,
                "board_status": option.board.status,
                "case_expires_at": option.board.expires_at.isoformat() if option.board.locked_at else None,
                "attempts_used": option.board.attempts_used,
                "max_attempts": option.board.max_attempts,
                "title": option.rendered_title,
                "status": option.status,
                "reward_xp": option.reward_xp,
                "reward_granted_xp": reward_granted_xp,
                "reward_granted_at": reward_granted_at.isoformat() if reward_granted_at else None,
                "difficulty": option.difficulty,
                "rarity": option.rarity,
                "progress_current": option.progress_current,
                "progress_target": option.progress_target,
                "explanation": option.explanation,
                "match_id": current_match_id,
                "match_started_at": option.match.started_at.isoformat() if option.match and option.match.started_at else None,
                "match_ended_at": option.match.ended_at.isoformat() if option.match and option.match.ended_at else None,
                "last_attempt_match_id": last_attempt_match_id,
                "latest_evaluation": (
                    {
                        "id": evaluation.id,
                        "status": evaluation.status,
                        "revision": evaluation.revision,
                        "match_id": evaluation_match.external_match_id if evaluation_match else None,
                        "match_started_at": evaluation_match.started_at.isoformat() if evaluation_match and evaluation_match.started_at else None,
                        "match_ended_at": evaluation_match.ended_at.isoformat() if evaluation_match and evaluation_match.ended_at else None,
                        "evidence_level": evaluation.evidence_level,
                        "evaluator_version": evaluation.evaluator_version,
                        "progress_current": evaluation.progress_current,
                        "progress_target": evaluation.progress_target,
                        "score": evaluation.score,
                        "explanation": evaluation.explanation,
                        "created_at": evaluation.created_at.isoformat(),
                    }
                    if evaluation
                    else None
                ),
                "locked_at": option.locked_at.isoformat() if option.locked_at else None,
                "settled_at": option.settled_at.isoformat() if option.settled_at else None,
            }
        )
    return items


def _desktop_bootstrap_payload(db: Session, owner: User, device: CompanionDevice, history_limit: int = 60) -> dict[str, Any]:
    board_models = ensure_daily_boards(db, owner)
    boards = [serialize_board(model) for model in board_models]
    active_cases = [
        {
            "board_id": board["id"],
            "game_match_mode": board["game_match_mode"],
            "status": board["status"],
            "locked_at": board["locked_at"],
            "expires_at": board["case_expires_at"],
            "attempts_used": board["attempts_used"],
            "max_attempts": board["max_attempts"],
            "attempts_remaining": board["attempts_remaining"],
            "options": [item for item in board["options"] if item["selected"]],
        }
        for board in boards
        if board["status"] in DESKTOP_ACTIVE_BOARD_STATES
    ]
    account = {
        **serialize_user(owner),
        "steam_id64": str(owner.steam_id64) if owner.steam_id64 else None,
    }
    return {
        "api_version": DESKTOP_API_VERSION,
        "schema_version": DESKTOP_SCHEMA_VERSION,
        "desktop_features": ["adaptive_profiles_v1", "debrief_v1"],
        "server_time": datetime.now(timezone.utc).isoformat(),
        "account": account,
        "device": serialize_device(device),
        "refresh": refresh_summary(db, owner.id),
        "boards": boards,
        "active_cases": active_cases,
        "adaptive_profiles": {mode: build_adaptive_profile(db, owner, mode) for mode in GAME_MODES},
        "progression": user_progression(db, owner),
        "history": {"items": _history_items(db, owner, history_limit)},
        "policy": {
            "selection_min": 1,
            "selection_max": 3,
            "server_authoritative": True,
            "client_can_settle": False,
        },
    }


@app.post("/api/companion/pairing/start", dependencies=[Depends(require_csrf)])
def companion_pairing_start(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    code, item = create_pairing(db, user)
    db.add(AuditLog(user_id=user.id, action="companion.pairing_started", entity_type="user", entity_id=user.id, data={"expires_at": item.expires_at.isoformat()}))
    db.commit()
    return {"code": code, "expires_at": item.expires_at.isoformat(), "server_url": settings.app_base_url}


@app.post("/api/companion/pairing/claim")
def companion_pairing_claim(payload: CompanionClaimRequest, db: Session = Depends(get_db)) -> dict:
    token, device, user = claim_pairing(db, payload.code, payload.device_id, payload.label, payload.version)
    db.add(AuditLog(user_id=user.id, action="companion.paired", entity_type="companion_device", entity_id=device.id, data={"device_id": device.device_id, "version": device.version}))
    db.commit()
    return {
        "token": token,
        "device": serialize_device(device),
        "account": {"display_name": user.display_name, "steam_id64": str(user.steam_id64) if user.steam_id64 else None},
        "heartbeat_seconds": 15,
    }


@app.get("/api/companion/status")
def companion_status(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    device = db.scalar(
        select(CompanionDevice)
        .where(CompanionDevice.user_id == user.id, CompanionDevice.revoked_at.is_(None))
        .order_by(CompanionDevice.last_seen_at.desc().nullslast(), CompanionDevice.created_at.desc())
    )
    return {"device": serialize_device(device)}


@app.post("/api/companion/revoke", dependencies=[Depends(require_csrf)])
def companion_revoke(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    devices = list(db.scalars(select(CompanionDevice).where(CompanionDevice.user_id == user.id, CompanionDevice.revoked_at.is_(None))).all())
    for device in devices:
        device.revoked_at = now
        device.game_running = False
        device.current_match_id = None
    db.add(AuditLog(user_id=user.id, action="companion.revoked", entity_type="user", entity_id=user.id, data={"count": len(devices)}))
    db.commit()
    return {"ok": True, "revoked": len(devices)}


@app.post("/api/companion/disconnect")
def companion_disconnect(request: Request, db: Session = Depends(get_db)) -> dict:
    device, owner = _companion_from_request(request, db)
    device.revoked_at = datetime.now(timezone.utc)
    device.game_running = False
    device.current_match_id = None
    db.add(AuditLog(user_id=owner.id, action="companion.device_disconnected", entity_type="companion_device", entity_id=device.id, data={"device_id": device.device_id}))
    db.commit()
    return {"ok": True}


@app.get("/api/companion/hello")
def companion_hello(request: Request, db: Session = Depends(get_db)) -> dict:
    device, owner = _companion_from_request(request, db)
    return {
        "ok": True,
        "account": {"display_name": owner.display_name, "steam_id64": str(owner.steam_id64) if owner.steam_id64 else None},
        "device": serialize_device(device),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/desktop/v1/bootstrap")
def desktop_bootstrap(
    request: Request,
    history_limit: int = 60,
    db: Session = Depends(get_db),
) -> dict:
    device, owner = _desktop_context(request, db)
    return _desktop_bootstrap_payload(db, owner, device, history_limit)


@app.post("/api/desktop/v1/boards/lock")
def desktop_board_lock(
    payload: LockRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _, owner = _desktop_context(request, db)
    try:
        board = lock_board(db, owner, [str(value) for value in payload.option_ids], payload.mode)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {
        "ok": True,
        "board": serialize_board(board),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/desktop/v1/boards/{mode}/reroll")
def desktop_board_reroll(
    mode: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    _, owner = _desktop_context(request, db)
    try:
        board = reroll_board(db, owner, mode)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {
        "ok": True,
        "board": serialize_board(board),
        "refresh": refresh_summary(db, owner.id),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/companion/heartbeat")
def companion_heartbeat(payload: CompanionHeartbeatRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    device, owner = _companion_from_request(request, db)
    updated, woken, direct = record_snapshot(
        db,
        device,
        owner,
        game_running=payload.game_running,
        steam_id64=payload.steam_id64,
        phase=payload.phase,
        game_mode_raw=payload.game_mode,
        match_id=payload.match_id,
        gep_version=payload.gep_version,
        version=payload.version,
        live_stats=payload.live_stats.model_dump() if payload.live_stats else None,
        session_id=payload.session_id,
        session_started_at=payload.session_started_at,
        session_ended_at=payload.session_ended_at,
        session_start_reason=payload.session_start_reason,
        session_end_reason=payload.session_end_reason,
        match_clock_s=payload.match_clock_s,
        match_clock_observed_at=payload.match_clock_observed_at,
        local_team=payload.local_team,
        match_outcome=payload.match_outcome,
        match_outcome_event_at=payload.match_outcome_event_at,
        match_outcome_event_match_id=payload.match_outcome_event_match_id,
        event_type=payload.event_type,
    )
    return {
        "ok": True,
        "device": serialize_device(updated),
        "woken_boards": woken,
        "direct_match_boards": direct,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/verification/options")
def verification_options(user: User = Depends(require_user)) -> dict:
    return {
        "automatic": {"enabled": True, "name": "Автоматическая послематчевая проверка", "requires_install": False, "companion_optional": True},
        "manual": {"enabled": False, "reason": "Пользовательская ручная проверка отключена в v0.3. Недостающие данные автоматически попадают во внутреннюю очередь."},
    }


@app.post("/api/evidence/submit", dependencies=[Depends(require_csrf)], include_in_schema=False)
def submit_evidence(payload: EvidenceSubmitRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    raise HTTPException(410, "Ручная отправка доказательств отключена. Если данных матча не хватит, система создаст внутреннюю заявку автоматически.")
    board = db.scalar(select(ContractBoard).options(selectinload(ContractBoard.options)).where(ContractBoard.id == str(payload.board_id), ContractBoard.user_id == user.id))
    if not board or board.status == "OFFERED" or not board.locked_at:
        raise HTTPException(409, "Сначала зафиксируйте контракты")
    if board.status in {"SETTLED", "PARTIALLY_SETTLED"}:
        raise HTTPException(409, "Это дело уже закрыто")
    existing = db.scalar(select(EvidenceSubmission).where(EvidenceSubmission.board_id == board.id, EvidenceSubmission.status.in_(("PENDING", "NEEDS_INFO"))).order_by(EvidenceSubmission.created_at.desc()))
    if existing and existing.status == "PENDING":
        raise HTTPException(409, "Заявка уже ожидает проверки")
    if payload.channel == "TELEGRAM" and not (settings.telegram_bot_token and settings.telegram_review_chat_id):
        raise HTTPException(409, "Проверка через Telegram не настроена")
    if payload.channel == "DISCORD" and not settings.discord_review_webhook_url:
        raise HTTPException(409, "Проверка через Discord не настроена")
    item = EvidenceSubmission(board_id=board.id, user_id=user.id, channel=payload.channel, notes=payload.notes or None, hero_name=payload.hero_name or None, match_started_at=payload.match_started_at, match_ended_at=payload.match_ended_at, status="PENDING")
    db.add(item); db.flush()
    evidence_dir = Path(settings.evidence_dir); evidence_dir.mkdir(parents=True, exist_ok=True)
    written=[]
    try:
        for upload in payload.files:
            try: raw = base64.b64decode(upload.data_base64, validate=True)
            except Exception as exc: raise HTTPException(422, f"Некорректные данные файла {upload.name}") from exc
            if not raw or len(raw) > settings.evidence_max_file_bytes: raise HTTPException(413, f"Файл {upload.name} слишком большой")
            signatures={"image/jpeg": (b"\xff\xd8\xff",), "image/png": (b"\x89PNG\r\n\x1a\n",), "image/webp": (b"RIFF",)}
            if not any(raw.startswith(sig) for sig in signatures[upload.mime_type]): raise HTTPException(422, f"Тип содержимого файла не соответствует {upload.mime_type}")
            digest=hashlib.sha256(raw).hexdigest(); ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[upload.mime_type]
            storage=f"{item.id}-{secrets.token_hex(8)}.{ext}"; target=evidence_dir/storage
            target.write_bytes(raw); target.chmod(0o600); written.append(target)
            db.add(EvidenceFile(submission_id=item.id, original_name=_safe_file_name(upload.name), storage_name=storage, mime_type=upload.mime_type, size_bytes=len(raw), sha256=digest))
        board.status = "VERIFYING"
        db.add(AuditLog(user_id=user.id, action="evidence.submitted", entity_type="evidence_submission", entity_id=item.id, data={"channel": payload.channel, "files": len(payload.files)}))
        db.commit(); db.refresh(item)
    except Exception:
        db.rollback()
        for target in written: target.unlink(missing_ok=True)
        raise
    warning=_notify_review_channel(item,user,board)
    if warning:
        item.external_reference=warning; db.commit()
    return {"submission": _serialize_submission(db,item,user), "notification_warning": warning}


@app.get("/api/evidence/mine", include_in_schema=False)
def my_evidence(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    raise HTTPException(410, "Ручная проверка отключена в v0.3")
    items=list(db.scalars(select(EvidenceSubmission).where(EvidenceSubmission.user_id==user.id).order_by(EvidenceSubmission.created_at.desc()).limit(20)).all())
    return {"items": [_serialize_submission(db,item,user) for item in items]}


@app.get("/api/evidence/files/{file_id}", include_in_schema=False)
def evidence_file(file_id: UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    raise HTTPException(410, "Ручная проверка отключена в v0.3")
    file=db.get(EvidenceFile,str(file_id));
    if not file: raise HTTPException(404,"Файл доказательства не найден")
    submission=db.get(EvidenceSubmission,file.submission_id)
    if not submission or (submission.user_id != user.id and not _is_admin(user)): raise HTTPException(403,"Доступ запрещён")
    path=Path(settings.evidence_dir)/file.storage_name
    if not path.is_file(): raise HTTPException(404,"Файл доказательства отсутствует")
    return FileResponse(path, media_type=file.mime_type, filename=file.original_name, headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"})


@app.get("/api/admin/evidence", include_in_schema=False)
def admin_evidence(status: str = "PENDING", admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    raise HTTPException(410, "Старая очередь ручных доказательств отключена; используйте /api/admin/auto-reviews")
    query=select(EvidenceSubmission).order_by(EvidenceSubmission.created_at.desc()).limit(100)
    if status != "ALL": query=query.where(EvidenceSubmission.status==status)
    items=list(db.scalars(query).all())
    return {"items": [_serialize_submission(db,item,admin) for item in items]}


@app.post("/api/admin/evidence/{submission_id}/decision", dependencies=[Depends(require_csrf)], include_in_schema=False)
def decide_evidence(submission_id: UUID, payload: EvidenceDecisionRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    raise HTTPException(410, "Старая очередь ручных доказательств отключена; используйте /api/admin/auto-reviews")
    item=db.get(EvidenceSubmission,str(submission_id))
    if not item: raise HTTPException(404,"Заявка не найдена")
    if item.status not in {"PENDING","NEEDS_INFO"}: raise HTTPException(409,"Заявка уже проверена")
    board=db.scalar(select(ContractBoard).options(selectinload(ContractBoard.options)).where(ContractBoard.id==item.board_id))
    if not board: raise HTTPException(404,"Доска контрактов не найдена")
    selected={o.id:o for o in board.options if o.selected}
    if payload.status=="APPROVED":
        if {str(x.option_id) for x in payload.options} != set(selected): raise HTTPException(422,"Нужно указать решение для каждого выбранного контракта")
        for verdict in payload.options:
            option=selected[str(verdict.option_id)]; option.status=verdict.status; option.progress_current=verdict.progress_current; option.progress_target=option.target; option.explanation=verdict.explanation; option.settled_at=datetime.now(timezone.utc)
            if verdict.status=="COMPLETED":
                exists=db.scalar(select(RewardLedgerEntry).where(RewardLedgerEntry.source_type=="MANUAL_EVIDENCE",RewardLedgerEntry.source_id==option.id))
                if not exists:
                    owner=db.get(User,item.user_id); owner.xp += option.reward_xp
                    db.add(RewardLedgerEntry(user_id=owner.id,source_type="MANUAL_EVIDENCE",source_id=option.id,delta=option.reward_xp,balance_after=owner.xp,policy_version="xp-manual-1"))
        board.status="SETTLED"
    item.status=payload.status; item.reviewer_id=admin.id; item.reviewer_note=payload.reviewer_note or None; item.decision_payload={"options":[x.model_dump(mode="json") for x in payload.options]}; item.reviewed_at=datetime.now(timezone.utc)
    db.add(AuditLog(user_id=admin.id,action="evidence.reviewed",entity_type="evidence_submission",entity_id=item.id,data={"status":payload.status}))
    db.commit(); db.refresh(item)
    return {"submission":_serialize_submission(db,item,admin)}


@app.get("/api/profile/public")
def my_public_profile(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user.id))
    if profile is None:
        return {
            "profile": None,
            "suggested_slug": _suggest_profile_slug(user),
            "defaults": {
                "headline": "Deadlock Contract Runner",
                "bio": "",
                "theme": "DOSSIER",
                "is_public": False,
                "show_stats": True,
                "show_showcase": True,
                "show_links": True,
                "links": {},
            },
        }
    return {"profile": _public_profile_payload(db, user, profile, private=True), "suggested_slug": profile.slug}


@app.put("/api/profile/public", dependencies=[Depends(require_csrf)])
def update_public_profile(payload: PublicProfileUpdateRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    links = _clean_profile_links(payload.links)
    collision = db.scalar(select(PublicProfile).where(PublicProfile.slug == payload.slug, PublicProfile.user_id != user.id))
    if collision is not None:
        raise HTTPException(409, "Этот public handle уже занят")
    profile = db.scalar(select(PublicProfile).where(PublicProfile.user_id == user.id))
    if profile is None:
        profile = PublicProfile(user_id=user.id, slug=payload.slug)
    profile.slug = payload.slug
    profile.headline = payload.headline.strip()
    profile.bio = payload.bio.strip()
    profile.theme = payload.theme
    profile.is_public = payload.is_public
    profile.show_stats = payload.show_stats
    profile.show_showcase = payload.show_showcase
    profile.show_links = payload.show_links
    profile.links = links
    db.add(profile)
    db.flush()
    db.add(AuditLog(user_id=user.id, action="profile.public_updated", entity_type="public_profile", entity_id=profile.id, data={"slug": profile.slug, "is_public": profile.is_public, "theme": profile.theme}))
    db.commit()
    db.refresh(profile)
    return {"profile": _public_profile_payload(db, user, profile, private=True)}


@app.get("/api/public/leaderboard")
def public_leaderboard_api(
    response: Response,
    scope: Literal["all_time", "today", "rare", "mastery"] = "all_time",
    limit: int = 20,
    db: Session = Depends(get_db),
) -> dict:
    if not 1 <= limit <= 100:
        raise HTTPException(422, "limit must be between 1 and 100")
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=120"
    return build_public_leaderboard(db, scope, limit=limit)


@app.get("/api/public/profiles/{slug}")
def public_profile(slug: str, db: Session = Depends(get_db)) -> dict:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or not 3 <= len(slug) <= 32:
        raise HTTPException(404, "Public profile not found")
    row = db.execute(
        select(PublicProfile, User)
        .join(User, User.id == PublicProfile.user_id)
        .where(PublicProfile.slug == slug, PublicProfile.is_public.is_(True), User.status == "ACTIVE")
    ).first()
    if not row:
        raise HTTPException(404, "Public profile not found")
    profile, user = row
    return {"profile": _public_profile_payload(db, user, profile, private=False)}


@app.post("/api/profile/refresh", dependencies=[Depends(require_csrf)])
def refresh_profile(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    if not settings.steam_web_api_key:
        raise HTTPException(409, "Steam Web API key не настроен на сервере")
    if user.steam_id64 is None:
        raise HTTPException(409, "SteamID пользователя отсутствует")
    display_name, avatar_url = fetch_steam_profile(user.steam_id64)
    user.display_name = display_name
    user.avatar_url = avatar_url
    db.add(AuditLog(user_id=user.id, action="profile.steam_refreshed", entity_type="user", entity_id=user.id, data={}))
    db.commit()
    db.refresh(user)
    return {"user": serialize_user(user)}


@app.get("/api/board/today")
def board_today(mode: str = "STANDARD", user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    try:
        model = ensure_daily_board(db, user, normalize_mode(mode))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    board = serialize_board(model)
    board["server_time"] = datetime.now(timezone.utc).isoformat()
    board["provider_status"] = _provider_status(db, model.id)
    board["refresh"] = refresh_summary(db, user.id)
    return board


@app.get("/api/boards/today")
def boards_today(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    models = ensure_daily_boards(db, user)
    items = []
    for model in models:
        board = serialize_board(model)
        board["provider_status"] = _provider_status(db, model.id)
        items.append(board)
    return {
        "date": today_utc().isoformat(),
        "server_time": datetime.now(timezone.utc).isoformat(),
        "refresh": refresh_summary(db, user.id),
        "boards": items,
    }


@app.post("/api/board/today/lock", dependencies=[Depends(require_csrf)])
def board_lock(payload: LockRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    try:
        return serialize_board(lock_board(db, user, [str(value) for value in payload.option_ids], payload.mode))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/boards/{mode}/reroll", dependencies=[Depends(require_csrf)])
def board_reroll(mode: str, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    try:
        board = reroll_board(db, user, mode)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"board": serialize_board(board), "refresh": refresh_summary(db, user.id)}


@app.get("/api/progression")
def progression(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return user_progression(db, user)


@app.get("/api/reviews/mine")
def my_auto_reviews(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    items = list(db.scalars(select(AutoReviewCase).where(AutoReviewCase.user_id == user.id).order_by(AutoReviewCase.created_at.desc()).limit(30)).all())
    return {
        "items": [
            {
                "id": item.id,
                "board_id": item.board_id,
                "status": item.status,
                "reasons": item.reasons,
                "context": item.context,
                "reviewer_note": item.reviewer_note,
                "created_at": item.created_at.isoformat(),
                "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
            }
            for item in items
        ]
    }


def _serialize_auto_review(db: Session, item: AutoReviewCase) -> dict:
    board = db.scalar(select(ContractBoard).options(selectinload(ContractBoard.options)).where(ContractBoard.id == item.board_id))
    match = db.get(Match, item.match_id)
    owner = db.get(User, item.user_id)
    participant = None
    gep_evidence = None
    if match and owner and owner.account_id is not None:
        participant = db.scalar(select(MatchParticipant).where(MatchParticipant.match_id == match.id, MatchParticipant.account_id == owner.account_id))
        gep_evidence = db.scalar(select(CompanionMatchEvidence).where(CompanionMatchEvidence.user_id == owner.id, CompanionMatchEvidence.external_match_id == match.external_match_id))
    return {
        "id": item.id, "status": item.status, "board_id": item.board_id,
        "mode": board.game_match_mode if board else None,
        "player": {"display_name": owner.display_name if owner else "Unknown", "account_id": owner.account_id if owner else None},
        "match_id": match.external_match_id if match else None,
        "match_summary": {
            "provider": match.provider if match else None,
            "duration_s": match.duration_s if match else None,
            "mode": match.game_match_mode if match else None,
            "mode_raw": match.provider_mode_raw if match else None,
            "mode_confidence": match.mode_confidence if match else None,
            "scoring_status": match.scoring_status if match else None,
            "capabilities": list(match.capabilities or []) if match else [],
            "kills": participant.kills if participant else None,
            "deaths": participant.deaths if participant else None,
            "assists": participant.assists if participant else None,
            "net_worth": participant.net_worth if participant else None,
            "hero_damage": participant.hero_damage if participant else None,
            "object_damage": participant.object_damage if participant else None,
            "healing": participant.healing if participant else None,
            "gep_evidence": {
                "captured_at": gep_evidence.captured_at.isoformat() if gep_evidence and gep_evidence.captured_at else None,
                "kills": gep_evidence.kills if gep_evidence else None,
                "deaths": gep_evidence.deaths if gep_evidence else None,
                "assists": gep_evidence.assists if gep_evidence else None,
                "hero_damage": gep_evidence.hero_damage if gep_evidence else None,
                "object_damage": gep_evidence.object_damage if gep_evidence else None,
                "healing": gep_evidence.healing if gep_evidence else None,
                "souls": gep_evidence.souls if gep_evidence else None,
            } if gep_evidence else None,
        },
        "reasons": item.reasons, "context": item.context, "reviewer_note": item.reviewer_note,
        "created_at": item.created_at.isoformat(), "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
        "contracts": [
            {"id": option.id, "title": option.rendered_title, "status": option.status, "reward_xp": option.reward_xp, "metric": option.metric, "target": option.target, "explanation": option.explanation}
            for option in (board.options if board else []) if option.selected
        ],
    }


def _admin_status_payload(request: Request, db: Session, user: User) -> dict:
    browser_session = _admin_browser_session(request, db)
    expires_at = _admin_elevation_expires(browser_session)
    now = datetime.now(timezone.utc)
    elevated = bool(expires_at and expires_at > now)
    role = _effective_access_role(user)
    return {
        "configured": bool(settings.admin_totp_secret),
        "elevated": elevated,
        "expires_at": expires_at.isoformat() if elevated and expires_at else None,
        "ttl_minutes": settings.admin_session_ttl_minutes,
        "can_manage_roles": role == "OWNER",
        "admin": {
            "id": user.id,
            "display_name": user.display_name,
            "steam_id64": str(user.steam_id64 or ""),
            "access_role": role,
            "badges": _display_badges(user),
        },
    }


@app.get("/api/admin/auth/status")
def admin_auth_status(
    request: Request,
    admin: User = Depends(_require_admin_identity),
    db: Session = Depends(get_db),
) -> dict:
    return _admin_status_payload(request, db, admin)


@app.post("/api/admin/auth/totp", dependencies=[Depends(require_csrf)])
def admin_auth_totp(
    payload: AdminTotpRequest,
    request: Request,
    admin: User = Depends(_require_admin_identity),
    db: Session = Depends(get_db),
) -> dict:
    if not settings.admin_totp_secret:
        raise HTTPException(503, "TOTP администратора не настроен")
    browser_session = _admin_browser_session(request, db)
    accepted_step = verify_totp(
        settings.admin_totp_secret,
        payload.code,
        valid_window=1,
        last_accepted_step=browser_session.admin_totp_step,
    )
    if accepted_step is None:
        db.add(AuditLog(user_id=admin.id, action="admin.mfa_failed", entity_type="user", entity_id=admin.id, data={"request_id": getattr(request.state, "request_id", None)}))
        db.commit()
        raise HTTPException(403, "Неверный одноразовый код")
    browser_session.admin_verified_at = datetime.now(timezone.utc)
    browser_session.admin_totp_step = accepted_step
    db.add(AuditLog(user_id=admin.id, action="admin.mfa_verified", entity_type="session", entity_id=browser_session.token_hash[:16], data={"ttl_minutes": settings.admin_session_ttl_minutes}))
    db.commit()
    return _admin_status_payload(request, db, admin)


@app.post("/api/admin/auth/lock", dependencies=[Depends(require_csrf)])
def admin_auth_lock(
    request: Request,
    admin: User = Depends(_require_admin_identity),
    db: Session = Depends(get_db),
) -> dict:
    browser_session = _admin_browser_session(request, db)
    browser_session.admin_verified_at = None
    browser_session.admin_totp_step = None
    db.add(AuditLog(user_id=admin.id, action="admin.locked", entity_type="session", entity_id=browser_session.token_hash[:16], data={}))
    db.commit()
    return {"ok": True}


def _admin_user_summary(db: Session, user: User) -> dict:
    boards_count = db.scalar(select(func.count()).select_from(ContractBoard).where(ContractBoard.user_id == user.id)) or 0
    active_boards = db.scalar(
        select(func.count()).select_from(ContractBoard).where(
            ContractBoard.user_id == user.id,
            ContractBoard.status.in_(("LOCKED", "VERIFYING", "REVIEW_REQUIRED")),
        )
    ) or 0
    session_count = db.scalar(select(func.count()).select_from(SessionToken).where(SessionToken.user_id == user.id)) or 0
    latest_device = db.scalar(
        select(CompanionDevice)
        .where(CompanionDevice.user_id == user.id)
        .order_by(CompanionDevice.last_seen_at.desc().nullslast(), CompanionDevice.created_at.desc())
        .limit(1)
    )
    role = _effective_access_role(user)
    return {
        "id": user.id,
        "steam_id64": str(user.steam_id64 or ""),
        "account_id": user.account_id,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "xp": user.xp,
        "status": user.status,
        "access_role": role,
        "badges": _display_badges(user),
        "is_admin": role in {"OWNER", "ADMIN"},
        "can_manage_roles": role == "OWNER",
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "boards": int(boards_count),
        "active_boards": int(active_boards),
        "sessions": int(session_count),
        "companion": serialize_device(latest_device),
    }


def _group_counts(db: Session, model: Any, column: Any) -> dict[str, int]:
    return {
        str(key or "UNKNOWN"): int(count)
        for key, count in db.execute(select(column, func.count()).select_from(model).group_by(column)).all()
    }


def _admin_mission_payload(item: MissionDefinition) -> dict:
    return {
        "id": item.id,
        "key": item.key,
        "version": item.version,
        "title": item.title,
        "description": item.description,
        "metric": item.metric,
        "operator": item.operator,
        "target": item.target,
        "reward_xp": item.reward_xp,
        "base_xp": item.base_xp,
        "difficulty": item.difficulty,
        "rarity": item.rarity,
        "drop_weight": item.drop_weight,
        "drop_chance_pct": item.drop_chance_pct,
        "category": item.category,
        "required_capabilities": item.required_capabilities or [],
        "game_match_mode": item.game_match_mode,
        "ranked_policy": item.ranked_policy,
        "status": item.status,
        "safety_classification": item.safety_classification,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "published_at": item.published_at.isoformat() if item.published_at else None,
    }


def _admin_match_payload(db: Session, item: Match) -> dict:
    participant_count = db.scalar(select(func.count()).select_from(MatchParticipant).where(MatchParticipant.match_id == item.id)) or 0
    bound_count = db.scalar(select(func.count()).select_from(BoardOption).where(BoardOption.bound_match_id == item.id)) or 0
    review_count = db.scalar(select(func.count()).select_from(AutoReviewCase).where(AutoReviewCase.match_id == item.id)) or 0
    return {
        "id": item.id,
        "match_id": item.external_match_id,
        "provider": item.provider,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "ended_at": item.ended_at.isoformat() if item.ended_at else None,
        "duration_s": item.duration_s,
        "mode": item.game_match_mode,
        "mode_raw": item.provider_mode_raw,
        "mode_confidence": item.mode_confidence,
        "scoring_status": item.scoring_status,
        "is_final": item.is_final,
        "capabilities": item.capabilities or [],
        "participants": int(participant_count),
        "bound_contracts": int(bound_count),
        "reviews": int(review_count),
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@app.get("/api/admin/overview")
def admin_overview(admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    online_cutoff = now - timedelta(seconds=settings.companion_online_seconds)
    day_cutoff = now - timedelta(hours=24)
    week_cutoff = now - timedelta(days=7)
    timeline_cutoff = now - timedelta(days=13)

    users_total = db.scalar(select(func.count()).select_from(User)) or 0
    active_boards = db.scalar(select(func.count()).select_from(ContractBoard).where(ContractBoard.status.in_(("LOCKED", "VERIFYING", "REVIEW_REQUIRED")))) or 0
    pending_reviews = db.scalar(select(func.count()).select_from(AutoReviewCase).where(AutoReviewCase.status.in_(("PENDING", "NEEDS_INFO")))) or 0
    failed_jobs = db.scalar(select(func.count()).select_from(Job).where(Job.status == "FAILED")) or 0
    pending_jobs = db.scalar(select(func.count()).select_from(Job).where(Job.status == "PENDING")) or 0
    companion_online = db.scalar(select(func.count()).select_from(CompanionDevice).where(CompanionDevice.revoked_at.is_(None), CompanionDevice.last_seen_at >= online_cutoff)) or 0

    verifying_options = db.scalar(select(func.count()).select_from(BoardOption).where(BoardOption.status == "VERIFYING")) or 0
    verifying_cutoff = now - timedelta(minutes=15)
    verifying_stuck_15m = db.scalar(
        select(func.count()).select_from(BoardOption).where(
            BoardOption.status == "VERIFYING",
            or_(
                BoardOption.locked_at <= verifying_cutoff,
                (BoardOption.locked_at.is_(None) & (BoardOption.created_at <= verifying_cutoff)),
            ),
        )
    ) or 0
    final_verifying_rows = list(
        db.execute(
            select(BoardOption, Match)
            .join(Match, BoardOption.bound_match_id == Match.id)
            .where(BoardOption.status == "VERIFYING", Match.is_final.is_(True))
            .order_by(BoardOption.locked_at.asc().nullsfirst(), BoardOption.created_at.asc())
            .limit(40)
        ).all()
    )
    missing_capabilities: Counter[str] = Counter()
    verification_examples: list[dict[str, Any]] = []
    for option, match in final_verifying_rows:
        available = set(match.capabilities or [])
        missing = [cap for cap in (option.required_capabilities or []) if cap not in available]
        missing_capabilities.update(missing)
        if len(verification_examples) < 12:
            verification_examples.append({
                "board_id": option.board_id,
                "option_id": option.id,
                "title": option.rendered_title,
                "match_id": match.external_match_id,
                "mode": match.game_match_mode,
                "missing_capabilities": missing,
                "locked_at": option.locked_at.isoformat() if option.locked_at else None,
            })

    registrations = Counter(item.date().isoformat() for item in db.scalars(select(User.created_at).where(User.created_at >= timeline_cutoff)).all() if item)
    matches = Counter(item.date().isoformat() for item in db.scalars(select(Match.created_at).where(Match.created_at >= timeline_cutoff)).all() if item)
    boards = Counter(item.date().isoformat() for item in db.scalars(select(ContractBoard.created_at).where(ContractBoard.created_at >= timeline_cutoff)).all() if item)
    timeline = []
    for offset in range(13, -1, -1):
        key = (now - timedelta(days=offset)).date().isoformat()
        timeline.append({"date": key, "registrations": registrations[key], "matches": matches[key], "boards": boards[key]})

    companion_versions = {
        str(version or "UNKNOWN"): int(count)
        for version, count in db.execute(
            select(CompanionDevice.version, func.count()).where(CompanionDevice.revoked_at.is_(None)).group_by(CompanionDevice.version)
        ).all()
    }
    return {
        # Backward-compatible headline fields.
        "users": int(users_total),
        "active_boards": int(active_boards),
        "pending_reviews": int(pending_reviews),
        "failed_jobs": int(failed_jobs),
        "pending_jobs": int(pending_jobs),
        "companion_online": int(companion_online),
        "latest_match_id": db.scalar(select(func.max(Match.external_match_id))),
        "server_time": now.isoformat(),
        # Admin MAX detail.
        "users_new_24h": int(db.scalar(select(func.count()).select_from(User).where(User.created_at >= day_cutoff)) or 0),
        "users_new_7d": int(db.scalar(select(func.count()).select_from(User).where(User.created_at >= week_cutoff)) or 0),
        "matches_24h": int(db.scalar(select(func.count()).select_from(Match).where(Match.created_at >= day_cutoff)) or 0),
        "matches_7d": int(db.scalar(select(func.count()).select_from(Match).where(Match.created_at >= week_cutoff)) or 0),
        "boards_24h": int(db.scalar(select(func.count()).select_from(ContractBoard).where(ContractBoard.created_at >= day_cutoff)) or 0),
        "xp_issued": int(db.scalar(select(func.coalesce(func.sum(RewardLedgerEntry.delta), 0)).where(RewardLedgerEntry.delta > 0)) or 0),
        "companion_paired": int(db.scalar(select(func.count()).select_from(CompanionDevice).where(CompanionDevice.revoked_at.is_(None))) or 0),
        "board_statuses": _group_counts(db, ContractBoard, ContractBoard.status),
        "board_modes": _group_counts(db, ContractBoard, ContractBoard.game_match_mode),
        "job_statuses": _group_counts(db, Job, Job.status),
        "review_statuses": _group_counts(db, AutoReviewCase, AutoReviewCase.status),
        "match_modes": _group_counts(db, Match, Match.game_match_mode),
        "companion_versions": companion_versions,
        "verification_health": {
            "verifying_options": int(verifying_options),
            "stuck_15m": int(verifying_stuck_15m),
            "final_match_waiting": len(final_verifying_rows),
            "missing_capabilities": dict(missing_capabilities),
            "examples": verification_examples,
        },
        "timeline": timeline,
    }


@app.get("/api/admin/users")
def admin_users(
    query: str = "",
    role: str = "ALL",
    status: str = "ALL",
    companion: str = "ALL",
    sort: str = "NEWEST",
    offset: int = 0,
    limit: int = 50,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 100))
    offset = max(0, min(int(offset), 100000))
    stmt = select(User)
    value = query.strip()[:120]
    if value:
        clauses = [User.display_name.ilike(f"%{value}%")]
        if value.isdigit():
            number_value = int(value)
            clauses.extend((User.steam_id64 == number_value, User.account_id == number_value))
        stmt = stmt.where(or_(*clauses))

    normalized_role = role.upper()
    owner_ids = [int(item) for item in settings.admin_steam_ids if item.isdigit()]
    if normalized_role == "OWNER":
        stmt = stmt.where(User.steam_id64.in_(owner_ids or [-1]))
    elif normalized_role in ACCESS_ROLES:
        stmt = stmt.where(User.access_role == normalized_role)
        if normalized_role == "PLAYER" and owner_ids:
            stmt = stmt.where(or_(User.steam_id64.is_(None), User.steam_id64.notin_(owner_ids)))

    normalized_status = status.upper()
    if normalized_status in {"ACTIVE", "SUSPENDED"}:
        stmt = stmt.where(User.status == normalized_status)

    online_cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.companion_online_seconds)
    active_device = exists(select(1).select_from(CompanionDevice).where(CompanionDevice.user_id == User.id, CompanionDevice.revoked_at.is_(None)))
    online_device = exists(select(1).select_from(CompanionDevice).where(CompanionDevice.user_id == User.id, CompanionDevice.revoked_at.is_(None), CompanionDevice.last_seen_at >= online_cutoff))
    companion_filter = companion.upper()
    if companion_filter == "ONLINE":
        stmt = stmt.where(online_device)
    elif companion_filter == "PAIRED":
        stmt = stmt.where(active_device)
    elif companion_filter == "NONE":
        stmt = stmt.where(~active_device)

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    sort_value = sort.upper()
    if sort_value == "XP":
        stmt = stmt.order_by(User.xp.desc(), User.created_at.desc())
    elif sort_value == "NAME":
        stmt = stmt.order_by(User.display_name.asc(), User.created_at.desc())
    else:
        stmt = stmt.order_by(User.created_at.desc())
    items = list(db.scalars(stmt.offset(offset).limit(limit)).all())
    return {"items": [_admin_user_summary(db, item) for item in items], "total": int(total), "offset": offset, "limit": limit}


def _admin_board_payload(db: Session, board: ContractBoard) -> dict:
    options = list(db.scalars(select(BoardOption).where(BoardOption.board_id == board.id, BoardOption.selected.is_(True)).order_by(BoardOption.created_at.asc())).all())
    contracts = []
    for option in options:
        bound_external = None
        if option.bound_match_id:
            bound = db.get(Match, option.bound_match_id)
            bound_external = bound.external_match_id if bound else None
        contracts.append({
            "id": option.id,
            "title": option.rendered_title,
            "metric": option.metric,
            "operator": option.operator,
            "target": option.target,
            "reward_xp": option.reward_xp,
            "difficulty": option.difficulty,
            "rarity": option.rarity,
            "category": option.category,
            "conditions": option.conditions or [],
            "fingerprint": option.fingerprint,
            "generator_meta": option.generator_meta or {},
            "required_capabilities": option.required_capabilities or [],
            "status": option.status,
            "progress_current": option.progress_current,
            "explanation": option.explanation,
            "bound_match_id": bound_external,
        })
    return {
        "id": board.id,
        "date": board.board_date.isoformat(),
        "mode": board.game_match_mode,
        "status": board.status,
        "seed": board.seed,
        "generation": board.generation,
        "generator_version": board.generator_version,
        "attempts_used": board.attempts_used,
        "max_attempts": board.max_attempts,
        "baseline_match_id": board.baseline_match_id,
        "locked_at": board.locked_at.isoformat() if board.locked_at else None,
        "expires_at": board.expires_at.isoformat() if board.expires_at else None,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "contracts": contracts,
    }


@app.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: UUID, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    user = db.get(User, str(user_id))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    boards = list(db.scalars(select(ContractBoard).where(ContractBoard.user_id == user.id).order_by(ContractBoard.created_at.desc()).limit(30)).all())
    devices = list(db.scalars(select(CompanionDevice).where(CompanionDevice.user_id == user.id).order_by(CompanionDevice.created_at.desc()).limit(20)).all())
    evidence = list(db.scalars(select(CompanionMatchEvidence).where(CompanionMatchEvidence.user_id == user.id).order_by(CompanionMatchEvidence.captured_at.desc()).limit(30)).all())
    events = list(db.scalars(select(CompanionEvent).where(CompanionEvent.user_id == user.id).order_by(CompanionEvent.created_at.desc()).limit(30)).all())
    sessions = list(db.scalars(select(SessionToken).where(SessionToken.user_id == user.id).order_by(SessionToken.last_seen_at.desc()).limit(20)).all())
    rewards = list(db.scalars(select(RewardLedgerEntry).where(RewardLedgerEntry.user_id == user.id).order_by(RewardLedgerEntry.created_at.desc()).limit(40)).all())
    audit = list(db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.created_at.desc()).limit(30)).all())
    matches: list[dict] = []
    if user.account_id is not None:
        rows = db.execute(select(Match, MatchParticipant).join(MatchParticipant, MatchParticipant.match_id == Match.id).where(MatchParticipant.account_id == user.account_id).order_by(Match.started_at.desc().nullslast(), Match.external_match_id.desc()).limit(30)).all()
        for match, participant in rows:
            matches.append({
                "match_id": match.external_match_id,
                "mode": match.game_match_mode,
                "provider": match.provider,
                "is_final": match.is_final,
                "started_at": match.started_at.isoformat() if match.started_at else None,
                "ended_at": match.ended_at.isoformat() if match.ended_at else None,
                "duration_s": match.duration_s,
                "hero_id": participant.hero_id,
                "won": participant.won,
                "kills": participant.kills,
                "deaths": participant.deaths,
                "assists": participant.assists,
                "souls": participant.net_worth,
                "hero_damage": participant.hero_damage,
                "object_damage": participant.object_damage,
                "healing": participant.healing,
            })
    board_ids = {board.id for board in boards}
    recent_jobs = [item for item in db.scalars(select(Job).order_by(Job.created_at.desc()).limit(500)).all() if str((item.payload or {}).get("user_id") or "") == user.id or str((item.payload or {}).get("board_id") or "") in board_ids][:40]
    adaptive_profiles = {mode: build_adaptive_profile(db, user, mode) for mode in GAME_MODES}
    return {
        "user": _admin_user_summary(db, user),
        "adaptive_profiles": adaptive_profiles,
        "boards": [_admin_board_payload(db, board) for board in boards],
        "devices": [serialize_device(device) | {"id": device.id, "device_id": device.device_id, "created_at": device.created_at.isoformat() if device.created_at else None, "revoked_at": device.revoked_at.isoformat() if device.revoked_at else None} for device in devices],
        "evidence": [{
            "match_id": item.external_match_id,
            "mode": item.game_match_mode,
            "hero_id": item.hero_id,
            "kills": item.kills,
            "deaths": item.deaths,
            "assists": item.assists,
            "hero_damage": item.hero_damage,
            "object_damage": item.object_damage,
            "healing": item.healing,
            "souls": item.souls,
            "captured_at": item.captured_at.isoformat() if item.captured_at else None,
        } for item in evidence],
        "events": [{"event_type": item.event_type, "match_id": item.external_match_id, "mode": item.game_match_mode, "phase": item.phase, "created_at": item.created_at.isoformat() if item.created_at else None} for item in events],
        "matches": matches,
        "jobs": [{"id": item.id, "type": item.type, "status": item.status, "attempts": item.attempts, "max_attempts": item.max_attempts, "last_error": item.last_error, "run_after": item.run_after.isoformat() if item.run_after else None, "created_at": item.created_at.isoformat() if item.created_at else None} for item in recent_jobs],
        "sessions": [{"created_at": item.created_at.isoformat() if item.created_at else None, "last_seen_at": item.last_seen_at.isoformat() if item.last_seen_at else None, "expires_at": item.expires_at.isoformat() if item.expires_at else None, "admin_elevated": bool(item.admin_verified_at)} for item in sessions],
        "rewards": [{"id": item.id, "source_type": item.source_type, "source_id": item.source_id, "delta": item.delta, "balance_after": item.balance_after, "policy_version": item.policy_version, "created_at": item.created_at.isoformat() if item.created_at else None} for item in rewards],
        "audit": [{"id": item.id, "action": item.action, "entity_type": item.entity_type, "entity_id": item.entity_id, "data": item.data, "created_at": item.created_at.isoformat() if item.created_at else None} for item in audit],
    }


@app.post("/api/admin/users/{user_id}/revoke-companion", dependencies=[Depends(require_csrf)])
def admin_revoke_user_companion(user_id: UUID, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    user = db.get(User, str(user_id))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    now = datetime.now(timezone.utc)
    devices = list(db.scalars(select(CompanionDevice).where(CompanionDevice.user_id == user.id)).all())
    changed = 0
    for device in devices:
        if device.revoked_at is None:
            device.revoked_at = now
            changed += 1
    db.add(AuditLog(user_id=admin.id, action="admin.companion_revoked", entity_type="user", entity_id=user.id, data={"devices": changed}))
    db.commit()
    return {"ok": True, "revoked": changed}


@app.post("/api/admin/users/{user_id}/terminate-sessions", dependencies=[Depends(require_csrf)])
def admin_terminate_user_sessions(user_id: UUID, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    user = db.get(User, str(user_id))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.id == admin.id:
        raise HTTPException(409, "Собственную сессию завершайте обычным выходом")
    count = len(list(db.scalars(select(SessionToken).where(SessionToken.user_id == user.id)).all()))
    db.execute(delete(SessionToken).where(SessionToken.user_id == user.id))
    db.add(AuditLog(user_id=admin.id, action="admin.sessions_terminated", entity_type="user", entity_id=user.id, data={"sessions": count}))
    db.commit()
    return {"ok": True, "terminated": count}


@app.post("/api/admin/users/{user_id}/identity", dependencies=[Depends(require_csrf)])
def admin_update_user_identity(user_id: UUID, payload: AdminIdentityUpdateRequest, owner: User = Depends(_require_owner), db: Session = Depends(get_db)) -> dict:
    target = db.scalar(select(User).where(User.id == str(user_id)).with_for_update())
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if _effective_access_role(target) == "OWNER":
        raise HTTPException(409, "Роль владельца задаётся только серверным allowlist и не редактируется из браузера")
    new_badges = sorted({item for item in payload.badges if item in PUBLIC_BADGES})
    old_role = str(getattr(target, "access_role", "PLAYER") or "PLAYER").upper()
    old_badges = sorted({str(item).upper() for item in (getattr(target, "public_badges", None) or []) if str(item).upper() in PUBLIC_BADGES})
    target.access_role = payload.access_role
    target.public_badges = new_badges
    if old_role == "ADMIN" and payload.access_role != "ADMIN":
        for session in db.scalars(select(SessionToken).where(SessionToken.user_id == target.id)).all():
            session.admin_verified_at = None
            session.admin_totp_step = None
    db.add(AuditLog(user_id=owner.id, action="admin.user_identity_updated", entity_type="user", entity_id=target.id, data={"old_access_role": old_role, "new_access_role": payload.access_role, "old_badges": old_badges, "new_badges": new_badges}))
    db.commit()
    db.refresh(target)
    return {"user": _admin_user_summary(db, target)}


@app.post("/api/admin/users/{user_id}/status", dependencies=[Depends(require_csrf)])
def admin_update_user_status(user_id: UUID, payload: AdminUserStatusRequest, owner: User = Depends(_require_owner), db: Session = Depends(get_db)) -> dict:
    target = db.scalar(select(User).where(User.id == str(user_id)).with_for_update())
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if _effective_access_role(target) == "OWNER":
        raise HTTPException(409, "OWNER нельзя заблокировать из веб-консоли")
    old_status = target.status
    target.status = payload.status
    sessions_terminated = 0
    companions_revoked = 0
    if payload.status == "SUSPENDED":
        sessions_terminated = db.scalar(select(func.count()).select_from(SessionToken).where(SessionToken.user_id == target.id)) or 0
        db.execute(delete(SessionToken).where(SessionToken.user_id == target.id))
        now = datetime.now(timezone.utc)
        for device in db.scalars(select(CompanionDevice).where(CompanionDevice.user_id == target.id, CompanionDevice.revoked_at.is_(None))).all():
            device.revoked_at = now
            companions_revoked += 1
    db.add(AuditLog(user_id=owner.id, action="admin.user_status_updated", entity_type="user", entity_id=target.id, data={"old_status": old_status, "new_status": payload.status, "reason": payload.reason, "sessions_terminated": int(sessions_terminated), "companions_revoked": companions_revoked}))
    db.commit()
    db.refresh(target)
    return {"user": _admin_user_summary(db, target)}


@app.post("/api/admin/users/{user_id}/xp-adjust", dependencies=[Depends(require_csrf)])
def admin_adjust_user_xp(user_id: UUID, payload: AdminXpAdjustRequest, owner: User = Depends(_require_owner), db: Session = Depends(get_db)) -> dict:
    if payload.delta == 0:
        raise HTTPException(422, "Изменение XP не может быть нулевым")
    target = db.scalar(select(User).where(User.id == str(user_id)).with_for_update())
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    new_balance = target.xp + payload.delta
    if new_balance < 0:
        raise HTTPException(409, "XP не может стать отрицательным")
    target.xp = new_balance
    source_id = f"admin:{owner.id}:{target.id}:{secrets.token_hex(8)}"
    db.add(RewardLedgerEntry(user_id=target.id, source_type="ADMIN_ADJUSTMENT", source_id=source_id, delta=payload.delta, balance_after=new_balance, policy_version="admin-1"))
    db.add(AuditLog(user_id=owner.id, action="admin.xp_adjusted", entity_type="user", entity_id=target.id, data={"delta": payload.delta, "balance_after": new_balance, "reason": payload.reason}))
    db.commit()
    return {"ok": True, "balance": new_balance}


@app.get("/api/admin/jobs")
def admin_jobs(
    status: str = "ALL",
    type: str = "ALL",
    query: str = "",
    limit: int = 100,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 250))
    stmt = select(Job)
    if status.upper() != "ALL":
        stmt = stmt.where(Job.status == status.upper())
    if type.upper() != "ALL":
        stmt = stmt.where(Job.type == type)
    value = query.strip()[:180]
    if value:
        stmt = stmt.where(or_(Job.idempotency_key.ilike(f"%{value}%"), Job.last_error.ilike(f"%{value}%"), Job.type.ilike(f"%{value}%")))
    items = list(db.scalars(stmt.order_by(Job.created_at.desc()).limit(limit)).all())
    return {"items": [{"id": item.id, "type": item.type, "status": item.status, "attempts": item.attempts, "max_attempts": item.max_attempts, "run_after": item.run_after.isoformat() if item.run_after else None, "locked_at": item.locked_at.isoformat() if item.locked_at else None, "locked_by": item.locked_by, "last_error": item.last_error, "idempotency_key": item.idempotency_key, "payload": item.payload, "created_at": item.created_at.isoformat() if item.created_at else None} for item in items], "status_counts": _group_counts(db, Job, Job.status), "type_counts": _group_counts(db, Job, Job.type)}


@app.post("/api/admin/jobs/{job_id}/retry", dependencies=[Depends(require_csrf)])
def admin_retry_job(job_id: UUID, payload: AdminJobRetryRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    item = db.scalar(select(Job).where(Job.id == str(job_id)).with_for_update())
    if not item:
        raise HTTPException(404, "Задача не найдена")
    if item.status != "FAILED":
        raise HTTPException(409, "Повтор разрешён только для FAILED-задач")
    allowed_types = {"discover_match", "resolve_companion_match", "resolve_companion_match_auto", "evaluate_match", "refresh_review_match"}
    if item.type not in allowed_types:
        raise HTTPException(409, "Этот тип задачи нельзя повторять из веб-админки")
    item.status = "PENDING"
    item.attempts = 0
    item.run_after = datetime.now(timezone.utc)
    item.locked_at = None
    item.locked_by = None
    item.last_error = None
    db.add(AuditLog(user_id=admin.id, action="admin.job_retried", entity_type="job", entity_id=item.id, data={"type": item.type, "reason": payload.reason}))
    db.commit()
    return {"ok": True, "job_id": item.id}


@app.get("/api/admin/audit")
def admin_audit(
    query: str = "",
    action: str = "ALL",
    entity_type: str = "ALL",
    offset: int = 0,
    limit: int = 100,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 250))
    offset = max(0, min(int(offset), 100000))
    stmt = select(AuditLog)
    if action.upper() != "ALL":
        stmt = stmt.where(AuditLog.action == action)
    if entity_type.upper() != "ALL":
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    value = query.strip()[:120]
    if value:
        stmt = stmt.where(or_(AuditLog.action.ilike(f"%{value}%"), AuditLog.entity_type.ilike(f"%{value}%"), AuditLog.entity_id.ilike(f"%{value}%")))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = list(db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)).all())
    user_ids = {item.user_id for item in items if item.user_id}
    users = {user_id: db.get(User, user_id) for user_id in user_ids}
    return {"items": [{"id": item.id, "actor": users.get(item.user_id).display_name if item.user_id and users.get(item.user_id) else None, "actor_user_id": item.user_id, "action": item.action, "entity_type": item.entity_type, "entity_id": item.entity_id, "data": item.data, "created_at": item.created_at.isoformat() if item.created_at else None} for item in items], "total": int(total), "offset": offset, "limit": limit}


@app.get("/api/admin/matches")
def admin_matches(
    match_id: str = "",
    mode: str = "ALL",
    scoring_status: str = "ALL",
    limit: int = 100,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 200))
    stmt = select(Match)
    value = match_id.strip()
    if value:
        if not value.isdigit():
            raise HTTPException(422, "Match ID должен быть числом")
        stmt = stmt.where(Match.external_match_id == int(value))
    if mode.upper() in GAME_MODES or mode.upper() == "UNKNOWN":
        stmt = stmt.where(Match.game_match_mode == mode.upper())
    if scoring_status.upper() != "ALL":
        stmt = stmt.where(Match.scoring_status == scoring_status.upper())
    items = list(db.scalars(stmt.order_by(Match.created_at.desc()).limit(limit)).all())
    return {"items": [_admin_match_payload(db, item) for item in items], "mode_counts": _group_counts(db, Match, Match.game_match_mode), "scoring_counts": _group_counts(db, Match, Match.scoring_status)}


@app.get("/api/admin/matches/{external_match_id}")
def admin_match_detail(external_match_id: int, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    match = db.scalar(select(Match).where(Match.external_match_id == external_match_id))
    if not match:
        raise HTTPException(404, "Матч не найден")
    participants = list(db.scalars(select(MatchParticipant).where(MatchParticipant.match_id == match.id).order_by(MatchParticipant.account_id.asc())).all())
    options = list(db.scalars(select(BoardOption).where(BoardOption.bound_match_id == match.id).order_by(BoardOption.created_at.asc())).all())
    board_ids = {item.board_id for item in options}
    boards = {board_id: db.get(ContractBoard, board_id) for board_id in board_ids}
    user_ids = {board.user_id for board in boards.values() if board}
    users = {user_id: db.get(User, user_id) for user_id in user_ids}
    reviews = list(db.scalars(select(AutoReviewCase).where(AutoReviewCase.match_id == match.id).order_by(AutoReviewCase.created_at.desc())).all())
    evidence = list(db.scalars(select(CompanionMatchEvidence).where(CompanionMatchEvidence.external_match_id == external_match_id).order_by(CompanionMatchEvidence.captured_at.desc())).all())
    return {
        "match": _admin_match_payload(db, match),
        "participants": [{"account_id": item.account_id, "steam_id64": str(item.steam_id64 or ""), "hero_id": item.hero_id, "team": item.team, "won": item.won, "kills": item.kills, "deaths": item.deaths, "assists": item.assists, "net_worth": item.net_worth, "hero_damage": item.hero_damage, "object_damage": item.object_damage, "healing": item.healing} for item in participants],
        "contracts": [{"option_id": item.id, "board_id": item.board_id, "player": users.get(boards[item.board_id].user_id).display_name if boards.get(item.board_id) and users.get(boards[item.board_id].user_id) else None, "title": item.rendered_title, "status": item.status, "metric": item.metric, "target": item.target, "progress_current": item.progress_current, "explanation": item.explanation} for item in options],
        "reviews": [{"id": item.id, "status": item.status, "reasons": item.reasons, "reviewer_note": item.reviewer_note, "created_at": item.created_at.isoformat() if item.created_at else None, "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None} for item in reviews],
        "companion_evidence": [{"user_id": item.user_id, "mode": item.game_match_mode, "kills": item.kills, "deaths": item.deaths, "assists": item.assists, "hero_damage": item.hero_damage, "object_damage": item.object_damage, "healing": item.healing, "souls": item.souls, "captured_at": item.captured_at.isoformat() if item.captured_at else None} for item in evidence],
    }


@app.get("/api/admin/boards")
def admin_boards(
    query: str = "",
    mode: str = "ALL",
    status: str = "ALL",
    limit: int = 100,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 200))
    stmt = select(ContractBoard, User).join(User, User.id == ContractBoard.user_id)
    value = query.strip()[:120]
    if value:
        clauses = [User.display_name.ilike(f"%{value}%"), ContractBoard.id.ilike(f"%{value}%")]
        if value.isdigit():
            number_value = int(value)
            clauses.extend((User.steam_id64 == number_value, User.account_id == number_value, ContractBoard.baseline_match_id == number_value))
        stmt = stmt.where(or_(*clauses))
    if mode.upper() in GAME_MODES:
        stmt = stmt.where(ContractBoard.game_match_mode == mode.upper())
    if status.upper() != "ALL":
        stmt = stmt.where(ContractBoard.status == status.upper())
    rows = db.execute(stmt.order_by(ContractBoard.created_at.desc()).limit(limit)).all()
    return {"items": [{"board": _admin_board_payload(db, board), "user": {"id": user.id, "display_name": user.display_name, "steam_id64": str(user.steam_id64 or "")}} for board, user in rows], "status_counts": _group_counts(db, ContractBoard, ContractBoard.status), "mode_counts": _group_counts(db, ContractBoard, ContractBoard.game_match_mode)}


@app.get("/api/admin/boards/{board_id}")
def admin_board_detail(board_id: UUID, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    board = db.get(ContractBoard, str(board_id))
    if not board:
        raise HTTPException(404, "Дело не найдено")
    user = db.get(User, board.user_id)
    options = list(db.scalars(select(BoardOption).where(BoardOption.board_id == board.id).order_by(BoardOption.created_at.asc())).all())
    option_ids = [item.id for item in options]
    evaluations = list(db.scalars(select(Evaluation).where(Evaluation.assignment_id.in_(option_ids)).order_by(Evaluation.created_at.desc())).all()) if option_ids else []
    jobs = list(db.scalars(select(Job).order_by(Job.created_at.desc()).limit(500)).all())
    jobs = [item for item in jobs if str((item.payload or {}).get("board_id") or "") == board.id][:50]
    reviews = list(db.scalars(select(AutoReviewCase).where(AutoReviewCase.board_id == board.id).order_by(AutoReviewCase.created_at.desc())).all())
    return {
        "board": _admin_board_payload(db, board),
        "user": {"id": user.id, "display_name": user.display_name, "steam_id64": str(user.steam_id64 or ""), "account_id": user.account_id} if user else None,
        "options": [{"id": item.id, "title": item.rendered_title, "description": item.rendered_description, "selected": item.selected, "status": item.status, "metric": item.metric, "operator": item.operator, "target": item.target, "reward_xp": item.reward_xp, "difficulty": item.difficulty, "rarity": item.rarity, "category": item.category, "conditions": item.conditions or [], "fingerprint": item.fingerprint, "generator_meta": item.generator_meta or {}, "progress_current": item.progress_current, "progress_target": item.progress_target, "explanation": item.explanation, "bound_match_id": db.get(Match, item.bound_match_id).external_match_id if item.bound_match_id and db.get(Match, item.bound_match_id) else None} for item in options],
        "evaluations": [{"id": item.id, "assignment_id": item.assignment_id, "revision": item.revision, "status": item.status, "evidence_level": item.evidence_level, "progress_current": item.progress_current, "progress_target": item.progress_target, "score": item.score, "explanation": item.explanation, "facts": item.facts, "created_at": item.created_at.isoformat() if item.created_at else None} for item in evaluations],
        "jobs": [{"id": item.id, "type": item.type, "status": item.status, "attempts": item.attempts, "max_attempts": item.max_attempts, "run_after": item.run_after.isoformat() if item.run_after else None, "last_error": item.last_error, "payload": item.payload, "created_at": item.created_at.isoformat() if item.created_at else None} for item in jobs],
        "reviews": [{"id": item.id, "status": item.status, "reasons": item.reasons, "context": item.context, "reviewer_note": item.reviewer_note, "created_at": item.created_at.isoformat() if item.created_at else None} for item in reviews],
    }


@app.post("/api/admin/boards/{board_id}/retry-verification", dependencies=[Depends(require_csrf)])
def admin_retry_board_verification(
    board_id: UUID,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    board = db.get(ContractBoard, str(board_id))
    if not board:
        raise HTTPException(404, "Дело не найдено")
    if board.status != "VERIFYING":
        raise HTTPException(409, "Повторная автоматическая проверка доступна только для VERIFYING")

    selected = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )
    match_ids = {item.bound_match_id for item in selected if item.bound_match_id}
    if len(match_ids) != 1:
        raise HTTPException(409, "У дела нет единственного привязанного матча")
    match = db.get(Match, next(iter(match_ids)))
    if not match or not match.is_final:
        raise HTTPException(409, "Привязанный матч ещё не подтверждён как final")

    queued = list(
        db.scalars(
            select(Job)
            .where(Job.type == "evaluate_match", Job.status.in_(("PENDING", "RUNNING")))
            .order_by(Job.created_at.desc())
            .limit(200)
        ).all()
    )
    existing = next(
        (item for item in queued if str((item.payload or {}).get("board_id") or "") == board.id),
        None,
    )
    if existing:
        return {"ok": True, "already_queued": True, "job_id": existing.id, "match_id": match.external_match_id}

    job = enqueue_job(
        db,
        "evaluate_match",
        {
            "board_id": board.id,
            "match_id": match.id,
            "admin_retry": True,
        },
        f"admin-evaluate:{board.id}:{match.id}:{secrets.token_hex(6)}",
        max_attempts=max(3, settings.post_match_verification_max_attempts),
    )
    db.add(AuditLog(
        user_id=admin.id,
        action="admin.board_verification_retried",
        entity_type="contract_board",
        entity_id=board.id,
        data={"job_id": job.id, "match_id": match.external_match_id},
    ))
    db.commit()
    return {"ok": True, "already_queued": False, "job_id": job.id, "match_id": match.external_match_id}


@app.get("/api/admin/companions")
def admin_companions(
    query: str = "",
    state: str = "ALL",
    version: str = "ALL",
    limit: int = 150,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 250))
    stmt = select(CompanionDevice, User).join(User, User.id == CompanionDevice.user_id)
    value = query.strip()[:120]
    if value:
        clauses = [User.display_name.ilike(f"%{value}%"), CompanionDevice.device_id.ilike(f"%{value}%")]
        if value.isdigit():
            number_value = int(value)
            clauses.extend((User.steam_id64 == number_value, User.account_id == number_value, CompanionDevice.current_match_id == number_value))
        stmt = stmt.where(or_(*clauses))
    if version.upper() != "ALL":
        stmt = stmt.where(CompanionDevice.version == version)
    online_cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.companion_online_seconds)
    state_value = state.upper()
    if state_value == "ONLINE":
        stmt = stmt.where(CompanionDevice.revoked_at.is_(None), CompanionDevice.last_seen_at >= online_cutoff)
    elif state_value == "ACTIVE":
        stmt = stmt.where(CompanionDevice.revoked_at.is_(None))
    elif state_value == "REVOKED":
        stmt = stmt.where(CompanionDevice.revoked_at.is_not(None))
    rows = db.execute(stmt.order_by(CompanionDevice.created_at.desc()).limit(limit)).all()
    versions = {str(key or "UNKNOWN"): int(count) for key, count in db.execute(select(CompanionDevice.version, func.count()).group_by(CompanionDevice.version)).all()}
    return {"items": [{"id": device.id, "device_id": device.device_id, "user": {"id": user.id, "display_name": user.display_name, "steam_id64": str(user.steam_id64 or "")}, "status": serialize_device(device), "created_at": device.created_at.isoformat() if device.created_at else None, "revoked_at": device.revoked_at.isoformat() if device.revoked_at else None} for device, user in rows], "version_counts": versions}


@app.post("/api/admin/companions/{device_record_id}/revoke", dependencies=[Depends(require_csrf)])
def admin_revoke_companion_device(device_record_id: UUID, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    device = db.scalar(select(CompanionDevice).where(CompanionDevice.id == str(device_record_id)).with_for_update())
    if not device:
        raise HTTPException(404, "Companion не найден")
    if device.revoked_at is None:
        device.revoked_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=admin.id, action="admin.companion_device_revoked", entity_type="companion_device", entity_id=device.id, data={"device_id": device.device_id, "owner_user_id": device.user_id}))
    db.commit()
    return {"ok": True}


@app.get("/api/admin/missions")
def admin_missions(
    query: str = "",
    mode: str = "ALL",
    status: str = "ALL",
    limit: int = 250,
    admin: User = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    limit = max(1, min(int(limit), 500))
    stmt = select(MissionDefinition)
    value = query.strip()[:120]
    if value:
        stmt = stmt.where(or_(MissionDefinition.key.ilike(f"%{value}%"), MissionDefinition.title.ilike(f"%{value}%"), MissionDefinition.metric.ilike(f"%{value}%")))
    if mode.upper() in GAME_MODES:
        stmt = stmt.where(MissionDefinition.game_match_mode == mode.upper())
    if status.upper() != "ALL":
        stmt = stmt.where(MissionDefinition.status == status.upper())
    items = list(db.scalars(stmt.order_by(MissionDefinition.game_match_mode, MissionDefinition.key, MissionDefinition.version.desc()).limit(limit)).all())
    return {"items": [_admin_mission_payload(item) for item in items], "mode_counts": _group_counts(db, MissionDefinition, MissionDefinition.game_match_mode), "status_counts": _group_counts(db, MissionDefinition, MissionDefinition.status), "difficulty_counts": _group_counts(db, MissionDefinition, MissionDefinition.difficulty), "rarity_counts": _group_counts(db, MissionDefinition, MissionDefinition.rarity)}


@app.patch("/api/admin/missions/{mission_id}", dependencies=[Depends(require_csrf)])
def admin_update_mission(mission_id: UUID, payload: AdminMissionUpdateRequest, owner: User = Depends(_require_owner), db: Session = Depends(get_db)) -> dict:
    if not payload.model_fields_set:
        raise HTTPException(422, "Нет изменений")
    item = db.scalar(select(MissionDefinition).where(MissionDefinition.id == str(mission_id)).with_for_update())
    if not item:
        raise HTTPException(404, "Шаблон контракта не найден")
    allowed = {"title", "description", "target", "reward_xp", "base_xp", "difficulty", "rarity", "drop_weight", "drop_chance_pct", "category", "status"}
    before = {name: getattr(item, name) for name in allowed}
    for name in payload.model_fields_set:
        if name in allowed:
            value = getattr(payload, name)
            if value is not None:
                setattr(item, name, value)
    after = {name: getattr(item, name) for name in allowed}
    changed = {name: {"from": before[name], "to": after[name]} for name in allowed if before[name] != after[name]}
    if not changed:
        raise HTTPException(422, "Фактических изменений нет")
    db.add(AuditLog(user_id=owner.id, action="admin.mission_updated", entity_type="mission_definition", entity_id=item.id, data={"key": item.key, "version": item.version, "changes": changed}))
    db.commit()
    db.refresh(item)
    return {"mission": _admin_mission_payload(item)}


@app.post("/api/admin/generator/preview", dependencies=[Depends(require_csrf)])
def admin_generator_preview(payload: AdminGeneratorPreviewRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    missions = list(db.scalars(select(MissionDefinition).where(MissionDefinition.status == "PUBLISHED", MissionDefinition.version == 2, MissionDefinition.game_match_mode == payload.mode).order_by(MissionDefinition.key)).all())
    if len({item.metric for item in missions}) < 6:
        raise HTTPException(409, f"Для {payload.mode} недостаточно разных безопасных метрик для Contracts 2.0")
    boards = []
    frequency: Counter[str] = Counter()
    category_frequency: Counter[str] = Counter()
    rarity_frequency: Counter[str] = Counter()
    difficulty_frequency: Counter[str] = Counter()
    condition_count_frequency: Counter[str] = Counter()
    fingerprints: set[str] = set()
    duplicates = 0
    recent_fingerprints: set[str] = set()
    recent_signatures: set[str] = set()
    for index in range(payload.boards):
        seed = f"{payload.seed_prefix}:{payload.mode}:{index}"
        selected = generate_contracts_v2(
            missions,
            seed,
            board_size=6,
            recent_fingerprints=recent_fingerprints,
            recent_metric_signatures=recent_signatures,
        )
        board_fingerprint = "|".join(sorted(item.fingerprint for item in selected))
        if board_fingerprint in fingerprints:
            duplicates += 1
        fingerprints.add(board_fingerprint)
        for item in selected:
            recent_fingerprints.add(item.fingerprint)
            signature = str(item.generator_meta.get("metric_signature") or "")
            if signature:
                recent_signatures.add(signature)
            frequency[item.base_key] += 1
            category_frequency[item.category] += 1
            rarity_frequency[item.rarity] += 1
            difficulty_frequency[item.difficulty] += 1
            condition_count_frequency[str(len(item.conditions))] += 1
        boards.append({"seed": seed, "fingerprint": board_fingerprint, "contracts": [preview_payload(item) for item in selected]})
    slots = payload.boards * 6
    return {
        "mode": payload.mode,
        "generator_version": GENERATOR_VERSION,
        "boards": boards,
        "stats": {
            "templates_available": len(missions),
            "metrics_available": len({item.metric for item in missions}),
            "boards_generated": payload.boards,
            "unique_boards": len(fingerprints),
            "duplicate_boards": duplicates,
            "contract_frequency": [{"key": key, "count": count, "slot_pct": round(count * 100.0 / slots, 1)} for key, count in frequency.most_common()],
            "categories": dict(category_frequency),
            "rarities": dict(rarity_frequency),
            "difficulties": dict(difficulty_frequency),
            "condition_counts": dict(condition_count_frequency),
        },
    }


@app.get("/api/admin/system")
def admin_system(admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "release": {"name": settings.app_name, "version": settings.app_version, "environment": settings.app_env, "service_role": settings.service_role, "contract_generator": GENERATOR_VERSION},
        "database": {"dialect": engine.dialect.name},
        "provider": {"name": settings.provider, "base_url": settings.deadlock_api_base_url, "force_refetch": settings.deadlock_force_refetch, "adapter_version": settings.adapter_version, "mode_classifier_version": settings.mode_classifier_version, "evaluator_version": settings.evaluator_version},
        "contracts": {"board_reset_hour_utc": settings.board_reset_hour_utc, "case_max_attempts": settings.case_max_attempts, "case_ttl_hours": settings.case_ttl_hours, "discovery_retry_seconds": settings.discovery_retry_seconds, "max_discovery_attempts": settings.max_discovery_attempts},
        "companion": {"online_seconds": settings.companion_online_seconds, "pairing_ttl_minutes": settings.companion_pairing_ttl_minutes, "event_retention_days": settings.companion_event_retention_days, "download_configured": bool(settings.companion_download_url)},
        "security": {"totp_configured": bool(settings.admin_totp_secret), "owner_allowlist_count": len(settings.admin_steam_ids), "admin_session_ttl_minutes": settings.admin_session_ttl_minutes, "docs_enabled": settings.docs_enabled, "demo_auth": settings.allow_demo_auth, "dev_endpoints": settings.allow_dev_endpoints, "cookie_secure": settings.cookie_secure, "trusted_hosts": list(settings.trusted_hosts)},
        "limits": {"global_rate_limit_per_minute": settings.global_rate_limit_per_minute, "auth_rate_limit_per_10_minutes": settings.auth_rate_limit_per_10_minutes, "sync_rate_limit_per_hour": settings.sync_rate_limit_per_hour, "max_request_body_bytes": settings.max_request_body_bytes, "max_provider_response_bytes": settings.max_provider_response_bytes},
        "counts": {"users": int(db.scalar(select(func.count()).select_from(User)) or 0), "missions": int(db.scalar(select(func.count()).select_from(MissionDefinition)) or 0), "matches": int(db.scalar(select(func.count()).select_from(Match)) or 0), "boards": int(db.scalar(select(func.count()).select_from(ContractBoard)) or 0), "jobs": int(db.scalar(select(func.count()).select_from(Job)) or 0), "audit": int(db.scalar(select(func.count()).select_from(AuditLog)) or 0)},
        "server_time": now.isoformat(),
    }


@app.get("/api/admin/auto-reviews")
def admin_auto_reviews(status: str = "PENDING", admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    query = select(AutoReviewCase).order_by(AutoReviewCase.created_at.desc()).limit(100)
    if status != "ALL":
        query = query.where(AutoReviewCase.status == status)
    items = list(db.scalars(query).all())
    return {"items": [_serialize_auto_review(db, item) for item in items]}


@app.post("/api/admin/auto-reviews/{review_id}/decision", dependencies=[Depends(require_csrf)])
def decide_auto_review(review_id: UUID, payload: AutoReviewDecisionRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)) -> dict:
    item = db.scalar(select(AutoReviewCase).where(AutoReviewCase.id == str(review_id)).with_for_update())
    if not item:
        raise HTTPException(404, "Внутренняя заявка не найдена")
    if item.status not in {"PENDING", "NEEDS_INFO"}:
        raise HTTPException(409, "Заявка уже закрыта")
    board = db.scalar(select(ContractBoard).options(selectinload(ContractBoard.options)).where(ContractBoard.id == item.board_id).with_for_update())
    if not board:
        raise HTTPException(404, "Дело не найдено")
    pending = {option.id: option for option in board.options if option.selected and option.status == "REVIEW_REQUIRED"}
    verdicts = {str(verdict.option_id): verdict for verdict in payload.options}
    if payload.status == "RESOLVED" and set(verdicts) != set(pending):
        raise HTTPException(422, "Для закрытия нужно указать решение по каждому контракту, ожидающему внутренней проверки")
    owner = db.scalar(select(User).where(User.id == item.user_id).with_for_update())
    if not owner:
        raise HTTPException(404, "Пользователь не найден")
    now = datetime.now(timezone.utc)
    for option_id, option in pending.items():
        verdict = verdicts.get(option_id)
        if payload.status == "REJECTED":
            option.status = "FAILED"
            option.explanation = payload.reviewer_note or "Внутренняя проверка не подтвердила выполнение контракта."
        else:
            option.status = verdict.status
            option.progress_current = verdict.progress_current
            option.progress_target = float(len(option.conditions)) if option.conditions and len(option.conditions) > 1 else option.target
            option.explanation = verdict.explanation
        option.settled_at = now
        if option.status == "COMPLETED":
            exists = db.scalar(select(RewardLedgerEntry).where(RewardLedgerEntry.source_type == "AUTO_REVIEW", RewardLedgerEntry.source_id == option.id))
            if not exists:
                owner.xp += option.reward_xp
                db.add(RewardLedgerEntry(user_id=owner.id, source_type="AUTO_REVIEW", source_id=option.id, delta=option.reward_xp, balance_after=owner.xp, policy_version="xp-v3-review"))
    item.status = payload.status
    item.reviewer_id = admin.id
    item.reviewer_note = payload.reviewer_note or None
    item.decision_payload = {"options": [entry.model_dump(mode="json") for entry in payload.options]}
    item.reviewed_at = now
    selected = [option for option in board.options if option.selected]
    final_statuses = {"COMPLETED", "FAILED", "VOID", "EXPIRED"}
    resume_discovery = False
    if selected and all(option.status in final_statuses for option in selected):
        board.status = "SETTLED"
    elif any(option.status == "REVIEW_REQUIRED" for option in selected):
        board.status = "REVIEW_REQUIRED"
    elif (
        int(board.attempts_used or 0) < int(board.max_attempts or 0)
        and any(option.status == "LOCKED" for option in selected)
    ):
        # Internal review only settles the unverifiable contracts from this
        # attempt. Retryable contracts must continue on the next eligible game.
        reviewed_match = db.get(Match, item.match_id)
        if reviewed_match:
            board.baseline_match_id = max(
                int(board.baseline_match_id or 0),
                int(reviewed_match.external_match_id),
            )
        board.status = "LOCKED"
        resume_discovery = True
    else:
        board.status = "REVIEW_REQUIRED"

    db.add(AuditLog(user_id=admin.id, action="auto_review.decided", entity_type="auto_review_case", entity_id=item.id, data={"status": payload.status, "board_id": board.id}))
    db.commit()
    if resume_discovery:
        active = list(
            db.scalars(
                select(Job).where(
                    Job.type == "discover_match",
                    Job.status.in_(("PENDING", "RUNNING")),
                )
            ).all()
        )
        if not any(
            str((candidate.payload or {}).get("board_id") or "") == board.id
            for candidate in active
        ):
            enqueue_job(
                db,
                "discover_match",
                {"board_id": board.id},
                f"discover:{board.id}:review-resume:{item.id}",
                max_attempts=settings.max_discovery_attempts,
            )
    db.refresh(item)
    return {"review": _serialize_auto_review(db, item)}


@app.post("/api/matches/sync", dependencies=[Depends(require_csrf)])
def sync_matches(mode: str = "STANDARD", user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    try:
        board = ensure_daily_board(db, user, normalize_mode(mode))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if board.status == "OFFERED":
        raise HTTPException(409, "Сначала зафиксируйте контракты этого режима")
    if board.status == "SETTLED":
        return {"queued": False, "reason": "board_settled"}

    now = datetime.now(timezone.utc)
    candidates = list(db.scalars(select(Job).where(Job.type == "discover_match", Job.status.in_(("PENDING", "RUNNING"))).order_by(Job.created_at.asc())).all())
    job = next((item for item in candidates if str((item.payload or {}).get("board_id") or "") == board.id), None)
    if job:
        if job.status == "PENDING":
            job.run_after = now
            job.last_error = None
            job.max_attempts = max(job.max_attempts, settings.max_discovery_attempts)
            db.commit()
    else:
        job = enqueue_job(
            db,
            "discover_match",
            {"board_id": board.id},
            f"discover:{board.id}:attempt:{min(board.attempts_used + 1, board.max_attempts)}",
            max_attempts=settings.max_discovery_attempts,
        )
    db.add(AuditLog(user_id=user.id, action="match.sync_requested", entity_type="board", entity_id=board.id, data={"deduplicated": True, "mode": board.game_match_mode}))
    db.commit()
    return {"queued": True, "job_id": job.id, "status": job.status, "next_check_at": job.run_after.isoformat() if job.status == "PENDING" else None}


def _mock_stats(scenario: str, mode: str) -> dict:
    short = mode == "STREET_BRAWL"
    duration = 720 if short else 1950
    base = {"won": True, "kills": 30 if not short else 20, "deaths": 2, "assists": 30 if not short else 24, "net_worth": 65000 if not short else 30000, "hero_damage": 70000 if not short else 40000, "object_damage": 25000 if not short else 0, "healing": 18000 if not short else 9000, "duration_s": duration, "mode": mode}
    if scenario == "failure":
        base.update({"won": False, "kills": 2, "deaths": 11, "assists": 3, "net_worth": 12000, "hero_damage": 7000, "object_damage": 800, "healing": 300})
    elif scenario == "mixed":
        base.update({"won": True, "kills": 7, "deaths": 5, "assists": 14, "net_worth": 28500, "hero_damage": 26000, "object_damage": 6200, "healing": 7500})
    elif scenario == "unknown_mode":
        base["mode"] = "UNKNOWN"
    elif scenario == "missing_data":
        base["healing"] = None
    return base


@app.post("/api/dev/mock-match", dependencies=[Depends(require_csrf)])
def create_mock_match(payload: MockMatchRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    if not settings.allow_dev_endpoints:
        raise HTTPException(404, "Служебные endpoints отключены")
    board = db.scalar(
        select(ContractBoard)
        .options(selectinload(ContractBoard.options))
        .where(
            ContractBoard.user_id == user.id,
            ContractBoard.board_date == today_utc(),
            ContractBoard.game_match_mode == payload.mode,
        )
    )
    if not board or not board.locked_at:
        raise HTTPException(409, "Сначала выберите и зафиксируйте контракты этого режима")
    if board.status == "SETTLED":
        raise HTTPException(409, "Дело этого режима уже закрыто")
    stats = _mock_stats(payload.scenario, payload.mode)
    external_id = int(datetime.now(timezone.utc).timestamp() * 1000) + secrets.randbelow(1000)
    locked_at = board.locked_at if board.locked_at.tzinfo else board.locked_at.replace(tzinfo=timezone.utc)
    started_at = locked_at + timedelta(seconds=5)
    capabilities = [
        "summary.result", "summary.kills", "summary.deaths", "summary.assists",
        "summary.net_worth", "summary.hero_damage", "summary.object_damage",
        "summary.healing", "summary.duration",
    ]
    if payload.scenario == "missing_data":
        capabilities = ["summary.duration"]
    match = Match(
        external_match_id=external_id, provider="mock", started_at=started_at,
        ended_at=started_at + timedelta(seconds=stats["duration_s"]), duration_s=stats["duration_s"],
        game_match_mode=stats["mode"], provider_mode_raw=f"mock:{stats['mode']}",
        mode_classifier_version=settings.mode_classifier_version, mode_confidence="HIGH" if stats["mode"] != "UNKNOWN" else "LOW",
        scoring_status="SCORED", game_version="local-fixture-v3", is_final=True, capabilities=capabilities,
        raw_summary={"scenario": payload.scenario, "mode": payload.mode},
    )
    db.add(match); db.flush()
    db.add(MatchParticipant(
        match_id=match.id, account_id=user.account_id or 0, steam_id64=user.steam_id64, hero_id=1, team=0, won=stats["won"],
        kills=stats["kills"], deaths=stats["deaths"], assists=stats["assists"], net_worth=stats["net_worth"],
        hero_damage=stats["hero_damage"], object_damage=stats["object_damage"], healing=stats["healing"],
    ))
    db.commit()
    job = enqueue_job(db, "bind_match", {"board_id": board.id, "match_id": match.id}, f"bind:{board.id}:{match.id}")
    return {"created": True, "match_id": external_id, "job_id": job.id, "scenario": payload.scenario, "mode": payload.mode}


@app.get("/api/history")
def history(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    return {"items": _history_items(db, user)}


@app.get("/api/xp-ledger")
def xp_ledger(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    entries = list(
        db.scalars(
            select(RewardLedgerEntry)
            .where(RewardLedgerEntry.user_id == user.id)
            .order_by(RewardLedgerEntry.created_at.desc())
            .limit(100)
        ).all()
    )
    return {
        "balance": user.xp,
        "items": [
            {
                "id": entry.id,
                "delta": entry.delta,
                "balance_after": entry.balance_after,
                "source_type": entry.source_type,
                "source_id": entry.source_id,
                "created_at": entry.created_at.isoformat(),
            }
            for entry in entries
        ],
    }


@app.post("/api/account/delete", dependencies=[Depends(require_csrf)])
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    account_id = user.account_id
    submissions = list(db.scalars(select(EvidenceSubmission).where(EvidenceSubmission.user_id == user.id)).all())
    if submissions:
        submission_ids = [item.id for item in submissions]
        evidence_files = list(db.scalars(select(EvidenceFile).where(EvidenceFile.submission_id.in_(submission_ids))).all())
        for evidence in evidence_files:
            (Path(settings.evidence_dir) / evidence.storage_name).unlink(missing_ok=True)
    db.add(AuditLog(user_id=None, action="account.deleted", entity_type="user", entity_id=user.id, data={}))
    if account_id is not None:
        db.execute(delete(MatchParticipant).where(MatchParticipant.account_id == account_id))
    db.delete(user)
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/", secure=settings.cookie_secure, samesite="lax")
    return {"deleted": True}


@app.get("/api/dev/jobs")
def jobs(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    if not settings.allow_dev_endpoints:
        raise HTTPException(404, "Служебные endpoints отключены")
    items = list(db.scalars(select(Job).order_by(Job.created_at.desc()).limit(30)).all())
    return {
        "items": [
            {
                "id": job.id,
                "type": job.type,
                "status": job.status,
                "attempts": job.attempts,
                "max_attempts": job.max_attempts,
                "run_after": job.run_after.isoformat(),
                "last_error": job.last_error,
            }
            for job in items
        ]
    }


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
def unknown_api(path: str) -> JSONResponse:
    return JSONResponse({"detail": "API endpoint not found"}, status_code=404)


@app.api_route("/auth/{path:path}", methods=["GET", "POST"], include_in_schema=False)
def unknown_auth(path: str) -> JSONResponse:
    return JSONResponse({"detail": "Authentication endpoint not found"}, status_code=404)


@app.get("/openapi.json", include_in_schema=False)
def disabled_openapi() -> JSONResponse:
    return JSONResponse({"detail": "Not found"}, status_code=404)


@app.get("/docs", include_in_schema=False)
def disabled_docs() -> JSONResponse:
    return JSONResponse({"detail": "Not found"}, status_code=404)


@app.get("/redoc", include_in_schema=False)
def disabled_redoc() -> JSONResponse:
    return JSONResponse({"detail": "Not found"}, status_code=404)


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/reviewer", include_in_schema=False)
def reviewer_page() -> FileResponse:
    if not reviewer_access_available():
        raise HTTPException(404, "Not found")
    return FileResponse(
        STATIC / "reviewer.html",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    )


@app.get("/privacy", include_in_schema=False)
def privacy_page() -> FileResponse:
    return FileResponse(STATIC / "legal.html")


@app.get("/terms", include_in_schema=False)
def terms_page() -> FileResponse:
    return FileResponse(STATIC / "legal.html")


@app.get("/support", include_in_schema=False)
def support_page() -> FileResponse:
    return FileResponse(STATIC / "legal.html")


@app.get("/{path:path}")
def spa(path: str) -> FileResponse:
    # The SPA fallback never serves arbitrary filesystem paths.
    return FileResponse(STATIC / "index.html")
