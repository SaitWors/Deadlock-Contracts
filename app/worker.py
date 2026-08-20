from __future__ import annotations

import json
import logging
import os
import socket
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine
from .models import (
    AutoReviewCase,
    BoardOption,
    CompanionEvent,
    CompanionMatchEvidence,
    ContractBoard,
    Job,
    Match,
    MatchParticipant,
    OutboxEvent,
    RewardLedgerEntry,
    User,
)
from .services.evaluator import capability_available, evaluate_board
from .services.jobs import claim_next_job, complete_job, enqueue_job, retry_job
from .services.providers import DeadlockApiProvider, ProviderError, ProviderRateLimited
from .services.seed import seed_missions
from .services.schema import ensure_v03_schema

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("deadlock-contracts-worker")
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"


class NoMatchYet(RuntimeError):
    pass


class CompanionMatchNotReady(RuntimeError):
    pass


class FinalFactsPending(RuntimeError):
    """Final match exists, but contract-grade provider facts are still lagging."""

    def __init__(self, message: str, delay_seconds: int = 20) -> None:
        super().__init__(message)
        self.delay_seconds = max(5, int(delay_seconds))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _startup_repair_bound_match_ids(options: list[BoardOption]) -> list[str]:
    """Return exact matches that still have stalled selected assignments.

    Selected assignments are historical across attempts: a completed contract
    can remain selected and bound to match N while another selected contract
    is still REVIEW_REQUIRED/VERIFYING on match N+1. Startup recovery must not
    require all selected assignments to share a single Match ID.
    """
    return sorted({
        option.bound_match_id
        for option in options
        if option.bound_match_id
        and str(option.status or "").upper() in {"REVIEW_REQUIRED", "VERIFYING"}
    })



def _resolve_settled_waiting_provider_reviews(db: Session) -> int:
    """Close deferred review rows that are stale after automatic settlement.

    WAITING_PROVIDER protects an in-flight automatic refresh from a racing
    human decision. Once the board is SETTLED, the row is historical only and
    must be marked RESOLVED so the admin queue reflects reality.
    """
    items = list(
        db.scalars(
            select(AutoReviewCase)
            .join(ContractBoard, ContractBoard.id == AutoReviewCase.board_id)
            .where(
                AutoReviewCase.status == "WAITING_PROVIDER",
                AutoReviewCase.reviewer_id.is_(None),
                ContractBoard.status == "SETTLED",
            )
        ).all()
    )
    if not items:
        return 0
    now = utcnow()
    for item in items:
        item.status = "RESOLVED"
        item.reviewer_note = (
            "Закрыто автоматически после получения итоговых данных "
            "провайдера и завершения дела."
        )
        item.reviewed_at = now
    return len(items)

def init() -> None:
    settings.validate()
    Base.metadata.create_all(engine)
    ensure_v03_schema(engine)
    with SessionLocal() as db:
        seed_missions(db)
        stale_before = utcnow() - timedelta(minutes=10)
        stale = list(db.scalars(select(Job).where(Job.status == "RUNNING", Job.locked_at < stale_before)).all())
        for job in stale:
            job.status = "PENDING"
            job.run_after = utcnow()
            job.last_error = "Recovered stale RUNNING job"

        # v0.3.3 could keep a correctly identified match waiting forever when
        # one capability (for example summary.object_damage) never appeared.
        # Wake only those legacy stuck jobs once so v0.3.4 can bind the match
        # and route missing facts to per-contract internal review.
        legacy_stuck = list(
            db.scalars(
                select(Job).where(
                    Job.type == "discover_match",
                    Job.status == "PENDING",
                    Job.last_error.is_not(None),
                )
            ).all()
        )
        for job in legacy_stuck:
            error = (job.last_error or "").lower()
            if "матч найден" in error or "summary." in error or "нужные показатели" in error:
                job.run_after = utcnow()

        # v0.3.4 did not know the production-observed Street Brawl enum
        # (match_mode=1, game_mode=4). Requeue every still-active Brawl board
        # immediately so already played matches can settle after this upgrade.
        brawl_jobs = list(
            db.scalars(
                select(Job).where(
                    Job.type == "discover_match",
                    Job.status.in_(("PENDING", "FAILED")),
                )
            ).all()
        )
        for job in brawl_jobs:
            board_id = str((job.payload or {}).get("board_id") or "")
            board = db.get(ContractBoard, board_id) if board_id else None
            if not board or board.game_match_mode != "STREET_BRAWL" or board.status not in {"LOCKED", "VERIFYING"}:
                continue
            selected = list(db.scalars(select(BoardOption).where(BoardOption.board_id == board.id, BoardOption.selected.is_(True))).all())
            if not selected or any(option.bound_match_id for option in selected):
                continue
            job.status = "PENDING"
            job.attempts = 0
            job.run_after = utcnow()
            job.locked_at = None
            job.locked_by = None
            job.last_error = "Requeued by v0.3.5 Street Brawl resolver fix"

        # 0.9.9 could leave a board in REVIEW_REQUIRED after its review case
        # was already resolved, when another retryable contract remained LOCKED.
        # Restore those boards to LOCKED and queue discovery for the next game.
        resume_after_review: list[str] = []
        review_boards = list(
            db.scalars(
                select(ContractBoard).where(
                    ContractBoard.status == "REVIEW_REQUIRED"
                )
            ).all()
        )
        final_statuses = {"COMPLETED", "FAILED", "VOID", "EXPIRED"}
        for board in review_boards:
            selected = list(
                db.scalars(
                    select(BoardOption).where(
                        BoardOption.board_id == board.id,
                        BoardOption.selected.is_(True),
                    )
                ).all()
            )
            if not selected or any(
                option.status == "REVIEW_REQUIRED" for option in selected
            ):
                continue
            if all(option.status in final_statuses for option in selected):
                board.status = "SETTLED"
                continue
            if (
                int(board.attempts_used or 0) < int(board.max_attempts or 0)
                and any(option.status == "LOCKED" for option in selected)
            ):
                bound_ids = [
                    option.bound_match_id for option in selected
                    if option.bound_match_id
                ]
                if bound_ids:
                    matches = list(
                        db.scalars(
                            select(Match).where(Match.id.in_(bound_ids))
                        ).all()
                    )
                    if matches:
                        board.baseline_match_id = max(
                            int(board.baseline_match_id or 0),
                            max(int(match.external_match_id) for match in matches),
                        )
                board.status = "LOCKED"
                resume_after_review.append(board.id)

        db.commit()
        for board_id in resume_after_review:
            active = list(
                db.scalars(
                    select(Job).where(
                        Job.type == "discover_match",
                        Job.status.in_(("PENDING", "RUNNING")),
                    )
                ).all()
            )
            if any(
                str((item.payload or {}).get("board_id") or "") == board_id
                for item in active
            ):
                continue
            enqueue_job(
                db,
                "discover_match",
                {"board_id": board_id},
                f"discover:{board_id}:review-repair:0.9.10",
                max_attempts=settings.max_discovery_attempts,
            )

        # RC1 allowed the manual sync button to create many discovery jobs for
        # one board. Keep exactly one active job per board to avoid wasting the
        # provider's rate limit and producing conflicting diagnostics.
        active_discovery = list(
            db.scalars(
                select(Job)
                .where(Job.type == "discover_match", Job.status.in_(("PENDING", "RUNNING")))
                .order_by(Job.created_at.asc())
            ).all()
        )
        seen_boards: set[str] = set()
        for job in active_discovery:
            board_id = str((job.payload or {}).get("board_id") or "")
            if not board_id:
                continue
            if board_id in seen_boards:
                job.status = "DONE"
                job.last_error = "Deduplicated during 0.9.1-rc2 startup"
                job.locked_at = None
                job.locked_by = None
            else:
                seen_boards.add(board_id)
        db.commit()

        # 0.9.15-rc3/rc4 treated match_outcome as terminal. Deadlock GEP can
        # retain the previous match outcome after a new current Match ID appears,
        # so repair every non-final board that already has a *strong* terminal
        # event (PostGame/End/match_ended/session end). final-v3 uses a new
        # idempotency key so a previously completed premature final-v2 job cannot
        # suppress the real terminal repair.
        review_boards = list(
            db.scalars(
                select(ContractBoard).where(
                    ContractBoard.status.in_(("REVIEW_REQUIRED", "VERIFYING"))
                )
            ).all()
        )
        finality_repairs_queued = 0
        finality_repair_matches = 0
        for board in review_boards:
            user = db.get(User, board.user_id)
            if not user or user.account_id is None:
                continue
            selected = list(
                db.scalars(
                    select(BoardOption).where(
                        BoardOption.board_id == board.id,
                        BoardOption.selected.is_(True),
                    )
                ).all()
            )

            # A board can legitimately keep historical selected assignments
            # bound to older attempts after other assignments move on.
            # Production board b04c... had three selected assignments spanning
            # matches 99514255 and 99529660; only the latter assignment was
            # still REVIEW_REQUIRED. rc6/rc7 collapsed every selected
            # bound_match_id into one set and skipped the whole board whenever
            # that set contained more than one historical match.
            #
            # Repair only *currently stalled* assignments and do it per exact
            # bound Match ID. Completed/failed/void/expired historical
            # assignments are intentionally ignored.
            repair_bound_ids = _startup_repair_bound_match_ids(selected)
            if not repair_bound_ids:
                log.info(
                    "Startup finality repair skipped board=%s: "
                    "no stalled selected assignment with a bound match",
                    board.id,
                )
                continue

            for bound_match_id in repair_bound_ids:
                match = db.get(Match, bound_match_id)
                if not match:
                    log.warning(
                        "Startup finality repair skipped board=%s match_db_id=%s: "
                        "bound match row missing",
                        board.id,
                        bound_match_id,
                    )
                    continue
                finality_repair_matches += 1
                finalization = _companion_finalization_from_events(
                    db, user, int(match.external_match_id)
                )
                if not finalization:
                    log.warning(
                        "Startup finality repair skipped board=%s match=%s: "
                        "no authenticated terminal evidence",
                        board.id,
                        match.external_match_id,
                    )
                    continue
                key = f"companion-resolve-auto-final-v6-outcome-v7:{user.id}:{match.external_match_id}"
                existed = db.scalar(select(Job).where(Job.idempotency_key == key))
                enqueue_job(
                    db,
                    "resolve_companion_match_auto",
                    {
                        "user_id": user.id,
                        "external_match_id": int(match.external_match_id),
                        "detected_at": (match.started_at or utcnow()).isoformat(),
                        "final_signal": True,
                        "startup_repair": "0.10.1-alpha.7-outcome-v7",
                        "board_id": board.id,
                    },
                    key,
                    run_after=utcnow() + timedelta(seconds=max(0, settings.companion_finalization_grace_seconds)),
                    max_attempts=60,
                )
                if existed is None:
                    finality_repairs_queued += 1
        log.info(
            "Startup finality repair scan: boards=%s match_candidates=%s queued=%s",
            len(review_boards),
            finality_repair_matches,
            finality_repairs_queued,
        )
        resolved_waiting_reviews = _resolve_settled_waiting_provider_reviews(db)
        if resolved_waiting_reviews:
            log.info(
                "Startup review consistency cleanup: resolved_waiting_provider=%s",
                resolved_waiting_reviews,
            )
        db.commit()


def store_normalized_match(db: Session, data: dict) -> Match:
    # Monotonic upsert: sparse/weak payloads must never erase richer facts.
    external_match_id = int(data["external_match_id"])
    incoming_provider = str(data.get("provider") or "unknown")
    incoming_classifier = str(data.get("mode_classifier_version") or "unknown-v1")

    match = db.scalar(
        select(Match).where(Match.external_match_id == external_match_id)
    )
    if not match:
        match = Match(
            external_match_id=external_match_id,
            provider=incoming_provider,
            mode_classifier_version=incoming_classifier,
            game_match_mode="UNKNOWN",
        )
        db.add(match)
        db.flush()

    providers = []
    for source in (str(match.provider or ""), incoming_provider):
        for part in source.split("+"):
            part = part.strip()
            if part and part != "unknown" and part not in providers:
                providers.append(part)
    match.provider = ("+".join(providers) or incoming_provider or "unknown")[:64]

    for field in (
        "provider_payload_hash",
        "started_at",
        "ended_at",
        "duration_s",
        "provider_mode_raw",
        "scoring_status",
        "game_version",
    ):
        value = data.get(field)
        if value is not None and (not isinstance(value, str) or value.strip()):
            setattr(match, field, value)

    if "is_final" in data:
        match.is_final = bool(match.is_final) or bool(data.get("is_final"))

    rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
    incoming_conf = str(data.get("mode_confidence") or "LOW").upper()
    current_conf = str(match.mode_confidence or "LOW").upper()
    incoming_mode = str(data.get("game_match_mode") or "UNKNOWN").upper()
    current_mode = str(match.game_match_mode or "UNKNOWN").upper()
    valid_modes = {"STANDARD", "RANKED", "STREET_BRAWL"}
    gep_authoritative = "gep" in incoming_provider.lower()

    if incoming_mode in valid_modes and (
        current_mode not in valid_modes
        or gep_authoritative
        or rank.get(incoming_conf, 0) >= rank.get(current_conf, 0)
    ):
        match.game_match_mode = incoming_mode

    if rank.get(incoming_conf, 0) > rank.get(current_conf, 0):
        match.mode_confidence = incoming_conf

    if (
        incoming_classifier
        and incoming_classifier != "unknown-v1"
        and (
            not match.mode_classifier_version
            or gep_authoritative
            or rank.get(incoming_conf, 0) >= rank.get(current_conf, 0)
        )
    ):
        match.mode_classifier_version = incoming_classifier

    capabilities = set(match.capabilities or [])
    capabilities.update(data.get("capabilities") or [])
    match.capabilities = sorted(capabilities)

    incoming_summary = data.get("raw_summary")
    if isinstance(incoming_summary, dict):
        old_summary = match.raw_summary if isinstance(match.raw_summary, dict) else {}
        match.raw_summary = {**old_summary, **incoming_summary}

    participant_data = dict(data.get("participant") or {})
    account_id = participant_data.get("account_id")
    if account_id is None:
        raise ValueError("Нормализованный матч не содержит account_id игрока")

    participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == int(account_id),
        )
    )
    if not participant:
        participant = MatchParticipant(
            match_id=match.id,
            account_id=int(account_id),
        )
        db.add(participant)

    for field in (
        "steam_id64",
        "hero_id",
        "team",
        "won",
        "kills",
        "deaths",
        "assists",
        "net_worth",
        "hero_damage",
        "object_damage",
        "healing",
    ):
        value = participant_data.get(field)
        if value is not None:
            setattr(participant, field, value)

    db.commit()
    db.refresh(match)
    return match



def _companion_result_from_events(
    db: Session,
    user: User,
    external_match_id: int,
) -> dict | None:
    """Return the best local-team/result observation for one exact match.

    Evidence schema v7 distinguishes a real ``match_outcome`` *info update*
    from a winner value merely returned by getInfo/cache.  This matters because
    Deadlock GEP can retain the previous match winner after ``match_id`` has
    already advanced.  A scoring-grade local result therefore requires:

    * authenticated identity for the exact Match ID;
    * a trusted match_end/session-end marker for that same match;
    * an explicit outcome info-update observed for that exact Match ID close to
      the terminal event; and
    * a known local team from the local roster.

    Older clients still get the previous stabilized diagnostic result, but it
    remains non-authoritative and cannot create ``summary.result``.
    """
    finalization = _companion_finalization_from_events(db, user, external_match_id)
    if not finalization:
        return None

    ended_at = finalization.get("ended_at")
    if not isinstance(ended_at, datetime):
        ended_at = _parse_companion_datetime(ended_at)
    captured_at = _parse_companion_datetime(finalization.get("captured_at"))
    session_id = str(finalization.get("session_id") or "").strip() or None

    # First prefer an explicit v7 GEP info-update.  We compare client-side
    # outcome/end timestamps with each other (same clock) and use server event
    # timestamps only as an additional sanity bound.
    if ended_at is not None:
        server_floor = (captured_at or ended_at) - timedelta(seconds=15)
        candidates = list(
            db.scalars(
                select(CompanionEvent)
                .where(
                    CompanionEvent.user_id == user.id,
                    CompanionEvent.external_match_id == int(external_match_id),
                    CompanionEvent.created_at >= server_floor,
                )
                .order_by(CompanionEvent.created_at.asc())
                .limit(96)
            ).all()
        )
        valid_teams = {"AMBER", "SAPPHIRE"}
        for event in candidates:
            payload = event.payload if isinstance(event.payload, dict) else {}
            if payload.get("identity_ok") is not True:
                continue
            session = payload.get("session")
            if not isinstance(session, dict):
                continue
            candidate_session_id = str(session.get("id") or "").strip() or None
            if session_id and candidate_session_id and candidate_session_id != session_id:
                continue
            try:
                outcome_match_id = int(session.get("match_outcome_event_match_id") or 0)
            except (TypeError, ValueError):
                outcome_match_id = 0
            if outcome_match_id != int(external_match_id):
                continue
            outcome_at = _parse_companion_datetime(session.get("match_outcome_event_at"))
            if outcome_at is None:
                continue
            delta = (outcome_at - ended_at).total_seconds()
            # GEP can emit the winner immediately before match_end or shortly
            # after it. Anything much older is indistinguishable from the stale
            # previous-match outcome that caused the production regression.
            if delta < -10 or delta > 90:
                continue
            local_team = str(session.get("local_team") or "").upper()
            match_outcome = str(session.get("match_outcome") or "").upper()
            if local_team not in valid_teams or match_outcome not in valid_teams:
                continue
            return {
                "local_team": local_team,
                "match_outcome": match_outcome,
                "won": local_team == match_outcome,
                "event_type": event.event_type,
                "captured_at": event.created_at.isoformat() if event.created_at else None,
                "outcome_observed_at": outcome_at.isoformat(),
                "outcome_match_id": outcome_match_id,
                "trusted_for_scoring": True,
                "trust_reason": "exact_match_terminal_plus_outcome_info_update_v7",
            }

    # Backward-compatible diagnostic path for frozen/older clients.  A value
    # seen only after a grace window may be useful in logs, but without the v7
    # info-update marker it is still not safe enough to settle a win contract.
    anchors = [value for value in (ended_at, captured_at) if isinstance(value, datetime)]
    if not anchors:
        return None
    final_at = max(anchors)
    stable_after = final_at + timedelta(
        seconds=max(1, settings.companion_finalization_grace_seconds)
    )
    events = list(
        db.scalars(
            select(CompanionEvent)
            .where(
                CompanionEvent.user_id == user.id,
                CompanionEvent.external_match_id == int(external_match_id),
                CompanionEvent.created_at >= stable_after,
            )
            .order_by(CompanionEvent.created_at.desc())
            .limit(64)
        ).all()
    )
    valid_teams = {"AMBER", "SAPPHIRE"}
    for event in events:
        payload = event.payload if isinstance(event.payload, dict) else {}
        if payload.get("identity_ok") is not True:
            continue
        session = payload.get("session")
        if not isinstance(session, dict):
            continue
        local_team = str(session.get("local_team") or "").upper()
        match_outcome = str(session.get("match_outcome") or "").upper()
        if local_team not in valid_teams or match_outcome not in valid_teams:
            continue
        return {
            "local_team": local_team,
            "match_outcome": match_outcome,
            "won": local_team == match_outcome,
            "event_type": event.event_type,
            "captured_at": event.created_at.isoformat() if event.created_at else None,
            "stabilized_after": stable_after.isoformat(),
            "trusted_for_scoring": False,
            "trust_reason": "legacy_stabilized_label_diagnostic_only",
        }
    return None


def _parse_companion_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return aware(value)
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return aware(parsed)


def _companion_finalization_from_events(
    db: Session,
    user: User,
    external_match_id: int,
) -> dict | None:
    """Return strong final-session evidence for one exact Companion match.

    Finality is selected by *meaning*, not by an arbitrary recent-event window.
    Production match 99529660 proved that a frozen Companion can keep sending
    heartbeats for hours after the real ``match_ended`` event. Any fixed
    ``LIMIT N`` over the newest events can therefore lose the terminal marker.

    Accepted evidence:
      * an authenticated ``match_ended`` event for the exact Match ID; or
      * an authenticated persisted session end marker with a trusted reason.

    ``match_outcome`` is deliberately excluded from finality because Deadlock
    GEP can retain the previous match outcome after the current Match ID has
    already advanced.
    """
    # Query only semantically-terminal rows instead of taking the newest N
    # events.  SQLAlchemy's generic JSON access compiles to JSON extraction on
    # both PostgreSQL (production) and SQLite (tests).  This stays bounded by
    # the exact user+Match ID and uses indexed relational predicates before the
    # JSON fallback is evaluated.
    session_ended = CompanionEvent.payload["session"]["ended_at"].as_string()
    session_end_reason = CompanionEvent.payload["session"]["end_reason"].as_string()
    candidates = db.scalars(
        select(CompanionEvent)
        .where(
            CompanionEvent.user_id == user.id,
            CompanionEvent.external_match_id == int(external_match_id),
            or_(
                CompanionEvent.event_type == "match_ended",
                and_(
                    session_ended.is_not(None),
                    session_end_reason.in_(("match_end", "phase_postgame")),
                ),
            ),
        )
        .order_by(CompanionEvent.created_at.asc())
    )

    valid_teams = {"AMBER", "SAPPHIRE"}
    for event in candidates:
        payload = event.payload if isinstance(event.payload, dict) else {}
        if payload.get("identity_ok") is not True:
            continue

        raw_session = payload.get("session")
        session = raw_session if isinstance(raw_session, dict) else {}
        event_type = str(event.event_type or "").strip().lower()
        phase = str(event.phase or "").strip().lower()
        end_reason = str(session.get("end_reason") or "").strip().lower()
        ended_at = _parse_companion_datetime(session.get("ended_at"))

        # ``match_ended`` is an explicit lifecycle event from the authenticated
        # Companion and does not require the optional session object to survive.
        # The session-marker fallback, however, must include both ended_at and a
        # trusted end reason.
        final_signal = bool(
            event_type == "match_ended"
            or (
                ended_at is not None
                and end_reason in {"match_end", "phase_postgame"}
            )
        )
        if not final_signal:
            continue

        started_at = _parse_companion_datetime(session.get("started_at"))
        clock = session.get("match_clock_s")
        try:
            match_clock_s = int(clock) if clock not in (None, "") else None
        except (TypeError, ValueError):
            match_clock_s = None
        if match_clock_s is not None and not (0 <= match_clock_s <= 6 * 60 * 60):
            match_clock_s = None
        match_clock_observed_at = _parse_companion_datetime(
            session.get("match_clock_observed_at")
        )

        local_team = str(session.get("local_team") or "").upper()
        outcome = str(session.get("match_outcome") or "").upper()
        return {
            "trusted": True,
            "source": "overwolf_gep_final",
            "signal": (
                "match_end" if event_type == "match_ended"
                else "postgame" if phase == "postgame"
                else "end" if phase == "end"
                else "session_end"
            ),
            "event_type": event.event_type,
            "phase": event.phase,
            "end_reason": end_reason or None,
            "session_id": str(session.get("id") or "").strip() or None,
            "started_at": started_at,
            "ended_at": ended_at or aware(event.created_at),
            # Deadlock GEP documents match_clock as the exact local match time.
            # It becomes contract-grade only after this exact Match ID receives
            # a trusted terminal lifecycle signal.
            "match_clock_s": match_clock_s,
            "match_clock_observed_at": (
                match_clock_observed_at.isoformat()
                if match_clock_observed_at is not None
                else None
            ),
            "local_team": local_team if local_team in valid_teams else None,
            # Outcome is diagnostic here. Result scoring is handled only after
            # terminal stabilization by _companion_result_from_events.
            "match_outcome": outcome if outcome in valid_teams else None,
            "captured_at": event.created_at.isoformat() if event.created_at else None,
        }
    return None


def _trusted_final_match_clock_duration(finalization: dict[str, Any] | None) -> int | None:
    if not isinstance(finalization, dict):
        return None
    clock = finalization.get("match_clock_s")
    try:
        duration_s = int(clock) if clock not in (None, "") else None
    except (TypeError, ValueError):
        return None
    if duration_s is None or not (0 < duration_s <= 6 * 60 * 60):
        return None

    ended_at = finalization.get("ended_at")
    if isinstance(ended_at, str):
        ended_at = _parse_companion_datetime(ended_at)
    observed_at = finalization.get("match_clock_observed_at")
    if isinstance(observed_at, str):
        observed_at = _parse_companion_datetime(observed_at)
    if ended_at is None or observed_at is None:
        return None

    # GEP documents match_clock as an exact local match clock and emits it every
    # second in-game. Requiring a fresh observation next to the trusted terminal
    # event prevents an old persisted clock from becoming a false final duration.
    age = (aware(ended_at) - aware(observed_at)).total_seconds()
    if age < -5 or age > 60:
        return None
    return duration_s


def merge_companion_evidence(
    db: Session,
    user: User,
    data: dict,
    external_match_id: int,
) -> dict:
    evidence = db.scalar(
        select(CompanionMatchEvidence).where(
            CompanionMatchEvidence.user_id == user.id,
            CompanionMatchEvidence.external_match_id == external_match_id,
        )
    )
    if not evidence:
        return data

    if (
        user.steam_id64 is not None
        and evidence.steam_id64 is not None
        and int(user.steam_id64) != int(evidence.steam_id64)
    ):
        return data

    data = dict(data)
    participant = dict(data.get("participant") or {})
    participant.setdefault("account_id", user.account_id)

    contributed = []
    mapping = {
        "hero_id": ("hero_id", None),
        "kills": ("kills", "summary.kills"),
        "deaths": ("deaths", "summary.deaths"),
        "assists": ("assists", "summary.assists"),
        "hero_damage": ("hero_damage", "summary.hero_damage"),
        "object_damage": ("object_damage", "summary.object_damage"),
        # Overwolf exposes live `hero_healing`, but Street Brawl can report a
        # different aggregate than the final scoreboard/provider summary. Keep
        # the value for diagnostics, but do not advertise summary.healing as a
        # contract-grade capability unless the upstream provider supplied it.
        "healing": ("healing", None),
        "souls": ("net_worth", "summary.net_worth"),
    }

    capabilities = set(data.get("capabilities") or [])
    for evidence_field, (participant_field, capability) in mapping.items():
        value = getattr(evidence, evidence_field, None)
        if participant.get(participant_field) is None and value is not None:
            participant[participant_field] = value
            contributed.append(evidence_field)
        if value is not None and capability:
            capabilities.add(capability)

    companion_result = _companion_result_from_events(
        db, user, external_match_id
    )
    if companion_result:
        raw_summary = data.get("raw_summary")
        raw_summary = dict(raw_summary) if isinstance(raw_summary, dict) else {}
        existing_won = participant.get("won")
        trusted = bool(companion_result.get("trusted_for_scoring"))
        if trusted and existing_won is None:
            participant["won"] = bool(companion_result["won"])
            capabilities.add("summary.result")
            contributed.append("match_outcome_info_update_final")
            raw_summary["companion_result_trusted"] = dict(companion_result)
        else:
            diagnostic_result = dict(companion_result)
            diagnostic_result.setdefault("trusted_for_scoring", False)
            diagnostic_result.setdefault("trust_reason", "diagnostic_only")
            raw_summary["companion_outcome_diagnostic"] = diagnostic_result
        if existing_won is not None and bool(existing_won) != bool(companion_result["won"]):
            raw_summary["result_diagnostic_conflict"] = {
                "provider_won": bool(existing_won),
                "companion_won": bool(companion_result["won"]),
                "companion_trusted": trusted,
                "resolution": "provider_result_wins",
            }
        data["raw_summary"] = raw_summary

    evidence_mode = str(evidence.game_match_mode or "").upper()
    provider_mode = str(data.get("game_match_mode") or "UNKNOWN").upper()
    raw_summary = data.get("raw_summary")
    raw_summary = dict(raw_summary) if isinstance(raw_summary, dict) else {}

    finalization = _companion_finalization_from_events(
        db, user, external_match_id
    )
    if finalization:
        if data.get("started_at") is None and finalization.get("started_at") is not None:
            data["started_at"] = finalization["started_at"]
        if data.get("ended_at") is None and finalization.get("ended_at") is not None:
            data["ended_at"] = finalization["ended_at"]
        duration_s = _trusted_final_match_clock_duration(finalization)
        if data.get("duration_s") is None and duration_s is not None:
            data["duration_s"] = duration_s
            capabilities.add("summary.duration")
            contributed.append("match_clock_final")
        raw_summary["companion_finalization"] = {
            **{k: v for k, v in finalization.items() if k not in {"started_at", "ended_at"}},
            "started_at": finalization["started_at"].isoformat()
            if finalization.get("started_at")
            else None,
            "ended_at": finalization["ended_at"].isoformat()
            if finalization.get("ended_at")
            else None,
        }

        if (
            evidence_mode == "STREET_BRAWL"
            and evidence.healing is not None
        ):
            capabilities.add("gep.scoreboard_healing")
            contributed.append("scoreboard_healing_final")

    if companion_result:
        raw_summary["companion_result"] = {
            "local_team": companion_result["local_team"],
            "match_outcome": companion_result["match_outcome"],
            "won": companion_result["won"],
            "event_type": companion_result["event_type"],
            "captured_at": companion_result["captured_at"],
            "trusted_for_scoring": bool(companion_result.get("trusted_for_scoring")),
            "trust_reason": companion_result.get("trust_reason"),
            "outcome_observed_at": companion_result.get("outcome_observed_at"),
            "outcome_match_id": companion_result.get("outcome_match_id"),
        }

    if evidence_mode in {"STANDARD", "RANKED", "STREET_BRAWL"}:
        if (
            provider_mode in {"STANDARD", "RANKED", "STREET_BRAWL"}
            and provider_mode != evidence_mode
        ):
            raw_summary["mode_conflict"] = {
                "provider_mode": provider_mode,
                "companion_mode": evidence_mode,
                "resolution": "companion_exact_match_wins",
            }

        data["game_match_mode"] = evidence_mode
        data["mode_confidence"] = "HIGH"
        data["mode_classifier_version"] = "gep-exact-v1"
        raw = str(data.get("provider_mode_raw") or "")
        gep_raw = f"gep={evidence_mode}"
        if gep_raw not in raw:
            data["provider_mode_raw"] = (
                raw + ("; " if raw else "") + gep_raw
            )[:128]
        contributed.append("game_match_mode")

    data["participant"] = participant
    data["capabilities"] = sorted(capabilities)

    provider = str(data.get("provider") or "deadlock_api")
    if "gep" not in provider.lower():
        provider = f"{provider}+gep"
    data["provider"] = provider[:64]

    raw_summary["companion_evidence"] = {
        "fields": sorted(set(contributed)),
        "captured_at": evidence.captured_at.isoformat()
        if evidence.captured_at
        else None,
        "external_match_id": int(external_match_id),
    }
    data["raw_summary"] = raw_summary
    return data



def _companion_evidence_for(
    db: Session,
    user: User,
    external_match_id: int,
) -> CompanionMatchEvidence | None:
    evidence = db.scalar(
        select(CompanionMatchEvidence).where(
            CompanionMatchEvidence.user_id == user.id,
            CompanionMatchEvidence.external_match_id == external_match_id,
        )
    )
    if not evidence:
        return None
    if (
        user.steam_id64 is not None
        and evidence.steam_id64 is not None
        and int(user.steam_id64) != int(evidence.steam_id64)
    ):
        return None
    return evidence


def _job_detected_at(job: Job) -> datetime | None:
    raw = (job.payload or {}).get("detected_at")
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            value = raw
        else:
            text = str(raw).strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            value = datetime.fromisoformat(text)
        return aware(value)
    except (TypeError, ValueError):
        return None


def _normalized_from_companion_evidence(
    db: Session,
    user: User,
    job: Job,
    external_match_id: int,
) -> dict | None:
    """Build a final GEP fallback only from explicit finalization evidence.

    Live roster snapshots are useful for telemetry but are never sufficient to
    mark a match final.  This prevents an in-progress game from being bound and
    evaluated simply because upstream metadata is temporarily 404/missing.
    """
    evidence = _companion_evidence_for(db, user, external_match_id)
    finalization = _companion_finalization_from_events(
        db, user, external_match_id
    )
    if not evidence or not finalization:
        return None

    mode = str(evidence.game_match_mode or "").upper()
    if mode not in {"STANDARD", "RANKED", "STREET_BRAWL"}:
        return None

    stats = (
        evidence.kills,
        evidence.deaths,
        evidence.assists,
        evidence.hero_damage,
        evidence.object_damage,
        evidence.healing,
        evidence.souls,
    )
    if all(value is None for value in stats):
        return None

    capabilities = set()
    for field, capability in {
        "kills": "summary.kills",
        "deaths": "summary.deaths",
        "assists": "summary.assists",
        "hero_damage": "summary.hero_damage",
        "object_damage": "summary.object_damage",
        # `hero_healing` is retained for diagnostics only.  In Street Brawl
        # the live GEP aggregate can differ from the final scoreboard/provider
        # total, so it must not settle healing contracts by itself.
        "healing": None,
        "souls": "summary.net_worth",
    }.items():
        if getattr(evidence, field, None) is not None and capability:
            capabilities.add(capability)

    if mode == "STREET_BRAWL" and evidence.healing is not None:
        capabilities.add("gep.scoreboard_healing")

    duration_s = _trusted_final_match_clock_duration(finalization)
    if duration_s is not None:
        capabilities.add("summary.duration")

    started_at = finalization.get("started_at") or _job_detected_at(job)
    ended_at = finalization.get("ended_at")
    if started_at is None and ended_at is not None and duration_s is not None:
        started_at = ended_at - timedelta(seconds=duration_s)

    return {
        "external_match_id": int(external_match_id),
        "provider": "gep_fallback",
        "provider_payload_hash": None,
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_s": duration_s,
        "game_match_mode": mode,
        "provider_mode_raw": f"gep={mode}; external_metadata=missing; final=gep",
        "mode_classifier_version": "gep-exact-v2",
        "mode_confidence": "HIGH",
        "scoring_status": "SCORED",
        "game_version": None,
        "is_final": True,
        "capabilities": sorted(capabilities),
        "raw_summary": {
            "external_metadata_missing": True,
            "companion_finalization": {
                **{k: v for k, v in finalization.items() if k not in {"started_at", "ended_at"}},
                "started_at": started_at.isoformat() if started_at else None,
                "ended_at": ended_at.isoformat() if ended_at else None,
            },
            "companion_evidence": {
                "captured_at": evidence.captured_at.isoformat()
                if evidence.captured_at
                else None,
                "provisional_healing": evidence.healing,
                "scoreboard_healing": evidence.healing,
                "scoreboard_healing_final": evidence.healing is not None,
            },
        },
        "participant": {
            "account_id": int(user.account_id),
            "steam_id64": evidence.steam_id64,
            "hero_id": evidence.hero_id,
            "team": None,
            "won": None,
            "kills": evidence.kills,
            "deaths": evidence.deaths,
            "assists": evidence.assists,
            "net_worth": evidence.souls,
            "hero_damage": evidence.hero_damage,
            "object_damage": evidence.object_damage,
            "healing": evidence.healing,
        },
    }


def _finish_discovery_jobs_for_board(db: Session, board_id: str) -> None:
    jobs = list(
        db.scalars(
            select(Job).where(
                Job.type == "discover_match",
                Job.status.in_(("PENDING", "RUNNING")),
            )
        ).all()
    )
    changed = False
    for item in jobs:
        if str((item.payload or {}).get("board_id") or "") != board_id:
            continue
        item.status = "DONE"
        item.locked_at = None
        item.locked_by = None
        item.last_error = None
        changed = True
    if changed:
        db.commit()


def _resolve_exact_companion_payload(
    db: Session,
    user: User,
    job: Job,
    external_match_id: int,
) -> dict:
    normalized = None

    payload = dict(job.payload or {})

    def remember_provider_wait(exc: Exception) -> None:
        nonlocal payload
        payload["_provider_last_error"] = str(exc)[:500]
        payload["_provider_last_error_at"] = utcnow().isoformat()
        if isinstance(exc, ProviderRateLimited):
            payload["_provider_retry_after"] = int(exc.retry_after)
        job.payload = payload
        db.commit()

    # Fast cache/S3 path. A provider outage must not suppress strong local GEP
    # finalization: we can bind the exact match from Companion, then let the
    # evaluation job wait for contract-grade provider-only facts.
    try:
        with DeadlockApiProvider() as provider:
            normalized = provider.fetch_match_by_id(
                user.account_id,
                external_match_id,
                disable_steam=True,
                consult_history=False,
            )
    except (ProviderRateLimited, ProviderError) as exc:
        remember_provider_wait(exc)
        normalized = None

    evidence = _companion_evidence_for(db, user, external_match_id)

    # A verified exact Match ID may use the Steam-backed metadata path twice per
    # job: once immediately and once later after the public cache had time to
    # ingest the match. This avoids both request storms and the opposite failure
    # mode where one unlucky early miss permanently prevents a later refresh.
    steam_attempts = int(payload.get("_steam_fallback_attempts") or 0)
    allow_late_retry = int(job.attempts or 0) >= 6 and steam_attempts < 2
    if normalized is None and evidence is not None and (steam_attempts == 0 or allow_late_retry):
        payload["_steam_fallback_attempts"] = steam_attempts + 1
        payload["_steam_fallback_last_attempt"] = utcnow().isoformat()
        job.payload = payload
        db.commit()
        try:
            with DeadlockApiProvider() as provider:
                normalized = provider.fetch_match_by_id(
                    user.account_id,
                    external_match_id,
                    disable_steam=False,
                    consult_history=False,
                )
        except (ProviderRateLimited, ProviderError) as exc:
            remember_provider_wait(exc)
            normalized = None

    if normalized is not None:
        payload.pop("_provider_retry_after", None)
        payload.pop("_provider_last_error", None)
        payload.pop("_provider_last_error_at", None)
        job.payload = payload
        db.commit()

    # Do not wait forever for external metadata if the Companion already has
    # a verified end-of-match snapshot.
    if normalized is None:
        normalized = _normalized_from_companion_evidence(
            db, user, job, external_match_id
        )

    if normalized is None:
        raise CompanionMatchNotReady(
            f"Матч #{external_match_id} обнаружен Companion, "
            "но пока нет ни внешнего metadata, ни достаточного "
            "финального локального снимка"
        )

    normalized = merge_companion_evidence(
        db, user, normalized, external_match_id
    )
    _apply_companion_time_fallback(normalized, job)
    return normalized

def _board_has_bound_match(db: Session, board_id: str) -> bool:
    """Есть ли матч у текущей незавершённой попытки.

    Выполненные контракты сохраняют Match ID своего успешного матча,
    но не мешают оставшимся контрактам перейти к попытке 2/3 или 3/3.
    """
    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board_id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )

    return bool(
        options
        and any(
            option.bound_match_id
            for option in options
            if option.status not in {"COMPLETED", "FAILED"}
        )
    )


def _active_companion_candidate(db: Session, board_id: str) -> Job | None:
    jobs = list(
        db.scalars(
            select(Job)
            .where(Job.type == "resolve_companion_match", Job.status.in_(("PENDING", "RUNNING")))
            .order_by(Job.created_at.asc())
        ).all()
    )
    return next((job for job in jobs if str((job.payload or {}).get("board_id") or "") == board_id), None)



def _verification_retry_delay(attempt: int) -> int:
    # Exact Match ID + Companion finalization lets us retry the cheap cache/S3
    # path aggressively for the first minute without touching Steam on every
    # poll. Deadlock API documents high cache/S3 limits; expensive Steam
    # fallback remains separately bounded in _resolve_exact_companion_payload.
    schedule = (3, 5, 8, 12, 20, 30, 45, 60, 90, 120, 180, 300)
    index = max(0, min(len(schedule) - 1, int(attempt or 1) - 1))
    return schedule[index]


def _required_capabilities_for_board(db: Session, board_id: str) -> set[str]:
    required: set[str] = set()
    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board_id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )
    for option in options:
        if option.status in {"COMPLETED", "FAILED", "EXPIRED", "VOID"}:
            continue
        required.update(str(item) for item in (option.required_capabilities or []) if item)
        for condition in (option.conditions or []):
            if not isinstance(condition, dict):
                continue
            required.update(str(item) for item in (condition.get("capabilities") or []) if item)
    return required


def _missing_contract_facts_by_option(
    db: Session,
    board: ContractBoard,
    match: Match,
) -> dict[str, list[str]]:
    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )
    participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == board.user.account_id,
        )
    )
    actual = {
        "summary.result": participant.won if participant is not None else None,
        "summary.kills": participant.kills if participant is not None else None,
        "summary.deaths": participant.deaths if participant is not None else None,
        "summary.assists": participant.assists if participant is not None else None,
        "summary.net_worth": participant.net_worth if participant is not None else None,
        "summary.hero_damage": participant.hero_damage if participant is not None else None,
        "summary.object_damage": participant.object_damage if participant is not None else None,
        "summary.healing": participant.healing if participant is not None else None,
        "gep.scoreboard_healing": participant.healing if participant is not None else None,
        "summary.duration": match.duration_s,
    }

    result: dict[str, list[str]] = {}
    for option in options:
        if option.status in {"COMPLETED", "FAILED", "EXPIRED", "VOID"}:
            continue
        # A retryable failure is deliberately unbound from this match. Never
        # drag it back into the provider wait of another contract on the board.
        if option.bound_match_id != match.id:
            continue
        missing: set[str] = set()
        if participant is None:
            missing.add("participant")
        option_required = {
            str(item) for item in (option.required_capabilities or []) if item
        }
        for condition in (option.conditions or []):
            if isinstance(condition, dict):
                option_required.update(
                    str(item) for item in (condition.get("capabilities") or []) if item
                )
        missing.update(
            capability
            for capability in option_required
            if not capability_available(option, match, capability)
        )
        for capability in option_required:
            if capability in actual and actual[capability] is None:
                missing.add(capability)
        result[option.id] = sorted(missing)
    return result


def _missing_contract_facts(
    db: Session,
    board: ContractBoard,
    match: Match,
) -> list[str]:
    per_option = _missing_contract_facts_by_option(db, board, match)
    return sorted({fact for facts in per_option.values() for fact in facts})


def _defer_pending_review_case(db: Session, board_id: str) -> None:
    """Hide stale human-review work while rc5 is still auto-refreshing facts.

    WAITING_PROVIDER is intentionally non-terminal: if the retry budget later
    expires, evaluator._ensure_review_case will reopen the same unique case as
    PENDING. This prevents an admin from deciding a match while automation is
    actively repairing it, without losing the audit/history row.
    """
    items = list(
        db.scalars(
            select(AutoReviewCase).where(
                AutoReviewCase.board_id == board_id,
                AutoReviewCase.status == "PENDING",
                AutoReviewCase.reviewer_id.is_(None),
            )
        ).all()
    )
    for item in items:
        item.status = "WAITING_PROVIDER"
        item.reviewer_note = (
            "Автоматическая проверка rc5: ждём итоговые данные провайдера; "
            "ручное решение пока не требуется."
        )
        item.reviewed_at = None


def _mark_board_verifying_for_facts(
    db: Session,
    board: ContractBoard,
    missing: list[str],
    *,
    option_ids: set[str] | None = None,
) -> None:
    labels = {
        "participant": "состав матча",
        "summary.result": "результат матча",
        "summary.kills": "киллы",
        "summary.deaths": "смерти",
        "summary.assists": "ассисты",
        "summary.net_worth": "итоговые души",
        "summary.hero_damage": "урон героям",
        "summary.object_damage": "урон объектам",
        "summary.healing": "итоговое лечение союзников",
        "summary.duration": "длительность матча",
        "gep.scoreboard_healing": "лечение по итоговой таблице",
    }
    readable = ", ".join(labels.get(item, "итоговая статистика") for item in missing)
    message = (
        "Матч найден. Ждём итоговые данные провайдера: "
        f"{readable}. Попытка сохранена и не будет потрачена повторно."
    )
    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )
    for option in options:
        if option.status in {"COMPLETED", "FAILED", "EXPIRED", "VOID"}:
            continue
        if option_ids is not None and option.id not in option_ids:
            continue
        option.status = "VERIFYING"
        option.settled_at = None
        option.explanation = message
    board.status = "VERIFYING"
    _defer_pending_review_case(db, board.id)
    db.commit()


def _scrub_legacy_weak_outcome_fact(
    db: Session,
    match: Match,
    account_id: int,
) -> bool:
    """Remove rc3/rc4 outcome-only result facts before final-v3 repair.

    Only GEP fallback matches with companion_finalization.signal=match_outcome
    are affected. Provider-backed results are never scrubbed.
    """
    raw = match.raw_summary if isinstance(match.raw_summary, dict) else {}
    finalization = raw.get("companion_finalization")
    if not (
        isinstance(finalization, dict)
        and str(finalization.get("signal") or "").lower() == "match_outcome"
        and "gep_fallback" in str(match.provider or "").lower()
    ):
        return False

    capabilities = set(match.capabilities or [])
    capabilities.discard("summary.result")
    match.capabilities = sorted(capabilities)
    participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == int(account_id),
        )
    )
    if participant is not None:
        participant.won = None
    new_raw = dict(raw)
    new_raw.pop("companion_result", None)
    new_raw["legacy_weak_finality_scrubbed"] = True
    if isinstance(new_raw.get("companion_finalization"), dict):
        weak = dict(new_raw["companion_finalization"])
        weak["trusted"] = False
        new_raw["companion_finalization"] = weak
    match.raw_summary = new_raw
    db.commit()
    return True


def _queue_repair_evaluation(
    db: Session,
    board: ContractBoard,
    match: Match,
) -> None:
    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )
    touched = False
    for option in options:
        if option.bound_match_id != match.id:
            continue
        if option.status in {"COMPLETED", "FAILED", "EXPIRED", "VOID"}:
            continue
        option.status = "VERIFYING"
        option.settled_at = None
        touched = True
    if not touched:
        return
    board.status = "VERIFYING"
    _defer_pending_review_case(db, board.id)
    db.commit()
    enqueue_job(
        db,
        "evaluate_match",
        {"board_id": board.id, "match_id": match.id, "finality_repair": "final-v5-outcome-v7"},
        f"evaluate-final-v5-outcome-v7:{board.id}:{match.id}",
        max_attempts=max(3, settings.post_match_verification_max_attempts),
    )


def bind_match(db: Session, board: ContractBoard, match: Match) -> None:
    locked_board = db.scalar(
        select(ContractBoard).where(
            ContractBoard.id == board.id
        ).with_for_update()
    )

    if not locked_board:
        raise ValueError("Доска контрактов не найдена")

    board = locked_board

    if board.status == "SETTLED":
        return

    if not board.locked_at:
        raise ValueError("У доски отсутствует время фиксации")

    participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == board.user.account_id,
        )
    )

    if not participant:
        raise ValueError("Игрок не найден в составе матча")

    started_at = aware(match.started_at)
    locked_at = aware(board.locked_at)

    if started_at is None or locked_at is None or started_at <= locked_at:
        raise ValueError(
            "Не удалось подтвердить, что матч начался после фиксации"
        )

    if match.game_match_mode != board.game_match_mode:
        raise ValueError(
            f"Режим матча {match.game_match_mode} "
            f"не совпадает с делом {board.game_match_mode}"
        )

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

    # Один и тот же Match ID никогда не должен расходовать
    # две попытки одного дела.
    if any(
        option.bound_match_id == match.id
        for option in options
    ):
        return

    # После первой оценки retryable-контракт может отвязаться от матча,
    # поэтому одной проверки bound_match_id недостаточно.
    from .models import Evaluation

    already_evaluated_for_board = db.scalar(
        select(Evaluation.id)
        .join(
            BoardOption,
            BoardOption.id == Evaluation.assignment_id,
        )
        .where(
            BoardOption.board_id == board.id,
            Evaluation.match_id == match.id,
        )
        .limit(1)
    )

    if already_evaluated_for_board:
        return

    active_options = [
        option
        for option in options
        if option.status not in {"COMPLETED", "FAILED"}
    ]

    existing_matches = {
        option.bound_match_id
        for option in active_options
        if option.bound_match_id
    }

    if existing_matches:
        if existing_matches == {match.id}:
            return

        raise ValueError(
            "Текущая попытка уже привязана к другому матчу"
        )

    if not active_options:
        return

    if board.attempts_used >= board.max_attempts:
        raise ValueError(
            "Все попытки по этому делу уже использованы"
        )

    board.attempts_used += 1

    for option in active_options:
        option.bound_match_id = match.id
        option.status = "VERIFYING"

    board.status = "VERIFYING"

    db.commit()

    enqueue_job(
        db,
        "evaluate_match",
        {
            "board_id": board.id,
            "match_id": match.id,
        },
        f"evaluate:{board.id}:{match.id}",
        max_attempts=max(3, settings.post_match_verification_max_attempts),
    )


def handle_discover(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, job.payload["board_id"])
    if not board:
        raise ValueError("Доска контрактов не найдена")
    if board.status == "SETTLED":
        return
    if _board_has_bound_match(db, board.id):
        return
    direct_candidate = _active_companion_candidate(db, board.id)
    if direct_candidate:
        external_id = (direct_candidate.payload or {}).get("external_match_id")
        raise NoMatchYet(f"Companion обнаружил матч #{external_id}; получаем итоговые данные именно этого матча")
    if not board.locked_at or board.user.account_id is None:
        raise ValueError("Данные доски или Steam-профиля неполны")
    if settings.provider == "mock":
        stmt = (
            select(Match)
            .join(MatchParticipant, MatchParticipant.match_id == Match.id)
            .where(
                MatchParticipant.account_id == board.user.account_id,
                Match.started_at > board.locked_at,
                Match.game_match_mode == board.game_match_mode,
                Match.is_final.is_(True),
            )
            .order_by(Match.started_at.asc(), Match.external_match_id.asc())
        )
        if board.baseline_match_id is not None:
            stmt = stmt.where(Match.external_match_id > board.baseline_match_id)
        match = db.scalar(stmt)
        if not match:
            raise NoMatchYet("После фиксации нет подходящего тестового матча")
    elif settings.provider == "deadlock_api":
        options = list(
            db.scalars(
                select(BoardOption).where(
                    BoardOption.board_id == board.id,
                    BoardOption.selected.is_(True),
                    BoardOption.status.notin_(("COMPLETED", "FAILED")),
                )
            ).all()
        )
        required_capabilities = {
            capability
            for option in options
            for capability in (option.required_capabilities or [])
        }
        # A key increases provider limits, but a forced refresh is still kept
        # sparse. Without a key the normal stored-history path is used.
        force_refetch = bool(
            settings.deadlock_api_key
            and settings.deadlock_force_refetch
            and (job.attempts == 1 or job.attempts % 6 == 0)
        )
        with DeadlockApiProvider() as provider:
            result = provider.discover_after(
                board.user.account_id,
                board.locked_at,
                board.baseline_match_id,
                required_capabilities=required_capabilities,
                required_mode=board.game_match_mode,
                force_refetch=force_refetch,
            )
        if result.match is None:
            latest = ""
            if result.latest_match_id and result.latest_start_time:
                latest_dt = datetime.fromtimestamp(result.latest_start_time, tz=timezone.utc)
                latest = f"; latest visible match={result.latest_match_id} started={latest_dt.isoformat()}"
            raise NoMatchYet(result.reason + latest)
        match = store_normalized_match(db, result.match)
    else:
        raise ValueError(f"Неизвестный MATCH_PROVIDER={settings.provider}")
    bind_match(db, board, match)


def _apply_companion_time_fallback(
    normalized: dict,
    job: Job,
) -> None:
    """Fill missing match start time from exact Companion detection.

    Used only after exact Match ID metadata has already been fetched.
    It prevents stale player match-history from blocking a match that
    the Companion and metadata already identify.
    """

    if normalized.get("started_at") is not None:
        return

    raw = (job.payload or {}).get("detected_at")

    if not raw:
        return

    try:
        if isinstance(raw, datetime):
            detected_at = raw
        else:
            value = str(raw).strip()

            if value.endswith("Z"):
                value = value[:-1] + "+00:00"

            detected_at = datetime.fromisoformat(value)

        if detected_at.tzinfo is None:
            detected_at = detected_at.replace(
                tzinfo=timezone.utc
            )

    except (TypeError, ValueError):
        return

    normalized["started_at"] = detected_at


def handle_resolve_companion_match(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, job.payload["board_id"])
    if not board:
        raise ValueError("Доска контрактов не найдена")

    if board.status == "SETTLED":
        _finish_discovery_jobs_for_board(db, board.id)
        return
    if _board_has_bound_match(db, board.id):
        _finish_discovery_jobs_for_board(db, board.id)
        return
    if not board.locked_at or board.user.account_id is None:
        raise ValueError("Данные доски или Steam-профиля неполны")

    external_match_id = int(job.payload.get("external_match_id") or 0)
    if external_match_id <= 0:
        raise ValueError("Companion не передал корректный Match ID")
    if (
        board.baseline_match_id is not None
        and external_match_id <= int(board.baseline_match_id)
    ):
        raise ValueError("Companion передал матч не новее baseline этого дела")

    expected_mode = str(
        job.payload.get("mode") or board.game_match_mode
    ).upper()
    if (
        expected_mode in {"STANDARD", "RANKED", "STREET_BRAWL"}
        and expected_mode != board.game_match_mode
    ):
        raise ValueError("Режим Companion не совпадает с зафиксированным делом")

    if settings.provider == "mock":
        match = db.scalar(
            select(Match).where(Match.external_match_id == external_match_id)
        )
        if not match:
            raise CompanionMatchNotReady(
                f"Тестовый матч #{external_match_id} ещё не создан"
            )
    elif settings.provider == "deadlock_api":
        normalized = _resolve_exact_companion_payload(
            db, board.user, job, external_match_id
        )

        if not normalized.get("is_final"):
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} ещё не подтверждён как завершённый"
            )

        mode = str(
            normalized.get("game_match_mode") or "UNKNOWN"
        ).upper()
        if mode not in {"STANDARD", "RANKED", "STREET_BRAWL"}:
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} найден, "
                "но итоговый режим ещё не определён"
            )
        if mode != board.game_match_mode:
            raise ValueError(
                f"Режим матча {mode} не совпадает с делом "
                f"{board.game_match_mode}"
            )
        if normalized.get("started_at") is None:
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} найден, "
                "но время начала не определено"
            )

        # duration_s is not a prerequisite for binding.
        match = store_normalized_match(db, normalized)
    else:
        raise ValueError(f"Неизвестный MATCH_PROVIDER={settings.provider}")

    bind_match(db, board, match)
    _finish_discovery_jobs_for_board(db, board.id)



def handle_resolve_companion_match_auto(db: Session, job: Job) -> None:
    user = db.get(User, str(job.payload.get("user_id") or ""))
    if not user or user.account_id is None:
        raise ValueError("Пользователь Companion не найден")

    external_match_id = int(job.payload.get("external_match_id") or 0)
    if external_match_id <= 0:
        raise ValueError("Companion не передал корректный Match ID")

    if settings.provider == "mock":
        match = db.scalar(
            select(Match).where(Match.external_match_id == external_match_id)
        )
        if not match:
            raise CompanionMatchNotReady(
                f"Тестовый матч #{external_match_id} ещё не создан"
            )
    elif settings.provider == "deadlock_api":
        normalized = _resolve_exact_companion_payload(
            db, user, job, external_match_id
        )
        if not normalized.get("is_final"):
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} ещё не подтверждён как завершённый"
            )
        mode = str(
            normalized.get("game_match_mode") or "UNKNOWN"
        ).upper()
        if mode not in {"STANDARD", "RANKED", "STREET_BRAWL"}:
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} найден, "
                "но итоговый режим ещё не определён"
            )
        if normalized.get("started_at") is None:
            raise CompanionMatchNotReady(
                f"Матч #{external_match_id} найден, "
                "но время начала не определено"
            )
        existing_match = db.scalar(
            select(Match).where(Match.external_match_id == external_match_id)
        )
        if existing_match is not None:
            _scrub_legacy_weak_outcome_fact(
                db, existing_match, int(user.account_id)
            )
        match = store_normalized_match(db, normalized)
    else:
        raise ValueError(f"Неизвестный MATCH_PROVIDER={settings.provider}")

    started_at = aware(match.started_at)
    boards = list(
        db.scalars(
            select(ContractBoard)
            .where(
                ContractBoard.user_id == user.id,
                ContractBoard.game_match_mode == match.game_match_mode,
                ContractBoard.status.in_(("LOCKED", "VERIFYING", "REVIEW_REQUIRED")),
            )
            .order_by(ContractBoard.locked_at.asc().nullslast())
        ).all()
    )

    for board in boards:
        # If an older final-v2 path already bound this exact match, do not spend
        # another attempt and do not call evaluator synchronously. Queue a new
        # final-v3 evaluation job so missing provider facts can remain VERIFYING
        # and retry automatically instead of jumping straight to human review.
        selected = list(
            db.scalars(
                select(BoardOption).where(
                    BoardOption.board_id == board.id,
                    BoardOption.selected.is_(True),
                )
            ).all()
        )
        if any(
            option.bound_match_id == match.id
            and option.status not in {"COMPLETED", "FAILED", "EXPIRED", "VOID"}
            for option in selected
        ):
            _queue_repair_evaluation(db, board, match)
            _finish_discovery_jobs_for_board(db, board.id)
            return

        if board.status == "REVIEW_REQUIRED":
            continue

        locked_at = aware(board.locked_at)
        if (
            started_at is None
            or locked_at is None
            or started_at <= locked_at
        ):
            continue
        if (
            board.baseline_match_id is not None
            and external_match_id <= int(board.baseline_match_id)
        ):
            continue
        if _board_has_bound_match(db, board.id):
            _finish_discovery_jobs_for_board(db, board.id)
            continue

        bind_match(db, board, match)
        _finish_discovery_jobs_for_board(db, board.id)
        return

    return



def handle_refresh_review_match(db: Session, job: Job) -> None:
    """Повторно загрузить final metadata уже привязанного матча и переоценить REVIEW_REQUIRED."""

    board_id = str((job.payload or {}).get("board_id") or "")
    if not board_id:
        raise ValueError("refresh_review_match: отсутствует board_id")

    board = db.get(ContractBoard, board_id)
    if not board:
        return

    if board.user.account_id is None:
        raise ValueError("У пользователя отсутствует Deadlock account_id")

    options = list(
        db.scalars(
            select(BoardOption).where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
        ).all()
    )

    bound_match_ids = [
        option.bound_match_id
        for option in options
        if option.bound_match_id
    ]

    if not bound_match_ids:
        return

    # Все контракты одного дела должны быть привязаны к одному матчу.
    match_id = bound_match_ids[0]
    match = db.get(Match, match_id)

    if not match:
        raise ValueError("Привязанный матч не найден")

    if settings.provider == "deadlock_api":
        with DeadlockApiProvider() as provider:
            normalized = provider.fetch_match_by_id(
                board.user.account_id,
                int(match.external_match_id),
            )

        if normalized is None:
            normalized = _normalized_from_companion_evidence(
                db,
                board.user,
                job,
                int(match.external_match_id),
            )
        if normalized is None:
            raise CompanionMatchNotReady(
                f"Матч #{match.external_match_id}: ждём final metadata или подтверждённый GEP match_end"
            )

        normalized = merge_companion_evidence(
            db,
            board.user,
            normalized,
            int(match.external_match_id),
        )

        refreshed_match = store_normalized_match(db, normalized)

    elif settings.provider == "mock":
        refreshed_match = match

    else:
        raise ValueError(
            f"Неизвестный MATCH_PROVIDER={settings.provider}"
        )

    evaluate_board(
        db,
        board.id,
        refreshed_match.id,
    )


def handle_bind(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, job.payload["board_id"])
    match = db.get(Match, job.payload["match_id"])
    if not board or not match:
        raise ValueError("Доска или матч не найдены")
    bind_match(db, board, match)


def handle_evaluate(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, str(job.payload.get("board_id") or ""))
    match = db.get(Match, str(job.payload.get("match_id") or ""))
    if not board or not match:
        raise ValueError("Доска или матч для оценки не найдены")

    missing_by_option = _missing_contract_facts_by_option(db, board, match)
    missing = sorted({fact for facts in missing_by_option.values() for fact in facts})
    if missing and settings.provider == "deadlock_api":
        # Re-read the exact Match ID before escalating. This path is idempotent,
        # uses the provider cache first, and permits only a bounded expensive
        # Steam fallback through _resolve_exact_companion_payload.
        try:
            normalized = _resolve_exact_companion_payload(
                db, board.user, job, int(match.external_match_id)
            )
        except CompanionMatchNotReady:
            normalized = None
        if normalized is not None and normalized.get("is_final"):
            existing = db.get(Match, match.id)
            if existing is not None:
                _scrub_legacy_weak_outcome_fact(
                    db, existing, int(board.user.account_id)
                )
            match = store_normalized_match(db, normalized)
            missing_by_option = _missing_contract_facts_by_option(db, board, match)
            missing = sorted({fact for facts in missing_by_option.values() for fact in facts})

    # Do not let one unavailable provider field freeze unrelated assignments.
    # Contract-grade facts already present on this exact final match are scored
    # immediately; only the assignments that truly miss a fact remain VERIFYING.
    ready_option_ids = {
        option_id for option_id, facts in missing_by_option.items() if not facts
    }
    if ready_option_ids:
        evaluate_board(
            db, board.id, match.id,
            option_ids=ready_option_ids,
        )
        db.refresh(board)
        db.refresh(match)
        missing_by_option = _missing_contract_facts_by_option(db, board, match)
        missing = sorted({fact for facts in missing_by_option.values() for fact in facts})

    max_wait_attempts = max(1, settings.post_match_verification_max_attempts)
    waiting_option_ids = {
        option_id for option_id, facts in missing_by_option.items() if facts
    }
    if missing and settings.provider == "deadlock_api" and int(job.attempts or 0) < max_wait_attempts:
        _mark_board_verifying_for_facts(
            db, board, missing, option_ids=waiting_option_ids
        )
        provider_retry_after = 0
        try:
            provider_retry_after = int((job.payload or {}).get("_provider_retry_after") or 0)
        except (TypeError, ValueError):
            provider_retry_after = 0
        delay = max(
            _verification_retry_delay(int(job.attempts or 1)),
            min(3600, max(0, provider_retry_after)),
        )
        raise FinalFactsPending(
            "Матч подтверждён, ждём итоговые поля: " + ", ".join(missing),
            delay,
        )

    # The provider retry budget is exhausted (or all facts are present). Only
    # now may missing facts become REVIEW_REQUIRED. Assignments already scored
    # above are never re-evaluated and never wait on an unrelated metric.
    if waiting_option_ids:
        evaluate_board(
            db, board.id, match.id,
            option_ids=waiting_option_ids,
        )
    elif not ready_option_ids:
        evaluate_board(db, board.id, match.id)


def dispatch_outbox(db: Session) -> bool:
    event = db.scalar(
        select(OutboxEvent)
        .where(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if not event:
        return False
    try:
        if event.event_type == "assignment.settled":
            payload = event.payload
            if payload.get("status") == "COMPLETED" and int(payload.get("reward_xp", 0)) > 0:
                existing = db.scalar(
                    select(RewardLedgerEntry).where(
                        RewardLedgerEntry.source_type == "assignment",
                        RewardLedgerEntry.source_id == payload["assignment_id"],
                    )
                )
                if not existing:
                    user = db.scalar(
                        select(User).where(User.id == payload["user_id"]).with_for_update()
                    )
                    if not user:
                        raise ValueError("Получатель награды не найден")
                    delta = int(payload["reward_xp"])
                    user.xp += delta
                    db.add(
                        RewardLedgerEntry(
                            user_id=user.id,
                            source_type="assignment",
                            source_id=payload["assignment_id"],
                            delta=delta,
                            balance_after=user.xp,
                            policy_version="xp-v3",
                        )
                    )
        elif event.event_type == "auto_review.requested" and settings.discord_review_webhook_url:
            payload = event.payload
            body = json.dumps({
                "content": (
                    f"Deadlock Contracts: требуется внутренняя проверка #{str(payload.get('review_id',''))[:8]}\n"
                    f"Матч: {payload.get('external_match_id')} · режим: {payload.get('mode')}\n"
                    f"Причин: {payload.get('reason_count')} · откройте админ-очередь сайта."
                ),
                "allowed_mentions": {"parse": []},
            }).encode("utf-8")
            request = urllib.request.Request(
                settings.discord_review_webhook_url,
                data=body,
                method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "DeadlockContracts/0.9.8"},
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                if response.status not in {200, 204}:
                    raise RuntimeError(f"Review notification returned HTTP {response.status}")
        event.published_at = utcnow()
        event.last_error = None
        db.commit()
    except IntegrityError:
        db.rollback()
        event = db.get(OutboxEvent, event.id)
        if event:
            event.published_at = utcnow()
            event.last_error = "Duplicate reward prevented by unique source constraint"
            db.commit()
    except Exception as exc:
        db.rollback()
        event = db.get(OutboxEvent, event.id)
        if event:
            event.attempts += 1
            event.last_error = str(exc)[:4000]
            db.commit()
        log.exception("Outbox dispatch failed")
    return True


def process_job(db: Session, job: Job) -> None:
    handlers = {
        "discover_match": handle_discover,
        "resolve_companion_match": handle_resolve_companion_match,
        "resolve_companion_match_auto": handle_resolve_companion_match_auto,
        "bind_match": handle_bind,
        "evaluate_match": handle_evaluate,
        "refresh_review_match": handle_refresh_review_match,
    }
    handler = handlers.get(job.type)
    if not handler:
        raise ValueError(f"Неизвестный тип задачи {job.type}")
    handler(db, job)


def _recover_unexpected_job_error(
    db: Session,
    job_id: str,
    job_type: str,
    job_attempts: int,
    exc: Exception,
) -> bool:
    """Reset a failed SQLAlchemy transaction and schedule the job retry.

    A flush/commit error leaves the Session unusable until rollback().  Keep
    this recovery path isolated so the worker process itself stays alive even
    when one job contains malformed provider/Companion data.
    """
    db.rollback()
    failed_job = db.get(Job, job_id)
    if failed_job is None:
        log.exception(
            "Job %s (%s) failed and could not be reloaded after rollback",
            job_id,
            job_type,
        )
        return False
    delay = min(300, 5 * (2 ** min(int(job_attempts or 0), 6)))
    retry_job(db, failed_job, exc, delay)
    log.exception(
        "Job %s (%s) failed; transaction rolled back and retry policy applied",
        job_id,
        job_type,
    )
    return True


def run() -> None:
    init()
    log.info("Worker %s started; provider=%s", WORKER_ID, settings.provider)
    while True:
        did_work = False
        with SessionLocal() as db:
            if dispatch_outbox(db):
                did_work = True
        with SessionLocal() as db:
            job = claim_next_job(db, WORKER_ID)
            if job:
                did_work = True
                # Snapshot identifiers before processing. A failed flush puts
                # SQLAlchemy's Session into a pending-rollback state, where
                # even reading expired ORM attributes can raise again.
                job_id = job.id
                job_type = job.type
                job_attempts = int(job.attempts or 0)
                try:
                    process_job(db, job)
                    complete_job(db, job)
                    log.info("Completed job %s %s", job_type, job_id)
                except ProviderRateLimited as exc:
                    retry_job(db, job, exc, max(exc.retry_after, 30))
                    log.warning("Provider rate limited; retry in %ss", exc.retry_after)
                except FinalFactsPending as exc:
                    retry_job(db, job, exc, exc.delay_seconds)
                    log.info("Final provider facts pending for job %s; retry in %ss", job_id, exc.delay_seconds)
                except ProviderError as exc:
                    retry_job(db, job, exc, 30)
                    log.warning("Provider error for job %s; retry in 30s: %s", job_id, exc)
                except CompanionMatchNotReady as exc:
                    retry_job(db, job, exc, max(15, min(settings.discovery_retry_seconds, 60)))
                    log.info("Companion match not ready for job %s", job.id)
                except NoMatchYet as exc:
                    retry_job(db, job, exc, settings.discovery_retry_seconds)
                    log.info("No match yet for job %s", job.id)
                except Exception as exc:
                    _recover_unexpected_job_error(
                        db,
                        job_id,
                        job_type,
                        job_attempts,
                        exc,
                    )
        if not did_work:
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run()
