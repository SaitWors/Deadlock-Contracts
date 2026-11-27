from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil
from statistics import median

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    BoardOption,
    CompanionEvent,
    CompanionMatchEvidence,
    ContractBoard,
    ContractRelayConnection,
    Evaluation,
    Match,
    utcnow,
)
from ..relay_measurement_models import RelayMatchObservation
from .gep_settlement import GEP_INTEGRITY_CLIENT_ATTESTED
from .public_badges import stored_public_badges
from .relay_state import FRESHNESS, connection_status

MAX_OBSERVATIONS = 5000


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _relay_observation(db: Session, board: ContractBoard, match: Match, observed_at: datetime) -> tuple[str, bool | None]:
    connection = db.scalar(select(ContractRelayConnection).where(ContractRelayConnection.user_id == board.user_id))
    if connection is None:
        # There are no historical consent intervals. The baseline describes the
        # binding-time observation and cannot establish past non-participation.
        return "baseline", None
    if match.started_at is None or _utc(connection.consented_at) > _utc(match.started_at):
        return "unknown", None

    state = connection_status(db, connection)
    checked = state.get("friendship_observed_at")
    if state.get("status") != "connected" or not checked:
        return "unknown", None
    started = _utc(match.started_at)
    observed = _utc(datetime.fromisoformat(checked))
    cohort = "eligible" if started - timedelta(hours=24) <= observed <= started else "unknown"
    priority_streamer = None
    if (board.user.status == "ACTIVE" and not board.user.relay_auto_enrollment_blocked
            and state.get("friendship_source") in ("steam_session", "steam_web_api")
            and _utc(observed_at) - FRESHNESS <= observed <= _utc(observed_at)):
        priority_streamer = "STREAMER" in stored_public_badges(board.user)
    return cohort, priority_streamer


def record_bound_attempt(db: Session, board: ContractBoard, match: Match, observed_at: datetime) -> None:
    """Snapshot new, provider-verified attempts in the transaction binding them."""
    if not (match.provider == "deadlock_api" and match.integrity_status == "SERVER_VERIFIED"):
        return
    cohort, priority_streamer = _relay_observation(db, board, match, observed_at)
    db.add(RelayMatchObservation(
        board_id=board.id,
        match_id=match.id,
        observed_at=observed_at,
        relay_cohort=cohort,
        priority_streamer=priority_streamer,
    ))


def _duration(ended: datetime, observed: datetime | None, cutoff: datetime) -> float | None:
    if observed is None or not _utc(ended) <= _utc(observed) <= cutoff:
        return None
    return (_utc(observed) - _utc(ended)).total_seconds()


def _statistics(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "observed_count": len(ordered),
        "median_seconds": round(median(ordered), 3) if ordered else None,
        "p90_seconds": round(ordered[ceil(len(ordered) * 0.9) - 1], 3) if ordered else None,
    }


def summary(db: Session, start: datetime, end: datetime, *, now: datetime | None = None) -> dict:
    """Summarize prospective, visible board/match attempts ending in [start, end)."""
    start, end, cutoff = _utc(start), _utc(end), _utc(now or utcnow())
    if start >= end:
        raise ValueError("start must precede end")

    # An automated final decision counts for pass and fail. Internal review and
    # intermediate retry evaluations are excluded. Use the first final contract
    # decision when one attempt evaluated multiple selected contracts.
    settled = (
        select(BoardOption.settled_at)
        .join(Evaluation, Evaluation.id == BoardOption.final_evaluation_id)
        .where(
            BoardOption.board_id == RelayMatchObservation.board_id,
            BoardOption.selected.is_(True),
            BoardOption.status.in_(("COMPLETED", "FAILED")),
            Evaluation.match_id == RelayMatchObservation.match_id,
            Evaluation.evidence_level == "VERIFIED_SUMMARY",
            BoardOption.settled_at >= Match.ended_at,
            BoardOption.settled_at <= cutoff,
        )
        .correlate(RelayMatchObservation, Match)
    )
    first_settled = settled.with_only_columns(func.min(BoardOption.settled_at)).scalar_subquery()
    confirmed_contracts = settled.with_only_columns(func.count(BoardOption.id)).scalar_subquery()
    companion_terminal = (
        select(CompanionEvent.id)
        .where(
            CompanionEvent.user_id == ContractBoard.user_id,
            CompanionEvent.external_match_id == Match.external_match_id,
            CompanionEvent.created_at <= cutoff,
            CompanionEvent.payload["identity_ok"].as_boolean().is_(True),
            CompanionEvent.payload["session"]["match_clock_s"].as_integer().between(1, 6 * 60 * 60),
            or_(
                CompanionEvent.event_type == "match_ended",
                CompanionEvent.payload["session"]["ended_at"].as_string().is_not(None)
                & CompanionEvent.payload["session"]["end_reason"].as_string().in_(("match_end", "phase_postgame")),
            ),
        )
        .correlate(ContractBoard, Match)
        .exists()
    )
    companion_finalized = (
        select(CompanionMatchEvidence.id)
        .where(
            CompanionMatchEvidence.user_id == ContractBoard.user_id,
            CompanionMatchEvidence.external_match_id == Match.external_match_id,
            CompanionMatchEvidence.evidence_schema_version >= 9,
            CompanionMatchEvidence.integrity_status == GEP_INTEGRITY_CLIENT_ATTESTED,
            CompanionMatchEvidence.server_finalized_at <= cutoff,
        )
        .correlate(ContractBoard, Match)
        .exists()
    )
    source = (
        select(
            RelayMatchObservation.relay_cohort,
            Match.game_match_mode,
            Match.ended_at,
            Match.relay_provider_metadata_observed_at,
            first_settled,
            or_(companion_terminal, companion_finalized),
            RelayMatchObservation.priority_streamer,
            confirmed_contracts,
        )
        .select_from(RelayMatchObservation)
        .join(ContractBoard, ContractBoard.id == RelayMatchObservation.board_id)
        .join(Match, Match.id == RelayMatchObservation.match_id)
        .where(
            RelayMatchObservation.observed_at <= cutoff,
            Match.ended_at >= start,
            Match.ended_at < end,
            Match.ended_at <= cutoff,
        )
        .order_by(Match.ended_at.desc(), RelayMatchObservation.board_id, RelayMatchObservation.match_id)
        .limit(MAX_OBSERVATIONS + 1)
    )
    rows = db.execute(source).all()
    ended_unknown = db.scalar(
        select(func.count())
        .select_from(RelayMatchObservation)
        .join(Match, Match.id == RelayMatchObservation.match_id)
        .where(
            RelayMatchObservation.observed_at >= start,
            RelayMatchObservation.observed_at < end,
            RelayMatchObservation.observed_at <= cutoff,
            Match.ended_at.is_(None),
        )
    )
    truncated = len(rows) > MAX_OBSERVATIONS
    cohorts = defaultdict(list)
    priority_rows = defaultdict(list)
    for relay, mode, ended_at, metadata_at, settled_at, companion, streamer, confirmed in rows[:MAX_OBSERVATIONS]:
        discovery = _duration(ended_at, metadata_at, cutoff)
        verification = _duration(ended_at, settled_at, cutoff)
        cohorts[relay, "observed" if companion else "unobserved", mode].append((discovery, verification))
        if streamer is not None or relay != "baseline":
            priority_rows[streamer].append((discovery, verification, confirmed))

    groups = []
    for (relay, companion, mode), durations in sorted(cohorts.items()):
        discoveries = [discovery for discovery, _ in durations if discovery is not None]
        verifications = [verification for _, verification in durations if verification is not None]
        after_discovery = [
            verification - discovery
            for discovery, verification in durations
            if discovery is not None and verification is not None and verification >= discovery
        ]
        groups.append({
            "relay": relay,
            "companion": companion,
            "mode": mode,
            "sample_size": len(durations),
            "metadata_unobserved_count": len(durations) - len(discoveries),
            "unresolved_count": len(durations) - len(verifications),
            "confirmed_share": round(len(verifications) / len(durations), 4),
            "discovery": _statistics(discoveries),
            "verification": _statistics(verifications),
            "after_discovery": _statistics(after_discovery),
        })

    return {
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "observed_until": cutoff.isoformat(),
        "sample_size": min(len(rows), MAX_OBSERVATIONS),
        "unknown_match_end_count": ended_unknown,
        "truncated": truncated,
        "quota_at_match_time": "unobserved",
        "cohorts": groups,
        "priority_cohorts": [
            {
                "streamer": streamer,
                "sample_size": len(samples),
                "confirmed_contracts": sum(count for _, _, count in samples),
                "discovery": _statistics([value for value, _, _ in samples if value is not None]),
                "verification": _statistics([value for _, value, _ in samples if value is not None]),
            }
            for streamer in (True, False, None)
            if (samples := priority_rows[streamer])
        ],
    }
