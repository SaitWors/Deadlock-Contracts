#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DIR="$ROOT/secrets"
FILE="$DIR/admin_totp_secret.txt"
mkdir -p "$DIR"
chmod 700 "$DIR"
if [ -s "$FILE" ]; then
  chown 0:10001 "$FILE"
  chmod 640 "$FILE"
  echo "ADMIN_TOTP_SECRET already exists: $FILE"
  echo "Permissions normalized to root:10001 / 640; secret was not rotated."
  exit 0
fi
SECRET="$(python3 - <<'PY'
import base64, secrets
print(base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('='))
PY
)"
printf '%s\n' "$SECRET" > "$FILE"
chown 0:10001 "$FILE"
chmod 640 "$FILE"
echo "Created: $FILE"
echo
echo "Add this setup key to your authenticator app manually:"
echo "$SECRET"
echo
echo "Do not send this key to anyone and do not put it in .env.production."
