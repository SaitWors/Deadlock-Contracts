"""UTC activity and activation metrics drawn from browser visits and committed domain records."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from itertools import groupby
from statistics import median

from sqlalchemy import delete, func, literal, select, union_all
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..foundation_analytics_models import FoundationAnalyticsEvent as Event
from ..models import ArchiveOperation, BoardOption, ContractBoard, Evaluation, User, utcnow
from .archive import aware

DETAIL_RETENTION_DAYS = 90
COHORT_DAYS = 30
ACTIVATION_DAYS = 7
SESSION_GAP = timedelta(minutes=30)
PACK_SESSION_EVENTS = frozenset({"session_started", "daily_pack_claimed"})


def _utc(value: datetime) -> datetime:
    return aware(value).astimezone(timezone.utc)


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, timezone.utc)


def _pack_claims():
    operation = ArchiveOperation
    return (
        operation.scope == "REAL",
        operation.kind == "DAILY_PACK",
        operation.benefit_key.is_not(None),
    )


def record_event(db: Session, user_id: str, event_id: str, name: str, now: datetime) -> None:
    insert = postgres_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(
        insert(Event)
        .values(user_id=user_id, event_id=event_id, name=name, occurred_at=now)
        .on_conflict_do_nothing(index_elements=[Event.user_id, Event.event_id])
    )


def onboarding_verified(db: Session, user_id: str, now: datetime) -> bool:
    started = db.scalar(select(Event.occurred_at).where(
        Event.user_id == user_id, Event.name == "onboarding_started",
        Event.occurred_at >= now - timedelta(days=DETAIL_RETENTION_DAYS),
    ).limit(1))
    if started is None:
        return False
    verified = db.scalar(select(ContractBoard.id).where(
        ContractBoard.user_id == user_id,
        ContractBoard.locked_at.is_not(None),
        (
            ContractBoard.completion_result.is_not(None)
            | select(Evaluation.id).join(BoardOption, BoardOption.final_evaluation_id == Evaluation.id).where(
                BoardOption.board_id == ContractBoard.id,
                BoardOption.selected.is_(True),
                Evaluation.status.in_(("COMPLETED", "FAILED")),
            ).exists()
        ),
    ).limit(1))
    claim = db.scalar(select(ArchiveOperation.id).where(
        ArchiveOperation.user_id == user_id, *_pack_claims(),
    ).limit(1))
    return verified is not None and claim is not None


def purge_expired_events(db: Session, now: datetime | None = None) -> None:
    cutoff = (now or utcnow()) - timedelta(days=DETAIL_RETENTION_DAYS)
    db.execute(delete(Event).where(Event.occurred_at < cutoff))


def purge_account_events(db: Session, user_id: str) -> None:
    db.execute(delete(Event).where(Event.user_id == user_id))


def last_foundation_activity(db: Session, user_id: str, before: datetime) -> datetime | None:
    recent = db.scalar(select(func.max(Event.occurred_at)).where(
        Event.user_id == user_id,
        Event.occurred_at < before,
        Event.occurred_at >= before - timedelta(days=DETAIL_RETENTION_DAYS),
    ))
    return _utc(recent) if recent else None


def _activity_rows(db: Session, start: datetime, end: datetime):
    sources = union_all(
        select(Event.user_id.label("user_id"), Event.occurred_at.label("at"), Event.name.label("name"))
        .where(Event.occurred_at >= start, Event.occurred_at < end),
        select(ContractBoard.user_id, ContractBoard.locked_at, literal("case_signed"))
        .where(ContractBoard.locked_at >= start, ContractBoard.locked_at < end),
        select(ArchiveOperation.user_id, ArchiveOperation.created_at, literal("daily_pack_claimed"))
        .where(*_pack_claims(), ArchiveOperation.created_at >= start, ArchiveOperation.created_at < end),
    ).subquery()
    # Stream the indexed time window. Counts are by account, never browser tab.
    return db.execute(
        select(sources.c.user_id, sources.c.at, sources.c.name)
        .join(User, User.id == sources.c.user_id)
        .where(User.steam_id64.is_not(None))
        .order_by(sources.c.user_id, sources.c.at, sources.c.name)
        .execution_options(yield_per=1000)
    )


def _counts(players: int = 0, eligible: int = 0) -> dict[str, int]:
    return {"players": players, "eligible": eligible}


def _empty(end: datetime) -> dict:
    return {
        "observation_start": None,
        "window_end": end.isoformat(),
        "activity": {"dau": None, "wau": None, "mau": None},
        "retention": {f"d{days}": _counts() for days in (1, 7, 30)},
        "first_contract": _counts(),
        "first_completion": _counts(),
        "second_contract": _counts(),
        "median_first_contract_seconds": None,
        "contracts_per_player": None,
        "pack_only_sessions": {"sessions": 0, "eligible": 0},
        "onboarding_completion": _counts(),
    }


def _session_counts(sessions, start: datetime, end: datetime) -> tuple[int, int]:
    """Count sessions that start in the window and have a fully elapsed idle timeout."""
    eligible = pack_only = 0
    first_at = prior = None
    names: set[str] = set()
    for at, name in sessions:
        if prior is None or at - prior >= SESSION_GAP:
            if first_at is not None and start <= first_at < end:
                eligible += 1
                pack_only += "daily_pack_claimed" in names and names <= PACK_SESSION_EVENTS
            first_at = at
            names.clear()
        prior = at
        names.add(name)
    if first_at is not None and start <= first_at and prior + SESSION_GAP <= end:
        eligible += 1
        pack_only += "daily_pack_claimed" in names and names <= PACK_SESSION_EVENTS
    return pack_only, eligible


def foundation_metrics(db: Session, now: datetime | None = None) -> dict:
    end = _day_start(_utc(now or utcnow()).date())
    result = _empty(end)
    first_at = db.scalar(select(func.min(Event.occurred_at)).where(
        Event.occurred_at >= end - timedelta(days=DETAIL_RETENTION_DAYS),
    ))
    if first_at is None:
        return result
    # The first recorded UTC day can be partial. No historical backfill.
    observation_start = _day_start(_utc(first_at).date() + timedelta(days=1))
    result["observation_start"] = observation_start.isoformat()
    start = max(observation_start, end - timedelta(days=COHORT_DAYS + 30))
    if start >= end:
        return result

    active_by_day: dict[date, set[str]] = defaultdict(set)
    signed: dict[str, list[datetime]] = defaultdict(list)
    onboarding: dict[str, dict[str, datetime]] = defaultdict(dict)
    month_start = end - timedelta(days=30)
    month_cases = pack_only = sessions = 0
    for user_id, rows in groupby(_activity_rows(db, start - SESSION_GAP, end), lambda row: row.user_id):
        timeline = []
        for _, timestamp, name in rows:
            at = _utc(timestamp)
            active_by_day[at.date()].add(user_id)
            if name == "case_signed":
                signed[user_id].append(at)
                month_cases += at >= month_start
            if name in {"onboarding_started", "onboarding_completed"}:
                onboarding[user_id].setdefault(name, at)
            # Include one inactivity interval before the window to avoid
            # interpreting a carry-over session as a newly started session.
            if at >= month_start - SESSION_GAP:
                timeline.append((at, name))
        player_pack_only, player_sessions = _session_counts(timeline, month_start, end)
        pack_only += player_pack_only
        sessions += player_sessions

    for label, days in (("dau", 1), ("wau", 7), ("mau", 30)):
        window_start = end - timedelta(days=days)
        if observation_start <= window_start:
            active = set().union(*(players for day, players in active_by_day.items() if day >= window_start.date()))
            result["activity"][label] = len(active)
    if result["activity"]["mau"]:
        result["contracts_per_player"] = round(month_cases / result["activity"]["mau"], 2)
    if observation_start <= month_start:
        result["pack_only_sessions"] = {"sessions": pack_only, "eligible": sessions}

    accounts = [(user_id, _utc(created_at)) for user_id, created_at in db.execute(
        select(User.id, User.created_at).where(
            User.steam_id64.is_not(None), User.created_at >= start, User.created_at < end,
        ),
    )]
    for days in (1, 7, 30):
        cohort_end = end - timedelta(days=days)
        cohort_start = cohort_end - timedelta(days=COHORT_DAYS)
        eligible = [(user_id, joined.date() + timedelta(days=days)) for user_id, joined in accounts
                    if cohort_start <= joined < cohort_end]
        result["retention"][f"d{days}"] = _counts(
            sum(user_id in active_by_day[return_day] for user_id, return_day in eligible), len(eligible),
        )

    _activation_metrics(db, result, accounts, signed, onboarding, start, end)
    return result


def _activation_metrics(db, result, accounts, signed, onboarding, start, end) -> None:
    observation = timedelta(days=ACTIVATION_DAYS)
    cohort_end = end - observation
    cohort_start = cohort_end - timedelta(days=COHORT_DAYS)
    enrolled = {user_id: joined for user_id, joined in accounts if cohort_start <= joined < cohort_end}
    completions = defaultdict(list)
    for user_id, settled_at in db.execute(
        select(ContractBoard.user_id, func.max(BoardOption.settled_at))
        .join(BoardOption, BoardOption.board_id == ContractBoard.id)
        .join(User, User.id == ContractBoard.user_id)
        .where(
            User.steam_id64.is_not(None), User.created_at >= max(start, cohort_start), User.created_at < cohort_end,
            ContractBoard.status == "SETTLED", ContractBoard.completion_result.is_not(None),
            ContractBoard.locked_at >= max(start, cohort_start),
            BoardOption.selected.is_(True),
        )
        .group_by(ContractBoard.id, ContractBoard.user_id)
    ):
        if settled_at is not None:
            completions[user_id].append(_utc(settled_at))
    first_times = []
    completed = repeat = 0
    for user_id, joined in enrolled.items():
        deadline = joined + observation
        signatures = [at for at in signed[user_id] if joined <= at < deadline]
        completed += any(joined <= at < deadline for at in completions[user_id])
        if signatures:
            first_times.append((signatures[0] - joined).total_seconds())
            repeat += len(signatures) > 1
    result["first_contract"] = _counts(len(first_times), len(enrolled))
    result["first_completion"] = _counts(completed, len(enrolled))
    result["second_contract"] = _counts(repeat, len(first_times))
    result["median_first_contract_seconds"] = round(median(first_times)) if first_times else None

    starts = finishes = 0
    for events in onboarding.values():
        started = events.get("onboarding_started")
        finished = events.get("onboarding_completed")
        if started is not None and cohort_start <= started < cohort_end:
            starts += 1
            finishes += finished is not None and started <= finished < started + observation
    result["onboarding_completion"] = _counts(finishes, starts)
