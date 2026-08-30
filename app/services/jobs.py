from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Job


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware_utc(value: datetime | None) -> datetime | None:
    # Normalize DB datetimes before comparing retry schedules.
    # PostgreSQL returns timezone-aware values for timestamptz, while the
    # SQLite test dialect can round-trip DateTime values without tzinfo.
    # Treat a naive stored value as UTC because scheduler timestamps in this
    # service are written from utcnow().
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def enqueue_job(
    db: Session,
    job_type: str,
    payload: dict[str, Any],
    idempotency_key: str,
    *,
    run_after: datetime | None = None,
    max_attempts: int = 20,
    commit: bool = True,
) -> Job:
    # evaluate_match has several legitimate producers (normal bind, startup
    # repair, finality repair). Their historical idempotency keys differ, but
    # semantically there must be only one active evaluator for one board+match.
    #
    # Without this guard, two PENDING evaluator jobs can poll the exact same
    # Deadlock API metadata concurrently, doubling provider traffic and making
    # retry timing harder to reason about.
    semantic_board_id = (
        str(payload.get("board_id"))
        if payload.get("board_id")
        else None
    )
    semantic_match_id = (
        str(payload.get("match_id"))
        if payload.get("match_id")
        else None
    )

    if (
        job_type == "evaluate_match"
        and semantic_board_id
        and semantic_match_id
    ):
        active_evaluator = db.scalar(
            select(Job)
            .where(
                Job.type == "evaluate_match",
                Job.board_id == semantic_board_id,
                Job.match_id == semantic_match_id,
                Job.status.in_(("PENDING", "RUNNING")),
            )
            .order_by(
                Job.run_after.asc(),
                Job.created_at.asc(),
            )
            .limit(1)
        )

        if active_evaluator is not None:
            active_evaluator.max_attempts = max(
                int(active_evaluator.max_attempts or 0),
                int(max_attempts),
            )

            # A repair request may intentionally ask for an earlier retry.
            # Never postpone an already queued evaluator.
            requested_run_after = _aware_utc(run_after)
            current_run_after = _aware_utc(
                active_evaluator.run_after
            )

            if (
                active_evaluator.status == "PENDING"
                and requested_run_after is not None
                and (
                    current_run_after is None
                    or current_run_after
                    > requested_run_after
                )
            ):
                # Preserve the caller's original datetime value; normalization
                # above is only for a safe UTC comparison.
                active_evaluator.run_after = run_after

            if commit:
                db.commit()
            else:
                db.flush()

            return active_evaluator

    existing = db.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing:
        existing.user_id = existing.user_id or (
            str(payload.get("user_id")) if payload.get("user_id") else None
        )
        existing.board_id = existing.board_id or (
            str(payload.get("board_id")) if payload.get("board_id") else None
        )
        if (
            existing.match_id is None
            and job_type in {"bind_match", "evaluate_match", "refresh_review_match", "audit_match"}
            and payload.get("match_id")
        ):
            existing.match_id = str(payload["match_id"])
        existing.game_match_mode = existing.game_match_mode or (
            str(payload.get("mode_hint") or payload.get("mode") or "").upper() or None
        )
        if existing.status == "FAILED":
            existing.status = "PENDING"
            existing.attempts = 0
            existing.run_after = run_after or utcnow()
            existing.locked_at = None
            existing.locked_by = None
            existing.last_error = None
            if commit:
                db.commit()
            else:
                db.flush()
        elif commit:
            db.commit()
        else:
            db.flush()
        return existing
    job = Job(
        type=job_type,
        user_id=str(payload.get("user_id")) if payload.get("user_id") else None,
        board_id=str(payload.get("board_id")) if payload.get("board_id") else None,
        match_id=(
            str(payload.get("match_id"))
            if job_type in {"bind_match", "evaluate_match", "refresh_review_match", "audit_match"}
            and payload.get("match_id")
            else None
        ),
        game_match_mode=(
            str(payload.get("mode_hint") or payload.get("mode") or "").upper() or None
        ),
        payload=payload,
        idempotency_key=idempotency_key,
        run_after=run_after or utcnow(),
        max_attempts=max_attempts,
    )
    db.add(job)
    if not commit:
        # The caller owns the transaction. This is required for domain
        # transitions such as OFFERED -> LOCKED, where committing the board
        # without its first discovery job would leave a stuck case.
        db.flush()
        return job
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return db.scalar(select(Job).where(Job.idempotency_key == idempotency_key))  # type: ignore[return-value]
    db.refresh(job)
    return job


def claim_next_job(db: Session, worker_id: str) -> Job | None:
    now = utcnow()
    stmt = (
        select(Job)
        .where(Job.status == "PENDING", Job.run_after <= now)
        .order_by(Job.run_after.asc(), Job.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = db.scalar(stmt)
    if not job:
        return None
    job.status = "RUNNING"
    job.locked_by = worker_id
    job.locked_at = now
    job.attempts += 1
    db.commit()
    db.refresh(job)
    return job


def complete_job(db: Session, job: Job) -> None:
    job.status = "DONE"
    job.locked_at = None
    job.locked_by = None
    job.last_error = None
    db.commit()


def retry_job(db: Session, job: Job, error: Exception | str, delay_seconds: int) -> None:
    job.last_error = str(error)[:4000]
    if job.attempts >= job.max_attempts:
        job.status = "FAILED"
    else:
        job.status = "PENDING"
        job.run_after = utcnow() + timedelta(seconds=delay_seconds)
    job.locked_at = None
    job.locked_by = None
    db.commit()
