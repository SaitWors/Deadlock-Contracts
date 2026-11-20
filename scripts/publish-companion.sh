#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 - <<'PY'
import json
with open('companion/release.json') as f:
    companion = json.load(f)
with open('release.json') as f:
    project = json.load(f)
if (companion['product_version'] != project['companion_version']
        or companion['manifest_version'] != project['companion_manifest_version']):
    raise SystemExit('Project and Companion release.json versions disagree')
print(companion['product_version'])
PY
)"

echo "[publish-companion] Validating $VERSION source"
(
  cd companion
  npm run release:check
  npm run build:opk
  npm run verify:opk
)

OPK="$ROOT/companion/dist/Deadlock-Contracts-Companion-${VERSION}.opk"
[[ -f "$OPK" ]] || {
  echo "[publish-companion][FAIL] OPK not found: $OPK" >&2
  exit 1
}

DEST_DIR="$ROOT/runtime/downloads/companion"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/$(basename "$OPK")"
install -m 0644 "$OPK" "$DEST"
sha256sum "$DEST" > "${DEST}.sha256"

DOMAIN="${DOMAIN:-}"
if [[ -z "$DOMAIN" && -f .env.production ]]; then
  DOMAIN="$(sed -n 's/^DOMAIN=//p' .env.production | tail -n1 | tr -d '\r')"
fi

echo "[publish-companion] FILE=$DEST"
echo "[publish-companion] SHA256=$(sha256sum "$DEST" | awk '{print $1}')"
if [[ -n "$DOMAIN" ]]; then
  echo "[publish-companion] URL=https://${DOMAIN}/downloads/companion/$(basename "$DEST")"
else
  echo "[publish-companion] URL=https://<DOMAIN>/downloads/companion/$(basename "$DEST")"
fi
