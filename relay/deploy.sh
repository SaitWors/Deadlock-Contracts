#!/usr/bin/env bash
set -euo pipefail

root=/opt/contract-relay-manager
config=/etc/contract-relay-manager
system_units=/etc/systemd/system
units=(contract-relay-manager.service contract-relay-publisher.service contract-relay-publisher.timer)

usage() {
    printf '%s\n' 'Usage: sudo bash relay/deploy.sh stage|activate|rollback FULL_GIT_COMMIT' >&2
    exit 2
}

[[ $# == 2 ]] || usage
action=$1
commit=$2
[[ $commit =~ ^[0-9a-f]{40}$ ]] || usage
[[ $EUID == 0 ]] || { printf '%s\n' 'Run on the Relay host with sudo.' >&2; exit 1; }
release="$root/releases/$commit"

case "$action" in
    stage)
        [[ $(git -c safe.directory="$PWD" rev-parse --verify "$commit^{commit}") == "$commit" ]]
        python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'
        install -d -m 0755 "$root" "$root/releases"
        install -d -m 0700 "$config"
        if [[ ! -d $release ]]; then
            staging=$(mktemp -d "$root/releases/.stage.XXXXXXXX")
            trap 'rm -rf -- "$staging"' EXIT
            git -c safe.directory="$PWD" archive "$commit" relay scripts/contract_relay_status.py | tar -xf - -C "$staging"
            (cd "$staging" && python3 -B -m relay.manager --help >/dev/null && python3 -B -m relay.publisher --help >/dev/null)
            printf '%s\n' "$commit" > "$staging/REVISION"
            chmod 0755 "$staging"
            mv -T -- "$staging" "$release"
            trap - EXIT
        fi
        printf 'Staged %s\n' "$release"
        ;;
    activate|rollback)
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
        printf 'Active Relay release %s\n' "$commit"
        ;;
    *) usage ;;
esac
