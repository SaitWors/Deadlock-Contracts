from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Job
from app.services.jobs import _aware_utc, enqueue_job, utcnow


BOARD_A = "11111111-1111-4111-8111-111111111111"
BOARD_B = "22222222-2222-4222-8222-222222222222"
MATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
MATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def _new_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_active_evaluate_job_is_semantically_deduped_across_keys() -> None:
    db = _new_db()
    with db:
        first = enqueue_job(
            db,
            "evaluate_match",
            {
                "board_id": BOARD_A,
                "match_id": MATCH_A,
            },
            f"evaluate:{BOARD_A}:{MATCH_A}",
            max_attempts=12,
        )

        requested_earlier = utcnow() - timedelta(seconds=1)

        second = enqueue_job(
            db,
            "evaluate_match",
            {
                "board_id": BOARD_A,
                "match_id": MATCH_A,
                "finality_repair": "test",
            },
            f"evaluate-final-repair:{BOARD_A}:{MATCH_A}",
            run_after=requested_earlier,
            max_attempts=144,
        )

        assert second.id == first.id
        assert second.max_attempts == 144
        assert second.status == "PENDING"
        assert _aware_utc(second.run_after) <= _aware_utc(
            requested_earlier
        )

        active = list(
            db.scalars(
                select(Job).where(
                    Job.type == "evaluate_match",
                    Job.board_id == BOARD_A,
                    Job.match_id == MATCH_A,
                    Job.status.in_(("PENDING", "RUNNING")),
                )
            ).all()
        )
        assert len(active) == 1


def test_semantic_dedup_is_scoped_to_exact_board_and_match() -> None:
    db = _new_db()
    with db:
        first = enqueue_job(
            db,
            "evaluate_match",
            {
                "board_id": BOARD_A,
                "match_id": MATCH_A,
            },
            "eval-a",
        )
        different_match = enqueue_job(
            db,
            "evaluate_match",
            {
                "board_id": BOARD_A,
                "match_id": MATCH_B,
            },
            "eval-b",
        )
        different_board = enqueue_job(
            db,
            "evaluate_match",
            {
                "board_id": BOARD_B,
                "match_id": MATCH_A,
            },
            "eval-c",
        )

        assert len({
            first.id,
            different_match.id,
            different_board.id,
        }) == 3
