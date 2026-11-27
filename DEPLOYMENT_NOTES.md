# Companion QA deployment notes

The public website currently serves the legacy pairing-code routes and web version `0.10.1-alpha.12`. The candidate uses the same heartbeat and bootstrap v1 wire contracts. The new browser pairing and uninstall survey require the backend in this PR. A release version string alone cannot verify the deployed commit.

## Staging

1. Use an isolated database, Redis, session secret and Steam access configuration. Provision `https://qa.deadlock-contracts.online` if this QA build must be reachable by Overwolf testers. Keep the production project and storage separate. Apply the migrations with `python -m app.migrate` and verify `python -m alembic current --check-heads` reports `0026`.
2. Set the environment values below on the stage. Confirm health and readiness, verify that `/pair` and `/companion/uninstall` return 200, and test both pairing methods with a Steam account that has access.
3. Build the QA OPK in the `companion` directory with Node and the standard `zip` command available. It uses the alternate origin for the API, pairing page and uninstall survey.

   ```bash
   COMPANION_QA_ORIGIN=https://qa.deadlock-contracts.online npm run build:opk
   npm run verify:opk -- dist/qa/Deadlock-Contracts-Companion-0.5.2-alpha.21-QA-standalone.opk
   ```

   PowerShell equivalent:

   ```powershell
   $env:COMPANION_QA_ORIGIN = 'https://qa.deadlock-contracts.online'
   npm run build:opk
   npm run verify:opk -- dist/qa/Deadlock-Contracts-Companion-0.5.2-alpha.21-QA-standalone.opk
   Remove-Item Env:COMPANION_QA_ORIGIN
   ```

   Windows-only development can use `http://127.0.0.1:<port>` with a local web server and test account. Steam authentication on that local setup depends on Steam's callback configuration. The public candidate is built without this variable. The normal QA bundle always contains the production-origin package.
4. Run all cases in [OVERWOLF_RELEASE_CHECKLIST.md](OVERWOLF_RELEASE_CHECKLIST.md). Use the staged ad flag alongside Overwolf's official test-creative control.

| Environment value | Stage | Production rollout |
| --- | --- | --- |
| `APP_BASE_URL`, `DOMAIN`, `TRUSTED_HOSTS` | Stage origin and hosts | Existing public host and trusted proxy configuration |
| `COMPANION_INGEST_ENABLED` | `true` | Keep current operator setting |
| `COMPANION_ADS_ENABLED` | `true` on isolated QA stage | `false` until Overwolf approval and owner authorization |
| `COMPANION_MINIMUM_VERSION` | `0.5.2-alpha.18` for compatibility checks | Keep the deployed floor during rollout |
| `COMPANION_PAIRING_TTL_MINUTES` | `10` by default | 2–60 minute supported range |
| `COMPANION_DEVICE_IDLE_DAYS` | `90` by default | Existing active credentials continue to work. Idle devices reconnect after the configured period. |
| `CLOSED_ALPHA`, `ALPHA_ALLOWED_STEAM_IDS` | Limit the review stage to intended Steam accounts as needed | Keep the project's public access policy |
| `OVERWOLF_QA_ACCESS_ENABLED`, `OVERWOLF_QA_ACCESS_CODE_HASH`, `OVERWOLF_QA_ACCESS_UNTIL` | Optional closed-alpha reviewer gateway with an expiring private code | Leave disabled when no reviewer window is needed |
| `COMPANION_DOWNLOAD_URL` | Stage OPK if deliberately exposed there | Change only after authorized delivery of the public OPK |

## Approved rollout and rollback

- Build and verify the backend image, then back up the database and record the current web and worker image tags, settings and Companion OPK download URL.
- Apply migration `0026` before replacing the web or worker image. Smoke the version gate, browser and legacy pairing, bootstrap, board lock and uninstall survey. Keep the existing Companion minimum until the new build is verified and distributed.
- Publish the public release OPK and update the download URL only after the owner authorizes publication. Submit the matching OPK to Overwolf with the test evidence. Production ads remain off until both approvals are recorded.
- To revert, restore the earlier web and worker images and previous download settings. The added table is compatible with the previous code and can stay in the database during rollback. Existing device rows and contract data are independent of it. Downgrading from `0026` to `0025` drops browser pairing sessions, so run that step only after reverting the application and closing any active review sessions.
## Contract Relay Scheduler на Timeweb

Команды запускаются оператором после слияния и проверок CI. Берите прежний каталог по метке работающего web-контейнера. Существующие тома, файлы секретов и конфигурация проекта используются повторно. Скрипт развёртывания делает резервную копию перед миграцией `0036`, которая добавляет признак категории для будущих наблюдений.

```bash
set -euo pipefail
project=deadlock-contracts
export COMPOSE_PROJECT_NAME=$project
web=$(docker ps --filter "label=com.docker.compose.project=$project" \
  --filter label=com.docker.compose.service=web --format '{{.ID}}')
[[ -n $web && $web != *$'\n'* ]]
previous=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$web")
[[ $previous = /opt/deadlock-contracts/* ]]
docker exec "$web" python -m alembic current
git -C "$previous" fetch origin main
read -rp 'Коммит проекта из проверенного запуска CI: ' release_sha
[[ $release_sha =~ ^[a-f0-9]{40}$ ]]
git -C "$previous" merge-base --is-ancestor "$release_sha" origin/main
git -C "$previous" merge-base --is-ancestor HEAD "$release_sha"
next="/opt/deadlock-contracts/releases/$release_sha"
git -C "$previous" worktree add --detach "$next" "$release_sha"
install -m 0600 "$previous/.env.production" "$next/.env.production"
ln -s "$(realpath "$previous/secrets")" "$next/secrets"
if [[ -d "$previous/runtime" ]]; then
  ln -s "$(realpath "$previous/runtime")" "$next/runtime"
fi
grep -q '^CONTRACT_RELAY_ENABLED=true$' "$next/.env.production"
grep -q '^CONTRACT_RELAY_AUTO_ENROLLMENT_ENABLED=true$' "$next/.env.production"
cd "$next"
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
bash scripts/deploy-current.sh
docker compose --env-file .env.production -f compose.prod.yaml exec -T web python -m alembic current --check-heads
curl -fsS https://deadlock-contracts.online/api/ready
printf '\nPrevious release: %s\n' "$previous"
```

После запуска проверьте heartbeat MCG, количество допущенных участников и формирование задач в админке. В случае отката сначала переключите MCG в `shadow`. Поднимите прежние `web` и `worker` из прежнего каталога, оставив занятые тома и аддитивную миграцию. Обычный скрипт выкладки старого коммита пытается сверять схему и применять миграции, поэтому здесь команды указаны отдельно.

```bash
cd "$previous"
rollback=(docker compose --env-file .env.production -f compose.prod.yaml)
"${rollback[@]}" build web worker
"${rollback[@]}" up -d --wait --wait-timeout 120 --no-deps --force-recreate web worker
"${rollback[@]}" up -d --no-deps --force-recreate caddy
"${rollback[@]}" ps web worker caddy
for service in web worker caddy; do
  container=$("${rollback[@]}" ps -q "$service")
  [[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]]
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container") == "$previous" ]]
done
curl -fsS https://deadlock-contracts.online/api/ready
```
