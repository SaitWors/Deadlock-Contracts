#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"
[[ -f "$ENV_FILE" ]] || { echo "[qa-access][FAIL] .env.production not found" >&2; exit 1; }

read -r -s -p "Existing Overwolf QA code (Enter to generate a new one): " CODE
echo
GENERATED=false
if [[ -z "$CODE" ]]; then
  CODE="$(python3 - <<'PY'
import secrets
print("DCQA-" + secrets.token_urlsafe(20))
PY
)"
  GENERATED=true
fi

HASH="$(printf '%s' "$CODE" | sha256sum | awk '{print $1}')"
UNTIL="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=60)).replace(microsecond=0).isoformat().replace('+00:00', 'Z'))
PY
)"

python3 - "$ENV_FILE" "$HASH" "$UNTIL" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
updates = {
    "CLOSED_ALPHA": "true",
    "OVERWOLF_QA_ACCESS_ENABLED": "true",
    "OVERWOLF_QA_ACCESS_CODE_HASH": sys.argv[2],
    "OVERWOLF_QA_ACCESS_UNTIL": sys.argv[3],
}
lines = path.read_text(encoding="utf-8").splitlines()
seen = set()
result = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        result.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")
path.write_text("\n".join(result) + "\n", encoding="utf-8")
PY

chmod 600 "$ENV_FILE"
echo "[qa-access] Only the SHA-256 hash was written to .env.production."
echo "[qa-access] Access expires: $UNTIL"
if [[ "$GENERATED" == "true" ]]; then
  echo "[qa-access] Save and send this code to Overwolf through the approved reviewer channel; it is shown once:"
  printf '%s\n' "$CODE"
else
  echo "[qa-access] Existing code retained; plaintext was not stored."
fi
unset CODE
