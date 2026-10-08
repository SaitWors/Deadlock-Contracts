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
    BoardMatchCandidate,
    BoardOption,
    CompanionAttemptLease,
    CompanionEvent,
    CompanionMatchEvidence,
    ContractBoard,
    Evaluation,
    Job,
    Match,
    MatchParticipant,
    OutboxEvent,
    RewardLedgerEntry,
    User,
)
from .services.boards import expire_stale_boards
from .services.evaluator import (
    ActiveReviewClaim,
    capability_available,
    evaluate_board,
    guard_active_review_claim,
)
from .services.gep_settlement import (
    GEP_INTEGRITY_CLIENT_ATTESTED,
    GEP_SETTLEMENT_SOURCE,
    gep_settlement_managed_user,
    normalized_gep_match_from_evidence,
)
from .services.jobs import (
    claim_next_job, complete_job, enqueue_job, keep_job_lease,
    reclaim_stale_jobs, retry_job,
)
from .services.match_audit import (
    MatchAuditPending,
    reconcile_match_audits,
    run_match_audit_job,
    schedule_gep_match_audit,
)
from .services.match_trust import (
    independent_provider_parts,
    provider_has_client_source,
    provider_has_independent_source,
    provider_parts,
)
from .services.providers import DeadlockApiProvider, ProviderError, ProviderRateLimited
from .services.seed import seed_missions
from .services.telegram_moderation import (
    TELEGRAM_REVIEW_EVENT_PREFIX,
    TelegramDeliveryError,
    queue_review_telegram_event,
    send_review_notification,
)
from .services.telegram_announcements import (
    TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX,
    send_announcement_notification,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("deadlock-contracts-worker")
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

_STEAM_METADATA_FALLBACK_LAST_AT: datetime | None = None
_STEAM_METADATA_FALLBACK_COOLDOWN_SECONDS = 20 * 60


class NoMatchYet(RuntimeError):
    pass


class CompanionMatchNotReady(RuntimeError):
    def __init__(
        self,
        message: str,
        delay_seconds: int = 60,
    ) -> None:
        super().__init__(message)
        self.delay_seconds = max(
            15,
            min(int(delay_seconds), 6 * 60 * 60),
        )


class FinalFactsPending(RuntimeError):
    """Final match exists, but contract-grade provider facts are still lagging."""

    def __init__(self, message: str, delay_seconds: int = 20) -> None:
        super().__init__(message)
        self.delay_seconds = max(5, int(delay_seconds))


_PROVISIONAL_PROVIDER_RETRY_SCHEDULE = (
    10,
    20,
    40,
    60,
    120,
    300,
    600,
)


def _provisional_provider_retry_delay(
    attempt: int,
    provider_retry_after: int = 0,
) -> int:
    """Poll cheap provider cache/S3 quickly, then back off safely.

    This delay is used only after an exact Companion terminal match has already
    been bound provisionally. The provider lookup itself still starts with
    disable_steam=True, while the expensive Steam fallback remains separately
    throttled by the existing process-wide cooldown.
    """
    try:
        attempt_no = max(1, int(attempt))
    except (TypeError, ValueError):
        attempt_no = 1

    index = min(
        attempt_no - 1,
        len(_PROVISIONAL_PROVIDER_RETRY_SCHEDULE) - 1,
    )
    base_delay = _PROVISIONAL_PROVIDER_RETRY_SCHEDULE[index]

    try:
        retry_after = int(provider_retry_after or 0)
    except (TypeError, ValueError):
        retry_after = 0

    return max(
        base_delay,
        min(3600, max(0, retry_after)),
    )


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
        match = db.get(Match, item.match_id)
        queue_review_telegram_event(
            db,
            "decided",
            review_id=item.id,
            payload={
                "external_match_id": (
                    match.external_match_id
                    if match is not None
                    else None
                ),
                "case_status": "RESOLVED",
                "source": "provider_auto_settlement",
                "board_status_after": "SETTLED",
            },
        )
    return len(items)


def reconcile_active_contracts(db: Session) -> dict[str, int]:
    """Repair lifecycle/job gaps without requiring an admin action.

    Domain state is the source of truth: a LOCKED assignment needs discovery,
    a VERIFYING assignment needs one evaluator job for its exact match, and a
    board whose assignments are all terminal must be terminal too. Failed or
    prematurely DONE jobs are safely reopened because handlers are idempotent.
    """
    expired = expire_stale_boards(db, commit=False)
    now = utcnow()
    boards = list(
        db.scalars(
            select(ContractBoard).where(
                ContractBoard.status.in_(("LOCKED", "VERIFYING", "REVIEW_REQUIRED"))
            )
        ).all()
    )
    jobs = list(
        db.scalars(
            select(Job)
            .where(
                Job.type.in_(("discover_match", "evaluate_match", "promote_board_match_candidate")),
            )
            .order_by(Job.created_at.desc())
        ).all()
    )

    repaired_states = 0
    reopened_jobs = 0
    created_jobs = 0
    final_statuses = {"COMPLETED", "FAILED", "VOID", "EXPIRED"}

    def reopen(job: Job, max_attempts: int) -> None:
        nonlocal reopened_jobs
        job.status = "PENDING"
        job.attempts = 0
        job.max_attempts = max(int(job.max_attempts or 0), int(max_attempts))
        job.run_after = now
        job.locked_at = None
        job.locked_by = None
        job.last_error = "Automatically reopened by lifecycle reconciler"
        reopened_jobs += 1

    for board in boards:
        selected = list(
            db.scalars(
                select(BoardOption).where(
                    BoardOption.board_id == board.id,
                    BoardOption.selected.is_(True),
                )
            ).all()
        )
        if not selected:
            continue

        verifying = [item for item in selected if item.status == "VERIFYING"]
        locked = [item for item in selected if item.status == "LOCKED"]
        reviews = [item for item in selected if item.status == "REVIEW_REQUIRED"]

        desired = (
            "VERIFYING"
            if verifying
            else "LOCKED"
            if locked
            else "REVIEW_REQUIRED"
            if reviews
            else "SETTLED"
            if all(item.status in final_statuses for item in selected)
            else board.status
        )
        if board.status != desired:
            board.status = desired
            repaired_states += 1

        _wake_board_match_candidate(db, board, commit=False)

        for match_id in sorted({item.bound_match_id for item in verifying if item.bound_match_id}):
            bound_match = db.get(Match, str(match_id))
            evaluation_max_attempts = _evaluation_max_attempts_for_match(bound_match)
            candidates = [
                job
                for job in jobs
                if job.type == "evaluate_match"
                and job.board_id == board.id
                and job.match_id == str(match_id)
            ]
            active_candidates = [
                job for job in candidates if job.status in {"PENDING", "RUNNING"}
            ]
            if active_candidates:
                for candidate in active_candidates:
                    candidate.max_attempts = max(
                        int(candidate.max_attempts or 0),
                        int(evaluation_max_attempts),
                    )
                continue
            if candidates:
                reopen(candidates[0], evaluation_max_attempts)
            else:
                enqueue_job(
                    db,
                    "evaluate_match",
                    {"board_id": board.id, "match_id": match_id, "lifecycle_repair": True},
                    f"evaluate-reconcile-v1:{board.id}:{match_id}",
                    max_attempts=evaluation_max_attempts,
                    commit=False,
                )
                created_jobs += 1

        if (
            locked
            and not verifying
            and not _active_companion_candidate(db, board.id)
            and not gep_settlement_managed_user(db, board.user)
        ):
            candidates = [
                job
                for job in jobs
                if job.type == "discover_match"
                and job.board_id == board.id
            ]
            if not any(job.status in {"PENDING", "RUNNING"} for job in candidates):
                if candidates:
                    reopen(candidates[0], settings.max_discovery_attempts)
                else:
                    attempt = min(
                        int(board.attempts_used or 0) + 1,
                        int(board.max_attempts or settings.case_max_attempts),
                    )
                    enqueue_job(
                        db,
                        "discover_match",
                        {"board_id": board.id, "lifecycle_repair": True},
                        f"discover-reconcile-v1:{board.id}:attempt:{attempt}",
                        max_attempts=settings.max_discovery_attempts,
                        commit=False,
                    )
                    created_jobs += 1

    db.commit()
    return {
        "expired": expired,
        "repaired_states": repaired_states,
        "reopened_jobs": reopened_jobs,
        "created_jobs": created_jobs,
    }

def init() -> None:
    settings.validate()
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_missions(db)
        reclaim_stale_jobs(db)

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
            board_id = str(job.board_id or "")
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
                item.board_id == board_id
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
            board_id = str(job.board_id or "")
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
                    max_attempts=settings.provisional_post_match_max_attempts,
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
        lifecycle = reconcile_active_contracts(db)
        if any(lifecycle.values()):
            log.info("Startup lifecycle reconciliation: %s", lifecycle)

        audit_jobs = reconcile_match_audits(db)
        if audit_jobs:
            log.info(
                "Startup match audit reconciliation: queued=%s",
                audit_jobs,
            )


def store_normalized_match(db: Session, data: dict) -> Match:
    # Monotonic upsert with an explicit trust boundary. Sparse independent
    # provider refreshes may retain older independent facts, but client/GEP
    # observations may never enrich or overwrite an independently sourced row.
    external_match_id = int(data["external_match_id"])
    incoming_provider = str(data.get("provider") or "unknown")
    incoming_classifier = str(data.get("mode_classifier_version") or "unknown-v1")

    match = db.scalar(
        select(Match).where(Match.external_match_id == external_match_id)
    )
    existing_provider = str(match.provider or "unknown") if match else "unknown"
    existing_has_client = provider_has_client_source(existing_provider)
    existing_has_independent = provider_has_independent_source(existing_provider)
    incoming_has_independent = provider_has_independent_source(incoming_provider)
    incoming_has_client = provider_has_client_source(incoming_provider)
    existing_is_independent = existing_has_independent and not existing_has_client
    incoming_is_independent = incoming_has_independent and not incoming_has_client
    replace_tainted_facts = bool(incoming_is_independent and existing_has_client)
    ignore_incoming_facts = bool(
        existing_is_independent and not incoming_is_independent
    )

    if not match:
        match = Match(
            external_match_id=external_match_id,
            provider=incoming_provider,
            mode_classifier_version=incoming_classifier,
            game_match_mode="UNKNOWN",
            scoring_status="UNVERIFIABLE",
            is_final=False,
            capabilities=[],
        )
        db.add(match)
        db.flush()

    source_repair: dict[str, Any] | None = None
    if replace_tainted_facts:
        # Old releases merged GEP and provider labels and kept sparse GEP stats.
        # Once a fresh independent response arrives, discard every fact that
        # could have originated on the client before applying that response.
        source_repair = {
            "discarded_provider": existing_provider,
            "replacement_provider": incoming_provider,
            "trust_class": "T2_INDEPENDENT_PROVIDER",
            "repaired_at": utcnow().isoformat(),
        }
        for field in (
            "provider_payload_hash",
            "started_at",
            "ended_at",
            "duration_s",
            "provider_mode_raw",
            "game_version",
        ):
            setattr(match, field, None)
        match.game_match_mode = "UNKNOWN"
        match.mode_classifier_version = "unknown-v1"
        match.mode_confidence = "LOW"
        match.scoring_status = "UNVERIFIABLE"
        match.is_final = False
        match.capabilities = []
        match.raw_summary = {"source_repair": source_repair}
        for stale_participant in db.scalars(
            select(MatchParticipant).where(MatchParticipant.match_id == match.id)
        ).all():
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
                setattr(stale_participant, field, None)

    if replace_tainted_facts:
        providers = independent_provider_parts(incoming_provider)
    elif ignore_incoming_facts:
        providers = provider_parts(existing_provider)
    else:
        providers = provider_parts(existing_provider)
        for part in provider_parts(incoming_provider):
            if part not in providers:
                providers.append(part)
    match.provider = ("+".join(providers) or incoming_provider or "unknown")[:64]

    if not ignore_incoming_facts:
        for field in (
            "provider_payload_hash",
            "started_at",
            "ended_at",
            "duration_s",
            "provider_mode_raw",
            "scoring_status",
            "game_version",
            "settlement_source",
            "integrity_status",
            "audit_status",
            "audited_at",
        ):
            value = data.get(field)
            if value is not None and (not isinstance(value, str) or value.strip()):
                setattr(match, field, value)

    if not ignore_incoming_facts and "is_final" in data:
        match.is_final = bool(match.is_final) or bool(data.get("is_final"))

    rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
    incoming_conf = str(data.get("mode_confidence") or "LOW").upper()
    current_conf = str(match.mode_confidence or "LOW").upper()
    incoming_mode = str(data.get("game_match_mode") or "UNKNOWN").upper()
    current_mode = str(match.game_match_mode or "UNKNOWN").upper()
    valid_modes = {"STANDARD", "RANKED", "STREET_BRAWL"}

    if not ignore_incoming_facts and incoming_mode in valid_modes and (
        current_mode not in valid_modes
        or rank.get(incoming_conf, 0) >= rank.get(current_conf, 0)
    ):
        match.game_match_mode = incoming_mode

    if not ignore_incoming_facts and rank.get(incoming_conf, 0) > rank.get(current_conf, 0):
        match.mode_confidence = incoming_conf

    if (
        not ignore_incoming_facts
        and incoming_classifier
        and incoming_classifier != "unknown-v1"
        and (
            not match.mode_classifier_version
            or rank.get(incoming_conf, 0) >= rank.get(current_conf, 0)
        )
    ):
        match.mode_classifier_version = incoming_classifier

    if not ignore_incoming_facts:
        capabilities = set(match.capabilities or [])
        capabilities.update(data.get("capabilities") or [])
        match.capabilities = sorted(capabilities)

    incoming_summary = data.get("raw_summary")
    if ignore_incoming_facts and (incoming_has_client or incoming_provider == "unknown"):
        old_summary = match.raw_summary if isinstance(match.raw_summary, dict) else {}
        match.raw_summary = {
            **old_summary,
            "ignored_client_update": {
                "provider": incoming_provider,
                "keys": sorted(incoming_summary) if isinstance(incoming_summary, dict) else [],
                "trust_class": "T0_UNTRUSTED",
                "scoring_contribution": False,
                "ignored_at": utcnow().isoformat(),
            },
        }
    elif isinstance(incoming_summary, dict):
        old_summary = match.raw_summary if isinstance(match.raw_summary, dict) else {}
        match.raw_summary = {**old_summary, **incoming_summary}

    if ignore_incoming_facts:
        db.commit()
        db.refresh(match)
        return match

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

    if not ignore_incoming_facts:
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
    """Return the best diagnostic local-team/result observation.

    Evidence schema v7 distinguishes a real ``match_outcome`` *info update*
    from a winner value merely returned by getInfo/cache.  This matters because
    Deadlock GEP can retain the previous match winner after ``match_id`` has
    already advanced. The checks below improve correlation quality and reject
    stale/cross-match observations, but they do not make a user-controlled
    client authoritative:

    * authenticated identity for the exact Match ID;
    * a trusted match_end/session-end marker for that same match;
    * an explicit outcome info-update observed for that exact Match ID close to
      the terminal event; and
    * a known local team from the local roster.

    Neither this path nor the legacy stabilized path may create
    ``summary.result``.
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
                "trusted_for_scoring": False,
                "trust_reason": "client_info_update_diagnostic_only",
                "trust_class": "T0_UNTRUSTED",
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
    """Return a provisional terminal-session observation for one match.

    Finality is selected by *meaning*, not by an arbitrary recent-event window.
    Production match 99529660 proved that a frozen Companion can keep sending
    heartbeats for hours after the real ``match_ended`` event. Any fixed
    ``LIMIT N`` over the newest events can therefore lose the terminal marker.

    Accepted evidence combines an authenticated terminal lifecycle signal for
    the exact Match ID with gameplay continuity: a positive observed match
    clock. It is suitable for waking/correlating provider work, not scoring.
    Wall-clock session duration is not gameplay continuity. Phase alone is not
    enough because Deadlock can briefly emit/replay ``PostGame`` before play.

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

        gameplay_proof = bool(
            match_clock_s is not None
            and match_clock_s > 0
        )

        # Production match 100960330 emitted an authenticated match_end
        # during MatchIntro about nine seconds after the first session
        # marker. It must not become server-authoritative finality.
        if not gameplay_proof:
            continue

        match_clock_observed_at = _parse_companion_datetime(
            session.get("match_clock_observed_at")
        )

        local_team = str(session.get("local_team") or "").upper()
        outcome = str(session.get("match_outcome") or "").upper()
        return {
            "trusted": False,
            "trusted_for_scoring": False,
            "trust_class": "T0_UNTRUSTED",
            "source": "overwolf_gep_provisional",
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
    """Attach Companion observations as diagnostics, never as match facts.

    The Companion runs in a user-controlled JavaScript environment.  Device
    authentication proves which account sent a payload; it does not attest
    that the payload came from an unmodified client or from Deadlock.  Only an
    independent provider may contribute scoring capabilities, final stats,
    mode, duration or result.  GEP remains useful for correlation and live UI.
    """
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
    participant = data.get("participant")
    participant = dict(participant) if isinstance(participant, dict) else {}
    evidence_mode = str(evidence.game_match_mode or "").upper()
    provider_mode = str(data.get("game_match_mode") or "UNKNOWN").upper()
    raw_summary = data.get("raw_summary")
    raw_summary = dict(raw_summary) if isinstance(raw_summary, dict) else {}

    observed_stats = {
        field: getattr(evidence, field, None)
        for field in (
            "hero_id",
            "kills",
            "deaths",
            "assists",
            "hero_damage",
            "object_damage",
            "healing",
            "souls",
        )
        if getattr(evidence, field, None) is not None
    }

    finalization = _companion_finalization_from_events(
        db, user, external_match_id
    )
    if finalization:
        raw_summary["companion_finalization"] = {
            **{k: v for k, v in finalization.items() if k not in {"started_at", "ended_at"}},
            "started_at": finalization["started_at"].isoformat()
            if finalization.get("started_at")
            else None,
            "ended_at": finalization["ended_at"].isoformat()
            if finalization.get("ended_at")
            else None,
            "trusted_for_scoring": False,
            "trust_class": "T0_UNTRUSTED",
        }

    companion_result = _companion_result_from_events(
        db, user, external_match_id
    )
    if companion_result:
        diagnostic_result = dict(companion_result)
        diagnostic_result["trusted_for_scoring"] = False
        diagnostic_result["trust_class"] = "T0_UNTRUSTED"
        diagnostic_result["trust_reason"] = "client_observation_diagnostic_only"
        raw_summary["companion_outcome_diagnostic"] = diagnostic_result

        existing_won = participant.get("won")
        if (
            existing_won is not None
            and companion_result.get("won") is not None
            and bool(existing_won) != bool(companion_result["won"])
        ):
            raw_summary["result_diagnostic_conflict"] = {
                "provider_won": bool(existing_won),
                "companion_won": bool(companion_result["won"]),
                "companion_trusted": False,
                "resolution": "provider_result_wins",
            }

    if (
        evidence_mode in {"STANDARD", "RANKED", "STREET_BRAWL"}
        and provider_mode in {"STANDARD", "RANKED", "STREET_BRAWL"}
        and provider_mode != evidence_mode
    ):
        raw_summary["mode_conflict"] = {
            "provider_mode": provider_mode,
            "companion_mode": evidence_mode,
            "resolution": "provider_mode_wins",
        }

    raw_summary["companion_evidence"] = {
        "observed_stats": observed_stats,
        "observed_mode": evidence_mode or None,
        "captured_at": evidence.captured_at.isoformat()
        if evidence.captured_at
        else None,
        "external_match_id": int(external_match_id),
        "trust_class": "T0_UNTRUSTED",
        "scoring_contribution": False,
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
    """Never manufacture a scoring match from client-controlled evidence.

    Kept as an explicit fail-closed seam for legacy/manual review paths.
    Automatic exact-match resolution may create a separate non-scoring
    provisional row through _provisional_match_from_companion_evidence(), but
    this helper itself intentionally contributes no match facts.
    """
    return None


def _provisional_match_from_companion_evidence(
    db: Session,
    user: User,
    job: Job,
    external_match_id: int,
) -> dict | None:
    """Create a non-scoring provisional Match from strong Companion terminal evidence.

    This path restores local exact-match binding without restoring client
    authority over rewards. The row is intentionally marked as a client/GEP
    provider and carries no scoring capabilities. A later independent provider
    response replaces these provisional facts through store_normalized_match().
    """

    if user.account_id is None:
        return None

    evidence = _companion_evidence_for(
        db,
        user,
        external_match_id,
    )
    if evidence is None:
        return None

    finalization = _companion_finalization_from_events(
        db,
        user,
        external_match_id,
    )
    if finalization is None:
        return None

    started_at = finalization.get("started_at")
    if isinstance(started_at, str):
        started_at = _parse_companion_datetime(started_at)

    ended_at = finalization.get("ended_at")
    if isinstance(ended_at, str):
        ended_at = _parse_companion_datetime(ended_at)

    # Exact attempt binding requires a real session start. Do not substitute
    # detected_at here because that timestamp is only diagnostic.
    if not isinstance(started_at, datetime):
        return None

    if not isinstance(ended_at, datetime):
        return None

    mode = str(
        evidence.game_match_mode
        or job.game_match_mode
        or (job.payload or {}).get("game_match_mode")
        or ""
    ).upper()

    if mode not in {
        "STANDARD",
        "RANKED",
        "STREET_BRAWL",
    }:
        return None

    raw_summary = {
        "provisional_binding": {
            "source": "overwolf_gep",
            "trust_class": "T0_UNTRUSTED",
            "scoring_contribution": False,
            "independent_provider_pending": True,
            "external_match_id": int(external_match_id),
        },
        "companion_finalization": {
            **{
                key: value
                for key, value in finalization.items()
                if key not in {
                    "started_at",
                    "ended_at",
                }
            },
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
            "trusted_for_scoring": False,
            "trust_class": "T0_UNTRUSTED",
        },
    }

    return {
        "external_match_id": int(external_match_id),
        "provider": "gep_fallback",
        "provider_payload_hash": None,
        "started_at": started_at,
        "ended_at": ended_at,

        # GEP match_clock stays diagnostic. Do not manufacture authoritative
        # scored duration from it.
        "duration_s": None,

        "game_match_mode": mode,
        "provider_mode_raw": f"companion:{mode}",
        "mode_classifier_version": "companion-provisional-v1",
        "mode_confidence": "MEDIUM",

        # Lifecycle final means the exact local session ended. It still does
        # not mean provider-authoritative scoring finality.
        "is_final": True,
        "scoring_status": "UNVERIFIABLE",

        # Critical: no client observation becomes a server scoring capability.
        "capabilities": [],

        "raw_summary": raw_summary,

        "participant": {
            "account_id": int(user.account_id),
            "steam_id64": (
                int(evidence.steam_id64)
                if evidence.steam_id64 is not None
                else (
                    int(user.steam_id64)
                    if user.steam_id64 is not None
                    else None
                )
            ),
            "hero_id": evidence.hero_id,

            # These values are stored for provisional UI/diagnostics only.
            # Empty capabilities + client provider prevent reward settlement.
            "kills": evidence.kills,
            "deaths": evidence.deaths,
            "assists": evidence.assists,
            "net_worth": evidence.souls,
            "hero_damage": evidence.hero_damage,
            "object_damage": evidence.object_damage,
            "healing": evidence.healing,

            # Never derive win from client-only outcome.
            "won": None,
        },
    }


def _finish_discovery_jobs_for_board(db: Session, board_id: str) -> None:
    jobs = list(
        db.scalars(
            select(Job).where(
                Job.type == "discover_match",
                Job.board_id == board_id,
                Job.status.in_(("PENDING", "RUNNING")),
            )
        ).all()
    )
    changed = False
    for item in jobs:
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

    history_attempts = int(
        payload.get("_history_fallback_attempts") or 0
    )

    allow_history_retry = (
        history_attempts == 0
        or (
            history_attempts == 1
            and int(job.attempts or 0) >= 12
        )
    )

    if normalized is None and allow_history_retry:
        payload["_history_fallback_attempts"] = (
            history_attempts + 1
        )
        payload["_history_fallback_last_attempt"] = (
            utcnow().isoformat()
        )

        job.payload = payload
        db.commit()

        try:
            with DeadlockApiProvider() as provider:
                normalized = provider.fetch_match_by_id(
                    user.account_id,
                    external_match_id,
                    disable_steam=True,
                    consult_history=True,
                )

        except (
            ProviderRateLimited,
            ProviderError,
        ) as exc:
            remember_provider_wait(exc)
            normalized = None

    # A verified exact Match ID may use the Steam-backed metadata path at most
    # twice per job. A process-wide cooldown additionally prevents concurrent
    # pending matches from consuming the Steam fallback budget at the same time.
    #
    # Cheap cache/S3 metadata remains the primary retry path.
    global _STEAM_METADATA_FALLBACK_LAST_AT

    steam_attempts = int(
        payload.get("_steam_fallback_attempts") or 0
    )

    now = datetime.now(timezone.utc)

    steam_cooldown_ready = (
        _STEAM_METADATA_FALLBACK_LAST_AT is None
        or (
            now - _STEAM_METADATA_FALLBACK_LAST_AT
        ).total_seconds()
        >= _STEAM_METADATA_FALLBACK_COOLDOWN_SECONDS
    )

    allow_late_retry = (
        int(job.attempts or 0) >= 6
        and steam_attempts < 2
    )

    allow_steam_fallback = (
        normalized is None
        and evidence is not None
        and steam_cooldown_ready
        and (
            steam_attempts == 0
            or allow_late_retry
        )
    )

    if allow_steam_fallback:
        payload["_steam_fallback_attempts"] = (
            steam_attempts + 1
        )

        payload["_steam_fallback_last_attempt"] = (
            now.isoformat()
        )

        job.payload = payload
        db.commit()

        # Reserve the shared Steam slot before the HTTP request.
        # Even if the request fails, other pending matches must
        # respect the cooldown instead of immediately retrying.
        _STEAM_METADATA_FALLBACK_LAST_AT = now

        try:
            with DeadlockApiProvider() as provider:
                normalized = provider.fetch_match_by_id(
                    user.account_id,
                    external_match_id,
                    disable_steam=False,
                    consult_history=False,
                )

        except (
            ProviderRateLimited,
            ProviderError,
        ) as exc:
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
        normalized = _provisional_match_from_companion_evidence(
            db, user, job, external_match_id
        )

    if normalized is None:
        raise CompanionMatchNotReady(
            f"Матч #{external_match_id} обнаружен Companion и "
            "финальный локальный снимок сохранён, но независимый "
            "провайдер пока не опубликовал матч",
            delay_seconds=10 * 60,
        )

    normalized = merge_companion_evidence(
        db, user, normalized, external_match_id
    )
    _apply_companion_time_fallback(normalized, job)
    return normalized

def _board_has_bound_match(db: Session, board_id: str) -> bool:
    """Whether the current automatic attempt already has an in-flight match.

    Historical COMPLETED/FAILED assignments and a parallel REVIEW_REQUIRED
    assignment keep their Match IDs, but must not block another still-LOCKED
    assignment from using attempt 2/3 or 3/3.
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
            if option.status == "VERIFYING"
        )
    )


def _active_companion_candidate(db: Session, board_id: str) -> Job | None:
    board = db.get(ContractBoard, board_id)
    if not board:
        return None
    jobs = list(
        db.scalars(
            select(Job)
            .where(
                Job.type.in_(("resolve_companion_match", "resolve_companion_match_auto")),
                Job.status.in_(("PENDING", "RUNNING")),
                or_(
                    Job.board_id == board_id,
                    and_(
                        Job.type == "resolve_companion_match_auto",
                        Job.user_id == board.user_id,
                        Job.game_match_mode == board.game_match_mode,
                    ),
                ),
            )
            .order_by(Job.created_at.asc())
        ).all()
    )
    for job in jobs:
        if job.board_id == board_id:
            return job
        if (
            job.type == "resolve_companion_match_auto"
            and job.user_id == board.user_id
            and job.game_match_mode == board.game_match_mode
        ):
            return job
    return None



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
    guard_active_review_claim(
        db,
        board_id=board.id,
        lock=True,
    )

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
        "independent_provider": "независимое подтверждение матча",
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

def _is_provisional_companion_match(match: Match | None) -> bool:
    if match is None:
        return False

    provider = str(match.provider or "")
    if not (
        provider_has_client_source(provider)
        and not provider_has_independent_source(provider)
    ):
        return False

    raw_summary = match.raw_summary if isinstance(match.raw_summary, dict) else {}
    provisional = raw_summary.get("provisional_binding")
    return bool(
        isinstance(provisional, dict)
        and provisional.get("independent_provider_pending") is True
        and provisional.get("scoring_contribution") is False
    )


def _is_client_attested_gep_match(
    match: Match | None,
) -> bool:
    if match is None:
        return False

    return bool(
        str(
            getattr(
                match,
                "settlement_source",
                "",
            )
            or ""
        ).upper()
        == GEP_SETTLEMENT_SOURCE
        and str(
            getattr(
                match,
                "integrity_status",
                "",
            )
            or ""
        ).upper()
        == GEP_INTEGRITY_CLIENT_ATTESTED
    )


def _evaluation_max_attempts_for_match(
    match: Match | None,
) -> int:
    default_attempts = max(
        3,
        settings.post_match_verification_max_attempts,
    )
    if _is_provisional_companion_match(match):
        return max(default_attempts, settings.provisional_post_match_max_attempts)
    return default_attempts

def _queue_repair_evaluation(
    db: Session,
    board: ContractBoard,
    match: Match,
) -> None:
    guard_active_review_claim(
        db,
        board_id=board.id,
        match_id=match.id,
        lock=True,
    )

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
    evaluation_max_attempts = _evaluation_max_attempts_for_match(match)
    evaluation_job = enqueue_job(
        db,
        "evaluate_match",
        {"board_id": board.id, "match_id": match.id, "finality_repair": "final-v5-outcome-v7"},
        f"evaluate-final-v5-outcome-v7:{board.id}:{match.id}",
        max_attempts=evaluation_max_attempts,
        commit=False,
    )
    evaluation_job.max_attempts = max(
        int(evaluation_job.max_attempts or 0),
        int(evaluation_max_attempts),
    )
    db.commit()


def bind_match(
    db: Session,
    board: ContractBoard,
    match: Match,
    *,
    commit: bool = True,
) -> None:
    locked_board = db.scalar(
        select(ContractBoard).where(
            ContractBoard.id == board.id
        ).with_for_update().execution_options(populate_existing=True)
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
            .execution_options(populate_existing=True)
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

    # REVIEW_REQUIRED assignments remain bound to their historical match and
    # can be decided independently. Only still-LOCKED assignments enter the
    # next gameplay attempt.
    active_options = [option for option in options if option.status == "LOCKED"]

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

    evaluation_max_attempts = _evaluation_max_attempts_for_match(match)

    enqueue_job(
        db,
        "evaluate_match",
        {
            "board_id": board.id,
            "match_id": match.id,
        },
        f"evaluate:{board.id}:{match.id}",
        max_attempts=evaluation_max_attempts,
        commit=False,
    )
    # Attempt binding and the evaluator job are one durable transition.
    if commit:
        db.commit()
    else:
        db.flush()


def _candidate_promotion_max_attempts() -> int:
    return max(
        int(settings.max_discovery_attempts),
        int(settings.provisional_post_match_max_attempts),
    )


def _earliest_captured_board_match_candidate(
    db: Session,
    board_id: str,
) -> BoardMatchCandidate | None:
    return db.scalar(
        select(BoardMatchCandidate)
        .join(Match, Match.id == BoardMatchCandidate.match_id)
        .where(
            BoardMatchCandidate.board_id == board_id,
            BoardMatchCandidate.status == "CAPTURED",
        )
        .order_by(
            Match.started_at.asc(),
            Match.external_match_id.asc(),
            BoardMatchCandidate.captured_at.asc(),
        )
        .limit(1)
    )


def _wake_board_match_candidate(
    db: Session,
    board: ContractBoard,
    *,
    commit: bool = True,
) -> bool:
    candidate = _earliest_captured_board_match_candidate(db, board.id)
    if candidate is None:
        return False

    now = utcnow()
    key = f"promote-board-match-candidate:{candidate.id}"
    promotion = enqueue_job(
        db,
        "promote_board_match_candidate",
        {
            "board_id": board.id,
            "candidate_id": candidate.id,
            "match_id": candidate.match_id,
            "mode_hint": board.game_match_mode,
        },
        key,
        run_after=now,
        max_attempts=_candidate_promotion_max_attempts(),
        commit=False,
    )
    promotion.max_attempts = max(
        int(promotion.max_attempts or 0),
        _candidate_promotion_max_attempts(),
    )
    # The PostgreSQL candidate row is the truth. If an old wake-up job was
    # completed/failed while the candidate is still CAPTURED, reopen it.
    if promotion.status in {"DONE", "FAILED"}:
        promotion.status = "PENDING"
        promotion.attempts = 0
        promotion.run_after = now
        promotion.locked_at = None
        promotion.locked_by = None
        promotion.last_error = None
    elif promotion.status == "PENDING":
        current_run_after = aware(promotion.run_after)
        if current_run_after is None or current_run_after > now:
            promotion.run_after = now

    if commit:
        db.commit()
    else:
        db.flush()
    return True


def _ignore_board_match_candidate(
    candidate: BoardMatchCandidate,
    reason: str,
) -> None:
    candidate.status = "IGNORED"
    candidate.ignored_reason = reason[:120]
    candidate.attempt_no = None
    candidate.bound_at = None


def _capture_or_bind_companion_match(
    db: Session,
    board: ContractBoard,
    match: Match,
    *,
    capture_source: str,
) -> str:
    locked_board = db.scalar(
        select(ContractBoard)
        .where(ContractBoard.id == board.id)
        .with_for_update()
    )
    if not locked_board:
        raise ValueError("Доска контрактов не найдена")
    board = locked_board

    candidate = db.scalar(
        select(BoardMatchCandidate)
        .where(
            BoardMatchCandidate.board_id == board.id,
            BoardMatchCandidate.match_id == match.id,
        )
        .with_for_update()
    )
    if candidate is None:
        candidate = BoardMatchCandidate(
            board_id=board.id,
            match_id=match.id,
            status="CAPTURED",
            capture_source=capture_source,
        )
        db.add(candidate)
        db.flush()
    elif candidate.status in {"BOUND", "IGNORED"}:
        return candidate.status

    selected = list(
        db.scalars(
            select(BoardOption)
            .where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
            .with_for_update()
        ).all()
    )

    # Duplicate delivery of the current attempt is idempotent.
    if any(
        option.bound_match_id == match.id
        and option.status == "VERIFYING"
        for option in selected
    ):
        candidate.status = "BOUND"
        candidate.attempt_no = int(board.attempts_used or 0) or None
        candidate.bound_at = candidate.bound_at or utcnow()
        db.commit()
        return "BOUND"

    already_evaluated = db.scalar(
        select(Evaluation.id)
        .join(BoardOption, BoardOption.id == Evaluation.assignment_id)
        .where(
            BoardOption.board_id == board.id,
            Evaluation.match_id == match.id,
        )
        .limit(1)
    )
    if already_evaluated:
        _ignore_board_match_candidate(candidate, "ALREADY_EVALUATED")
        db.commit()
        return "IGNORED"

    if board.status == "SETTLED":
        _ignore_board_match_candidate(candidate, "BOARD_SETTLED")
        db.commit()
        return "IGNORED"

    started_at = aware(match.started_at)
    locked_at = aware(board.locked_at)
    if started_at is None or locked_at is None or started_at <= locked_at:
        _ignore_board_match_candidate(candidate, "MATCH_BEFORE_BOARD_LOCK")
        db.commit()
        return "IGNORED"
    if match.game_match_mode != board.game_match_mode:
        _ignore_board_match_candidate(candidate, "MODE_MISMATCH")
        db.commit()
        return "IGNORED"
    if (
        board.baseline_match_id is not None
        and int(match.external_match_id) <= int(board.baseline_match_id)
    ):
        _ignore_board_match_candidate(candidate, "NOT_NEWER_THAN_BASELINE")
        db.commit()
        return "IGNORED"

    locked_options = [item for item in selected if item.status == "LOCKED"]
    if (
        _board_has_bound_match(db, board.id)
        or board.status == "REVIEW_REQUIRED"
        or not locked_options
    ):
        _wake_board_match_candidate(db, board, commit=False)
        db.commit()
        return "CAPTURED"

    before_attempts = int(board.attempts_used or 0)
    bind_match(db, board, match, commit=False)
    if int(board.attempts_used or 0) == before_attempts + 1:
        candidate.status = "BOUND"
        candidate.attempt_no = int(board.attempts_used)
        candidate.bound_at = utcnow()
        candidate.ignored_reason = None
        db.commit()
        return "BOUND"

    # A no-op bind can only mean this match was already consumed or there is
    # no eligible LOCKED assignment. Keep the latter durable instead of losing it.
    if any(item.status == "LOCKED" for item in selected):
        _ignore_board_match_candidate(candidate, "MATCH_NOT_BINDABLE")
        db.commit()
        return "IGNORED"

    _wake_board_match_candidate(db, board, commit=False)
    db.commit()
    return "CAPTURED"


def handle_promote_board_match_candidate(db: Session, job: Job) -> None:
    candidate_id = str((job.payload or {}).get("candidate_id") or "")
    if not candidate_id:
        raise ValueError("promote_board_match_candidate: отсутствует candidate_id")

    candidate = db.scalar(
        select(BoardMatchCandidate)
        .where(BoardMatchCandidate.id == candidate_id)
        .with_for_update()
    )
    if candidate is None or candidate.status != "CAPTURED":
        return

    board = db.scalar(
        select(ContractBoard)
        .where(ContractBoard.id == candidate.board_id)
        .with_for_update()
    )
    match = db.get(Match, candidate.match_id)
    if board is None or match is None:
        if candidate is not None:
            _ignore_board_match_candidate(candidate, "MISSING_BOARD_OR_MATCH")
            db.commit()
        return

    earliest = _earliest_captured_board_match_candidate(db, board.id)
    if earliest is not None and earliest.id != candidate.id:
        _wake_board_match_candidate(db, board, commit=False)
        db.commit()
        raise CompanionMatchNotReady(
            "Более ранний сохранённый матч должен быть обработан первым",
            delay_seconds=15,
        )

    if board.status == "SETTLED":
        _ignore_board_match_candidate(candidate, "BOARD_SETTLED")
        db.commit()
        _wake_board_match_candidate(db, board)
        return

    if _board_has_bound_match(db, board.id):
        raise CompanionMatchNotReady(
            f"Матч #{match.external_match_id} сохранён; ждём предыдущий verdict",
            delay_seconds=60,
        )

    selected = list(
        db.scalars(
            select(BoardOption)
            .where(
                BoardOption.board_id == board.id,
                BoardOption.selected.is_(True),
            )
            .with_for_update()
        ).all()
    )
    if board.status == "REVIEW_REQUIRED" or not any(
        item.status == "LOCKED" for item in selected
    ):
        raise CompanionMatchNotReady(
            f"Матч #{match.external_match_id} сохранён; ждём освобождения попытки",
            delay_seconds=60,
        )

    if board.attempts_used >= board.max_attempts:
        _ignore_board_match_candidate(candidate, "ATTEMPTS_EXHAUSTED")
        db.commit()
        _wake_board_match_candidate(db, board)
        return

    if (
        board.baseline_match_id is not None
        and int(match.external_match_id) <= int(board.baseline_match_id)
    ):
        _ignore_board_match_candidate(candidate, "NOT_NEWER_THAN_BASELINE")
        db.commit()
        _wake_board_match_candidate(db, board)
        return

    before_attempts = int(board.attempts_used or 0)
    bind_match(db, board, match, commit=False)
    if int(board.attempts_used or 0) != before_attempts + 1:
        _ignore_board_match_candidate(candidate, "MATCH_NOT_BINDABLE")
        db.commit()
        _wake_board_match_candidate(db, board)
        return

    candidate.status = "BOUND"
    candidate.attempt_no = int(board.attempts_used)
    candidate.bound_at = utcnow()
    candidate.ignored_reason = None
    db.commit()


def handle_discover(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, job.board_id or job.payload["board_id"])
    if not board:
        raise ValueError("Доска контрактов не найдена")
    if board.status == "SETTLED":
        return
    if _wake_board_match_candidate(db, board):
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
                    BoardOption.status == "LOCKED",
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
    """Record client detection time without promoting it to a provider fact."""

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

    raw_summary = normalized.get("raw_summary")
    raw_summary = dict(raw_summary) if isinstance(raw_summary, dict) else {}
    raw_summary["companion_detected_at"] = {
        "observed_at": detected_at.isoformat(),
        "trust_class": "T0_UNTRUSTED",
        "scoring_contribution": False,
    }
    normalized["raw_summary"] = raw_summary


def handle_resolve_companion_match(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, job.board_id or job.payload["board_id"])
    if not board:
        raise ValueError("Доска контрактов не найдена")

    if board.status == "SETTLED":
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

    _capture_or_bind_companion_match(
        db,
        board,
        match,
        capture_source="COMPANION_DIRECT",
    )
    _finish_discovery_jobs_for_board(db, board.id)



def handle_resolve_companion_match_auto(db: Session, job: Job) -> None:
    user = db.get(User, str(job.user_id or job.payload.get("user_id") or ""))
    if not user or user.account_id is None:
        raise ValueError("Пользователь Companion не найден")

    external_match_id = int(job.payload.get("external_match_id") or 0)
    if external_match_id <= 0:
        raise ValueError("Companion не передал корректный Match ID")

    # Old queued jobs can survive after the new GEP settlement already stored
    # this exact match. Do not call Deadlock API again for that legacy path.
    settled_gep_match = db.scalar(
        select(Match)
        .where(
            Match.external_match_id == external_match_id,
            Match.settlement_source == GEP_SETTLEMENT_SOURCE,
            Match.integrity_status == GEP_INTEGRITY_CLIENT_ATTESTED,
        )
        .order_by(Match.created_at.desc())
        .limit(1)
    )
    if settled_gep_match is not None:
        log.info(
            "Skipping legacy Companion resolver for GEP-settled match %s",
            external_match_id,
        )
        return

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
        _capture_or_bind_companion_match(
            db,
            board,
            match,
            capture_source="COMPANION_AUTO",
        )
        _finish_discovery_jobs_for_board(db, board.id)
        return

    return



def handle_settle_gep_match(
    db: Session,
    job: Job,
) -> None:
    payload = dict(job.payload or {})

    lease_id = str(
        payload.get("lease_id")
        or ""
    )
    evidence_id = str(
        payload.get("evidence_id")
        or ""
    )

    if not lease_id or not evidence_id:
        raise ValueError(
            "settle_gep_match: "
            "lease/evidence id отсутствует"
        )

    lease = db.get(
        CompanionAttemptLease,
        lease_id,
        populate_existing=True,
    )

    evidence = db.get(
        CompanionMatchEvidence,
        evidence_id,
        populate_existing=True,
    )

    if not lease or not evidence:
        raise ValueError(
            "settle_gep_match: "
            "lease/evidence не найден"
        )

    user = db.get(
        User,
        lease.user_id,
    )

    if not user:
        raise ValueError(
            "settle_gep_match: "
            "user не найден"
        )

    if lease.status not in {
        "CONSUMED",
        "CONSUMED_QUEUED",
    }:
        raise ValueError(
            "settle_gep_match: "
            f"invalid lease state {lease.status}"
        )

    if (
        evidence.user_id
        != lease.user_id
        or evidence.device_id
        != lease.device_id
        or evidence.gep_session_id
        != lease.session_id
        or evidence.attempt_nonce_hash
        != lease.attempt_nonce_hash
    ):
        raise ValueError(
            "settle_gep_match: "
            "lease/evidence integrity mismatch"
        )

    normalized = (
        normalized_gep_match_from_evidence(
            lease=lease,
            evidence=evidence,
            user=user,
        )
    )

    match = store_normalized_match(
        db,
        normalized,
    )

    board = (
        db.get(
            ContractBoard,
            lease.board_id,
        )
        if lease.board_id
        else None
    )

    if board is None:
        return

    if board.user_id != user.id:
        raise ValueError(
            "settle_gep_match: "
            "board owner mismatch"
        )

    if (
        board.game_match_mode
        != match.game_match_mode
    ):
        raise ValueError(
            "settle_gep_match: "
            "mode mismatch"
        )

    _capture_or_bind_companion_match(
        db,
        board,
        match,
        capture_source="OVERWOLF_GEP_V9",
    )

    _finish_discovery_jobs_for_board(
        db,
        board.id,
    )

    # Audit is intentionally after the settlement transition. Failure to
    # enqueue/read Deadlock API must never roll back a bound match or reward.
    audit_external_match_id = int(match.external_match_id)

    try:
        schedule_gep_match_audit(
            db,
            match,
            user.id,
        )
    except Exception:
        db.rollback()
        log.exception(
            "Non-blocking Deadlock API audit scheduling failed for match=%s",
            audit_external_match_id,
        )


def handle_refresh_review_match(db: Session, job: Job) -> None:
    """Повторно загрузить final metadata уже привязанного матча и переоценить REVIEW_REQUIRED."""

    board_id = str(job.board_id or (job.payload or {}).get("board_id") or "")
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
    board = db.get(ContractBoard, job.board_id or job.payload["board_id"])
    match = db.get(Match, job.match_id or job.payload["match_id"])
    if not board or not match:
        raise ValueError("Доска или матч не найдены")
    bind_match(db, board, match)


def handle_evaluate(db: Session, job: Job) -> None:
    board = db.get(ContractBoard, str(job.board_id or job.payload.get("board_id") or ""))
    match = db.get(Match, str(job.match_id or job.payload.get("match_id") or ""))
    if not board or not match:
        raise ValueError("Доска или матч для оценки не найдены")

    missing_by_option = _missing_contract_facts_by_option(db, board, match)
    if not missing_by_option:
        # No active assignment belongs to this exact attempt any more. In
        # particular, never evaluate the whole board when an old job replays.
        return
    missing = sorted({fact for facts in missing_by_option.values() for fact in facts})
    provisional_companion_match = _is_provisional_companion_match(match)

    if (
        settings.provider == "deadlock_api"
        and not _is_client_attested_gep_match(match)
        and (missing or provisional_companion_match)
    ):
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

        provisional_companion_match = _is_provisional_companion_match(match)

        if provisional_companion_match:
            max_wait_attempts = max(
                1,
                int(
                    job.max_attempts
                    or settings.post_match_verification_max_attempts
                ),
            )

            if int(job.attempts or 0) < max_wait_attempts:
                active_option_ids = {
                    option.id
                    for option in db.scalars(
                        select(BoardOption).where(
                            BoardOption.board_id == board.id,
                            BoardOption.selected.is_(True),
                            BoardOption.bound_match_id == match.id,
                        )
                    ).all()
                    if option.status not in {
                        "COMPLETED",
                        "FAILED",
                        "EXPIRED",
                        "VOID",
                    }
                }

                wait_reasons = ["independent_provider", *missing]
                _mark_board_verifying_for_facts(
                    db,
                    board,
                    wait_reasons,
                    option_ids=active_option_ids,
                )

                provider_retry_after = 0
                try:
                    provider_retry_after = int(
                        (job.payload or {}).get(
                            "_provider_retry_after"
                        )
                        or 0
                    )
                except (TypeError, ValueError):
                    provider_retry_after = 0

                delay = _provisional_provider_retry_delay(
                    int(job.attempts or 1),
                    provider_retry_after,
                )

                raise FinalFactsPending(
                    (
                        f"Матч #{match.external_match_id} обнаружен и "
                        "локально завершён; ждём независимое "
                        "подтверждение провайдера"
                    ),
                    delay,
                )

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

    max_wait_attempts = max(
        1,
        int(
            job.max_attempts
            or settings.post_match_verification_max_attempts
        ),
    )
    waiting_option_ids = {
        option_id for option_id, facts in missing_by_option.items() if facts
    }
    if (
        missing
        and settings.provider == "deadlock_api"
        and not _is_client_attested_gep_match(match)
        and int(job.attempts or 0) < max_wait_attempts
    ):
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

    db.refresh(board)
    _wake_board_match_candidate(db, board)

OUTBOX_MAX_ATTEMPTS = 8
OUTBOX_RETRY_BASE_SECONDS = 10
OUTBOX_RETRY_MAX_SECONDS = 15 * 60


def _outbox_retry_delay(attempt: int) -> int:
    exponent = max(0, min(int(attempt) - 1, 6))
    return min(
        OUTBOX_RETRY_MAX_SECONDS,
        OUTBOX_RETRY_BASE_SECONDS * (2 ** exponent),
    )


def _is_duplicate_reward_integrity_error(exc: IntegrityError) -> bool:
    """Recognize only the reward-source idempotency constraint.

    PostgreSQL exposes the violated constraint through ``diag``. SQLite is
    used by the unit suite and exposes a stable column-list message instead.
    Any unrelated IntegrityError must remain retryable/dead-letterable.
    """
    original = getattr(exc, "orig", None)
    diagnostic = getattr(original, "diag", None)
    constraint_name = str(
        getattr(diagnostic, "constraint_name", "") or ""
    ).strip()
    if constraint_name == "uq_reward_source":
        return True

    message = str(original or exc).lower()
    return (
        "uq_reward_source" in message
        or (
            "unique constraint failed" in message
            and "reward_ledger.source_type" in message
            and "reward_ledger.source_id" in message
        )
    )


def _record_outbox_failure(
    db: Session,
    event_id: str,
    error: Exception,
    *,
    retry_after_seconds: int | None = None,
) -> None:
    event = db.scalar(
        select(OutboxEvent)
        .where(OutboxEvent.id == event_id)
        .with_for_update()
    )
    if not event:
        return

    event.attempts = int(event.attempts or 0) + 1
    event.last_error = str(error)[:4000]

    if event.attempts >= OUTBOX_MAX_ATTEMPTS:
        event.dead_lettered_at = utcnow()
        log.error(
            "Outbox event %s moved to dead letter after %s attempts",
            event.id,
            event.attempts,
        )
    else:
        delay = _outbox_retry_delay(event.attempts)
        if retry_after_seconds is not None:
            delay = max(
                delay,
                min(24 * 60 * 60, max(0, int(retry_after_seconds))),
            )
        event.run_after = utcnow() + timedelta(seconds=delay)
        log.warning(
            "Outbox event %s failed; retry %s/%s in %ss",
            event.id,
            event.attempts,
            OUTBOX_MAX_ATTEMPTS,
            delay,
        )

    db.commit()

def dispatch_outbox(db: Session) -> bool:
    now = utcnow()

    filters = [
        OutboxEvent.published_at.is_(None),
        OutboxEvent.dead_lettered_at.is_(None),
        OutboxEvent.run_after <= now,
    ]
    # Emergency freeze: reward events remain durable and visible in Admin,
    # while unrelated review notifications can continue to flow.
    if not settings.reward_settlement_enabled:
        filters.append(OutboxEvent.event_type != "assignment.settled")

    # Emergency freeze for Telegram moderation delivery. Keep already queued
    # events durable and unpublished rather than consuming them as "skipped".
    # When the feature flag is turned back on, normal outbox dispatch resumes.
    if not getattr(
        settings,
        "telegram_moderation_notifications_enabled",
        False,
    ):
        filters.append(
            ~OutboxEvent.event_type.startswith(
                TELEGRAM_REVIEW_EVENT_PREFIX
            )
        )

    if not getattr(
        settings,
        "announcements_telegram_mirror_enabled",
        False,
    ):
        filters.append(
            ~OutboxEvent.event_type.startswith(
                TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX
            )
        )

    event = db.scalar(
        select(OutboxEvent)
        .where(*filters)
        .order_by(
            OutboxEvent.run_after.asc(),
            OutboxEvent.created_at.asc(),
        )
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
        elif event.event_type.startswith(TELEGRAM_REVIEW_EVENT_PREFIX):
            result = send_review_notification(
                event.event_type,
                event.payload if isinstance(event.payload, dict) else {},
            )
            payload = (
                dict(event.payload)
                if isinstance(event.payload, dict)
                else {}
            )
            payload["telegram_delivery"] = result.to_dict()
            event.payload = payload
        elif event.event_type.startswith(
            TELEGRAM_ANNOUNCEMENT_EVENT_PREFIX
        ):
            result = send_announcement_notification(
                event.event_type,
                event.payload if isinstance(event.payload, dict) else {},
            )
            payload = (
                dict(event.payload)
                if isinstance(event.payload, dict)
                else {}
            )
            payload["telegram_delivery"] = result.to_dict()
            event.payload = payload
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
                headers={"Content-Type": "application/json", "User-Agent": f"DeadlockContracts/{settings.app_version}"},
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                if response.status not in {200, 204}:
                    raise RuntimeError(f"Review notification returned HTTP {response.status}")
        event.published_at = utcnow()
        event.last_error = None
        db.commit()
    except IntegrityError as exc:
        event_id = event.id
        db.rollback()
        if _is_duplicate_reward_integrity_error(exc):
            event = db.get(OutboxEvent, event_id)
            if event:
                event.published_at = utcnow()
                event.last_error = (
                    "Duplicate reward prevented by unique source constraint"
                )
                db.commit()
        else:
            _record_outbox_failure(db, event_id, exc)
    except TelegramDeliveryError as exc:
        event_id = event.id
        db.rollback()
        _record_outbox_failure(
            db,
            event_id,
            exc,
            retry_after_seconds=exc.retry_after_seconds,
        )
        log.warning("Telegram outbox delivery failed: %s", exc)
    except Exception as exc:
        event_id = event.id
        db.rollback()
        _record_outbox_failure(db, event_id, exc)

        log.exception("Outbox dispatch failed")
    return True


def process_job(db: Session, job: Job) -> None:
    handlers = {
        "discover_match": handle_discover,
        "resolve_companion_match": handle_resolve_companion_match,
        "resolve_companion_match_auto": handle_resolve_companion_match_auto,
        "settle_gep_match": handle_settle_gep_match,
        "audit_match": run_match_audit_job,
        "promote_board_match_candidate": handle_promote_board_match_candidate,
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
    *,
    owner: tuple[str, int] | None = None,
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
    retry_job(db, failed_job, exc, delay, owner=owner)
    log.exception(
        "Job %s (%s) failed; transaction rolled back and retry policy applied",
        job_id,
        job_type,
    )
    return True


def run() -> None:
    init()
    log.info("Worker %s started; provider=%s", WORKER_ID, settings.provider)
    next_maintenance_at = time.monotonic() + 60
    while True:
        did_work = False
        if time.monotonic() >= next_maintenance_at:
            try:
                with SessionLocal() as db:
                    lifecycle = reconcile_active_contracts(db)
                    if any(lifecycle.values()):
                        log.info("Lifecycle reconciliation: %s", lifecycle)

                    audit_jobs = reconcile_match_audits(db)
                    if audit_jobs:
                        log.info(
                            "Match audit reconciliation: queued=%s",
                            audit_jobs,
                        )
            except Exception:
                log.exception("Lifecycle reconciliation failed")
            try:
                from .services.bureau_operations import maintenance as bureau_maintenance
                bureau_maintenance(SessionLocal)
            except Exception:
                log.exception("Bureau operation reconciliation failed")
            try:
                from .services.hero_votes import maintenance as hero_vote_maintenance
                hero_vote_maintenance(SessionLocal)
            except Exception:
                log.exception("Community hero poll refresh failed")
            next_maintenance_at = time.monotonic() + 60
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
                owner = (WORKER_ID, job_attempts)
                try:
                    with keep_job_lease(SessionLocal, job_id, WORKER_ID, job_attempts):
                        process_job(db, job)
                    if complete_job(db, job, owner=owner):
                        log.info("Completed job %s %s", job_type, job_id)
                    else:
                        log.warning("Skipped completion of lost lease %s", job_id)
                except MatchAuditPending as exc:
                    retry_job(
                        db,
                        job,
                        exc,
                        exc.delay_seconds,
                        owner=owner,
                    )
                    log.info(
                        "Match audit pending for job %s; retry in %ss",
                        job_id,
                        exc.delay_seconds,
                    )
                except ProviderRateLimited as exc:
                    retry_job(db, job, exc, max(exc.retry_after, 30), owner=owner)
                    log.warning("Provider rate limited; retry in %ss", exc.retry_after)
                except ActiveReviewClaim as exc:
                    retry_job(
                        db,
                        job,
                        exc,
                        exc.delay_seconds,
                        owner=owner,
                    )
                    log.info(
                        "Human review claim active for job %s; "
                        "retry in %ss",
                        job_id,
                        exc.delay_seconds,
                    )
                except FinalFactsPending as exc:
                    retry_job(db, job, exc, exc.delay_seconds, owner=owner)
                    log.info("Final provider facts pending for job %s; retry in %ss", job_id, exc.delay_seconds)
                except ProviderError as exc:
                    retry_job(db, job, exc, 30, owner=owner)
                    log.warning("Provider error for job %s; retry in 30s: %s", job_id, exc)
                except CompanionMatchNotReady as exc:
                    retry_job(
                        db,
                        job,
                        exc,
                        exc.delay_seconds,
                        owner=owner,
                    )
                    log.info(
                        "Companion match not ready for job %s; retry in %ss",
                        job.id,
                        exc.delay_seconds,
                    )
                except NoMatchYet as exc:
                    retry_job(db, job, exc, settings.discovery_retry_seconds, owner=owner)
                    log.info("No match yet for job %s", job.id)
                except Exception as exc:
                    _recover_unexpected_job_error(
                        db,
                        job_id,
                        job_type,
                        job_attempts,
                        exc,
                        owner=owner,
                    )
        if not did_work:
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run()
