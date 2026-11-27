# Contract Relay на MCG server

Издатель `contract-relay-publisher` раз в минуту читает состояние и последние строки журнала локального Ingest через Docker. При работающем контейнере он добавляет CPU и приблизительное использование памяти из `docker stats`. Он атомарно записывает сводку в `/run/contract-relay-observation/status.json`. В сводке есть только статусы, подтверждённые журналом отметки времени и счётчики. Системная служба издателя работает без сетевого доступа. [Локальная диагностика](../docs/development/contract-relay-monitoring.md)

`contract-relay-manager` выполняет исходящие запросы к API Timeweb по HTTPS с проверкой сертификата, имени сервера и без перенаправлений. В службе нет доступа к Docker и Steam. Менеджер посылает heartbeat примерно раз в минуту. При сбое он хранит один недоставленный heartbeat в `/var/lib/contract-relay-manager/delivery.json` и повторяет отправку с увеличивающейся задержкой и случайным разбросом. Указанный сервером `Retry-After` соблюдается. После 23 часов отчёт заменяется новым. Steam ID из списка участников остаются в памяти на время запроса.

Сигнал об исчерпании квоты относится к наблюдаемой записи журнала. Остаток квоты, срок её восстановления, состояние Steam-сессии и время проверки контракта требуют отдельных наблюдений. Исходный журнал, loginusers, cookies, пароли, токены Steam и соли повтора менеджеру не передаются.

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

Допустимые значения `state` — `connected`, `disconnected`, `unknown`, `error`. После замены файла перезапустите только `contract-relay-manager.service`, чтобы systemd обновил его копию. На следующем цикле менеджер запросит текущие согласия и отправит ручные наблюдения только по совпадающим подключениям. Он пропускает наблюдения старше 23 часов и ограничивает один поиск 20 страницами. При ошибке чтения или поиска админка получит код события. Менеджер не входит в Steam и не принимает приглашения.

## Откат и остановка

Для отката укажите полный хеш предыдущего подготовленного релиза. Путь к состоянию доставки и файлы конфигурации остаются прежними. После отката проверьте heartbeat в админке.

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
