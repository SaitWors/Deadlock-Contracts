# Safe database restore

`scripts/restore.sh backups/file.sql.gz` accepts the plain SQL gzip format made by `scripts/backup.sh`. It validates a private copy, loads a uniquely named trial database, and checks compatibility before stopping `web` and `worker`. The live database is never dropped. A successful cutover retains it as `deadlock_contracts_previous_<timestamp>_<random>` with connections disabled.

**Changed restart behavior:** after a successful cutover or any failure during cutover, the script leaves services stopped. Resume them explicitly after selecting and verifying the matching application images. A rejected archive or trial leaves the running services and original database untouched.

## Before running

- Use a backup from a trusted installation and retain its `.sha256` sidecar. A checksum detects corruption; it does not authenticate the source. A moved backup is supported because verification hashes the selected file rather than following the path recorded in the sidecar. Legacy backups without a sidecar still require valid gzip, nonempty SQL and a successful trial.
- Run from the production checkout with `.env.production`, Docker Compose, Bash, `gzip`, Python 3 and `flock`. PostgreSQL/psql 17.6 or newer is required for restricted mode; the current production Compose pins `postgres:17.6-alpine`. An unsupported client fails before importing SQL. See the [17.6 release notes](https://www.postgresql.org/docs/release/17.6/) and [psql restricted mode](https://www.postgresql.org/docs/17/app-psql.html).
- The `db` container must be running and the live `deadlock_contracts` database must exist with connections enabled. Web and worker may already be stopped. The script probes the selected Compose web and worker images in disposable validators using their mounted database secrets. `run --rm --no-deps --entrypoint python` overrides the application entrypoints and skips migration/dependency startup; see [Docker Compose run](https://docs.docker.com/reference/cli/docker/compose/run/). It does not request a build or start the application services. Prepare the chosen release images before restore (`docker compose --env-file .env.production -f compose.prod.yaml build web worker` if needed). If either runtime is unavailable or the backup belongs to a different schema revision, validation aborts before service interruption. Rehearse older snapshots with the matching release images in a separate environment. This is an existing-database replacement procedure; it does not bootstrap a missing production database.
- The configured live database is `deadlock_contracts`, administered as `deadlock` through the `postgres` maintenance database. The import uses a temporary password-authenticated, nonsuperuser role over local TCP. The default production PostgreSQL image supports this. Hardened authentication rules that reject that connection cause a safe abort; do not bypass the restricted import by loading the dump as the administrator.
- Reserve space for a compressed snapshot, two decompressed SQL copies, the trial database and the retained original database. Avoid simultaneous deployment, migrations or other database administration. `runtime/restore.lock` excludes another restore from the same checkout; it does not coordinate other tools or hosts.

```bash
./scripts/restore.sh backups/deadlock-contracts-20261008T120000Z.sql.gz
```

Type `RESTORE` at the existing operator confirmation. Save the printed trial/previous names and original/trial OIDs with the operation log. No database password or database URL is printed.

## Validation and cutover

The trial import authenticates as a temporary `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` role. `psql -X`, a fresh restricted-mode key and `ON_ERROR_STOP` prevent startup files and dump metacommands from redirecting the import into the live database. The script replaces pg_dump's exact restrict/unrestrict wrapper lines; ordinary COPY data is preserved. The dump is imported in one transaction. Application backups that require extra superuser privileges or contain connection-switching commands are rejected.

Each selected application image opens a read-only connection to the trial database and verifies its single Alembic head against the restored revision. It checks every required ORM table and column, compatible column types and sizes, timestamp timezone, required NOT NULL columns and primary keys, then reads at most one row per table. Extra legacy tables/columns are allowed. These are runtime compatibility checks, not a complete semantic data audit or a replacement for application smoke tests.

Only then does the script stop services, disable new connections to both databases and terminate existing sessions. Both renames happen in one PostgreSQL transaction, connected to `postgres`: live → previous, trial → live. The retained database stays closed to connections. PostgreSQL permits database rename in a transaction; the nontransactional restriction in [ALTER DATABASE](https://www.postgresql.org/docs/17/sql-alterdatabase.html) applies to moving its tablespace.

| Result | Database state | Service action |
| --- | --- | --- |
| Invalid gzip/checksum, empty SQL, failed trial or runtime mismatch | Original name and identity unchanged; identified temporary trial/role cleaned up | Running services untouched |
| Successful cutover | Restored database has the live name; original OID survives under the printed previous name | Left stopped |
| Failed rename transaction | Original name restored and connections enabled | Left stopped |
| Client loses the cutover COMMIT response | Actual OIDs are checked; a committed cutover is renamed back when possible | Left stopped |
| Database unavailable or identities unexpected during recovery | Databases preserved for inspection; automatic rollback is reported as unverified | No automatic restart |

The EXIT/INT/TERM cleanup drops only the unique trial name when its OID still matches the captured trial identity. It never drops the live or previous name. A server/connection failure before identity capture can leave a temporary database or role for manual inspection. SIGKILL, host failure and loss of the PostgreSQL server cannot run shell traps.

## Resume after a verified cutover

Use the same selected images that passed validation. If image selection changed after validation, check the newly selected release against the restored schema in a separate environment first. Explicit recreation below uses the checked images rather than an older existing container. It skips dependencies/migrations, builds and pulls. Ensure the separately managed Redis service is available before resuming.

```bash
COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)
"${COMPOSE[@]}" ps -a
"${COMPOSE[@]}" exec -T db psql -X -U deadlock -d deadlock_contracts \
  -v ON_ERROR_STOP=1 -c 'SELECT version_num FROM public.alembic_version;'
"${COMPOSE[@]}" up -d --no-deps --force-recreate --no-build --pull never web worker
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail=100 web worker
```

Check web readiness and worker processing using the production runbook before reopening traffic. Keep the previous database until the restored application and data have been checked and the rollback retention decision is explicit.

## Inspect an uncertain outcome

Do not rerun restore over an uncertain cutover. Inspect names, OIDs and connection admission from the maintenance database:

```bash
COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)
"${COMPOSE[@]}" exec -T db psql -X -U deadlock -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT datname, oid, datallowconn FROM pg_database WHERE datname LIKE 'deadlock_contracts%' ORDER BY datname;"
```

Compare with the recorded OIDs. If `deadlock_contracts` already has the original OID and there is no previous name, the rename transaction rolled back. If needed, enable connections with the following command **after verifying that original identity**, then use the explicit resume steps with images compatible with that original database:

```bash
"${COMPOSE[@]}" exec -T db psql -X -U deadlock -d postgres -v ON_ERROR_STOP=1 \
  -c 'ALTER DATABASE deadlock_contracts ALLOW_CONNECTIONS true;'
```

If the live name has the trial OID and the previous name has the original OID, cutover committed. Resume the restored database or roll back using the next procedure. If names/OIDs differ from both known states, preserve all databases and resolve the state before renaming or starting services.

## Roll back to the retained original database

Fill in the **exact previous name and original OID printed by this restore**. This block verifies that identity before stopping services. It retains the restored database under a new name, performs the reverse renames in one transaction, and leaves services stopped. The names are validated and passed as quoted SQL identifiers.

```bash
(
  set -euo pipefail
  COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)
  PREVIOUS_DB='deadlock_contracts_previous_REPLACE_WITH_PRINTED_SUFFIX'
  ORIGINAL_OID='REPLACE_WITH_PRINTED_ORIGINAL_OID'
  RESTORED_DB="deadlock_contracts_restored_$(date -u +%Y%m%dT%H%M%SZ)"
  [[ "$PREVIOUS_DB" =~ ^deadlock_contracts_previous_[A-Za-z0-9_]+$ ]]
  [[ "$ORIGINAL_OID" =~ ^[0-9]+$ ]]
  ACTUAL_OID="$("${COMPOSE[@]}" exec -T db psql -X -q -At -U deadlock -d postgres \
    -v ON_ERROR_STOP=1 -c "SELECT oid FROM pg_database WHERE datname = '$PREVIOUS_DB';")"
  [[ "$ACTUAL_OID" == "$ORIGINAL_OID" ]] || { echo 'Previous identity mismatch; no changes made' >&2; exit 1; }
  "${COMPOSE[@]}" stop web worker
  "${COMPOSE[@]}" exec -T db psql -X -U deadlock -d postgres -v ON_ERROR_STOP=1 \
    -v previous="$PREVIOUS_DB" -v restored="$RESTORED_DB" <<'SQL'
ALTER DATABASE deadlock_contracts ALLOW_CONNECTIONS false;
ALTER DATABASE :"previous" ALLOW_CONNECTIONS false;
SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname IN ('deadlock_contracts', :'previous') AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE deadlock_contracts RENAME TO :"restored";
ALTER DATABASE :"previous" RENAME TO deadlock_contracts;
ALTER DATABASE deadlock_contracts ALLOW_CONNECTIONS true;
COMMIT;
SQL
  printf 'Original restored. Preserved restored snapshot: %s. Services remain stopped.\n' "$RESTORED_DB"
)
```

Inspect OIDs again after this block. If a command fails or the response is lost, inspect before repeating it. Select images compatible with the original schema and resume explicitly. An orphaned `*_trial_*` database or `dc_restore_*` role may be removed only after verifying it belongs to this recorded operation and is not the active/retained database; the script prints any cleanup failure instead of guessing.

## Verification limits and rehearsal

`tests/test_restore_safety.py` executes the real Bash script, real gzip and checksum operations, and filesystem cleanup. A controlled Docker/psql double supplies database identities, transaction failures and runtime-check outcomes. The regressions cover corrupt/empty archives, wrong/malformed checksums, trial import failure, incompatibility of either application runtime, connection-switching SQL, moved/legacy backups, validation with already stopped applications, old-database retention, failed promotion and a lost COMMIT response. They do not run PostgreSQL's authentication, SQL interpreter, schema inspector or Docker networking.

Before using the changed script on production, rehearse in an isolated disposable Compose project using the pinned PostgreSQL image and built application images: seed original data, create a real backup, exercise the corrupt archive/checksum and successful restore paths, compare the retained OIDs/data, and inject a failure in the second rename to verify PostgreSQL rollback. No live PostgreSQL or production restore was executed while developing this fix.

The SQL gzip is a database rollback backup. It does not include secrets/configuration, external evidence volumes, downloads or Caddy state; restoring a whole host requires those separate artifacts.
