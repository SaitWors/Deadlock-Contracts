#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p secrets; chmod 700 secrets
case "${1:-}" in
 telegram) file=secrets/telegram_bot_token.txt; prompt="Telegram bot token";;
 discord) file=secrets/discord_review_webhook_url.txt; prompt="Discord webhook URL";;
 webhook-secret) file=secrets/telegram_webhook_secret.txt; prompt="Telegram webhook secret";;
 *) echo "Usage: $0 telegram|discord|webhook-secret" >&2; exit 2;;
esac
read -r -s -p "$prompt: " value; echo
printf '%s' "$value" > "$file"; chmod 600 "$file"; chown 10001:10001 "$file" 2>/dev/null || true
echo "Saved to $file"
