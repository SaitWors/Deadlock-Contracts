from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    BoardOption,
    ContractBoard,
    Evaluation,
    Match,
    PublicProfile,
    RewardLedgerEntry,
    User,
)
from .progression import progression_from_xp

LeaderboardScope = Literal["all_time", "today", "rare", "mastery"]
TRUSTED_REWARD_SOURCES = ("assignment", "AUTO_REVIEW", "MANUAL_EVIDENCE")


def _eligible_players(db: Session) -> list[tuple[User, PublicProfile]]:
    return list(
        db.execute(
            select(User, PublicProfile)
            .join(PublicProfile, PublicProfile.user_id == User.id)
            .where(
                User.status == "ACTIVE",
                PublicProfile.is_public.is_(True),
                PublicProfile.show_stats.is_(True),
            )
        ).all()
    )


def _gep_attested_assignment_ids(
    db: Session,
    user_ids: list[str],
) -> list[str]:
    """Return only assignments settled from CLIENT_ATTESTED_GEP matches.

    Legacy assignment ledger rows may not have a BoardOption/Evaluation link
    at all, so they must not disappear from the public leaderboard merely
    because the new Alpha.11 GEP policy exists.
    """

    if (
        not user_ids
        or settings.gep_settlement_leaderboard_eligible
    ):
        return []

    return list(
        db.scalars(
            select(BoardOption.id)
            .join(
                ContractBoard,
                ContractBoard.id == BoardOption.board_id,
            )
            .join(
                Evaluation,
                Evaluation.id == BoardOption.final_evaluation_id,
            )
            .join(
                Match,
                Match.id == Evaluation.match_id,
            )
            .where(
                ContractBoard.user_id.in_(user_ids),
                BoardOption.selected.is_(True),
                BoardOption.status == "COMPLETED",
                Match.integrity_status == "CLIENT_ATTESTED_GEP",
            )
        ).all()
    )


def _positive_verified_xp(
    db: Session,
    user_ids: list[str],
    *,
    since: datetime | None = None,
) -> dict[str, int]:
    if not user_ids:
        return {}

    excluded_gep_assignments = _gep_attested_assignment_ids(
        db,
        user_ids,
    )

    assignment_filter = (
        RewardLedgerEntry.source_type == "assignment"
    )
    if excluded_gep_assignments:
        assignment_filter = (
            assignment_filter
            & RewardLedgerEntry.source_id.not_in(
                excluded_gep_assignments
            )
        )

    eligible_source = or_(
        RewardLedgerEntry.source_type.in_(
            ("AUTO_REVIEW", "MANUAL_EVIDENCE")
        ),
        assignment_filter,
    )

    statement = (
        select(
            RewardLedgerEntry.user_id,
            func.coalesce(
                func.sum(RewardLedgerEntry.delta),
                0,
            ),
        )
        .where(
            RewardLedgerEntry.user_id.in_(user_ids),
            RewardLedgerEntry.asset == "XP",
            RewardLedgerEntry.delta > 0,
            eligible_source,
        )
        .group_by(RewardLedgerEntry.user_id)
    )

    if since is not None:
        statement = statement.where(
            RewardLedgerEntry.created_at >= since
        )

    return {
        str(user_id): int(total or 0)
        for user_id, total in db.execute(statement).all()
    }


def _completion_stats(
    db: Session,
    user_ids: list[str],
) -> dict[str, dict[str, int]]:
    if not user_ids:
        return {}

    excluded_gep_assignments = _gep_attested_assignment_ids(
        db,
        user_ids,
    )

    statement = (
        select(
            ContractBoard.user_id,
            func.count(BoardOption.id).label("completed"),
            func.coalesce(
                func.sum(
                    case(
                        (BoardOption.rarity == "EPIC", 2),
                        (BoardOption.rarity == "RARE", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("rare_score"),
            func.coalesce(
                func.sum(
                    case(
                        (BoardOption.difficulty == "EXTREME", 2),
                        (BoardOption.difficulty == "HARD", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("mastery_score"),
        )
        .join(
            ContractBoard,
            ContractBoard.id == BoardOption.board_id,
        )
        .where(
            ContractBoard.user_id.in_(user_ids),
            BoardOption.selected.is_(True),
            BoardOption.status == "COMPLETED",
        )
        .group_by(ContractBoard.user_id)
    )

    if excluded_gep_assignments:
        statement = statement.where(
            BoardOption.id.not_in(excluded_gep_assignments)
        )

    rows = db.execute(statement).all()

    return {
        str(user_id): {
            "completed": int(completed or 0),
            "rare_score": int(rare_score or 0),
            "mastery_score": int(mastery_score or 0),
        }
        for user_id, completed, rare_score, mastery_score in rows
    }


def public_leaderboard(
    db: Session,
    scope: LeaderboardScope,
    *,
    limit: int = 50,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    players = _eligible_players(db)
    user_ids = [user.id for user, _ in players]
    verified_xp = _positive_verified_xp(db, user_ids)
    today_start = datetime.combine(
        now.date(),
        time.min,
        tzinfo=timezone.utc,
    )
    today_xp = _positive_verified_xp(
        db,
        user_ids,
        since=today_start,
    )
    completion_stats = _completion_stats(db, user_ids)

    scoring = {
        "all_time": {
            "label": "VERIFIED XP",
            "description": (
                "Server-awarded contract XP only. "
                "Administrative XP adjustments are excluded."
            ),
        },
        "today": {
            "label": "XP TODAY",
            "description": (
                "Verified contract XP earned since 00:00 UTC."
            ),
        },
        "rare": {
            "label": "RARE SCORE",
            "description": (
                "RARE completion = 1 point, "
                "EPIC completion = 2 points."
            ),
        },
        "mastery": {
            "label": "MASTERY SCORE",
            "description": (
                "HARD completion = 1 point, "
                "EXTREME completion = 2 points."
            ),
        },
    }[scope]

    rows: list[dict] = []

    for user, profile in players:
        stats = completion_stats.get(
            user.id,
            {
                "completed": 0,
                "rare_score": 0,
                "mastery_score": 0,
            },
        )

        score = {
            "all_time": verified_xp.get(user.id, 0),
            "today": today_xp.get(user.id, 0),
            "rare": stats["rare_score"],
            "mastery": stats["mastery_score"],
        }[scope]

        if score <= 0:
            continue

        rows.append(
            {
                "slug": profile.slug,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "level": progression_from_xp(user.xp)["level"],
                "score": int(score),
                "verified_xp": verified_xp.get(user.id, 0),
                "contracts_completed": stats["completed"],
            }
        )

    rows.sort(
        key=lambda item: (
            -item["score"],
            -item["verified_xp"],
            -item["contracts_completed"],
            item["display_name"].casefold(),
            item["slug"],
        )
    )

    rows = rows[: max(1, min(int(limit), 100))]

    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    return {
        "scope": scope,
        "generated_at": now.isoformat(),
        "reset_at": (
            today_start + timedelta(days=1)
        ).isoformat()
        if scope == "today"
        else None,
        "scoring": scoring,
        "eligibility": (
            "Public profile + public stats enabled + "
            "at least one scoring result for this board."
        ),
        "rows": rows,
    }
