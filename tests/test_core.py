from __future__ import annotations
from unittest.mock import patch

import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from datetime import datetime, timedelta, timezone

# Configuration is read when app modules are imported.
_tmp = tempfile.TemporaryDirectory(prefix="dc-mvp-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp.name) / 'test.db'}"
os.environ["MATCH_PROVIDER"] = "mock"
os.environ["ALLOW_DEMO_AUTH"] = "true"
os.environ["ALLOW_DEV_ENDPOINTS"] = "true"
os.environ["SESSION_SECRET"] = "test-secret-not-for-production-use-only-2026"

from fastapi.testclient import TestClient

from app.config import settings
from app.db import SessionLocal
from app.main import _outbox_health, app
from app.services.jobs import claim_next_job, complete_job, retry_job
from app.services.normalization import classify_mode, normalize_deadlock_match
from app.services.providers import DeadlockApiProvider, HistoryResult
from app.services.seed import MISSIONS_V2
from app.worker import (
    CompanionMatchNotReady,
    NoMatchYet,
    OUTBOX_MAX_ATTEMPTS,
    dispatch_outbox,
    process_job,
)
from app.models import OutboxEvent, SessionToken, User, utcnow


class NormalizationTests(unittest.TestCase):
    def test_mode_classifier_handles_text_and_current_numeric_enums(self) -> None:
        self.assertEqual(classify_mode("unranked", "normal")[0], "STANDARD")
        self.assertEqual(classify_mode("ranked", "normal")[0], "RANKED")
        self.assertEqual(classify_mode(1, 1)[0], "STANDARD")
        self.assertEqual(classify_mode(4, 1)[0], "RANKED")
        self.assertEqual(classify_mode(8, 1)[0], "RANKED")
        self.assertEqual(classify_mode(1, 4)[0], "STREET_BRAWL")
        self.assertEqual(classify_mode(2, 1)[0], "UNKNOWN")
        self.assertEqual(classify_mode(1)[0], "UNKNOWN")
        self.assertEqual(classify_mode("street_brawl", "street_brawl")[0], "STREET_BRAWL")

    def test_missing_values_do_not_become_zero(self) -> None:
        normalized = normalize_deadlock_match(
            42,
            {
                "match_id": 1001,
                "match_mode": "unranked",
                "start_time": 1_700_000_000,
                "match_duration_s": 1800,
                "player_kills": 7,
            },
            None,
        )
        participant = normalized["participant"]
        self.assertEqual(participant["kills"], 7)
        self.assertIsNone(participant["deaths"])
        self.assertNotIn("summary.deaths", normalized["capabilities"])

    def test_street_brawl_semantic_marker_and_final_stats_snapshot(self) -> None:
        normalized = normalize_deadlock_match(
            42,
            {
                "match_id": 98557562,
                "match_mode": 99,
                "game_mode": 99,
                "start_time": 1_786_329_821,
                "match_duration_s": 1146,
                "player_kills": 4,
                "player_deaths": 7,
                "player_assists": 9,
                "net_worth": 48000,
                "player_match_outcome": 2,
                "brawl_score_team0": 3,
                "brawl_score_team1": 2,
            },
            {
                "match_id": 98557562,
                "street_brawl_rounds": [{"round_duration_s": 174, "winning_team": 1}],
                "players": [{
                    "account_id": 42,
                    "kills": 4,
                    "deaths": 7,
                    "assists": 9,
                    "net_worth": 48000,
                    "stats": [{"time_stamp_s": 100, "player_damage": 12345, "teammate_healing": 2345}],
                }],
            },
        )
        self.assertEqual(normalized["game_match_mode"], "STREET_BRAWL")
        self.assertEqual(normalized["participant"]["hero_damage"], 12345)
        self.assertEqual(normalized["participant"]["healing"], 2345)
        self.assertIn("summary.hero_damage", normalized["capabilities"])
        self.assertIn("summary.scoreboard_healing", normalized["capabilities"])
        self.assertNotIn("summary.healing", normalized["capabilities"])

    def test_zero_stats_are_preserved_and_explicit_outcome_controls_scoring(self) -> None:
        normalized = normalize_deadlock_match(
            42,
            {
                "match_id": 1002,
                "match_mode": 1,
                "game_mode": 1,
                "start_time": 1_700_000_000,
                "match_duration_s": 1200,
                "player_kills": 0,
                "player_deaths": 0,
                "player_assists": 0,
                "net_worth": 0,
                "player_match_outcome": 5,
            },
            None,
        )
        participant = normalized["participant"]
        self.assertEqual(participant["kills"], 0)
        self.assertEqual(participant["deaths"], 0)
        self.assertEqual(participant["assists"], 0)
        self.assertEqual(participant["net_worth"], 0)
        self.assertIsNone(participant["won"])
        self.assertEqual(normalized["scoring_status"], "NOT_SCORED")
        self.assertNotIn("summary.result", normalized["capabilities"])


class ProviderDiscoveryTests(unittest.TestCase):
    def test_history_summary_can_close_simple_contract_without_metadata(self) -> None:
        provider = object.__new__(DeadlockApiProvider)
        provider.history = lambda account_id, force_refetch=False: HistoryResult(
            matches=[{
                "match_id": 777,
                "start_time": 1_800_000_100,
                "match_duration_s": 2100,
                "match_mode": 1,
                "game_mode": 1,
                "player_match_outcome": 1,
                "player_kills": 12,
                "player_deaths": 3,
                "player_assists": 15,
                "net_worth": 35000,
            }],
            called_steam=False,
            status_code=200,
            retry_after=None,
        )
        provider.metadata = lambda match_id: self.fail("metadata must not be requested")
        result = provider.discover_after(42, datetime.fromtimestamp(1_800_000_000, timezone.utc), None, required_capabilities={"summary.kills", "summary.result"})
        self.assertIsNotNone(result.match)
        self.assertEqual(result.match["external_match_id"], 777)

    def test_missing_optional_metric_no_longer_blocks_match_binding(self) -> None:
        provider = object.__new__(DeadlockApiProvider)
        provider.history = lambda account_id, force_refetch=False: HistoryResult(
            matches=[{
                "match_id": 778,
                "start_time": 1_800_000_100,
                "match_duration_s": 2100,
                "match_mode": 1,
                "game_mode": 1,
                "player_kills": 8,
                "player_deaths": 4,
                "player_assists": 12,
            }],
            called_steam=True,
            status_code=200,
            retry_after=None,
        )
        provider.metadata = lambda match_id: None
        result = provider.discover_after(
            42,
            datetime.fromtimestamp(1_800_000_000, timezone.utc),
            None,
            required_capabilities={"summary.kills", "summary.object_damage"},
        )
        self.assertIsNotNone(result.match)
        self.assertEqual(result.match["external_match_id"], 778)
        self.assertNotIn("summary.object_damage", result.match["capabilities"])
        self.assertIn("missing_data", result.reason)

    def test_cached_history_street_brawl_4_1_is_eligible(self) -> None:
        provider = object.__new__(DeadlockApiProvider)
        provider.history = lambda account_id, force_refetch=False: HistoryResult(
            matches=[{
                "account_id": 42,
                "match_id": 98557562,
                "hero_id": 65,
                "start_time": 1_800_000_100,
                "game_mode": 4,
                "match_mode": 1,
                "player_kills": 4,
                "player_deaths": 7,
                "player_assists": 9,
                "net_worth": 48000,
                "match_duration_s": 1146,
                "player_match_outcome": 2,
                "brawl_score_team0": 3,
                "brawl_score_team1": 2,
            }],
            called_steam=False,
            status_code=200,
            retry_after=None,
        )
        provider.metadata = lambda match_id: self.fail("metadata must not be required for K/D/A Brawl contract")
        result = provider.discover_after(
            42,
            datetime.fromtimestamp(1_800_000_000, timezone.utc),
            None,
            required_capabilities={"summary.kills", "summary.assists"},
            required_mode="STREET_BRAWL",
        )
        self.assertIsNotNone(result.match)
        self.assertEqual(result.match["external_match_id"], 98557562)
        self.assertEqual(result.match["game_match_mode"], "STREET_BRAWL")
        self.assertFalse(result.called_steam)

    def test_called_steam_false_is_explained_when_no_new_match_exists(self) -> None:
        provider = object.__new__(DeadlockApiProvider)
        provider.history = lambda account_id, force_refetch=False: HistoryResult(
            matches=[{
                "match_id": 500,
                "start_time": 1_700_000_000,
                "match_duration_s": 1800,
                "match_mode": 1,
                "game_mode": 1,
            }],
            called_steam=False,
            status_code=200,
            retry_after=None,
        )
        result = provider.discover_after(42, datetime.fromtimestamp(1_800_000_000, timezone.utc), None)
        self.assertIsNone(result.match)
        self.assertIn("сохранённую историю", result.reason)



class CatalogueTests(unittest.TestCase):
    def test_user_facing_drop_chances_are_estimated_and_rarity_ordered(self) -> None:
        rarity_average = {}
        for rarity in ("COMMON", "UNCOMMON", "RARE", "EPIC"):
            values = [float(item["drop_chance_pct"]) for item in MISSIONS_V2 if item["rarity"] == rarity]
            self.assertTrue(values)
            self.assertTrue(all(0 < value <= 100 for value in values))
            rarity_average[rarity] = sum(values) / len(values)
        self.assertGreater(rarity_average["COMMON"], rarity_average["UNCOMMON"])
        self.assertGreater(rarity_average["UNCOMMON"], rarity_average["RARE"])
        self.assertGreater(rarity_average["RARE"], rarity_average["EPIC"])



class ConfigurationTests(unittest.TestCase):
    def test_production_fail_closed_validation(self) -> None:
        production = replace(
            settings,
            app_env="production",
            app_base_url="https://contracts.example.com",
            contact_email="privacy@example.com",
            database_url="postgresql+psycopg://user:pass@db/app",
            session_secret="a-unique-production-secret-that-is-long-enough-2026",
            cookie_secure=True,
            trusted_hosts=("contracts.example.com",),
            docs_enabled=False,
            allow_demo_auth=False,
            allow_dev_endpoints=False,
            provider="deadlock_api",
            rate_limit_redis_url="redis://redis:6379/0",
        )
        production.validate()
        with self.assertRaises(RuntimeError):
            replace(production, cookie_secure=False).validate()
        with self.assertRaises(RuntimeError):
            replace(production, app_base_url="http://contracts.example.com").validate()
        with self.assertRaises(RuntimeError):
            replace(production, allow_demo_auth=True).validate()
        with self.assertRaises(RuntimeError):
            replace(production, trusted_hosts=("*",)).validate()
        with self.assertRaises(RuntimeError):
            replace(production, trusted_proxy_networks=("0.0.0.0/0",)).validate()
        with self.assertRaises(RuntimeError):
            replace(production, trusted_proxy_networks=("not-a-network",)).validate()
        with self.assertRaises(RuntimeError):
            replace(production, companion_minimum_version="latest").validate()


class EndToEndTests(unittest.TestCase):

    def test_outbox_health_reports_pending_retry_and_dead_letter(self) -> None:
        with TestClient(app):
            now = utcnow()

            with SessionLocal() as db:
                before = _outbox_health(db, now)

                pending = OutboxEvent(
                    event_type="test.pending",
                    aggregate_id="outbox-health-pending",
                    payload={},
                    attempts=0,
                    run_after=now,
                    created_at=now - timedelta(seconds=30),
                )

                retrying = OutboxEvent(
                    event_type="test.retry",
                    aggregate_id="outbox-health-retry",
                    payload={},
                    attempts=2,
                    run_after=now + timedelta(minutes=1),
                    created_at=now - timedelta(seconds=20),
                )

                dead = OutboxEvent(
                    event_type="test.dead",
                    aggregate_id="outbox-health-dead",
                    payload={},
                    attempts=OUTBOX_MAX_ATTEMPTS,
                    run_after=now,
                    dead_lettered_at=now,
                    created_at=now - timedelta(seconds=10),
                )

                db.add_all([pending, retrying, dead])
                db.commit()

                ids = [pending.id, retrying.id, dead.id]

                try:
                    after = _outbox_health(db, now)

                    assert after["pending"] == before["pending"] + 1
                    assert after["retrying"] == before["retrying"] + 1
                    assert after["dead_letter"] == before["dead_letter"] + 1

                    assert after["oldest_pending_seconds"] is not None
                    assert after["oldest_pending_seconds"] >= 20

                finally:
                    db.query(OutboxEvent).filter(
                        OutboxEvent.id.in_(ids)
                    ).delete(synchronize_session=False)

                    db.commit()

    def test_outbox_poison_event_moves_to_dead_letter_after_retry_budget(self) -> None:
        with TestClient(app):
            with SessionLocal() as db:
                event = OutboxEvent(
                    event_type="assignment.settled",
                    aggregate_id="dead-letter-test",
                    payload={
                        "status": "COMPLETED",
                        "reward_xp": 100,
                        "assignment_id": "dead-letter-assignment",
                        "user_id": "00000000-0000-0000-0000-000000000000",
                    },
                    attempts=OUTBOX_MAX_ATTEMPTS - 1,
                    run_after=utcnow() - timedelta(seconds=1),
                )

                db.add(event)
                db.commit()
                event_id = event.id

                assert dispatch_outbox(db) is True

                db.expire_all()
                event = db.get(OutboxEvent, event_id)

                assert event is not None
                assert event.attempts == OUTBOX_MAX_ATTEMPTS
                assert event.published_at is None
                assert event.dead_lettered_at is not None
                assert event.last_error

                db.delete(event)
                db.commit()

    def test_outbox_poison_event_retries_without_starving_newer_event(self) -> None:
        with TestClient(app):
            now = utcnow()

            with SessionLocal() as db:
                poison = OutboxEvent(
                    event_type="assignment.settled",
                    aggregate_id="poison-outbox-test",
                    payload={
                        "status": "COMPLETED",
                        "reward_xp": 100,
                        "assignment_id": "poison-assignment",
                        "user_id": "00000000-0000-0000-0000-000000000000",
                    },
                    run_after=now,
                    created_at=now,
                )

                healthy = OutboxEvent(
                    event_type="assignment.settled",
                    aggregate_id="healthy-outbox-test",
                    payload={
                        "status": "FAILED",
                        "reward_xp": 0,
                        "assignment_id": "healthy-assignment",
                        "user_id": "00000000-0000-0000-0000-000000000000",
                    },
                    run_after=now,
                    created_at=now + timedelta(seconds=1),
                )

                db.add_all([poison, healthy])
                db.commit()

                poison_id = poison.id
                healthy_id = healthy.id

                assert dispatch_outbox(db) is True

                db.expire_all()
                poison = db.get(OutboxEvent, poison_id)
                healthy = db.get(OutboxEvent, healthy_id)

                assert poison is not None
                assert poison.attempts == 1
                assert poison.published_at is None
                assert poison.dead_lettered_at is None
                assert poison.run_after is not None

                run_after = poison.run_after
                if run_after.tzinfo is None:
                    run_after = run_after.replace(tzinfo=timezone.utc)

                assert run_after > now

                assert healthy is not None
                assert healthy.published_at is None

                # Poison is delayed, so the newer healthy event can proceed.
                assert dispatch_outbox(db) is True

                db.expire_all()
                healthy = db.get(OutboxEvent, healthy_id)

                assert healthy is not None
                assert healthy.published_at is not None

                db.query(OutboxEvent).filter(
                    OutboxEvent.id.in_([poison_id, healthy_id])
                ).delete(synchronize_session=False)

                db.commit()

    def test_suspended_user_cannot_reactivate_via_steam_callback(self) -> None:
        steam_id64 = 76561198765432100

        with TestClient(app) as client:
            with SessionLocal() as db:
                user = User(
                    steam_id64=steam_id64,
                    account_id=steam_id64 - 76561197960265728,
                    display_name="Suspended Steam User",
                    status="SUSPENDED",
                )
                db.add(user)
                db.commit()
                db.refresh(user)
                user_id = user.id

            with (
                patch("app.main.verify_steam_callback", return_value=steam_id64),
                patch(
                    "app.services.auth.fetch_steam_profile",
                    return_value=("Suspended Steam User Updated", None),
                ),
            ):
                response = client.get(
                    "/auth/steam/callback",
                    follow_redirects=False,
                )

            self.assertEqual(response.status_code, 303)
            self.assertIn(
                "auth_error=account_suspended",
                response.headers["location"],
            )

            with SessionLocal() as db:
                user = db.get(User, user_id)
                self.assertIsNotNone(user)
                self.assertEqual(user.status, "SUSPENDED")
                self.assertEqual(
                    user.display_name,
                    "Suspended Steam User Updated",
                )

                sessions = (
                    db.query(SessionToken)
                    .filter(SessionToken.user_id == user_id)
                    .count()
                )
                self.assertEqual(sessions, 0)

    def _drain_worker(self) -> None:

        # Initial discover may be retried before the explicit mock bind job.
        for _ in range(30):
            with SessionLocal() as db:
                job = claim_next_job(db, "unittest")
                if job:
                    try:
                        process_job(db, job)
                        complete_job(db, job)
                    except (NoMatchYet, CompanionMatchNotReady) as exc:
                        retry_job(db, job, exc, 3600)
            with SessionLocal() as db:
                while dispatch_outbox(db):
                    pass

    def test_demo_contract_flow_is_idempotent(self) -> None:
        with TestClient(app) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.headers.get("x-content-type-options"), "nosniff")
            self.assertEqual(health.headers.get("x-frame-options"), "DENY")
            self.assertIn("default-src 'self'", health.headers.get("content-security-policy", ""))
            self.assertEqual(client.get("/api/not-a-real-route").status_code, 404)
            login = client.post("/api/auth/demo")
            self.assertEqual(login.status_code, 200)
            me = client.get("/api/me").json()
            csrf_headers = {"X-CSRF-Token": me["csrf_token"]}

            board = client.get("/api/board/today").json()
            self.assertEqual(board["status"], "OFFERED")
            self.assertEqual(len(board["options"]), 6)

            # Contracts 2.0 boards are dynamic. Pick three contracts that the
            # deterministic "success" fixture actually satisfies instead of
            # assuming the first three random contracts always do.
            success_values = {
                "match.win": 1.0,
                "player.kills": 30.0,
                "player.deaths": 2.0,
                "player.assists": 30.0,
                "player.kda": 20.0,
                "player.net_worth": 65000.0,
                "player.hero_damage": 70000.0,
                "player.object_damage": 25000.0,
                "player.healing": 18000.0,
                "match.duration_s": 1950.0,
            }

            def fixture_passes(item: dict) -> bool:
                conditions = item.get("conditions") or [{
                    "metric": item.get("metric"),
                    "operator": item.get("operator"),
                    "target": item.get("target"),
                }]
                for condition in conditions:
                    metric = str(condition.get("metric") or "")
                    current = success_values.get(metric)
                    if current is None:
                        return False
                    target = float(condition.get("target"))
                    operator = str(condition.get("operator") or "")
                    if operator == "gte" and not current >= target:
                        return False
                    if operator == "lte" and not current <= target:
                        return False
                    if operator == "eq" and not current == target:
                        return False
                return True

            eligible = [item for item in board["options"] if fixture_passes(item)]
            self.assertGreaterEqual(len(eligible), 3)
            option_ids = [item["id"] for item in eligible[:3]]
            rejected = client.post("/api/board/today/lock", json={"option_ids": option_ids})
            self.assertEqual(rejected.status_code, 403)

            locked = client.post("/api/board/today/lock", json={"option_ids": option_ids}, headers=csrf_headers)
            self.assertEqual(locked.status_code, 200)
            self.assertEqual(locked.json()["status"], "LOCKED")

            created = client.post("/api/dev/mock-match", json={"scenario": "success"}, headers=csrf_headers)
            self.assertEqual(created.status_code, 200)
            self._drain_worker()

            final_board = client.get("/api/board/today").json()
            selected = [item for item in final_board["options"] if item["selected"]]
            self.assertEqual(final_board["status"], "SETTLED")
            self.assertTrue(all(item["status"] == "COMPLETED" for item in selected))

            ledger_before = client.get("/api/xp-ledger").json()
            self.assertGreater(ledger_before["balance"], 0)
            self.assertEqual(len(ledger_before["items"]), 3)

            # Re-running available work/outbox must not duplicate rewards.
            self._drain_worker()
            ledger_after = client.get("/api/xp-ledger").json()
            self.assertEqual(ledger_after["balance"], ledger_before["balance"])
            self.assertEqual(len(ledger_after["items"]), len(ledger_before["items"]))

    def test_00_three_mode_boards_and_single_daily_reroll(self) -> None:
        with TestClient(app) as client:
            client.post("/api/auth/demo")
            me = client.get("/api/me").json()
            headers = {"X-CSRF-Token": me["csrf_token"]}
            payload = client.get("/api/boards/today").json()
            self.assertEqual({item["game_match_mode"] for item in payload["boards"]}, {"STANDARD", "RANKED", "STREET_BRAWL"})
            self.assertTrue(all(len(item["options"]) == 6 for item in payload["boards"]))
            self.assertEqual(payload["refresh"]["remaining"], 1)
            before = next(item for item in payload["boards"] if item["game_match_mode"] == "RANKED")
            rerolled = client.post("/api/boards/RANKED/reroll", headers=headers)
            self.assertEqual(rerolled.status_code, 200)
            self.assertEqual(rerolled.json()["refresh"]["remaining"], 0)
            self.assertEqual(rerolled.json()["board"]["generation"], before["generation"] + 1)
            denied = client.post("/api/boards/STREET_BRAWL/reroll", headers=headers)
            self.assertEqual(denied.status_code, 409)

    def test_auto_review_replaces_user_manual_evidence(self) -> None:
        with TestClient(app) as client:
            client.post("/api/auth/demo")
            me = client.get("/api/me").json()
            headers = {"X-CSRF-Token": me["csrf_token"]}
            ranked = client.get("/api/board/today?mode=RANKED").json()
            if ranked["status"] == "OFFERED":
                option_id = ranked["options"][0]["id"]
                locked = client.post("/api/board/today/lock", json={"option_ids": [option_id], "mode": "RANKED"}, headers=headers)
                self.assertEqual(locked.status_code, 200)
                client.post("/api/dev/mock-match", json={"scenario": "missing_data", "mode": "RANKED"}, headers=headers)
                self._drain_worker()
            ranked_after = client.get("/api/board/today?mode=RANKED").json()
            self.assertEqual(ranked_after["status"], "REVIEW_REQUIRED")
            reviews = client.get("/api/reviews/mine").json()["items"]
            self.assertTrue(any(item["board_id"] == ranked_after["id"] and item["status"] == "PENDING" for item in reviews))
            legacy = client.get("/api/verification/options").json()
            self.assertFalse(legacy["manual"]["enabled"])
            progression = client.get("/api/progression").json()
            self.assertGreaterEqual(progression["level"], 1)
            self.assertIn("mode_stats", progression)

    def test_companion_pairing_and_heartbeat_bridge(self) -> None:
        with TestClient(app) as client:
            client.post("/api/auth/demo")
            me = client.get("/api/me").json()
            headers = {"X-CSRF-Token": me["csrf_token"]}
            street = client.get("/api/board/today?mode=STREET_BRAWL").json()
            if street["status"] == "OFFERED":
                locked = client.post(
                    "/api/board/today/lock",
                    json={"option_ids": [street["options"][0]["id"]], "mode": "STREET_BRAWL"},
                    headers=headers,
                )
                self.assertEqual(locked.status_code, 200)
            pairing = client.post("/api/companion/pairing/start", headers=headers)
            self.assertEqual(pairing.status_code, 200)
            code = pairing.json()["code"]

            claimed = client.post(
                "/api/companion/pairing/claim",
                json={"code": code, "device_id": "unittest-device-0001", "label": "Unit Test Companion", "version": "0.1.0"},
                headers={"Origin": "www.overwolf.com://deadlockcontracts"},
            )
            self.assertEqual(claimed.status_code, 200)
            token = claimed.json()["token"]
            bearer = {"Authorization": f"Bearer {token}", "Origin": "www.overwolf.com://deadlockcontracts"}

            second_claim = client.post(
                "/api/companion/pairing/claim",
                json={"code": code, "device_id": "unittest-device-0002", "label": "Second", "version": "0.1.0"},
            )
            self.assertEqual(second_claim.status_code, 410)

            heartbeat = client.post(
                "/api/companion/heartbeat",
                json={
                    "game_running": True,
                    "steam_id64": 76561198083722456,
                    "phase": "GameInProgress",
                    "game_mode": {"match_mode": "Street Brawl", "game_mode": "Brawl"},
                    "match_id": 98404528,
                    "gep_version": "310.2.10",
                    "version": "0.4.0-alpha.4",
                    "live_stats": {"hero_id": 10, "kills": 9, "deaths": 7, "assists": 26, "hero_damage": 65116, "object_damage": 15439, "healing": 1143, "souls": 69955},
                    "session_id": "session-0123456789abcdef01234567",
                    "session_started_at": "2026-08-15T00:00:00.000Z",
                    "session_ended_at": None,
                    "session_start_reason": "phase_game_in_progress",
                    "session_end_reason": None,
                    "match_clock_s": 321,
                    "match_clock_observed_at": "2026-08-15T00:05:21.000Z",
                    "local_team": "AMBER",
                    "match_outcome": None,
                    "event_type": "match_started",
                },
                headers=bearer,
            )
            self.assertEqual(heartbeat.status_code, 200)
            status_payload = client.get("/api/companion/status").json()
            status = status_payload["device"]
            self.assertEqual(len(status_payload["devices"]), 1)
            device_record_id = status_payload["devices"][0]["id"]
            self.assertTrue(status["paired"])
            self.assertTrue(status["online"])
            self.assertTrue(status["game_running"])
            self.assertEqual(status["game_match_mode"], "STREET_BRAWL")
            self.assertEqual(status["current_match_id"], "98404528")
            self.assertTrue(status["identity_ok"])
            # Live GameInProgress snapshots are evidence only. They must never
            # start final match resolution before an explicit finality signal.
            self.assertNotIn("direct_match_boards", heartbeat.json())
            with SessionLocal() as db:
                from app.models import CompanionEvent, CompanionMatchEvidence, Job
                evidence = db.query(CompanionMatchEvidence).filter_by(external_match_id=98404528).one()
                self.assertEqual(evidence.object_damage, 15439)
                event = db.query(CompanionEvent).filter_by(external_match_id=98404528).order_by(CompanionEvent.created_at.desc()).first()
                self.assertIsNotNone(event)
                self.assertEqual(event.payload["session"]["id"], "session-0123456789abcdef01234567")
                self.assertEqual(event.payload["session"]["match_clock_s"], 321)
                self.assertEqual(event.payload["session"]["local_team"], "AMBER")
                premature = [
                    job for job in db.query(Job).all()
                    if str((job.payload or {}).get("external_match_id")) == "98404528"
                    and job.type in {"resolve_companion_match", "resolve_companion_match_auto"}
                ]
                self.assertEqual(premature, [])

            finished = client.post(
                "/api/companion/heartbeat",
                json={
                    "game_running": True,
                    "steam_id64": 76561198083722456,
                    "phase": "PostGame",
                    "game_mode": {"match_mode": "Street Brawl", "game_mode": "Brawl"},
                    "match_id": 98404528,
                    "gep_version": "310.2.10",
                    "version": "0.4.0-alpha.4",
                    "live_stats": {"hero_id": 10, "kills": 9, "deaths": 7, "assists": 26, "hero_damage": 65116, "object_damage": 15439, "healing": 1143, "souls": 69955},
                    "session_id": "session-0123456789abcdef01234567",
                    "session_started_at": "2026-08-15T00:00:00.000Z",
                    "session_ended_at": "2026-08-15T00:20:00.000Z",
                    "session_start_reason": "phase_game_in_progress",
                    "session_end_reason": "match_end",
                    "match_clock_s": 1200,
                    "match_clock_observed_at": "2026-08-15T00:20:00.000Z",
                    "local_team": "AMBER",
                    "match_outcome": "AMBER",
                    "event_type": "match_ended",
                },
                headers=bearer,
            )
            self.assertEqual(finished.status_code, 200)
            with SessionLocal() as db:
                from app.models import Job
                final_jobs = [
                    job for job in db.query(Job).filter_by(type="resolve_companion_match_auto").all()
                    if str((job.payload or {}).get("external_match_id")) == "98404528"
                ]
                self.assertEqual(len(final_jobs), 1)
                self.assertTrue((final_jobs[0].payload or {}).get("final_signal"))
                self.assertIn("final-v3", final_jobs[0].idempotency_key)

            unknown_heartbeat = client.post(
                "/api/companion/heartbeat",
                json={
                    "game_running": True,
                    "steam_id64": 76561198083722456,
                    "phase": None,
                    "game_mode": None,
                    "match_id": 98409999,
                    "gep_version": "310.2.10",
                    "version": "0.2.1",
                    "live_stats": {"kills": 5, "deaths": 2, "assists": 7, "object_damage": 4321},
                    "event_type": "heartbeat",
                },
                headers=bearer,
            )
            self.assertEqual(unknown_heartbeat.status_code, 200)
            with SessionLocal() as db:
                from app.models import CompanionMatchEvidence, Job
                evidence = db.query(CompanionMatchEvidence).filter_by(external_match_id=98409999).one()
                self.assertEqual(evidence.object_damage, 4321)
                self.assertEqual(evidence.game_match_mode, "UNKNOWN")
                auto = [job for job in db.query(Job).filter_by(type="resolve_companion_match_auto").all() if str((job.payload or {}).get("external_match_id")) == "98409999"]
                self.assertEqual(auto, [])

            hello = client.get("/api/companion/hello", headers=bearer)
            self.assertEqual(hello.status_code, 200)
            bootstrap = client.get("/api/desktop/v1/bootstrap", headers=bearer)
            self.assertEqual(bootstrap.status_code, 200)
            self.assertNotIn("desktop_ads_v1", bootstrap.json()["desktop_features"])

            revoked_device = client.post(
                f"/api/companion/devices/{device_record_id}/revoke",
                headers=headers,
            )
            self.assertEqual(revoked_device.status_code, 200)
            self.assertEqual(client.get("/api/companion/hello", headers=bearer).status_code, 401)

            replacement_code = client.post("/api/companion/pairing/start", headers=headers).json()["code"]
            replacement = client.post(
                "/api/companion/pairing/claim",
                json={
                    "code": replacement_code,
                    "device_id": "unittest-device-0001",
                    "label": "Unit Test Companion",
                    "version": "0.5.2-alpha.6",
                },
            )
            self.assertEqual(replacement.status_code, 200)
            replacement_bearer = {"Authorization": f"Bearer {replacement.json()['token']}"}
            revoked = client.post("/api/companion/revoke", headers=headers)
            self.assertEqual(revoked.status_code, 200)
            self.assertEqual(client.get("/api/companion/hello", headers=replacement_bearer).status_code, 401)

    def test_request_guards_and_cookie_attributes(self) -> None:
        with TestClient(app) as client:
            oversized = client.post(
                "/api/auth/demo", content=b"x" * (settings.max_request_body_bytes + 1)
            )
            self.assertEqual(oversized.status_code, 413)
            oversized_error = oversized.json()
            self.assertEqual(oversized_error["code"], "PAYLOAD_TOO_LARGE")
            self.assertEqual(oversized_error["message_key"], "errors.payload_too_large")
            self.assertTrue(oversized_error["request_id"])

            login = client.post("/api/auth/demo")
            self.assertEqual(login.status_code, 200)
            cookie = login.headers.get("set-cookie", "")
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=lax", cookie)

            me = client.get("/api/me").json()
            headers = {"X-CSRF-Token": me["csrf_token"]}
            with patch(
                "app.main.settings",
                replace(settings, companion_ingest_enabled=False),
            ):
                ingest_disabled = client.post("/api/companion/pairing/start", headers=headers)
            self.assertEqual(ingest_disabled.status_code, 503)
            self.assertEqual(ingest_disabled.json()["code"], "COMPANION_INGEST_DISABLED")
            with patch(
                "app.main.settings",
                replace(settings, companion_minimum_version="0.5.2-alpha.7"),
            ):
                update_required = client.post(
                    "/api/companion/pairing/claim",
                    json={
                        "code": "ABCD-EFGH",
                        "device_id": "outdated-device",
                        "label": "Outdated Companion",
                        "version": "0.5.2-alpha.6",
                    },
                )
            self.assertEqual(update_required.status_code, 426)
            self.assertEqual(update_required.json()["code"], "COMPANION_UPDATE_REQUIRED")
            self.assertEqual(update_required.headers["x-minimum-companion-version"], "0.5.2-alpha.7")
            foreign_origin = client.post(
                "/api/matches/sync",
                headers={**headers, "Origin": "https://attacker.example"},
            )
            self.assertEqual(foreign_origin.status_code, 403)

            board = client.get("/api/board/today").json()
            bad_payload = client.post(
                "/api/board/today/lock",
                json={"option_ids": [board["options"][0]["id"]], "admin": True},
                headers=headers,
            )
            self.assertEqual(bad_payload.status_code, 422)
            bad_error = bad_payload.json()
            self.assertEqual(bad_error["code"], "VALIDATION_FAILED")
            self.assertEqual(bad_error["message_key"], "errors.validation_failed")
            self.assertTrue(bad_error["request_id"])
            missing_api = client.get("/api/definitely-missing", headers={"Accept-Language": "en"})
            self.assertEqual(missing_api.status_code, 404)
            self.assertEqual(missing_api.json()["code"], "NOT_FOUND")
            self.assertEqual(missing_api.json()["message"], "API endpoint not found")
            self.assertTrue(missing_api.json()["request_id"])
            csp = client.get("/").headers["content-security-policy"]
            self.assertIn("https://*.steamusercontent.com", csp)
            self.assertIn("https://*.steamstatic.com", csp)
            self.assertEqual(client.get("/openapi.json").status_code, 200)  # enabled only in tests/development

    def test_localized_legal_and_machine_readable_discovery_routes(self) -> None:
        with TestClient(app) as client:
            english = client.get("/en/privacy")
            russian = client.get("/ru/privacy")
            negotiated = client.get("/privacy", headers={"Accept-Language": "en-US,en;q=0.9"})
            robots = client.get("/robots.txt")
            sitemap = client.get("/sitemap.xml")
            public_status = client.get("/api/status").json()

            self.assertEqual(english.status_code, 200)
            self.assertIn('<html lang="en">', english.text)
            self.assertIn("Data processing", english.text)
            self.assertIn("Политика конфиденциальности", russian.text)
            self.assertIn("Data processing", negotiated.text)
            self.assertTrue(robots.headers["content-type"].startswith("text/plain"))
            self.assertIn("Sitemap:", robots.text)
            self.assertTrue(sitemap.headers["content-type"].startswith("application/xml"))
            self.assertIn("<urlset", sitemap.text)
            self.assertEqual(public_status["components"]["companion_ingest"], "operational")
            self.assertEqual(public_status["components"]["reward_delivery"], "operational")
            self.assertEqual(public_status["components"]["companion_ads"], "disabled")


if __name__ == "__main__":
    unittest.main()
