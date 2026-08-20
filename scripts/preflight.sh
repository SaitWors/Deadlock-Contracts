#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "[FAIL] $*" >&2; exit 1; }
ok() { echo "[ OK ] $*"; }
warn() { echo "[WARN] $*"; }

command -v docker >/dev/null || fail "Docker не установлен"
docker compose version >/dev/null || fail "Docker Compose plugin не установлен"
[[ -f .env.production ]] || fail "Нет .env.production"

DOMAIN="$(sed -n 's/^DOMAIN=//p' .env.production | tail -n1 | tr -d '\r')"
EMAIL="$(sed -n 's/^ACME_EMAIL=//p' .env.production | tail -n1 | tr -d '\r')"
CONTACT="$(sed -n 's/^CONTACT_EMAIL=//p' .env.production | tail -n1 | tr -d '\r')"
CLOSED_ALPHA="$(sed -n 's/^CLOSED_ALPHA=//p' .env.production | tail -n1 | tr -d '\r')"
ALPHA_IDS="$(sed -n 's/^ALPHA_ALLOWED_STEAM_IDS=//p' .env.production | tail -n1 | tr -d '\r')"
QA_ENABLED="$(sed -n 's/^OVERWOLF_QA_ACCESS_ENABLED=//p' .env.production | tail -n1 | tr -d '\r')"
QA_HASH="$(sed -n 's/^OVERWOLF_QA_ACCESS_CODE_HASH=//p' .env.production | tail -n1 | tr -d '\r')"
QA_UNTIL="$(sed -n 's/^OVERWOLF_QA_ACCESS_UNTIL=//p' .env.production | tail -n1 | tr -d '\r')"
COMPANION_URL="$(sed -n 's/^COMPANION_DOWNLOAD_URL=//p' .env.production | tail -n1 | tr -d '\r')"
[[ "$DOMAIN" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$ ]] || fail "Некорректный DOMAIN"
[[ "$EMAIL" == *@*.* ]] || fail "Некорректный ACME_EMAIL"
[[ "$CONTACT" == *@*.* ]] || fail "Некорректный CONTACT_EMAIL"
ok "Конфигурация домена выглядит корректно: $DOMAIN"

if [[ "$COMPANION_URL" =~ ^https:// ]]; then
  ok "Companion download URL uses HTTPS"
else
  warn "COMPANION_DOWNLOAD_URL не задан как HTTPS; кнопка установки в профиле будет недоступна"
fi

if [[ "${CLOSED_ALPHA,,}" == "true" ]]; then
  [[ "$ALPHA_IDS" =~ ^[0-9]{17}(,[0-9]{17})*$ ]] || fail "ALPHA_ALLOWED_STEAM_IDS должен содержать SteamID64 (17 цифр), через запятую"
  if [[ "${QA_ENABLED,,}" == "true" ]]; then
    [[ "$QA_HASH" =~ ^[0-9a-f]{64}$ ]] || fail "OVERWOLF_QA_ACCESS_CODE_HASH должен быть SHA-256 hex; plaintext-код в env не хранится"
    [[ -n "$QA_UNTIL" ]] || fail "OVERWOLF_QA_ACCESS_UNTIL не задан"
    python3 - "$QA_UNTIL" <<'PYQA' || fail "OVERWOLF_QA_ACCESS_UNTIL истёк или некорректен"
from datetime import datetime, timezone
import sys
value = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
if value.tzinfo is None or value.astimezone(timezone.utc) <= datetime.now(timezone.utc):
    raise SystemExit(1)
PYQA
    ok "Closed Alpha + Overwolf QA reviewer gateway включены; deadline=$QA_UNTIL"
  else
    ok "Closed Alpha включена без reviewer gateway"
  fi
else
  [[ "${QA_ENABLED,,}" != "true" ]] || fail "В Open Beta OVERWOLF_QA_ACCESS_ENABLED должен быть false"
  ok "Web Open Beta включена: обычный Steam login открыт, reviewer bypass отключён"
fi

for file in postgres_password database_url session_secret deadlock_api_key steam_web_api_key; do
  [[ -f "secrets/${file}.txt" ]] || fail "Нет secrets/${file}.txt — запустите scripts/init-secrets.sh"
done
[[ $(wc -c < secrets/session_secret.txt) -ge 43 ]] || fail "SESSION_SECRET слишком короткий"
ok "Секретные файлы присутствуют"

ADMIN_IDS="$(sed -n 's/^ADMIN_STEAM_IDS=//p' .env.production | tail -n1 | tr -d '\r')"
if [[ -n "$ADMIN_IDS" ]]; then
  [[ -s secrets/admin_totp_secret.txt ]] || fail "ADMIN_STEAM_IDS задан, но нет secrets/admin_totp_secret.txt"
  ADMIN_UID="$(stat -c '%u' secrets/admin_totp_secret.txt)"
  ADMIN_GID="$(stat -c '%g' secrets/admin_totp_secret.txt)"
  ADMIN_MODE="$(stat -c '%a' secrets/admin_totp_secret.txt)"
  [[ "$ADMIN_UID" == "0" && "$ADMIN_GID" == "10001" ]] || fail "admin_totp_secret должен принадлежать root:10001"
  [[ "$ADMIN_MODE" == "640" || "$ADMIN_MODE" == "440" ]] || fail "admin_totp_secret должен иметь режим 640 или 440"
  ok "Admin TOTP secret имеет безопасные и читаемые контейнером права"
fi

if getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
  ok "DNS A-запись разрешается"
else
  warn "DNS A-запись пока не разрешается. HTTPS-сертификат не выпустится до обновления DNS."
fi

if curl -fsSIL --connect-timeout 8 --max-time 20 https://api.deadlock-api.com/docs >/dev/null; then
  ok "Сервер видит Deadlock API"
else
  fail "Сервер не может открыть https://api.deadlock-api.com/docs. Проверьте DNS/маршрутизацию или смените локацию VPS."
fi

if curl -fsSIL --connect-timeout 8 --max-time 20 https://steamcommunity.com/openid/ >/dev/null; then
  ok "Сервер видит Steam OpenID"
else
  fail "Сервер не может открыть Steam OpenID"
fi

if curl -fsS --connect-timeout 8 --max-time 20 https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/ >/dev/null; then
  ok "Сервер видит Steam Web API"
else
  warn "Steam Web API недоступен: вход сработает, но имя/аватар могут не обновиться."
fi

docker compose --env-file .env.production -f compose.prod.yaml config --quiet
ok "compose.prod.yaml прошёл проверку"

echo "Preflight завершён. Можно запускать production Compose."
