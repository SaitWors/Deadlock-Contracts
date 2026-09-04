from __future__ import annotations

import hashlib
import secrets
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AuditLog, TelegramLinkToken, TelegramModeratorBinding, User


class TelegramBindingError(RuntimeError):
    status_code = 400
    code = "TELEGRAM_BINDING_ERROR"

    def __init__(self, detail: str, *, status_code: int | None = None, code: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


@dataclass(frozen=True)
class TelegramLink:
    link_url: str
    expires_at: str

    def to_dict(self) -> dict[str, str]:
        return {"link_url": self.link_url, "expires_at": self.expires_at}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _clean_username(value: str | None) -> str | None:
    clean = str(value or "").strip().lstrip("@")
    return clean[:64] or None


def _clean_first_name(value: str | None) -> str | None:
    clean = str(value or "").strip()
    return clean[:128] or None


def active_binding(db: Session, user_id: str) -> TelegramModeratorBinding | None:
    return db.scalar(
        select(TelegramModeratorBinding)
        .where(
            TelegramModeratorBinding.user_id == str(user_id),
            TelegramModeratorBinding.revoked_at.is_(None),
        )
        .order_by(TelegramModeratorBinding.verified_at.desc())
    )


def binding_status(db: Session, *, user_id: str) -> dict[str, Any]:
    item = active_binding(db, user_id)
    return {
        "linked": item is not None,
        "bot_username": settings.telegram_bot_username or None,
        "binding": (
            {
                "telegram_user_id": item.telegram_user_id,
                "telegram_username": item.telegram_username,
                "telegram_first_name": item.telegram_first_name,
                "verified_at": item.verified_at.isoformat() if item.verified_at else None,
                "last_used_at": item.last_used_at.isoformat() if item.last_used_at else None,
            }
            if item is not None
            else None
        ),
    }


def _staff_binding_allowed(user: User) -> bool:
    if str(user.steam_id64 or "") in {
        str(value) for value in getattr(settings, "admin_steam_ids", ())
    }:
        return True
    role = str(getattr(user, "access_role", "PLAYER") or "PLAYER").upper()
    return role in {"MODERATOR", "ADMIN"}


def create_link_token(db: Session, *, user_id: str) -> TelegramLink:
    bot_username = str(settings.telegram_bot_username or "").strip().lstrip("@")
    if not bot_username:
        raise TelegramBindingError("Telegram bot username не настроен", status_code=503, code="BOT_USERNAME_NOT_CONFIGURED")

    user = db.get(User, str(user_id))
    if user is None or user.status != "ACTIVE":
        raise TelegramBindingError("Привязка Telegram недоступна", status_code=403, code="BINDING_NOT_ALLOWED")
    if not _staff_binding_allowed(user):
        raise TelegramBindingError(
            "Telegram можно привязать только к staff-аккаунту",
            status_code=403,
            code="STAFF_ROLE_REQUIRED",
        )

    now = utcnow()
    for old in db.scalars(
        select(TelegramLinkToken).where(
            TelegramLinkToken.user_id == user.id,
            TelegramLinkToken.used_at.is_(None),
        )
    ).all():
        old.used_at = now

    raw_token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(minutes=int(settings.telegram_link_token_ttl_minutes))
    db.add(TelegramLinkToken(user_id=user.id, token_hash=_hash_token(raw_token), expires_at=expires_at))
    db.add(AuditLog(
        user_id=user.id,
        action="telegram.link_token_created",
        entity_type="user",
        entity_id=user.id,
        data={"expires_at": expires_at.isoformat(), "ttl_minutes": int(settings.telegram_link_token_ttl_minutes)},
    ))
    db.commit()

    start_payload = f"link_{raw_token}"
    link_url = (
        f"https://t.me/{urllib.parse.quote(bot_username, safe='')}"
        f"?start={urllib.parse.quote(start_payload, safe='_')}"
    )
    return TelegramLink(link_url=link_url, expires_at=expires_at.isoformat())


def consume_link_token(
    db: Session,
    *,
    raw_token: str,
    telegram_user_id: int,
    telegram_username: str | None = None,
    telegram_first_name: str | None = None,
) -> TelegramModeratorBinding:
    raw_token = str(raw_token or "").strip()
    if not 32 <= len(raw_token) <= 128:
        raise TelegramBindingError("Недействительная ссылка привязки", status_code=400, code="INVALID_LINK_TOKEN")

    now = utcnow()
    token = db.scalar(
        select(TelegramLinkToken)
        .where(TelegramLinkToken.token_hash == _hash_token(raw_token))
        .with_for_update()
    )
    if token is None:
        raise TelegramBindingError("Недействительная ссылка привязки", status_code=400, code="INVALID_LINK_TOKEN")
    if token.used_at is not None:
        raise TelegramBindingError("Ссылка привязки уже использована", status_code=409, code="LINK_TOKEN_ALREADY_USED")
    if (_aware(token.expires_at) or now) <= now:
        token.used_at = now
        db.commit()
        raise TelegramBindingError("Срок действия ссылки привязки истёк", status_code=410, code="LINK_TOKEN_EXPIRED")

    user = db.get(User, token.user_id)
    if user is None or user.status != "ACTIVE":
        raise TelegramBindingError("Привязка Telegram недоступна", status_code=403, code="BINDING_NOT_ALLOWED")
    if not _staff_binding_allowed(user):
        raise TelegramBindingError(
            "Telegram можно привязать только к staff-аккаунту",
            status_code=403,
            code="STAFF_ROLE_REQUIRED",
        )

    telegram_user_id = int(telegram_user_id)
    if telegram_user_id <= 0:
        raise TelegramBindingError("Некорректный Telegram user id", status_code=400, code="INVALID_TELEGRAM_USER_ID")

    by_telegram = db.scalar(
        select(TelegramModeratorBinding)
        .where(TelegramModeratorBinding.telegram_user_id == telegram_user_id)
        .with_for_update()
    )
    if by_telegram is not None and by_telegram.revoked_at is None and by_telegram.user_id != user.id:
        raise TelegramBindingError(
            "Этот Telegram уже привязан к другому staff-аккаунту",
            status_code=409,
            code="TELEGRAM_USER_ALREADY_BOUND",
        )

    current = db.scalar(
        select(TelegramModeratorBinding)
        .where(
            TelegramModeratorBinding.user_id == user.id,
            TelegramModeratorBinding.revoked_at.is_(None),
        )
        .with_for_update()
    )
    if current is not None and current.telegram_user_id != telegram_user_id:
        current.revoked_at = now
        current.updated_at = now
        db.flush()

    if by_telegram is None:
        item = TelegramModeratorBinding(
            user_id=user.id,
            telegram_user_id=telegram_user_id,
            telegram_username=_clean_username(telegram_username),
            telegram_first_name=_clean_first_name(telegram_first_name),
            verified_at=now,
            created_by_user_id=user.id,
            last_used_at=now,
        )
        db.add(item)
        db.flush()
    else:
        item = by_telegram
        item.user_id = user.id
        item.telegram_username = _clean_username(telegram_username)
        item.telegram_first_name = _clean_first_name(telegram_first_name)
        item.verified_at = now
        item.revoked_at = None
        item.last_used_at = now
        item.updated_at = now
        db.flush()

    token.used_at = now
    db.add(AuditLog(
        user_id=user.id,
        action="telegram.binding_created",
        entity_type="telegram_binding",
        entity_id=item.id,
        data={"telegram_user_id": telegram_user_id},
    ))
    db.commit()
    db.refresh(item)
    return item


def revoke_binding_for_user(
    db: Session,
    *,
    user_id: str,
    actor_user_id: str | None,
    source: str,
    commit: bool = False,
) -> bool:
    now = utcnow()
    pending_tokens = list(
        db.scalars(
            select(TelegramLinkToken).where(
                TelegramLinkToken.user_id == str(user_id),
                TelegramLinkToken.used_at.is_(None),
            )
        ).all()
    )
    for token in pending_tokens:
        token.used_at = now

    item = active_binding(db, user_id)
    revoked = item is not None
    if item is not None:
        item.revoked_at = now
        item.updated_at = now
        db.add(AuditLog(
            user_id=actor_user_id,
            action="telegram.binding_revoked",
            entity_type="telegram_binding",
            entity_id=item.id,
            data={
                "telegram_user_id": item.telegram_user_id,
                "target_user_id": str(user_id),
                "source": str(source)[:64],
            },
        ))

    if pending_tokens:
        db.add(AuditLog(
            user_id=actor_user_id,
            action="telegram.link_tokens_invalidated",
            entity_type="user",
            entity_id=str(user_id),
            data={
                "count": len(pending_tokens),
                "source": str(source)[:64],
            },
        ))

    if commit and (revoked or pending_tokens):
        db.commit()
    return revoked


def revoke_self_binding(db: Session, *, user_id: str) -> bool:
    return revoke_binding_for_user(
        db,
        user_id=user_id,
        actor_user_id=user_id,
        source="WEB_SELF",
        commit=True,
    )
