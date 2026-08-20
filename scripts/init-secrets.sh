#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="$ROOT/secrets"
ENV_FILE="$ROOT/.env.production"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет .env.production. Скопируйте .env.production.example и укажите DOMAIN/ACME_EMAIL." >&2
  exit 1
fi

DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tail -n1 | tr -d '\r')"
if [[ ! "$DOMAIN" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$ ]]; then
  echo "Некорректный DOMAIN в .env.production: $DOMAIN" >&2
  exit 1
fi

mkdir -p "$SECRETS"
umask 077

python3 - "$SECRETS" <<'PY'
from pathlib import Path
import secrets
import sys

root = Path(sys.argv[1])
password = secrets.token_hex(32)
session = secrets.token_urlsafe(64)
files = {
    "postgres_password.txt": password,
    "database_url.txt": f"postgresql+psycopg://deadlock:{password}@db:5432/deadlock_contracts",
    "session_secret.txt": session,
}
for name, value in files.items():
    path = root / name
    if not path.exists():
        path.write_text(value + "\n", encoding="utf-8")
for name in ("admin_totp_secret.txt", "deadlock_api_key.txt", "steam_web_api_key.txt", "telegram_bot_token.txt", "telegram_webhook_secret.txt", "discord_review_webhook_url.txt"):
    path = root / name
    if not path.exists():
        path.write_text("\n", encoding="utf-8")
PY

chmod 700 "$SECRETS"
chmod 600 "$SECRETS"/*.txt
# web/worker run as the non-root UID 10001. Compose file secrets are bind
# mounts, so their host ownership must allow that UID to read them.
chown 10001:10001 \
  "$SECRETS/database_url.txt" \
  "$SECRETS/session_secret.txt" \
  "$SECRETS/deadlock_api_key.txt" \
  "$SECRETS/steam_web_api_key.txt" \
  "$SECRETS/telegram_bot_token.txt" \
  "$SECRETS/telegram_webhook_secret.txt" \
  "$SECRETS/discord_review_webhook_url.txt"
chown 0:0 "$SECRETS/postgres_password.txt"
chown 0:10001 "$SECRETS/admin_totp_secret.txt"
chmod 640 "$SECRETS/admin_totp_secret.txt"

echo "Секреты созданы в $SECRETS с правами 600."
echo "Не отправляйте эту папку в Git, мессенджеры или публичные архивы."
