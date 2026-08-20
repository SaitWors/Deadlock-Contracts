#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DOMAIN="$(sed -n 's/^DOMAIN=//p' .env.production | tail -n1 | tr -d '\r')"
URL="https://${DOMAIN}"

echo "== Containers =="
docker compose --env-file .env.production -f compose.prod.yaml ps

echo "== Published ports (должны быть только 80/443 у caddy) =="
docker compose --env-file .env.production -f compose.prod.yaml ps --format json || true

echo "== Security headers =="
HEADERS="$(mktemp)"; trap 'rm -f "$HEADERS"' EXIT
curl -fsSI "$URL/api/health" > "$HEADERS"
for header in content-security-policy strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy cache-control; do
  grep -qi "^${header}:" "$HEADERS" || { echo "Отсутствует $header" >&2; exit 1; }
done
cat "$HEADERS"

echo "== Sensitive endpoints =="
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$URL/docs")" == "200" ]] && { echo "WARN: /docs возвращает 200 (SPA), OpenAPI всё равно должен быть отключён"; } || true
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$URL/openapi.json")" == "200" ]] && { echo "FAIL: OpenAPI опубликован" >&2; exit 1; } || true
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL/api/auth/demo")" == "404" ]] || { echo "FAIL: demo auth не отключён" >&2; exit 1; }

echo "Проверка завершена."
