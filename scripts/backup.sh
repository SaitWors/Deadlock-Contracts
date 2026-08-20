#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f .env.production ]] || { echo "[backup][FAIL] .env.production not found" >&2; exit 1; }
command -v docker >/dev/null || { echo "[backup][FAIL] Docker not found" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$ROOT/backups"
OUTPUT="$BACKUP_DIR/deadlock-contracts-${STAMP}.sql.gz"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)
"${COMPOSE[@]}" exec -T db pg_dump \
  --username=deadlock \
  --dbname=deadlock_contracts \
  --no-owner \
  --no-privileges \
  | gzip -9 > "$OUTPUT"

gzip -t "$OUTPUT"
[[ -s "$OUTPUT" ]] || { echo "[backup][FAIL] empty backup" >&2; exit 1; }
chmod 600 "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
chmod 600 "$OUTPUT.sha256"

echo "[backup] Created: $OUTPUT"
echo "[backup] Checksum: $OUTPUT.sha256"
echo "[backup] Store a copy outside this server before an upgrade."
