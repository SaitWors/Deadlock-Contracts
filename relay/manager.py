"""Run the outbound Contract Relay connection from the Ingest host."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .protocol import (
    DOCKER_ERRORS, FRIEND_STATES, PROTOCOL, RelayClient, RequestFailed, atomic_json,
    identifier, ingest_snapshot, read_json, utc,
)
from .steam_friends import STEAM_ID64_BASE, SteamFriends, SteamRelationships, SteamSession, steam_id64

AGENT_VERSION = "1.2.0"
INTERVAL = 60
STEAM_INTERVAL = 60 * 60
MAX_RETRY = 15 * 60
MAX_REPORT_AGE = timedelta(hours=23)
MAX_MANUAL_AGE = timedelta(hours=23)
MAX_PARTICIPANT_PAGES = 20
COLLECTOR_TTL = 120
MAX_ADMISSION_CHECKS = 10
MAX_ACCEPTS = 3
EVENTS = {
    "host_snapshot_invalid", "host_snapshot_unavailable", "participant_sync_failed", "friendship_sync_failed",
    "steam_enrollment_failed",
}


def encode_heartbeat(document: dict) -> dict:
    events = document["events"]
    if not isinstance(events, list) or not set(events) <= EVENTS:
        raise ValueError("invalid event codes")
    payload = {
        "protocol_version": PROTOCOL,
        "agent_version": AGENT_VERSION,
        "observed_at": utc(document["observed_at"]).isoformat(),
        "ingest": ingest_snapshot(document["ingest"]),
        "events": sorted(set(events)),
    }
    error = document["ingest"].get("error")
    if isinstance(error, str) and error in DOCKER_ERRORS:
        payload["ingest"]["error"] = error
    if "last_successful_cycle_at" in document:
        payload["last_successful_cycle_at"] = utc(document["last_successful_cycle_at"]).isoformat()
    return payload


def host_snapshot(path: Path, now: datetime) -> tuple[dict, str | None]:
    unavailable = {"container_status": "unknown", "gc_logs": "unavailable"}
    try:
        snapshot = read_json(path)
        observed = utc(snapshot.get("observed_at"))
        if observed > now or now - observed > timedelta(minutes=4):
            return unavailable, "host_snapshot_unavailable"
        result = ingest_snapshot(snapshot)
        error = snapshot.get("error")
        if isinstance(error, str) and error in DOCKER_ERRORS:
            result["error"] = error
        return result, None
    except OSError:
        return unavailable, "host_snapshot_unavailable"
    except (ValueError, TypeError):
        return unavailable, "host_snapshot_invalid"


def manual_observations(path: Path | None, now: datetime) -> list[dict]:
    if path is None:
        return []
    entries = read_json(path).get("observations")
    if not isinstance(entries, list) or len(entries) > 100:
        raise ValueError("expected up to 100 observations")
    observations = {}
    for row in entries:
        if not isinstance(row, dict) or not isinstance(row.get("state"), str) or row["state"] not in FRIEND_STATES:
            raise ValueError("invalid manual observation")
        connection_id = identifier(row.get("connection_id"))
        observed = utc(row.get("observed_at"))
        if observed > now:
            raise ValueError("manual observation is in the future")
        if now - observed > MAX_MANUAL_AGE:
            continue
        if connection_id in observations:
            raise ValueError("use one manual observation per connection")
        observations[connection_id] = {
            "connection_id": connection_id, "observed_at": observed.isoformat(), "state": row["state"], "source": "manual",
        }
    return [observations[key] for key in sorted(observations)]


def eligible_participants(
    client: RelayClient, wanted: set[str] | None, *, automatic: bool = False,
) -> dict[str, str | None]:
    """Use current consent IDs. Steam IDs stay in memory and are only needed for automatic sync."""
    eligible = {}
    after = None
    for _ in range(MAX_PARTICIPANT_PAGES):
        page = client.request("/participants", after=after, automatic=True) if automatic else client.request(
            "/participants", after=after,
        )
        rows = page.get("participants")
        if not isinstance(rows, list) or len(rows) > 200:
            raise RequestFailed()
        try:
            for row in rows:
                connection_id = identifier(row.get("connection_id"))
                if wanted is None:
                    if connection_id in eligible:
                        raise ValueError("duplicate participant")
                    eligible[connection_id] = steam_id64(row.get("steam_id64"))
                elif connection_id in wanted:
                    eligible[connection_id] = None
            if page.get("next_cursor") is None or (wanted is not None and wanted <= eligible.keys()):
                return eligible
            cursor = identifier(page["next_cursor"])
            if after is not None and cursor <= after:
                raise ValueError("participant cursor did not advance")
            after = cursor
        except (AttributeError, ValueError):
            raise RequestFailed() from None
    raise RequestFailed()


def load_state(path: Path) -> dict:
    try:
        data = read_json(path)
        failures = data.get("failures", 0)
        next_at = data.get("next_at", 0)
        if type(failures) is not int or not 0 <= failures <= 8:
            raise ValueError("invalid retry count")
        if type(next_at) not in (int, float) or not math.isfinite(next_at) or next_at < 0:
            raise ValueError("invalid retry timestamp")
        state = {"failures": failures, "next_at": next_at}
        if "pending" in data:
            state["pending"] = encode_heartbeat(data["pending"])
        if "last_success" in data:
            state["last_success"] = utc(data["last_success"]).isoformat()
        digest = data.get("friendship_digest")
        if isinstance(digest, str) and re.fullmatch("[a-f0-9]{64}", digest):
            state["friendship_digest"] = digest
        for name in ("steam_next_at", "enrollment_next_at"):
            value = data.get(name)
            if type(value) in (int, float) and math.isfinite(value) and value >= 0:
                state[name] = value
        return state
    except FileNotFoundError:
        return {}
    except (AttributeError, ValueError, KeyError, OverflowError, TypeError):
        print("Relay: invalid retry state, starting a fresh cycle", file=sys.stderr)
        return {}


def schedule(state: dict, now: datetime, failure: RequestFailed | None) -> float:
    if failure is None:
        state["failures"] = 0
        delay = INTERVAL
    else:
        failures = min(8, state.get("failures", 0) + 1)
        state["failures"] = failures
        ceiling = min(MAX_RETRY, 15 * 2**failures)
        delay = max(random.uniform(ceiling / 2, ceiling), failure.retry_after)
    state["next_at"] = now.timestamp() + delay
    return delay


class Manager:
    def __init__(self, client: RelayClient, state_path: Path, snapshot: Path, observations: Path | None,
                 heartbeat_only=False, steam: SteamFriends | None = None, *,
                 steam_session: SteamSession | None = None, collector: Path | None = None):
        self.client = client
        self.state_path = state_path
        self.snapshot = snapshot
        self.observations = observations
        self.heartbeat_only = heartbeat_only
        self.steam = steam
        if (steam_session is None) != (collector is None) or (steam_session and (steam or heartbeat_only)):
            raise ValueError("automatic Relay requires a Steam session and collector path in its own mode")
        self.steam_session = steam_session
        self.collector = collector
        self.admission_cursor = ""
        self.state = load_state(state_path)

    def tick(self, now: datetime) -> float:
        if self.state.get("next_at", 0) > now.timestamp():
            return self.state["next_at"] - now.timestamp()
        failure = None
        pending = self.state.get("pending")
        if pending is None or now - utc(pending["observed_at"]) > MAX_REPORT_AGE:
            pending, failure = self.prepare(now)
            self.state["pending"] = pending
            atomic_json(self.state_path, self.state)
        if failure is None or failure.status != 429:
            try:
                self.client.request("/heartbeat", pending)
                self.state.pop("pending", None)
                if "last_successful_cycle_at" in pending:
                    self.state["last_success"] = pending["last_successful_cycle_at"]
            except RequestFailed as error:
                if error.status in (400, 404, 422):
                    self.state.pop("pending", None)
                if failure is None or error.retry_after >= failure.retry_after:
                    failure = error
        if failure is not None:
            status = f"HTTP {failure.status}" if failure.status is not None else "transport or response error"
            print(f"Relay: cycle will retry after {status}", file=sys.stderr)
        delay = schedule(self.state, now, failure)
        atomic_json(self.state_path, self.state)
        return delay

    def prepare(self, now: datetime) -> tuple[dict, RequestFailed | None]:
        ingest, event = host_snapshot(self.snapshot, now)
        events = [event] if event else []
        failure = None
        if self.steam_session is not None and self.collector is not None:
            failure = self.sync_enrollment(now, events, self.steam_session, self.collector)
        elif not self.heartbeat_only:
            failure = self.sync_friendships(now, events)
        report = {"observed_at": now.isoformat(), "ingest": ingest, "events": events}
        if not events:
            report["last_successful_cycle_at"] = now.isoformat()
        elif "last_success" in self.state:
            report["last_successful_cycle_at"] = self.state["last_success"]
        return encode_heartbeat(report), failure

    def sync_enrollment(
        self, now: datetime, events: list[str], steam: SteamSession, collector: Path,
    ) -> RequestFailed | None:
        if now.timestamp() < self.state.get("enrollment_next_at", 0):
            return None
        self.state["enrollment_next_at"] = now.timestamp() + INTERVAL
        atomic_json(self.state_path, self.state)
        try:
            eligible = eligible_participants(self.client, None, automatic=True)
            relationships = steam.relationships()
            observed_at = datetime.now(timezone.utc)
            attempted = set()
            if not relationships.limit_hit:
                # Rotate through denials as well, so unknown users cannot starve later requests.
                ordered = sorted(relationships.incoming, key=lambda sid: (sid <= self.admission_cursor, sid))
                for account in ordered[:MAX_ADMISSION_CHECKS]:
                    self.admission_cursor = account
                    result = self.client.request("/admissions", {"protocol_version": PROTOCOL, "steam_id64": account})
                    if result["decision"] != "allowed":
                        continue
                    eligible[result["connection_id"]] = account
                    attempted.add(account)
                    try:
                        steam.accept_incoming(account)
                    except RequestFailed as error:
                        # An invite can disappear between the snapshot and Steam's accept action.
                        if error.status not in (400, 409):
                            raise
                    if len(attempted) >= MAX_ACCEPTS:
                        break
            if attempted:
                relationships = steam.relationships()
                observed_at = datetime.now(timezone.utc)
            if (relationships.limit_hit and relationships.incoming) or attempted & relationships.incoming:
                events.append("steam_enrollment_failed")
            self.publish_enrollment(collector, steam.account, eligible, relationships, observed_at)
        except RequestFailed as error:
            collector.unlink(missing_ok=True)
            events.append("steam_enrollment_failed")
            self.state["enrollment_next_at"] = now.timestamp() + max(INTERVAL, error.retry_after)
            return error
        return None

    def publish_enrollment(
        self, collector: Path, relay_account: str, eligible: dict[str, str | None],
        relationships: SteamRelationships, observed_at: datetime,
    ) -> None:
        entries = [
            {"connection_id": connection_id, "observed_at": observed_at.isoformat(), "source": "steam_session",
             "state": "connected" if account in relationships.friends else (
                 "unknown" if account in relationships.incoming else "disconnected"
             )}
            for connection_id, account in eligible.items()
        ]
        accounts = set()
        for start in range(0, len(entries), 100):
            batch = entries[start:start + 100]
            result = self.client.request("/friendship-status", {"protocol_version": PROTOCOL, "observations": batch})
            approved = result.get("collector_connections")
            connected = {entry["connection_id"] for entry in batch if entry["state"] == "connected"}
            if not isinstance(approved, list) or any(not isinstance(key, str) or key not in connected for key in approved):
                raise RequestFailed()
            accounts.update(int(steam_id64(eligible[key])) - STEAM_ID64_BASE for key in approved)
        atomic_json(collector, {
            "schema_version": 1, "steam_id64": relay_account,
            "valid_until": int(observed_at.timestamp()) + COLLECTOR_TTL, "accounts": sorted(accounts),
        }, mode=0o640)

    def sync_friendships(self, now: datetime, events: list[str]) -> RequestFailed | None:
        steam_due = self.steam is not None and now.timestamp() >= self.state.get("steam_next_at", 0)
        try:
            observations = manual_observations(self.observations, now)
        except (OSError, ValueError, TypeError):
            events.append("friendship_sync_failed")
            observations = []
            if not steam_due:
                return None
        try:
            wanted = None if steam_due else {entry["connection_id"] for entry in observations}
            eligible = eligible_participants(self.client, wanted)
        except RequestFailed as error:
            events.append("participant_sync_failed")
            return error
        entries = [entry for entry in observations if entry["connection_id"] in eligible]
        manual_ids = set()
        try:
            if entries:
                body = {"protocol_version": PROTOCOL, "observations": entries}
                digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
                if digest != self.state.get("friendship_digest"):
                    self.client.request("/friendship-status", body)
                    self.state["friendship_digest"] = digest
                    manual_ids = {entry["connection_id"] for entry in entries}
            if steam_due and self.steam is not None:
                self.sync_steam(now, events, self.steam, eligible, manual_ids)
        except RequestFailed as error:
            events.append("friendship_sync_failed")
            return error
        return None

    def sync_steam(self, now: datetime, events: list[str], steam: SteamFriends,
                   eligible: dict[str, str | None], manual_ids: set[str]) -> None:
        # Persist the interval before contacting Steam so a service restart cannot repeat the call early.
        self.state["steam_next_at"] = now.timestamp() + STEAM_INTERVAL
        atomic_json(self.state_path, self.state)
        if not eligible:
            return
        try:
            friends = steam.friend_ids()
        except RequestFailed as error:
            self.state["steam_next_at"] = now.timestamp() + max(STEAM_INTERVAL, error.retry_after)
            events.append("friendship_sync_failed")
            return

        entries = [
            {"connection_id": connection_id, "observed_at": now.isoformat(),
             "state": "connected" if account in friends else "disconnected", "source": "steam_web_api"}
            for connection_id, account in eligible.items() if connection_id not in manual_ids
        ]
        for start in range(0, len(entries), 100):
            self.client.request("/friendship-status",
                                {"protocol_version": PROTOCOL, "observations": entries[start:start + 100]})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--state-directory", required=True, type=Path)
    parser.add_argument("--host-snapshot", required=True, type=Path)
    parser.add_argument("--friend-observations", type=Path)
    parser.add_argument("--steam-id64", help="enable GetFriendList for this Relay account")
    parser.add_argument("--steam-auto-enrollment", action="store_true", help="use the Relay account's Steam web session")
    parser.add_argument("--collector-allowlist", type=Path, help="write the current list of confirmed Ingest participants")
    parser.add_argument("--heartbeat-only", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.steam_auto_enrollment and not (args.steam_id64 and args.collector_allowlist and not args.heartbeat_only):
        parser.error("automatic enrollment requires --steam-id64 and --collector-allowlist in write mode")
    if args.collector_allowlist and not args.steam_auto_enrollment:
        parser.error("--collector-allowlist requires --steam-auto-enrollment")
    try:
        client = RelayClient(args.api_base_url, args.token_file)
        steam = None
        steam_session = None
        if args.steam_id64 and not args.heartbeat_only:
            credentials = os.environ.get("CREDENTIALS_DIRECTORY")
            if not credentials:
                raise ValueError("expected systemd credentials directory")
            if args.steam_auto_enrollment:
                steam_session = SteamSession(args.steam_id64, Path(credentials) / "steam-login-secure")
            else:
                steam = SteamFriends(args.steam_id64, Path(credentials) / "steam-web-api-key")
        manager = Manager(
            client, args.state_directory / "delivery.json", args.host_snapshot,
            args.friend_observations, heartbeat_only=args.heartbeat_only, steam=steam,
            steam_session=steam_session, collector=args.collector_allowlist,
        )
        while True:
            delay = manager.tick(datetime.now(timezone.utc))
            if args.once:
                return int(manager.state.get("failures", 0) > 0)
            time.sleep(delay)
    except (ValueError, OSError) as error:
        print(f"Relay: could not run manager ({type(error).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
