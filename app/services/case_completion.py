"""Read-only receipts for replaying a settled case's already credited XP."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import BoardOption, ContractBoard, RewardLedgerEntry, User
from .progression import TRUSTED_REWARD_SOURCES, level_cost, progression_from_xp


FINAL_TASK_STATUSES = frozenset({"COMPLETED", "FAILED", "VOID", "EXPIRED"})


def case_completion(db: Session, user: User, board_id: str) -> dict | None:
    board = db.scalar(select(ContractBoard).where(
        ContractBoard.id == board_id,
        ContractBoard.user_id == user.id,
    ))
    if board is None:
        return None

    options = list(db.scalars(
        select(BoardOption)
        .options(selectinload(BoardOption.mission))
        .where(BoardOption.board_id == board.id, BoardOption.selected.is_(True))
        .order_by(BoardOption.created_at, BoardOption.id)
    ).all())
    completed_ids = [option.id for option in options if option.status == "COMPLETED"]
    rewards = list(db.scalars(select(RewardLedgerEntry).where(
        RewardLedgerEntry.user_id == user.id,
        RewardLedgerEntry.source_id.in_(completed_ids),
        RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES),
        RewardLedgerEntry.asset == "XP",
        RewardLedgerEntry.delta > 0,
    )).all()) if completed_ids else []
    xp_by_option: dict[str, int] = {}
    for reward in rewards:
        xp_by_option[reward.source_id] = xp_by_option.get(reward.source_id, 0) + int(reward.delta)

    reason = None
    if board.status == "VERIFYING" or any(option.status == "VERIFYING" for option in options):
        reason = "VERIFYING"
    elif board.status == "REVIEW_REQUIRED" or any(option.status == "REVIEW_REQUIRED" for option in options):
        reason = "REVIEW_REQUIRED"
    elif (
        board.status != "SETTLED"
        or not 1 <= len(options) <= 3
        or any(option.status not in FINAL_TASK_STATUSES for option in options)
        or (
            not all(option.status == "COMPLETED" for option in options)
            and int(board.attempts_used or 0) < max(1, int(board.max_attempts or 3))
        )
    ):
        reason = "IN_PROGRESS"
    elif any(
        option.status == "COMPLETED" and option.reward_xp > 0 and option.id not in xp_by_option
        for option in options
    ):
        # Settlement and the reward outbox commit separately. A missing receipt
        # is pending delivery, even if the assignment already says COMPLETED.
        reason = "REWARDS_PENDING"

    tasks = [{
        "id": option.id,
        "title": option.rendered_title,
        "title_i18n": {
            "ru": option.rendered_title,
            "en": option.mission.title_en or option.rendered_title,
        },
        "status": option.status,
        "xp": xp_by_option.get(option.id, 0),
    } for option in options]
    total_xp = sum(task["xp"] for task in tasks)

    # This is a replay projection ending at the current profile, not a claim
    # about the historic award balance. Read XP after the receipts so a freshly
    # committed reward cannot be paired with the user's earlier auth snapshot.
    current_xp = int(db.scalar(select(User.xp).where(User.id == user.id)) or 0)
    before = progression_from_xp(max(0, current_xp - total_xp))
    after = progression_from_xp(current_xp)
    levels = []
    threshold = before["lifetime_spent_threshold"]
    for level in range(before["level"], after["level"] + 1):
        end_xp = threshold + level_cost(level)
        levels.append({"level": level, "start_xp": threshold, "end_xp": end_xp})
        threshold = end_xp

    return {
        "board_id": board.id,
        "ready": reason is None,
        "reason": reason,
        "user": {"id": user.id, "display_name": user.display_name, "avatar_url": user.avatar_url},
        "attempts_used": board.attempts_used,
        "max_attempts": board.max_attempts,
        "tasks": tasks,
        "total_xp": total_xp,
        "progression": {"before": before, "after": after, "levels": levels},
    }
