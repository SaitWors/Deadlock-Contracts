"""A worker restart cannot strand a recent claim or overwrite its new owner."""
from datetime import datetime, timedelta, timezone
from threading import Event

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import Job
from app.services import jobs


def test_polling_eventually_recovers_a_recent_orphan_without_another_restart(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    start = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(jobs, "utcnow", lambda: start)
    with Session(engine) as db:
        queued = jobs.enqueue_job(db, "evaluate_match", {}, "orphan", max_attempts=5)
        first = jobs.claim_next_job(db, "dead-process")
        assert first.id == queued.id
        assert jobs.claim_next_job(db, "replacement") is None
        # Startup happened while the original claim was still fresh. A later
        # normal poll must reclaim it even though startup won't run again.
        monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=11))
        recovered = jobs.claim_next_job(db, "replacement")
        assert recovered is not None
        assert recovered.id == queued.id
        assert recovered.status == "RUNNING"
        assert recovered.locked_by == "replacement"
        assert recovered.attempts == 2
    engine.dispose()


def test_renewed_long_handler_is_not_reclaimed_and_old_owner_cannot_finish(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    start = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(jobs, "utcnow", lambda: start)
    with Session(engine) as db:
        jobs.enqueue_job(db, "evaluate_match", {}, "renewed", max_attempts=5)
        job = jobs.claim_next_job(db, "live-process")
        monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=9))
        assert jobs.renew_job_lease(db, job.id, "live-process", 1)
        monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=11))
        assert jobs.claim_next_job(db, "replacement") is None
        monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=20))
        new_claim = jobs.claim_next_job(db, "replacement")
        assert new_claim.attempts == 2
        assert not jobs.renew_job_lease(db, job.id, "live-process", 1)
        assert not jobs.complete_job(db, job, owner=("live-process", 1))
        assert not jobs.retry_job(db, job, "stale error", 30, owner=("live-process", 1))
        db.refresh(new_claim)
        assert new_claim.status == "RUNNING"
        assert new_claim.locked_by == "replacement"
        assert new_claim.attempts == 2
        assert jobs.complete_job(db, new_claim, owner=("replacement", 2))
        assert new_claim.status == "DONE"
    engine.dispose()


def test_missing_lock_timestamp_is_recovered_instead_of_stranded(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        job = Job(type="evaluate_match", payload={}, idempotency_key="broken-lock",
                  status="RUNNING", locked_by="dead-process", locked_at=None,
                  attempts=1, max_attempts=5)
        db.add(job)
        db.commit()
        assert jobs.claim_next_job(db, "replacement").id == job.id
    engine.dispose()


def test_keep_job_lease_renews_through_real_separate_sessions(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'lease.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    start = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(jobs, "utcnow", lambda: start)
    with factory() as db:
        jobs.enqueue_job(db, "evaluate_match", {}, "long-handler", max_attempts=5)
        job = jobs.claim_next_job(db, "live-process")
        job_id = job.id
    monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=9))
    renewed = Event()
    real_renew = jobs.renew_job_lease

    def observe_renew(*args):
        result = real_renew(*args)
        renewed.set()
        return result

    monkeypatch.setattr(jobs, "renew_job_lease", observe_renew)
    with jobs.keep_job_lease(factory, job_id, "live-process", 1, interval_seconds=0.01):
        assert renewed.wait(2), "lease renewal never reached the database"
        with factory() as db:
            stored = db.get(Job, job_id)
            assert jobs._aware_utc(stored.locked_at) == start + timedelta(minutes=9)
            monkeypatch.setattr(jobs, "utcnow", lambda: start + timedelta(minutes=11))
            assert jobs.claim_next_job(db, "replacement") is None
    engine.dispose()
