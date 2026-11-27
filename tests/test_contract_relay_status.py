from datetime import datetime, timedelta, timezone
import json
import subprocess

import pytest

from scripts import contract_relay_status as relay


CONTAINER = "contract-relay-ingest"
CONTAINER_ID = "a" * 64
NOW = datetime(2026, 11, 27, tzinfo=timezone.utc)
STARTED = "2026-11-26T22:45:01.615081000Z"


def gc_line(instant, message):
    return f"{instant} {instant}  INFO deadlock_api_ingest::gc: gc: {message}"


def fake_docker(monkeypatch, *, status="running", started=STARTED, exit_code=0, output="", logs_code=0):
    calls = []

    def run(*args):
        calls.append(args)
        if args[0] == "inspect":
            state = [CONTAINER_ID, status, started, exit_code, False]
            return subprocess.CompletedProcess(args, 0, json.dumps(state))
        return subprocess.CompletedProcess(args, logs_code, output)

    monkeypatch.setattr(relay, "docker", run)
    return calls


def check():
    return relay.check(CONTAINER, NOW, timedelta(minutes=90))


def test_distinguishes_metadata_history_and_success_signals_without_account_ids(monkeypatch):
    output = "\n".join((
        gc_line("2026-11-26T23:05:00Z", "account 123456789 fetched 2 match salt(s)"),
        gc_line("2026-11-26T22:46:00.123456789Z", "skipping account 123456789, 24h quota spent"),
        gc_line("2026-11-26T23:04:00Z", "account 123456789 rate-limited on match history; skipping friends"),
        gc_line("2026-11-26T23:35:00Z", "account 123456789 fetched 0 match salt(s)"),
    )).replace("INFO", "\x1b[32mINFO\x1b[0m")
    calls = fake_docker(monkeypatch, output=output)

    result, code = check()

    assert code == 0
    assert result["container_status"] == "running"
    assert result["gc_logs"] == "recent"
    assert result["last_gc_event_at"] == "2026-11-26T23:35:00+00:00"
    assert result["last_metadata_quota_signal_at"] == "2026-11-26T22:46:00.123456+00:00"
    assert result["last_history_rate_limit_at"] == "2026-11-26T23:04:00+00:00"
    assert result["last_salt_upload"] == {"at": "2026-11-26T23:05:00+00:00", "count": 2}
    assert "123456789" not in json.dumps(result)
    assert calls[0][-2:] == ("--", CONTAINER)
    assert calls[1] == ("logs", "--timestamps", "--tail", "300", "--since", STARTED, "--", CONTAINER_ID)


def test_docker_exit_status_takes_precedence_over_recent_logs(monkeypatch):
    output = gc_line("2026-11-26T22:45:01.626478Z", "skipping account 123456789, 24h quota spent")
    fake_docker(monkeypatch, status="exited", exit_code=0, output=output)

    result, code = check()

    assert code == 1
    assert result["container_status"] == "exited"
    assert result["container_exit_code"] == 0
    assert result["gc_logs"] == "recent"
    assert "last_metadata_quota_signal_at" in result


def test_a_restart_does_not_carry_over_old_quota_or_upload_observations(monkeypatch):
    output = "\n".join((
        gc_line("2026-11-26T22:45:01.615080900Z", "skipping account 123456789, 24h quota spent"),
        gc_line("2026-11-26T22:40:00Z", "account 123456789 fetched 2 match salt(s)"),
        gc_line("2026-11-27T04:00:00Z", "1 Steam account(s) available"),
        gc_line("invalid", "1 Steam account(s) available"),
        "2026-11-26T23:00:00Z INFO deadlock_api_ingest: logging started",
    ))
    fake_docker(monkeypatch, output=output)

    result, code = check()

    assert code == 1
    assert result["gc_logs"] == "missing"
    assert "last_metadata_quota_signal_at" not in result
    assert "last_salt_upload" not in result


def test_running_container_can_have_stale_gc_activity(monkeypatch):
    output = gc_line("2026-11-26T22:00:00Z", "nothing to fetch for account 123456789")
    fake_docker(monkeypatch, started="2026-11-26T21:00:00Z", output=output)

    result, code = check()

    assert code == 1
    assert result["container_status"] == "running"
    assert result["gc_logs"] == "stale"


def test_created_container_has_never_started(monkeypatch):
    calls = fake_docker(monkeypatch, status="created", started="0001-01-01T00:00:00Z")

    result, code = check()

    assert code == 1
    assert result["container_status"] == "created"
    assert result["gc_logs"] == "missing"
    assert len(calls) == 1


@pytest.mark.parametrize(("stderr", "expected_status", "expected_code"), [
    ("Error response from daemon: No such container: contract-relay-ingest", "missing", 1),
    ("permission denied reading Docker socket", "unknown", 2),
])
def test_missing_container_and_inspect_failure_are_distinguished(monkeypatch, stderr, expected_status, expected_code):
    monkeypatch.setattr(relay, "docker", lambda *args: subprocess.CompletedProcess(args, 1, stderr))

    result, code = check()

    assert code == expected_code
    assert result["container_status"] == expected_status
    assert result["gc_logs"] == "unavailable"
    assert stderr not in json.dumps(result)


def test_log_read_failure_preserves_inspected_state_without_raw_error(monkeypatch):
    fake_docker(monkeypatch, output="logging driver cannot read logs", logs_code=1)

    result, code = check()

    assert code == 2
    assert result["container_status"] == "running"
    assert result["gc_logs"] == "unavailable"
    assert result["error"] == "docker_logs_failed"
    assert "logging driver" not in json.dumps(result)
