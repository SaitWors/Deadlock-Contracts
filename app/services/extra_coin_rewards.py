"""Server-only bounded browser rewards, reusing the durable coin outbox.

Mutating callers own their transaction. Lock order is battle/bureau, then user,
entitlement and quota. Facts freeze occurrence times; delivery rechecks their
original sources. GET/status helpers never create facts or monetary rights.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import exists, select

from ..coin_models import CoinEntitlement, CoinQuota
from ..economy_models import EconomyActivity, EconomyRewardContext
from ..models import (ArchiveCipher, BoardOption, BureauContribution, BureauOperation,
                      BureauOperationParticipant, ContractBoard, Evaluation, Match,
                      MatchParticipant, OutboxEvent, RewardLedgerEntry, User, utcnow)
from .archive import aware
from . import coin_rewards as coins
from .leaderboard import TRUSTED_REWARD_SOURCES
from .match_trust import provider_parts

POLICY = "coins-v2"
KINDS = {"pve", "daily", "weekly", "tutorial", "milestone", "bureau"}
REASONS = {"pve": "PVE_WIN", "daily": "DAILY_ACTIVITY", "weekly": "WEEKLY_COMMISSION",
           "tutorial": "TUTORIAL_ROUTE", "milestone": "CONTRACT_MILESTONE", "bureau": "BUREAU_OPERATION"}


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, "deadlock-economy-v2:" + ":".join(map(str, parts))))


def periods(at):
    day = aware(at).astimezone(timezone.utc).date()
    return day, day - timedelta(days=day.weekday())


def record_fact(db, user_id, kind, source_id, at, data=None):
    coins._lock_recipient(db, user_id)
    db.flush()
    fact_id = identity(user_id, kind, source_id)
    fact = db.get(EconomyActivity, fact_id)
    if fact is None:
        fact = EconomyActivity(id=fact_id, user_id=user_id, kind=kind, source_id=str(source_id),
                               occurred_at=aware(at), data=data or {})
        db.add(fact); db.flush()
    return fact


def _quota(db, user_id, source, kind, start):
    row = db.scalar(select(CoinQuota).where(CoinQuota.user_id == user_id, CoinQuota.source == source,
        CoinQuota.period_kind == kind, CoinQuota.period_start == start).with_for_update())
    if row is None:
        row = CoinQuota(user_id=user_id, source=source, period_kind=kind, period_start=start, used=0)
        db.add(row); db.flush()
    return row


def reserve(db, user_id, source_type, source_id, nominal, at, activity_ids, *, quota_source=None,
            daily_limit=None, weekly_limit=None, rule_data=None):
    if source_type not in KINDS:
        raise ValueError("Unknown economic source")
    if coins._lock_recipient(db, user_id) is None:
        return None
    db.flush()
    row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id,
        CoinEntitlement.source_type == source_type, CoinEntitlement.source_id == source_id).with_for_update())
    if row:
        return row
    day, week = periods(at)
    amount, reason = nominal, "AWARDED"
    quotas = []
    if daily_limit is not None:
        daily = _quota(db, user_id, quota_source, "DAY", day)
        quotas.append(daily)
        remaining = max(0, daily_limit - daily.used)
        if remaining < amount:
            amount, reason = remaining, "DAILY_LIMIT"
    if weekly_limit is not None:
        weekly = _quota(db, user_id, quota_source, "WEEK", week)
        quotas.append(weekly)
        remaining = max(0, weekly_limit - weekly.used)
        if remaining < amount:
            amount, reason = remaining, "WEEKLY_LIMIT"
    for quota in quotas:
        quota.used += amount
    row = CoinEntitlement(user_id=user_id, source_type=source_type, source_id=source_id,
        policy_version=POLICY, nominal_amount=nominal, amount=amount, eligible=True, reason=reason,
        period_day=day, period_week=week, status="RESERVED")
    db.add(row); db.flush()
    db.add(EconomyRewardContext(entitlement_id=row.id, activity_ids=list(activity_ids), rule_data=rule_data or {}))
    db.add(OutboxEvent(event_type="coin.reward", aggregate_id=row.id,
                       payload={"entitlement_id": row.id, "user_id": user_id}))
    db.flush()
    return row


def confirmed_contract_records(db, user_id):
    """Historical independent results count as progress, never retroactive coins."""
    user = db.get(User, user_id)
    if user is None or user.account_id is None:
        return []
    trusted_xp = exists(select(RewardLedgerEntry.id).where(RewardLedgerEntry.user_id == user_id,
        RewardLedgerEntry.source_id == BoardOption.id, RewardLedgerEntry.asset == "XP",
        RewardLedgerEntry.delta > 0, RewardLedgerEntry.source_type.in_(TRUSTED_REWARD_SOURCES)))
    signed_right = exists(select(CoinEntitlement.id).where(CoinEntitlement.user_id == user_id,
        CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id == BoardOption.id,
        CoinEntitlement.eligible.is_(True), CoinEntitlement.status.in_(["RESERVED", "DELIVERED"])))
    rows = db.execute(select(BoardOption, ContractBoard, Evaluation, Match)
        .join(ContractBoard, ContractBoard.id == BoardOption.board_id)
        .join(Evaluation, Evaluation.id == BoardOption.final_evaluation_id)
        .join(Match, Match.id == Evaluation.match_id)
        .join(MatchParticipant, (MatchParticipant.match_id == Match.id) & (MatchParticipant.account_id == user.account_id))
        .where(ContractBoard.user_id == user_id, BoardOption.selected.is_(True), BoardOption.status == "COMPLETED",
            BoardOption.settled_at.is_not(None), Evaluation.assignment_id == BoardOption.id,
            Evaluation.status == "COMPLETED", Match.is_final.is_(True), Match.scoring_status == "SCORED",
            trusted_xp | signed_right)).all()
    result = []
    for option, board, evaluation, match in rows:
        parts = provider_parts(match.provider)
        signed = option.locked_at or board.locked_at
        if (not parts or any(part not in coins.INDEPENDENT_PROVIDERS for part in parts)
                or match.integrity_status == "CLIENT_ATTESTED_GEP"
                or str(match.game_version or "").startswith("local-fixture")
                or not signed or not match.started_at or not match.ended_at
                or not aware(signed) <= aware(match.started_at) <= aware(match.ended_at) <= aware(board.expires_at)
                or option.bound_match_id != match.id or match.game_match_mode != option.required_game_match_mode
                or match.game_match_mode != board.game_match_mode or not evaluation.facts):
            continue
        required = set(option.required_capabilities or [])
        for condition in option.conditions or []:
            required.update(condition.get("capabilities") or [])
        if not required.issubset(set(match.capabilities or [])):
            continue
        if evaluation.evidence_level == "INTERNAL_REVIEW":
            review = next((f for f in evaluation.facts if f.get("source") == "internal_review"), {})
            if not all(review.get(k) for k in ("review_id", "decision_key", "decision_source", "reason_code")):
                continue
        correction = db.scalar(select(CoinEntitlement.status).where(CoinEntitlement.user_id == user_id,
            CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id == option.id))
        if correction in {"CORRECTED", "INVALIDATED", "REJECTED"}:
            continue
        result.append((option.id, aware(match.ended_at)))
    return sorted(set(result), key=lambda row: (row[1], row[0]))


def confirmed_contract_count(db, user_id):
    return len(confirmed_contract_records(db, user_id))


def _battle_valid(db, fact):
    from ..battle_models import BattleAssignment, BattleMatch
    match = db.get(BattleMatch, fact.source_id)
    if (not match or match.user_id != fact.user_id or match.scope != "REAL" or match.status != "FINISHED"
            or not match.completed_at or aware(match.completed_at) != aware(fact.occurred_at)):
        return False
    if fact.kind == "PVE":
        assignment = db.get(BattleAssignment, match.assignment_id) if match.assignment_id else None
        decision = db.scalar(select(CoinEntitlement.status).where(CoinEntitlement.user_id == fact.user_id,
            CoinEntitlement.source_type == "pve", CoinEntitlement.source_id == match.assignment_id))
        if decision in {"CORRECTED", "INVALIDATED", "REJECTED"}:
            return False
        return bool(match.mode in {"ASSIGNED", "HARD", "WEEKLY"} and match.outcome == "WIN" and match.reward_eligible
            and assignment and assignment.user_id == fact.user_id and assignment.scope == "REAL"
            and 1 <= assignment.slot <= 3 and assignment.status == "COMPLETED"
            and assignment.winning_match_id == match.id and assignment.period_day == periods(match.completed_at)[0])
    if fact.kind == "TUTORIAL":
        return match.mode == "TUTORIAL" and match.outcome == "WIN" and match.result.get("reason") != "SURRENDER"
    return (fact.kind == "NORMAL_BATTLE" and match.mode in {"TRAINING", "ASSIGNED", "HARD", "WEEKLY"}
            and match.result.get("reason") not in {"SURRENDER", "EXPIRED"})


def fact_valid(db, fact):
    if fact is None:
        return False
    if fact.kind == "CIPHER":
        row = db.get(ArchiveCipher, fact.source_id)
        return bool(row and row.user_id == fact.user_id and row.status in {"SOLVED", "ASSISTED"}
                    and row.completed_at and aware(row.completed_at) == aware(fact.occurred_at))
    if fact.kind == "CONTRACT":
        return any(source_id == fact.source_id for source_id, _ in confirmed_contract_records(db, fact.user_id))
    if fact.kind in {"PVE", "TUTORIAL", "NORMAL_BATTLE"}:
        return _battle_valid(db, fact)
    if fact.kind == "BUREAU":
        operation = db.get(BureauOperation, fact.source_id)
        if not operation or operation.status != "COMPLETED":
            return False
        confirmed = {key for key, _ in confirmed_contract_records(db, fact.user_id)}
        return bool(confirmed and db.scalar(select(BureauContribution.id).join(BureauOperationParticipant,
            BureauOperationParticipant.id == BureauContribution.participant_id).where(
                BureauOperationParticipant.operation_id == operation.id,
                BureauOperationParticipant.user_id == fact.user_id, BureauContribution.credited.is_(True),
                BureauContribution.source_option_id.in_(confirmed)).limit(1)))
    return False


def still_valid(db, row):
    context = db.get(EconomyRewardContext, row.id)
    if not context or not context.activity_ids:
        return False
    facts = [db.get(EconomyActivity, key) for key in context.activity_ids]
    valid_ids = _valid_fact_ids(db, [f for f in facts if f and f.user_id == row.user_id])
    valid = [fact for fact in facts if fact and fact.id in valid_ids]
    if len(valid) != len(facts):
        return False
    if row.source_type == "weekly":
        return (sum(f.kind == "CONTRACT" for f in valid) >= 5
                or sum(f.kind == "PVE" for f in valid) >= 10)
    if row.source_type == "milestone":
        return len(valid) >= context.rule_data.get("threshold", 10)
    if row.source_type == "tutorial":
        return {"TUTORIAL", "NORMAL_BATTLE"}.issubset({f.kind for f in valid})
    allowed = {"pve": {"PVE"}, "daily": {"CIPHER", "CONTRACT", "PVE"}, "bureau": {"BUREAU"}}
    return all(f.kind in allowed.get(row.source_type, set()) for f in valid)


def _facts(db, user_id, kinds, *, week=None):
    query = select(EconomyActivity).where(EconomyActivity.user_id == user_id, EconomyActivity.kind.in_(kinds))
    if week is not None:
        start = datetime.combine(week, time.min, tzinfo=timezone.utc)
        query = query.where(EconomyActivity.occurred_at >= start, EconomyActivity.occurred_at < start+timedelta(days=7))
    rows = [row for row in db.scalars(query.order_by(EconomyActivity.occurred_at, EconomyActivity.id))
            if not row.data.get("progress_only")]
    valid = _valid_fact_ids(db, rows)
    return [row for row in rows if row.id in valid]


def _valid_fact_ids(db, facts):
    """Validate large histories with batched source reads, not one query per win."""
    valid, contract_ids = set(), {}
    pve = [f for f in facts if f.kind == "PVE"]
    if pve:
        from ..battle_models import BattleAssignment, BattleMatch
        matches = db.execute(select(BattleMatch, BattleAssignment)
            .join(BattleAssignment, BattleAssignment.id == BattleMatch.assignment_id)
            .where(BattleMatch.id.in_([f.source_id for f in pve]), BattleMatch.scope == "REAL",
                BattleMatch.status == "FINISHED", BattleMatch.mode.in_(["ASSIGNED", "HARD", "WEEKLY"]),
                BattleMatch.outcome == "WIN", BattleMatch.reward_eligible.is_(True),
                BattleAssignment.scope == "REAL", BattleAssignment.status == "COMPLETED",
                BattleAssignment.slot.between(1, 3), BattleAssignment.match_id == BattleMatch.id,
                BattleAssignment.user_id == BattleMatch.user_id)).all()
        decisions = {(row.user_id, row.source_id): row.status for row in db.scalars(select(CoinEntitlement).where(
            CoinEntitlement.user_id.in_({f.user_id for f in pve}), CoinEntitlement.source_type == "pve"))}
        sources = {match.id: (match, assignment) for match, assignment in matches}
        for fact in pve:
            pair = sources.get(fact.source_id)
            if pair:
                match, assignment = pair
                if (match.user_id == fact.user_id and match.completed_at
                        and aware(match.completed_at) == aware(fact.occurred_at)
                        and assignment.period_day == periods(match.completed_at)[0]
                        and decisions.get((fact.user_id, assignment.id)) not in {"CORRECTED", "INVALIDATED", "REJECTED"}):
                    valid.add(fact.id)
    for fact in facts:
        if fact.kind == "PVE":
            continue
        if fact.kind == "CONTRACT":
            if fact.user_id not in contract_ids:
                contract_ids[fact.user_id] = {key for key, _ in confirmed_contract_records(db, fact.user_id)}
            if fact.source_id in contract_ids[fact.user_id]:
                valid.add(fact.id)
        elif fact_valid(db, fact):
            valid.add(fact.id)
    return valid


def eligible_pve_win_count(db, user_id):
    return len(_facts(db, user_id, {"PVE"}))


def _activity_benefits(db, fact):
    day, week = periods(fact.occurred_at)
    daily = reserve(db, fact.user_id, "daily", identity(fact.user_id, "daily", day), 10, fact.occurred_at,
        [fact.id], quota_source="DAILY", daily_limit=10, weekly_limit=70)
    facts = _facts(db, fact.user_id, {"CONTRACT", "PVE"}, week=week)
    contracts = [f for f in facts if f.kind == "CONTRACT"]
    pve = [f for f in facts if f.kind == "PVE"]
    qualifying = contracts[:5] if len(contracts) >= 5 else pve[:10] if len(pve) >= 10 else []
    if qualifying:
        reserve(db, fact.user_id, "weekly", identity(fact.user_id, "weekly", week), 60, fact.occurred_at,
            [f.id for f in qualifying], quota_source="WEEKLY", weekly_limit=60)
    return daily


def record_cipher(db, cipher):
    db.flush()
    if cipher.status not in {"SOLVED", "ASSISTED"} or not cipher.completed_at:
        return None
    fact = record_fact(db, cipher.user_id, "CIPHER", cipher.id, cipher.completed_at)
    row = _activity_benefits(db, fact)
    return coins._receipt(row)


def record_contract(db, entitlement):
    if not entitlement.eligible or entitlement.source_type != "assignment":
        return
    records = confirmed_contract_records(db, entitlement.user_id)
    played = dict(records).get(entitlement.source_id)
    if played is None:
        return
    fact = record_fact(db, entitlement.user_id, "CONTRACT", entitlement.source_id, played)
    _activity_benefits(db, fact)
    # Old verified contracts may satisfy a milestone, but cannot retroactively
    # produce daily/weekly rewards. Only this new accepted event triggers it.
    for threshold, amount in ((10, 50), (50, 100), (100, 150)):
        if len(records) >= threshold:
            chosen = [record_fact(db, entitlement.user_id, "CONTRACT", key, at, {"progress_only": True})
                      for key, at in records[:threshold]]
            reserve(db, entitlement.user_id, "milestone", identity(entitlement.user_id, "milestone", threshold),
                amount, played, [f.id for f in chosen], rule_data={"threshold": threshold})


def settle_battle(db, match):
    db.flush()
    if match.scope != "REAL" or match.status != "FINISHED" or not match.user_id or not match.completed_at:
        return None
    primary = None
    if match.mode in {"ASSIGNED", "HARD", "WEEKLY"} and match.outcome == "WIN" and match.reward_eligible:
        fact = record_fact(db, match.user_id, "PVE", match.id, match.completed_at)
        if fact_valid(db, fact):
            primary = reserve(db, match.user_id, "pve", match.assignment_id, 8, match.completed_at,
                [fact.id], quota_source="PVE", daily_limit=24, weekly_limit=120)
            _activity_benefits(db, fact)
    if match.mode in {"TUTORIAL", "TRAINING", "ASSIGNED", "HARD", "WEEKLY"}:
        kind = "TUTORIAL" if match.mode == "TUTORIAL" else "NORMAL_BATTLE"
        fact = record_fact(db, match.user_id, kind, match.id, match.completed_at)
        if fact_valid(db, fact):
            tutorial, normal = _facts(db, match.user_id, {"TUTORIAL"}), _facts(db, match.user_id, {"NORMAL_BATTLE"})
            normal = [f for f in normal if tutorial and aware(f.occurred_at) >= aware(tutorial[0].occurred_at)]
            if tutorial and normal:
                route = reserve(db, match.user_id, "tutorial", identity(match.user_id, "tutorial"), 60,
                    match.completed_at, [tutorial[0].id, normal[0].id])
                primary = primary or route
    return coins._receipt(primary) if primary else None


def record_assignment(db, assignment_id):
    db.flush()
    option = db.get(BoardOption, assignment_id)
    board = db.get(ContractBoard, option.board_id) if option else None
    row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == board.user_id,
        CoinEntitlement.source_type == "assignment", CoinEntitlement.source_id == assignment_id)) if board else None
    if row and coins._still_valid(db, row):
        record_contract(db, row)


def battle_receipt(db, match_id, user_id):
    from ..battle_models import BattleMatch
    match = db.get(BattleMatch, match_id)
    if match and match.user_id == user_id and match.assignment_id:
        row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id,
            CoinEntitlement.source_type == "pve", CoinEntitlement.source_id == match.assignment_id))
        context = db.get(EconomyRewardContext, row.id) if row else None
        if row and context and identity(user_id, "PVE", match_id) in context.activity_ids:
            return coins._receipt(row)
    row = db.scalar(select(CoinEntitlement).where(CoinEntitlement.user_id == user_id,
        CoinEntitlement.source_type == "tutorial", CoinEntitlement.source_id == identity(user_id, "tutorial")))
    if row:
        context = db.get(EconomyRewardContext, row.id)
        fact_id = identity(user_id, "NORMAL_BATTLE", match_id)
        if context and fact_id in context.activity_ids:
            return coins._receipt(row)
    return None


def record_bureau(db, operation):
    """Called by maintenance, never by GET reconciliation or profile rendering."""
    db.flush()
    participants = list(db.scalars(select(BureauOperationParticipant).where(
        BureauOperationParticipant.operation_id == operation.id, BureauOperationParticipant.user_id.is_not(None))
        .order_by(BureauOperationParticipant.user_id)))
    facts = list(db.scalars(select(EconomyActivity).where(EconomyActivity.kind == "BUREAU",
        EconomyActivity.source_id == operation.id).order_by(EconomyActivity.user_id)))
    for user_id in sorted({fact.user_id for fact in facts} | {person.user_id for person in participants}):
        coins._lock_recipient(db, user_id)
    fact_ids = {fact.id for fact in facts}
    if facts:
        rights = list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.source_type == "bureau",
            CoinEntitlement.user_id.in_({fact.user_id for fact in facts}),
            CoinEntitlement.status.in_(["RESERVED", "DELIVERED"])).order_by(CoinEntitlement.user_id)))
        for right in rights:
            context = db.get(EconomyRewardContext, right.id)
            if context and fact_ids.intersection(context.activity_ids) and not still_valid(db, right):
                coins.correct_entitlement(db, right.id, request_key=identity("bureau-reconcile", operation.id, right.id),
                    actor_user_id=None, reason="Verified bureau operation or personal contribution revoked", _cascade=False)
    if operation.status != "COMPLETED" or not operation.completed_at:
        return
    for participant in participants:
        fact = record_fact(db, participant.user_id, "BUREAU", operation.id, operation.completed_at)
        if fact_valid(db, fact):
            _, week = periods(fact.occurred_at)
            reserve(db, participant.user_id, "bureau", identity(participant.user_id, "bureau", week), 40,
                    fact.occurred_at, [fact.id], quota_source="BUREAU", weekly_limit=40)


def corrected_dependents(db, original, correction):
    result = []
    for row in list(db.scalars(select(CoinEntitlement).where(CoinEntitlement.user_id == original.user_id,
            CoinEntitlement.source_type.in_(KINDS), CoinEntitlement.status.in_(["RESERVED", "DELIVERED"])))):
        # A nested correction may already have reversed another row in this
        # materialized list; never correct the same dependent twice.
        if row.status in {"RESERVED", "DELIVERED"} and not still_valid(db, row):
            result.append(coins.correct_entitlement(db, row.id,
                request_key=identity("correction", correction.id, row.id),
                actor_user_id=correction.actor_user_id, reason=correction.reason, _cascade=False))
    return result


def status(db, user_id, *, now=None):
    now = aware(now or utcnow()).astimezone(timezone.utc)
    day, week = periods(now)
    limits = {"PVE": (24, 120), "DAILY": (10, 70), "WEEKLY": (None, 60), "BUREAU": (None, 40)}
    quotas = {}
    for source, (daily, weekly) in limits.items():
        quotas[source] = {}
        for label, kind, start, maximum, reset in (("daily", "DAY", day, daily, day + timedelta(days=1)),
                ("weekly", "WEEK", week, weekly, week + timedelta(days=7))):
            if maximum is None:
                continue
            used = db.scalar(select(CoinQuota.used).where(CoinQuota.user_id == user_id,
                CoinQuota.source == source, CoinQuota.period_kind == kind, CoinQuota.period_start == start)) or 0
            quotas[source][label] = {"limit": maximum, "used": used, "remaining": max(0, maximum-used),
                "reset_at": datetime.combine(reset, time.min, tzinfo=timezone.utc).isoformat()}
    facts = _facts(db, user_id, {"CONTRACT", "PVE"}, week=week)
    lifetime_pve = _facts(db, user_id, {"PVE"})
    return {"source_quotas": quotas, "regular_weekly_maximum": 840,
        "progress": {"confirmed_contracts": confirmed_contract_count(db, user_id),
            "eligible_pve_wins": len(lifetime_pve), "weekly_contracts": sum(f.kind == "CONTRACT" for f in facts),
            "weekly_pve_wins": sum(f.kind == "PVE" for f in facts)}}
