#!/usr/bin/env sh
set -eu
BASE_URL="${BASE_URL:-http://localhost:8080}"
echo "Checking $BASE_URL/api/health"
curl -fsS "$BASE_URL/api/health"
echo
echo "OK"
