"""Publish a local Docker observation without exposing Docker to the network agent."""

from __future__ import annotations

import argparse
import re
import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from scripts import contract_relay_status

from .protocol import DOCKER_ERRORS, atomic_json, ingest_snapshot


MEMORY_UNITS = {unit: 1024**power for power, unit in enumerate(("B", "KiB", "MiB", "GiB", "TiB", "PiB"))}


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


def publish(container: str, target: Path) -> None:
    now = datetime.now(timezone.utc)
    status, _ = contract_relay_status.check(container, now, timedelta(minutes=90))
    status["observed_at"] = status["checked_at"]
    if status["container_status"] == "running":
        status.update(docker_metrics(container))
    report = ingest_snapshot(status)
    if status.get("error") in DOCKER_ERRORS:
        report["error"] = status["error"]
    atomic_json(target, report, mode=0o644)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="contract-relay-ingest")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", args.container):
        parser.error("expected a local Docker container name")
    publish(args.container, args.output)


if __name__ == "__main__":
    main()
