from __future__ import annotations

from collections import Counter
from datetime import timezone
from statistics import median
from typing import Any, Literal

from sqlalchemy import case, select
from sqlalchemy.orm import Session, joinedload

from ..models import (
    BoardOption, ContractBoard, Evaluation, Match, MatchParticipant,
    MissionDefinition, RewardLedgerEntry, User,
)
from .adaptive_profile import _metric_values
from .match_trust import (
    independent_provider_parts, provider_has_client_source,
    provider_has_independent_source, provider_parts,
)
from .progression import TRUSTED_REWARD_SOURCES


ProgressMode = Literal["STANDARD", "RANKED", "STREET_BRAWL"]
ProgressIntent = Literal["PRACTICE", "EXPERIMENT", "RESULT", "VARIETY"]
MINIMUM_SAMPLE_SIZE = 8
RECENT_MATCH_LIMIT = 20
MODES = {"STANDARD", "RANKED", "STREET_BRAWL"}
INTENTS = {"PRACTICE", "EXPERIMENT", "RESULT", "VARIETY"}
ACTIVE_BOARD_STATES = ("LOCKED", "VERIFYING", "REVIEW_REQUIRED")
SOURCE_ORDER = ("INDEPENDENT_PROVIDER", "CLIENT_ATTESTED_GEP", "DEMO", "LEGACY", "UNKNOWN")
# Match normalization currently emits only this independent provider label.
INDEPENDENT_PROVIDERS = {"deadlock_api"}
METRIC_LABELS = {
    "player.kills": ("убийства", "kills"),
    "player.deaths": ("смерти", "deaths"),
    "player.assists": ("помощи", "assists"),
    "player.kda": ("KDA", "KDA"),
    "player.net_worth.final": ("итоговая стоимость", "final net worth"),
    "player.hero_damage": ("урон героям", "hero damage"),
    "player.object_damage": ("урон объектам", "object damage"),
    "player.healing": ("лечение", "healing"),
    "player.scoreboard_healing": ("лечение по итоговой таблице", "scoreboard healing"),
}
INTENT_KINDS = {
    "PRACTICE": ("BREAK_THE_HABIT", "CONSISTENCY", "MASTERY", "CHALLENGE", "WILDCARD", "COLD_START"),
    "EXPERIMENT": ("CHALLENGE", "MASTERY", "WILDCARD", "BREAK_THE_HABIT", "CONSISTENCY", "COLD_START"),
    "RESULT": ("MASTERY", "CHALLENGE", "CONSISTENCY", "BREAK_THE_HABIT", "WILDCARD", "COLD_START"),
    "VARIETY": ("WILDCARD", "CHALLENGE", "MASTERY", "CONSISTENCY", "BREAK_THE_HABIT", "COLD_START"),
}


def _source_kind(match: Match) -> str:
    parts = provider_parts(match.provider)
    if any(part in {"mock", "demo"} or part.startswith(("mock_", "demo_")) for part in parts):
        return "DEMO"
    raw_parts = {part.strip().lower() for part in str(match.provider or "").split("+") if part.strip()}
    independent_parts = independent_provider_parts(match.provider)
    has_independent_label = provider_has_independent_source(match.provider)
    client = provider_has_client_source(match.provider)
    # Older releases merged provider and client facts without per-field origin.
    # A mixed label therefore cannot prove independent verification.
    if (has_independent_label and client) or (
        raw_parts.intersection(INDEPENDENT_PROVIDERS) and not raw_parts.issubset(INDEPENDENT_PROVIDERS)
    ):
        return "LEGACY"
    if match.integrity_status == "CLIENT_ATTESTED_GEP":
        return "CLIENT_ATTESTED_GEP"
    if independent_parts and raw_parts.issubset(INDEPENDENT_PROVIDERS):
        return "INDEPENDENT_PROVIDER"
    if match.settlement_source == "LEGACY" or match.integrity_status == "LEGACY_DIAGNOSTIC":
        return "LEGACY" if match.settlement_source != "UNKNOWN" else "UNKNOWN"
    return "UNKNOWN"


def _sources(rows: list[tuple[Match, MatchParticipant]]) -> list[dict[str, Any]]:
    counts = Counter(_source_kind(match) for match, _ in rows)
    return [{"kind": kind, "count": counts[kind]} for kind in SOURCE_ORDER if counts[kind]]


def _values(match: Match, participant: MatchParticipant) -> dict[str, float]:
    values = _metric_values(match, participant)
    # The storage field is shared; expose its name for this mode, not two records.
    healing_metric = "player.scoreboard_healing" if match.game_match_mode == "STREET_BRAWL" else "player.healing"
    return {
        metric: value for metric, value in values.items()
        if value is not None and metric in METRIC_LABELS
        and (metric not in {"player.healing", "player.scoreboard_healing"} or metric == healing_metric)
    }


def _buckets(rows: list[tuple[Match, MatchParticipant]]) -> dict[str, list[float]]:
    buckets: dict[str, list[float]] = {}
    for match, participant in rows:
        for metric, value in _values(match, participant).items():
            buckets.setdefault(metric, []).append(value)
    return buckets


def _conditions(option: BoardOption) -> list[dict[str, Any]]:
    rows = option.conditions or [{"metric": option.metric, "operator": option.operator, "target": option.target}]
    return [{"metric": row["metric"], "operator": row["operator"], "target": row["target"]} for row in rows]


def _title(option: BoardOption, mission: MissionDefinition | None) -> dict[str, str]:
    return {"ru": option.rendered_title, "en": (mission.title_en if mission else None) or option.rendered_title}


def _goal(
    option: BoardOption, metrics: dict[str, list[float]], sample_size: int,
    *, locked: bool,
) -> dict[str, Any]:
    conditions = _conditions(option)
    adaptive = (option.generator_meta or {}).get("adaptive") or {}
    metadata_basis = {
        row.get("metric"): row for row in adaptive.get("basis", []) if isinstance(row, dict)
    }
    basis = []
    if sample_size >= MINIMUM_SAMPLE_SIZE and adaptive.get("enabled"):
        for condition in conditions:
            metric = condition["metric"]
            values = metrics.get(metric, [])
            metadata = metadata_basis.get(metric)
            if len(values) < MINIMUM_SAMPLE_SIZE or metadata is None:
                continue
            source = metadata.get("source")
            basis.append({
                "metric": metric, "n": len(values), "median": round(float(median(values)), 3),
                "target": condition["target"], "source": source if source in {"median", "p25", "p60", "p75"} else "median",
            })
    if locked:
        reason = {
            "ru": "Это уже подписанная цель. Условия сохранены.",
            "en": "This goal is already signed. Its conditions are preserved.",
        }
    elif basis:
        row = basis[0]
        labels = METRIC_LABELS[row["metric"]]
        reason = {
            "ru": f"В {row['n']} последних зачтённых матчах этого режима медиана ({labels[0]}) — {row['median']:g}. Предложенный порог — {row['target']:g}.",
            "en": f"Across {row['n']} recent scored matches in this mode, your median {labels[1]} is {row['median']:g}. The offered target is {row['target']:g}.",
        }
    else:
        reason = {
            "ru": f"Начальная общая цель. Для персональной рекомендации нужно минимум {MINIMUM_SAMPLE_SIZE} матчей с доступными показателями.",
            "en": f"A generic starting goal. Personal recommendations need at least {MINIMUM_SAMPLE_SIZE} matches with the relevant metrics available.",
        }
    # English template text can contain an old target. Render issued conditions.
    descriptions = []
    operators = {"gte": "≥", "lte": "≤", "eq": "=", ">=": "≥", "<=": "≤", "==": "="}
    for condition in conditions:
        label = METRIC_LABELS.get(condition["metric"], (condition["metric"], condition["metric"]))[1]
        descriptions.append(f"{label} {operators.get(condition['operator'], condition['operator'])} {condition['target']:g}")
    return {
        "option_id": option.id,
        "title_i18n": _title(option, option.mission),
        "description_i18n": {"ru": option.rendered_description, "en": "; ".join(descriptions)},
        "reward_xp": option.reward_xp, "status": option.status,
        "conditions": conditions, "basis": basis, "reason": reason,
        "personalized": bool(basis),
    }


def _option_order(option: BoardOption) -> tuple[float, str]:
    created_at = option.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.timestamp(), option.id


def _recommendation_key(
    option: BoardOption, intent: str, *, reference: BoardOption | None = None,
) -> tuple:
    kinds = INTENT_KINDS[intent]
    metadata = option.generator_meta or {}
    kind = (metadata.get("adaptive") or {}).get("kind", "COLD_START")
    priority = kinds.index(kind) if kind in kinds else len(kinds)
    conditions = _conditions(option)
    difficulty = {"LIGHT": 0, "FOCUSED": 1, "HARD": 2, "EXTREME": 3}.get(option.difficulty, 1)
    different_metric = reference is not None and option.metric != reference.metric
    different_category = reference is not None and option.category != reference.category
    # Cold-start generator metadata labels every slot alike. Intent can still
    # choose among issued targets using their existing structure and difficulty.
    if intent == "PRACTICE":
        structure = (difficulty, 0 if option.category in {"SURVIVAL", "SUPPORT"} else 1, len(conditions))
    elif intent == "EXPERIMENT":
        structure = (abs(difficulty - 2), 0 if different_metric else 1, -len(conditions))
    elif intent == "RESULT":
        structure = (
            0 if any(row["metric"] == "match.win" for row in conditions) else 1,
            0 if option.category == "COMBAT" else 1, -len(conditions),
        )
    else:
        structure = (
            0 if metadata.get("slot") == 4 else 1,
            0 if different_category else 1, 0 if different_metric else 1, difficulty,
        )
    return (priority, *structure, *_option_order(option))


def _confidence(sample_size: int) -> str:
    if sample_size < MINIMUM_SAMPLE_SIZE:
        return "COLD_START"
    if sample_size < 10:
        return "LOW"
    return "MEDIUM" if sample_size < 15 else "HIGH"


def _debrief(
    rows: list[tuple[Match, MatchParticipant]],
    evaluations: dict[tuple[str, str], tuple[Evaluation, BoardOption, MissionDefinition]],
    awarded_match: dict[str, str], xp: dict[str, int],
) -> dict[str, Any] | None:
    if not rows:
        return None
    latest, participant = rows[0]
    source = _source_kind(latest)
    prior = [row for row in rows[1:] if _source_kind(row[0]) == source]
    same_hero = [row for row in prior if participant.hero_id is not None and row[1].hero_id == participant.hero_id]
    baseline = same_hero if len(same_hero) >= MINIMUM_SAMPLE_SIZE else prior
    scope = "SAME_HERO" if len(same_hero) >= MINIMUM_SAMPLE_SIZE else ("SAME_MODE" if baseline else "NONE")
    buckets = _buckets(baseline)
    comparisons = []
    for metric, current in _values(latest, participant).items():
        values = buckets.get(metric, [])
        if len(values) < MINIMUM_SAMPLE_SIZE:
            comparisons.append({
                "metric": metric, "current": current, "median": None,
                "delta": None, "n": len(values), "improved": False,
            })
            continue
        usual = float(median(values))
        comparisons.append({
            "metric": metric, "current": current, "median": round(usual, 3),
            "delta": round(current - usual, 3), "n": len(values),
            "improved": current < usual if metric == "player.deaths" else current > usual,
        })
    contracts = []
    for (assignment_id, match_id), (evaluation, option, mission) in sorted(evaluations.items()):
        if match_id != latest.id:
            continue
        contracts.append({
            "assignment_id": assignment_id, "title_i18n": _title(option, mission),
            "status": evaluation.status,
            "reward_granted_xp": xp.get(assignment_id, 0) if awarded_match.get(assignment_id) == latest.id else 0,
            "explanation": evaluation.explanation,
        })
    played_at = latest.ended_at or latest.started_at
    return {
        "match_id": str(latest.external_match_id), "hero_id": participant.hero_id,
        "played_at": played_at.isoformat() if played_at else None, "source": source,
        "baseline_sample_size": len(baseline), "baseline_scope": scope,
        "comparisons": comparisons, "contracts": contracts,
        "xp_granted": sum(contract["reward_granted_xp"] for contract in contracts),
    }


def _heroes(
    recent: list[tuple[Match, MatchParticipant]],
    evaluations: dict[tuple[str, str], tuple[Evaluation, BoardOption, MissionDefinition]],
    awarded_match: dict[str, str],
) -> list[dict[str, Any]]:
    grouped: dict[int, list[tuple[Match, MatchParticipant]]] = {}
    for row in recent:
        if row[1].hero_id is not None:
            grouped.setdefault(row[1].hero_id, []).append(row)
    heroes = []
    for hero_id, rows in grouped.items():
        match_ids = {match.id for match, _ in rows}
        completed = {
            assignment_id for (assignment_id, match_id), (evaluation, _, __) in evaluations.items()
            if match_id in match_ids and evaluation.status == "COMPLETED"
            and awarded_match.get(assignment_id) == match_id
        }
        records = [{
            "metric": metric,
            "value": min(values) if metric == "player.deaths" else max(values),
        } for metric, values in _buckets(rows).items()]
        heroes.append({
            "hero_id": hero_id, "matches": len(rows), "contracts_completed": len(completed),
            "records": records, "sources": _sources(rows),
        })
    return sorted(heroes, key=lambda row: (-row["matches"], row["hero_id"]))


def build_personal_progress(
    db: Session, user: User, mode: str, intent: str = "PRACTICE"
) -> dict[str, Any]:
    """Private, read-only projection of issued goals and the last 20 results.

    One extra eligible match supplies a prior-only baseline of up to 20 games.
    Rewards are attributed to the final completion match, never each attempt.
    """
    if mode not in MODES or intent not in INTENTS:
        raise ValueError("Unsupported personal progress mode or intent")
    with db.no_autoflush:
        rows = list(db.execute(
            select(Match, MatchParticipant)
            .join(MatchParticipant, MatchParticipant.match_id == Match.id)
            .where(
                MatchParticipant.account_id == user.account_id,
                Match.game_match_mode == mode, Match.is_final.is_(True),
                Match.scoring_status == "SCORED",
            )
            .order_by(Match.started_at.desc().nullslast(), Match.created_at.desc(), Match.id.desc())
            .limit(RECENT_MATCH_LIMIT + 1)
        ).all()) if user.account_id is not None else []
        board = db.execute(
            select(ContractBoard)
            .options(joinedload(ContractBoard.options).joinedload(BoardOption.mission))
            .where(ContractBoard.user_id == user.id, ContractBoard.game_match_mode == mode)
            .order_by(
                case((ContractBoard.status.in_(ACTIVE_BOARD_STATES), 0), else_=1),
                ContractBoard.board_date.desc(), ContractBoard.created_at.desc(), ContractBoard.id.desc(),
            ).limit(1)
        ).unique().scalar_one_or_none()
        evidence = list(db.execute(
            select(Evaluation, BoardOption, MissionDefinition)
            .join(BoardOption, Evaluation.assignment_id == BoardOption.id)
            .join(ContractBoard, BoardOption.board_id == ContractBoard.id)
            .join(MissionDefinition, BoardOption.mission_definition_id == MissionDefinition.id)
            .where(
                ContractBoard.user_id == user.id, ContractBoard.game_match_mode == mode,
                BoardOption.selected.is_(True), Evaluation.match_id.in_([match.id for match, _ in rows]),
            )
            .order_by(Evaluation.revision.desc(), Evaluation.created_at.desc(), Evaluation.id.desc())
        ).all()) if rows else []
        evaluations: dict[tuple[str, str], tuple[Evaluation, BoardOption, MissionDefinition]] = {}
        by_id = {evaluation.id: evaluation for evaluation, _, __ in evidence}
        options: dict[str, BoardOption] = {}
        for evaluation, option, mission in evidence:
            evaluations.setdefault((option.id, evaluation.match_id), (evaluation, option, mission))
            options[option.id] = option
        ledger = list(db.scalars(
            select(RewardLedgerEntry).where(
                RewardLedgerEntry.user_id == user.id, RewardLedgerEntry.source_id.in_(options),
                RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES), RewardLedgerEntry.asset == "XP",
            )
        ).all()) if options else []

    match_order = {match.id: index for index, (match, _) in enumerate(rows)}
    awarded_match: dict[str, str] = {}
    for assignment_id, option in options.items():
        if option.final_evaluation_id:
            final = by_id.get(option.final_evaluation_id)
            if final and final.assignment_id == assignment_id:
                awarded_match[assignment_id] = final.match_id
        elif option.status == "COMPLETED":
            completed = [
                match_id for (item_id, match_id), (evaluation, _, __) in evaluations.items()
                if item_id == assignment_id and evaluation.status == "COMPLETED"
            ]
            if completed:
                awarded_match[assignment_id] = option.bound_match_id if option.bound_match_id in completed else min(completed, key=match_order.get)
    xp: dict[str, int] = {}
    for entry in ledger:
        xp[entry.source_id] = xp.get(entry.source_id, 0) + int(entry.delta)
    recent = rows[:RECENT_MATCH_LIMIT]
    goals = []
    if board:
        if board.status == "OFFERED":
            offered = [
                option for option in board.options
                if option.status == "OFFERED" and option.required_game_match_mode == mode
            ]
            reference = min(offered, key=lambda option: _recommendation_key(option, "PRACTICE")) if offered else None
            choices = sorted(offered, key=lambda option: _recommendation_key(option, intent, reference=reference))[:3]
        else:
            choices = sorted(
                (option for option in board.options if option.selected),
                key=lambda option: (option.status not in ACTIVE_BOARD_STATES, _option_order(option)),
            )[:1]
        metrics = _buckets(recent)
        goals = [_goal(option, metrics, len(recent), locked=board.status != "OFFERED") for option in choices]
    return {
        "version": "personal-progress-1",
        "mode": mode,
        "intent": intent,
        "sample_size": len(recent),
        "minimum_sample_size": MINIMUM_SAMPLE_SIZE,
        "confidence": _confidence(len(recent)),
        "sources": _sources(recent),
        "board": {"id": board.id, "status": board.status, "generation": board.generation} if board else None,
        "goal": goals[0] if goals else None,
        "alternatives": goals[1:],
        "debrief": _debrief(rows, evaluations, awarded_match, xp),
        "heroes": _heroes(recent, evaluations, awarded_match),
    }
