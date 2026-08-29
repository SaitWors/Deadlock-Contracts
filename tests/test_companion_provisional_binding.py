from __future__ import annotations

import os
import tempfile
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

_tmp = tempfile.TemporaryDirectory(prefix="dc-provisional-binding-")
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
    Match,
    MatchParticipant,
    MissionDefinition,
    User,
)
from app.services.evaluator import _has_trusted_finality
from app.worker import (
    CompanionMatchNotReady,
    FinalFactsPending,
    _evaluation_max_attempts_for_match,
    _is_provisional_companion_match,
    _normalized_from_companion_evidence,
    _provisional_match_from_companion_evidence,
    bind_match,
    handle_evaluate,
    settings,
    store_normalized_match,
)


ACCOUNT_ID = 1020621313
STEAM_ID64 = 76561198980887041
NOW = datetime(2026, 8, 29, 20, 30, 0, tzinfo=timezone.utc)


def _new_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _add_user(db: Session) -> User:
    user = User(
        steam_id64=STEAM_ID64,
        account_id=ACCOUNT_ID,
        display_name="Mandarin",
    )
    db.add(user)
    db.flush()
    return user


def _add_mission(
    db: Session,
    *,
    key: str,
    metric: str = "player.assists",
    capability: str = "summary.assists",
    mode: str = "STREET_BRAWL",
    target: float = 8,
) -> MissionDefinition:
    mission = MissionDefinition(
        key=key,
        version=1,
        title=key,
        description=key,
        metric=metric,
        operator="gte",
        target=target,
        reward_xp=100,
        required_capabilities=[capability],
        game_match_mode=mode,
    )
    db.add(mission)
    db.flush()
    return mission


def _add_board(
    db: Session,
    user: User,
    *,
    status: str = "LOCKED",
    mode: str = "STREET_BRAWL",
    attempts_used: int = 0,
) -> ContractBoard:
    board = ContractBoard(
        user_id=user.id,
        board_date=date(2026, 8, 29),
        status=status,
        game_match_mode=mode,
        seed=f"provisional-{status.lower()}",
        attempts_used=attempts_used,
        max_attempts=3,
        locked_at=NOW - timedelta(minutes=20),
        expires_at=NOW + timedelta(hours=6),
    )
    db.add(board)
    db.flush()
    return board


def _add_option(
    db: Session,
    board: ContractBoard,
    mission: MissionDefinition,
    *,
    status: str,
    bound_match_id: str | None = None,
) -> BoardOption:
    option = BoardOption(
        board_id=board.id,
        mission_definition_id=mission.id,
        rendered_title=mission.title,
        rendered_description=mission.description,
        metric=mission.metric,
        operator=mission.operator,
        target=mission.target,
        reward_xp=mission.reward_xp,
        required_capabilities=list(mission.required_capabilities or []),
        required_game_match_mode=mission.game_match_mode,
        selected=True,
        status=status,
        locked_at=board.locked_at,
        bound_match_id=bound_match_id,
        conditions=[
            {
                "metric": mission.metric,
                "operator": mission.operator,
                "target": mission.target,
                "capabilities": list(mission.required_capabilities or []),
            }
        ],
    )
    db.add(option)
    db.flush()
    return option


def _provisional_data(
    external_match_id: int,
    *,
    assists: int = 8,
    healing: int = 4478,
) -> dict:
    return {
        "external_match_id": external_match_id,
        "provider": "gep_fallback",
        "provider_payload_hash": None,
        "started_at": NOW - timedelta(minutes=13),
        "ended_at": NOW,
        "duration_s": None,
        "game_match_mode": "STREET_BRAWL",
        "provider_mode_raw": "companion:STREET_BRAWL",
        "mode_classifier_version": "companion-provisional-v1",
        "mode_confidence": "MEDIUM",
        "is_final": True,
        "scoring_status": "UNVERIFIABLE",
        "capabilities": [],
        "raw_summary": {
            "provisional_binding": {
                "source": "overwolf_gep",
                "trust_class": "T0_UNTRUSTED",
                "scoring_contribution": False,
                "independent_provider_pending": True,
                "external_match_id": external_match_id,
            },
            "companion_evidence": {
                "observed_stats": {
                    "kills": 4,
                    "deaths": 3,
                    "assists": assists,
                    "healing": healing,
                },
                "trust_class": "T0_UNTRUSTED",
                "scoring_contribution": False,
            },
        },
        "participant": {
            "account_id": ACCOUNT_ID,
            "steam_id64": STEAM_ID64,
            "hero_id": 64,
            "kills": 4,
            "deaths": 3,
            "assists": assists,
            "net_worth": 34000,
            "hero_damage": 26876,
            "object_damage": 7979,
            "healing": healing,
            "won": None,
        },
    }


class ProvisionalBindingRegressionTests(unittest.TestCase):
    def test_strong_terminal_evidence_creates_non_scoring_provisional_payload(self) -> None:
        evidence = SimpleNamespace(
            steam_id64=STEAM_ID64,
            game_match_mode="STREET_BRAWL",
            hero_id=64,
            kills=4,
            deaths=3,
            assists=8,
            souls=34000,
            hero_damage=26876,
            object_damage=7979,
            healing=4478,
        )
        finalization = {
            "signal": "match_end",
            "event_type": "match_ended",
            "phase": "PostGame",
            "end_reason": "match_end",
            "session_id": "session-test",
            "started_at": NOW - timedelta(seconds=778),
            "ended_at": NOW,
            "match_clock_s": 778,
            "trusted": False,
            "trusted_for_scoring": False,
            "trust_class": "T0_UNTRUSTED",
        }
        user = SimpleNamespace(
            id="user-test",
            account_id=ACCOUNT_ID,
            steam_id64=STEAM_ID64,
        )
        job = SimpleNamespace(
            game_match_mode="STREET_BRAWL",
            payload={"game_match_mode": "STREET_BRAWL"},
        )

        with (
            patch(
                "app.worker._companion_evidence_for",
                return_value=evidence,
            ),
            patch(
                "app.worker._companion_finalization_from_events",
                return_value=finalization,
            ),
        ):
            data = _provisional_match_from_companion_evidence(
                unittest.mock.MagicMock(),
                user,
                job,
                102442126,
            )

        self.assertIsNotNone(data)
        assert data is not None
        self.assertEqual(data["external_match_id"], 102442126)
        self.assertEqual(data["provider"], "gep_fallback")
        self.assertTrue(data["is_final"])
        self.assertEqual(data["scoring_status"], "UNVERIFIABLE")
        self.assertEqual(data["capabilities"], [])
        self.assertIsNone(data["participant"]["won"])
        self.assertEqual(data["participant"]["assists"], 8)
        self.assertEqual(data["participant"]["healing"], 4478)
        self.assertTrue(
            data["raw_summary"]["provisional_binding"][
                "independent_provider_pending"
            ]
        )
        self.assertFalse(
            data["raw_summary"]["provisional_binding"][
                "scoring_contribution"
            ]
        )

        # The legacy/manual review seam stays fail-closed.
        self.assertIsNone(
            _normalized_from_companion_evidence(
                unittest.mock.MagicMock(),
                user,
                job,
                102442126,
            )
        )

    def test_only_explicit_provisional_rows_receive_144_attempt_budget(self) -> None:
        provisional = SimpleNamespace(
            provider="gep_fallback",
            raw_summary={
                "provisional_binding": {
                    "independent_provider_pending": True,
                    "scoring_contribution": False,
                }
            },
        )
        legacy_gep = SimpleNamespace(
            provider="gep_fallback",
            raw_summary={},
        )
        independent = SimpleNamespace(
            provider="deadlock_api",
            raw_summary={},
        )

        self.assertTrue(_is_provisional_companion_match(provisional))
        self.assertFalse(_is_provisional_companion_match(legacy_gep))
        self.assertFalse(_is_provisional_companion_match(independent))

        provisional_budget = _evaluation_max_attempts_for_match(provisional)
        legacy_budget = _evaluation_max_attempts_for_match(legacy_gep)
        independent_budget = _evaluation_max_attempts_for_match(independent)

        self.assertGreaterEqual(provisional_budget, 144)
        self.assertEqual(
            legacy_budget,
            max(3, settings.post_match_verification_max_attempts),
        )
        self.assertEqual(
            independent_budget,
            max(3, settings.post_match_verification_max_attempts),
        )

    def test_bind_match_uses_144_attempt_budget_for_provisional_row(self) -> None:
        db = _new_db()
        with db:
            user = _add_user(db)
            mission = _add_mission(db, key="provisional-bind")
            board = _add_board(db, user, status="LOCKED")
            option = _add_option(
                db,
                board,
                mission,
                status="LOCKED",
            )
            match = store_normalized_match(
                db,
                _provisional_data(102442126),
            )

            captured: dict = {}

            def fake_enqueue(
                _db,
                job_type,
                payload,
                idempotency_key,
                *,
                run_after=None,
                max_attempts=20,
                commit=True,
            ):
                captured.update(
                    {
                        "job_type": job_type,
                        "payload": dict(payload),
                        "idempotency_key": idempotency_key,
                        "max_attempts": max_attempts,
                        "commit": commit,
                    }
                )
                return SimpleNamespace(max_attempts=max_attempts)

            with patch(
                "app.worker.enqueue_job",
                side_effect=fake_enqueue,
            ):
                bind_match(db, board, match)

            db.refresh(board)
            db.refresh(option)

            self.assertEqual(board.status, "VERIFYING")
            self.assertEqual(board.attempts_used, 1)
            self.assertEqual(option.status, "VERIFYING")
            self.assertEqual(option.bound_match_id, match.id)
            self.assertEqual(captured["job_type"], "evaluate_match")
            self.assertEqual(captured["payload"]["match_id"], match.id)
            self.assertGreaterEqual(captured["max_attempts"], 144)
            self.assertFalse(captured["commit"])

    def test_provider_wait_does_not_reopen_historical_assignment(self) -> None:
        db = _new_db()
        with db:
            user = _add_user(db)
            current_mission = _add_mission(
                db,
                key="current-assists",
            )
            historical_mission = _add_mission(
                db,
                key="historical-heal",
                metric="player.healing",
                capability="summary.healing",
                target=3000,
            )
            board = _add_board(
                db,
                user,
                status="VERIFYING",
                attempts_used=1,
            )

            old_match = store_normalized_match(
                db,
                {
                    **_provisional_data(102439322),
                    "raw_summary": {},
                },
            )
            current_match = store_normalized_match(
                db,
                _provisional_data(102442126),
            )

            current_option = _add_option(
                db,
                board,
                current_mission,
                status="VERIFYING",
                bound_match_id=current_match.id,
            )
            historical_option = _add_option(
                db,
                board,
                historical_mission,
                status="REVIEW_REQUIRED",
                bound_match_id=old_match.id,
            )
            db.commit()

            job = SimpleNamespace(
                board_id=board.id,
                match_id=current_match.id,
                payload={
                    "board_id": board.id,
                    "match_id": current_match.id,
                },
                attempts=1,
                max_attempts=144,
            )

            with (
                patch(
                    "app.worker.settings",
                    replace(
                        settings,
                        provider="deadlock_api",
                    ),
                ),
                patch(
                    "app.worker._resolve_exact_companion_payload",
                    side_effect=CompanionMatchNotReady(
                        "provider pending",
                        delay_seconds=600,
                    ),
                ),
            ):
                with self.assertRaises(FinalFactsPending) as captured:
                    handle_evaluate(db, job)

            self.assertEqual(captured.exception.delay_seconds, 600)

            db.refresh(board)
            db.refresh(current_option)
            db.refresh(historical_option)

            self.assertEqual(board.status, "VERIFYING")
            self.assertEqual(current_option.status, "VERIFYING")
            self.assertEqual(
                historical_option.status,
                "REVIEW_REQUIRED",
            )
            self.assertIn(
                "независимое подтверждение матча",
                current_option.explanation or "",
            )

    def test_independent_provider_replaces_client_facts(self) -> None:
        db = _new_db()
        with db:
            _add_user(db)

            provisional = store_normalized_match(
                db,
                _provisional_data(102442126),
            )
            provisional_id = provisional.id

            participant = db.scalar(
                select(MatchParticipant).where(
                    MatchParticipant.match_id == provisional.id,
                    MatchParticipant.account_id == ACCOUNT_ID,
                )
            )
            self.assertIsNotNone(participant)
            assert participant is not None
            self.assertEqual(participant.assists, 8)
            self.assertEqual(participant.healing, 4478)

            independent_data = {
                "external_match_id": 102442126,
                "provider": "deadlock_api",
                "provider_payload_hash": "b" * 64,
                "started_at": NOW - timedelta(seconds=778),
                "ended_at": NOW,
                "duration_s": 778,
                "game_match_mode": "STREET_BRAWL",
                "provider_mode_raw": "STREET_BRAWL",
                "mode_classifier_version": "provider-v1",
                "mode_confidence": "HIGH",
                "is_final": True,
                "scoring_status": "SCORED",
                "capabilities": [
                    "summary.result",
                    "summary.kills",
                    "summary.deaths",
                    "summary.assists",
                    "summary.healing",
                    "summary.duration",
                ],
                "raw_summary": {
                    "provider_test": True,
                },
                "participant": {
                    "account_id": ACCOUNT_ID,
                    "steam_id64": STEAM_ID64,
                    "hero_id": 64,
                    "won": True,
                    "kills": 5,
                    "deaths": 2,
                    "assists": 9,
                    "net_worth": 35000,
                    "hero_damage": 28000,
                    "object_damage": 8100,
                    "healing": 5000,
                },
            }

            replaced = store_normalized_match(
                db,
                independent_data,
            )

            self.assertEqual(replaced.id, provisional_id)
            self.assertEqual(replaced.provider, "deadlock_api")
            self.assertEqual(replaced.scoring_status, "SCORED")
            self.assertEqual(replaced.duration_s, 778)
            self.assertIn("summary.assists", replaced.capabilities)
            self.assertFalse(_is_provisional_companion_match(replaced))

            participant = db.scalar(
                select(MatchParticipant).where(
                    MatchParticipant.match_id == replaced.id,
                    MatchParticipant.account_id == ACCOUNT_ID,
                )
            )
            self.assertIsNotNone(participant)
            assert participant is not None
            self.assertTrue(participant.won)
            self.assertEqual(participant.kills, 5)
            self.assertEqual(participant.deaths, 2)
            self.assertEqual(participant.assists, 9)
            self.assertEqual(participant.healing, 5000)

    def test_client_only_finality_can_never_be_trusted_for_rewards(self) -> None:
        client_match = SimpleNamespace(
            is_final=True,
            provider="gep_fallback",
        )
        mixed_client_match = SimpleNamespace(
            is_final=True,
            provider="deadlock_api+gep_fallback",
        )
        independent_match = SimpleNamespace(
            is_final=True,
            provider="deadlock_api",
        )

        self.assertFalse(_has_trusted_finality(client_match))
        # Current policy is deliberately fail-closed for any mixed client label.
        self.assertFalse(_has_trusted_finality(mixed_client_match))
        self.assertTrue(_has_trusted_finality(independent_match))


if __name__ == "__main__":
    unittest.main()
