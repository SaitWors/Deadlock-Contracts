from __future__ import annotations

import html
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..models import OutboxEvent


TELEGRAM_REVIEW_EVENT_PREFIX = "telegram.review."
TELEGRAM_REVIEW_EVENT_KINDS = frozenset(
    {"requested", "claimed", "released", "needs_info", "decided", "test"}
)

_ALLOWED_PAYLOAD_FIELDS = frozenset(
    {
        "review_id", "external_match_id", "mode", "reason_count", "action",
        "actor_display_name", "claim_expires_at", "status",
        "case_status", "source", "reason_code", "reward_xp_total",
        "option_count", "board_status_after",
    }
)
_FORBIDDEN_PAYLOAD_KEYS = frozenset(
    {
        "steam_id64", "account_id", "user_id", "device_id", "token",
        "authorization", "context", "raw", "roster",
    }
)


class TelegramDeliveryError(RuntimeError):
    """Sanitized delivery error that never includes the bot token."""

    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds = (
            max(0, int(retry_after_seconds))
            if retry_after_seconds is not None
            else None
        )


def _telegram_retry_after(payload: Any) -> int | None:
    if not isinstance(payload, dict):
        return None
    parameters = payload.get("parameters")
    if not isinstance(parameters, dict):
        return None
    value = parameters.get("retry_after")
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, parsed)


@dataclass(frozen=True)
class TelegramSendResult:
    message_id: int | None
    chat_id: str | None
    skipped: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "chat_id": self.chat_id,
            "skipped": self.skipped,
        }


def telegram_notifications_enabled() -> bool:
    return bool(settings.telegram_moderation_notifications_enabled)


def _clean_scalar(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _safe_payload(review_id: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    source = payload if isinstance(payload, dict) else {}
    lowered = {str(key).lower() for key in source}
    forbidden = sorted(lowered & _FORBIDDEN_PAYLOAD_KEYS)
    if forbidden:
        raise ValueError(
            "Telegram moderation payload contains forbidden fields: "
            + ", ".join(forbidden)
        )

    clean: dict[str, Any] = {"schema_version": 1, "review_id": str(review_id)}
    for key in _ALLOWED_PAYLOAD_FIELDS:
        if key == "review_id" or key not in source:
            continue
        clean[key] = _clean_scalar(source[key])
    return clean


def queue_review_telegram_event(
    db: Session,
    kind: str,
    *,
    review_id: str,
    payload: dict[str, Any] | None = None,
) -> OutboxEvent | None:
    """Append an outbound-only Telegram event to the current DB transaction."""
    normalized = str(kind or "").strip().lower()
    if normalized not in TELEGRAM_REVIEW_EVENT_KINDS:
        raise ValueError(f"Unsupported Telegram review event: {normalized}")
    if not telegram_notifications_enabled():
        return None

    event = OutboxEvent(
        event_type=f"{TELEGRAM_REVIEW_EVENT_PREFIX}{normalized}",
        aggregate_id=str(review_id),
        payload=_safe_payload(str(review_id), payload),
    )
    db.add(event)
    return event


def is_telegram_review_event(event_type: str) -> bool:
    value = str(event_type or "")
    if not value.startswith(TELEGRAM_REVIEW_EVENT_PREFIX):
        return False
    return value.removeprefix(TELEGRAM_REVIEW_EVENT_PREFIX) in TELEGRAM_REVIEW_EVENT_KINDS


def _event_kind(event_type: str) -> str:
    if not is_telegram_review_event(event_type):
        raise ValueError("Not a Telegram review event")
    return str(event_type).removeprefix(TELEGRAM_REVIEW_EVENT_PREFIX)


def _esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _review_url(review_id: str | None) -> str:
    base = settings.app_base_url.rstrip("/")
    if review_id:
        safe_id = urllib.parse.quote(str(review_id), safe="")
        return f"{base}/admin/reviews/{safe_id}"
    return f"{base}/admin/reviews"


def _line(label: str, value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    return f"<b>{_esc(label)}:</b> {_esc(value)}"


def render_review_notification(
    event_type: str,
    payload: dict[str, Any] | None,
) -> tuple[str, dict[str, Any], bool]:
    kind = _event_kind(event_type)
    data = payload if isinstance(payload, dict) else {}
    review_id = str(data.get("review_id") or "").strip() or None

    title_map = {
        "requested": "🟠 <b>Новая внутренняя проверка</b>",
        "claimed": "🟡 <b>Review взят в работу</b>",
        "released": "⚪ <b>Review освобождён</b>",
        "needs_info": "🔵 <b>Нужны дополнительные данные</b>",
        "decided": (
            "🟢 <b>Review закрыт</b>"
            if str(data.get("case_status") or "").upper() == "RESOLVED"
            else "🔴 <b>Review отклонён</b>"
        ),
        "test": "🧪 <b>Telegram moderation smoke</b>",
    }
    lines = [title_map[kind]]

    if review_id:
        lines.append(f"<b>Review:</b> <code>{_esc(review_id[:8])}</code>")

    match_id = data.get("external_match_id")
    if match_id not in (None, ""):
        lines.append(f"<b>Match:</b> <code>{_esc(match_id)}</code>")

    if kind == "requested":
        values = (
            _line("Режим", data.get("mode")),
            _line("Причин", data.get("reason_count")),
        )
    elif kind == "claimed":
        values = (
            _line("Модератор", data.get("actor_display_name")),
            _line("Действие", data.get("action")),
            _line("Claim до", data.get("claim_expires_at")),
        )
    elif kind == "released":
        values = (
            _line("Модератор", data.get("actor_display_name")),
            _line("Действие", data.get("action")),
        )
    elif kind == "needs_info":
        values = (
            _line("Модератор", data.get("actor_display_name")),
            "Комментарий модератора доступен только в защищённой админ-панели.",
        )
    elif kind == "decided":
        values = (
            _line("Модератор", data.get("actor_display_name")),
            _line("Статус", data.get("case_status")),
            _line("Источник", data.get("source")),
            _line("Причина", data.get("reason_code")),
            _line("XP", f"+{int(data.get('reward_xp_total') or 0)}"),
            _line("Контрактов", data.get("option_count")),
            _line("Board", data.get("board_status_after")),
        )
    else:
        values = ("Outbound-only Stage 4 delivery is working.",)

    for item in values:
        if item:
            lines.append(item)

    keyboard = {
        "inline_keyboard": [[{
            "text": "🌐 Открыть в админке",
            "url": _review_url(review_id),
        }]]
    }
    silent = kind in {"claimed", "released", "decided"}
    return "\n".join(lines), keyboard, silent


def _telegram_api_call(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    token = settings.telegram_bot_token
    if not token:
        raise TelegramDeliveryError("Telegram bot token is not configured")

    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": f"DeadlockContracts/{settings.app_version}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            raw = response.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                raise TelegramDeliveryError("Telegram response exceeded 256 KiB")
            status = int(getattr(response, "status", 200))
    except urllib.error.HTTPError as exc:
        description = ""
        retry_after_seconds: int | None = None
        try:
            parsed = json.loads(exc.read(16 * 1024).decode("utf-8"))
            if isinstance(parsed, dict):
                description = str(parsed.get("description") or "")
                retry_after_seconds = _telegram_retry_after(parsed)
        except Exception:
            description = ""
            retry_after_seconds = None
        suffix = f": {description[:300]}" if description else ""
        raise TelegramDeliveryError(
            f"Telegram HTTP {int(exc.code)}{suffix}",
            retry_after_seconds=retry_after_seconds,
        ) from None
    except urllib.error.URLError as exc:
        reason = str(getattr(exc, "reason", "network error"))
        raise TelegramDeliveryError(
            f"Telegram network error: {reason[:300]}"
        ) from None
    except TimeoutError:
        raise TelegramDeliveryError("Telegram request timed out") from None

    if status < 200 or status >= 300:
        raise TelegramDeliveryError(f"Telegram HTTP {status}")

    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise TelegramDeliveryError("Telegram returned invalid JSON") from None

    if not isinstance(decoded, dict) or decoded.get("ok") is not True:
        description = (
            str(decoded.get("description") or "")[:300]
            if isinstance(decoded, dict)
            else ""
        )
        suffix = f": {description}" if description else ""
        raise TelegramDeliveryError(
            f"Telegram API rejected request{suffix}",
            retry_after_seconds=_telegram_retry_after(decoded),
        )

    result = decoded.get("result")
    return result if isinstance(result, dict) else {}


def telegram_get_me() -> dict[str, Any]:
    return _telegram_api_call("getMe", {})


def send_review_notification(
    event_type: str,
    payload: dict[str, Any] | None,
) -> TelegramSendResult:
    if not telegram_notifications_enabled():
        return TelegramSendResult(message_id=None, chat_id=None, skipped=True)

    chat_id = settings.telegram_review_chat_id
    if not chat_id:
        raise TelegramDeliveryError("Telegram review chat is not configured")

    text, keyboard, silent = render_review_notification(event_type, payload)
    request_payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
        "disable_notification": silent,
        "protect_content": settings.telegram_review_protect_content,
        "reply_markup": keyboard,
    }
    if settings.telegram_review_thread_id > 0:
        request_payload["message_thread_id"] = settings.telegram_review_thread_id

    result = _telegram_api_call("sendMessage", request_payload)
    message_id = result.get("message_id")
    if not isinstance(message_id, int):
        raise TelegramDeliveryError(
            "Telegram sendMessage returned no message_id"
        )

    result_chat = result.get("chat")
    response_chat_id: str | None = None
    if isinstance(result_chat, dict) and result_chat.get("id") is not None:
        response_chat_id = str(result_chat["id"])

    return TelegramSendResult(
        message_id=message_id,
        chat_id=response_chat_id or str(chat_id),
        skipped=False,
    )
