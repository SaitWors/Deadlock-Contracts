#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose --env-file .env.production -f compose.prod.yaml)

log(){ printf '[deploy] %s\n' "$*"; }
fail(){ printf '[deploy][FAIL] %s\n' "$*" >&2; exit 1; }

[[ -f .env.production ]] || fail ".env.production not found"
EXPECTED_VERSION="$(sed -nE 's/^[[:space:]]*APP_VERSION:[[:space:]]*([^[:space:]#]+).*/\1/p' compose.prod.yaml | head -n1)"
[[ -n "$EXPECTED_VERSION" ]] || fail "APP_VERSION not found in compose.prod.yaml"
CONFIG_VERSION="$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('app/config.py').read_text()
m=re.search(r'app_version:\s*str\s*=\s*os\.getenv\("APP_VERSION",\s*"([^"]+)"\)', text)
print(m.group(1) if m else '')
PY
)"
[[ "$CONFIG_VERSION" == "$EXPECTED_VERSION" ]] || fail "source version mismatch: compose=$EXPECTED_VERSION config=$CONFIG_VERSION"
log "Expected version: $EXPECTED_VERSION"

python3 scripts/release_check.py .
./scripts/preflight.sh
log "Building migrate + web + worker"
"${COMPOSE[@]}" build migrate web worker

IMAGE_VERSION="$(docker run --rm --entrypoint python deadlock-contracts-web -c 'from app.config import settings; print(settings.app_version)' 2>/dev/null || true)"
[[ "$IMAGE_VERSION" == "$EXPECTED_VERSION" ]] || fail "built image version mismatch: expected=$EXPECTED_VERSION image=$IMAGE_VERSION"
log "Built image version verified: $IMAGE_VERSION"

log "Starting PostgreSQL + shared rate-limit Redis"
"${COMPOSE[@]}" up -d db redis

wait_healthy() {
  local service="$1"
  local container_id state
  container_id="$("${COMPOSE[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || fail "$service container id not found"
  for _ in $(seq 1 30); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$state" == "healthy" ]]; then
      log "$service is healthy"
      return 0
    fi
    if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
      "${COMPOSE[@]}" logs --tail=120 "$service" || true
      fail "$service became $state"
    fi
    sleep 2
  done
  "${COMPOSE[@]}" logs --tail=120 "$service" || true
  fail "$service health timeout"
}

wait_healthy db
wait_healthy redis

log "Creating verified pre-migration database backup"
./scripts/backup.sh

log "Applying database migrations"
"${COMPOSE[@]}" run --rm migrate
log "Database migrations completed"

log "Running idempotent offered-board content maintenance"
"${COMPOSE[@]}" run --rm web python -m app.maintenance upgrade-offered-boards

log "Recreating web + worker"
"${COMPOSE[@]}" up -d --no-deps --force-recreate web worker

web_id="$("${COMPOSE[@]}" ps -q web)"
worker_id="$("${COMPOSE[@]}" ps -q worker)"
redis_id="$("${COMPOSE[@]}" ps -q redis)"
[[ -n "$web_id" ]] || fail "web container id not found"
[[ -n "$worker_id" ]] || fail "worker container id not found"
[[ -n "$redis_id" ]] || fail "redis container id not found"

log "Waiting for web health"
for _ in $(seq 1 30); do
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$web_id" 2>/dev/null || true)"
  if [[ "$state" == "healthy" ]]; then break; fi
  if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
    "${COMPOSE[@]}" logs --tail=120 web || true
    fail "web became $state"
  fi
  sleep 2
done
state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$web_id" 2>/dev/null || true)"
[[ "$state" == "healthy" ]] || { "${COMPOSE[@]}" logs --tail=120 web || true; fail "web health timeout ($state)"; }

log "Checking worker stability"
initial_restarts="$(docker inspect --format '{{.RestartCount}}' "$worker_id")"
sleep 6
worker_state="$(docker inspect --format '{{.State.Status}}' "$worker_id")"
worker_restarting="$(docker inspect --format '{{.State.Restarting}}' "$worker_id")"
final_restarts="$(docker inspect --format '{{.RestartCount}}' "$worker_id")"
if [[ "$worker_state" != "running" || "$worker_restarting" != "false" || "$final_restarts" != "$initial_restarts" ]]; then
  "${COMPOSE[@]}" logs --tail=160 worker || true
  fail "worker unstable: state=$worker_state restarting=$worker_restarting restarts=$initial_restarts->$final_restarts"
fi
log "Worker stable: restarts=$final_restarts"

redis_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$redis_id" 2>/dev/null || true)"
[[ "$redis_state" == "healthy" ]] || { "${COMPOSE[@]}" logs --tail=120 redis || true; fail "redis is not healthy ($redis_state)"; }
log "Shared rate limiter is healthy"

DOMAIN="$(sed -n 's/^DOMAIN=//p' .env.production | tail -n1 | tr -d '\r')"
check_public(){ curl -fsS --connect-timeout 5 --max-time 12 "https://${DOMAIN}/api/health" >/tmp/dc-health.json && curl -fsS --connect-timeout 5 --max-time 12 "https://${DOMAIN}/api/ready" >/tmp/dc-ready.json; }
if ! check_public; then
  log "Public health failed after web recreate; restarting Caddy to refresh Docker DNS/upstream state"
  "${COMPOSE[@]}" restart caddy
  sleep 5
  check_public || { "${COMPOSE[@]}" logs --tail=120 caddy web || true; fail "public health still failing"; }
fi
PUBLIC_VERSION="$(python3 - <<'PY'
import json
try:
    print(json.load(open('/tmp/dc-health.json')).get('version',''))
except Exception:
    print('')
PY
)"
[[ "$PUBLIC_VERSION" == "$EXPECTED_VERSION" ]] || fail "public version mismatch: expected=$EXPECTED_VERSION public=$PUBLIC_VERSION"

# Access-mode invariant: support both the historical Closed Alpha reviewer flow
# and the current Web Open Beta.  Never silently deploy a configuration that
# exposes the reviewer bypass while public Steam login is open.
curl -fsS --connect-timeout 5 --max-time 12 "https://${DOMAIN}/api/status" >/tmp/dc-status.json || fail "public /api/status failed"
ACCESS_MODE="$(python3 - <<'PYACCESS'
import json
status=json.load(open('/tmp/dc-status.json'))
closed=bool(status.get('closed_alpha'))
reviewer=bool(status.get('overwolf_qa_reviewer_gateway'))
if not closed and reviewer:
    raise SystemExit(2)
print('closed_qa' if closed and reviewer else 'closed' if closed else 'open_beta')
PYACCESS
)" || fail "invalid access-mode invariant"
if [[ "$ACCESS_MODE" == "closed_qa" ]]; then
  curl -fsS --connect-timeout 5 --max-time 12 "https://${DOMAIN}/reviewer" >/dev/null || fail "/reviewer is not reachable during active Overwolf QA"
  log "Access mode verified: Closed Alpha + reviewer gateway"
elif [[ "$ACCESS_MODE" == "closed" ]]; then
  log "Access mode verified: Closed Alpha"
else
  log "Access mode verified: Web Open Beta (reviewer gateway disabled)"
fi
log "Health: $(cat /tmp/dc-health.json)"
log "Ready:  $(cat /tmp/dc-ready.json)"
"${COMPOSE[@]}" ps
log "Deployment completed"
