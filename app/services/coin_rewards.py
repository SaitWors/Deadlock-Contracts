"""Reserve contract coins with final decisions; deliver through a separate outbox.

The caller owns the transaction. Lock order is the existing settlement board,
then user, entitlement and DAY/WEEK quotas. The user lock also serializes first
quota insertion and archive spending. Policies are captured only while signing;
delivery never invents a policy for an old assignment.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select

from ..coin_models import CoinCorrection, CoinEntitlement, CoinPolicySnapshot, CoinQuota
from ..config import settings
from ..models import (ArchiveLedger, AuditLog, BoardOption, ContractBoard, Evaluation,
                      Match, MatchParticipant, OutboxEvent, User, utcnow)
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
    """Capture only newly locked selections. Never backfill a completed result."""
    if not board.locked_at or board.status != "LOCKED":
        return 0
    # Production SessionLocal disables autoflush; selected/status were just
    # changed by lock_board and must reach SQL before its selection query.
    db.flush()
    selected = list(db.scalars(select(BoardOption).where(
        BoardOption.board_id == board.id, BoardOption.selected.is_(True)).order_by(BoardOption.id)))
    if not selected or any(option.status != "LOCKED" or option.settled_at for option in selected):
        return 0
    count = 0
    for option in selected:
        existing = db.scalar(select(CoinPolicySnapshot.id).where(CoinPolicySnapshot.assignment_id == option.id))
        if existing:
            continue
        db.add(CoinPolicySnapshot(user_id=board.user_id, assignment_id=option.id, board_id=board.id,
                                 policy_version=POLICY_VERSION, mode=board.game_match_mode,
                                 difficulty=option.difficulty,
                                 amount=CONTRACT_REWARDS.get(board.game_match_mode, {}).get(option.difficulty, 0),
                                 case_bonus=CASE_BONUS.get(board.game_match_mode, 0), selected_count=len(selected),
                                 signed_at=_utc(board.locked_at)))
        count += 1
    db.flush()
    return count


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
    existing = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id,
        CoinEntitlement.source_type == source_type, CoinEntitlement.source_id == source_id).with_for_update())
    if existing:
        return existing
    day = _utc(match.ended_at).date() if match and match.ended_at else None
    week = day - timedelta(days=day.weekday()) if day else None
    amount = 0
    eligible = reason is None
    if eligible:
        daily, weekly = _quota(db, user_id, "DAY", day), _quota(db, user_id, "WEEK", week)
        remaining_day, remaining_week = max(0, DAILY_LIMIT - daily.used), max(0, WEEKLY_LIMIT - weekly.used)
        amount = min(nominal, remaining_day, remaining_week)
        reason = "AWARDED" if amount == nominal else ("WEEKLY_LIMIT" if remaining_week <= remaining_day else "DAILY_LIMIT")
        daily.used += amount
        weekly.used += amount
    row = CoinEntitlement(user_id=user_id, source_type=source_type, source_id=source_id,
                          policy_version=snapshot.policy_version if snapshot else POLICY_VERSION,
                          policy_snapshot_id=snapshot.id if snapshot else None,
                          evaluation_id=evaluation.id if evaluation else None, match_id=match.id if match else None,
                          period_day=day, period_week=week, nominal_amount=nominal, amount=amount, eligible=eligible,
                          reason=reason, status="RESERVED" if eligible else "REJECTED")
    db.add(row)
    db.flush()
    if eligible:
        db.add(OutboxEvent(event_type="coin.reward", aggregate_id=row.id, payload={"entitlement_id": row.id, "user_id": user_id}))
    db.flush()
    return row


def settle_assignment(db, assignment_id, context=None):
    """Reserve a definitive award and delivery obligation in the settlement tx."""
    option = db.get(BoardOption, assignment_id)
    if option is None:
        raise ValueError("Contract assignment not found")
    board = db.get(ContractBoard, option.board_id)
    user = _lock_recipient(db, board.user_id) if board else None
    if user is None:
        return None
    existing = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == user.id,
        CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id == option.id).with_for_update())
    if existing:
        return _receipt(existing)
    snapshot = db.scalar(select(CoinPolicySnapshot).where(CoinPolicySnapshot.assignment_id == option.id))
    evaluation = db.get(Evaluation, option.final_evaluation_id) if option.final_evaluation_id else None
    match = db.get(Match, evaluation.match_id) if evaluation else None
    reason = _eligibility(db, user, option, board, snapshot, evaluation, match)
    row = _reserve(db, user_id=user.id, source_type="assignment", source_id=option.id,
                   nominal=snapshot.amount if snapshot else 0, snapshot=snapshot,
                   evaluation=evaluation, match=match, reason=reason)
    selected = list(db.scalars(select(BoardOption).where(BoardOption.board_id == board.id,
                                                        BoardOption.selected.is_(True)).order_by(BoardOption.id)))
    if snapshot and snapshot.selected_count >= 2 and len(selected) == snapshot.selected_count:
        decisions = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == user.id,
            CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id.in_([value.id for value in selected]))))
        if (len(decisions) == len(selected)
                and all(value.eligible and value.status in {"RESERVED", "DELIVERED"} for value in decisions)
                and all(_still_valid(db, value) for value in decisions)
                and all(value.status == "COMPLETED" for value in selected)):
            # An older match may be approved after a newer attempt. Anchor the
            # bonus to actual completion time, independent of moderation order.
            last = max(decisions, key=lambda value: (aware(db.get(Match, value.match_id).ended_at), value.id))
            _reserve(db, user_id=user.id, source_type="case", source_id=board.id, nominal=snapshot.case_bonus,
                     snapshot=snapshot, evaluation=db.get(Evaluation, last.evaluation_id), match=db.get(Match, last.match_id))
    return _receipt(row)


def _still_valid(db, row):
    if row.status in {"CORRECTED", "INVALIDATED", "REJECTED"}:
        return False
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
    row = db.get(CoinEntitlement, entitlement_id)
    if row is None:
        return None  # Deleted account: its private obligations were deleted too.
    if _lock_recipient(db, row.user_id) is None:
        return None
    row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.id == entitlement_id).with_for_update()
                    .execution_options(populate_existing=True))
    if row.status != "RESERVED":
        return _receipt(row)
    if not _still_valid(db, row):
        row.status, row.reason = "INVALIDATED", "RESULT_CHANGED"
        db.flush()
        return _receipt(row)
    if row.amount:
        from .archive import credit_wallet
        source = "coin:" + row.id
        credit_wallet(db, row.user_id, source=source,
                      reason="CONTRACT" if row.source_type == "assignment" else "CASE_BONUS", delta=row.amount, scope="REAL")
        row.ledger_source = source
    row.status, row.delivered_at = "DELIVERED", utcnow()
    db.flush()
    return _receipt(row)


def _correction_result(db, correction, *, reverse_case=False):
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
            actor_user_id=correction.actor_user_id, reason=correction.reason))
    else:
        linked = db.scalar(select(CoinCorrection).where(CoinCorrection.user_id == correction.user_id,
                                                        CoinCorrection.request_key == linked_key))
        if linked:
            result["related_corrections"].append(_correction_result(db, linked))
    return result


def correct_entitlement(db, entitlement_id, *, request_key, actor_user_id, reason):
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
    return _correction_result(db, correction, reverse_case=True)


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
            "enabled": settings.coin_rewards_enabled and settings.reward_settlement_enabled,
            "contract_rewards": CONTRACT_REWARDS, "case_bonus": CASE_BONUS, "quotas": quotas,
            "receipts": [_receipt(row) for row in receipts]}
