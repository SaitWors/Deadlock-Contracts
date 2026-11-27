"""Run the outbound Contract Relay connection from the Ingest host."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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

AGENT_VERSION = "1.0.0"
INTERVAL = 60
MAX_RETRY = 15 * 60
MAX_REPORT_AGE = timedelta(hours=23)
MAX_MANUAL_AGE = timedelta(hours=23)
MAX_PARTICIPANT_PAGES = 20
EVENTS = {"host_snapshot_invalid", "host_snapshot_unavailable", "participant_sync_failed", "friendship_sync_failed"}


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


def eligible_ids(client: RelayClient, wanted: set[str]) -> set[str]:
    """Use consent IDs only. Steam IDs in the HTTPS response stay in memory."""
    eligible = set()
    after = None
    for _ in range(MAX_PARTICIPANT_PAGES):
        page = client.request("/participants", after=after)
        rows = page.get("participants")
        if not isinstance(rows, list) or len(rows) > 200:
            raise RequestFailed()
        try:
            for row in rows:
                connection_id = identifier(row.get("connection_id"))
                if connection_id in wanted:
                    eligible.add(connection_id)
            if page.get("next_cursor") is None or wanted <= eligible:
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
    def __init__(self, client: RelayClient, state_path: Path, snapshot: Path, observations: Path | None, heartbeat_only=False):
        self.client = client
        self.state_path = state_path
        self.snapshot = snapshot
        self.observations = observations
        self.heartbeat_only = heartbeat_only
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
        failure = self.sync_friendships(now, events) if not self.heartbeat_only else None
        report = {"observed_at": now.isoformat(), "ingest": ingest, "events": events}
        if not events:
            report["last_successful_cycle_at"] = now.isoformat()
        elif "last_success" in self.state:
            report["last_successful_cycle_at"] = self.state["last_success"]
        return encode_heartbeat(report), failure

    def sync_friendships(self, now: datetime, events: list[str]) -> RequestFailed | None:
        try:
            observations = manual_observations(self.observations, now)
        except (OSError, ValueError, TypeError):
            events.append("friendship_sync_failed")
            return None
        try:
            eligible = eligible_ids(self.client, {entry["connection_id"] for entry in observations})
        except RequestFailed as error:
            events.append("participant_sync_failed")
            return error
        entries = [entry for entry in observations if entry["connection_id"] in eligible]
        if not entries:
            return None
        body = {"protocol_version": PROTOCOL, "observations": entries}
        digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        if digest == self.state.get("friendship_digest"):
            return None
        try:
            self.client.request("/friendship-status", body)
            self.state["friendship_digest"] = digest
        except RequestFailed as error:
            events.append("friendship_sync_failed")
            return error
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--state-directory", required=True, type=Path)
    parser.add_argument("--host-snapshot", required=True, type=Path)
    parser.add_argument("--friend-observations", type=Path)
    parser.add_argument("--heartbeat-only", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    try:
        client = RelayClient(args.api_base_url, args.token_file)
        manager = Manager(
            client, args.state_directory / "delivery.json", args.host_snapshot,
            args.friend_observations, heartbeat_only=args.heartbeat_only,
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
