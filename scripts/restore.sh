#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 ]] || { echo "Использование: $0 backups/file.sql.gz" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FILE="$1"
[[ -f "$FILE" ]] || { echo "Файл не найден: $FILE" >&2; exit 1; }
read -r -p "Это удалит текущую БД и восстановит $FILE. Введите RESTORE: " ANSWER
[[ "$ANSWER" == "RESTORE" ]] || exit 1

docker compose --env-file .env.production -f compose.prod.yaml stop web worker
docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  psql -U deadlock -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS deadlock_contracts WITH (FORCE);"
docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  psql -U deadlock -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE deadlock_contracts OWNER deadlock;"
gzip -dc "$FILE" | docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  psql -U deadlock -d deadlock_contracts -v ON_ERROR_STOP=1
docker compose --env-file .env.production -f compose.prod.yaml start web worker
