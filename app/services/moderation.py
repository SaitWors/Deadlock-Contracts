from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..models import (
    AuditLog,
    AutoReviewCase,
    BoardOption,
    ContractBoard,
    Evaluation,
    Job,
    Match,
    OutboxEvent,
    User,
)
from .jobs import enqueue_job
from .review_claims import assert_review_claim, clear_review_claim


MODERATION_POLICY_VERSION = "moderation-2"

OPEN_REVIEW_STATUSES = frozenset({"PENDING", "NEEDS_INFO"})
CASE_DECISIONS = frozenset({"RESOLVED", "REJECTED"})
VERDICT_STATUSES = frozenset({"COMPLETED", "FAILED", "VOID"})
DECISION_SOURCES = frozenset({"WEB", "TELEGRAM"})
NEGATIVE_REASON_CODES = frozenset(
    {
        "NOT_COMPLETED",
        "INSUFFICIENT_EVIDENCE",
        "INVALID_MATCH",
        "IDENTITY_MISMATCH",
        "DATA_CONFLICT",
        "POLICY_VIOLATION",
        "OTHER",
    }
)
FINAL_OPTION_STATUSES = frozenset({"COMPLETED", "FAILED", "VOID", "EXPIRED"})


class ModerationError(Exception):
    status_code = 400
    code = "MODERATION_ERROR"

    def __init__(self, detail: str, *, code: str | None = None):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code


class ModerationNotFound(ModerationError):
    status_code = 404
    code = "MODERATION_NOT_FOUND"


class ModerationConflict(ModerationError):
    status_code = 409
    code = "MODERATION_CONFLICT"


class ModerationValidationError(ModerationError):
    status_code = 422
    code = "MODERATION_VALIDATION_ERROR"


@dataclass(frozen=True)
class ModerationResult:
    review_id: str
    board_id: str
    match_id: str
    case_status: str
    source: str
    reason_code: str | None
    decision_key: str
    reward_xp_total: int
    board_status_after: str
    resume_discovery: bool
    settled_options: tuple[dict[str, Any], ...]
    decided_at: str | None
    idempotent: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "review_id": self.review_id,
            "board_id": self.board_id,
            "match_id": self.match_id,
            "case_status": self.case_status,
            "source": self.source,
            "reason_code": self.reason_code,
            "decision_key": self.decision_key,
            "reward_xp_total": self.reward_xp_total,
            "board_status_after": self.board_status_after,
            "resume_discovery": self.resume_discovery,
            "settled_options": [dict(item) for item in self.settled_options],
            "decided_at": self.decided_at,
            "idempotent": self.idempotent,
            "policy_version": MODERATION_POLICY_VERSION,
        }


def _clean_note(value: str | None) -> str:
    return str(value or "").strip()[:1500]


def _normalize_source(value: str) -> str:
    source = str(value or "").strip().upper()
    if source not in DECISION_SOURCES:
        raise ModerationValidationError(
            "Неизвестный источник решения модерации",
            code="INVALID_DECISION_SOURCE",
        )
    return source


def _normalize_reason(value: str | None) -> str | None:
    reason = str(value or "").strip().upper() or None
    if reason is not None and reason not in NEGATIVE_REASON_CODES:
        raise ModerationValidationError(
            "Неизвестный код причины модерации",
            code="INVALID_REASON_CODE",
        )
    return reason


def _normalize_verdicts(options: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw in options:
        option_id = str(raw.get("option_id") or "").strip()
        status = str(raw.get("status") or "").strip().upper()
        explanation = str(raw.get("explanation") or "").strip()
        progress = raw.get("progress_current")

        if not option_id:
            raise ModerationValidationError(
                "У решения отсутствует option_id",
                code="OPTION_ID_REQUIRED",
            )
        if option_id in seen:
            raise ModerationValidationError(
                "Один контракт указан в решении несколько раз",
                code="DUPLICATE_OPTION",
            )
        seen.add(option_id)

        if status not in VERDICT_STATUSES:
            raise ModerationValidationError(
                "Недопустимый вердикт по контракту",
                code="INVALID_OPTION_VERDICT",
            )

        if len(explanation) < 5 or len(explanation) > 800:
            raise ModerationValidationError(
                "Пояснение по контракту должно содержать от 5 до 800 символов",
                code="INVALID_OPTION_EXPLANATION",
            )

        if progress is not None:
            try:
                progress = float(progress)
            except (TypeError, ValueError) as exc:
                raise ModerationValidationError(
                    "progress_current должен быть числом",
                    code="INVALID_PROGRESS",
                ) from exc
            if not math.isfinite(progress):
                raise ModerationValidationError(
                    "progress_current должен быть конечным числом",
                    code="INVALID_PROGRESS",
                )

        normalized.append(
            {
                "option_id": option_id,
                "status": status,
                "progress_current": progress,
                "explanation": explanation,
            }
        )

    normalized.sort(key=lambda item: item["option_id"])
    return normalized


def _requires_negative_reason(case_status: str, verdicts: list[dict[str, Any]]) -> bool:
    if case_status == "REJECTED":
        return True
    return any(item["status"] in {"FAILED", "VOID"} for item in verdicts)


def _validate_command(
    *,
    source: str,
    case_status: str,
    reason_code: str | None,
    reviewer_note: str,
    verdicts: list[dict[str, Any]],
) -> tuple[str, str, str | None, str]:
    source = _normalize_source(source)
    case_status = str(case_status or "").strip().upper()
    reason_code = _normalize_reason(reason_code)
    reviewer_note = _clean_note(reviewer_note)

    if case_status not in CASE_DECISIONS:
        raise ModerationValidationError(
            "Недопустимый статус решения заявки",
            code="INVALID_CASE_DECISION",
        )

    if _requires_negative_reason(case_status, verdicts) and reason_code is None:
        raise ModerationValidationError(
            "Для FAILED, VOID или REJECTED требуется структурированная причина",
            code="NEGATIVE_REASON_REQUIRED",
        )

    if reason_code == "OTHER" and len(reviewer_note) < 5:
        raise ModerationValidationError(
            "Для причины OTHER добавьте пояснение модератора",
            code="OTHER_REASON_NOTE_REQUIRED",
        )

    return source, case_status, reason_code, reviewer_note


def _decision_key(
    *,
    review_id: str,
    actor_user_id: str,
    source: str,
    case_status: str,
    reason_code: str | None,
    reviewer_note: str,
    verdicts: list[dict[str, Any]],
) -> str:
    canonical = {
        "review_id": str(review_id),
        "actor_user_id": str(actor_user_id),
        "source": source,
        "case_status": case_status,
        "reason_code": reason_code,
        "reviewer_note": reviewer_note,
        "options": verdicts,
        "policy_version": MODERATION_POLICY_VERSION,
    }
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _stored_result(item: AutoReviewCase, *, idempotent: bool) -> ModerationResult:
    payload = item.decision_payload if isinstance(item.decision_payload, dict) else {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    raw_options = payload.get("options") if isinstance(payload.get("options"), list) else []

    return ModerationResult(
        review_id=item.id,
        board_id=item.board_id,
        match_id=item.match_id,
        case_status=item.status,
        source=str(payload.get("source") or "UNKNOWN"),
        reason_code=str(payload.get("reason_code")) if payload.get("reason_code") else None,
        decision_key=str(payload.get("decision_key") or ""),
        reward_xp_total=int(summary.get("reward_xp_total") or 0),
        board_status_after=str(summary.get("board_status_after") or "UNKNOWN"),
        resume_discovery=bool(summary.get("resume_discovery")),
        settled_options=tuple(dict(value) for value in raw_options if isinstance(value, dict)),
        decided_at=item.reviewed_at.isoformat() if item.reviewed_at else None,
        idempotent=idempotent,
    )


def _load_review(db: Session, review_id: str, *, lock: bool) -> AutoReviewCase:
    stmt = select(AutoReviewCase).where(AutoReviewCase.id == str(review_id))
    if lock:
        stmt = stmt.with_for_update()
    item = db.scalar(stmt)
    if item is None:
        raise ModerationNotFound(
            "Внутренняя заявка не найдена",
            code="REVIEW_NOT_FOUND",
        )
    return item


def _load_board(db: Session, board_id: str, *, lock: bool) -> ContractBoard:
    stmt = (
        select(ContractBoard)
        .options(selectinload(ContractBoard.options))
        .where(ContractBoard.id == board_id)
    )
    if lock:
        stmt = stmt.with_for_update()
    board = db.scalar(stmt)
    if board is None:
        raise ModerationNotFound("Дело не найдено", code="BOARD_NOT_FOUND")
    return board


def _load_owner(db: Session, user_id: str, *, lock: bool) -> User:
    stmt = select(User).where(User.id == user_id)
    if lock:
        stmt = stmt.with_for_update()
    owner = db.scalar(stmt)
    if owner is None:
        raise ModerationNotFound("Пользователь не найден", code="USER_NOT_FOUND")
    return owner


def _pending_options(board: ContractBoard) -> dict[str, BoardOption]:
    return {
        option.id: option
        for option in board.options
        if option.selected and option.status == "REVIEW_REQUIRED"
    }


def _outcome_plan(
    *,
    case_status: str,
    pending: dict[str, BoardOption],
    verdicts: list[dict[str, Any]],
    reviewer_note: str,
) -> dict[str, dict[str, Any]]:
    verdict_map = {item["option_id"]: item for item in verdicts}

    if case_status == "RESOLVED":
        if set(verdict_map) != set(pending):
            raise ModerationValidationError(
                "Для закрытия нужно указать решение по каждому контракту, ожидающему внутренней проверки",
                code="INCOMPLETE_REVIEW_DECISION",
            )
        return verdict_map

    return {
        option_id: {
            "option_id": option_id,
            "status": "FAILED",
            "progress_current": option.progress_current,
            "explanation": reviewer_note
            or "Внутренняя проверка не подтвердила выполнение контракта.",
        }
        for option_id, option in pending.items()
    }


def _project_board_state(
    board: ContractBoard,
    plan: dict[str, dict[str, Any]],
) -> tuple[str, bool]:
    statuses: list[str] = []
    for option in board.options:
        if not option.selected:
            continue
        planned = plan.get(option.id)
        statuses.append(planned["status"] if planned else option.status)

    if statuses and all(status in FINAL_OPTION_STATUSES for status in statuses):
        return "SETTLED", False
    if any(status == "REVIEW_REQUIRED" for status in statuses):
        return "REVIEW_REQUIRED", False
    if (
        int(board.attempts_used or 0) < int(board.max_attempts or 0)
        and any(status == "LOCKED" for status in statuses)
    ):
        return "LOCKED", True
    return "REVIEW_REQUIRED", False


def _preview_from_context(
    *,
    item: AutoReviewCase,
    board: ContractBoard,
    pending: dict[str, BoardOption],
    source: str,
    case_status: str,
    reason_code: str | None,
    decision_key: str,
    plan: dict[str, dict[str, Any]],
) -> ModerationResult:
    board_status_after, resume_discovery = _project_board_state(board, plan)
    reward_total = sum(
        int(pending[option_id].reward_xp)
        for option_id, verdict in plan.items()
        if verdict["status"] == "COMPLETED"
    )
    settled = tuple(
        {
            "option_id": option_id,
            "status": verdict["status"],
            "progress_current": verdict.get("progress_current"),
            "explanation": verdict["explanation"],
            "reward_xp": (
                int(pending[option_id].reward_xp)
                if verdict["status"] == "COMPLETED"
                else 0
            ),
        }
        for option_id, verdict in sorted(plan.items())
    )
    return ModerationResult(
        review_id=item.id,
        board_id=board.id,
        match_id=item.match_id,
        case_status=case_status,
        source=source,
        reason_code=reason_code,
        decision_key=decision_key,
        reward_xp_total=reward_total,
        board_status_after=board_status_after,
        resume_discovery=resume_discovery,
        settled_options=settled,
        decided_at=None,
        idempotent=False,
    )


def preview_review_decision(
    db: Session,
    *,
    review_id: str,
    actor_user_id: str,
    source: str,
    case_status: str,
    reason_code: str | None,
    reviewer_note: str,
    options: Iterable[dict[str, Any]],
    required_claim_by: str | None = None,
) -> ModerationResult:
    verdicts = _normalize_verdicts(options)
    source, case_status, reason_code, reviewer_note = _validate_command(
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        reviewer_note=reviewer_note,
        verdicts=verdicts,
    )
    key = _decision_key(
        review_id=review_id,
        actor_user_id=actor_user_id,
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        reviewer_note=reviewer_note,
        verdicts=verdicts,
    )

    item = _load_review(db, review_id, lock=False)
    if item.status not in OPEN_REVIEW_STATUSES:
        raise ModerationConflict("Заявка уже закрыта", code="REVIEW_ALREADY_DECIDED")
    if required_claim_by is not None:
        assert_review_claim(item, required_claim_by)

    board = _load_board(db, item.board_id, lock=False)
    pending = _pending_options(board)
    if not pending:
        raise ModerationConflict(
            "В заявке больше нет контрактов, ожидающих внутренней проверки",
            code="NO_REVIEW_REQUIRED_OPTIONS",
        )
    _load_owner(db, item.user_id, lock=False)
    plan = _outcome_plan(
        case_status=case_status,
        pending=pending,
        verdicts=verdicts,
        reviewer_note=reviewer_note,
    )
    return _preview_from_context(
        item=item,
        board=board,
        pending=pending,
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        decision_key=key,
        plan=plan,
    )


def decide_review(
    db: Session,
    *,
    review_id: str,
    actor_user_id: str,
    source: str,
    case_status: str,
    reason_code: str | None,
    reviewer_note: str,
    options: Iterable[dict[str, Any]],
    required_claim_by: str | None = None,
) -> ModerationResult:
    verdicts = _normalize_verdicts(options)
    source, case_status, reason_code, reviewer_note = _validate_command(
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        reviewer_note=reviewer_note,
        verdicts=verdicts,
    )
    key = _decision_key(
        review_id=review_id,
        actor_user_id=actor_user_id,
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        reviewer_note=reviewer_note,
        verdicts=verdicts,
    )

    item = _load_review(db, review_id, lock=True)

    if item.status not in OPEN_REVIEW_STATUSES:
        stored = item.decision_payload if isinstance(item.decision_payload, dict) else {}
        if stored.get("decision_key") == key:
            return _stored_result(item, idempotent=True)
        raise ModerationConflict(
            "Заявка уже закрыта другим или отличающимся решением",
            code="REVIEW_ALREADY_DECIDED",
        )
    if required_claim_by is not None:
        assert_review_claim(item, required_claim_by)

    board = _load_board(db, item.board_id, lock=True)
    owner = _load_owner(db, item.user_id, lock=True)
    pending = _pending_options(board)
    if not pending:
        raise ModerationConflict(
            "В заявке больше нет контрактов, ожидающих внутренней проверки",
            code="NO_REVIEW_REQUIRED_OPTIONS",
        )

    plan = _outcome_plan(
        case_status=case_status,
        pending=pending,
        verdicts=verdicts,
        reviewer_note=reviewer_note,
    )
    preview = _preview_from_context(
        item=item,
        board=board,
        pending=pending,
        source=source,
        case_status=case_status,
        reason_code=reason_code,
        decision_key=key,
        plan=plan,
    )
    now = datetime.now(timezone.utc)
    actual_outcomes: list[dict[str, Any]] = []

    try:
        for option_id, option in pending.items():
            verdict = plan[option_id]
            option.status = verdict["status"]
            option.progress_current = verdict.get("progress_current")
            option.progress_target = (
                float(len(option.conditions))
                if option.conditions and len(option.conditions) > 1
                else option.target
            )
            option.explanation = verdict["explanation"]
            option.settled_at = now

            revision = (
                db.scalar(
                    select(func.max(Evaluation.revision)).where(
                        Evaluation.assignment_id == option.id
                    )
                )
                or 0
            ) + 1

            evaluation = Evaluation(
                assignment_id=option.id,
                match_id=item.match_id,
                revision=revision,
                status=option.status,
                evidence_level="INTERNAL_REVIEW",
                evaluator_version=settings.evaluator_version,
                progress_current=option.progress_current,
                progress_target=option.progress_target,
                score=None,
                explanation=option.explanation or "Internal review decision",
                facts=[
                    {
                        "source": "internal_review",
                        "review_id": item.id,
                        "decision": option.status,
                        "decision_source": source,
                        "reason_code": reason_code,
                        "decision_key": key,
                        "policy_version": MODERATION_POLICY_VERSION,
                    }
                ],
            )
            db.add(evaluation)
            db.flush()
            option.final_evaluation_id = evaluation.id

            reward_xp = option.reward_xp if option.status == "COMPLETED" else 0
            outcome = {
                "option_id": option.id,
                "status": option.status,
                "progress_current": option.progress_current,
                "explanation": option.explanation,
                "reward_xp": int(reward_xp),
                "evaluation_id": evaluation.id,
            }
            actual_outcomes.append(outcome)

            # Moderation never writes User.xp or RewardLedgerEntry directly.
            # The existing assignment.settled outbox consumer remains the only
            # path from a review verdict to reward delivery.
            db.add(
                OutboxEvent(
                    event_type="assignment.settled",
                    aggregate_id=option.id,
                    payload={
                        "assignment_id": option.id,
                        "board_id": board.id,
                        "user_id": owner.id,
                        "status": option.status,
                        "reward_xp": int(reward_xp),
                        "evaluation_id": evaluation.id,
                        "match_id": item.match_id,
                        "review_id": item.id,
                        "moderation": {
                            "source": source,
                            "reason_code": reason_code,
                            "decision_key": key,
                            "policy_version": MODERATION_POLICY_VERSION,
                        },
                    },
                )
            )

        item.status = case_status
        item.reviewer_id = str(actor_user_id)
        item.reviewer_note = reviewer_note or None
        item.reviewed_at = now
        clear_review_claim(item)

        selected = [option for option in board.options if option.selected]
        resume_discovery = False
        if selected and all(option.status in FINAL_OPTION_STATUSES for option in selected):
            board.status = "SETTLED"
        elif any(option.status == "REVIEW_REQUIRED" for option in selected):
            board.status = "REVIEW_REQUIRED"
        elif (
            int(board.attempts_used or 0) < int(board.max_attempts or 0)
            and any(option.status == "LOCKED" for option in selected)
        ):
            reviewed_match = db.get(Match, item.match_id)
            if reviewed_match:
                board.baseline_match_id = max(
                    int(board.baseline_match_id or 0),
                    int(reviewed_match.external_match_id),
                )
            board.status = "LOCKED"
            resume_discovery = True
        else:
            board.status = "REVIEW_REQUIRED"

        reward_total = sum(int(value["reward_xp"]) for value in actual_outcomes)
        if (
            reward_total != preview.reward_xp_total
            or board.status != preview.board_status_after
            or resume_discovery != preview.resume_discovery
        ):
            raise RuntimeError("Moderation result diverged from locked preview")

        item.decision_payload = {
            "schema_version": 2,
            "policy_version": MODERATION_POLICY_VERSION,
            "source": source,
            "reason_code": reason_code,
            "decision_key": key,
            "actor_user_id": str(actor_user_id),
            "options": actual_outcomes,
            "summary": {
                "reward_xp_total": reward_total,
                "board_status_after": board.status,
                "resume_discovery": resume_discovery,
            },
        }

        db.add(
            AuditLog(
                user_id=str(actor_user_id),
                action="auto_review.decided",
                entity_type="auto_review_case",
                entity_id=item.id,
                data={
                    "status": case_status,
                    "board_id": board.id,
                    "source": source,
                    "reason_code": reason_code,
                    "decision_key": key,
                    "policy_version": MODERATION_POLICY_VERSION,
                    "reward_xp_total": reward_total,
                    "option_count": len(actual_outcomes),
                },
            )
        )

        if resume_discovery:
            active = list(
                db.scalars(
                    select(Job).where(
                        Job.type == "discover_match",
                        Job.board_id == board.id,
                        Job.status.in_(("PENDING", "RUNNING")),
                    )
                ).all()
            )
            if not active:
                enqueue_job(
                    db,
                    "discover_match",
                    {"board_id": board.id},
                    f"discover:{board.id}:review-resume:{item.id}",
                    max_attempts=settings.max_discovery_attempts,
                    commit=False,
                )

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ModerationConflict(
            "Решение столкнулось с параллельным изменением; обновите заявку и повторите действие",
            code="MODERATION_WRITE_CONFLICT",
        ) from exc

    db.refresh(item)
    return _stored_result(item, idempotent=False)
