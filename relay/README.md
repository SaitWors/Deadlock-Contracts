# Contract Relay на MCG server

Издатель `contract-relay-publisher` раз в минуту читает состояние и последние строки журнала локального Ingest через Docker. При работающем контейнере он добавляет CPU и приблизительное использование памяти из `docker stats`. Он атомарно записывает сводку в `/run/contract-relay-observation/status.json`. В сводке есть только статусы, подтверждённые журналом отметки времени и счётчики. Системная служба издателя работает без сетевого доступа. [Локальная диагностика](../docs/development/contract-relay-monitoring.md)

`contract-relay-manager` выполняет исходящие запросы к API Timeweb по HTTPS с проверкой сертификата и имени сервера. У службы нет доступа к Docker и файлам Steam-клиента. Менеджер посылает heartbeat примерно раз в минуту. При сбое он хранит один недоставленный heartbeat в `/var/lib/contract-relay-manager/delivery.json` и повторяет отправку с увеличивающейся задержкой и случайным разбросом. Указанный сервером `Retry-After` соблюдается. После 23 часов отчёт заменяется новым.

Сигнал об исчерпании квоты относится к наблюдаемой записи журнала. Остаток квоты, срок её восстановления, состояние Steam-сессии и время проверки контракта требуют отдельных наблюдений. Publisher передаёт только сводку. Веб-сессия Steam для автоподключения настраивается отдельно и остаётся на MCG.

## Подготовка без запуска

Нужны Linux, systemd 247 или новее, `/usr/bin/python3` версии 3.11 или новее, Git, Docker Compose v2 и локальный Docker Engine на `/var/run/docker.sock`. Системное время должно быть синхронизировано. С MCG server нужен доступ к домену сайта по HTTPS. Входящий порт и правила переадресации для Relay не нужны. [Документация systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)

Оператор фиксирует **полный хеш проверенного коммита** с этой реализацией. Из корня его Git-репозитория он подготавливает релиз. Эта команда устанавливает файлы по пути с хешем и не запускает службы.

```bash
release_sha='<полный хеш проверенного коммита>'
sudo bash relay/deploy.sh stage "$release_sha"
```

Создайте `/etc/contract-relay-manager/config` с владельцем `root`, правами `0600` и следующим содержимым. Домен замените на адрес своего сайта. Для узла только с правом heartbeat добавьте `RELAY_MANAGER_FLAGS=--heartbeat-only`.

```ini
RELAY_API_ORIGIN=https://contracts.example.org
RELAY_INGEST_CONTAINER=contract-relay-ingest
```

При первой установке создайте файл `/etc/contract-relay-manager/token` на MCG server. В примере `mcg` должен совпасть с именем узла на Timeweb. Команда пишет файл с правами `0600` без перевода строки и печатает SHA-256 для регистрации узла. Если файл уже существует, команда завершится без перезаписи. Сам токен хранится на MCG server. На Timeweb для регистрации передаётся только SHA-256.

```bash
sudo python3 - /etc/contract-relay-manager/token <<'PY'
import hashlib
import os
import secrets
import sys

token = ('mcg.' + secrets.token_urlsafe(32)).encode('ascii')
descriptor = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'wb') as handle:
    handle.write(token)
print(hashlib.sha256(token).hexdigest())
PY
```

Подготовьте пустой список ручных наблюдений с владельцем `root` и правами `0600`. Если файл уже существует, сохраните его содержимое.

```bash
sudo sh -c 'set -C; umask 077; printf "%s\n" "{\"observations\":[]}" > /etc/contract-relay-manager/friend-observations.json'
```

## Запуск и проверка

После регистрации узла и включения API оператор активирует проверенный релиз. Сохраните прежний хеш из `readlink /opt/contract-relay-manager/current`, если это обновление. Перед запуском скрипт проверяет существующие `/opt/contract-relay/compose.yaml` и `/opt/contract-relay/compose.production.yaml` командой `docker compose config --quiet --no-env-resolution`. Compose применяет обычные настройки проекта из `.env`, пропускает `env_file` сервисов и ничего не выводит оператору. Запуск затрагивает только службы Relay. Скрипт проверяет их состояние и свежесть локальной сводки. При временной недоступности Timeweb менеджер продолжает попытки доставки. [Документация Docker Compose](https://docs.docker.com/reference/cli/docker/compose/config/)

```bash
sudo bash relay/deploy.sh activate "$release_sha"
systemctl is-active contract-relay-manager.service contract-relay-publisher.timer
sudo journalctl -u contract-relay-manager.service -u contract-relay-publisher.service -n 30 --no-pager
```

Сверьте локальную сводку с тем, что показывает админка сайта. При проверке учитывайте время приёма heartbeat, время наблюдения Ingest и состояние самого контейнера. `running` в сводке подтверждает процесс в Docker. Свежий heartbeat подтверждает доставку отчёта. Так можно понять, на каком этапе возник сбой.

## Ручная проверка дружбы

Для узла с правом записи оператор вручную сверяет выбранного участника в Steam. Идентификатор добровольного подключения (`connection_id`) берётся из админки. Сохраните сведения в `/etc/contract-relay-manager/friend-observations.json` с владельцем `root`, правами `0600` и реальным временем проверки по UTC. Одна запись на подключение, максимум 100 за раз. Не переносите отметку на новое подключение после отзыва согласия.

```json
{
  "observations": [
    {
      "connection_id": "00000000-0000-4000-8000-000000000001",
      "observed_at": "2026-11-27T08:30:00Z",
      "state": "connected"
    }
  ]
}
```

Допустимые значения `state` — `connected`, `disconnected`, `unknown`, `error`. После замены файла перезапустите только `contract-relay-manager.service`, чтобы systemd обновил его копию. На следующем цикле менеджер запросит текущие согласия и отправит ручные наблюдения только по совпадающим подключениям. Он пропускает наблюдения старше 23 часов и ограничивает один поиск 20 страницами. При ошибке чтения или поиска админка получит код события. Оператор принимает обычные заявки вручную в официальном интерфейсе Steam.

## Автоматическая сверка через Steam Web API

После согласованного обновления API Timeweb до миграции `0032` или новее оператор может отдельно включить сверку на MCG. Для этого нужен разрешённый к использованию ключ Steam Web API и доступный этому ключу список друзей служебного аккаунта Relay. Для закрытого списка Steam документирует ответ HTTP 401. [GetFriendList](https://partner.steamgames.com/doc/webapi/ISteamUser#GetFriendList) · [Правила Steam Web API](https://steamcommunity.com/dev/apiterms)

1. Сохраните ключ в `/etc/contract-relay-manager/steam-web-api-key` с владельцем `root` и правами `0600`. Подключите его в дополнении systemd для службы:

   ```ini
   [Service]
   LoadCredential=steam-web-api-key:/etc/contract-relay-manager/steam-web-api-key
   ```

2. Добавьте `--steam-id64 <SteamID64 служебного аккаунта Relay>` к `RELAY_MANAGER_FLAGS` в файле `/etc/contract-relay-manager/config`. Для узла нужны права на запись наблюдений. Флаг `--heartbeat-only` отключает сверку.
3. После разрешения на изменение служб перечитайте настройки systemd и перезапустите менеджер. В админке проверьте источник наблюдения Steam и его время на тестовом подключении.

Менеджер выполняет максимум одну сверку в час и соблюдает более долгий `Retry-After`. Он отправляет Timeweb только состояние, время, источник и идентификатор текущего согласия. При 401, ограничении частоты, ошибке сети или неполном ответе в heartbeat попадает код `friendship_sync_failed`. Действующие наблюдения не заменяются ошибкой и стареют по обычным правилам. Чтобы отключить сверку, достаточно убрать флаг и перезапустить только менеджер. Web API не занимает GC-сессию и использует свой ключ, который остаётся на MCG.

## Автоподключение и сбор матчей участников

Для этого режима нужны проверенный Timeweb с миграцией `0035`, узел с правом записи дружбы и выделенный Steam-аккаунт Relay. Менеджер читает список отношений непосредственно через Steam Community (`/textfilter/ajaxgetfriendslist`) и принимает только одобренные входящие заявки. Это веб-сессия без второго входа в Steam Client или Game Coordinator. До эксплуатации нужно согласовать использование автоматизации с Valve и проверить эти интерфейсы на выделенном тестовом аккаунте. [Условия Steam, раздел 4](https://store.steampowered.com/subscriber_agreement/#4) · [Формат списка Steam](https://github.com/SteamDatabase/Protobufs/blob/master/webui/service_friendslist.proto)

1. Подготовьте образ Ingest из зафиксированной версии исходного проекта. Патч применяется с проверкой к ревизии `d8d51587253c25e09368010d959e7618e0f7a345`. Хранилище Steam и журнал квот Ingest при обновлении остаются на прежних томах.

   ```bash
   relay_source="$PWD"
   upstream_revision=d8d51587253c25e09368010d959e7618e0f7a345
   git clone --no-checkout https://github.com/deadlock-api/deadlock-api-ingest.git relay-ingest-build
   git -C relay-ingest-build checkout --detach "$upstream_revision"
   git -C relay-ingest-build apply --check "$relay_source/relay/ingest/participants.patch"
   git -C relay-ingest-build apply "$relay_source/relay/ingest/participants.patch"
   docker build -t contract-relay-ingest:"$upstream_revision" relay-ingest-build
   ```

   [Исходный код Ingest и лицензия MIT](https://github.com/deadlock-api/deadlock-api-ingest/tree/d8d51587253c25e09368010d959e7618e0f7a345)

2. На MCG создайте системную группу `contract-relay-collector`. В файл `/etc/contract-relay-manager/steam-login-secure` с правами `0600` и владельцем `root` поместите значение `steamLoginSecure` из веб-сессии выделенного аккаунта на `steamcommunity.com`. Менеджер использует веб-сессию непосредственно на Steam Community, без обмена на токен через `/chat/clientjstoken`. Этот интерфейс не является публично документированным Steam Web API; его доступность и полноту ответа необходимо подтвердить на выделенном аккаунте. При ошибке менеджер не считает список пустым и не публикует допуск к сбору. При истечении браузерной сессии обновите файл и перезапустите менеджер. Дополнение systemd для `contract-relay-manager.service`:

   ```ini
   [Service]
   Group=contract-relay-collector
   RuntimeDirectory=contract-relay-collector
   RuntimeDirectoryMode=0750
   RuntimeDirectoryPreserve=yes
   LoadCredential=steam-login-secure:/etc/contract-relay-manager/steam-login-secure
   ```

   Добавьте к `RELAY_MANAGER_FLAGS` параметры `--steam-auto-enrollment --steam-id64 <SteamID64 Relay> --collector-allowlist /run/contract-relay-collector/participants.json`. Этот режим использует веб-сессию вместо отдельной почасовой сверки по ключу Web API.

3. После согласованного обновления сайта и менеджера укажите новый образ в имеющемся Compose MCG. Пример для сервиса с именем `ingest`:

   ```yaml
   services:
     ingest:
       image: contract-relay-ingest:d8d51587253c25e09368010d959e7618e0f7a345
       environment:
         RELAY_COLLECTOR_ALLOWLIST: /run/contract-relay-collector/participants.json
       volumes:
         - /run/contract-relay-collector:/run/contract-relay-collector:ro
   ```

   Если контейнер работает от непривилегированного пользователя, добавьте в `group_add` числовой GID группы. Монтируйте каталог целиком, чтобы Ingest видел атомарную замену файла.

4. Для проверки включите `CONTRACT_RELAY_AUTO_ENROLLMENT_ENABLED` на Timeweb. Проверьте один зарегистрированный аккаунт, один незарегистрированный и отключение через профиль. У зарегистрированного дождитесь реальной дружбы, источника `steam_session` в админке и обработки его матча после очередного цикла Ingest. Проверьте, что незарегистрированная заявка осталась входящей, а отключённый игрок исчез из списка сбора. Для теста недоступности остановите менеджер в тестовой среде и убедитесь, что по истечении двух минут Ingest приостанавливает сбор через GC.

Менеджер запускает цикл примерно раз в минуту. За цикл он проверяет до 10 заявок и делает до трёх попыток приёма. Недоступность Steam или Timeweb приостанавливает сбор и отражается в админке. Ingest проверяет список перед запросами истории и метаданных. В этом режиме общая очередь отключена, а расписание поиска, действующие квоты Ingest и фоновая проверка сайта продолжают работать по своим правилам.

## Smart Match Scheduler

Для обновления используются три режима Ingest. `legacy` сохраняет сбор по свежему списку допущенных друзей. `shadow` читает тот же список и очередь контрактов, проверяет сохранённые данные API и показывает расчётные решения. В `shadow` Ingest приостанавливает локальный сбор через Steam GC. `active` включает фактическое планирование. В каждом режиме Relay общая очередь Ingest выключена.

Сначала обновите [Timeweb](../DEPLOYMENT_NOTES.md#contract-relay-scheduler-на-timeweb), затем MCG. GHCR-образ появляется после проверенной сборки в `main`. В итогах задания **Ingest / publish verified digest** скопируйте полный адрес образа с `@sha256:`. Для сборки и тестов используется закреплённая ревизия Ingest. Если пакет приватный, Docker на MCG нужен доступ на чтение образа. Токен пакета хранится отдельно от Steam и Relay. [Исходники Ingest](https://github.com/deadlock-api/deadlock-api-ingest/tree/d8d51587253c25e09368010d959e7618e0f7a345) · [Документация GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

### Обновление MCG и запуск shadow

Работайте в Bash с доступом к локальному Docker Engine. Укажите полный коммит того же доверенного запуска CI и полный адрес образа из его итогов. Команды используют существующие Compose-файлы и сервис `ingest`.

```bash
set -euo pipefail
read -rp 'Коммит проекта из запуска CI: ' release_sha
read -rp 'Полный адрес образа GHCR с digest: ' RELAY_INGEST_IMAGE
[[ $release_sha =~ ^[a-f0-9]{40}$ ]]
[[ $RELAY_INGEST_IMAGE =~ ^ghcr\.io/saitwors/deadlock-contracts-relay-ingest@sha256:[a-f0-9]{64}$ ]]
export RELAY_INGEST_IMAGE
cd "$HOME/dc-relay-src"
git fetch origin main
git merge-base --is-ancestor "$release_sha" origin/main
previous_manager=$(basename "$(readlink -f /opt/contract-relay-manager/current)")
sudo bash relay/deploy.sh stage "$release_sha"
release="/opt/contract-relay-manager/releases/$release_sha"
cd /opt/contract-relay

base=(docker compose -f compose.yaml -f compose.production.yaml -f compose.collector.yaml)
old_container=$("${base[@]}" ps -q ingest)
[[ -n $old_container ]]
old_image=$(docker inspect --format '{{.Image}}' "$old_container")
RELAY_INGEST_USER=$(docker exec "$old_container" sh -ec 'printf "%s:%s" "$(id -u)" "$(id -g)"')
RELAY_INGEST_HOME=$(docker exec "$old_container" sh -ec 'printf "%s" "$HOME"')
[[ $RELAY_INGEST_USER =~ ^[1-9][0-9]*:[0-9]+$ && $RELAY_INGEST_HOME = /* ]]
export RELAY_INGEST_USER RELAY_INGEST_HOME
if ! docker pull --platform linux/amd64 "$RELAY_INGEST_IMAGE"; then
  read -rp 'Имя GitHub с доступом к приватному пакету: ' ghcr_user
  read -rsp 'Токен classic с read:packages: ' ghcr_token
  printf '\n'
  printf '%s' "$ghcr_token" | docker login ghcr.io --username "$ghcr_user" --password-stdin
  unset ghcr_token
  docker pull --platform linux/amd64 "$RELAY_INGEST_IMAGE"
fi
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$RELAY_INGEST_IMAGE") == "$release_sha" ]]

sudo install -d -m 0755 -o "${RELAY_INGEST_USER%:*}" -g "${RELAY_INGEST_USER#*:}" /var/lib/contract-relay-scheduler
manager_config=/etc/contract-relay-manager/config
manager_backup=$(sudo mktemp /etc/contract-relay-manager/config.before-scheduler.XXXXXXXX)
sudo install -m 0600 "$manager_config" "$manager_backup"
sudoedit "$manager_config"
```

В существующем `RELAY_MANAGER_FLAGS` допишите `--scheduler-queue /run/contract-relay-collector/queue.json`. Сохраните флаги автоподключения, SteamID64 и файл участников. Сохраните выведенные следующим блоком пути для отката вместе с коммитом предыдущего менеджера и ID образа.

```bash
printf 'Manager release: %s\nManager config backup: %s\nPrevious image ID: %s\n' \
  "$previous_manager" "$manager_backup" "$old_image"
sudo bash "$release/relay/deploy.sh" activate "$release_sha"
for second in {1..120}; do
  if sudo test -s /run/contract-relay-collector/participants.json \
    && sudo test -s /run/contract-relay-collector/queue.json; then
    break
  fi
  sleep 1
done
sudo test -s /run/contract-relay-collector/participants.json
sudo test -s /run/contract-relay-collector/queue.json

scheduled=("${base[@]}" -f "$release/relay/ingest/compose.scheduler.yaml")
export RELAY_SCHEDULER_MODE=shadow
"${scheduled[@]}" config --quiet
journal=$(docker exec "$old_container" sh -ec '
  realpath -e "${XDG_DATA_HOME:-$HOME/.local/share}/deadlock-api-ingest/gc-quota.json"
')
docker inspect --format '{{json .Mounts}}' "$old_container" | python3 -c '
import json, sys
from pathlib import PurePosixPath
target = PurePosixPath(sys.argv[1])
assert any(m["Type"] in ("bind", "volume") and m["RW"] and target.is_relative_to(m["Destination"])
           for m in json.load(sys.stdin)), "existing journal is outside the persistent mounts"
' "$journal"
"${scheduled[@]}" run --rm --no-deps --pull never --entrypoint /bin/sh ingest -ec '
  state="${XDG_DATA_HOME:-$HOME/.local/share}/deadlock-api-ingest/gc-quota.json"
  test "$(realpath -e "$state")" = "$1"
  test -s "$state" && test -w "$state" && test -w "$(dirname "$state")"
  test -r "$RELAY_COLLECTOR_ALLOWLIST" && test -r "$RELAY_COLLECTOR_QUEUE"
  test -w "$(dirname "$RELAY_SCHEDULER_STATUS")"
' sh "$journal"
"${base[@]}" stop ingest
"${scheduled[@]}" up -d --no-deps --force-recreate --pull never --no-build ingest
"${scheduled[@]}" ps ingest
sudo systemctl is-active contract-relay-manager.service contract-relay-publisher.timer
```

Если очередь ещё отсутствует, проверьте состояние менеджера и повторите две проверки файлов перед заменой Ingest. Убедитесь, что в фактической команде запущенного контейнера есть `--no-memory`. В админке проверьте режим `shadow`, свежесть очереди, расчётные решения и отсутствие новых расходов Steam GC. Проверьте отозванное согласие и игрока без подписанного контракта, совместный матч, очереди обеих категорий и отдельные фактические и расчётные счётчики.

Перезапуск контейнера использует его сохранённый режим. При последующем пересоздании используйте все четыре Compose-файла, тот же закреплённый образ и сохранённые значения `RELAY_INGEST_USER`, `RELAY_INGEST_HOME` и `RELAY_SCHEDULER_MODE`. Если прежний журнал потерян, восстановите его из подтверждённого состояния с учётом всех последующих расходов перед включением active.

### Активация и откат

После проверки shadow и согласования допустимости автоматизации запустите Ingest в `active`. При необходимости задайте меньшие эффективные лимиты через `RELAY_HISTORY_LIMIT` и `RELAY_METADATA_LIMIT`. Синхронизируйте часы MCG. Перед переключением убедитесь, что сохранён прежний журнал `gc-quota.json` на постоянном томе.

```bash
export RELAY_SCHEDULER_MODE=active
"${scheduled[@]}" config --quiet
"${scheduled[@]}" up -d --no-deps --force-recreate --pull never --no-build ingest
"${scheduled[@]}" ps ingest
```

Быстрая остановка Steam GC с сохранением наблюдений выполняется теми же командами с `RELAY_SCHEDULER_MODE=shadow`. Возврат к прежнему поведению на том же образе выполняется с `RELAY_SCHEDULER_MODE=legacy`, который учитывает сохранённую блокировку Steam. Для полного отката дождитесь окончания показанных в админке блокировок обоих типов, затем остановите Ingest, восстановите предыдущий образ через прежние Compose-файлы и верните менеджер и его конфигурацию. Если время блокировки неизвестно, оставьте сбор приостановленным полные 24 часа. Используйте актуальный журнал расходов с постоянного тома. Восстановление старой копии после новых запросов может скрыть расход квоты.

```bash
old_ref=$("${base[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["ingest"]["image"])')
[[ $(docker image inspect --format '{{.Id}}' "$old_ref") == "$old_image" ]]
"${scheduled[@]}" stop ingest
sudo install -m 0600 "$manager_backup" "$manager_config"
sudo bash "$release/relay/deploy.sh" rollback "$previous_manager"
"${base[@]}" config --quiet
"${base[@]}" up -d --no-deps --force-recreate --pull never --no-build ingest
"${base[@]}" ps ingest
```

После отката проверьте новый heartbeat, свежесть файла участников и журналы Ingest. Сохраните том Steam, том данных Ingest и каталог состояний менеджера при любом переключении. Участие существующего друга активируется из профиля, где он может дать явное согласие для текущей дружбы.

## Откат и остановка

Для отката укажите полный хеш предыдущего подготовленного релиза. Путь к состоянию доставки и файлы конфигурации остаются прежними. После отката проверьте heartbeat в админке.

При откате автоподключения выключите флаг на Timeweb и уберите параметры `--steam-auto-enrollment` и `--collector-allowlist` перед запуском прежнего менеджера. Ingest с включённым фильтром приостановит сбор через GC после истечения срока последнего списка.

```bash
sudo bash relay/deploy.sh rollback '<полный хеш предыдущего подготовленного релиза>'
```

Если это был первый запуск, остановка выполняется отдельно. При компрометации токена оператор также отзывает доступ узла на Timeweb.

```bash
sudo systemctl disable --now contract-relay-manager.service contract-relay-publisher.timer
sudo systemctl stop contract-relay-publisher.service
```

## Ротация токена

Выполните команду генерации с тем же именем узла, указав `/etc/contract-relay-manager/token.next` вместо `/etc/contract-relay-manager/token`. Установите на Timeweb новый SHA-256 с нужными правами узла. Затем атомарно замените старый файл и перезапустите менеджер. Повторный запуск Ingest не требуется. После ротации проверьте новый heartbeat на сайте.

```bash
sudo mv -Tf /etc/contract-relay-manager/token.next /etc/contract-relay-manager/token
sudo systemctl restart contract-relay-manager.service
```

Проверки без подключения к Steam или сайту можно запустить из корня репозитория командой `python3 -m unittest relay.test_manager`.
