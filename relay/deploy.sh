#!/usr/bin/env bash
set -euo pipefail

root=/opt/contract-relay-manager
config=/etc/contract-relay-manager
system_units=/etc/systemd/system
ingest_root=/opt/contract-relay
units=(contract-relay-manager.service contract-relay-publisher.service contract-relay-publisher.timer)

usage() {
    printf '%s\n' 'Usage: sudo bash relay/deploy.sh stage|activate|rollback FULL_GIT_COMMIT' >&2
    exit 2
}

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

check_python() {
    /usr/bin/python3 -Ec 'import sys; sys.exit(sys.version_info < (3, 11))' || fail 'Expected Python 3.11+ at /usr/bin/python3.'
}

check_ingest_compose() {
    [[ -r "$ingest_root/compose.yaml" && -r "$ingest_root/compose.production.yaml" ]] ||
        fail "Expected existing compose.yaml and compose.production.yaml under $ingest_root."
    local -a docker_cli=(env -u DOCKER_CONTEXT docker --host unix:///var/run/docker.sock)
    "${docker_cli[@]}" version --format '{{.Server.Version}}' >/dev/null 2>&1 || fail 'Local Docker Engine is unavailable.'
    "${docker_cli[@]}" compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable.'
    # Keep Compose's project interpolation and avoid reading service env files or printing configuration.
    (
        cd "$ingest_root"
        "${docker_cli[@]}" compose --project-directory "$ingest_root" \
            -f "$ingest_root/compose.yaml" -f "$ingest_root/compose.production.yaml" \
            config --quiet --no-env-resolution
    ) >/dev/null 2>&1 || fail 'Existing Ingest Compose files failed validation.'
}

[[ $# == 2 ]] || usage
action=$1
commit=$2
[[ $commit =~ ^[0-9a-f]{40}$ ]] || usage
[[ $EUID == 0 ]] || fail 'Run on the Relay host with sudo.'
release="$root/releases/$commit"

case "$action" in
    stage)
        [[ $(git -c safe.directory="$PWD" rev-parse --verify "$commit^{commit}") == "$commit" ]]
        check_python
        install -d -m 0755 "$root" "$root/releases"
        install -d -m 0700 "$config"
        if [[ ! -d $release ]]; then
            staging=$(mktemp -d "$root/releases/.stage.XXXXXXXX")
            trap 'rm -rf -- "$staging"' EXIT
            git -c safe.directory="$PWD" archive "$commit" relay scripts/contract_relay_status.py | tar -xf - -C "$staging"
            (cd "$staging" && /usr/bin/python3 -E -s -B -m relay.manager --help >/dev/null && /usr/bin/python3 -E -s -B -m relay.publisher --help >/dev/null)
            printf '%s\n' "$commit" > "$staging/REVISION"
            chmod 0755 "$staging"
            mv -T -- "$staging" "$release"
            trap - EXIT
        fi
        printf 'Staged %s\n' "$release"
        ;;
    activate|rollback)
        check_python
        systemd_version=$(systemctl --version) || fail 'systemd is unavailable.'
        read -r systemd_name systemd_major _ <<< "$systemd_version"
        [[ $systemd_name == systemd && $systemd_major =~ ^[0-9]+$ ]] && ((systemd_major >= 247)) || fail 'Expected systemd 247+.'
        [[ -r "$release/REVISION" && $(< "$release/REVISION") == "$commit" ]]
        for unit in "${units[@]}"; do
            [[ -f "$release/relay/systemd/$unit" ]]
        done
        for file in config token friend-observations.json; do
            [[ -f "$config/$file" && $(stat -c '%u:%a' "$config/$file") == 0:600 ]] || {
                printf 'Expected root-owned mode 0600 at %s/%s\n' "$config" "$file" >&2
                exit 1
            }
        done
        if [[ $action == activate ]]; then
            check_ingest_compose
        fi
        for unit in contract-relay-publisher.timer contract-relay-publisher.service contract-relay-manager.service; do
            if [[ $(systemctl show --property=LoadState --value "$unit") != not-found ]]; then
                systemctl stop "$unit"
            fi
        done
        temporary_link="$root/.current.$$"
        trap 'rm -f -- "$temporary_link"' EXIT
        ln -s -- "$release" "$temporary_link"
        mv -Tf -- "$temporary_link" "$root/current"
        for unit in "${units[@]}"; do
            install -m 0644 "$release/relay/systemd/$unit" "$system_units/$unit"
        done
        systemctl daemon-reload
        systemctl start contract-relay-publisher.service
        systemctl enable --now contract-relay-publisher.timer contract-relay-manager.service
        systemctl is-active --quiet contract-relay-publisher.timer || fail 'Relay publisher timer is inactive.'
        systemctl is-active --quiet contract-relay-manager.service || fail 'Relay manager service is inactive.'
        (
            cd "$release"
            /usr/bin/python3 -E -s -B - <<'PY'
from datetime import datetime, timedelta, timezone
from pathlib import Path

from relay.protocol import ingest_snapshot, read_json, utc

try:
    observation = ingest_snapshot(read_json(Path('/run/contract-relay-observation/status.json')))
    age = datetime.now(timezone.utc) - utc(observation['observed_at'])
    if not timedelta(0) <= age <= timedelta(minutes=2):
        raise ValueError('stale observation')
except (KeyError, OSError, TypeError, ValueError):
    raise SystemExit('Relay publisher did not produce a fresh typed snapshot') from None
PY
        )
        printf 'Active Relay release %s\n' "$commit"
        ;;
    *) usage ;;
esac
