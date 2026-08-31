from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Job, Match, MatchParticipant, User
from .gep_settlement import (
    GEP_INTEGRITY_CLIENT_ATTESTED,
    GEP_SETTLEMENT_SOURCE,
)
from .jobs import enqueue_job
from .providers import (
    DeadlockApiProvider,
    ProviderError,
    ProviderRateLimited,
)


AUDIT_TERMINAL_STATUSES = {
    "CONFIRMED",
    "MISMATCH",
    "UNAVAILABLE",
}

AUDIT_PROVIDER = "deadlock_api"
AUDIT_POLICY_VERSION = "deadlock-api-audit-v1"
VALID_GAME_MODES = {
    "STANDARD",
    "RANKED",
    "STREET_BRAWL",
}


class MatchAuditPending(RuntimeError):
    """The external audit source is not ready yet.

    This exception is intentionally caught only by the worker retry loop.
    Settlement, evaluation, RewardLedger and XP are already independent from it.
    """

    def __init__(
        self,
        message: str,
        delay_seconds: int,
    ) -> None:
        super().__init__(message)
        self.delay_seconds = max(
            60,
            min(int(delay_seconds), 24 * 60 * 60),
        )


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _raw_summary(match: Match) -> dict[str, Any]:
    return (
        dict(match.raw_summary)
        if isinstance(match.raw_summary, dict)
        else {}
    )


def _write_audit_report(
    match: Match,
    report: dict[str, Any],
) -> None:
    raw = _raw_summary(match)
    raw["audit"] = report
    match.raw_summary = raw


def _is_gep_audit_candidate(
    match: Match,
) -> bool:
    return bool(
        str(match.settlement_source or "").upper()
        == GEP_SETTLEMENT_SOURCE
        and str(match.integrity_status or "").upper()
        == GEP_INTEGRITY_CLIENT_ATTESTED
    )


def _user_for_match(
    db: Session,
    match: Match,
) -> User | None:
    participant = db.scalar(
        select(MatchParticipant)
        .where(MatchParticipant.match_id == match.id)
        .order_by(MatchParticipant.created_at.asc())
        .limit(1)
    )

    if participant is None:
        return None

    return db.scalar(
        select(User)
        .where(User.account_id == participant.account_id)
        .limit(1)
    )


def schedule_gep_match_audit(
    db: Session,
    match: Match,
    user_id: str,
    *,
    commit: bool = True,
) -> Job | None:
    """Queue a non-authoritative Deadlock API audit.

    This function changes only Match.audit_status and Job state. It never
    changes board/options/evaluations/rewards and is a no-op while the audit
    feature flag is disabled.
    """

    if not settings.match_audit_enabled:
        return None

    if not _is_gep_audit_candidate(match):
        return None

    if str(match.audit_status or "").upper() in AUDIT_TERMINAL_STATUSES:
        return None

    now = utcnow()

    match.audit_status = "PENDING"
    match.audited_at = None

    raw = _raw_summary(match)
    previous = raw.get("audit")
    scheduled_report = {
        "policy_version": AUDIT_POLICY_VERSION,
        "provider": AUDIT_PROVIDER,
        "status": "PENDING",
        "scheduled_at": now.isoformat(),
        "non_authoritative": True,
        "settlement_affected": False,
        "reward_affected": False,
    }

    if isinstance(previous, dict):
        for key in (
            "last_error",
            "last_attempt_at",
            "attempt",
        ):
            if key in previous:
                scheduled_report[key] = previous[key]

    raw["audit"] = scheduled_report
    match.raw_summary = raw

    key = f"audit-match-v1:{match.id}"

    job = enqueue_job(
        db,
        "audit_match",
        {
            "user_id": user_id,
            "match_id": match.id,
            "external_match_id": int(match.external_match_id),
            "mode_hint": match.game_match_mode,
        },
        key,
        max_attempts=max(
            1,
            int(settings.match_audit_max_attempts),
        ),
        commit=False,
    )

    # A previous disabled/interrupted worker may have completed the wake-up job
    # while the Match still says PENDING. The Match row is the source of truth.
    if job.status in {"DONE", "FAILED"}:
        job.status = "PENDING"
        job.attempts = 0
        job.run_after = now
        job.locked_at = None
        job.locked_by = None
        job.last_error = None

    if commit:
        db.commit()
        db.refresh(match)
        db.refresh(job)
    else:
        db.flush()

    return job


def reconcile_match_audits(
    db: Session,
    *,
    limit: int = 25,
) -> int:
    """Backfill/recover GEP audit jobs after the flag is enabled."""

    if not settings.match_audit_enabled:
        return 0

    matches = list(
        db.scalars(
            select(Match)
            .where(
                Match.settlement_source == GEP_SETTLEMENT_SOURCE,
                Match.integrity_status == GEP_INTEGRITY_CLIENT_ATTESTED,
                Match.audit_status.in_(("NOT_REQUESTED", "PENDING")),
            )
            .order_by(Match.created_at.asc())
            .limit(max(1, min(int(limit), 100)))
        ).all()
    )

    scheduled = 0

    for match in matches:
        # enqueue_job is idempotent and returns an existing PENDING job.
        # Alpha.17 counted that as a new queue every minute and rewrote the
        # audit scheduled_at timestamp. Leave an existing retry untouched.
        audit_key = f"audit-match-v1:{match.id}"
        existing = db.scalar(
            select(Job).where(
                Job.idempotency_key == audit_key
            )
        )
        if (
            existing is not None
            and existing.status in {"PENDING", "RUNNING"}
        ):
            continue

        user = _user_for_match(db, match)
        if user is None:
            continue

        job = schedule_gep_match_audit(
            db,
            match,
            user.id,
            commit=False,
        )

        if job is not None:
            scheduled += 1

    if scheduled:
        db.commit()

    return scheduled


def _append_exact_comparison(
    comparisons: list[dict[str, Any]],
    mismatches: list[str],
    *,
    field: str,
    client_value: Any,
    provider_value: Any,
) -> None:
    if client_value is None or provider_value is None:
        return

    matched = client_value == provider_value

    comparisons.append(
        {
            "field": field,
            "client": client_value,
            "provider": provider_value,
            "matched": matched,
        }
    )

    if not matched:
        mismatches.append(field)


def _append_duration_comparison(
    comparisons: list[dict[str, Any]],
    mismatches: list[str],
    *,
    client_value: Any,
    provider_value: Any,
) -> None:
    if client_value is None or provider_value is None:
        return

    try:
        client_duration = int(client_value)
        provider_duration = int(provider_value)
    except (TypeError, ValueError):
        return

    delta = abs(client_duration - provider_duration)
    matched = delta <= 30

    comparisons.append(
        {
            "field": "duration_s",
            "client": client_duration,
            "provider": provider_duration,
            "delta": delta,
            "tolerance": 30,
            "matched": matched,
        }
    )

    if not matched:
        mismatches.append("duration_s")


def _comparison_report(
    match: Match,
    local_participant: MatchParticipant,
    normalized: dict[str, Any],
    *,
    attempt: int,
    steam_fallback_allowed: bool,
) -> tuple[str, dict[str, Any]]:
    now = utcnow()
    mismatches: list[str] = []
    comparisons: list[dict[str, Any]] = []

    try:
        provider_match_id = int(
            normalized.get("external_match_id") or 0
        )
    except (TypeError, ValueError):
        provider_match_id = 0

    _append_exact_comparison(
        comparisons,
        mismatches,
        field="external_match_id",
        client_value=int(match.external_match_id),
        provider_value=provider_match_id,
    )

    provider_mode = str(
        normalized.get("game_match_mode") or ""
    ).upper()

    if provider_mode in VALID_GAME_MODES:
        _append_exact_comparison(
            comparisons,
            mismatches,
            field="game_match_mode",
            client_value=str(match.game_match_mode or "").upper(),
            provider_value=provider_mode,
        )

    _append_duration_comparison(
        comparisons,
        mismatches,
        client_value=match.duration_s,
        provider_value=normalized.get("duration_s"),
    )

    provider_participant = normalized.get("participant")

    if not isinstance(provider_participant, dict):
        mismatches.append("participant_missing")
        provider_participant = {}

    try:
        provider_account_id = int(
            provider_participant.get("account_id")
            if provider_participant.get("account_id") is not None
            else -1
        )
    except (TypeError, ValueError):
        provider_account_id = -1

    _append_exact_comparison(
        comparisons,
        mismatches,
        field="account_id",
        client_value=int(local_participant.account_id),
        provider_value=provider_account_id,
    )

    fields = (
        "steam_id64",
        "hero_id",
        "won",
        "kills",
        "deaths",
        "assists",
        "net_worth",
        "hero_damage",
        "object_damage",
        "healing",
    )

    provider_missing: list[str] = []

    for field in fields:
        client_value = getattr(local_participant, field)
        provider_value = provider_participant.get(field)

        if provider_value is None:
            provider_missing.append(field)
            continue

        _append_exact_comparison(
            comparisons,
            mismatches,
            field=field,
            client_value=client_value,
            provider_value=provider_value,
        )

    status = (
        "MISMATCH"
        if mismatches
        else "CONFIRMED"
    )

    report = {
        "policy_version": AUDIT_POLICY_VERSION,
        "provider": AUDIT_PROVIDER,
        "status": status,
        "checked_at": now.isoformat(),
        "attempt": int(attempt),
        "steam_fallback_allowed": bool(
            steam_fallback_allowed
        ),
        "non_authoritative": True,
        "settlement_affected": False,
        "reward_affected": False,
        "provider_source": str(
            normalized.get("provider") or AUDIT_PROVIDER
        ),
        "provider_mode_raw": normalized.get(
            "provider_mode_raw"
        ),
        "comparisons": comparisons,
        "mismatches": sorted(set(mismatches)),
        "coverage": {
            "compared": len(comparisons),
            "provider_missing": provider_missing,
            "classification": (
                "FULL"
                if not provider_missing
                else "PARTIAL"
            ),
        },
    }

    return status, report


def _provider_wait(
    db: Session,
    match: Match,
    *,
    attempt: int,
    max_attempts: int,
    message: str,
    retry_after: int | None = None,
) -> None:
    now = utcnow()
    terminal = int(attempt) >= int(max_attempts)

    report = {
        "policy_version": AUDIT_POLICY_VERSION,
        "provider": AUDIT_PROVIDER,
        "status": (
            "UNAVAILABLE"
            if terminal
            else "PENDING"
        ),
        "last_attempt_at": now.isoformat(),
        "attempt": int(attempt),
        "max_attempts": int(max_attempts),
        "last_error": str(message)[:500],
        "non_authoritative": True,
        "settlement_affected": False,
        "reward_affected": False,
    }

    _write_audit_report(match, report)

    if terminal:
        match.audit_status = "UNAVAILABLE"
        match.audited_at = now
        db.commit()
        return

    match.audit_status = "PENDING"
    match.audited_at = None
    db.commit()

    delay = max(
        int(settings.match_audit_retry_seconds),
        int(retry_after or 0),
    )

    raise MatchAuditPending(
        message,
        delay,
    )


def run_match_audit_job(
    db: Session,
    job: Job,
) -> None:
    """Audit one already-settled GEP match.

    Critical invariant: this code never calls store_normalized_match(),
    evaluate_board(), RewardLedger or any ContractBoard mutation.
    """

    match_id = str(
        job.match_id
        or (job.payload or {}).get("match_id")
        or ""
    )

    if not match_id:
        raise ValueError(
            "audit_match: match_id отсутствует"
        )

    match = db.get(Match, match_id)

    if match is None:
        return

    if not _is_gep_audit_candidate(match):
        return

    if str(match.audit_status or "").upper() in AUDIT_TERMINAL_STATUSES:
        return

    if not settings.match_audit_enabled:
        match.audit_status = "NOT_REQUESTED"
        match.audited_at = None
        _write_audit_report(
            match,
            {
                "policy_version": AUDIT_POLICY_VERSION,
                "provider": AUDIT_PROVIDER,
                "status": "DISABLED",
                "checked_at": utcnow().isoformat(),
                "non_authoritative": True,
                "settlement_affected": False,
                "reward_affected": False,
            },
        )
        db.commit()
        return

    user_id = str(
        job.user_id
        or (job.payload or {}).get("user_id")
        or ""
    )

    user = db.get(User, user_id) if user_id else None

    if user is None:
        user = _user_for_match(db, match)

    attempt = max(1, int(job.attempts or 1))
    max_attempts = max(
        1,
        int(
            job.max_attempts
            or settings.match_audit_max_attempts
        ),
    )

    if user is None or user.account_id is None:
        _provider_wait(
            db,
            match,
            attempt=attempt,
            max_attempts=max_attempts,
            message="audit_match: пользователь или account_id не найден",
        )
        return

    local_participant = db.scalar(
        select(MatchParticipant).where(
            MatchParticipant.match_id == match.id,
            MatchParticipant.account_id == int(user.account_id),
        )
    )

    if local_participant is None:
        _provider_wait(
            db,
            match,
            attempt=attempt,
            max_attempts=max_attempts,
            message="audit_match: локальный participant не найден",
        )
        return

    # Cache/S3/history first. Only the final audit attempt may use the more
    # expensive upstream Steam-backed metadata fallback.
    final_attempt = attempt >= max_attempts
    disable_steam = not final_attempt

    try:
        with DeadlockApiProvider() as provider:
            normalized = provider.fetch_match_by_id(
                int(user.account_id),
                int(match.external_match_id),
                disable_steam=disable_steam,
                consult_history=True,
            )

    except ProviderRateLimited as exc:
        _provider_wait(
            db,
            match,
            attempt=attempt,
            max_attempts=max_attempts,
            message=str(exc),
            retry_after=exc.retry_after,
        )
        return

    except ProviderError as exc:
        _provider_wait(
            db,
            match,
            attempt=attempt,
            max_attempts=max_attempts,
            message=str(exc),
        )
        return

    if normalized is None:
        _provider_wait(
            db,
            match,
            attempt=attempt,
            max_attempts=max_attempts,
            message=(
                f"Deadlock API ещё не видит точный матч "
                f"#{match.external_match_id}"
            ),
        )
        return

    status, report = _comparison_report(
        match,
        local_participant,
        normalized,
        attempt=attempt,
        steam_fallback_allowed=final_attempt,
    )

    # Audit output is deliberately side-channel metadata only.
    match.audit_status = status
    match.audited_at = utcnow()
    _write_audit_report(match, report)

    db.commit()
