"""Cosmetic achievements derived from awarded, settled contracts.

No client claims, extra XP, or writes on reads. Corrected verdicts are reflected
immediately. Each assignment counts once, regardless of ledger revisions.
"""
from __future__ import annotations

from datetime import timezone
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from ..models import BoardOption, ContractBoard, RewardLedgerEntry
from .leaderboard import TRUSTED_REWARD_SOURCES, _gep_attested_assignment_ids

CATALOG = (
    ("first_case", "Первое дело", "First case", "Завершите 1 контракт", "Complete 1 contract", 1, "completed"),
    ("ten_cases", "Штатный оперативник", "Regular operative", "Завершите 10 контрактов", "Complete 10 contracts", 10, "completed"),
    ("fifty_cases", "Хранитель архива", "Archive keeper", "Завершите 50 контрактов", "Complete 50 contracts", 50, "completed"),
    ("hard_cases", "Особое поручение", "Special assignment", "Завершите 3 сложных или экстремальных контракта", "Complete 3 hard or extreme contracts", 3, "hard"),
    ("extreme_case", "За гранью допуска", "Beyond clearance", "Завершите 1 экстремальный контракт", "Complete 1 extreme contract", 1, "extreme"),
    ("rare_cases", "Редкая коллекция", "Rare collection", "Завершите 3 редких или эпических контракта", "Complete 3 rare or epic contracts", 3, "rare"),
    ("three_modes", "Город без границ", "City without borders", "Завершите контракт в каждом из 3 режимов", "Complete a contract in each of the 3 modes", 3, "modes"),
    ("four_categories", "Мастер своего дела", "Master of the craft", "Завершите контракты всех 4 категорий", "Complete contracts in all 4 categories", 4, "categories"),
)


def awarded_contract_filter(user_id: str):
    return exists(select(RewardLedgerEntry.id).where(
        RewardLedgerEntry.user_id == user_id,
        RewardLedgerEntry.source_id == BoardOption.id,
        RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES),
        RewardLedgerEntry.asset == "XP",
        RewardLedgerEntry.delta > 0,
    ))


def achievement_collection(db: Session, user_id: str) -> dict:
    statement = select(BoardOption, ContractBoard.game_match_mode).join(
        ContractBoard, ContractBoard.id == BoardOption.board_id
    ).where(
        ContractBoard.user_id == user_id,
        BoardOption.selected.is_(True),
        BoardOption.status == "COMPLETED",
        BoardOption.settled_at.is_not(None),
        awarded_contract_filter(user_id),
    ).order_by(BoardOption.settled_at, BoardOption.id)
    excluded = _gep_attested_assignment_ids(db, [user_id])
    if excluded:
        statement = statement.where(BoardOption.id.not_in(excluded))
    dates: dict[str, list] = {key: [] for key in ("completed", "hard", "extreme", "rare", "modes", "categories")}
    modes, categories = set(), set()
    for option, mode in db.execute(statement):
        at = option.settled_at.replace(tzinfo=timezone.utc) if option.settled_at.tzinfo is None else option.settled_at
        dates["completed"].append(at)
        for key, matches in (
            ("hard", option.difficulty in {"HARD", "EXTREME"}),
            ("extreme", option.difficulty == "EXTREME"),
            ("rare", option.rarity in {"RARE", "EPIC"}),
        ):
            if matches:
                dates[key].append(at)
        if mode in {"STANDARD", "RANKED", "STREET_BRAWL"} and mode not in modes:
            dates["modes"].append(at)
            modes.add(mode)
        if option.category in {"COMBAT", "SUPPORT", "ECONOMY", "SURVIVAL"} and option.category not in categories:
            dates["categories"].append(at)
            categories.add(option.category)
    items = []
    for key, ru, en, rule_ru, rule_en, target, metric in CATALOG:
        earned = len(dates[metric]) >= target
        items.append({
            "id": key, "title": {"ru": ru, "en": en},
            "description": {"ru": rule_ru, "en": rule_en},
            "current": min(len(dates[metric]), target), "target": target,
            "earned": earned, "earned_at": dates[metric][target - 1].isoformat() if earned else None,
        })
    from .bureau_operations import collection
    items.extend(collection(db, user_id))
    return {"items": items, "earned": sum(item["earned"] for item in items), "total": len(items)}
