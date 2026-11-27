import json
import ssl
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request

from relay import manager, protocol, publisher, steam_friends


NOW = datetime(2026, 11, 27, 10, tzinfo=timezone.utc)
ONE = "00000000-0000-4000-8000-000000000001"
TWO = "00000000-0000-4000-8000-000000000002"


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.snapshot = self.root / "status.json"
        self.state = self.root / "delivery.json"
        self.manual = self.root / "friends.json"
        self.client = Mock()

    def status(self, observed=NOW):
        protocol.atomic_json(self.snapshot, {
            "container_status": "running", "gc_logs": "recent", "observed_at": observed.isoformat(),
            "last_metadata_quota_signal_at": observed.isoformat(),
            "raw_log": "should never leave host", "metrics": {"cpu_percent": 1.2, "ram_bytes": 42, "raw": "discard"},
        })

    def cycle(self, **kwargs):
        return manager.Manager(self.client, self.state, self.snapshot, self.manual, **kwargs)

    def test_publisher_exports_typed_docker_data(self):
        status = {
            "checked_at": NOW.isoformat(), "container_status": "running", "gc_logs": "recent",
            "container": "name", "raw": "private", "last_salt_upload": {"at": NOW.isoformat(), "count": 4},
        }
        with patch.object(publisher.contract_relay_status, "check", return_value=(status, 0)):
            with patch.object(publisher.contract_relay_status, "docker", return_value=subprocess.CompletedProcess(
                ["docker"], 0, "101.02%\t1.5MiB / 7.6GiB\n",
            )) as docker:
                publisher.publish("container", self.snapshot)
        observed = protocol.read_json(self.snapshot)
        self.assertEqual(observed["last_salt_upload"]["count"], 4)
        self.assertEqual(observed["metrics"], {"cpu_percent": 101.02, "ram_bytes": 1_572_864})
        self.assertNotIn("raw", observed)
        self.assertNotIn("container", observed)
        self.assertEqual(docker.call_args.args[:2], ("stats", "--no-stream"))

    def test_stale_snapshot_and_heartbeat_only(self):
        self.status(observed=NOW - timedelta(minutes=5))
        self.cycle(heartbeat_only=True).tick(NOW)
        self.client.request.assert_called_once()
        path, heartbeat = self.client.request.call_args.args
        self.assertEqual(path, "/heartbeat")
        self.assertEqual(heartbeat["events"], ["host_snapshot_unavailable"])
        self.assertEqual(heartbeat["ingest"], {"container_status": "unknown", "gc_logs": "unavailable"})

    def test_pending_heartbeat_retries_after_restart(self):
        self.status()
        client = self.client
        client.request.side_effect = protocol.RequestFailed(503, 120)
        delay = self.cycle(heartbeat_only=True).tick(NOW)
        self.assertEqual(delay, 120)
        original = client.request.call_args.args
        self.assertNotIn("raw", json.dumps(original))
        self.assertNotIn("raw", self.state.read_text())
        client.reset_mock(side_effect=True)
        restarted = self.cycle(heartbeat_only=True)
        self.assertEqual(restarted.tick(NOW + timedelta(seconds=1)), 119)
        client.request.assert_not_called()
        self.assertEqual(restarted.tick(NOW + timedelta(seconds=120)), 60)
        client.request.assert_called_once_with(*original)
        self.assertNotIn("pending", protocol.read_json(self.state))

    def test_bad_request_heartbeat_is_not_repeated_forever(self):
        self.client.request.side_effect = protocol.RequestFailed(422)
        self.cycle(heartbeat_only=True).tick(NOW)
        self.assertNotIn("pending", protocol.read_json(self.state))

    def test_participant_pages_gate_current_consent(self):
        self.status()
        protocol.atomic_json(self.manual, {"observations": [
            {"connection_id": ONE, "observed_at": NOW.isoformat(), "state": "connected"},
            {"connection_id": TWO, "observed_at": NOW.isoformat(), "state": "unknown"},
        ]})

        def reply(path, payload=None, after=None):
            if path == "/participants":
                rows = [{"connection_id": ONE, "steam_id64": "76561198000000111"}] if after is None else []
                return {"participants": rows, "next_cursor": ONE if after is None else None}
            return {"applied": 1}

        self.client.request.side_effect = reply
        self.cycle().tick(NOW)
        calls = self.client.request.call_args_list
        self.assertEqual(calls[1].kwargs["after"], ONE)
        self.assertEqual(calls[2].args[1]["observations"], [
            {"connection_id": ONE, "observed_at": NOW.isoformat(), "state": "connected", "source": "manual"},
        ])
        self.assertNotIn("steam_id64", self.state.read_text())
        self.assertNotIn(ONE, self.state.read_text())
        self.client.request.reset_mock()
        self.cycle().tick(NOW + timedelta(seconds=60))
        self.assertNotIn("/friendship-status", [call.args[0] for call in self.client.request.call_args_list])

    def test_unauthorized_participant_read_still_reports_heartbeat(self):
        self.status()
        protocol.atomic_json(self.manual, {"observations": []})
        self.client.request.side_effect = [protocol.RequestFailed(403), {"applied": 1}]
        self.cycle().tick(NOW)
        self.assertEqual(self.client.request.call_args.args[1]["events"], ["participant_sync_failed"])

    def test_rate_limit_delays_other_requests(self):
        self.status()
        protocol.atomic_json(self.manual, {"observations": []})
        self.client.request.side_effect = protocol.RequestFailed(429, 499)
        self.assertEqual(self.cycle().tick(NOW), 499)
        self.client.request.assert_called_once_with("/participants", after=None)
        self.assertIn("pending", protocol.read_json(self.state))

    def test_expired_manual_observation_does_not_count(self):
        protocol.atomic_json(self.manual, {"observations": [
            {"connection_id": ONE, "observed_at": (NOW - timedelta(days=1)).isoformat(), "state": "connected"},
        ]})
        self.assertEqual(manager.manual_observations(self.manual, NOW), [])

    def test_steam_sync_submits_only_consented_connections_and_persists_its_interval(self):
        self.status()
        protocol.atomic_json(self.manual, {"observations": []})
        self.client.request.side_effect = lambda path, payload=None, after=None: (
            {"participants": [
                {"connection_id": ONE, "steam_id64": "76561198000000111"},
                {"connection_id": TWO, "steam_id64": "76561198000000222"},
            ], "next_cursor": None} if path == "/participants" else {"applied": 2}
        )
        steam = Mock()
        steam.friend_ids.return_value = {"76561198000000111", "76561198000000333"}
        self.cycle(steam=steam).tick(NOW)
        submitted = next(call.args[1] for call in self.client.request.call_args_list if call.args[0] == "/friendship-status")
        self.assertEqual(submitted["observations"], [
            {"connection_id": ONE, "observed_at": NOW.isoformat(), "state": "connected", "source": "steam_web_api"},
            {"connection_id": TWO, "observed_at": NOW.isoformat(), "state": "disconnected", "source": "steam_web_api"},
        ])
        state = self.state.read_text()
        for private in (ONE, TWO, "76561198"):
            self.assertNotIn(private, state)
        self.cycle(steam=steam).tick(NOW + timedelta(minutes=1))
        steam.friend_ids.assert_called_once_with()

    def test_unavailable_steam_preserves_manual_observation_and_honors_retry_after(self):
        self.status()
        protocol.atomic_json(self.manual, {"observations": [
            {"connection_id": ONE, "observed_at": NOW.isoformat(), "state": "connected"},
        ]})
        self.client.request.side_effect = lambda path, payload=None, after=None: (
            {"participants": [{"connection_id": ONE, "steam_id64": "76561198000000111"}], "next_cursor": None}
            if path == "/participants" else {"applied": 1}
        )
        steam = Mock()
        steam.friend_ids.side_effect = protocol.RequestFailed(429, 7200)
        self.assertEqual(self.cycle(steam=steam).tick(NOW), 60)
        self.assertEqual(self.client.request.call_args.args[1]["events"], ["friendship_sync_failed"])
        submitted = [call.args[1] for call in self.client.request.call_args_list if call.args[0] == "/friendship-status"]
        self.assertEqual(len(submitted), 1)
        self.assertEqual(submitted[0]["observations"][0]["source"], "manual")
        self.cycle(steam=steam).tick(NOW + timedelta(hours=1, seconds=1))
        steam.friend_ids.assert_called_once_with()

    def test_steam_client_requests_public_api_and_accepts_only_a_complete_friend_list(self):
        key = "a" * 32
        key_file = self.root / "steam-key"
        key_file.write_text(key)
        steam = steam_friends.SteamFriends("76561198000000444", key_file)
        with patch.object(steam.opener, "open") as open_request:
            response = open_request.return_value.__enter__.return_value
            response.read.return_value = b'{"friendslist":{"friends":[{"steamid":"76561198000000555","relationship":"friend"}]}}'
            self.assertEqual(steam.friend_ids(), {"76561198000000555"})
            self.assertEqual(open_request.call_args.args[0].full_url,
                             "https://api.steampowered.com/ISteamUser/GetFriendList/v1/?steamid=76561198000000444&relationship=friend")
            self.assertEqual(open_request.call_args.args[0].get_header("X-webapi-key"), key)
            response.read.return_value = b'{"friendslist":{"friends":[]}}'
            self.assertEqual(steam.friend_ids(), set())
            for invalid in (b'<html>', b'{}', b'{"friendslist":{}}', b'{"friendslist":{"friends":[{}]}}'):
                response.read.return_value = invalid
                with self.assertRaises(protocol.RequestFailed):
                    steam.friend_ids()
            open_request.side_effect = HTTPError("", 401, "private", {}, None)
            with self.assertRaises(protocol.RequestFailed) as error:
                steam.friend_ids()
            self.assertEqual(error.exception.status, 401)

    def test_https_transport_uses_certificate_validation_and_no_redirect(self):
        token_path = self.root / "token"
        token_path.write_text("mcg." + "a" * 43)
        for bad in ("http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid/extra"):
            with self.assertRaises(ValueError):
                protocol.RelayClient(bad, token_path)
        client = protocol.RelayClient("https://example.invalid", token_path)
        https = next(handler for handler in client.opener.handlers if isinstance(handler, protocol.HTTPSHandler))
        self.assertEqual(https._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(https._context.check_hostname)
        redirect = next(handler for handler in client.opener.handlers if isinstance(handler, protocol.NoRedirect))
        self.assertIsNone(redirect.redirect_request(Request(client.origin), None, 302, "", {}, "https://other.invalid"))
        with patch.object(client.opener, "open") as open_request:
            open_request.return_value.__enter__.return_value.read.return_value = b'{"protocol_version":1,"applied":1}'
            result = client.request("/heartbeat", {"protocol_version": 1})
        request = open_request.call_args.args[0]
        self.assertEqual(result["applied"], 1)
        self.assertEqual(request.full_url, "https://example.invalid/api/internal/relay/v1/heartbeat")
        self.assertEqual(request.get_header("Authorization"), "Bearer " + token_path.read_text())


if __name__ == "__main__":
    unittest.main()
