"""Publish a local Docker observation without exposing Docker to the network agent."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from scripts import contract_relay_status

from .protocol import DOCKER_ERRORS, MAX_JSON, atomic_json, ingest_snapshot, scheduler_snapshot, utc


MEMORY_UNITS = {unit: 1024**power for power, unit in enumerate(("B", "KiB", "MiB", "GiB", "TiB", "PiB"))}
SCHEDULER_STATUS = Path("/var/lib/contract-relay-scheduler/status.json")


def docker_metrics(container: str) -> dict:
    try:
        result = contract_relay_status.docker("stats", "--no-stream", "--format", "{{.CPUPerc}}\t{{.MemUsage}}", "--", container)
        if result.returncode:
            return {}
        line = result.stdout.strip()
        match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+(?:\.[0-9]+)?)([A-Za-z]+)\s*/\s*.+", line)
        if match is None or match[3] not in MEMORY_UNITS:
            return {}
        return {"metrics": {
            "cpu_percent": float(match[1]), "ram_bytes": int(Decimal(match[2]) * MEMORY_UNITS[match[3]]),
        }}
    except (OSError, subprocess.TimeoutExpired, InvalidOperation, OverflowError):
        return {}


def read_scheduler_status(path: Path) -> dict:
    # This input is written by the container. A symlink or pipe must not redirect or block the publisher.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
    with os.fdopen(os.open(path, flags), "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise ValueError("scheduler status is not a regular file")
        data = handle.read(MAX_JSON + 1)
    if len(data) > MAX_JSON:
        raise ValueError("scheduler status exceeds size limit")
    return scheduler_snapshot(json.loads(data))


def publish(container: str, target: Path, scheduler_status: Path = SCHEDULER_STATUS) -> None:
    now = datetime.now(timezone.utc)
    status, _ = contract_relay_status.check(container, now, timedelta(minutes=90))
    status["observed_at"] = status["checked_at"]
    if status["container_status"] == "running":
        status.update(docker_metrics(container))
        try:
            scheduler = read_scheduler_status(scheduler_status)
            started = status.get("container_started_at")
            observed = scheduler["observed_at"]
            if (0 <= datetime.now(timezone.utc).timestamp() - observed <= 240
                    and (started is None or observed >= int(utc(started).timestamp()))):
                status["scheduler"] = scheduler
        except (OSError, ValueError, RecursionError):
            # An unavailable scheduler report must not hide the container observation.
            pass
    report = ingest_snapshot(status)
    if status.get("error") in DOCKER_ERRORS:
        report["error"] = status["error"]
    atomic_json(target, report, mode=0o644)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="contract-relay-ingest")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--scheduler-status", default=SCHEDULER_STATUS, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", args.container):
        parser.error("expected a local Docker container name")
    publish(args.container, args.output, args.scheduler_status)


if __name__ == "__main__":
    main()
