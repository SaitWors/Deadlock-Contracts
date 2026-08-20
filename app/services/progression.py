from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import BoardOption, ContractBoard, User
from .boards import GAME_MODES

DIFFICULTY_ORDER = {"LIGHT": 1, "FOCUSED": 2, "HARD": 3, "EXTREME": 4}


def level_cost(level: int) -> int:
    return 100 + 25 * level + 5 * level * level


def progression_from_xp(total_xp: int) -> dict:
    level = 1
    remaining = max(0, int(total_xp))
    spent = 0
    while level < 500:
        cost = level_cost(level)
        if remaining < cost:
            break
        remaining -= cost
        spent += cost
        level += 1
    next_cost = level_cost(level)
    return {
        "level": level,
        "total_xp": int(total_xp),
        "level_xp": remaining,
        "next_level_xp": next_cost,
        "xp_to_next": max(0, next_cost - remaining),
        "progress_pct": round((remaining / next_cost) * 100, 1) if next_cost else 100.0,
        "lifetime_spent_threshold": spent,
    }


def user_progression(db: Session, user: User) -> dict:
    options = list(
        db.scalars(
            select(BoardOption)
            .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
            .where(ContractBoard.user_id == user.id, BoardOption.selected.is_(True))
        ).all()
    )
    boards_by_id = {
        board.id: board
        for board in db.scalars(select(ContractBoard).where(ContractBoard.user_id == user.id)).all()
    }
    completed = [item for item in options if item.status == "COMPLETED"]
    failed = [item for item in options if item.status == "FAILED"]
    review = [item for item in options if item.status == "REVIEW_REQUIRED"]
    mode_stats = {}
    for mode in GAME_MODES:
        mode_items = [item for item in options if boards_by_id.get(item.board_id) and boards_by_id[item.board_id].game_match_mode == mode]
        mode_stats[mode] = {
            "completed": sum(1 for item in mode_items if item.status == "COMPLETED"),
            "failed": sum(1 for item in mode_items if item.status == "FAILED"),
            "attempted": len(mode_items),
            "xp": sum(item.reward_xp for item in mode_items if item.status == "COMPLETED"),
        }
    hardest = None
    if completed:
        hardest_item = max(completed, key=lambda item: (DIFFICULTY_ORDER.get(item.difficulty, 0), item.reward_xp))
        hardest = {"title": hardest_item.rendered_title, "difficulty": hardest_item.difficulty, "reward_xp": hardest_item.reward_xp}
    base = progression_from_xp(user.xp)
    base.update(
        {
            "contracts_completed": len(completed),
            "contracts_failed": len(failed),
            "review_pending": len(review),
            "mode_stats": mode_stats,
            "hardest_completed": hardest,
        }
    )
    return base
