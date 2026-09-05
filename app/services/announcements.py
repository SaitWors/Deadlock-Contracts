from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    AuditLog,
    SystemAnnouncement,
    SystemAnnouncementReceipt,
    User,
    utcnow,
)


ANNOUNCEMENT_STATUSES = frozenset({"DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"})
ANNOUNCEMENT_SEVERITIES = frozenset(
    {"INFO", "SUCCESS", "WARNING", "MAINTENANCE", "CRITICAL", "EVENT"}
)
ANNOUNCEMENT_PRESENTATIONS = frozenset({"BANNER", "TOAST", "MODAL"})
ANNOUNCEMENT_EFFECTS = frozenset(
    {
        "NONE",
        "FADE_SLIDE",
        "STAMP_IN",
        "SOFT_GLOW",
        "SCANLINE_ONCE",
        "CONFETTI_ONCE",
    }
)
ANNOUNCEMENT_DISMISS_POLICIES = frozenset(
    {"DISMISSIBLE", "ACK_REQUIRED", "NON_DISMISSIBLE"}
)
ANNOUNCEMENT_SURFACES = frozenset(
    {"SITE_PUBLIC", "SITE_DASHBOARD", "COMPANION_DESKTOP", "COMPANION_OVERLAY"}
)
ANNOUNCEMENT_AUDIENCES = frozenset(
    {"ALL", "ANONYMOUS", "AUTHENTICATED", "PLAYERS", "TESTERS", "STAFF"}
)
ANNOUNCEMENT_RECEIPT_ACTIONS = frozenset({"SEEN", "DISMISSED", "ACKNOWLEDGED"})

_DRAFT_FIELDS = (
    "severity",
    "presentation",
    "effect",
    "dismiss_policy",
    "title_ru",
    "body_ru",
    "title_en",
    "body_en",
    "cta_label_ru",
    "cta_label_en",
    "cta_url",
    "surfaces",
    "audiences",
    "priority",
    "show_countdown",
)
_TAG_PATTERN = re.compile(r"<\s*/?\s*[A-Za-z][^>]*>")


class AnnouncementError(RuntimeError):
    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        current_revision: int | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = int(status_code)
        self.code = str(code)
        self.detail = str(detail)
        self.current_revision = current_revision

    def response_detail(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.detail}
        if self.current_revision is not None:
            payload["current_revision"] = self.current_revision
        return payload


def _fail(
    code: str,
    detail: str,
    *,
    status_code: int = 422,
    current_revision: int | None = None,
) -> None:
    raise AnnouncementError(
        status_code,
        code,
        detail,
        current_revision=current_revision,
    )


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    normalized = _aware(value)
    return normalized.isoformat() if normalized else None


def compute_phase(
    item: SystemAnnouncement,
    now: datetime | None = None,
) -> str:
    status = str(item.status or "DRAFT").upper()
    if status != "PUBLISHED":
        return status if status in ANNOUNCEMENT_STATUSES else "DRAFT"

    current = _aware(now or utcnow())
    starts_at = _aware(item.starts_at)
    ends_at = _aware(item.ends_at)
    if starts_at is None or ends_at is None:
        return "DRAFT"
    if current < starts_at:
        return "SCHEDULED"
    if current >= ends_at:
        return "EXPIRED"
    return "ACTIVE"


def _enum(value: Any, allowed: frozenset[str], field: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in allowed:
        _fail(
            "ANNOUNCEMENT_FIELD_INVALID",
            f"Недопустимое значение поля {field}",
        )
    return normalized


def _plain_text(
    value: Any,
    field: str,
    *,
    minimum: int,
    maximum: int,
    required: bool,
) -> str | None:
    if value is None:
        if required:
            _fail("ANNOUNCEMENT_TEXT_REQUIRED", f"Поле {field} обязательно")
        return None
    clean = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not clean:
        if required:
            _fail("ANNOUNCEMENT_TEXT_REQUIRED", f"Поле {field} обязательно")
        return None
    if len(clean) < minimum or len(clean) > maximum:
        _fail(
            "ANNOUNCEMENT_TEXT_LENGTH_INVALID",
            f"Поле {field} должно содержать от {minimum} до {maximum} символов",
        )
    if "\x00" in clean or _TAG_PATTERN.search(clean):
        _fail(
            "ANNOUNCEMENT_HTML_FORBIDDEN",
            f"HTML-разметка в поле {field} запрещена",
        )
    return clean


def _enum_list(
    values: Any,
    allowed: frozenset[str],
    field: str,
) -> list[str]:
    if not isinstance(values, (list, tuple)) or not values:
        _fail("ANNOUNCEMENT_TARGET_REQUIRED", f"Поле {field} не может быть пустым")
    normalized: list[str] = []
    for value in values:
        item = _enum(value, allowed, field)
        if item not in normalized:
            normalized.append(item)
    return normalized


def _safe_cta_url(value: Any) -> str | None:
    if value is None or not str(value).strip():
        return None
    clean = str(value).strip()
    if len(clean) > 500 or any(char in clean for char in ("\r", "\n", "\x00")):
        _fail("ANNOUNCEMENT_CTA_URL_INVALID", "CTA URL недопустим")
    if clean.startswith("/") and not clean.startswith("//"):
        return clean

    parsed = urlparse(clean)
    app = urlparse(settings.app_base_url)
    try:
        candidate_port = parsed.port or 443
        app_port = app.port or (443 if app.scheme.lower() == "https" else 80)
    except ValueError:
        _fail("ANNOUNCEMENT_CTA_URL_INVALID", "CTA URL недопустим")
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.hostname.lower() != str(app.hostname or "").lower()
        or candidate_port != app_port
    ):
        _fail(
            "ANNOUNCEMENT_CTA_URL_INVALID",
            "Разрешены только внутренние маршруты и HTTPS-ссылки текущего сайта",
        )
    return clean


def validate_draft(payload: Mapping[str, Any]) -> dict[str, Any]:
    severity = _enum(payload.get("severity"), ANNOUNCEMENT_SEVERITIES, "severity")
    presentation = _enum(
        payload.get("presentation"),
        ANNOUNCEMENT_PRESENTATIONS,
        "presentation",
    )
    effect = _enum(
        payload.get("effect", "NONE"),
        ANNOUNCEMENT_EFFECTS,
        "effect",
    )
    dismiss_policy = _enum(
        payload.get("dismiss_policy", "DISMISSIBLE"),
        ANNOUNCEMENT_DISMISS_POLICIES,
        "dismiss_policy",
    )
    surfaces = _enum_list(payload.get("surfaces"), ANNOUNCEMENT_SURFACES, "surfaces")
    audiences = _enum_list(
        payload.get("audiences"),
        ANNOUNCEMENT_AUDIENCES,
        "audiences",
    )
    if "ALL" in audiences and len(audiences) != 1:
        _fail(
            "ANNOUNCEMENT_AUDIENCE_CONFLICT",
            "Аудиторию ALL нельзя сочетать с другими аудиториями",
        )

    title_ru = _plain_text(
        payload.get("title_ru"),
        "title_ru",
        minimum=3,
        maximum=160,
        required=True,
    )
    body_ru = _plain_text(
        payload.get("body_ru"),
        "body_ru",
        minimum=3,
        maximum=2000,
        required=True,
    )
    title_en = _plain_text(
        payload.get("title_en"),
        "title_en",
        minimum=3,
        maximum=160,
        required=False,
    )
    body_en = _plain_text(
        payload.get("body_en"),
        "body_en",
        minimum=3,
        maximum=2000,
        required=False,
    )
    if bool(title_en) != bool(body_en):
        _fail(
            "ANNOUNCEMENT_TRANSLATION_INCOMPLETE",
            "Английские title и body должны быть заполнены вместе",
        )

    cta_url = _safe_cta_url(payload.get("cta_url"))
    cta_label_ru = _plain_text(
        payload.get("cta_label_ru"),
        "cta_label_ru",
        minimum=1,
        maximum=64,
        required=False,
    )
    cta_label_en = _plain_text(
        payload.get("cta_label_en"),
        "cta_label_en",
        minimum=1,
        maximum=64,
        required=False,
    )
    if (cta_label_ru or cta_label_en) and not cta_url:
        _fail(
            "ANNOUNCEMENT_CTA_URL_REQUIRED",
            "CTA label нельзя задать без CTA URL",
        )
    if cta_url and not cta_label_ru:
        _fail(
            "ANNOUNCEMENT_CTA_LABEL_REQUIRED",
            "Для CTA URL требуется русская подпись",
        )

    try:
        priority = int(payload.get("priority", 50))
    except (TypeError, ValueError):
        priority = -1
    if not 0 <= priority <= 100:
        _fail(
            "ANNOUNCEMENT_PRIORITY_INVALID",
            "Priority должен быть в диапазоне 0..100",
        )

    if effect == "CONFETTI_ONCE":
        if severity not in {"SUCCESS", "EVENT"}:
            _fail(
                "ANNOUNCEMENT_EFFECT_CONFLICT",
                "CONFETTI_ONCE разрешён только для SUCCESS и EVENT",
            )
        if any(not surface.startswith("SITE_") for surface in surfaces):
            _fail(
                "ANNOUNCEMENT_EFFECT_CONFLICT",
                "CONFETTI_ONCE разрешён только на сайте",
            )
    if presentation == "MODAL" and "COMPANION_OVERLAY" in surfaces:
        _fail(
            "ANNOUNCEMENT_PRESENTATION_CONFLICT",
            "MODAL запрещён в Companion overlay",
        )
    if dismiss_policy == "NON_DISMISSIBLE" and severity not in {
        "MAINTENANCE",
        "CRITICAL",
    }:
        _fail(
            "ANNOUNCEMENT_DISMISS_POLICY_CONFLICT",
            "NON_DISMISSIBLE разрешён только для MAINTENANCE и CRITICAL",
        )

    return {
        "severity": severity,
        "presentation": presentation,
        "effect": effect,
        "dismiss_policy": dismiss_policy,
        "title_ru": title_ru,
        "body_ru": body_ru,
        "title_en": title_en,
        "body_en": body_en,
        "cta_label_ru": cta_label_ru,
        "cta_label_en": cta_label_en,
        "cta_url": cta_url,
        "surfaces": surfaces,
        "audiences": audiences,
        "priority": priority,
        "show_countdown": bool(payload.get("show_countdown", False)),
    }


def _validate_window(
    starts_at: datetime, ends_at: datetime
) -> tuple[datetime, datetime]:
    starts = _aware(starts_at)
    ends = _aware(ends_at)
    if starts is None or ends is None or ends <= starts:
        _fail(
            "ANNOUNCEMENT_WINDOW_INVALID",
            "Окончание должно быть позже начала",
        )
    maximum = timedelta(
        days=max(1, int(getattr(settings, "announcements_max_duration_days", 30)))
    )
    if ends - starts > maximum:
        _fail(
            "ANNOUNCEMENT_DURATION_TOO_LONG",
            "Срок объявления превышает настроенный максимум",
        )
    return starts, ends


def validate_publication(
    item: SystemAnnouncement,
    *,
    starts_at: datetime,
    ends_at: datetime,
) -> tuple[datetime, datetime]:
    validate_draft({field: getattr(item, field) for field in _DRAFT_FIELDS})
    return _validate_window(starts_at, ends_at)


def _content_hash(item: SystemAnnouncement) -> str:
    payload = {field: getattr(item, field) for field in _DRAFT_FIELDS}
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _audit_data(
    item: SystemAnnouncement,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "revision": int(item.revision or 1),
        "content_sha256": _content_hash(item),
        "severity": item.severity,
        "presentation": item.presentation,
        "surfaces": list(item.surfaces or []),
        "audiences": list(item.audiences or []),
        "starts_at": _iso(item.starts_at),
        "ends_at": _iso(item.ends_at),
    }
    if reason:
        data["reason"] = str(reason)[:300]
    if item.supersedes_id:
        data["supersedes_id"] = item.supersedes_id
    return data


def _add_audit(
    db: Session,
    *,
    actor: User,
    action: str,
    item: SystemAnnouncement,
    reason: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=actor.id,
            action=action,
            entity_type="system_announcement",
            entity_id=item.id,
            data=_audit_data(item, reason=reason),
        )
    )


def _get_locked(db: Session, announcement_id: str) -> SystemAnnouncement:
    item = db.scalar(
        select(SystemAnnouncement)
        .where(SystemAnnouncement.id == str(announcement_id))
        .with_for_update()
    )
    if item is None:
        _fail(
            "ANNOUNCEMENT_NOT_FOUND",
            "Объявление не найдено",
            status_code=404,
        )
    return item


def _check_revision(item: SystemAnnouncement, expected_revision: int) -> None:
    current = int(item.revision or 1)
    if current != int(expected_revision):
        _fail(
            "ANNOUNCEMENT_REVISION_CONFLICT",
            "Объявление уже изменено в другой вкладке",
            status_code=409,
            current_revision=current,
        )


def _ensure_reason(reason: str) -> str:
    clean = str(reason or "").strip()
    if len(clean) < 3 or len(clean) > 300:
        _fail(
            "ANNOUNCEMENT_REASON_INVALID",
            "Причина должна содержать от 3 до 300 символов",
        )
    return clean


def _overlaps(
    left_start: datetime,
    left_end: datetime,
    right_start: datetime | None,
    right_end: datetime | None,
) -> bool:
    right_start_aware = _aware(right_start)
    right_end_aware = _aware(right_end)
    return bool(
        right_start_aware
        and right_end_aware
        and left_start < right_end_aware
        and right_start_aware < left_end
    )


def _ensure_no_critical_modal_conflict(
    db: Session,
    item: SystemAnnouncement,
    starts_at: datetime,
    ends_at: datetime,
    *,
    exclude_ids: Iterable[str] = (),
) -> None:
    if item.severity != "CRITICAL" or item.presentation != "MODAL":
        return
    excluded = {str(value) for value in exclude_ids}
    candidates = list(
        db.scalars(
            select(SystemAnnouncement).where(
                SystemAnnouncement.status == "PUBLISHED",
                SystemAnnouncement.severity == "CRITICAL",
                SystemAnnouncement.presentation == "MODAL",
                SystemAnnouncement.starts_at < ends_at,
                SystemAnnouncement.ends_at > starts_at,
            )
        ).all()
    )
    surfaces = set(item.surfaces or [])
    for other in candidates:
        if other.id in excluded or other.id == item.id:
            continue
        if surfaces.intersection(other.surfaces or []) and _overlaps(
            starts_at,
            ends_at,
            other.starts_at,
            other.ends_at,
        ):
            _fail(
                "ANNOUNCEMENT_CRITICAL_MODAL_CONFLICT",
                "На одной из поверхностей уже запланирован CRITICAL modal",
                status_code=409,
            )


def create_draft(
    db: Session,
    *,
    actor: User,
    payload: Mapping[str, Any],
) -> SystemAnnouncement:
    values = validate_draft(payload)
    item = SystemAnnouncement(
        **values,
        status="DRAFT",
        revision=1,
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    db.add(item)
    db.flush()
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.created",
        item=item,
    )
    db.commit()
    db.refresh(item)
    return item


def update_draft(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
    expected_revision: int,
    payload: Mapping[str, Any],
) -> SystemAnnouncement:
    item = _get_locked(db, announcement_id)
    _check_revision(item, expected_revision)
    if item.status != "DRAFT":
        _fail(
            "ANNOUNCEMENT_IMMUTABLE",
            "После публикации содержимое объявления неизменяемо",
            status_code=409,
        )
    merged = {field: getattr(item, field) for field in _DRAFT_FIELDS}
    merged.update(
        {key: value for key, value in payload.items() if key in _DRAFT_FIELDS}
    )
    values = validate_draft(merged)
    for field, value in values.items():
        setattr(item, field, value)
    item.revision = int(item.revision or 1) + 1
    item.updated_by_user_id = actor.id
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.updated",
        item=item,
    )
    db.commit()
    db.refresh(item)
    return item


def _queue_telegram(
    db: Session,
    *,
    kind: str,
    item: SystemAnnouncement,
    actor: User,
) -> None:
    from .telegram_announcements import queue_announcement_telegram_event

    queue_announcement_telegram_event(
        db,
        kind,
        announcement=item,
        actor_display_name=actor.display_name,
    )


def publish(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
    expected_revision: int,
    starts_at: datetime,
    ends_at: datetime,
    reason: str,
) -> SystemAnnouncement:
    item = _get_locked(db, announcement_id)
    _check_revision(item, expected_revision)
    if item.status != "DRAFT":
        _fail(
            "ANNOUNCEMENT_NOT_DRAFT",
            "Опубликовать можно только черновик",
            status_code=409,
        )
    starts, ends = validate_publication(
        item,
        starts_at=starts_at,
        ends_at=ends_at,
    )
    _ensure_no_critical_modal_conflict(db, item, starts, ends)
    clean_reason = _ensure_reason(reason)
    now = utcnow()
    item.status = "PUBLISHED"
    item.starts_at = starts
    item.ends_at = ends
    item.published_at = now
    item.published_by_user_id = actor.id
    item.updated_by_user_id = actor.id
    item.revision = int(item.revision or 1) + 1
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.published",
        item=item,
        reason=clean_reason,
    )
    _queue_telegram(db, kind="published", item=item, actor=actor)
    db.commit()
    db.refresh(item)
    return item


def cancel(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
    expected_revision: int,
    reason: str,
) -> SystemAnnouncement:
    item = _get_locked(db, announcement_id)
    _check_revision(item, expected_revision)
    if item.status != "PUBLISHED":
        _fail(
            "ANNOUNCEMENT_NOT_PUBLISHED",
            "Отменить можно только опубликованное объявление",
            status_code=409,
        )
    clean_reason = _ensure_reason(reason)
    item.status = "CANCELLED"
    item.cancelled_at = utcnow()
    item.cancelled_by_user_id = actor.id
    item.updated_by_user_id = actor.id
    item.revision = int(item.revision or 1) + 1
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.cancelled",
        item=item,
        reason=clean_reason,
    )
    _queue_telegram(db, kind="cancelled", item=item, actor=actor)
    db.commit()
    db.refresh(item)
    return item


def duplicate_draft(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
) -> SystemAnnouncement:
    source = db.get(SystemAnnouncement, str(announcement_id))
    if source is None:
        _fail(
            "ANNOUNCEMENT_NOT_FOUND",
            "Объявление не найдено",
            status_code=404,
        )
    values = validate_draft({field: getattr(source, field) for field in _DRAFT_FIELDS})
    item = SystemAnnouncement(
        **values,
        status="DRAFT",
        revision=1,
        supersedes_id=source.id,
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    db.add(item)
    db.flush()
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.duplicated",
        item=item,
        reason=f"copy of {source.id}",
    )
    db.commit()
    db.refresh(item)
    return item


def replace(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
    expected_revision: int,
    replacement_id: str,
    replacement_expected_revision: int,
    starts_at: datetime,
    ends_at: datetime,
    reason: str,
) -> tuple[SystemAnnouncement, SystemAnnouncement]:
    ids = sorted({str(announcement_id), str(replacement_id)})
    rows = list(
        db.scalars(
            select(SystemAnnouncement)
            .where(SystemAnnouncement.id.in_(ids))
            .order_by(SystemAnnouncement.id.asc())
            .with_for_update()
        ).all()
    )
    by_id = {item.id: item for item in rows}
    current = by_id.get(str(announcement_id))
    replacement = by_id.get(str(replacement_id))
    if current is None or replacement is None:
        _fail(
            "ANNOUNCEMENT_NOT_FOUND",
            "Исходное объявление или замена не найдены",
            status_code=404,
        )
    if current.id == replacement.id:
        _fail(
            "ANNOUNCEMENT_REPLACEMENT_INVALID",
            "Объявление не может заменить само себя",
        )
    _check_revision(current, expected_revision)
    _check_revision(replacement, replacement_expected_revision)
    if current.status != "PUBLISHED" or replacement.status != "DRAFT":
        _fail(
            "ANNOUNCEMENT_REPLACEMENT_INVALID",
            "Замена требует опубликованный оригинал и новый черновик",
            status_code=409,
        )
    if replacement.supersedes_id not in {None, current.id}:
        _fail(
            "ANNOUNCEMENT_REPLACEMENT_INVALID",
            "Черновик уже связан с другим объявлением",
            status_code=409,
        )
    starts, ends = validate_publication(
        replacement,
        starts_at=starts_at,
        ends_at=ends_at,
    )
    _ensure_no_critical_modal_conflict(
        db,
        replacement,
        starts,
        ends,
        exclude_ids={current.id, replacement.id},
    )
    clean_reason = _ensure_reason(reason)
    now = utcnow()

    current.status = "CANCELLED"
    current.cancelled_at = now
    current.cancelled_by_user_id = actor.id
    current.updated_by_user_id = actor.id
    current.revision = int(current.revision or 1) + 1

    replacement.status = "PUBLISHED"
    replacement.supersedes_id = current.id
    replacement.starts_at = starts
    replacement.ends_at = ends
    replacement.published_at = now
    replacement.published_by_user_id = actor.id
    replacement.updated_by_user_id = actor.id
    replacement.revision = int(replacement.revision or 1) + 1

    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.replaced",
        item=current,
        reason=clean_reason,
    )
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.published",
        item=replacement,
        reason=clean_reason,
    )
    _queue_telegram(db, kind="replaced", item=replacement, actor=actor)
    db.commit()
    db.refresh(current)
    db.refresh(replacement)
    return current, replacement


def change_end_time(
    db: Session,
    *,
    actor: User,
    announcement_id: str,
    expected_revision: int,
    ends_at: datetime,
    reason: str,
) -> SystemAnnouncement:
    item = _get_locked(db, announcement_id)
    _check_revision(item, expected_revision)
    if item.status != "PUBLISHED" or item.starts_at is None:
        _fail(
            "ANNOUNCEMENT_NOT_PUBLISHED",
            "Срок можно изменить только у опубликованного объявления",
            status_code=409,
        )
    starts, ends = _validate_window(item.starts_at, ends_at)
    _ensure_no_critical_modal_conflict(
        db,
        item,
        starts,
        ends,
        exclude_ids={item.id},
    )
    clean_reason = _ensure_reason(reason)
    item.ends_at = ends
    item.updated_by_user_id = actor.id
    item.revision = int(item.revision or 1) + 1
    _add_audit(
        db,
        actor=actor,
        action="admin.announcement.end_time_changed",
        item=item,
        reason=clean_reason,
    )
    db.commit()
    db.refresh(item)
    return item


def resolve_audiences(
    user: User | None,
    *,
    effective_role: str | None = None,
) -> set[str]:
    if user is None:
        return {"ALL", "ANONYMOUS"}
    role = str(effective_role or user.access_role or "PLAYER").upper()
    resolved = {"ALL", "AUTHENTICATED"}
    if role == "PLAYER":
        resolved.add("PLAYERS")
    elif role == "TESTER":
        resolved.add("TESTERS")
    elif role in {"OWNER", "ADMIN", "MODERATOR"}:
        resolved.add("STAFF")
    return resolved


def announcement_targets(
    item: SystemAnnouncement,
    *,
    user: User | None,
    surface: str,
    effective_role: str | None = None,
) -> bool:
    normalized_surface = str(surface or "").upper()
    if normalized_surface not in set(item.surfaces or []):
        return False
    return bool(
        resolve_audiences(user, effective_role=effective_role).intersection(
            item.audiences or []
        )
    )


def _surface_enabled(surface: str) -> bool:
    normalized = str(surface or "").upper()
    if normalized.startswith("SITE_"):
        return bool(getattr(settings, "announcements_site_enabled", False))
    if normalized.startswith("COMPANION_"):
        return bool(getattr(settings, "announcements_companion_enabled", False))
    return False


def serialize_announcement(
    item: SystemAnnouncement,
    *,
    locale: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    language = "en" if str(locale).lower().startswith("en") else "ru"
    title = item.title_en if language == "en" and item.title_en else item.title_ru
    body = item.body_en if language == "en" and item.body_en else item.body_ru
    cta_label = (
        item.cta_label_en
        if language == "en" and item.cta_label_en
        else item.cta_label_ru
    )
    return {
        "id": item.id,
        "revision": int(item.revision or 1),
        "phase": compute_phase(item, now),
        "severity": item.severity,
        "presentation": item.presentation,
        "effect": item.effect,
        "dismiss_policy": item.dismiss_policy,
        "priority": int(item.priority or 0),
        "title": title,
        "body": body,
        "cta": (
            {"label": cta_label, "url": item.cta_url}
            if item.cta_url and cta_label
            else None
        ),
        "starts_at": _iso(item.starts_at),
        "ends_at": _iso(item.ends_at),
        "show_countdown": bool(item.show_countdown),
    }


def serialize_admin_announcement(
    db: Session,
    item: SystemAnnouncement,
    *,
    now: datetime | None = None,
    actors: Mapping[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    actor_ids = {
        value
        for value in (
            item.created_by_user_id,
            item.updated_by_user_id,
            item.published_by_user_id,
            item.cancelled_by_user_id,
        )
        if value
    }
    actor_map = actors
    if actor_map is None:
        actor_map = (
            {
                user.id: {"id": user.id, "display_name": user.display_name}
                for user in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
            }
            if actor_ids
            else {}
        )
    return {
        "id": item.id,
        "status": item.status,
        "phase": compute_phase(item, now),
        "severity": item.severity,
        "presentation": item.presentation,
        "effect": item.effect,
        "dismiss_policy": item.dismiss_policy,
        "title_ru": item.title_ru,
        "body_ru": item.body_ru,
        "title_en": item.title_en,
        "body_en": item.body_en,
        "cta_label_ru": item.cta_label_ru,
        "cta_label_en": item.cta_label_en,
        "cta_url": item.cta_url,
        "surfaces": list(item.surfaces or []),
        "audiences": list(item.audiences or []),
        "priority": int(item.priority or 0),
        "show_countdown": bool(item.show_countdown),
        "starts_at": _iso(item.starts_at),
        "ends_at": _iso(item.ends_at),
        "revision": int(item.revision or 1),
        "supersedes_id": item.supersedes_id,
        "created_by": actor_map.get(item.created_by_user_id),
        "updated_by": actor_map.get(item.updated_by_user_id),
        "published_by": actor_map.get(item.published_by_user_id),
        "cancelled_by": actor_map.get(item.cancelled_by_user_id),
        "published_at": _iso(item.published_at),
        "cancelled_at": _iso(item.cancelled_at),
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def active_announcements(
    db: Session,
    *,
    user: User | None,
    surface: str,
    locale: str,
    now: datetime | None = None,
    effective_role: str | None = None,
) -> list[dict[str, Any]]:
    normalized_surface = _enum(surface, ANNOUNCEMENT_SURFACES, "surface")
    if not bool(getattr(settings, "announcements_enabled", False)):
        return []
    if not _surface_enabled(normalized_surface):
        return []

    current = _aware(now or utcnow())
    candidates = list(
        db.scalars(
            select(SystemAnnouncement)
            .where(
                SystemAnnouncement.status == "PUBLISHED",
                SystemAnnouncement.starts_at <= current,
                SystemAnnouncement.ends_at > current,
            )
            .order_by(
                SystemAnnouncement.priority.desc(),
                SystemAnnouncement.published_at.desc(),
                SystemAnnouncement.id.asc(),
            )
        ).all()
    )
    targeted = [
        item
        for item in candidates
        if announcement_targets(
            item,
            user=user,
            surface=normalized_surface,
            effective_role=effective_role,
        )
    ]

    dismissed: set[tuple[str, int]] = set()
    if user is not None and targeted:
        ids = [item.id for item in targeted]
        receipts = list(
            db.scalars(
                select(SystemAnnouncementReceipt).where(
                    SystemAnnouncementReceipt.user_id == user.id,
                    SystemAnnouncementReceipt.surface == normalized_surface,
                    SystemAnnouncementReceipt.announcement_id.in_(ids),
                    or_(
                        SystemAnnouncementReceipt.dismissed_at.is_not(None),
                        SystemAnnouncementReceipt.acknowledged_at.is_not(None),
                    ),
                )
            ).all()
        )
        dismissed = {
            (receipt.announcement_id, int(receipt.revision)) for receipt in receipts
        }

    maximum = max(1, int(getattr(settings, "announcements_max_active", 5)))
    visible = [
        item for item in targeted if (item.id, int(item.revision or 1)) not in dismissed
    ][:maximum]
    return [
        serialize_announcement(item, locale=locale, now=current) for item in visible
    ]


def list_admin_announcements(
    db: Session,
    *,
    phase: str = "ALL",
    severity: str = "ALL",
    surface: str = "ALL",
    author: str = "",
    query: str = "",
    offset: int = 0,
    limit: int = 100,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = _aware(now or utcnow())
    stmt = select(SystemAnnouncement)
    normalized_severity = str(severity or "ALL").upper()
    if normalized_severity != "ALL":
        _enum(normalized_severity, ANNOUNCEMENT_SEVERITIES, "severity")
        stmt = stmt.where(SystemAnnouncement.severity == normalized_severity)
    author_value = str(author or "").strip()[:160]
    if author_value:
        matching_authors = select(User.id).where(
            or_(
                User.id.ilike(f"%{author_value}%"),
                User.display_name.ilike(f"%{author_value}%"),
            )
        )
        stmt = stmt.where(SystemAnnouncement.created_by_user_id.in_(matching_authors))
    value = str(query or "").strip()[:160]
    if value:
        stmt = stmt.where(
            or_(
                SystemAnnouncement.id.ilike(f"%{value}%"),
                SystemAnnouncement.title_ru.ilike(f"%{value}%"),
                SystemAnnouncement.title_en.ilike(f"%{value}%"),
                SystemAnnouncement.body_ru.ilike(f"%{value}%"),
                SystemAnnouncement.body_en.ilike(f"%{value}%"),
            )
        )
    items = list(
        db.scalars(
            stmt.order_by(
                SystemAnnouncement.created_at.desc(),
                SystemAnnouncement.id.asc(),
            )
        ).all()
    )

    normalized_phase = str(phase or "ALL").upper()
    allowed_phases = ANNOUNCEMENT_STATUSES | {"SCHEDULED", "ACTIVE", "EXPIRED"}
    if normalized_phase != "ALL" and normalized_phase not in allowed_phases:
        _fail("ANNOUNCEMENT_PHASE_INVALID", "Неизвестная фаза объявления")
    normalized_surface = str(surface or "ALL").upper()
    if normalized_surface != "ALL":
        _enum(normalized_surface, ANNOUNCEMENT_SURFACES, "surface")

    filtered = [
        item
        for item in items
        if (
            normalized_phase == "ALL"
            or compute_phase(item, current) == normalized_phase
        )
        and (
            normalized_surface == "ALL"
            or normalized_surface in set(item.surfaces or [])
        )
    ]
    phase_counts: dict[str, int] = {}
    for item in items:
        key = compute_phase(item, current)
        phase_counts[key] = phase_counts.get(key, 0) + 1
    safe_offset = max(0, min(int(offset), 100_000))
    safe_limit = max(1, min(int(limit), 250))
    page = filtered[safe_offset : safe_offset + safe_limit]
    actor_ids = {
        actor_id
        for item in page
        for actor_id in (
            item.created_by_user_id,
            item.updated_by_user_id,
            item.published_by_user_id,
            item.cancelled_by_user_id,
        )
        if actor_id
    }
    actors = (
        {
            user.id: {"id": user.id, "display_name": user.display_name}
            for user in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
        }
        if actor_ids
        else {}
    )
    return {
        "items": [
            serialize_admin_announcement(db, item, now=current, actors=actors)
            for item in page
        ],
        "total": len(filtered),
        "offset": safe_offset,
        "limit": safe_limit,
        "phase_counts": phase_counts,
        "server_time": current.isoformat(),
    }


def announcement_metrics(
    db: Session,
    announcement_id: str,
) -> dict[str, Any]:
    item = db.get(SystemAnnouncement, str(announcement_id))
    if item is None:
        _fail(
            "ANNOUNCEMENT_NOT_FOUND",
            "Объявление не найдено",
            status_code=404,
        )
    receipts = list(
        db.scalars(
            select(SystemAnnouncementReceipt).where(
                SystemAnnouncementReceipt.announcement_id == item.id
            )
        ).all()
    )
    by_surface: dict[str, dict[str, int]] = {}
    users_by_surface: dict[str, dict[str, set[str]]] = {}
    all_seen_users: set[str] = set()
    all_dismissed_users: set[str] = set()
    all_acknowledged_users: set[str] = set()
    for receipt in receipts:
        bucket = by_surface.setdefault(
            receipt.surface,
            {
                "seen_users": 0,
                "dismissed_users": 0,
                "acknowledged_users": 0,
                "impressions": 0,
            },
        )
        surface_users = users_by_surface.setdefault(
            receipt.surface,
            {"seen": set(), "dismissed": set(), "acknowledged": set()},
        )
        if receipt.first_seen_at is not None:
            surface_users["seen"].add(receipt.user_id)
            all_seen_users.add(receipt.user_id)
        if receipt.dismissed_at is not None:
            surface_users["dismissed"].add(receipt.user_id)
            all_dismissed_users.add(receipt.user_id)
        if receipt.acknowledged_at is not None:
            surface_users["acknowledged"].add(receipt.user_id)
            all_acknowledged_users.add(receipt.user_id)
        bucket["impressions"] += int(receipt.impression_count or 0)
    for surface, surface_users in users_by_surface.items():
        by_surface[surface]["seen_users"] = len(surface_users["seen"])
        by_surface[surface]["dismissed_users"] = len(surface_users["dismissed"])
        by_surface[surface]["acknowledged_users"] = len(surface_users["acknowledged"])
    totals = {
        "seen_users": len(all_seen_users),
        "dismissed_users": len(all_dismissed_users),
        "acknowledged_users": len(all_acknowledged_users),
        "impressions": sum(bucket["impressions"] for bucket in by_surface.values()),
    }
    seen = totals["seen_users"]
    return {
        "announcement_id": item.id,
        "revision": int(item.revision or 1),
        "totals": totals,
        "by_surface": by_surface,
        "acknowledgement_rate": (
            round(totals["acknowledged_users"] * 100.0 / seen, 1) if seen else 0.0
        ),
    }


def record_receipt(
    db: Session,
    *,
    user: User,
    announcement_id: str,
    revision: int,
    surface: str,
    action: str,
    effective_role: str | None = None,
    now: datetime | None = None,
) -> SystemAnnouncementReceipt:
    normalized_surface = _enum(surface, ANNOUNCEMENT_SURFACES, "surface")
    normalized_action = _enum(action, ANNOUNCEMENT_RECEIPT_ACTIONS, "action")
    current = _aware(now or utcnow())
    item = db.get(SystemAnnouncement, str(announcement_id))
    if item is None:
        _fail(
            "ANNOUNCEMENT_NOT_FOUND",
            "Объявление не найдено",
            status_code=404,
        )
    if int(item.revision or 1) != int(revision):
        _fail(
            "ANNOUNCEMENT_REVISION_CONFLICT",
            "Версия объявления устарела",
            status_code=409,
            current_revision=int(item.revision or 1),
        )
    if compute_phase(item, current) != "ACTIVE" or not announcement_targets(
        item,
        user=user,
        surface=normalized_surface,
        effective_role=effective_role,
    ):
        _fail(
            "ANNOUNCEMENT_NOT_ACTIVE",
            "Объявление не активно для этого пользователя",
            status_code=409,
        )
    if normalized_action == "DISMISSED" and item.dismiss_policy != "DISMISSIBLE":
        _fail(
            "ANNOUNCEMENT_NOT_DISMISSIBLE",
            "Это объявление нельзя закрыть без подтверждения",
            status_code=409,
        )
    if normalized_action == "ACKNOWLEDGED" and item.dismiss_policy != "ACK_REQUIRED":
        _fail(
            "ANNOUNCEMENT_ACK_NOT_REQUIRED",
            "Подтверждение разрешено только для объявления с ACK_REQUIRED",
            status_code=409,
        )

    stmt = (
        select(SystemAnnouncementReceipt)
        .where(
            SystemAnnouncementReceipt.announcement_id == item.id,
            SystemAnnouncementReceipt.revision == int(revision),
            SystemAnnouncementReceipt.user_id == user.id,
            SystemAnnouncementReceipt.surface == normalized_surface,
        )
        .with_for_update()
    )
    receipt = db.scalar(stmt)
    if receipt is None:
        try:
            with db.begin_nested():
                receipt = SystemAnnouncementReceipt(
                    announcement_id=item.id,
                    revision=int(revision),
                    user_id=user.id,
                    surface=normalized_surface,
                )
                db.add(receipt)
                db.flush()
        except IntegrityError:
            receipt = db.scalar(stmt)
    if receipt is None:
        _fail(
            "ANNOUNCEMENT_RECEIPT_CONFLICT",
            "Не удалось сохранить подтверждение",
            status_code=409,
        )

    if normalized_action == "SEEN":
        previous_seen = _aware(receipt.last_seen_at)
        if receipt.first_seen_at is None:
            receipt.first_seen_at = current
        if previous_seen is None or current - previous_seen >= timedelta(minutes=5):
            receipt.impression_count = int(receipt.impression_count or 0) + 1
        receipt.last_seen_at = current
    elif normalized_action == "DISMISSED":
        receipt.dismissed_at = receipt.dismissed_at or current
    else:
        receipt.acknowledged_at = receipt.acknowledged_at or current

    db.commit()
    db.refresh(receipt)
    return receipt


def serialize_receipt(receipt: SystemAnnouncementReceipt) -> dict[str, Any]:
    return {
        "announcement_id": receipt.announcement_id,
        "revision": int(receipt.revision),
        "surface": receipt.surface,
        "first_seen_at": _iso(receipt.first_seen_at),
        "last_seen_at": _iso(receipt.last_seen_at),
        "dismissed_at": _iso(receipt.dismissed_at),
        "acknowledged_at": _iso(receipt.acknowledged_at),
        "impression_count": int(receipt.impression_count or 0),
    }
