"""Server-derived, idempotent community goals. Never issues XP.

Lock order: bureau, operation, then participants/contributions. Windows are
half-open; signing AND the match must belong to the same membership spell.
Late provider verification is allowed. Verdict corrections append ledger events.
"""
from __future__ import annotations

import logging
from datetime import timezone
from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import Session

from ..models import (BoardOption, BureauContribution, BureauContributionEvent,
    BureauMembershipPeriod, BureauOperation, BureauOperationParticipant,
    ContractBoard, Evaluation, Match, PlayerBureau, RewardLedgerEntry, User, utcnow)
from .leaderboard import TRUSTED_REWARD_SOURCES

TEMPLATES = {
    "quarter_defence": {"title": {"ru": "Оборона квартала", "en": "Quarter defence"}, "target": 20, "min_contributors": 3, "category": None, "metric": "contracts"},
    "city_cases": {"title": {"ru": "Городское расследование", "en": "City investigation"}, "target": 20, "min_contributors": 3, "category": None, "metric": "contracts"},
    "field_hospital": {"title": {"ru": "На помощь городу", "en": "City relief"}, "target": 10, "min_contributors": 2, "category": "SUPPORT", "metric": "contracts"},
    "five_witnesses": {"title": {"ru": "Пять свидетелей", "en": "Five witnesses"}, "target": 5, "min_contributors": 5, "category": None, "metric": "contributors"},
}


def aware(at):
    return at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at


def close_period(db: Session, user_id: str, bureau_id: str) -> None:
    db.execute(update(BureauMembershipPeriod).where(BureauMembershipPeriod.user_id == user_id,
        BureauMembershipPeriod.bureau_id == bureau_id, BureauMembershipPeriod.left_at.is_(None)).values(left_at=utcnow()))


def cancel_open(db: Session, bureau_id: str, reason: str) -> None:
    # A paused/disbanded bureau cannot later retroactively earn during a pause.
    db.execute(update(BureauOperation).where(BureauOperation.bureau_id == bureau_id,
        BureauOperation.status.in_(["ACTIVE", "EXPIRED", "CORRECTED"])).values(status="CANCELLED", cancel_reason=reason))
    db.execute(update(BureauOperation).where(BureauOperation.bureau_id == bureau_id,
        BureauOperation.status == "COMPLETED", BureauOperation.ends_at > utcnow()).values(ends_at=utcnow()))


def eligible(db: Session, operation: BureauOperation) -> dict:
    periods = db.scalars(select(BureauMembershipPeriod).where(
        BureauMembershipPeriod.bureau_id == operation.bureau_id,
        BureauMembershipPeriod.user_id.is_not(None),
        BureauMembershipPeriod.joined_at < operation.ends_at)).all() if operation.bureau_id else []
    spells: dict[str, list] = {}
    for period in periods:
        spells.setdefault(period.user_id, []).append(period)
    archived_sources = dict(db.execute(select(BureauContribution.source_key, BureauOperationParticipant.user_id)
        .join(BureauOperationParticipant, BureauOperationParticipant.id == BureauContribution.participant_id)
        .where(BureauContribution.operation_id == operation.id, BureauOperationParticipant.user_id.is_not(None))).all()) if operation.bureau_id is None else {}
    user_ids = set(spells) if operation.bureau_id else set(archived_sources.values())
    if not user_ids:
        return {}
    reward = exists(select(RewardLedgerEntry.id).where(
        RewardLedgerEntry.user_id == ContractBoard.user_id,
        RewardLedgerEntry.source_id == BoardOption.id,
        RewardLedgerEntry.asset == "XP", RewardLedgerEntry.delta > 0,
        RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES)))
    rows = db.execute(select(BoardOption, ContractBoard, Match)
        .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
        .join(User, User.id == ContractBoard.user_id)
        .join(Evaluation, Evaluation.id == BoardOption.final_evaluation_id)
        .join(Match, Match.id == Evaluation.match_id)
        .where(ContractBoard.user_id.in_(user_ids), User.status == "ACTIVE",
               Evaluation.assignment_id == BoardOption.id, Evaluation.status == "COMPLETED",
               BoardOption.selected.is_(True), BoardOption.status == "COMPLETED",
               BoardOption.settled_at.is_not(None), BoardOption.locked_at >= operation.started_at,
               BoardOption.locked_at < operation.ends_at,
               Match.is_final.is_(True), Match.ended_at < operation.ends_at,
               Match.ended_at >= operation.started_at,
               Match.integrity_status != "CLIENT_ATTESTED_GEP", reward)).all()
    result = {}
    template = TEMPLATES[operation.template]
    for option, board, match in rows:
        signed, played = aware(option.locked_at), aware(match.ended_at)
        if not match.started_at or not signed <= aware(match.started_at) <= played:
            continue
        if option.bound_match_id != match.id or (template["category"] and option.category != template["category"]):
            continue
        historical = operation.bureau_id is None and option.id in archived_sources
        if historical or any(aware(p.joined_at) <= signed and (p.left_at is None or played < aware(p.left_at)) for p in spells.get(board.user_id, [])):
            result[option.id] = (board.user_id, played)
    return result


def reconcile(db: Session, operation: BureauOperation, *, allow_new: bool = True) -> None:
    now = utcnow()
    operation.checked_at = now
    if operation.status == "CANCELLED":
        return
    facts = eligible(db, operation)
    allow_new = allow_new and operation.bureau_id is not None
    contributions = db.scalars(select(BureauContribution).where(BureauContribution.operation_id == operation.id)).all()
    seen = {item.source_key for item in contributions}
    for item in contributions:
        # Deletion anonymizes historical credit; no Steam name or user ID is
        # retained. Existing anonymized credit is not a new reward claim.
        valid = item.source_key in facts if item.source_option_id else item.credited
        if item.credited != valid:
            item.credited = valid
            item.revision += 1
            db.add(BureauContributionEvent(contribution_id=item.id, revision=item.revision,
                                          action="RESTORE" if valid else "REVOKE"))
    if allow_new:
        for source, (user_id, played) in facts.items():
            if source in seen or db.scalar(select(BureauContribution.id).where(BureauContribution.source_key == source)):
                continue
            participant = db.scalar(select(BureauOperationParticipant).where(
                BureauOperationParticipant.operation_id == operation.id, BureauOperationParticipant.user_id == user_id))
            if participant is None:
                participant = BureauOperationParticipant(operation_id=operation.id, user_id=user_id)
                db.add(participant); db.flush()
            item = BureauContribution(operation_id=operation.id, participant_id=participant.id,
                source_key=source, source_option_id=source, credited=True, played_at=played)
            db.add(item); db.flush()
            db.add(BureauContributionEvent(contribution_id=item.id, revision=1, action="CREDIT"))
    db.flush()
    active = db.execute(select(BureauContribution.participant_id, func.count())
        .where(BureauContribution.operation_id == operation.id, BureauContribution.credited.is_(True))
        .group_by(BureauContribution.participant_id)).all()
    operation.contributors = len(active)
    operation.progress = len(active) if TEMPLATES[operation.template]["metric"] == "contributors" else sum(row[1] for row in active)
    completed = operation.progress >= operation.target and operation.contributors >= operation.min_contributors
    operation.status = "COMPLETED" if completed else ("CORRECTED" if operation.completed_at else ("EXPIRED" if now >= aware(operation.ends_at) else "ACTIVE"))
    if completed:
        operation.completed_at = operation.completed_at or now
        for participant in db.scalars(select(BureauOperationParticipant).where(BureauOperationParticipant.id.in_([row[0] for row in active]))):
            participant.earned_at = participant.earned_at or now


def maintenance(factory, limit: int = 10) -> None:
    """Round-robin also revisits old results after delayed audits, one tx each."""
    with factory() as db:
        ids = db.execute(select(BureauOperation.id, BureauOperation.bureau_id)
            .where(BureauOperation.status != "CANCELLED")
            .order_by(BureauOperation.checked_at, BureauOperation.id).limit(limit)).all()
    for operation_id, bureau_id in ids:
        try:
            with factory() as db:
                bureau = db.scalar(select(PlayerBureau).where(PlayerBureau.id == bureau_id).with_for_update())
                operation = db.scalar(select(BureauOperation).where(BureauOperation.id == operation_id).with_for_update())
                if operation and (bureau or operation.bureau_id is None):
                    reconcile(db, operation, allow_new=bool(bureau and bureau.status == "ACTIVE"))
                    from .extra_coin_rewards import record_bureau
                    record_bureau(db, operation)
                    db.commit()
        except Exception:
            logging.getLogger(__name__).exception("Could not reconcile bureau operation %s", operation_id)


def collection(db: Session, user_id: str) -> list[dict]:
    earned = dict(db.execute(select(BureauOperation.template, func.min(BureauOperationParticipant.earned_at))
        .join(BureauOperationParticipant, BureauOperationParticipant.operation_id == BureauOperation.id)
        .where(BureauOperationParticipant.user_id == user_id, BureauOperation.status == "COMPLETED",
            exists(select(BureauContribution.id).where(BureauContribution.participant_id == BureauOperationParticipant.id,
                BureauContribution.credited.is_(True))))
        .group_by(BureauOperation.template)).all())
    return [{"id": f"team_{key}", "title": value["title"],
        "description": {"ru": "Внесите вклад в успешно завершённую операцию «" + value["title"]["ru"] + "»",
                        "en": "Contribute to a successful “" + value["title"]["en"] + "” operation"},
        "current": int(bool(earned.get(key))), "target": 1, "earned": bool(earned.get(key)),
        "earned_at": aware(earned[key]).isoformat() if earned.get(key) else None} for key, value in TEMPLATES.items()]


def payload(db: Session, operation: BureauOperation, user_id: str) -> dict:
    participant = db.scalar(select(BureauOperationParticipant).where(BureauOperationParticipant.operation_id == operation.id,
                                                                   BureauOperationParticipant.user_id == user_id))
    own = db.scalar(select(func.count()).select_from(BureauContribution).where(
        BureauContribution.participant_id == participant.id, BureauContribution.credited.is_(True))) if participant else 0
    # The private journal contains only the requesting player's entries.
    events = db.execute(select(BureauContributionEvent, BureauContribution.source_option_id)
        .join(BureauContribution, BureauContribution.id == BureauContributionEvent.contribution_id)
        .where(BureauContribution.participant_id == participant.id)
        .order_by(BureauContributionEvent.created_at.desc(), BureauContributionEvent.id).limit(20)).all() if participant else []
    return {"id": operation.id, "template": operation.template, "title": TEMPLATES[operation.template]["title"],
        "target": operation.target, "min_contributors": operation.min_contributors, "progress": operation.progress,
        "contributors": operation.contributors, "status": operation.status, "started_at": aware(operation.started_at).isoformat(),
        "ends_at": aware(operation.ends_at).isoformat(), "checked_at": aware(operation.checked_at).isoformat(),
        "cancel_reason": operation.cancel_reason, "my_contribution": own or 0,
        "journal": [{"action": e.action, "at": aware(e.created_at).isoformat(), "contract_id": source} for e, source in events]}
