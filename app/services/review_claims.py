from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AuditLog, AutoReviewCase, User


CLAIM_TTL_MINUTES = 10
OPEN_REVIEW_STATUSES = frozenset({"PENDING", "NEEDS_INFO"})


class ReviewClaimError(Exception):
    status_code = 400
    code = "REVIEW_CLAIM_ERROR"

    def __init__(self, detail: str, *, code: str | None = None):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code


class ReviewClaimNotFound(ReviewClaimError):
    status_code = 404
    code = "REVIEW_NOT_FOUND"


class ReviewClaimConflict(ReviewClaimError):
    status_code = 409
    code = "REVIEW_CLAIM_CONFLICT"


class ReviewClaimValidationError(ReviewClaimError):
    status_code = 422
    code = "REVIEW_CLAIM_VALIDATION"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_review(db: Session, review_id: str, *, lock: bool) -> AutoReviewCase:
    stmt = select(AutoReviewCase).where(AutoReviewCase.id == str(review_id))
    if lock:
        stmt = stmt.with_for_update()
    item = db.scalar(stmt)
    if item is None:
        raise ReviewClaimNotFound(
            "Внутренняя заявка не найдена",
            code="REVIEW_NOT_FOUND",
        )
    return item


def claim_is_active(item: AutoReviewCase, *, now: datetime | None = None) -> bool:
    current = now or _now()
    expires = _aware(getattr(item, "claim_expires_at", None))
    claimed_by = str(getattr(item, "claimed_by_user_id", "") or "")
    return bool(claimed_by and expires and expires > current)


def clear_review_claim(item: AutoReviewCase) -> None:
    item.claimed_by_user_id = None
    item.claimed_at = None
    item.claim_expires_at = None


def assert_review_claim(
    item: AutoReviewCase,
    actor_user_id: str,
    *,
    now: datetime | None = None,
) -> None:
    current = now or _now()
    if not claim_is_active(item, now=current):
        raise ReviewClaimConflict(
            "Сначала возьмите заявку в работу",
            code="REVIEW_CLAIM_REQUIRED",
        )
    if str(item.claimed_by_user_id) != str(actor_user_id):
        raise ReviewClaimConflict(
            "Заявка уже находится в работе у другого модератора",
            code="REVIEW_CLAIMED_BY_OTHER",
        )


def review_claim_payload(
    db: Session,
    item: AutoReviewCase,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or _now()
    active = claim_is_active(item, now=current)
    claimant = None
    if getattr(item, "claimed_by_user_id", None):
        user = db.get(User, item.claimed_by_user_id)
        if user is not None:
            claimant = {
                "id": user.id,
                "display_name": user.display_name,
                "access_role": str(user.access_role or "PLAYER").upper(),
            }

    expires = _aware(getattr(item, "claim_expires_at", None))
    claimed_at = _aware(getattr(item, "claimed_at", None))
    remaining = (
        max(0, int((expires - current).total_seconds()))
        if active and expires
        else 0
    )
    return {
        "active": active,
        "claimed_by": claimant,
        "claimed_by_user_id": str(item.claimed_by_user_id)
        if getattr(item, "claimed_by_user_id", None)
        else None,
        "claimed_at": claimed_at.isoformat() if claimed_at else None,
        "expires_at": expires.isoformat() if expires else None,
        "seconds_remaining": remaining,
        "expired": bool(
            getattr(item, "claimed_by_user_id", None)
            and expires
            and expires <= current
        ),
        "ttl_minutes": CLAIM_TTL_MINUTES,
    }


def claim_review(
    db: Session,
    *,
    review_id: str,
    actor_user_id: str,
    force: bool = False,
) -> dict[str, Any]:
    item = _load_review(db, review_id, lock=True)
    if item.status not in OPEN_REVIEW_STATUSES:
        raise ReviewClaimConflict(
            "Закрытую заявку нельзя взять в работу",
            code="REVIEW_ALREADY_DECIDED",
        )

    now = _now()
    active = claim_is_active(item, now=now)
    previous_owner = str(item.claimed_by_user_id or "")
    same_actor = previous_owner == str(actor_user_id)

    if active and not same_actor and not force:
        claimant = db.get(User, item.claimed_by_user_id) if item.claimed_by_user_id else None
        name = claimant.display_name if claimant else "другого модератора"
        raise ReviewClaimConflict(
            f"Заявка уже в работе: {name}",
            code="REVIEW_CLAIMED_BY_OTHER",
        )

    action = "auto_review.claimed"
    if active and same_actor:
        action = "auto_review.claim_renewed"
    elif active and force and not same_actor:
        action = "auto_review.claim_forced"
    elif previous_owner and not active:
        action = "auto_review.claim_reclaimed"

    if not active or not same_actor:
        item.claimed_by_user_id = str(actor_user_id)
        item.claimed_at = now
    elif item.claimed_at is None:
        item.claimed_at = now

    item.claim_expires_at = now + timedelta(minutes=CLAIM_TTL_MINUTES)

    db.add(
        AuditLog(
            user_id=str(actor_user_id),
            action=action,
            entity_type="auto_review_case",
            entity_id=item.id,
            data={
                "previous_claimed_by_user_id": previous_owner or None,
                "force": bool(force),
                "claim_ttl_minutes": CLAIM_TTL_MINUTES,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return review_claim_payload(db, item)


def release_review(
    db: Session,
    *,
    review_id: str,
    actor_user_id: str,
    force: bool = False,
) -> dict[str, Any]:
    item = _load_review(db, review_id, lock=True)
    now = _now()
    active = claim_is_active(item, now=now)

    if active and str(item.claimed_by_user_id) != str(actor_user_id) and not force:
        raise ReviewClaimConflict(
            "Освободить чужую активную заявку может только ADMIN/OWNER",
            code="REVIEW_CLAIMED_BY_OTHER",
        )

    previous_owner = str(item.claimed_by_user_id or "")
    clear_review_claim(item)
    db.add(
        AuditLog(
            user_id=str(actor_user_id),
            action="auto_review.claim_released",
            entity_type="auto_review_case",
            entity_id=item.id,
            data={
                "previous_claimed_by_user_id": previous_owner or None,
                "force": bool(force),
                "was_active": active,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return review_claim_payload(db, item)


def mark_review_needs_info(
    db: Session,
    *,
    review_id: str,
    actor_user_id: str,
    note: str,
) -> AutoReviewCase:
    clean_note = str(note or "").strip()
    if len(clean_note) < 5:
        raise ReviewClaimValidationError(
            "Для NEEDS_INFO требуется пояснение минимум из 5 символов",
            code="NEEDS_INFO_NOTE_REQUIRED",
        )
    if len(clean_note) > 1500:
        raise ReviewClaimValidationError(
            "Пояснение слишком длинное",
            code="NEEDS_INFO_NOTE_TOO_LONG",
        )

    item = _load_review(db, review_id, lock=True)
    if item.status not in OPEN_REVIEW_STATUSES:
        raise ReviewClaimConflict(
            "Закрытую заявку нельзя перевести в NEEDS_INFO",
            code="REVIEW_ALREADY_DECIDED",
        )

    assert_review_claim(item, actor_user_id)
    item.status = "NEEDS_INFO"
    item.reviewer_id = str(actor_user_id)
    item.reviewer_note = clean_note
    clear_review_claim(item)

    db.add(
        AuditLog(
            user_id=str(actor_user_id),
            action="auto_review.needs_info",
            entity_type="auto_review_case",
            entity_id=item.id,
            data={"note": clean_note},
        )
    )
    db.commit()
    db.refresh(item)
    return item
