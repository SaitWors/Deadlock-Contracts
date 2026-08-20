#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${1:-}"
if [[ ! "$ACCOUNT_ID" =~ ^[0-9]{1,10}$ ]]; then
  echo "Использование: $0 ACCOUNT_ID" >&2
  echo "ACCOUNT_ID — 32-битный Steam Account ID, не SteamID64." >&2
  exit 2
fi

HEADERS="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HEADERS" "$BODY"' EXIT

curl -sS --connect-timeout 10 --max-time 30 \
  -D "$HEADERS" -o "$BODY" \
  "https://api.deadlock-api.com/v1/players/${ACCOUNT_ID}/match-history"

echo "=== Provider headers ==="
grep -iE 'HTTP/|called-steam|retry-after|content-type' "$HEADERS" || true

echo
echo "=== Latest matches ==="
python3 - "$BODY" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if isinstance(payload, dict):
    for key in ("matches", "history", "data"):
        if isinstance(payload.get(key), list):
            payload = payload[key]
            break
if not isinstance(payload, list):
    raise SystemExit(f"Unexpected response shape: {type(payload).__name__}")

def integer(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0

matches = sorted(payload, key=lambda row: integer(row.get("start_time")), reverse=True)
for row in matches[:10]:
    started = integer(row.get("start_time"))
    started_text = datetime.fromtimestamp(started, timezone.utc).isoformat() if started else "unknown"
    print(
        f"match={row.get('match_id')} started={started_text} "
        f"match_mode={row.get('match_mode')} game_mode={row.get('game_mode')} "
        f"duration={row.get('match_duration_s')} outcome={row.get('player_match_outcome')} "
        f"K/D/A={row.get('player_kills')}/{row.get('player_deaths')}/{row.get('player_assists')}"
    )
PY
