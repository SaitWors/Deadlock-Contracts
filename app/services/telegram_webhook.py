from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..config import settings
from ..models import TelegramUpdateReceipt
from .telegram_binding import TelegramBindingError, consume_link_token


class TelegramWebhookError(RuntimeError):
    status_code = 400
    code = "TELEGRAM_WEBHOOK_ERROR"

    def __init__(
        self,
        detail: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def verify_webhook_secret(provided: str | None) -> bool:
    expected = str(settings.telegram_webhook_secret or "")
    candidate = str(provided or "")
    if not expected or not candidate:
        return False
    return secrets.compare_digest(
        candidate.encode("utf-8"),
        expected.encode("utf-8"),
    )


def _update_id(update: dict[str, Any]) -> int:
    value = update.get("update_id")
    if isinstance(value, bool):
        raise TelegramWebhookError(
            "Telegram update_id is invalid",
            code="INVALID_UPDATE_ID",
        )
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise TelegramWebhookError(
            "Telegram update_id is invalid",
            code="INVALID_UPDATE_ID",
        ) from exc
    if parsed < 0 or parsed > 9_223_372_036_854_775_807:
        raise TelegramWebhookError(
            "Telegram update_id is out of range",
            code="INVALID_UPDATE_ID",
        )
    return parsed


def _update_type(update: dict[str, Any]) -> str:
    for key in (
        "message",
        "callback_query",
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "my_chat_member",
        "chat_member",
    ):
        if key in update:
            return key[:32]
    return "other"


def _reserve_receipt(
    db: Session,
    *,
    update_id: int,
    update_type: str,
) -> tuple[TelegramUpdateReceipt | None, bool]:
    values = {
        "update_id": update_id,
        "update_type": update_type[:32],
        "state": "PROCESSING",
        "error_code": None,
        "received_at": utcnow(),
        "processed_at": None,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        stmt = (
            postgresql_insert(TelegramUpdateReceipt)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["update_id"])
            .returning(TelegramUpdateReceipt.update_id)
        )
        inserted = db.scalar(stmt)
    elif dialect == "sqlite":
        stmt = (
            sqlite_insert(TelegramUpdateReceipt)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["update_id"])
            .returning(TelegramUpdateReceipt.update_id)
        )
        inserted = db.scalar(stmt)
    else:
        existing = db.get(TelegramUpdateReceipt, update_id)
        if existing is not None:
            return existing, False
        row = TelegramUpdateReceipt(**values)
        db.add(row)
        db.flush()
        return row, True

    if inserted is None:
        existing = db.scalar(
            select(TelegramUpdateReceipt).where(
                TelegramUpdateReceipt.update_id == update_id
            )
        )
        return existing, False

    row = db.scalar(
        select(TelegramUpdateReceipt).where(
            TelegramUpdateReceipt.update_id == update_id
        )
    )
    if row is None:
        raise TelegramWebhookError(
            "Telegram receipt could not be reserved",
            status_code=500,
            code="RECEIPT_RESERVATION_FAILED",
        )
    return row, True


def _finish(
    db: Session,
    receipt: TelegramUpdateReceipt,
    *,
    state: str,
    error_code: str | None = None,
) -> None:
    receipt.state = state[:32]
    receipt.error_code = str(error_code or "")[:64] or None
    receipt.processed_at = utcnow()
    db.commit()


def _start_token(
    message: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | None]:
    chat = message.get("chat")
    sender = message.get("from")
    text = message.get("text")

    if not isinstance(chat, dict) or chat.get("type") != "private":
        return None, None
    if not isinstance(sender, dict):
        return None, None
    if sender.get("is_bot") is True:
        return None, None
    try:
        telegram_user_id = int(sender.get("id"))
    except (TypeError, ValueError):
        return None, None
    if telegram_user_id <= 0:
        return None, None
    if not isinstance(text, str) or len(text) > 256:
        return None, None

    parts = text.strip().split(maxsplit=1)
    if len(parts) != 2:
        return None, None
    command = parts[0]
    if "@" in command:
        command_name, command_bot = command.split("@", 1)
        configured_bot = str(settings.telegram_bot_username or "")
        if configured_bot and command_bot.casefold() != configured_bot.casefold():
            return None, None
        command = command_name
    if command != "/start":
        return None, None

    payload = parts[1].strip()
    if not payload.startswith("link_"):
        return None, None
    raw_token = payload.removeprefix("link_")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", raw_token):
        return None, None

    identity = {
        "telegram_user_id": telegram_user_id,
        "telegram_username": sender.get("username"),
        "telegram_first_name": sender.get("first_name"),
    }
    return raw_token, identity


def process_update(
    db: Session,
    update: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(update, dict):
        raise TelegramWebhookError(
            "Telegram update must be a JSON object",
            code="INVALID_UPDATE",
        )

    update_id = _update_id(update)
    update_type = _update_type(update)
    receipt, inserted = _reserve_receipt(
        db,
        update_id=update_id,
        update_type=update_type,
    )
    if not inserted:
        return {
            "ok": True,
            "duplicate": True,
            "state": str(receipt.state) if receipt is not None else "DUPLICATE",
        }
    if receipt is None:
        raise TelegramWebhookError(
            "Telegram receipt unavailable",
            status_code=500,
            code="RECEIPT_UNAVAILABLE",
        )

    if update_type != "message":
        _finish(db, receipt, state="IGNORED")
        return {"ok": True, "processed": False, "state": "IGNORED"}

    message = update.get("message")
    if not isinstance(message, dict):
        _finish(db, receipt, state="REJECTED", error_code="INVALID_MESSAGE")
        return {"ok": True, "processed": False, "state": "REJECTED"}

    raw_token, identity = _start_token(message)
    if raw_token is None or identity is None:
        _finish(db, receipt, state="IGNORED")
        return {"ok": True, "processed": False, "state": "IGNORED"}

    try:
        consume_link_token(
            db,
            raw_token=raw_token,
            telegram_user_id=int(identity["telegram_user_id"]),
            telegram_username=identity.get("telegram_username"),
            telegram_first_name=identity.get("telegram_first_name"),
            commit=False,
        )
    except TelegramBindingError as exc:
        _finish(db, receipt, state="REJECTED", error_code=exc.code)
        return {"ok": True, "processed": False, "state": "REJECTED"}

    _finish(db, receipt, state="PROCESSED")
    return {"ok": True, "processed": True, "state": "PROCESSED"}
