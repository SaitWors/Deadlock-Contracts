from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AutoReviewCase, BoardOption, ContractBoard, Evaluation, Match, MatchParticipant, OutboxEvent, utcnow
from .jobs import enqueue_job

FINAL_STATUSES = {"COMPLETED", "FAILED", "EXPIRED", "VOID"}


@dataclass
class EvaluationResult:
    status: str
    current: float | None
    target: float | None
    score: float | None
    explanation: str
    facts: list[dict]


def _metric_value(metric: str, match: Match, participant: MatchParticipant) -> float | None:
    values = {
        "match.win": 1.0 if participant.won is True else (0.0 if participant.won is False else None),
        "match.duration_s": float(match.duration_s) if match.duration_s is not None else None,
        "player.kills": float(participant.kills) if participant.kills is not None else None,
        "player.deaths": float(participant.deaths) if participant.deaths is not None else None,
        "player.assists": float(participant.assists) if participant.assists is not None else None,
        "player.net_worth.final": float(participant.net_worth) if participant.net_worth is not None else None,
        "player.hero_damage": float(participant.hero_damage) if participant.hero_damage is not None else None,
        "player.object_damage": float(participant.object_damage) if participant.object_damage is not None else None,
        "player.healing": float(participant.healing) if participant.healing is not None else None,
        "player.scoreboard_healing": float(participant.healing) if participant.healing is not None else None,
    }
    if metric == "player.kda":
        if participant.kills is None or participant.deaths is None or participant.assists is None:
            return None
        return (participant.kills + participant.assists) / max(1, participant.deaths)
    return values.get(metric)


def _compare(operator: str, current: float, target: float) -> bool:
    if operator == "gte":
        return current >= target
    if operator == "lte":
        return current <= target
    if operator == "eq":
        return current == target
    raise ValueError(f"Unsupported operator: {operator}")


def _display_metric(metric: str, value: float) -> str:
    if metric == "match.win":
        return "победа" if value >= 1 else "поражение"
    if metric == "match.duration_s":
        minutes = value / 60
        text = f"{minutes:.1f}".rstrip("0").rstrip(".")
        return f"{text} мин"
    if metric == "player.kda":
        return f"{value:.2f}".rstrip("0").rstrip(".") + " KDA"
    integer = f"{value:,.0f}".replace(",", " ")
    units = {
        "player.kills": "киллов",
        "player.deaths": "смертей",
        "player.assists": "ассистов",
        "player.net_worth.final": "душ",
        "player.hero_damage": "урона героям",
        "player.object_damage": "урона объектам",
        "player.healing": "лечения",
        "player.scoreboard_healing": "лечения по итоговой таблице",
    }
    return f"{integer} {units.get(metric, '')}".strip()


def _condition_rows(option: BoardOption) -> list[dict]:
    rows = [item for item in (option.conditions or []) if isinstance(item, dict)]
    if rows:
        return rows
    return [{
        "metric": option.metric,
        "operator": option.operator,
        "target": option.target,
        "capabilities": list(option.required_capabilities or []),
    }]


def _legacy_street_brawl_healing_alias(
    option: BoardOption,
    match: Match,
    capability: str,
) -> bool:
    """Resolve pre-alpha.2 Brawl healing snapshots without changing history.

    Older locked options called the GEP roster value ``player.healing`` and
    required ``summary.healing``.  The value is the final scoreboard healing
    aggregate, not Deadlock API's teammate-only healing field.  Keep the old
    immutable option snapshot, but allow this one explicit semantic alias only
    for a strongly finalized Street Brawl GEP match.
    """
    if capability != "summary.healing":
        return False
    if str(getattr(match, "game_match_mode", "") or "").upper() != "STREET_BRAWL":
        return False
    if "gep_fallback" not in str(getattr(match, "provider", "") or "").lower():
        return False
    if "gep.scoreboard_healing" not in set(getattr(match, "capabilities", None) or []):
        return False

    for condition in _condition_rows(option):
        if str(condition.get("metric") or "") != "player.healing":
            continue
        condition_caps = {str(item) for item in (condition.get("capabilities") or [])}
        if "summary.healing" in condition_caps:
            return True
    return (
        str(getattr(option, "metric", "") or "") == "player.healing"
        and "summary.healing" in set(getattr(option, "required_capabilities", None) or [])
    )


def capability_available(option: BoardOption, match: Match, capability: str) -> bool:
    if capability in set(getattr(match, "capabilities", None) or []):
        return True
    return _legacy_street_brawl_healing_alias(option, match, capability)


def _unverifiable(option: BoardOption, explanation: str) -> EvaluationResult:
    count = len(_condition_rows(option))
    target = float(count) if count > 1 else option.target
    return EvaluationResult("UNVERIFIABLE", None, target, None, explanation, [])


def _ratio(operator: str, current: float, target: float) -> float:
    if operator == "lte":
        return 1.0 if current <= target else max(0.0, target / max(current, 1.0))
    if operator == "eq":
        return 1.0 if current == target else 0.0
    return current / target if target else 1.0


def _has_trusted_finality(match: Match) -> bool:
    if not getattr(match, "is_final", False):
        return False
    raw_value = getattr(match, "raw_summary", None)
    raw = raw_value if isinstance(raw_value, dict) else {}
    gep_final = raw.get("companion_finalization")
    if isinstance(gep_final, dict) and gep_final.get("trusted") is True:
        # rc3/rc4 marked outcome-only snapshots trusted. Reject that legacy
        # weak signal: Deadlock GEP can retain the previous match outcome after
        # a new current Match ID is already active. Only lifecycle finality is
        # strong enough for GEP fallback scoring.
        signal = str(gep_final.get("signal") or "").strip().lower()
        if signal in {"match_end", "postgame", "end", "session_end"}:
            return True
    # A bounded persisted duration together with is_final is also strong
    # integrity evidence for legacy/provider matches.
    if getattr(match, "duration_s", None) is not None:
        return True
    # Deadlock API/history is a final post-match source.  The special
    # gep_fallback source, however, is accepted only with the explicit GEP
    # finalization marker above.
    provider = str(getattr(match, "provider", "") or "").lower()
    return bool(provider and "gep_fallback" not in provider)


def _result(option: BoardOption, match: Match, participant: MatchParticipant | None) -> EvaluationResult:
    if participant is None:
        return _unverifiable(option, "Игрок не найден в составе матча.")
    if not _has_trusted_finality(match):
        return _unverifiable(option, "Матч ещё не получил надёжный сигнал завершения.")
    minimum = 180 if option.required_game_match_mode == "STREET_BRAWL" else settings.min_match_duration_seconds
    if match.duration_s is not None and match.duration_s < minimum:
        return _unverifiable(option, "Длительность матча не проходит минимальную проверку целостности.")
    if match.game_match_mode == "UNKNOWN":
        return _unverifiable(option, "Не удалось надёжно определить режим матча.")
    if match.game_match_mode != option.required_game_match_mode:
        return _unverifiable(option, f"MODE_MISMATCH: ожидался {option.required_game_match_mode}, получен {match.game_match_mode}.")
    if match.scoring_status != "SCORED":
        return _unverifiable(option, f"Матч имеет статус {match.scoring_status}; требуется внутреннее решение.")

    conditions = _condition_rows(option)
    required = set(option.required_capabilities or [])
    for condition in conditions:
        required.update(str(item) for item in (condition.get("capabilities") or []))
    missing = sorted(
        capability
        for capability in required
        if not capability_available(option, match, capability)
    )
    if missing:
        return _unverifiable(option, "Недостаточно итоговых данных: " + ", ".join(missing))

    facts: list[dict] = []
    explanations: list[str] = []
    ratios: list[float] = []
    passed_count = 0
    for condition in conditions:
        metric = str(condition.get("metric") or "")
        operator = str(condition.get("operator") or "")
        try:
            target = float(condition.get("target"))
        except (TypeError, ValueError):
            return _unverifiable(option, f"Некорректная цель Contracts 2.0 для {metric}.")
        current = _metric_value(metric, match, participant)
        if current is None:
            return _unverifiable(option, f"Источник не предоставил метрику {metric}; ноль не подставлялся.")
        passed = _compare(operator, current, target)
        if passed:
            passed_count += 1
        ratio = max(0.0, min(1.0, _ratio(operator, current, target)))
        ratios.append(ratio)
        symbol = {"gte": "≥", "lte": "≤", "eq": "="}[operator]
        explanations.append(f"{_display_metric(metric, current)} / {symbol} {_display_metric(metric, target)}")
        fact = {"metric": metric, "operator": operator, "target": target, "value": current, "passed": passed}
        if metric == "player.healing" and _legacy_street_brawl_healing_alias(option, match, "summary.healing"):
            fact["source_capability"] = "gep.scoreboard_healing"
            fact["semantic_compatibility"] = "street_brawl_legacy_healing"
        facts.append(fact)

    all_passed = passed_count == len(conditions)
    status = "COMPLETED" if all_passed else "FAILED"
    if len(conditions) == 1:
        current_value = float(facts[0]["value"])
        target_value = float(facts[0]["target"])
        explanation = f"Факт: {explanations[0]}."
    else:
        current_value = float(passed_count)
        target_value = float(len(conditions))
        explanation = f"Составной контракт: выполнено {passed_count}/{len(conditions)} условий. " + "; ".join(explanations) + "."
    score = (min(ratios) if ratios else 0.0) * 100
    return EvaluationResult(status, current_value, target_value, score, explanation, facts)

def _ensure_review_case(db: Session, board: ContractBoard, match: Match, reasons: list[dict]) -> AutoReviewCase:
    item = db.scalar(select(AutoReviewCase).where(AutoReviewCase.board_id == board.id, AutoReviewCase.match_id == match.id))
    context = {
        "external_match_id": match.external_match_id,
        "game_match_mode": match.game_match_mode,
        "provider_mode_raw": match.provider_mode_raw,
        "mode_confidence": match.mode_confidence,
        "scoring_status": match.scoring_status,
        "capabilities": list(match.capabilities or []),
    }
    if not item:
        item = AutoReviewCase(board_id=board.id, user_id=board.user_id, match_id=match.id, reasons=reasons, context=context, status="PENDING")
        db.add(item)
        db.flush()
        db.add(
            OutboxEvent(
                event_type="auto_review.requested",
                aggregate_id=item.id,
                payload={
                    "review_id": item.id,
                    "board_id": board.id,
                    "user_id": board.user_id,
                    "external_match_id": match.external_match_id,
                    "mode": board.game_match_mode,
                    "reason_count": len(reasons),
                },
            )
        )
    else:
        item.reasons = reasons
        item.context = context
        if item.status not in {"RESOLVED", "REJECTED"}:
            item.status = "PENDING"
    return item


def evaluate_board(
    db: Session,
    board_id: str,
    match_id: str,
    *,
    option_ids: set[str] | None = None,
) -> int:
    board = db.scalar(
        select(ContractBoard)
        .where(ContractBoard.id == board_id)
        .with_for_update()
    )

    match = db.get(Match, match_id)

    if not board or not match:
        raise ValueError("Board or match not found")

    participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == board.user.account_id,
        )
    )

    processed = 0
    review_reasons: list[dict] = []

    options = list(
        db.scalars(
            select(BoardOption)
            .where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
            .with_for_update()
        ).all()
    )

    attempt_no = max(1, int(board.attempts_used or 1))
    max_attempts = max(1, int(board.max_attempts or 3))
    attempts_left = max(0, max_attempts - attempt_no)

    for option in options:
        if option.status in FINAL_STATUSES:
            continue
        if option_ids is not None and option.id not in option_ids:
            continue

        result = _result(option, match, participant)

        revision = (
            db.scalar(
                select(func.max(Evaluation.revision)).where(
                    Evaluation.assignment_id == option.id
                )
            )
            or 0
        ) + 1

        evaluation_status = (
            "REVIEW_REQUIRED"
            if result.status == "UNVERIFIABLE"
            else result.status
        )

        explanation = result.explanation

        retryable_failure = (
            result.status == "FAILED"
            and attempt_no < max_attempts
        )

        if retryable_failure:
            explanation = (
                f"Попытка {attempt_no}/{max_attempts}: "
                f"{result.explanation} "
                f"Осталось попыток: {attempts_left}."
            )

        evaluation = Evaluation(
            assignment_id=option.id,
            match_id=match.id,
            revision=revision,
            status=evaluation_status,
            evidence_level=(
                "VERIFIED_SUMMARY"
                if result.status != "UNVERIFIABLE"
                else "NEEDS_INTERNAL_REVIEW"
            ),
            evaluator_version=settings.evaluator_version,
            progress_current=result.current,
            progress_target=result.target,
            score=result.score,
            explanation=explanation,
            facts=result.facts,
        )

        db.add(evaluation)
        db.flush()

        option.final_evaluation_id = evaluation.id
        option.progress_current = result.current
        option.progress_target = result.target
        option.explanation = explanation

        if result.status == "UNVERIFIABLE":
            option.status = "REVIEW_REQUIRED"
            option.settled_at = None

            review_reasons.append(
                {
                    "option_id": option.id,
                    "title": option.rendered_title,
                    "metric": option.metric,
                    "reason": result.explanation,
                }
            )

        elif retryable_failure:
            # Evaluation хранит неудачную попытку,
            # а сам контракт остаётся активным.
            option.status = "LOCKED"
            option.bound_match_id = None
            option.settled_at = None

        else:
            # COMPLETED либо финальный FAILED после последней попытки.
            option.status = result.status
            option.settled_at = utcnow()

            db.add(
                OutboxEvent(
                    event_type="assignment.settled",
                    aggregate_id=option.id,
                    payload={
                        "assignment_id": option.id,
                        "board_id": board.id,
                        "user_id": board.user_id,
                        "status": result.status,
                        "reward_xp": (
                            option.reward_xp
                            if result.status == "COMPLETED"
                            else 0
                        ),
                        "evaluation_id": evaluation.id,
                        "match_id": match.id,
                    },
                )
            )

        processed += 1

    # Если раньше был REVIEW_REQUIRED, но повторная загрузка metadata
    # теперь дала результат — старую внутреннюю заявку закрываем.
    if not review_reasons:
        stale_review = db.scalar(
            select(AutoReviewCase).where(
                AutoReviewCase.board_id == board.id,
                AutoReviewCase.match_id == match.id,
            )
        )

        if stale_review and stale_review.status in {"PENDING", "NEEDS_INFO", "WAITING_PROVIDER"}:
            stale_review.status = "RESOLVED"
            stale_review.reviewer_note = (
                "Закрыто автоматически после повторной "
                "загрузки итоговой статистики."
            )
            stale_review.reviewed_at = utcnow()

    waiting_on_this_match = any(
        option.status == "VERIFYING" and option.bound_match_id == match.id
        for option in options
    )

    if waiting_on_this_match:
        # Partial settlement: one assignment may still wait for a provider-only
        # fact while unrelated assignments from the same match are already
        # completed or released for the next gameplay attempt.
        board.status = "VERIFYING"

    elif review_reasons:
        _ensure_review_case(
            db,
            board,
            match,
            review_reasons,
        )

        board.status = "REVIEW_REQUIRED"

    elif any(option.status == "REVIEW_REQUIRED" for option in options):
        board.status = "REVIEW_REQUIRED"

    elif options and all(
        option.status in FINAL_STATUSES
        for option in options
    ):
        board.status = "SETTLED"

    elif attempt_no < max_attempts:
        # Есть невыполненные контракты и ещё остались матчи.
        board.status = "LOCKED"

        board.baseline_match_id = max(
            int(board.baseline_match_id or 0),
            int(match.external_match_id),
        )

        db.commit()

        enqueue_job(
            db,
            "discover_match",
            {"board_id": board.id},
            f"discover:{board.id}:attempt:{attempt_no + 1}",
            max_attempts=settings.max_discovery_attempts,
        )

        return processed

    else:
        board.status = "SETTLED"

    db.commit()

    return processed
