from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

_tmp = tempfile.TemporaryDirectory(prefix="dc-contract-e2e-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(_tmp.name) / 'test.db'}")
os.environ.setdefault("MATCH_PROVIDER", "mock")
os.environ.setdefault("ALLOW_DEMO_AUTH", "true")
os.environ.setdefault("ALLOW_DEV_ENDPOINTS", "true")
os.environ.setdefault(
    "SESSION_SECRET",
    "test-secret-not-for-production-use-only-2026",
)

from app.db import Base
from app.models import (
    BoardOption,
    ContractBoard,
    Job,
    OutboxEvent,
    RewardLedgerEntry,
    User,
)
from app.services.boards import ensure_daily_board, lock_board
from app.services.seed import seed_missions
from app.worker import bind_match, dispatch_outbox, handle_evaluate, store_normalized_match


ACCOUNT_ID = 1020621313
STEAM_ID64 = 76561198980887041
ALL_TRUSTED_CAPABILITIES = [
    "summary.result",
    "summary.kills",
    "summary.deaths",
    "summary.assists",
    "summary.net_worth",
    "summary.hero_damage",
    "summary.object_damage",
    "summary.healing",
    "summary.scoreboard_healing",
    "summary.duration",
]


def _new_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _user(db: Session) -> User:
    user = User(
        steam_id64=STEAM_ID64,
        account_id=ACCOUNT_ID,
        display_name="E2E QA",
        xp=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _selected(db: Session, board_id: str) -> list[BoardOption]:
    return list(
        db.scalars(
            select(BoardOption)
            .where(
                BoardOption.board_id == board_id,
                BoardOption.selected.is_(True),
            )
            .order_by(BoardOption.id)
        ).all()
    )


def _evaluation_job(db: Session, board_id: str, match_id: str) -> Job:
    job = db.scalar(
        select(Job)
        .where(
            Job.type == "evaluate_match",
            Job.board_id == board_id,
            Job.match_id == match_id,
        )
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    if job is None:
        raise AssertionError("evaluate_match job was not created")
    return job


def _authoritative_match(
    external_match_id: int,
    mode: str,
    *,
    passing: bool,
    now: datetime,
) -> dict:
    if passing:
        participant = {
            "account_id": ACCOUNT_ID,
            "steam_id64": STEAM_ID64,
            "hero_id": 64,
            "won": True,
            "kills": 100,
            "deaths": 1,
            "assists": 100,
            "net_worth": 1_000_000,
            "hero_damage": 1_000_000,
            "object_damage": 1_000_000,
            "healing": 1_000_000,
        }
    else:
        participant = {
            "account_id": ACCOUNT_ID,
            "steam_id64": STEAM_ID64,
            "hero_id": 64,
            "won": False,
            "kills": 0,
            "deaths": 100,
            "assists": 0,
            "net_worth": 0,
            "hero_damage": 0,
            "object_damage": 0,
            "healing": 0,
        }

    duration = 900 if mode == "STREET_BRAWL" else 3600
    return {
        "external_match_id": external_match_id,
        "provider": "deadlock_api",
        "provider_payload_hash": f"{external_match_id:064x}"[-64:],
        "started_at": now - timedelta(seconds=duration),
        "ended_at": now,
        "duration_s": duration,
        "game_match_mode": mode,
        "provider_mode_raw": f"qa:{mode}",
        "mode_classifier_version": "e2e-qa-v1",
        "mode_confidence": "HIGH",
        "scoring_status": "SCORED",
        "is_final": True,
        "capabilities": list(ALL_TRUSTED_CAPABILITIES),
        "raw_summary": {"e2e_qa": True},
        "participant": participant,
    }


def _provisional_match(external_match_id: int, now: datetime) -> dict:
    return {
        "external_match_id": external_match_id,
        "provider": "gep_fallback",
        "provider_payload_hash": None,
        "started_at": now - timedelta(seconds=900),
        "ended_at": now,
        "duration_s": None,
        "game_match_mode": "STREET_BRAWL",
        "provider_mode_raw": "companion:STREET_BRAWL",
        "mode_classifier_version": "companion-provisional-v1",
        "mode_confidence": "MEDIUM",
        "scoring_status": "UNVERIFIABLE",
        "is_final": True,
        "capabilities": [],
        "raw_summary": {
            "provisional_binding": {
                "source": "overwolf_gep",
                "trust_class": "T0_UNTRUSTED",
                "scoring_contribution": False,
                "independent_provider_pending": True,
                "external_match_id": external_match_id,
            }
        },
        "participant": {
            "account_id": ACCOUNT_ID,
            "steam_id64": STEAM_ID64,
            "hero_id": 64,
            "won": None,
            "kills": 100,
            "deaths": 1,
            "assists": 100,
            "net_worth": 1_000_000,
            "hero_damage": 1_000_000,
            "object_damage": 1_000_000,
            "healing": 1_000_000,
        },
    }


def _drain_rewards(db: Session) -> int:
    count = 0
    while dispatch_outbox(db):
        count += 1
        if count > 50:
            raise AssertionError("outbox did not drain")
    return count


class ContractEndToEndQATests(unittest.TestCase):
    def test_generated_boards_lock_score_and_reward_in_all_modes(self) -> None:
        for index, mode in enumerate(("STANDARD", "RANKED", "STREET_BRAWL"), start=1):
            with self.subTest(mode=mode):
                db = _new_db()
                with db:
                    seed_missions(db)
                    user = _user(db)
                    offered = ensure_daily_board(db, user, mode)
                    self.assertEqual(offered.status, "OFFERED")
                    self.assertEqual(len(offered.options), 6)

                    chosen_ids = [option.id for option in offered.options[:3]]
                    board = lock_board(db, user, chosen_ids, mode)
                    self.assertEqual(board.status, "LOCKED")
                    selected = _selected(db, board.id)
                    self.assertEqual(len(selected), 3)
                    self.assertTrue(all(option.status == "LOCKED" for option in selected))

                    duration = 900 if mode == "STREET_BRAWL" else 3600
                    locked_at = board.locked_at if board.locked_at.tzinfo else board.locked_at.replace(tzinfo=timezone.utc)
                    now = locked_at + timedelta(seconds=duration + 60)
                    match = store_normalized_match(
                        db,
                        _authoritative_match(120_000_000 + index, mode, passing=True, now=now),
                    )
                    bind_match(db, board, match)
                    job = _evaluation_job(db, board.id, match.id)
                    handle_evaluate(db, job)

                    selected = _selected(db, board.id)
                    self.assertTrue(
                        all(option.status == "COMPLETED" for option in selected),
                        [(option.rendered_title, option.status, option.explanation) for option in selected],
                    )
                    db.refresh(board)
                    self.assertEqual(board.status, "SETTLED")

                    expected_xp = sum(option.reward_xp for option in selected)
                    self.assertEqual(user.xp, 0)
                    drained = _drain_rewards(db)
                    self.assertGreaterEqual(drained, 3)
                    db.refresh(user)
                    self.assertEqual(user.xp, expected_xp)
                    ledger = list(
                        db.scalars(
                            select(RewardLedgerEntry).where(
                                RewardLedgerEntry.user_id == user.id,
                                RewardLedgerEntry.source_type == "assignment",
                            )
                        ).all()
                    )
                    self.assertEqual(len(ledger), 3)
                    self.assertEqual(sum(item.delta for item in ledger), expected_xp)

    def test_provisional_match_never_rewards_then_provider_replacement_settles(self) -> None:
        db = _new_db()
        with db:
            seed_missions(db)
            user = _user(db)
            offered = ensure_daily_board(db, user, "STREET_BRAWL")
            board = lock_board(db, user, [option.id for option in offered.options[:3]], "STREET_BRAWL")

            locked_at = board.locked_at if board.locked_at.tzinfo else board.locked_at.replace(tzinfo=timezone.utc)
            now = locked_at + timedelta(seconds=960)
            provisional = store_normalized_match(db, _provisional_match(120_000_101, now))
            bind_match(db, board, provisional)
            evaluation_job = _evaluation_job(db, board.id, provisional.id)

            self.assertGreaterEqual(evaluation_job.max_attempts, 144)
            db.refresh(board)
            self.assertEqual(board.status, "VERIFYING")
            self.assertEqual(user.xp, 0)
            self.assertEqual(list(db.scalars(select(RewardLedgerEntry)).all()), [])
            self.assertEqual(
                list(
                    db.scalars(
                        select(OutboxEvent).where(
                            OutboxEvent.event_type == "assignment.settled"
                        )
                    ).all()
                ),
                [],
            )

            authoritative = store_normalized_match(
                db,
                _authoritative_match(120_000_101, "STREET_BRAWL", passing=True, now=now),
            )
            self.assertEqual(authoritative.id, provisional.id)
            self.assertEqual(authoritative.provider, "deadlock_api")
            self.assertEqual(authoritative.scoring_status, "SCORED")

            handle_evaluate(db, evaluation_job)
            selected = _selected(db, board.id)
            self.assertTrue(all(option.status == "COMPLETED" for option in selected))
            expected_xp = sum(option.reward_xp for option in selected)

            _drain_rewards(db)
            db.refresh(user)
            self.assertEqual(user.xp, expected_xp)

    def test_failed_attempt_stays_playable_and_next_match_can_complete(self) -> None:
        db = _new_db()
        with db:
            seed_missions(db)
            user = _user(db)
            offered = ensure_daily_board(db, user, "STREET_BRAWL")
            board = lock_board(db, user, [offered.options[0].id], "STREET_BRAWL")

            locked_at = board.locked_at if board.locked_at.tzinfo else board.locked_at.replace(tzinfo=timezone.utc)
            now = locked_at + timedelta(seconds=960)
            failed_match = store_normalized_match(
                db,
                _authoritative_match(120_000_201, "STREET_BRAWL", passing=False, now=now),
            )
            bind_match(db, board, failed_match)
            handle_evaluate(db, _evaluation_job(db, board.id, failed_match.id))

            option = _selected(db, board.id)[0]
            db.refresh(board)
            self.assertEqual(board.attempts_used, 1)
            self.assertEqual(board.status, "LOCKED")
            self.assertEqual(option.status, "LOCKED")
            self.assertIsNone(option.bound_match_id)
            self.assertEqual(user.xp, 0)
            self.assertEqual(list(db.scalars(select(RewardLedgerEntry)).all()), [])

            success_match = store_normalized_match(
                db,
                _authoritative_match(
                    120_000_202,
                    "STREET_BRAWL",
                    passing=True,
                    now=now + timedelta(minutes=20),
                ),
            )
            bind_match(db, board, success_match)
            handle_evaluate(db, _evaluation_job(db, board.id, success_match.id))

            option = _selected(db, board.id)[0]
            db.refresh(board)
            self.assertEqual(board.attempts_used, 2)
            self.assertEqual(option.status, "COMPLETED")
            self.assertEqual(board.status, "SETTLED")

            expected_xp = option.reward_xp
            _drain_rewards(db)
            db.refresh(user)
            self.assertEqual(user.xp, expected_xp)

    def test_duplicate_reward_event_cannot_double_credit_xp(self) -> None:
        db = _new_db()
        with db:
            seed_missions(db)
            user = _user(db)
            offered = ensure_daily_board(db, user, "STREET_BRAWL")
            board = lock_board(db, user, [offered.options[0].id], "STREET_BRAWL")

            locked_at = board.locked_at if board.locked_at.tzinfo else board.locked_at.replace(tzinfo=timezone.utc)
            now = locked_at + timedelta(seconds=960)
            match = store_normalized_match(
                db,
                _authoritative_match(120_000_301, "STREET_BRAWL", passing=True, now=now),
            )
            bind_match(db, board, match)
            handle_evaluate(db, _evaluation_job(db, board.id, match.id))

            option = _selected(db, board.id)[0]
            expected_xp = option.reward_xp
            _drain_rewards(db)
            db.refresh(user)
            self.assertEqual(user.xp, expected_xp)

            duplicate = OutboxEvent(
                event_type="assignment.settled",
                aggregate_id=option.id,
                payload={
                    "assignment_id": option.id,
                    "board_id": board.id,
                    "user_id": user.id,
                    "status": "COMPLETED",
                    "reward_xp": expected_xp,
                    "evaluation_id": option.final_evaluation_id,
                    "match_id": match.id,
                },
            )
            db.add(duplicate)
            db.commit()

            self.assertTrue(dispatch_outbox(db))
            db.refresh(user)
            self.assertEqual(user.xp, expected_xp)
            ledger = list(
                db.scalars(
                    select(RewardLedgerEntry).where(
                        RewardLedgerEntry.user_id == user.id,
                        RewardLedgerEntry.source_type == "assignment",
                        RewardLedgerEntry.source_id == option.id,
                    )
                ).all()
            )
            self.assertEqual(len(ledger), 1)


if __name__ == "__main__":
    unittest.main()
