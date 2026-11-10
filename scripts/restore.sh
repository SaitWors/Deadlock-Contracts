#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 1 ]] || { echo "Usage: $0 backups/file.sql.gz" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FILE="$1"
COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)
LIVE_DB=deadlock_contracts
TRIAL_OID=""
LIVE_OID=""
ROLE_CREATED=0
CUTOVER_ATTEMPTED=0
SERVICES_TOUCHED=0
TEMP_DIR=""

log(){ printf '[restore] %s\n' "$*"; }
fail(){ printf '[restore][FAIL] %s\n' "$*" >&2; exit 1; }
admin(){ "${COMPOSE[@]}" exec -T db psql -X -q -At -U deadlock -d postgres -v ON_ERROR_STOP=1 -c "$1"; }
database_oid(){ admin "SELECT oid FROM pg_database WHERE datname = '$1';"; }

# Compare identities rather than trusting the exit status of COMMIT: a client
# can lose its connection after the server has committed both renames.
rollback_cutover() {
  local current previous
  current="$(database_oid "$LIVE_DB")" || return 1
  previous="$(database_oid "$PREVIOUS_DB")" || return 1
  if [[ "$current" == "$LIVE_OID" && -z "$previous" ]]; then
    admin "ALTER DATABASE \"$LIVE_DB\" ALLOW_CONNECTIONS true;" || return 1
  elif [[ "$current" == "$TRIAL_OID" && "$previous" == "$LIVE_OID" ]]; then
    admin "ALTER DATABASE \"$LIVE_DB\" ALLOW_CONNECTIONS false;" || return 1
    admin "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname IN ('$LIVE_DB', '$PREVIOUS_DB') AND pid <> pg_backend_pid();" || return 1
    admin "BEGIN;
      ALTER DATABASE \"$LIVE_DB\" RENAME TO \"$TRIAL_DB\";
      ALTER DATABASE \"$PREVIOUS_DB\" RENAME TO \"$LIVE_DB\";
      ALTER DATABASE \"$LIVE_DB\" ALLOW_CONNECTIONS true;
      COMMIT;" || return 1
  else
    return 1
  fi
  [[ "$(database_oid "$LIVE_DB")" == "$LIVE_OID" ]] || return 1
  log "Original database identity restored; web and worker remain stopped."
}

finish() {
  local status=$? current_trial
  trap - EXIT INT TERM
  set +e
  if (( status != 0 && CUTOVER_ATTEMPTED )); then
    if ! rollback_cutover; then
      log "Automatic rollback could not be verified. Preserve all databases and follow PROJECT.md#restore."
    fi
  fi
  # Only the unique trial name with the captured trial identity can be removed.
  # Neither the live name nor the retained previous name is ever dropped.
  if [[ -n "$TRIAL_OID" ]]; then
    if current_trial="$(database_oid "$TRIAL_DB")" && [[ "$current_trial" == "$TRIAL_OID" ]]; then
      admin "DROP DATABASE \"$TRIAL_DB\" WITH (FORCE);" || log "Trial cleanup failed: $TRIAL_DB (OID $TRIAL_OID)."
    fi
  fi
  if (( ROLE_CREATED )); then
    admin "DROP ROLE $TRIAL_ROLE;" || log "Temporary role retained for manual cleanup: $TRIAL_ROLE."
  fi
  [[ -z "$TEMP_DIR" ]] || rm -rf -- "$TEMP_DIR"
  if (( SERVICES_TOUCHED )); then
    log "Services remain stopped. Select compatible images and resume explicitly; see PROJECT.md#restore."
  fi
  exit "$status"
}

[[ -f "$FILE" ]] || fail "Backup not found: $FILE"
[[ -f .env.production ]] || fail ".env.production not found"
for dependency in docker gzip python3 flock; do
  command -v "$dependency" >/dev/null || fail "$dependency not found"
done
umask 077
mkdir -p runtime
exec 9>runtime/restore.lock
flock -n 9 || fail "Another restore is running"
read -r TOKEN TRIAL_PASSWORD RESTRICT_KEY < <(python3 -c 'import secrets; print(secrets.token_hex(6), secrets.token_hex(32), secrets.token_hex(32))')
RUN_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)_${TOKEN}"
TRIAL_DB="${LIVE_DB}_trial_${RUN_TOKEN}"
PREVIOUS_DB="${LIVE_DB}_previous_${RUN_TOKEN}"
TRIAL_ROLE="dc_restore_${TOKEN}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deadlock-restore.XXXXXXXX")"
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Work only from the validated private copy, avoiding changes to the selected
# file between integrity checking and import. Legacy backups may lack sidecars.
cp -- "$FILE" "$TEMP_DIR/backup.sql.gz"
gzip -t "$TEMP_DIR/backup.sql.gz" || fail "Invalid gzip backup"
if [[ -e "$FILE.sha256" || -L "$FILE.sha256" ]]; then
  [[ -f "$FILE.sha256" ]] || fail "Checksum sidecar is not a regular file"
  cp -- "$FILE.sha256" "$TEMP_DIR/backup.sha256"
  python3 - "$TEMP_DIR/backup.sql.gz" "$TEMP_DIR/backup.sha256" <<'PY' || fail "Invalid or mismatched checksum"
import hashlib
from pathlib import Path
import re
import sys

backup, sidecar = map(Path, sys.argv[1:])
match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *][^\r\n]+\n?", sidecar.read_text())
if match is None:
    raise SystemExit("Expected exactly one sha256sum record")
with backup.open("rb") as stream:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    actual = digest.hexdigest()
if actual != match[1].lower():
    raise SystemExit("Backup checksum does not match")
PY
  log "Checksum verified for the selected backup bytes."
else
  log "No checksum sidecar; validating this legacy backup by gzip and trial restore."
fi
gzip -dc "$TEMP_DIR/backup.sql.gz" > "$TEMP_DIR/dump.sql"
[[ -s "$TEMP_DIR/dump.sql" ]] || fail "Decompressed backup is empty"

# pg_dump 17.6 emits its own restrict/unrestrict pair. Replace only those exact
# wrapper lines so our private random key protects the entire input, including
# old dumps. psql's COPY reader still handles data and the \. terminator.
python3 - "$TEMP_DIR/dump.sql" "$TEMP_DIR/import.sql" <<'PY'
from pathlib import Path
import re
import sys

source, destination = map(Path, sys.argv[1:])
with source.open("rb") as incoming, destination.open("wb") as outgoing:
    for line in incoming:
        if not re.fullmatch(rb"\\(?:un)?restrict [A-Za-z0-9]+\r?\n?", line):
            outgoing.write(line)
PY
log "Trial database: $TRIAL_DB"
log "Previous database after cutover: $PREVIOUS_DB"
read -r -p "Validate and replace $LIVE_DB using $FILE, preserving the previous database. Type RESTORE: " ANSWER
[[ "$ANSWER" == RESTORE ]] || fail "Restore cancelled"

LIVE_OID="$(admin "SELECT oid FROM pg_database WHERE datname = '$LIVE_DB' AND datallowconn;")"
[[ "$LIVE_OID" =~ ^[0-9]+$ ]] || fail "Live database not found or connections already disabled"
[[ -z "$(database_oid "$TRIAL_DB")" && -z "$(database_oid "$PREVIOUS_DB")" ]] || fail "Generated database name already exists"
admin "CREATE ROLE $TRIAL_ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$TRIAL_PASSWORD';"
ROLE_CREATED=1
admin "CREATE DATABASE \"$TRIAL_DB\" OWNER $TRIAL_ROLE TEMPLATE template0;"
TRIAL_OID="$(database_oid "$TRIAL_DB")"
[[ "$TRIAL_OID" =~ ^[0-9]+$ ]] || fail "Could not establish trial database identity; preserve $TRIAL_DB for inspection"
log "Database identities: original=$LIVE_OID trial=$TRIAL_OID. Preserve these OIDs for recovery."

# Authenticate as a limited role, rather than SET ROLE in a superuser session.
# Restricted mode blocks connection/shell escapes; -X ignores psqlrc files.
# Unsupported psql versions fail before reading the dump (17.6+ is required).
"${COMPOSE[@]}" exec -T -e "PGPASSWORD=$TRIAL_PASSWORD" db \
  psql -X -h 127.0.0.1 -U "$TRIAL_ROLE" -d "$TRIAL_DB" -v ON_ERROR_STOP=1 \
  --single-transaction -c "\restrict $RESTRICT_KEY" -f - -c "\unrestrict $RESTRICT_KEY" \
  < "$TEMP_DIR/import.sql" || fail "Trial SQL restore failed; production is untouched"
"${COMPOSE[@]}" exec -T db psql -X -q -U deadlock -d "$TRIAL_DB" -v ON_ERROR_STOP=1 \
  -c "REASSIGN OWNED BY $TRIAL_ROLE TO deadlock;"
admin "ALTER DATABASE \"$TRIAL_DB\" OWNER TO deadlock;"
admin "DROP ROLE $TRIAL_ROLE;"
ROLE_CREATED=0

# Check selected web AND worker images in disposable read-only validators,
# using mounted secrets without starting application entrypoints/dependencies.
# This also works while application services are stopped. No schema upgrade is
# attempted: an older snapshot requires a matching release image.
for service in web worker; do
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint python "$service" - "$TRIAL_DB" "$LIVE_DB" <<'PY' || fail "$service runtime is incompatible with the trial; production is untouched"
import sys
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from app import models  # registers the complete expected schema
from app.config import settings
from app.db import Base

trial, live = sys.argv[1:]
url = make_url(settings.database_url)
if url.get_backend_name() != "postgresql" or url.database != live:
    raise SystemExit("Runtime database configuration does not target the expected live database")
heads = set(ScriptDirectory.from_config(Config("alembic.ini")).get_heads())
if len(heads) != 1:
    raise SystemExit("Runtime must contain exactly one Alembic head")
engine = create_engine(url.set(database=trial), connect_args={
    "connect_timeout": 5,
    "options": "-c default_transaction_read_only=on -c statement_timeout=15000",
})
try:
    with engine.connect() as connection, connection.begin():
        inspector = inspect(connection)
        tables = set(inspector.get_table_names(schema="public"))
        if "alembic_version" not in tables:
            raise SystemExit("Trial has no Alembic revision")
        revisions = set(connection.execute(text("SELECT version_num FROM public.alembic_version")).scalars())
        if revisions != heads:
            raise SystemExit("Trial Alembic revision does not match this runtime")
        for table in Base.metadata.sorted_tables:
            if table.name not in tables:
                raise SystemExit(f"Missing required table: {table.name}")
            columns = {item["name"]: item for item in inspector.get_columns(table.name, schema="public")}
            for column in table.columns:
                actual = columns.get(column.name)
                if actual is None:
                    raise SystemExit(f"Missing required column: {table.name}.{column.name}")
                expected_type, actual_type = column.type.as_generic(), actual["type"].as_generic()
                if not isinstance(actual_type, type(expected_type)):
                    raise SystemExit(f"Incompatible column type: {table.name}.{column.name}")
                length, actual_length = getattr(expected_type, "length", None), getattr(actual_type, "length", None)
                if length is not None and actual_length is not None and actual_length < length:
                    raise SystemExit(f"Column is too short: {table.name}.{column.name}")
                if getattr(expected_type, "timezone", None) != getattr(actual_type, "timezone", None):
                    raise SystemExit(f"Incompatible timestamp: {table.name}.{column.name}")
                if not column.nullable and actual["nullable"]:
                    raise SystemExit(f"Missing NOT NULL: {table.name}.{column.name}")
            primary_key = inspector.get_pk_constraint(table.name, schema="public")["constrained_columns"]
            if set(primary_key) != {column.name for column in table.primary_key.columns}:
                raise SystemExit(f"Incompatible primary key: {table.name}")
            connection.execute(select(table).limit(1)).first()
    print(f"Compatible runtime {settings.service_role} {settings.app_version}: revision {next(iter(heads))}, {len(Base.metadata.tables)} tables")
finally:
    engine.dispose()
PY
done
[[ "$(database_oid "$LIVE_DB")" == "$LIVE_OID" ]] || fail "Live database identity changed during validation"
[[ "$(database_oid "$TRIAL_DB")" == "$TRIAL_OID" ]] || fail "Trial database identity changed during validation"

CUTOVER_ATTEMPTED=1
SERVICES_TOUCHED=1
"${COMPOSE[@]}" stop web worker
admin "ALTER DATABASE \"$LIVE_DB\" ALLOW_CONNECTIONS false;
  ALTER DATABASE \"$TRIAL_DB\" ALLOW_CONNECTIONS false;"
admin "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname IN ('$LIVE_DB', '$TRIAL_DB') AND pid <> pg_backend_pid();"
# One PostgreSQL transaction changes both names: failed promotion leaves the
# original name intact. Connect to postgres, never either renamed database.
admin "BEGIN;
  ALTER DATABASE \"$LIVE_DB\" RENAME TO \"$PREVIOUS_DB\";
  ALTER DATABASE \"$TRIAL_DB\" RENAME TO \"$LIVE_DB\";
  ALTER DATABASE \"$LIVE_DB\" ALLOW_CONNECTIONS true;
  COMMIT;"
[[ "$(database_oid "$LIVE_DB")" == "$TRIAL_OID" && "$(database_oid "$PREVIOUS_DB")" == "$LIVE_OID" ]] || fail "Cutover identities could not be verified"
log "Restore cutover verified. Previous database: $PREVIOUS_DB (OID $LIVE_OID, connections disabled)."
log "No services were restarted automatically."
