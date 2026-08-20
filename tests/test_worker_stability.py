from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

_tmp = tempfile.TemporaryDirectory(prefix="dc-worker-stability-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(_tmp.name) / 'test.db'}")
os.environ.setdefault("MATCH_PROVIDER", "mock")
os.environ.setdefault("ALLOW_DEMO_AUTH", "true")
os.environ.setdefault("ALLOW_DEV_ENDPOINTS", "true")
os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-production-use-only-2026")

from app.worker import merge_companion_evidence, _recover_unexpected_job_error


class WorkerStabilityTests(unittest.TestCase):
    def test_companion_team_label_never_enters_numeric_participant_team(self) -> None:
        evidence = SimpleNamespace(
            steam_id64=76561198980887041,
            game_match_mode="RANKED",
            captured_at=datetime.now(timezone.utc),
            hero_id=64,
            kills=3,
            deaths=5,
            assists=2,
            hero_damage=21045,
            object_damage=1456,
            healing=5390,
            souls=34000,
        )
        db = MagicMock()
        db.scalar.return_value = evidence
        user = SimpleNamespace(
            id="user-1",
            steam_id64=76561198980887041,
            account_id=1020621313,
        )
        data = {
            "provider": "deadlock_api",
            "game_match_mode": "RANKED",
            "participant": {
                "account_id": 1020621313,
                "team": None,
                "won": None,
            },
            "capabilities": [],
        }
        companion_result = {
            "local_team": "SAPPHIRE",
            "match_outcome": "AMBER",
            "won": False,
            "event_type": "match_end",
            "captured_at": "2026-08-15T03:02:10+00:00",
        }
        with patch("app.worker._companion_result_from_events", return_value=companion_result):
            merged = merge_companion_evidence(db, user, data, 99496460)

        self.assertIsNone(merged["participant"]["team"])
        # Frozen alpha.4 does not send the Match ID embedded in raw
        # match_outcome, so even a stabilized team label is diagnostic-only.
        self.assertIsNone(merged["participant"]["won"])
        self.assertNotIn("summary.result", merged["capabilities"])
        self.assertEqual(
            merged["raw_summary"]["companion_outcome_diagnostic"]["local_team"],
            "SAPPHIRE",
        )
        self.assertFalse(
            merged["raw_summary"]["companion_outcome_diagnostic"]["trusted_for_scoring"]
        )

    def test_unexpected_job_error_rolls_back_before_retry(self) -> None:
        events: list[str] = []
        job = SimpleNamespace(id="job-1")
        db = MagicMock()
        db.rollback.side_effect = lambda: events.append("rollback")

        def get(_model, _job_id):
            events.append("get")
            return job

        db.get.side_effect = get
        with patch("app.worker.retry_job") as retry:
            retry.side_effect = lambda *_args, **_kwargs: events.append("retry")
            ok = _recover_unexpected_job_error(
                db,
                "job-1",
                "resolve_companion_match",
                2,
                ValueError("bad participant team"),
            )

        self.assertTrue(ok)
        self.assertEqual(events[:3], ["rollback", "get", "retry"])
        retry.assert_called_once()
        self.assertEqual(retry.call_args.args[3], 20)


class MatchFinalityRegressionTests(unittest.TestCase):

    def test_startup_repair_ignores_historical_selected_matches(self) -> None:
        """Regression for the real three-selected-contract production board.

        Completed/failed selected assignments keep their historical Match ID.
        A later REVIEW_REQUIRED assignment can therefore be bound to a second
        match on the same board. rc6/rc7 skipped the board because it required
        exactly one Match ID across *all* selected assignments.
        """
        from app.worker import _startup_repair_bound_match_ids

        options = [
            SimpleNamespace(selected=True, status="COMPLETED", bound_match_id="old-match"),
            SimpleNamespace(selected=True, status="FAILED", bound_match_id="old-match"),
            SimpleNamespace(selected=True, status="REVIEW_REQUIRED", bound_match_id="target-match"),
        ]
        self.assertEqual(
            _startup_repair_bound_match_ids(options),
            ["target-match"],
        )

    def test_startup_repair_can_recover_multiple_stalled_matches_independently(self) -> None:
        from app.worker import _startup_repair_bound_match_ids

        options = [
            SimpleNamespace(selected=True, status="VERIFYING", bound_match_id="match-b"),
            SimpleNamespace(selected=True, status="REVIEW_REQUIRED", bound_match_id="match-a"),
            SimpleNamespace(selected=True, status="COMPLETED", bound_match_id="match-old"),
            SimpleNamespace(selected=True, status="LOCKED", bound_match_id=None),
        ]
        self.assertEqual(
            _startup_repair_bound_match_ids(options),
            ["match-a", "match-b"],
        )
    def _base(self, engine, *, device_id="device-finality-test"):
        from sqlalchemy.orm import Session
        from app.models import CompanionDevice, User
        db = Session(engine)
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Mandarin",
        )
        db.add(user); db.flush()
        device = CompanionDevice(
            user_id=user.id,
            device_id=device_id,
            token_hash="a" * 64,
            identity_ok=True,
        )
        db.add(device); db.commit(); db.refresh(device)
        return db, user, device

    def test_stale_outcome_does_not_finalize_or_queue_current_match(self) -> None:
        from sqlalchemy import create_engine, select
        from app.db import Base
        from app.models import Job
        from app.services.companion import record_snapshot
        from app.worker import _companion_finalization_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine)
        with db:
            # Production regression: current match 99529660 while GEP still
            # carries previous match 99514255's winner. alpha.4 sends only the
            # winner label, so the backend must treat it as live/provisional.
            record_snapshot(
                db, device, user,
                game_running=True,
                steam_id64=user.steam_id64,
                phase="GameInProgress",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "StreetBrawl"},
                match_id=99529660,
                gep_version="311.2.2",
                version="0.4.0-alpha.4",
                live_stats={"kills": 0, "deaths": 0, "assists": 5, "healing": 4609},
                session_id="s-current",
                session_started_at="2026-08-15T04:54:14+00:00",
                local_team="AMBER",
                match_outcome="AMBER",
                event_type="heartbeat",
            )
            self.assertIsNone(_companion_finalization_from_events(db, user, 99529660))
            self.assertEqual(list(db.scalars(select(Job)).all()), [])

    def test_postgame_phase_without_session_end_does_not_finalize(self) -> None:
        from sqlalchemy import create_engine, select
        from app.db import Base
        from app.models import Job
        from app.services.companion import record_snapshot
        from app.worker import _companion_finalization_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-phase-flicker-test")
        with db:
            record_snapshot(
                db, device, user,
                game_running=True, steam_id64=user.steam_id64,
                phase="PostGame",
                game_mode_raw={"match_mode":"Unranked","game_mode":"StreetBrawl"},
                match_id=99529660, gep_version="311.2.2", version="0.4.0-alpha.4",
                live_stats={"assists": 11},
                session_id="s-current", session_started_at="2026-08-15T04:54:14+00:00",
                # No persisted end marker and no explicit match_ended event.
                event_type="heartbeat",
            )
            self.assertIsNone(_companion_finalization_from_events(db, user, 99529660))
            self.assertEqual(list(db.scalars(select(Job)).all()), [])

    def test_postgame_queues_final_v3_and_outcome_waits_for_stabilization(self) -> None:
        from sqlalchemy import create_engine, select
        from app.db import Base
        from app.models import CompanionEvent, Job
        from app.services.companion import record_snapshot
        from app.worker import _companion_finalization_from_events, _companion_result_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-postgame-test")
        with db:
            before = datetime.now(timezone.utc)
            record_snapshot(
                db, device, user,
                game_running=True,
                steam_id64=user.steam_id64,
                phase="PostGame",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "StreetBrawl"},
                match_id=99529660,
                gep_version="311.2.2",
                version="0.4.0-alpha.4",
                live_stats={"kills": 0, "deaths": 0, "assists": 11, "hero_damage": 14427, "healing": 10363, "souls": 34000},
                session_id="s-current",
                session_started_at="2026-08-15T04:54:14+00:00",
                session_ended_at="2026-08-15T05:04:38+00:00",
                session_end_reason="phase_postgame",
                match_clock_s=608,
                local_team="SAPPHIRE",
                # Could still be stale at the instant PostGame arrives.
                match_outcome="AMBER",
                event_type="match_ended",
            )
            final = _companion_finalization_from_events(db, user, 99529660)
            self.assertIsNotNone(final)
            assert final is not None
            self.assertIn(final["signal"], {"match_end", "postgame", "session_end"})
            jobs = list(db.scalars(select(Job)).all())
            self.assertEqual(len(jobs), 1)
            self.assertIn("final-v3", jobs[0].idempotency_key)
            run_after = jobs[0].run_after
            if run_after.tzinfo is None:
                run_after = run_after.replace(tzinfo=timezone.utc)
            self.assertGreaterEqual(run_after, before)

            # No result is trusted from the terminal instant itself.
            self.assertIsNone(_companion_result_from_events(db, user, 99529660))

            stable_at = datetime.now(timezone.utc) + timedelta(seconds=10)
            db.add(CompanionEvent(
                device_id=device.id,
                user_id=user.id,
                event_type="heartbeat",
                external_match_id=99529660,
                game_match_mode="STREET_BRAWL",
                phase="PostGame",
                payload={
                    "identity_ok": True,
                    "session": {
                        "started_at": "2026-08-15T04:54:14+00:00",
                        "ended_at": "2026-08-15T05:04:38+00:00",
                        "end_reason": "phase_postgame",
                        "match_clock_s": 608,
                        "local_team": "SAPPHIRE",
                        "match_outcome": "SAPPHIRE",
                    },
                },
                created_at=stable_at,
            ))
            db.commit()
            result = _companion_result_from_events(db, user, 99529660)
            self.assertIsNotNone(result)
            assert result is not None
            self.assertTrue(result["won"])
            self.assertEqual(result["match_outcome"], "SAPPHIRE")

    def test_duplicate_terminal_snapshots_create_only_one_final_v3_job(self) -> None:
        from sqlalchemy import create_engine, select
        from app.db import Base
        from app.models import Job
        from app.services.companion import record_snapshot

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-dedupe-test")
        with db:
            kwargs = dict(
                game_running=True,
                steam_id64=user.steam_id64,
                phase="PostGame",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "StreetBrawl"},
                match_id=99529660,
                gep_version="311.2.2",
                version="0.4.0-alpha.4",
                live_stats={"kills": 0, "deaths": 0, "assists": 11},
                session_id="s-current",
                session_started_at="2026-08-15T04:54:14+00:00",
                session_ended_at="2026-08-15T05:04:38+00:00",
                session_end_reason="phase_postgame",
                local_team="AMBER",
                match_outcome="AMBER",
                event_type="match_ended",
            )
            record_snapshot(db, device, user, **kwargs)
            record_snapshot(db, device, user, **kwargs)
            jobs = list(db.scalars(select(Job)).all())
            self.assertEqual(len(jobs), 1)
            self.assertIn("final-v3", jobs[0].idempotency_key)

    def test_mode_none_after_postgame_does_not_erase_exact_evidence_mode(self) -> None:
        from sqlalchemy import create_engine, select
        from app.db import Base
        from app.models import CompanionMatchEvidence
        from app.services.companion import record_snapshot

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-mode-test")
        with db:
            record_snapshot(
                db, device, user,
                game_running=True, steam_id64=user.steam_id64,
                phase="GameInProgress",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "StreetBrawl"},
                match_id=99529660, gep_version="311.2.2", version="0.4.0-alpha.4",
                live_stats={"assists": 10}, event_type="heartbeat",
            )
            record_snapshot(
                db, device, user,
                game_running=True, steam_id64=user.steam_id64,
                phase="End",
                game_mode_raw={"match_mode": "NONE", "game_mode": "NONE"},
                match_id=99529660, gep_version="311.2.2", version="0.4.0-alpha.4",
                live_stats={"assists": 11}, session_ended_at="2026-08-15T05:04:53+00:00",
                session_end_reason="match_end", event_type="match_ended",
            )
            evidence = db.scalar(select(CompanionMatchEvidence).where(CompanionMatchEvidence.external_match_id == 99529660))
            self.assertIsNotNone(evidence)
            assert evidence is not None
            self.assertEqual(evidence.game_match_mode, "STREET_BRAWL")
            self.assertEqual(evidence.assists, 11)

    def test_legacy_outcome_only_finality_is_not_trusted(self) -> None:
        from app.services.evaluator import _result
        option = SimpleNamespace(
            conditions=[{"metric": "player.assists", "operator": "gte", "target": 10, "capabilities": ["summary.assists"]}],
            metric="player.assists", operator="gte", target=10,
            required_capabilities=["summary.assists"], required_game_match_mode="STREET_BRAWL",
        )
        match = SimpleNamespace(
            is_final=True, duration_s=None, provider="gep_fallback",
            raw_summary={"companion_finalization": {"trusted": True, "signal": "match_outcome"}},
            game_match_mode="STREET_BRAWL", scoring_status="SCORED",
            capabilities=["summary.assists"],
        )
        participant = SimpleNamespace(
            won=True, kills=0, deaths=0, assists=11, net_worth=34000,
            hero_damage=14427, object_damage=1898, healing=10363,
        )
        result = _result(option, match, participant)
        self.assertEqual(result.status, "UNVERIFIABLE")
        self.assertIn("сигнал завершения", result.explanation)

    def test_weak_outcome_scrub_removes_stale_result_before_repair(self) -> None:
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import Match, MatchParticipant
        from app.worker import _scrub_legacy_weak_outcome_fact

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, _device = self._base(engine, device_id="device-scrub-test")
        with db:
            match = Match(
                external_match_id=99529660, provider="gep_fallback", is_final=True,
                game_match_mode="STREET_BRAWL", mode_classifier_version="gep-exact-v2",
                capabilities=["summary.assists", "summary.result"],
                raw_summary={
                    "companion_finalization": {"trusted": True, "signal": "match_outcome"},
                    "companion_result": {"won": True},
                },
            )
            db.add(match); db.flush()
            participant = MatchParticipant(match_id=match.id, account_id=user.account_id, won=True, assists=0)
            db.add(participant); db.commit()
            self.assertTrue(_scrub_legacy_weak_outcome_fact(db, match, int(user.account_id)))
            db.refresh(match); db.refresh(participant)
            self.assertNotIn("summary.result", match.capabilities)
            self.assertIsNone(participant.won)
            self.assertNotIn("companion_result", match.raw_summary)
            self.assertFalse(match.raw_summary["companion_finalization"]["trusted"])

    def test_missing_final_fact_stays_verifying_before_review_budget_exhausted(self) -> None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.db import Base
        from app.models import AutoReviewCase, BoardOption, ContractBoard, Job, Match, MatchParticipant, MissionDefinition, User
        from app.worker import CompanionMatchNotReady, FinalFactsPending, handle_evaluate

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = User(steam_id64=76561198980887041, account_id=1020621313, display_name="Mandarin")
            mission = MissionDefinition(
                key="heal-test", version=1, title="Heal", description="Heal",
                metric="player.healing", operator="gte", target=6000, reward_xp=100,
                required_capabilities=["summary.healing"], game_match_mode="STREET_BRAWL",
            )
            db.add_all([user, mission]); db.flush()
            board = ContractBoard(
                user_id=user.id, board_date=date.today(), status="VERIFYING",
                game_match_mode="STREET_BRAWL", seed="verify-test", attempts_used=1,
                max_attempts=3, locked_at=datetime.now(timezone.utc)-timedelta(minutes=20),
                expires_at=datetime.now(timezone.utc)+timedelta(hours=6),
            )
            match = Match(
                external_match_id=99529660, provider="gep_fallback", is_final=True,
                started_at=datetime.now(timezone.utc)-timedelta(minutes=10),
                game_match_mode="STREET_BRAWL", mode_classifier_version="gep-exact-v3",
                mode_confidence="HIGH", scoring_status="SCORED",
                capabilities=["summary.assists"],
                raw_summary={"companion_finalization": {"trusted": True, "signal": "postgame"}},
            )
            db.add_all([board, match]); db.flush()
            option = BoardOption(
                board_id=board.id, mission_definition_id=mission.id,
                rendered_title="Heal", rendered_description="Heal",
                metric="player.healing", operator="gte", target=6000, reward_xp=100,
                conditions=[{"metric":"player.healing","operator":"gte","target":6000,"capabilities":["summary.healing"]}],
                required_capabilities=["summary.healing"], required_game_match_mode="STREET_BRAWL",
                selected=True, status="VERIFYING", bound_match_id=match.id,
            )
            participant = MatchParticipant(match_id=match.id, account_id=user.account_id, healing=10363, assists=11)
            job = Job(type="evaluate_match", payload={"board_id": board.id, "match_id": match.id}, attempts=1, max_attempts=12, idempotency_key="eval-wait")
            review = AutoReviewCase(
                board_id=board.id, user_id=user.id, match_id=match.id,
                status="PENDING", reasons=[{"reason":"summary.healing missing"}], context={},
            )
            db.add_all([option, participant, job, review]); db.commit()

            fake_settings = SimpleNamespace(provider="deadlock_api", post_match_verification_max_attempts=12)
            with patch("app.worker.settings", fake_settings), patch(
                "app.worker._resolve_exact_companion_payload",
                side_effect=CompanionMatchNotReady("metadata 404"),
            ):
                with self.assertRaises(FinalFactsPending):
                    handle_evaluate(db, job)
            db.refresh(board); db.refresh(option); db.refresh(review)
            self.assertEqual(board.status, "VERIFYING")
            self.assertEqual(option.status, "VERIFYING")
            self.assertEqual(review.status, "WAITING_PROVIDER")
            self.assertIn("итоговое лечение союзников", option.explanation)
            self.assertIn("Попытка сохранена", option.explanation)

    def test_strong_final_brawl_snapshot_exposes_scoreboard_healing_only(self) -> None:
        from app.worker import _normalized_from_companion_evidence

        evidence = SimpleNamespace(
            game_match_mode="STREET_BRAWL",
            kills=6, deaths=4, assists=17,
            hero_damage=12000, object_damage=900, healing=8567, souls=15000,
            steam_id64=76561198000000001, hero_id=7,
            captured_at=datetime(2026, 8, 18, 12, 31, tzinfo=timezone.utc),
        )
        finalization = {
            "trusted": True,
            "signal": "match_end",
            "started_at": datetime(2026, 8, 18, 12, 22, tzinfo=timezone.utc),
            "ended_at": datetime(2026, 8, 18, 12, 31, tzinfo=timezone.utc),
            "match_clock_s": 540,
        }
        user = SimpleNamespace(id="user-scoreboard", account_id=123456, steam_id64=76561198000000001)
        job = SimpleNamespace(payload={}, attempts=1)
        with patch("app.worker._companion_evidence_for", return_value=evidence), patch(
            "app.worker._companion_finalization_from_events", return_value=finalization
        ):
            normalized = _normalized_from_companion_evidence(MagicMock(), user, job, 100180758)

        assert normalized is not None
        self.assertIn("gep.scoreboard_healing", normalized["capabilities"])
        self.assertNotIn("summary.healing", normalized["capabilities"])
        self.assertEqual(normalized["participant"]["healing"], 8567)
        self.assertTrue(normalized["raw_summary"]["companion_evidence"]["scoreboard_healing_final"])

    def test_provider_404_can_settle_legacy_brawl_healing_from_final_scoreboard(self) -> None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.db import Base
        from app.models import BoardOption, ContractBoard, Job, Match, MatchParticipant, MissionDefinition, User
        from app.worker import handle_evaluate

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = User(steam_id64=76561198000000002, account_id=123457, display_name="Regression User")
            mission = MissionDefinition(
                key="legacy-brawl-heal", version=2, title="Legacy heal", description="Legacy heal",
                metric="player.healing", operator="gte", target=6000, reward_xp=100,
                required_capabilities=["summary.healing"], game_match_mode="STREET_BRAWL",
            )
            db.add_all([user, mission]); db.flush()
            board = ContractBoard(
                user_id=user.id, board_date=date.today(), status="VERIFYING",
                game_match_mode="STREET_BRAWL", seed="legacy-scoreboard-repair",
                attempts_used=3, max_attempts=3,
                locked_at=datetime.now(timezone.utc) - timedelta(minutes=20),
                expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
            )
            match = Match(
                external_match_id=100180758, provider="gep_fallback", is_final=True,
                started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
                game_match_mode="STREET_BRAWL", mode_classifier_version="gep-exact-v2",
                mode_confidence="HIGH", scoring_status="SCORED",
                capabilities=["summary.kills", "gep.scoreboard_healing"],
                raw_summary={"external_metadata_missing": True, "companion_finalization": {"trusted": True, "signal": "match_end"}},
            )
            db.add_all([board, match]); db.flush()
            option = BoardOption(
                board_id=board.id, mission_definition_id=mission.id,
                rendered_title="Legacy heal", rendered_description="Legacy heal",
                metric="player.healing", operator="gte", target=6000, reward_xp=100,
                conditions=[{"metric": "player.healing", "operator": "gte", "target": 6000, "capabilities": ["summary.healing"]}],
                required_capabilities=["summary.healing"], required_game_match_mode="STREET_BRAWL",
                selected=True, status="VERIFYING", bound_match_id=match.id,
            )
            participant = MatchParticipant(match_id=match.id, account_id=user.account_id, healing=8567, kills=6)
            job = Job(type="evaluate_match", payload={"board_id": board.id, "match_id": match.id}, attempts=12, max_attempts=12, idempotency_key="eval-scoreboard-repair")
            db.add_all([option, participant, job]); db.commit()

            fake_settings = SimpleNamespace(
                provider="deadlock_api", post_match_verification_max_attempts=12,
                evaluator_version="contracts-3.0.0-alpha.1", min_match_duration_seconds=600,
                max_discovery_attempts=180,
            )
            with patch("app.worker.settings", fake_settings), patch("app.services.evaluator.settings", fake_settings):
                handle_evaluate(db, job)
                db.refresh(board); db.refresh(option)
                self.assertEqual(board.status, "SETTLED")
                self.assertEqual(option.status, "COMPLETED")
                outbox_count = db.query(__import__("app.models", fromlist=["OutboxEvent"]).OutboxEvent).count()
                self.assertEqual(outbox_count, 1)

                # Re-running the idempotent evaluation job cannot grant or queue twice.
                handle_evaluate(db, job)
                outbox_count_after = db.query(__import__("app.models", fromlist=["OutboxEvent"]).OutboxEvent).count()
                self.assertEqual(outbox_count_after, 1)

    def test_provider_outage_still_allows_strong_gep_fallback_binding(self) -> None:
        from app.services.providers import ProviderError
        from app.worker import _resolve_exact_companion_payload

        db = MagicMock()
        user = SimpleNamespace(id="user-1", account_id=1020621313)
        job = SimpleNamespace(payload={}, attempts=1)
        evidence = SimpleNamespace(id="evidence")
        fallback = {
            "external_match_id": 99529660,
            "provider": "gep_fallback",
            "is_final": True,
            "game_match_mode": "STREET_BRAWL",
            "participant": {"account_id": 1020621313, "assists": 11},
            "capabilities": ["summary.assists"],
        }
        with patch("app.worker._companion_evidence_for", return_value=evidence), patch(
            "app.worker._normalized_from_companion_evidence", return_value=fallback
        ), patch("app.worker.merge_companion_evidence", side_effect=lambda _db, _user, data, _mid: data), patch(
            "app.worker.DeadlockApiProvider"
        ) as provider_cls:
            provider = provider_cls.return_value.__enter__.return_value
            provider.fetch_match_by_id.side_effect = ProviderError("upstream 503")
            result = _resolve_exact_companion_payload(db, user, job, 99529660)

        self.assertEqual(result["provider"], "gep_fallback")
        self.assertIn("upstream 503", job.payload["_provider_last_error"])
        # cache request + one Steam-backed attempt, then local fallback
        self.assertEqual(provider.fetch_match_by_id.call_count, 2)

    def test_finalization_scan_survives_more_than_256_post_terminal_events(self) -> None:
        """The terminal event must never disappear behind a fixed recent window.

        Frozen alpha.4 emits periodic heartbeats. A user can keep Deadlock open
        for hours after a match, so hundreds of later rows can share the same
        external Match ID. The repair query must select terminal semantics
        directly instead of relying on LIMIT N.
        """
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import CompanionEvent
        from app.worker import _companion_finalization_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-long-postgame-test")
        with db:
            base = datetime(2026, 8, 15, 4, 54, 14, tzinfo=timezone.utc)
            terminal_at = base + timedelta(seconds=608)
            db.add(CompanionEvent(
                device_id=device.id,
                user_id=user.id,
                event_type="match_ended",
                external_match_id=99529660,
                game_match_mode="STREET_BRAWL",
                phase="PostGame",
                payload={
                    "identity_ok": True,
                    "session": {
                        "id": "session-long",
                        "started_at": base.isoformat(),
                        "ended_at": terminal_at.isoformat(),
                        "end_reason": "phase_postgame",
                        "match_clock_s": 608,
                        "local_team": "AMBER",
                        "match_outcome": "AMBER",
                    },
                },
                created_at=terminal_at,
            ))
            # More than three times the rc6 window. These rows intentionally
            # omit the persisted end marker to prove discovery is based on the
            # terminal event itself rather than a lucky later heartbeat.
            for index in range(800):
                db.add(CompanionEvent(
                    device_id=device.id,
                    user_id=user.id,
                    event_type="heartbeat",
                    external_match_id=99529660,
                    game_match_mode="UNKNOWN",
                    phase="GameInProgress",
                    payload={
                        "identity_ok": True,
                        "session": {
                            "id": "session-later",
                            "started_at": None,
                            "ended_at": None,
                            "end_reason": None,
                        },
                    },
                    created_at=terminal_at + timedelta(seconds=index + 1),
                ))
            db.commit()

            final = _companion_finalization_from_events(db, user, 99529660)
            self.assertIsNotNone(final)
            assert final is not None
            self.assertEqual(final["event_type"], "match_ended")
            self.assertEqual(final["end_reason"], "phase_postgame")

    def test_explicit_match_ended_survives_missing_session_object(self) -> None:
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import CompanionEvent
        from app.worker import _companion_finalization_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-partial-terminal-test")
        with db:
            at = datetime(2026, 8, 15, 5, 4, 38, tzinfo=timezone.utc)
            db.add(CompanionEvent(
                device_id=device.id,
                user_id=user.id,
                event_type="match_ended",
                external_match_id=99529660,
                game_match_mode="STREET_BRAWL",
                phase="PostGame",
                payload={"identity_ok": True},
                created_at=at,
            ))
            db.commit()
            final = _companion_finalization_from_events(db, user, 99529660)
            self.assertIsNotNone(final)
            assert final is not None
            self.assertEqual(final["event_type"], "match_ended")

    def test_trusted_final_gep_match_can_score_non_duration_contract_without_duration(self) -> None:
        from app.services.evaluator import _result
        option = SimpleNamespace(
            conditions=[{
                "metric": "player.assists", "operator": "gte", "target": 10,
                "capabilities": ["summary.assists"],
            }],
            metric="player.assists", operator="gte", target=10,
            required_capabilities=["summary.assists"], required_game_match_mode="STREET_BRAWL",
        )
        match = SimpleNamespace(
            is_final=True, duration_s=None, provider="gep_fallback+gep",
            raw_summary={"companion_finalization": {"trusted": True, "signal": "postgame"}},
            game_match_mode="STREET_BRAWL", scoring_status="SCORED",
            capabilities=["summary.assists"],
        )
        participant = SimpleNamespace(
            won=True, kills=0, deaths=0, assists=11, net_worth=34000,
            hero_damage=14427, object_damage=1898, healing=10363,
        )
        result = _result(option, match, participant)
        self.assertEqual(result.status, "COMPLETED")
        self.assertEqual(result.current, 11.0)



    def test_finalization_scan_reads_recent_terminal_event_after_many_live_heartbeats(self) -> None:
        """Regression for production match 99529660.

        A Street Brawl can generate hundreds of CompanionEvent heartbeats. rc5
        ordered events ASC and limited to 128, so startup repair inspected only
        the oldest GameInProgress snapshots and never reached the real
        match_ended event near the end of the match.
        """
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import CompanionEvent
        from app.worker import _companion_finalization_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine, device_id="device-many-events-test")
        with db:
            base = datetime(2026, 8, 15, 4, 54, 14, tzinfo=timezone.utc)
            for index in range(180):
                db.add(CompanionEvent(
                    device_id=device.id,
                    user_id=user.id,
                    event_type="heartbeat",
                    external_match_id=99529660,
                    game_match_mode="STREET_BRAWL",
                    phase="GameInProgress",
                    payload={
                        "identity_ok": True,
                        "session": {
                            "id": "session-many",
                            "started_at": base.isoformat(),
                            "ended_at": None,
                            "end_reason": None,
                            "local_team": "AMBER",
                            "match_outcome": "AMBER",
                        },
                    },
                    created_at=base + timedelta(seconds=index),
                ))
            terminal_at = base + timedelta(seconds=608)
            db.add(CompanionEvent(
                device_id=device.id,
                user_id=user.id,
                event_type="match_ended",
                external_match_id=99529660,
                game_match_mode="STREET_BRAWL",
                phase="PostGame",
                payload={
                    "identity_ok": True,
                    "session": {
                        "id": "session-many",
                        "started_at": base.isoformat(),
                        "ended_at": terminal_at.isoformat(),
                        "end_reason": "phase_postgame",
                        "match_clock_s": 608,
                        "local_team": "AMBER",
                        "match_outcome": "AMBER",
                    },
                },
                created_at=terminal_at,
            ))
            db.commit()

            final = _companion_finalization_from_events(db, user, 99529660)
            self.assertIsNotNone(final)
            assert final is not None
            self.assertEqual(final["event_type"], "match_ended")
            self.assertEqual(final["end_reason"], "phase_postgame")
            self.assertEqual(final["match_clock_s"], 608)




if __name__ == "__main__":
    unittest.main()

class ReviewConsistencyRegressionTests(unittest.TestCase):
    def test_waiting_provider_review_is_resolved_after_board_settles(self) -> None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.db import Base
        from app.models import AutoReviewCase, ContractBoard, Match, User
        from app.worker import _resolve_settled_waiting_provider_reviews

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = User(
                steam_id64=76561198980887041,
                account_id=1020621313,
                display_name="Mandarin",
            )
            db.add(user); db.flush()
            board = ContractBoard(
                user_id=user.id,
                board_date=date(2026, 8, 15),
                status="SETTLED",
                game_match_mode="STREET_BRAWL",
                seed="review-consistency",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
            )
            match = Match(
                external_match_id=99529660,
                provider="deadlock_api",
                game_match_mode="STREET_BRAWL",
                mode_classifier_version="test",
                is_final=True,
            )
            db.add_all([board, match]); db.flush()
            review = AutoReviewCase(
                board_id=board.id,
                user_id=user.id,
                match_id=match.id,
                status="WAITING_PROVIDER",
                reasons=[{"reason": "summary.healing"}],
                context={},
            )
            db.add(review); db.commit()

            changed = _resolve_settled_waiting_provider_reviews(db)
            db.commit(); db.refresh(review)

            self.assertEqual(changed, 1)
            self.assertEqual(review.status, "RESOLVED")
            self.assertIsNotNone(review.reviewed_at)
            self.assertIn("итоговых данных", review.reviewer_note or "")

class FinalFactsPartialSettlementTests(unittest.TestCase):
    def test_trusted_final_match_clock_becomes_duration_capability(self) -> None:
        from app.worker import _normalized_from_companion_evidence

        evidence = SimpleNamespace(
            game_match_mode="STANDARD",
            kills=15, deaths=3, assists=13,
            hero_damage=28668, object_damage=9187, healing=1119, souls=31983,
            steam_id64=76561198980887041, hero_id=64,
            captured_at=datetime(2026, 8, 18, 19, 5, tzinfo=timezone.utc),
        )
        finalization = {
            "trusted": True,
            "signal": "match_end",
            "started_at": datetime(2026, 8, 18, 18, 36, 40, tzinfo=timezone.utc),
            "ended_at": datetime(2026, 8, 18, 19, 5, tzinfo=timezone.utc),
            "match_clock_s": 1700,
            "match_clock_observed_at": "2026-08-18T19:04:59+00:00",
        }
        user = SimpleNamespace(id="duration-user", account_id=1020621313, steam_id64=76561198980887041)
        job = SimpleNamespace(payload={}, attempts=1)
        with patch("app.worker._companion_evidence_for", return_value=evidence), patch(
            "app.worker._companion_finalization_from_events", return_value=finalization
        ):
            normalized = _normalized_from_companion_evidence(MagicMock(), user, job, 100246793)

        assert normalized is not None
        self.assertEqual(normalized["duration_s"], 1700)
        self.assertIn("summary.duration", normalized["capabilities"])
        self.assertTrue(normalized["is_final"])

    def test_stale_match_clock_is_not_promoted_to_final_duration(self) -> None:
        from app.worker import _trusted_final_match_clock_duration

        finalization = {
            "trusted": True,
            "signal": "match_end",
            "ended_at": datetime(2026, 8, 18, 19, 5, tzinfo=timezone.utc),
            "match_clock_s": 1500,
            "match_clock_observed_at": "2026-08-18T19:02:00+00:00",
        }
        self.assertIsNone(_trusted_final_match_clock_duration(finalization))

    def test_one_missing_fact_no_longer_freezes_other_contracts(self) -> None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from app.db import Base
        from app.models import BoardOption, ContractBoard, Job, Match, MatchParticipant, MissionDefinition, OutboxEvent, User
        from app.worker import CompanionMatchNotReady, FinalFactsPending, handle_evaluate

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = User(steam_id64=76561198980887041, account_id=1020621313, display_name="Mandarin")
            missions = [
                MissionDefinition(key="kills-partial", version=2, title="Kills", description="Kills", metric="player.kills", operator="gte", target=5, reward_xp=70, required_capabilities=["summary.kills"], game_match_mode="STANDARD"),
                MissionDefinition(key="damage-partial", version=2, title="Damage", description="Damage", metric="player.hero_damage", operator="gte", target=33000, reward_xp=120, required_capabilities=["summary.hero_damage"], game_match_mode="STANDARD"),
                MissionDefinition(key="duration-partial", version=2, title="Duration", description="Duration", metric="match.duration_s", operator="gte", target=1560, reward_xp=70, required_capabilities=["summary.duration"], game_match_mode="STANDARD"),
            ]
            db.add(user); db.add_all(missions); db.flush()
            board = ContractBoard(
                user_id=user.id, board_date=date.today(), status="VERIFYING",
                game_match_mode="STANDARD", seed="partial-settlement", attempts_used=1,
                max_attempts=3, locked_at=datetime.now(timezone.utc)-timedelta(minutes=40),
                expires_at=datetime.now(timezone.utc)+timedelta(hours=6),
            )
            match = Match(
                external_match_id=100246793, provider="gep_fallback", is_final=True,
                started_at=datetime.now(timezone.utc)-timedelta(minutes=30), duration_s=None,
                game_match_mode="STANDARD", mode_classifier_version="gep-exact-v2",
                mode_confidence="HIGH", scoring_status="SCORED",
                capabilities=["summary.kills", "summary.hero_damage"],
                raw_summary={"companion_finalization": {"trusted": True, "signal": "match_end"}},
            )
            db.add_all([board, match]); db.flush()
            options = [
                BoardOption(board_id=board.id, mission_definition_id=missions[0].id, rendered_title="Kills", rendered_description="Kills", metric="player.kills", operator="gte", target=5, reward_xp=70, conditions=[{"metric":"player.kills","operator":"gte","target":5,"capabilities":["summary.kills"]}], required_capabilities=["summary.kills"], required_game_match_mode="STANDARD", selected=True, status="VERIFYING", bound_match_id=match.id),
                BoardOption(board_id=board.id, mission_definition_id=missions[1].id, rendered_title="Damage", rendered_description="Damage", metric="player.hero_damage", operator="gte", target=33000, reward_xp=120, conditions=[{"metric":"player.hero_damage","operator":"gte","target":33000,"capabilities":["summary.hero_damage"]}], required_capabilities=["summary.hero_damage"], required_game_match_mode="STANDARD", selected=True, status="VERIFYING", bound_match_id=match.id),
                BoardOption(board_id=board.id, mission_definition_id=missions[2].id, rendered_title="Duration", rendered_description="Duration", metric="match.duration_s", operator="gte", target=1560, reward_xp=70, conditions=[{"metric":"match.duration_s","operator":"gte","target":1560,"capabilities":["summary.duration"]}], required_capabilities=["summary.duration"], required_game_match_mode="STANDARD", selected=True, status="VERIFYING", bound_match_id=match.id),
            ]
            participant = MatchParticipant(match_id=match.id, account_id=user.account_id, kills=15, deaths=3, assists=13, hero_damage=28668, object_damage=9187, net_worth=31983, healing=1119)
            job = Job(type="evaluate_match", payload={"board_id": board.id, "match_id": match.id}, attempts=1, max_attempts=12, idempotency_key="eval-partial")
            db.add_all(options + [participant, job]); db.commit()

            fake_settings = SimpleNamespace(
                provider="deadlock_api", post_match_verification_max_attempts=12,
                evaluator_version="contracts-3.0.0-alpha.1", min_match_duration_seconds=600,
                max_discovery_attempts=180,
            )
            with patch("app.worker.settings", fake_settings), patch("app.services.evaluator.settings", fake_settings), patch(
                "app.worker._resolve_exact_companion_payload",
                side_effect=CompanionMatchNotReady("metadata 404"),
            ):
                with self.assertRaises(FinalFactsPending):
                    handle_evaluate(db, job)

            for item in options:
                db.refresh(item)
            db.refresh(board)
            self.assertEqual(options[0].status, "COMPLETED")
            self.assertEqual(options[0].progress_current, 15.0)
            self.assertEqual(options[1].status, "LOCKED")
            self.assertIsNone(options[1].bound_match_id)
            self.assertEqual(options[1].progress_current, 28668.0)
            self.assertEqual(options[2].status, "VERIFYING")
            self.assertEqual(options[2].bound_match_id, match.id)
            self.assertEqual(board.status, "VERIFYING")
            self.assertEqual(db.query(OutboxEvent).count(), 1)

class OutcomeInfoUpdateV7Tests(unittest.TestCase):
    def _base(self, engine):
        from sqlalchemy.orm import Session
        from app.models import CompanionDevice, User
        db = Session(engine)
        user = User(
            steam_id64=76561198980887041,
            account_id=1020621313,
            display_name="Mandarin",
        )
        db.add(user); db.flush()
        device = CompanionDevice(
            user_id=user.id,
            device_id="device-outcome-v7",
            token_hash="b" * 64,
            identity_ok=True,
        )
        db.add(device); db.commit(); db.refresh(device)
        return db, user, device

    def test_exact_post_match_outcome_info_update_becomes_contract_grade_result(self) -> None:
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import CompanionEvent
        from app.services.companion import record_snapshot
        from app.worker import _companion_result_from_events, merge_companion_evidence

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine)
        with db:
            ended = datetime.now(timezone.utc)
            record_snapshot(
                db, device, user,
                game_running=True,
                steam_id64=user.steam_id64,
                phase="PostGame",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "StreetBrawl"},
                match_id=100300001,
                gep_version="311.3.2",
                version="0.5.2-alpha.3",
                live_stats={"kills": 2, "deaths": 3, "assists": 5, "hero_damage": 13113, "souls": 22400},
                session_id="session-outcome-v7",
                session_started_at=(ended - timedelta(minutes=13)).isoformat(),
                session_ended_at=ended.isoformat(),
                session_end_reason="match_end",
                match_clock_s=780,
                match_clock_observed_at=ended.isoformat(),
                local_team="SAPPHIRE",
                # Terminal snapshot can still carry the old winner and must not
                # itself settle the win contract.
                match_outcome="AMBER",
                event_type="match_ended",
            )
            self.assertIsNone(_companion_result_from_events(db, user, 100300001))

            observed = ended + timedelta(seconds=2)
            db.add(CompanionEvent(
                device_id=device.id,
                user_id=user.id,
                event_type="heartbeat",
                external_match_id=100300001,
                game_match_mode="STREET_BRAWL",
                phase="PostGame",
                payload={
                    "identity_ok": True,
                    "session": {
                        "id": "session-outcome-v7",
                        "started_at": (ended - timedelta(minutes=13)).isoformat(),
                        "ended_at": ended.isoformat(),
                        "end_reason": "match_end",
                        "local_team": "SAPPHIRE",
                        "match_outcome": "SAPPHIRE",
                        "match_outcome_event_at": observed.isoformat(),
                        "match_outcome_event_match_id": 100300001,
                    },
                },
                created_at=observed,
            ))
            db.commit()

            result = _companion_result_from_events(db, user, 100300001)
            self.assertIsNotNone(result)
            assert result is not None
            self.assertTrue(result["trusted_for_scoring"])
            self.assertTrue(result["won"])

            data = {
                "provider": "gep_fallback",
                "game_match_mode": "STREET_BRAWL",
                "participant": {"account_id": user.account_id, "won": None},
                "capabilities": ["summary.kills"],
            }
            merged = merge_companion_evidence(db, user, data, 100300001)
            self.assertTrue(merged["participant"]["won"])
            self.assertIn("summary.result", merged["capabilities"])
            self.assertTrue(merged["raw_summary"]["companion_result"]["trusted_for_scoring"])

    def test_wrong_match_id_or_old_outcome_marker_stays_diagnostic_only(self) -> None:
        from sqlalchemy import create_engine
        from app.db import Base
        from app.models import CompanionEvent
        from app.services.companion import record_snapshot
        from app.worker import _companion_result_from_events

        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db, user, device = self._base(engine)
        with db:
            ended = datetime.now(timezone.utc)
            record_snapshot(
                db, device, user,
                game_running=True, steam_id64=user.steam_id64,
                phase="PostGame",
                game_mode_raw={"match_mode": "Unranked", "game_mode": "Normal"},
                match_id=100300010, gep_version="311.3.2", version="0.5.2-alpha.3",
                live_stats={"kills": 7},
                session_id="session-current",
                session_started_at=(ended - timedelta(minutes=30)).isoformat(),
                session_ended_at=ended.isoformat(), session_end_reason="match_end",
                local_team="AMBER", match_outcome="AMBER", event_type="match_ended",
            )
            later = ended + timedelta(seconds=10)
            db.add(CompanionEvent(
                device_id=device.id, user_id=user.id, event_type="heartbeat",
                external_match_id=100300010, game_match_mode="STANDARD", phase="PostGame",
                payload={
                    "identity_ok": True,
                    "session": {
                        "id": "session-current",
                        "ended_at": ended.isoformat(),
                        "end_reason": "match_end",
                        "local_team": "AMBER",
                        "match_outcome": "AMBER",
                        # Explicit marker belongs to an older match, so it must
                        # never settle the current win condition.
                        "match_outcome_event_at": (ended - timedelta(minutes=20)).isoformat(),
                        "match_outcome_event_match_id": 100299999,
                    },
                },
                created_at=later,
            ))
            db.commit()
            result = _companion_result_from_events(db, user, 100300010)
            self.assertIsNotNone(result)
            assert result is not None
            self.assertFalse(result["trusted_for_scoring"])

    def test_trusted_result_never_overrides_conflicting_provider_result(self) -> None:
        from app.worker import merge_companion_evidence

        evidence = SimpleNamespace(
            steam_id64=76561198980887041,
            game_match_mode="STANDARD",
            captured_at=datetime.now(timezone.utc),
            hero_id=1, kills=10, deaths=2, assists=7,
            hero_damage=20000, object_damage=1000, healing=500, souls=35000,
        )
        db = MagicMock(); db.scalar.return_value = evidence
        user = SimpleNamespace(id="u", steam_id64=76561198980887041, account_id=1020621313)
        trusted = {
            "local_team": "SAPPHIRE", "match_outcome": "SAPPHIRE", "won": True,
            "event_type": "heartbeat", "captured_at": datetime.now(timezone.utc).isoformat(),
            "trusted_for_scoring": True, "trust_reason": "test",
        }
        data = {
            "provider": "deadlock_api",
            "game_match_mode": "STANDARD",
            "participant": {"account_id": user.account_id, "won": False},
            "capabilities": ["summary.result"],
        }
        with patch("app.worker._companion_result_from_events", return_value=trusted), patch("app.worker._companion_finalization_from_events", return_value=None):
            merged = merge_companion_evidence(db, user, data, 123)
        self.assertFalse(merged["participant"]["won"])
        self.assertEqual(merged["raw_summary"]["result_diagnostic_conflict"]["resolution"], "provider_result_wins")
