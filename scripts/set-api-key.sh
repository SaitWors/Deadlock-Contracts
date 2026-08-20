#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/secrets"
umask 077

case "${1:-}" in
  steam) FILE="$ROOT/secrets/steam_web_api_key.txt"; LABEL="Steam Web API" ;;
  deadlock) FILE="$ROOT/secrets/deadlock_api_key.txt"; LABEL="Deadlock Game Data API" ;;
  *) echo "Использование: $0 steam|deadlock" >&2; exit 2 ;;
esac

read -r -s -p "Вставьте ключ $LABEL (Enter — оставить пустым): " VALUE
echo
printf '%s\n' "$VALUE" > "$FILE"
chmod 600 "$FILE"
chown 10001:10001 "$FILE"
unset VALUE
echo "Ключ сохранён в $FILE."
