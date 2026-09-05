from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
import urllib.parse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    AuditLog,
    AutoReviewCase,
    BoardOption,
    ContractBoard,
    Match,
    ModerationDecisionDraft,
    TelegramModeratorBinding,
    User,
)
from .permissions import role_has_permission
from .review_claims import ReviewClaimError, assert_review_claim, claim_review
from .telegram_callback_codec import (
    TelegramCallbackCodecError,
    decode_callback_data,
    encode_verdict,
)

DRAFT_SOURCE = "TELEGRAM"
DRAFT_TTL_MINUTES = 10
OPEN_REVIEW_STATUSES = frozenset({"PENDING", "NEEDS_INFO"})
DRAFT_STATUSES = frozenset({"COMPLETED", "FAILED", "VOID"})


class TelegramCallbackError(RuntimeError):
    def __init__(self, code: str, user_message: str, *, show_alert: bool = False) -> None:
        super().__init__(user_message)
        self.code = str(code)[:64]
        self.user_message = str(user_message)[:180]
        self.show_alert = bool(show_alert)


@dataclass(frozen=True)
class TelegramCallbackResult:
    state: str
    answer_text: str
    show_alert: bool
    chat_id: int | str
    message_id: int
    text: str
    reply_markup: dict[str, Any]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _effective_role(user: User) -> str:
    owner_ids = {str(value) for value in getattr(settings, "admin_steam_ids", ())}
    if str(user.steam_id64 or "") in owner_ids:
        return "OWNER"
    return str(getattr(user, "access_role", "PLAYER") or "PLAYER").upper()


def _message_context(callback_query: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], int]:
    message = callback_query.get("message")
    if not isinstance(message, dict):
        raise TelegramCallbackError("CALLBACK_MESSAGE_REQUIRED", "Эта кнопка больше недоступна.")
    chat = message.get("chat")
    if not isinstance(chat, dict):
        raise TelegramCallbackError("CALLBACK_CHAT_REQUIRED", "Не удалось определить Telegram chat.")
    try:
        message_id = int(message.get("message_id"))
    except (TypeError, ValueError) as exc:
        raise TelegramCallbackError("CALLBACK_MESSAGE_ID_INVALID", "Некорректное Telegram-сообщение.") from exc
    if message_id <= 0:
        raise TelegramCallbackError("CALLBACK_MESSAGE_ID_INVALID", "Некорректное Telegram-сообщение.")
    return message, chat, message_id


def _validate_review_destination(message: dict[str, Any], chat: dict[str, Any]) -> int | str:
    expected = str(settings.telegram_review_chat_id or "").strip()
    if not expected:
        raise TelegramCallbackError("REVIEW_CHAT_NOT_CONFIGURED", "Review chat не настроен.", show_alert=True)

    if expected.startswith("@"):
        actual_username = str(chat.get("username") or "").strip().lstrip("@")
        if actual_username.casefold() != expected.lstrip("@").casefold():
            raise TelegramCallbackError("CALLBACK_WRONG_CHAT", "Кнопка не из настроенного Review chat.", show_alert=True)
        raw_id = str(chat.get("id") or "")
        result_chat_id: int | str = int(raw_id) if raw_id.lstrip("-").isdigit() else expected
    else:
        try:
            expected_id = int(expected)
            actual_id = int(chat.get("id"))
        except (TypeError, ValueError) as exc:
            raise TelegramCallbackError("CALLBACK_WRONG_CHAT", "Некорректный Review chat.", show_alert=True) from exc
        if expected_id != actual_id:
            raise TelegramCallbackError("CALLBACK_WRONG_CHAT", "Кнопка не из настроенного Review chat.", show_alert=True)
        result_chat_id = actual_id

    configured_thread = int(getattr(settings, "telegram_review_thread_id", 0) or 0)
    if configured_thread > 0:
        try:
            actual_thread = int(message.get("message_thread_id") or 0)
        except (TypeError, ValueError):
            actual_thread = 0
        if actual_thread != configured_thread:
            raise TelegramCallbackError("CALLBACK_WRONG_THREAD", "Кнопка не из настроенной Review topic.", show_alert=True)
    return result_chat_id


def _bound_staff(
    db: Session,
    callback_query: dict[str, Any],
    *,
    permission: str,
) -> tuple[TelegramModeratorBinding, User]:
    sender = callback_query.get("from")
    if not isinstance(sender, dict) or sender.get("is_bot") is True:
        raise TelegramCallbackError("CALLBACK_SENDER_INVALID", "Не удалось подтвердить Telegram-пользователя.", show_alert=True)
    try:
        telegram_user_id = int(sender.get("id"))
    except (TypeError, ValueError) as exc:
        raise TelegramCallbackError("CALLBACK_SENDER_INVALID", "Не удалось подтвердить Telegram-пользователя.", show_alert=True) from exc
    if telegram_user_id <= 0:
        raise TelegramCallbackError("CALLBACK_SENDER_INVALID", "Не удалось подтвердить Telegram-пользователя.", show_alert=True)

    binding = db.scalar(
        select(TelegramModeratorBinding)
        .where(
            TelegramModeratorBinding.telegram_user_id == telegram_user_id,
            TelegramModeratorBinding.revoked_at.is_(None),
        )
        .with_for_update()
    )
    if binding is None:
        raise TelegramCallbackError(
            "TELEGRAM_BINDING_REQUIRED",
            "Сначала привяжите Telegram в защищённой Admin-панели.",
            show_alert=True,
        )

    user = db.scalar(select(User).where(User.id == binding.user_id).with_for_update())
    if user is None or str(user.status or "").upper() != "ACTIVE":
        raise TelegramCallbackError("STAFF_ACCOUNT_INACTIVE", "Staff-аккаунт недоступен.", show_alert=True)
    if not role_has_permission(_effective_role(user), permission):
        raise TelegramCallbackError("TELEGRAM_PERMISSION_DENIED", "У staff-роли нет права на это действие.", show_alert=True)
    return binding, user


def _load_review(db: Session, review_id: str) -> AutoReviewCase:
    review = db.scalar(
        select(AutoReviewCase).where(AutoReviewCase.id == str(review_id)).with_for_update()
    )
    if review is None:
        raise TelegramCallbackError("REVIEW_NOT_FOUND", "Review больше не найден.", show_alert=True)
    if review.status not in OPEN_REVIEW_STATUSES:
        raise TelegramCallbackError("REVIEW_ALREADY_DECIDED", "Review уже закрыт.", show_alert=True)
    return review


def _pending_options(db: Session, review: AutoReviewCase) -> list[BoardOption]:
    return list(
        db.scalars(
            select(BoardOption)
            .where(
                BoardOption.board_id == review.board_id,
                BoardOption.selected.is_(True),
                BoardOption.status == "REVIEW_REQUIRED",
            )
            .order_by(BoardOption.created_at.asc(), BoardOption.id.asc())
        ).all()
    )


def _load_draft(db: Session, *, review_id: str, actor_user_id: str) -> ModerationDecisionDraft | None:
    return db.scalar(
        select(ModerationDecisionDraft)
        .where(
            ModerationDecisionDraft.review_id == str(review_id),
            ModerationDecisionDraft.actor_user_id == str(actor_user_id),
            ModerationDecisionDraft.source == DRAFT_SOURCE,
        )
        .with_for_update()
    )


def _draft_options(item: ModerationDecisionDraft | None) -> dict[str, dict[str, Any]]:
    if item is None or not isinstance(item.decisions, dict):
        return {}
    raw = item.decisions.get("options")
    if not isinstance(raw, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        status = str(value.get("status") or "").upper()
        if status in DRAFT_STATUSES:
            result[str(key)] = {"status": status, "updated_at": value.get("updated_at")}
    return result


def _review_url(review_id: str) -> str:
    base = str(settings.app_base_url or "").rstrip("/")
    return f"{base}/admin/reviews/{urllib.parse.quote(str(review_id), safe='')}"


def _render_review(
    db: Session,
    *,
    review: AutoReviewCase,
    actor: User,
    pending: list[BoardOption],
    draft: ModerationDecisionDraft | None,
    chat_id: int | str,
    message_id: int,
    answer_text: str,
) -> TelegramCallbackResult:
    draft_map = _draft_options(draft)
    pending_ids = {item.id for item in pending}
    draft_map = {key: value for key, value in draft_map.items() if key in pending_ids}

    match = db.get(Match, review.match_id)
    board = db.get(ContractBoard, review.board_id)
    external_match_id = str(match.external_match_id) if match is not None else "—"
    mode = str(board.game_match_mode) if board is not None else "UNKNOWN"
    labels = {"COMPLETED": "✅ Выполнен", "FAILED": "❌ Провален", "VOID": "⚪ Аннулирован"}

    lines = [
        "🟡 <b>Review в работе</b>",
        f"<b>Review:</b> <code>{html.escape(review.id[:8])}</code>",
        f"<b>Match:</b> <code>{html.escape(external_match_id)}</code>",
        f"<b>Режим:</b> {html.escape(mode)}",
        f"<b>Модератор:</b> {html.escape(str(actor.display_name or 'Moderator')[:80])}",
        "",
        "<b>Черновик решений:</b>",
    ]
    rows: list[list[dict[str, Any]]] = []
    for index, option in enumerate(pending, 1):
        selected = str(draft_map.get(option.id, {}).get("status") or "")
        current = labels.get(selected, "—")
        title = html.escape(str(option.rendered_title or "Contract")[:120])
        lines.append(f"{index}. {title} — <b>{html.escape(current)}</b>")
        rows.append([
            {"text": f"{index} ✅" + (" ✓" if selected == "COMPLETED" else ""),
             "callback_data": encode_verdict(review.id, option.id, "COMPLETED")},
            {"text": f"{index} ❌" + (" ✓" if selected == "FAILED" else ""),
             "callback_data": encode_verdict(review.id, option.id, "FAILED")},
            {"text": f"{index} ⚪" + (" ✓" if selected == "VOID" else ""),
             "callback_data": encode_verdict(review.id, option.id, "VOID")},
        ])

    selected_count = sum(1 for option in pending if option.id in draft_map)
    lines += [
        "",
        f"<b>Выбрано:</b> {selected_count}/{len(pending)}",
        "⚠️ <i>Это только черновик. XP и финальные статусы не изменены.</i>",
    ]
    rows.append([{"text": "🌐 Открыть в админке", "url": _review_url(review.id)}])

    return TelegramCallbackResult(
        state="DRAFT_READY" if pending and selected_count == len(pending) else "DRAFTING",
        answer_text=answer_text,
        show_alert=False,
        chat_id=chat_id,
        message_id=message_id,
        text="\n".join(lines),
        reply_markup={"inline_keyboard": rows},
    )


def process_callback_query(db: Session, callback_query: dict[str, Any]) -> TelegramCallbackResult:
    if not bool(getattr(settings, "telegram_review_callbacks_enabled", False)):
        raise TelegramCallbackError("TELEGRAM_CALLBACKS_DISABLED", "Telegram review actions выключены.", show_alert=True)

    callback_id = str(callback_query.get("id") or "")
    if not callback_id or len(callback_id) > 256:
        raise TelegramCallbackError("CALLBACK_ID_INVALID", "Некорректный Telegram callback.")

    message, chat, message_id = _message_context(callback_query)
    chat_id = _validate_review_destination(message, chat)

    try:
        command = decode_callback_data(callback_query.get("data"))
    except TelegramCallbackCodecError as exc:
        raise TelegramCallbackError("CALLBACK_DATA_INVALID", "Кнопка устарела или повреждена.") from exc

    permission = "reviews.claim" if command.action == "claim" else "reviews.decide"
    binding, actor = _bound_staff(db, callback_query, permission=permission)
    review = _load_review(db, command.review_id)

    if command.action == "claim":
        try:
            claim_review(
                db,
                review_id=review.id,
                actor_user_id=actor.id,
                force=False,
                commit=False,
                emit_telegram=False,
            )
        except ReviewClaimError as exc:
            raise TelegramCallbackError(exc.code, exc.detail, show_alert=True) from exc
        binding.last_used_at = utcnow()
        db.flush()
        review = _load_review(db, review.id)
        pending = _pending_options(db, review)
        draft = _load_draft(db, review_id=review.id, actor_user_id=actor.id)
        return _render_review(
            db, review=review, actor=actor, pending=pending, draft=draft,
            chat_id=chat_id, message_id=message_id,
            answer_text="Review взят. Выберите черновые статусы контрактов.",
        )

    if command.action != "verdict" or command.option_id is None or command.status not in DRAFT_STATUSES:
        raise TelegramCallbackError("CALLBACK_ACTION_INVALID", "Эта кнопка больше не поддерживается.")

    try:
        assert_review_claim(review, actor.id)
    except ReviewClaimError as exc:
        raise TelegramCallbackError(exc.code, exc.detail, show_alert=True) from exc

    pending = _pending_options(db, review)
    pending_by_id = {item.id: item for item in pending}
    if command.option_id not in pending_by_id:
        raise TelegramCallbackError(
            "OPTION_NOT_REVIEW_REQUIRED",
            "Этот контракт уже не ожидает внутреннего решения.",
            show_alert=True,
        )

    now = utcnow()
    draft = _load_draft(db, review_id=review.id, actor_user_id=actor.id)
    if draft is None:
        draft = ModerationDecisionDraft(
            review_id=review.id,
            actor_user_id=actor.id,
            source=DRAFT_SOURCE,
            decisions={"schema_version": 1, "options": {}},
            expires_at=now + timedelta(minutes=DRAFT_TTL_MINUTES),
        )
        db.add(draft)
        db.flush()

    existing = _draft_options(draft)
    existing = {key: value for key, value in existing.items() if key in pending_by_id}
    existing[command.option_id] = {"status": command.status, "updated_at": now.isoformat()}
    draft.decisions = {"schema_version": 1, "options": existing}
    claim_expires = _aware(review.claim_expires_at)
    draft.expires_at = claim_expires if claim_expires and claim_expires > now else now + timedelta(minutes=DRAFT_TTL_MINUTES)
    draft.updated_at = now
    binding.last_used_at = now
    db.add(AuditLog(
        user_id=actor.id,
        action="telegram.review_draft_updated",
        entity_type="auto_review_case",
        entity_id=review.id,
        data={
            "option_id": command.option_id,
            "status": command.status,
            "source": DRAFT_SOURCE,
            "selected_count": len(existing),
            "required_count": len(pending_by_id),
        },
    ))
    db.flush()

    complete = len(existing) == len(pending_by_id)
    return _render_review(
        db, review=review, actor=actor, pending=pending, draft=draft,
        chat_id=chat_id, message_id=message_id,
        answer_text=(
            "Черновик готов. Финальное подтверждение будет отдельной кнопкой."
            if complete else "Черновой статус сохранён."
        ),
    )
