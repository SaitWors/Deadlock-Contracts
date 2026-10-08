from __future__ import annotations

from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import logging
from threading import Event, Thread
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Job

JOB_LEASE_SECONDS = 10 * 60
log = logging.getLogger(__name__)


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
    # Recovery must run during normal polling: a quick restart can happen
    # before an orphan is stale, so a startup-only sweep strands it forever.
    reclaim_stale_jobs(db, now=now)
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


def reclaim_stale_jobs(db: Session, *, now: datetime | None = None) -> int:
    now = now or utcnow()
    stale = list(db.scalars(
        select(Job).where(
            Job.status == "RUNNING",
            or_(Job.locked_at.is_(None),
                Job.locked_at < now - timedelta(seconds=JOB_LEASE_SECONDS)),
        ).limit(100).with_for_update(skip_locked=True)
    ).all())
    for job in stale:
        job.status = "PENDING"
        job.run_after = now
        job.locked_at = None
        job.locked_by = None
        job.last_error = "Recovered expired worker lease"
    if stale:
        db.commit()
    return len(stale)


def renew_job_lease(db: Session, job_id: str, worker_id: str, attempt: int) -> bool:
    result = db.execute(update(Job).where(
        Job.id == job_id, Job.status == "RUNNING",
        Job.locked_by == worker_id, Job.attempts == attempt,
    ).values(locked_at=utcnow()).execution_options(synchronize_session=False))
    db.commit()
    return result.rowcount == 1


@contextmanager
def keep_job_lease(session_factory, job_id: str, worker_id: str, attempt: int,
                   *, interval_seconds: float = 30):
    """Renew long handlers from a separate Session, never sharing ORM state."""
    stop = Event()

    def renew():
        while not stop.wait(interval_seconds):
            try:
                with session_factory() as db:
                    if not renew_job_lease(db, job_id, worker_id, attempt):
                        log.warning("Worker lease lost for job %s", job_id)
                        return
            except Exception:
                log.exception("Could not renew worker lease for job %s", job_id)

    thread = Thread(target=renew, name=f"job-lease-{job_id}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=2)


def _finish_job(db: Session, job: Job, values: dict[str, Any],
                owner: tuple[str, int] | None) -> bool:
    stmt = update(Job).where(Job.id == job.id)
    if owner is not None:
        stmt = stmt.where(Job.status == "RUNNING", Job.locked_by == owner[0],
                          Job.attempts == owner[1])
    result = db.execute(stmt.values(**values).execution_options(synchronize_session=False))
    db.commit()
    db.refresh(job)
    return result.rowcount == 1


def complete_job(db: Session, job: Job, *, owner: tuple[str, int] | None = None) -> bool:
    return _finish_job(db, job, {
        "status": "DONE", "locked_at": None, "locked_by": None, "last_error": None,
    }, owner)


def retry_job(db: Session, job: Job, error: Exception | str, delay_seconds: int,
              *, owner: tuple[str, int] | None = None) -> bool:
    attempts = owner[1] if owner is not None else job.attempts
    values = {
        "last_error": str(error)[:4000], "locked_at": None, "locked_by": None,
        "status": "FAILED" if attempts >= job.max_attempts else "PENDING",
    }
    if values["status"] == "PENDING":
        values["run_after"] = utcnow() + timedelta(seconds=delay_seconds)
    return _finish_job(db, job, values, owner)
