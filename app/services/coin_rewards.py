"""Historical coin receipts and append-only admin corrections.

Player issuance hooks intentionally return no reward after economy retirement.
Legacy models, signed policies, receipts and correction validation are retained.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from ..coin_models import CoinCorrection, CoinEntitlement, CoinPolicySnapshot, CoinQuota
from ..models import (
    ArchiveLedger,
    AuditLog,
    BoardOption,
    ContractBoard,
    Evaluation,
    Match,
    MatchParticipant,
    User,
    utcnow,
)
from .archive import aware
from .match_trust import provider_parts

POLICY_VERSION = "coins-v1"
CONTRACT_REWARDS = {
    "STANDARD": {"LIGHT": 6, "FOCUSED": 10, "HARD": 16, "EXTREME": 24},
    "RANKED": {"LIGHT": 6, "FOCUSED": 10, "HARD": 16, "EXTREME": 24},
    "STREET_BRAWL": {"LIGHT": 3, "FOCUSED": 5, "HARD": 8, "EXTREME": 12},
}
CASE_BONUS = {"STANDARD": 10, "RANKED": 10, "STREET_BRAWL": 5}
DAILY_LIMIT, WEEKLY_LIMIT = 80, 400
# An allowlist deliberately excludes fixtures and arbitrary non-client labels.
INDEPENDENT_PROVIDERS = {"deadlock_api", "deadlock-api", "steam", "steam_web_api"}


def _utc(value):
    return aware(value).astimezone(timezone.utc)


def _lock_recipient(db, user_id):
    # Background settlement fulfills an existing obligation even if account
    # access was suspended. Active-account authorization belongs to API/spend
    # guards, not to the worker's recipient lock.
    return db.scalar(select(User).where(User.id == user_id).with_for_update()
                     .execution_options(populate_existing=True))


def snapshot_signing(db, board):
    # Permanent retirement: flags and queued legacy jobs cannot issue coins.
    """Player coin issuance is retired; historical records remain available to admin correction tools."""
    return 0


def _receipt(row):
    return {"id": row.id, "source_type": row.source_type, "source_id": row.source_id,
            "policy_version": row.policy_version, "nominal_amount": row.nominal_amount,
            "amount": row.amount, "eligible": row.eligible, "reason": row.reason, "status": row.status,
            "period_day": row.period_day.isoformat() if row.period_day else None,
            "period_week": row.period_week.isoformat() if row.period_week else None,
            "created_at": aware(row.created_at).isoformat(),
            "delivered_at": aware(row.delivered_at).isoformat() if row.delivered_at else None}


def assignment_receipt(db, assignment_id, user_id=None):
    query = select(CoinEntitlement).where(CoinEntitlement.source_type == "assignment",
                                         CoinEntitlement.source_id == assignment_id)
    if user_id is not None:
        query = query.where(CoinEntitlement.user_id == user_id)
    row = db.scalar(query)
    return _receipt(row) if row else None


def case_receipts(db, board_ids, user_id):
    if not board_ids:
        return {}
    rows = db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id,
        CoinEntitlement.source_type == "case", CoinEntitlement.source_id.in_(board_ids)))
    return {row.source_id: _receipt(row) for row in rows}


def assignment_receipts(db, assignment_ids, user_id):
    """Read history in a fixed number of queries, without creating any awards."""
    if not assignment_ids:
        return {}
    options = list(db.scalars(select(BoardOption).join(ContractBoard).where(
        ContractBoard.user_id == user_id, BoardOption.id.in_(assignment_ids))))
    snapshots = {row.assignment_id: row for row in db.scalars(select(CoinPolicySnapshot).where(
        CoinPolicySnapshot.user_id == user_id, CoinPolicySnapshot.assignment_id.in_(assignment_ids)))}
    decisions = {row.source_id: row for row in db.scalars(select(CoinEntitlement).where(
        CoinEntitlement.user_id == user_id, CoinEntitlement.source_type == "assignment",
        CoinEntitlement.source_id.in_(assignment_ids)))}
    result = {}
    for option in options:
        if option.id in decisions:
            result[option.id] = _receipt(decisions[option.id])
            continue
        snapshot = snapshots.get(option.id)
        terminal = option.status in {"FAILED", "VOID", "EXPIRED", "SKIPPED"}
        result[option.id] = {"id": None, "source_type": "assignment", "source_id": option.id,
            "policy_version": snapshot.policy_version if snapshot else POLICY_VERSION,
            "nominal_amount": snapshot.amount if snapshot else 0, "amount": 0, "eligible": False,
            "status": "PENDING" if snapshot and not terminal else "REJECTED",
            "reason": ("NOT_COMPLETED" if terminal else "PENDING") if snapshot else "NO_SIGNED_POLICY",
            "period_day": None, "period_week": None, "created_at": None, "delivered_at": None}
    return result


def _eligibility(db, user, option, board, snapshot, evaluation, match):
    if snapshot is None:
        return "NO_SIGNED_POLICY"
    if not option.selected or option.status != "COMPLETED" or not option.settled_at:
        return "NOT_COMPLETED"
    if (not evaluation or not match or evaluation.status != "COMPLETED"
            or evaluation.assignment_id != option.id or evaluation.match_id != option.bound_match_id):
        return "UNTRUSTED_RESULT"
    if match.ended_at is None or match.started_at is None:
        return "MISSING_MATCH_TIME"
    started, ended, signed = aware(match.started_at), aware(match.ended_at), aware(snapshot.signed_at)
    if not signed <= started <= ended <= aware(board.expires_at):
        return "OUTSIDE_ATTEMPT_WINDOW"
    parts = provider_parts(match.provider)
    if (not parts or any(part not in INDEPENDENT_PROVIDERS for part in parts)
            or not match.is_final or match.scoring_status != "SCORED"
            or match.integrity_status == "CLIENT_ATTESTED_GEP"
            or str(match.game_version or "").startswith("local-fixture")
            or match.game_match_mode != snapshot.mode
            or option.required_game_match_mode != snapshot.mode):
        return "UNTRUSTED_RESULT"
    required = set(option.required_capabilities or [])
    for condition in option.conditions or []:
        required.update(condition.get("capabilities") or [])
    if not required.issubset(set(match.capabilities or [])) or not evaluation.facts:
        return "UNTRUSTED_RESULT"
    participant = db.scalar(select(MatchParticipant).where(
        MatchParticipant.match_id == match.id, MatchParticipant.account_id == user.account_id))
    if participant is None:
        return "UNTRUSTED_RESULT"
    # Independently finalized server facts remain mandatory for manual outcomes;
    # the evaluation and its moderation audit retain the reason and authority.
    if evaluation.evidence_level == "INTERNAL_REVIEW":
        review = next((fact for fact in evaluation.facts if fact.get("source") == "internal_review"), None)
        if not review or not all(review.get(key) for key in ("review_id", "decision_key", "decision_source", "reason_code")):
            return "UNTRUSTED_RESULT"
    return None


def _quota(db, user_id, kind, start):
    row = db.scalar(select(CoinQuota).where(CoinQuota.user_id == user_id, CoinQuota.source == "CONTRACT",
                                           CoinQuota.period_kind == kind, CoinQuota.period_start == start).with_for_update())
    if row is None:
        row = CoinQuota(user_id=user_id, source="CONTRACT", period_kind=kind, period_start=start, used=0)
        db.add(row)
        db.flush()
    return row


def _reserve(db, *, user_id, source_type, source_id, nominal, snapshot, evaluation=None, match=None, reason=None):
    # Permanent retirement: flags and queued legacy jobs cannot issue coins.
    """Player coin issuance is retired; historical records remain available to admin correction tools."""
    return None


def settle_assignment(db, assignment_id, context=None):
    # Permanent retirement: flags and queued legacy jobs cannot issue coins.
    """Player coin issuance is retired; historical records remain available to admin correction tools."""
    return None


def _still_valid(db, row):
    if row.status in {"CORRECTED", "INVALIDATED", "REJECTED"}:
        return False
    if row.source_type not in {"assignment", "case"}:
        from .extra_coin_rewards import still_valid
        return still_valid(db, row)
    if row.source_type == "case":
        selected = list(db.scalars(select(BoardOption).where(BoardOption.board_id == row.source_id,
                                                             BoardOption.selected.is_(True))))
        if len(selected) < 2:
            return False
        decisions = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == row.user_id,
            CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id.in_([option.id for option in selected]))))
        return len(decisions) == len(selected) and all(value.eligible and _still_valid(db, value) for value in decisions)
    option = db.get(BoardOption, row.source_id)
    if not option or option.final_evaluation_id != row.evaluation_id:
        return False
    snapshot = db.get(CoinPolicySnapshot, row.policy_snapshot_id) if row.policy_snapshot_id else None
    evaluation = db.get(Evaluation, row.evaluation_id) if row.evaluation_id else None
    match = db.get(Match, row.match_id) if row.match_id else None
    return _eligibility(db, db.get(User, row.user_id), option, db.get(ContractBoard, option.board_id),
                        snapshot, evaluation, match) is None


def deliver_entitlement(db, entitlement_id):
    # Permanent retirement: flags and queued legacy jobs cannot issue coins.
    """Player coin issuance is retired; historical records remain available to admin correction tools."""
    return None


def _case_correction_result(db, correction, *, reverse_case=False):
    result = {"id": correction.id, "entitlement_id": correction.entitlement_id,
              "delta": correction.delta, "reason": correction.reason, "related_corrections": []}
    entitlement = db.get(CoinEntitlement, correction.entitlement_id)
    if entitlement.source_type != "assignment":
        return result
    option = db.get(BoardOption, entitlement.source_id)
    if option is None:
        return result
    case = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == correction.user_id,
        CoinEntitlement.source_type == "case", CoinEntitlement.source_id == option.board_id))
    if case is None:
        return result
    linked_key = str(uuid5(NAMESPACE_URL, f"coin-correction:{correction.id}:{case.id}"))
    if reverse_case and case.status in {"RESERVED", "DELIVERED"}:
        result["related_corrections"].append(correct_entitlement(db, case.id, request_key=linked_key,
            actor_user_id=correction.actor_user_id, reason=correction.reason, _cascade=False))
    else:
        linked = db.scalar(select(CoinCorrection).where(CoinCorrection.user_id == correction.user_id,
                                                        CoinCorrection.request_key == linked_key))
        if linked:
            result["related_corrections"].append(_correction_result(db, linked))
    return result


def _correction_result(db, correction, *, reverse_case=False):
    from .extra_coin_rewards import identity
    result = _case_correction_result(db, correction, reverse_case=reverse_case)
    linked = list(db.scalars(select(CoinCorrection).where(CoinCorrection.user_id == correction.user_id)
        .order_by(CoinCorrection.entitlement_id)))
    for row in linked:
        if row.request_key == identity("correction", correction.id, row.entitlement_id):
            result["related_corrections"].append(_correction_result(db, row))
    return result


def correct_entitlement(db, entitlement_id, *, request_key, actor_user_id, reason, _cascade=True):
    """Reverse once; the authorized OWNER route supplies the actor and reason."""
    row = db.get(CoinEntitlement, entitlement_id)
    if row is None:
        raise HTTPException(404, "Coin receipt not found")
    if _lock_recipient(db, row.user_id) is None:
        raise HTTPException(404, "Coin recipient not found")
    row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.id == entitlement_id).with_for_update()
                    .execution_options(populate_existing=True))
    reason = str(reason).strip()
    if not 3 <= len(reason) <= 300:
        raise HTTPException(422, "A correction reason is required")
    existing = db.scalar(select(CoinCorrection).where(CoinCorrection.user_id == row.user_id,
                                                      CoinCorrection.request_key == str(request_key)))
    if existing:
        if existing.entitlement_id != row.id or existing.reason != reason or existing.actor_user_id != actor_user_id:
            raise HTTPException(409, "Correction request key reused")
        return _correction_result(db, existing)
    if row.status not in {"DELIVERED", "RESERVED"}:
        raise HTTPException(409, "Coin receipt is already corrected or ineligible")
    delta = -row.amount if row.status == "DELIVERED" else 0
    correction = CoinCorrection(user_id=row.user_id, entitlement_id=row.id, actor_user_id=actor_user_id,
                                request_key=str(request_key), reason=reason, delta=delta)
    db.add(correction)
    db.flush()
    if delta:
        db.add(ArchiveLedger(user_id=row.user_id, source="coin-correction:" + correction.id,
                             reason="COIN_CORRECTION", delta=delta, scope="REAL"))
    row.status = "CORRECTED"
    db.add(AuditLog(user_id=actor_user_id, action="coins.corrected", entity_type="coin_entitlement", entity_id=row.id,
                    data={"correction_id": correction.id, "delta": delta, "reason": reason, "recipient_id": row.user_id}))
    db.flush()
    _correction_result(db, correction, reverse_case=True)
    from .extra_coin_rewards import corrected_dependents
    if _cascade:
        corrected_dependents(db, row, correction)
    return _correction_result(db, correction)


def status(db, user_id, *, now=None):
    now = _utc(now or utcnow())
    day, week = now.date(), now.date() - timedelta(days=now.weekday())
    quotas = {}
    for label, kind, start, limit, reset in (("daily", "DAY", day, DAILY_LIMIT, day + timedelta(days=1)),
                                            ("weekly", "WEEK", week, WEEKLY_LIMIT, week + timedelta(days=7))):
        used = db.scalar(select(CoinQuota.used).where(CoinQuota.user_id == user_id, CoinQuota.source == "CONTRACT",
            CoinQuota.period_kind == kind, CoinQuota.period_start == start)) or 0
        quotas[label] = {"limit": limit, "used": used, "remaining": max(0, limit - used),
                         "reset_at": datetime.combine(reset, time.min, tzinfo=timezone.utc).isoformat()}
    receipts = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id)
                              .order_by(CoinEntitlement.created_at.desc(), CoinEntitlement.id).limit(30)))
    return {"policy_version": POLICY_VERSION,
            "enabled": False,
            "contract_rewards": CONTRACT_REWARDS, "case_bonus": CASE_BONUS, "quotas": quotas,
            "receipts": [_receipt(row) for row in receipts]}
