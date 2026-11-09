"""Stable receipts for a settled case's already credited XP.

Only settlement delivery saves a receipt. Reads never award XP, advance the
case, or infer an old starting balance from the player's current profile.
"""
from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from ..models import BoardOption, ContractBoard, RewardLedgerEntry, User
from .progression import TRUSTED_REWARD_SOURCES, level_cost, progression_from_xp


FINAL_TASK_STATUSES = frozenset({"COMPLETED", "FAILED", "VOID", "EXPIRED"})


def _result(db: Session, board: ContractBoard, *, captured_xp: int | None = None) -> dict:
    options = list(db.scalars(
        select(BoardOption)
        .options(selectinload(BoardOption.mission))
        .where(BoardOption.board_id == board.id, BoardOption.selected.is_(True))
        .order_by(BoardOption.created_at, BoardOption.id)
    ).all())
    completed_ids = [option.id for option in options if option.status == "COMPLETED"]
    rewards = list(db.scalars(select(RewardLedgerEntry).where(
        RewardLedgerEntry.user_id == board.user_id,
        RewardLedgerEntry.source_id.in_(completed_ids),
        RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES),
        RewardLedgerEntry.asset == "XP",
        RewardLedgerEntry.delta > 0,
    ).order_by(RewardLedgerEntry.created_at, RewardLedgerEntry.id)).all()) if completed_ids else []
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

    # A positive delta and its recorded balance are the historical evidence.
    # Require one unambiguous receipt per rewarded task and a contiguous chain
    # with no other XP activity between the first and last case receipt.
    replayable = bool(rewards) and len({reward.source_id for reward in rewards}) == len(rewards)
    previous_balance = None
    for reward in rewards:
        starting_balance = int(reward.balance_after) - int(reward.delta)
        if starting_balance < 0 or (previous_balance is not None and starting_balance != previous_balance):
            replayable = False
        previous_balance = int(reward.balance_after)
    if replayable and len(rewards) > 1:
        first, last = rewards[0], rewards[-1]
        activity = db.scalars(select(RewardLedgerEntry).where(
            RewardLedgerEntry.user_id == board.user_id,
            RewardLedgerEntry.asset == "XP",
            RewardLedgerEntry.created_at >= first.created_at,
            RewardLedgerEntry.created_at <= last.created_at,
        ).order_by(RewardLedgerEntry.created_at, RewardLedgerEntry.id)).all()
        start = next(index for index, entry in enumerate(activity) if entry.id == first.id)
        end = next(index for index, entry in enumerate(activity) if entry.id == last.id)
        interval = activity[start:end + 1]
        replayable = [entry.id for entry in interval] == [entry.id for entry in rewards]

    before = None
    after = None
    if replayable:
        before = progression_from_xp(int(rewards[0].balance_after) - int(rewards[0].delta))
        after = progression_from_xp(int(rewards[-1].balance_after))
    elif captured_xp is not None:
        after = progression_from_xp(captured_xp)
        if total_xp == 0:
            # A newly settled failure/zero-XP case still has a known final
            # balance, so its outcome panels can play without moving XP.
            before = after.copy()
            replayable = True
    elif rewards:
        # Historical ambiguity permits a static final receipt, never an
        # invented animation from the current profile minus the case reward.
        after = progression_from_xp(int(rewards[-1].balance_after))

    levels = []
    if before is not None and after is not None:
        threshold = before["lifetime_spent_threshold"]
        for level in range(before["level"], after["level"] + 1):
            end_xp = threshold + level_cost(level)
            levels.append({"level": level, "start_xp": threshold, "end_xp": end_xp})
            threshold = end_xp

    return {
        "board_id": board.id,
        "ready": reason is None,
        "reason": reason,
        "replayable": reason is None and replayable,
        "result_source": "saved" if captured_xp is not None else ("ledger" if rewards else "legacy"),
        "attempts_used": board.attempts_used,
        "max_attempts": board.max_attempts,
        "tasks": tasks,
        "total_xp": total_xp,
        "progression": {"before": before, "after": after, "levels": levels},
    }


def maybe_capture_result(db: Session, board_id: str) -> dict | None:
    """Save the first ready result inside the existing settlement transaction.

    The caller owns commit/rollback. A row lock serializes PostgreSQL workers;
    the NULL condition also prevents a stale session from replacing a receipt.
    """
    db.flush()
    board = db.scalar(select(ContractBoard).where(ContractBoard.id == board_id)
                      .with_for_update().execution_options(populate_existing=True))
    if board is None:
        return None
    if board.completion_result is not None:
        return board.completion_result
    current_xp = db.scalar(select(User.xp).where(User.id == board.user_id))
    if current_xp is None:
        return None
    result = _result(db, board, captured_xp=int(current_xp))
    if not result["ready"]:
        return None
    db.execute(update(ContractBoard).where(
        ContractBoard.id == board.id,
        ContractBoard.completion_result.is_(None),
    ).values(completion_result=result))
    db.refresh(board, attribute_names=["completion_result"])
    return board.completion_result


def case_completion(db: Session, user: User, board_id: str) -> dict | None:
    board = db.scalar(select(ContractBoard).where(
        ContractBoard.id == board_id,
        ContractBoard.user_id == user.id,
    ))
    if board is None:
        return None
    result = board.completion_result if board.completion_result is not None else _result(db, board)
    return {
        **result,
        "user": {"id": user.id, "display_name": user.display_name, "avatar_url": user.avatar_url},
    }
