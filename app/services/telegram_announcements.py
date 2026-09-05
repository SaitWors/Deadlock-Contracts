from __future__ import annotations

import html
import urllib.parse
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..models import OutboxEvent, SystemAnnouncement
from .telegram_moderation import (
    TelegramDeliveryError,
    TelegramSendResult,
    _telegram_api_call,
)


TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX = "telegram.system.announcement_"
TELEGRAM_ANNOUNCEMENT_EVENT_KINDS = frozenset({"published", "cancelled", "replaced"})


def telegram_announcement_mirror_enabled() -> bool:
    return bool(getattr(settings, "announcements_telegram_mirror_enabled", False))


def is_telegram_announcement_event(event_type: str) -> bool:
    value = str(event_type or "")
    if not value.startswith(TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX):
        return False
    return (
        value.removeprefix(TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX)
        in TELEGRAM_ANNOUNCEMENT_EVENT_KINDS
    )


def _kind(event_type: str) -> str:
    if not is_telegram_announcement_event(event_type):
        raise ValueError("Not a Telegram announcement event")
    return str(event_type).removeprefix(TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX)


def queue_announcement_telegram_event(
    db: Session,
    kind: str,
    *,
    announcement: SystemAnnouncement,
    actor_display_name: str,
) -> OutboxEvent | None:
    normalized = str(kind or "").strip().lower()
    if normalized not in TELEGRAM_ANNOUNCEMENT_EVENT_KINDS:
        raise ValueError(f"Unsupported Telegram announcement event: {normalized}")
    if not telegram_announcement_mirror_enabled():
        return None

    payload: dict[str, Any] = {
        "schema_version": 1,
        "announcement_id": announcement.id,
        "revision": int(announcement.revision or 1),
        "title": str(announcement.title_ru or "")[:160],
        "severity": announcement.severity,
        "presentation": announcement.presentation,
        "surfaces": list(announcement.surfaces or []),
        "audiences": list(announcement.audiences or []),
        "starts_at": (
            announcement.starts_at.isoformat() if announcement.starts_at else None
        ),
        "ends_at": (announcement.ends_at.isoformat() if announcement.ends_at else None),
        "actor_display_name": str(actor_display_name or "staff")[:120],
    }
    if announcement.supersedes_id:
        payload["supersedes_id"] = announcement.supersedes_id

    event = OutboxEvent(
        event_type=f"{TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX}{normalized}",
        aggregate_id=announcement.id,
        payload=payload,
    )
    db.add(event)
    return event


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _admin_url(announcement_id: str) -> str:
    safe_id = urllib.parse.quote(str(announcement_id), safe="")
    return f"{settings.app_base_url.rstrip('/')}/admin/announcements/{safe_id}"


def render_announcement_notification(
    event_type: str,
    payload: dict[str, Any] | None,
) -> tuple[str, dict[str, Any], bool]:
    kind = _kind(event_type)
    data = payload if isinstance(payload, dict) else {}
    announcement_id = str(data.get("announcement_id") or "").strip()
    titles = {
        "published": "📣 <b>Опубликовано системное уведомление</b>",
        "cancelled": "⛔ <b>Системное уведомление отменено</b>",
        "replaced": "🔁 <b>Системное уведомление заменено</b>",
    }
    lines = [titles[kind]]
    fields = (
        ("Заголовок", data.get("title")),
        ("Severity", data.get("severity")),
        ("Формат", data.get("presentation")),
        ("Поверхности", ", ".join(data.get("surfaces") or [])),
        ("Аудитория", ", ".join(data.get("audiences") or [])),
        ("Начало", data.get("starts_at")),
        ("Окончание", data.get("ends_at")),
        ("Автор", data.get("actor_display_name")),
    )
    for label, value in fields:
        if value not in (None, ""):
            lines.append(f"<b>{_esc(label)}:</b> {_esc(value)}")
    if announcement_id:
        lines.append(f"<b>ID:</b> <code>{_esc(announcement_id[:8])}</code>")
    keyboard = {
        "inline_keyboard": [
            [
                {
                    "text": "🌐 Открыть в админке",
                    "url": _admin_url(announcement_id),
                }
            ]
        ]
    }
    return "\n".join(lines), keyboard, kind != "published"


def send_announcement_notification(
    event_type: str,
    payload: dict[str, Any] | None,
) -> TelegramSendResult:
    if not telegram_announcement_mirror_enabled():
        return TelegramSendResult(message_id=None, chat_id=None, skipped=True)
    chat_id = settings.telegram_review_chat_id
    if not chat_id:
        raise TelegramDeliveryError("Telegram system chat is not configured")

    text, keyboard, silent = render_announcement_notification(event_type, payload)
    request_payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
        "disable_notification": silent,
        "protect_content": settings.telegram_review_protect_content,
        "reply_markup": keyboard,
    }
    thread_id = int(getattr(settings, "telegram_system_thread_id", 0) or 0)
    if thread_id > 0:
        request_payload["message_thread_id"] = thread_id

    result = _telegram_api_call("sendMessage", request_payload)
    message_id = result.get("message_id")
    if not isinstance(message_id, int):
        raise TelegramDeliveryError("Telegram sendMessage returned no message_id")
    result_chat = result.get("chat")
    response_chat_id: str | None = None
    if isinstance(result_chat, dict) and result_chat.get("id") is not None:
        response_chat_id = str(result_chat["id"])
    return TelegramSendResult(
        message_id=message_id,
        chat_id=response_chat_id or str(chat_id),
        skipped=False,
    )
