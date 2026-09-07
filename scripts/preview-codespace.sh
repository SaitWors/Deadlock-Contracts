#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "${CODESPACES:-}" != "true" || -z "${CODESPACE_NAME:-}" ]]; then
  echo "Запусти эту команду в терминале GitHub Codespaces." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "В Codespace нужен Docker Compose. Пришли вывод docker compose version." >&2
  exit 1
fi

# Isolated Compose project, database and credentials. Never read a deployment .env.
export WEB_PORT=8080
preview_host="${CODESPACE_NAME}-${WEB_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
export APP_BASE_URL="https://${preview_host}"
export TRUSTED_HOSTS="localhost,127.0.0.1,testserver,${preview_host}"
export POSTGRES_DB=deadlock_preview POSTGRES_USER=deadlock_preview
export POSTGRES_PASSWORD=local_preview_database_only
export SESSION_SECRET
SESSION_SECRET="$(python3 - <<'PY'
from pathlib import Path
import secrets
path = Path('runtime/codespace-preview-session.txt')
path.parent.mkdir(parents=True, exist_ok=True)
if not path.exists():
    with path.open('x') as file:
        path.chmod(0o600)
        file.write(secrets.token_urlsafe(48))
print(path.read_text().strip())
PY
)"
export MATCH_PROVIDER=mock ALLOW_DEMO_AUTH=true ALLOW_DEV_ENDPOINTS=false
export DEADLOCK_API_KEY= STEAM_WEB_API_KEY= ADMIN_STEAM_IDS=
export TELEGRAM_BOT_TOKEN= TELEGRAM_REVIEW_CHAT_ID= TELEGRAM_WEBHOOK_SECRET=
export DISCORD_REVIEW_WEBHOOK_URL=
export TELEGRAM_WEBHOOK_ENABLED=false TELEGRAM_REVIEW_CALLBACKS_ENABLED=false
export ANNOUNCEMENTS_ENABLED=false ANNOUNCEMENTS_TELEGRAM_MIRROR_ENABLED=false

preview_compose=(docker compose --env-file /dev/null --project-name deadlock-contracts-preview --file compose.yaml)
case "${1:-start}" in
  stop) "${preview_compose[@]}" stop; exit ;;
  logs) "${preview_compose[@]}" logs --tail=100 web; exit ;;
  start) ;;
  *) echo "Использование: bash scripts/preview-codespace.sh [start|stop|logs]" >&2; exit 1 ;;
esac

"${preview_compose[@]}" build web
"${preview_compose[@]}" up -d --wait db
# The PostgreSQL schema must exist before web startup seeds the contract catalog.
"${preview_compose[@]}" run --rm --no-deps web python -m app.migrate
"${preview_compose[@]}" up -d --wait web
printf '\nОткрой порт 8080 во вкладке PORTS, видимость Private.\n'
printf 'Локальный адрес для проброса: http://localhost:8080\n'
printf 'Страница проверки: %s/dev/preview\n' "$APP_BASE_URL"
printf 'Это отдельная тестовая база. Проверка настоящих матчей здесь не запускается.\n'
