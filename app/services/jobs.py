from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Job


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_job(
    db: Session,
    job_type: str,
    payload: dict[str, Any],
    idempotency_key: str,
    *,
    run_after: datetime | None = None,
    max_attempts: int = 20,
) -> Job:
    existing = db.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
    if existing:
        if existing.status == "FAILED":
            existing.status = "PENDING"
            existing.run_after = run_after or utcnow()
            existing.last_error = None
            db.commit()
        return existing
    job = Job(
        type=job_type,
        payload=payload,
        idempotency_key=idempotency_key,
        run_after=run_after or utcnow(),
        max_attempts=max_attempts,
    )
    db.add(job)
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
    job.last_error = None
    db.commit()


def retry_job(db: Session, job: Job, error: Exception | str, delay_seconds: int) -> None:
    job.last_error = str(error)[:4000]
    if job.attempts >= job.max_attempts:
        job.status = "FAILED"
    else:
        job.status = "PENDING"
        job.run_after = utcnow() + timedelta(seconds=delay_seconds)
    db.commit()
