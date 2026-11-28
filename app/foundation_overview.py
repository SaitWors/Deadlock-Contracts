from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import (
    ArchiveItem,
    ArchiveOperation,
    BoardOption,
    BureauMembership,
    BureauOperation,
    ContractBoard,
    PlayerBureau,
    RewardLedgerEntry,
    User,
    utcnow,
)
from .services.auth import require_user
from .services.bureau_operations import TEMPLATES, aware
from .services.progression import TRUSTED_REWARD_SOURCES

router = APIRouter(prefix="/api/foundation", tags=["Foundation"])


def overview_summary(db: Session, user_id: str, now: datetime) -> dict:
    today = now.astimezone(timezone.utc).date()
    first_day = today - timedelta(days=6)
    start = datetime.combine(first_day, time.min, timezone.utc)
    days = {
        (first_day + timedelta(days=offset)).isoformat(): {
            "cases": 0,
            "contracts": 0,
            "xp": 0,
        }
        for offset in range(7)
    }
    signed = select(ContractBoard.id).where(
        ContractBoard.user_id == user_id, ContractBoard.locked_at.is_not(None)
    )
    options = (
        select(BoardOption.id)
        .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
        .where(ContractBoard.user_id == user_id, BoardOption.selected.is_(True))
    )
    results = options.where(
        BoardOption.status.in_(("COMPLETED", "FAILED")),
        BoardOption.settled_at.is_not(None),
    )
    case_dates = (
        results.with_only_columns(func.max(BoardOption.settled_at).label("settled_at"))
        .where(ContractBoard.status == "SETTLED", ContractBoard.attempts_used > 0)
        .group_by(ContractBoard.id)
        .subquery()
    )
    completed_cases = db.scalar(select(func.count()).select_from(case_dates))
    for stamp in db.scalars(
        select(case_dates.c.settled_at).where(
            case_dates.c.settled_at.between(start, now)
        )
    ):
        days[aware(stamp).astimezone(timezone.utc).date().isoformat()]["cases"] += 1
    for stamp in db.scalars(
        results.with_only_columns(BoardOption.settled_at).where(
            BoardOption.status == "COMPLETED",
            BoardOption.settled_at.between(start, now),
        )
    ):
        days[aware(stamp).astimezone(timezone.utc).date().isoformat()]["contracts"] += 1
    for stamp, xp in db.execute(
        select(RewardLedgerEntry.created_at, RewardLedgerEntry.delta).where(
            RewardLedgerEntry.user_id == user_id,
            RewardLedgerEntry.source_id.in_(options),
            RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES),
            RewardLedgerEntry.asset == "XP",
            RewardLedgerEntry.delta > 0,
            RewardLedgerEntry.created_at.between(start, now),
        )
    ):
        days[aware(stamp).astimezone(timezone.utc).date().isoformat()]["xp"] += xp

    items, designs = db.execute(
        select(
            func.count(ArchiveItem.id), func.count(distinct(ArchiveItem.card_id))
        ).where(
            ArchiveItem.user_id == user_id,
            ArchiveItem.scope == "REAL",
            ArchiveItem.state == "OWNED",
        )
    ).one()
    bureau = db.scalar(
        select(PlayerBureau)
        .join(BureauMembership)
        .where(BureauMembership.user_id == user_id)
    )
    bureau_summary = None
    if bureau:
        operation = db.scalar(
            select(BureauOperation)
            .where(
                BureauOperation.bureau_id == bureau.id,
                BureauOperation.status == "ACTIVE",
                BureauOperation.ends_at > now,
            )
            .order_by(BureauOperation.started_at.desc(), BureauOperation.id)
            .limit(1)
        )
        template = TEMPLATES.get(operation.template) if operation else None
        bureau_summary = {
            "slug": bureau.slug,
            "name": bureau.name,
            "status": bureau.status,
            "operation": {
                "title": template["title"],
                "progress": operation.progress,
                "target": operation.target,
            }
            if bureau.status == "ACTIVE" and template
            else None,
        }
    claimed_daily = select(ArchiveOperation.id).where(
        ArchiveOperation.user_id == user_id,
        ArchiveOperation.scope == "REAL",
        ArchiveOperation.kind == "DAILY_PACK",
        ArchiveOperation.benefit_key.is_not(None),
    )
    return {
        "completed_cases": completed_cases,
        "weekly": [{"date": day, **counts} for day, counts in days.items()],
        "collection": {"items": items, "designs": designs},
        "bureau": bureau_summary,
        "has_signed_case": bool(db.scalar(select(signed.exists()))),
        "has_verified_result": bool(db.scalar(select(results.exists()))),
        "has_claimed_daily_pack": bool(db.scalar(select(claimed_daily.exists()))),
    }


@router.get("/overview")
def foundation_overview(
    response: Response,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return overview_summary(db, user.id, utcnow())
