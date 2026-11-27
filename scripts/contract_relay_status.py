"""Read-only status for a local Deadlock API Ingest container."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timedelta, timezone

INSPECT_FORMAT = (
    '[{{json .Id}},{{json .State.Status}},{{json .State.StartedAt}},'
    '{{json .State.ExitCode}},{{json .State.OOMKilled}}]'
)
ANSI_COLOR = re.compile(r"\x1b\[[0-9;]*m")
GC_EVENT = re.compile(r"\b(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+deadlock_api_ingest::gc:\s+gc: (.+)$")
METADATA_LIMIT = re.compile(
    r"(?:skipping account \d+, 24h quota spent|account \d+ rate-limited by Steam GC; quota exhausted for 24h)"
)
HISTORY_LIMIT = re.compile(r"account \d+ rate-limited on match history; skipping friends")
SALT_UPLOAD = re.compile(r"account \d+ fetched (\d+) match salt\(s\)")


def docker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "container", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        encoding="utf-8", errors="replace", timeout=10, check=False,
    )


def timestamp(value: str) -> datetime:
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise ValueError("expected a Docker timestamp with a timezone")
    return instant.astimezone(timezone.utc)


def gc_observations(logs: str, started_at: datetime, now: datetime) -> dict:
    observations = {}
    # Sort by Docker timestamps because stdout and stderr can be interleaved.
    events = []
    for line in logs.splitlines():
        prefix, _, body = line.partition(" ")
        event = GC_EVENT.search(ANSI_COLOR.sub("", body))
        if event is None:
            continue
        try:
            seen_at = timestamp(prefix)
        except ValueError:
            continue
        if started_at <= seen_at <= now:
            events.append((seen_at, event[1]))

    for seen_at, message in sorted(events):
        seen = seen_at.isoformat()
        observations["last_gc_event_at"] = seen
        if METADATA_LIMIT.fullmatch(message):
            observations["last_metadata_quota_signal_at"] = seen
        if HISTORY_LIMIT.fullmatch(message):
            observations["last_history_rate_limit_at"] = seen
        uploaded = SALT_UPLOAD.fullmatch(message)
        if uploaded and int(uploaded[1]) > 0:
            observations["last_salt_upload"] = {"at": seen, "count": int(uploaded[1])}
    return observations


def check(container: str, now: datetime, stale_after: timedelta) -> tuple[dict, int]:
    result = {
        "container": container,
        "checked_at": now.isoformat(),
        "container_status": "unknown",
        "gc_logs": "unavailable",
    }
    try:
        inspected = docker("inspect", "--format", INSPECT_FORMAT, "--", container)
        if inspected.returncode:
            if "No such container:" in inspected.stdout:
                result["container_status"] = "missing"
                return result, 1
            raise ValueError("Docker inspect failed")
        container_id, status, started_at_raw, exit_code, oom_killed = json.loads(inspected.stdout)
        if (
            not re.fullmatch(r"[a-f0-9]{64}", container_id)
            or not isinstance(status, str)
            or type(exit_code) is not int
            or type(oom_killed) is not bool
        ):
            raise ValueError("invalid Docker container state")
        started_at = timestamp(started_at_raw)
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
        result["error"] = "docker_inspect_failed"
        return result, 2

    result.update(container_status=status, oom_killed=oom_killed)
    if status in {"exited", "dead"}:
        result["container_exit_code"] = exit_code
    if started_at == datetime.min.replace(tzinfo=timezone.utc):
        result["gc_logs"] = "missing"
        return result, 1

    result["container_started_at"] = started_at.isoformat()
    try:
        logs = docker("logs", "--timestamps", "--tail", "300", "--since", started_at_raw, "--", container_id)
        if logs.returncode:
            raise ValueError("Docker logs failed")
    except (OSError, subprocess.TimeoutExpired, ValueError):
        result["error"] = "docker_logs_failed"
        return result, 2

    observations = gc_observations(logs.stdout, started_at, now)
    result.update(observations)
    latest = observations.get("last_gc_event_at")
    if latest is None:
        result["gc_logs"] = "missing"
    elif now - timestamp(latest) > stale_after:
        result["gc_logs"] = "stale"
    else:
        result["gc_logs"] = "recent"

    return result, int(status != "running" or result["gc_logs"] != "recent")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="contract-relay-ingest", help="Ingest container name")
    parser.add_argument("--stale-after-minutes", type=int, default=90, help="Age threshold for GC log activity")
    args = parser.parse_args()
    try:
        stale_after = timedelta(minutes=args.stale_after_minutes)
    except OverflowError:
        parser.error("--stale-after-minutes is too large")
    if stale_after <= timedelta(0):
        parser.error("--stale-after-minutes must be positive")
    status, exit_code = check(args.container, datetime.now(timezone.utc), stale_after)
    print(json.dumps(status, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
