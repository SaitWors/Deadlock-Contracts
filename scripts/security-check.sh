#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${1:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/compose.prod.yaml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: production env file not found: $ENV_FILE" >&2
  echo "Usage: $0 [path/to/.env.production]" >&2
  exit 2
fi

if [[ ! -r "$ENV_FILE" ]]; then
  echo "ERROR: production env file is not readable: $ENV_FILE" >&2
  exit 2
fi

DOMAIN="$(
  sed -n 's/^[[:space:]]*DOMAIN[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" \
    | tail -n1 \
    | tr -d '\r'
)"
DOMAIN="${DOMAIN#\"}"
DOMAIN="${DOMAIN%\"}"
DOMAIN="${DOMAIN#\'}"
DOMAIN="${DOMAIN%\'}"

if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: DOMAIN is missing or empty in $ENV_FILE" >&2
  exit 2
fi

if [[ "$DOMAIN" == *://* || "$DOMAIN" == */* || "$DOMAIN" =~ [[:space:]] ]]; then
  echo "ERROR: DOMAIN must contain a hostname only, got: $DOMAIN" >&2
  exit 2
fi

URL="https://${DOMAIN}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
CURL=(curl --connect-timeout 10 --max-time 30 --retry 2 --retry-all-errors)

echo "== Containers =="
"${COMPOSE[@]}" ps

echo "== Published ports (должны быть только 80/443 у caddy) =="
"${COMPOSE[@]}" ps --format json || true

echo "== Security headers =="
HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
"${CURL[@]}" -fsSI "$URL/api/health" > "$HEADERS"
for header in content-security-policy strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy cache-control; do
  grep -qi "^${header}:" "$HEADERS" || { echo "Отсутствует $header" >&2; exit 1; }
done
cat "$HEADERS"

echo "== Sensitive endpoints =="
DOCS_CODE="$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$URL/docs")"
OPENAPI_CODE="$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$URL/openapi.json")"
DEMO_CODE="$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' -X POST "$URL/api/auth/demo")"

if [[ "$DOCS_CODE" == "200" ]]; then
  echo "WARN: /docs returns 200 (possibly SPA); OpenAPI must still remain disabled"
fi

if [[ "$OPENAPI_CODE" == "200" ]]; then
  echo "FAIL: OpenAPI is publicly available" >&2
  exit 1
fi

if [[ "$DEMO_CODE" != "404" ]]; then
  echo "FAIL: demo auth is not disabled (HTTP $DEMO_CODE)" >&2
  exit 1
fi

echo "Проверка завершена."
