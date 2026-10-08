"""Run restore.sh; simulate only the unavailable Docker/PostgreSQL boundary."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
LIVE = "deadlock_contracts"

# This external command double keeps database identities, connection admission,
# and service state. It accepts only the PostgreSQL operations restore needs;
# unsupported Docker/SQL commands fail instead of silently succeeding.
DOCKER = r'''
import copy
import json
import os
from pathlib import Path
import re
import sys

path = Path(os.environ["RESTORE_STATE"])
state = json.loads(path.read_text())
args = sys.argv[1:]

def done(code=0, output=""):
    path.write_text(json.dumps(state))
    if output:
        print(output)
    raise SystemExit(code)

def event(kind, **values):
    state["events"].append({"kind": kind, **values})

def option(values, name, default=None):
    return values[values.index(name) + 1] if name in values else default

def identifier(value):
    return value.strip('"')

if args[0] != "compose":
    done(90, "unexpected Docker command")
args = args[1:]
while args and args[0] in ("--env-file", "-f"):
    args = args[2:]
action, args = args[0], args[1:]
if action in ("stop", "start"):
    if args != ["web", "worker"]:
        done(90, "unexpected services")
    event(action)
    state["running"] = action == "start"
    done()
if action == "run":
    if args[:5] != ["--rm", "--no-deps", "-T", "--entrypoint", "python"]:
        done(90, "validator must not start application entrypoints or dependencies")
    service, args = args[5], ["python", *args[6:]]
elif action == "exec":
    while args and args[0] in ("-T", "-e", "--env"):
        args = args[1:] if args[0] == "-T" else args[2:]
    service, args = args[0], args[1:]
else:
    done(90, "unexpected Compose action")
if service in ("web", "worker"):
    if args[:2] != ["python", "-"] or len(args) != 4:
        done(90, "runtime check must execute Python with trial and live names")
    sys.stdin.read()
    event("runtime", service=service, database=args[2], method=action)
    if action == "exec" and not state["running"]:
        done(1, "application container is stopped")
    if state["fail"] == "runtime_" + service:
        done(1, "incompatible Alembic revision or expected application schema")
    if args[2] not in state["databases"] or args[2] == "deadlock_contracts":
        done(90, "runtime check did not target the trial database")
    done()
if service != "db" or args[0] != "psql":
    done(90, "unexpected exec command")
args = args[1:]
database = option(args, "-d")
username = option(args, "-U")
commands = [args[i + 1] for i, value in enumerate(args) if value == "-c"]
if "-f" in args or not commands:
    sql = sys.stdin.read()
    event("import", database=database, username=username)
    if state["fail"] == "import":
        done(3, "SQL restore failed")
    if "\\connect deadlock_contracts" in sql:
        if not any(command.startswith("\\restrict ") for command in commands):
            state["databases"]["deadlock_contracts"]["identity"] = "damaged"
        done(3, "psql connection switching blocked")
    if database not in state["databases"]:
        done(3, "import database missing")
    if database != "deadlock_contracts":
        if username not in state["roles"]:
            done(3, "import role missing")
        if not {"-X", "--single-transaction"}.issubset(args):
            done(3, "unsafe import flags")
        if not any(command.startswith("\\restrict ") for command in commands):
            done(3, "unrestricted psql import")
    state["databases"][database]["identity"] = "restored"
    done()
sql = "\n".join(commands)
if database != "postgres" and username == "deadlock" and sql.startswith("REASSIGN OWNED BY "):
    if database == "deadlock_contracts" or database not in state["databases"]:
        done(90, "ownership transfer must target the trial")
    done()
if database != "postgres" or username != "deadlock":
    done(90, "administration must use postgres maintenance database")
oid_query = re.search(r"SELECT oid FROM pg_database WHERE datname = '([^']+)'", sql)
if oid_query:
    db = state["databases"].get(oid_query[1])
    done(output=str(db["oid"]) if db else "")
if "pg_terminate_backend" in sql:
    event("terminate")
    done(output="t")
snapshot = copy.deepcopy(state["databases"])
for statement in sql.split(";"):
    statement = statement.strip()
    if not statement or statement in ("BEGIN", "COMMIT") or statement.startswith("SET "):
        continue
    match = re.fullmatch(r'CREATE ROLE (\w+) LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION(?: PASSWORD \'[^\']+\')?', statement)
    if match:
        state["roles"].append(match[1])
        event("create_role", role=match[1])
        continue
    match = re.fullmatch(r'DROP ROLE(?: IF EXISTS)? (\w+)', statement)
    if match:
        if match[1] in state["roles"]:
            state["roles"].remove(match[1])
        event("drop_role", role=match[1])
        continue
    match = re.fullmatch(r'CREATE DATABASE ("?\w+"?) (?:WITH )?(?:OWNER(?: =)? ("?\w+"?))(?: TEMPLATE(?: =)? template0)?', statement)
    if match:
        name = identifier(match[1])
        if name in state["databases"]:
            done(3, "database exists")
        state["next_oid"] += 1
        state["databases"][name] = {"oid": state["next_oid"], "identity": "empty", "allows": True}
        event("create", database=name)
        continue
    match = re.fullmatch(r'DROP DATABASE(?: IF EXISTS)? ("?\w+"?)(?: WITH \(FORCE\))?', statement)
    if match:
        name = identifier(match[1])
        state["databases"].pop(name, None)
        event("drop", database=name)
        continue
    match = re.fullmatch(r'ALTER DATABASE ("?\w+"?) (?:WITH )?ALLOW_CONNECTIONS (true|false)', statement, re.I)
    if match:
        name = identifier(match[1])
        if name not in state["databases"]:
            done(3, "database missing")
        state["databases"][name]["allows"] = match[2].lower() == "true"
        event("admission", database=name, allows=match[2].lower() == "true")
        continue
    match = re.fullmatch(r'ALTER DATABASE ("?\w+"?) RENAME TO ("?\w+"?)', statement)
    if match:
        old, new = identifier(match[1]), identifier(match[2])
        event("rename", old=old, new=new)
        if state["fail"] == "cutover" and new == "deadlock_contracts":
            state["databases"] = snapshot
            done(3, "trial promotion failed; PostgreSQL transaction rolled back")
        if old not in state["databases"] or new in state["databases"]:
            state["databases"] = snapshot
            done(3, "rename conflict")
        state["databases"][new] = state["databases"].pop(old)
        continue
    if statement.startswith("REASSIGN OWNED BY ") or re.fullmatch(r'ALTER DATABASE "?\w+"? OWNER TO deadlock', statement):
        continue
    done(90, "unsupported SQL: " + statement)
if state["fail"] == "lost_commit" and any(e["kind"] == "rename" and e.get("new") == "deadlock_contracts" for e in state["events"]):
    state["fail"] = ""
    done(2, "connection lost after cutover COMMIT")
done()
'''


@pytest.fixture
def restore(tmp_path: Path):
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    shutil.copy2(ROOT / "scripts/restore.sh", project / "scripts/restore.sh")
    (project / ".env.production").write_text("DOMAIN=restore.test\n")
    (project / "compose.prod.yaml").write_text("services: {}\n")
    commands = tmp_path / "bin"
    commands.mkdir()
    docker = commands / "docker"
    docker.write_text(f"#!{sys.executable}\n" + DOCKER)
    docker.chmod(0o755)
    state_path = tmp_path / "state.json"

    def run(payload: bytes = b"SELECT 1;\n", *, corrupt=False, checksum=None, failure="", apps_running=True):
        backup = project / "backup with spaces.sql.gz"
        backup.write_bytes(b"broken gzip" if corrupt else gzip.compress(payload))
        if checksum is not None:
            digest = hashlib.sha256(backup.read_bytes()).hexdigest() if checksum == "valid" else checksum
            # backup.sh writes an absolute original path, which may have moved.
            Path(str(backup) + ".sha256").write_text(f"{digest}  /previous/server/backup.sql.gz\n")
        state_path.write_text(json.dumps({
            "databases": {LIVE: {"oid": 10001, "identity": "original", "allows": True}},
            "next_oid": 20000, "roles": [], "running": apps_running, "events": [], "fail": failure,
        }))
        result = subprocess.run(
            ["bash", str(project / "scripts/restore.sh"), str(backup)],
            input="RESTORE\n", capture_output=True, text=True, timeout=20,
            env={**os.environ, "PATH": f"{commands}:{os.environ['PATH']}", "RESTORE_STATE": str(state_path)},
        )
        return result, json.loads(state_path.read_text())

    return run


def assert_live_untouched(state):
    assert state["databases"][LIVE] == {"oid": 10001, "identity": "original", "allows": True}
    assert state["running"] is True
    assert not any(event["kind"] in {"stop", "rename"} for event in state["events"])
    assert not any(event["kind"] == "drop" and event["database"] == LIVE for event in state["events"])


def test_corrupt_gzip_never_interrupts_production(restore):
    result, state = restore(corrupt=True)
    assert result.returncode != 0
    assert_live_untouched(state)


def test_empty_decompressed_backup_never_interrupts_production(restore):
    result, state = restore(b"")
    assert result.returncode != 0
    assert_live_untouched(state)


@pytest.mark.parametrize("checksum", ["0" * 64, "not-a-checksum"])
def test_invalid_checksum_never_interrupts_production(restore, checksum):
    result, state = restore(checksum=checksum)
    assert result.returncode != 0
    assert_live_untouched(state)


def test_failed_sql_trial_never_interrupts_production(restore):
    result, state = restore(failure="import")
    assert result.returncode != 0
    assert_live_untouched(state)


@pytest.mark.parametrize("service", ["web", "worker"])
def test_incompatible_runtime_never_interrupts_production(restore, service):
    result, state = restore(failure="runtime_" + service)
    assert result.returncode != 0
    assert_live_untouched(state)


def test_plain_sql_cannot_reconnect_into_live_database(restore):
    result, state = restore(b"\\connect deadlock_contracts\nDROP SCHEMA public CASCADE;\n")
    assert result.returncode != 0
    assert_live_untouched(state)


@pytest.mark.parametrize("checksum", [None, "valid"])
def test_success_keeps_original_database_for_explicit_resume(restore, checksum):
    result, state = restore(checksum=checksum)
    assert result.returncode == 0, result.stdout + result.stderr
    assert state["databases"][LIVE]["identity"] == "restored"
    retained = {name: db for name, db in state["databases"].items() if name != LIVE}
    assert len(retained) == 1
    previous, database = next(iter(retained.items()))
    assert previous.startswith(LIVE + "_previous_")
    assert database == {"oid": 10001, "identity": "original", "allows": False}
    assert state["running"] is False
    assert state["roles"] == []
    assert not any(event["kind"] == "drop" for event in state["events"])
    imports = [event for event in state["events"] if event["kind"] == "import"]
    assert len(imports) == 1 and imports[0]["database"].startswith(LIVE + "_trial_")
    assert imports[0]["username"] != "deadlock"
    kinds = [event["kind"] for event in state["events"]]
    assert kinds.index("import") < kinds.index("runtime") < kinds.index("stop") < kinds.index("rename")
    assert [event["service"] for event in state["events"] if event["kind"] == "runtime"] == ["web", "worker"]
    assert previous in result.stdout


def test_restore_validates_selected_runtimes_when_apps_already_stopped(restore):
    result, state = restore(apps_running=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert state["databases"][LIVE]["identity"] == "restored"
    assert any(database["oid"] == 10001 for name, database in state["databases"].items() if name != LIVE)
    assert state["running"] is False
    assert [event["method"] for event in state["events"] if event["kind"] == "runtime"] == ["run", "run"]
    assert not any(event["kind"] == "start" for event in state["events"])


@pytest.mark.parametrize("failure", ["cutover", "lost_commit"])
def test_cutover_failure_restores_original_identity_without_starting_services(restore, failure):
    result, state = restore(failure=failure)
    assert result.returncode != 0
    assert state["databases"] == {LIVE: {"oid": 10001, "identity": "original", "allows": True}}
    assert state["running"] is False
    assert state["roles"] == []
    assert not any(event["kind"] == "drop" and event["database"] == LIVE for event in state["events"])
    assert not any(event["kind"] == "start" for event in state["events"])
