# Установка Deadlock Contracts Web v0.10.1-alpha.7 на хостинг

Инструкция рассчитана на чистый Ubuntu 22.04/24.04 VPS с публичным IPv4, доменом и доступом `root`/`sudo`. Production-схема: Caddy → FastAPI web + worker → PostgreSQL. Наружу публикуются только 80/443; база и приложение не получают публичных портов.

> Не распаковывайте релиз поверх работающего каталога. Создайте новый каталог, перенесите только `.env.production` и `secrets/`, проверьте его и лишь затем переключайте версию.

## 1. Подготовьте DNS и сервер

Создайте A-запись домена, например `contracts.example.com`, на IPv4 сервера. AAAA добавляйте только при реально работающем IPv6. Caddy выпустит и обновит HTTPS-сертификат автоматически, когда DNS уже указывает на сервер и доступны порты 80/443.

Для Timeweb Cloud перед обновлением включите резервное копирование в карточке сервера (`Серверы` → нужный сервер → `Бэкапы`) и сохраните отдельный SQL backup по разделу 5. Серверный backup полезен для аварийного восстановления, но не заменяет проверенный экспорт PostgreSQL. В облачном firewall оставьте входящие TCP 80/443, UDP 443 (HTTP/3, опционально) и TCP 22 — по возможности только с вашего административного IP. Не публикуйте 5432, 8000 или 8080. Официальные справки: [Firewall Timeweb Cloud](https://timeweb.cloud/docs/firewall) и [резервные копии серверов](https://timeweb.cloud/docs/cloud-servers/manage-servers/backup).

Откройте firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Установите Docker Engine и Compose plugin из официального репозитория Docker:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker --version
docker compose version
```

## 2. Проверьте и распакуйте архив

Загрузите ZIP на сервер. Сверьте опубликованный вместе с релизом SHA-256; если рядом загружен файл `.sha256`, выполните:

```bash
cd /tmp
sha256sum -c deadlock-contracts-web-vnext-0.10.1-alpha.7.zip.sha256
```

Без файла `.sha256` получите значение командой `sha256sum deadlock-contracts-web-vnext-0.10.1-alpha.7.zip` и сравните его посимвольно. После успешной сверки распакуйте релиз:

```bash
cd /tmp
sudo install -d -m 0750 /opt/deadlock-contracts/releases
sudo unzip -q deadlock-contracts-web-vnext-0.10.1-alpha.7.zip -d /opt/deadlock-contracts/releases
cd /opt/deadlock-contracts/releases/deadlock-contracts-web-vnext-0.10.1-alpha.7
sudo chmod +x scripts/*.sh scripts/*.py
```

Архив намеренно не содержит `.env.production`, `secrets/`, БД, backup, runtime-файлы, `node_modules` или собранный `dist`.

## 3. Настройте production

Работайте из каталога релиза:

```bash
sudo -i
cd /opt/deadlock-contracts/releases/deadlock-contracts-web-vnext-0.10.1-alpha.7
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Обязательно измените:

- `DOMAIN` — домен без `https://` и без пути;
- `ACME_EMAIL` — email для выпуска TLS;
- `CONTACT_EMAIL` — контакт на страницах Privacy/Terms/Support;
- `COMPANION_DOWNLOAD_URL` — публичная HTTPS-ссылка на проверенную OPK/store-сборку;
- `ALPHA_ALLOWED_STEAM_IDS` — SteamID64 владельца и тестеров, 17 цифр, через запятую;
- `ADMIN_STEAM_IDS` — SteamID64 администраторов, если admin console нужна;
- срок Overwolf QA — скрипт ниже выставит его автоматически.

Создайте секреты. Скрипт не перезаписывает уже существующие значения:

```bash
./scripts/init-secrets.sh
./scripts/set-api-key.sh steam
./scripts/set-api-key.sh deadlock
```

Steam Web API key используется для обогащения имени/аватара. Steam OpenID выполняет вход и не требует хранения пароля Steam. Если Deadlock data provider принимает публичные запросы, его key можно оставить пустым; при выданном ключе сохраните его через скрипт.

Если указан `ADMIN_STEAM_IDS`, создайте TOTP:

```bash
./scripts/init-admin-totp.sh
```

Добавьте показанный setup key в authenticator и не передавайте его в чат или Git.

Для закрытой альфы/Overwolf QA создайте либо сохраните уже переданный reviewer code:

```bash
./scripts/init-qa-access.sh
```

Если код уже был отправлен Overwolf, введите именно его. Если нажать Enter, скрипт создаст новый код и покажет его один раз. В `.env.production` сохраняется только SHA-256; plaintext туда не попадает. Передайте reviewer code только через утверждённый приватный канал.

## 4. Preflight и первый запуск

Preflight специально останавливает запуск, если домен, Closed Alpha, SteamID64, QA hash, срок доступа, секретные файлы или Compose некорректны:

```bash
./scripts/preflight.sh
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
```

Первый build может занять несколько минут. Проверьте:

```bash
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=150 web worker caddy
curl -fsS "https://$(sed -n 's/^DOMAIN=//p' .env.production)/api/health"
curl -fsS "https://$(sed -n 's/^DOMAIN=//p' .env.production)/api/ready"
curl -fsS "https://$(sed -n 's/^DOMAIN=//p' .env.production)/api/status"
BASE_URL="https://$(sed -n 's/^DOMAIN=//p' .env.production)" ./scripts/smoke.sh
./scripts/security-check.sh
```

Ожидается:

- `/api/health`: `status=ok`, `version=0.10.1-alpha.7`;
- `/api/ready`: `status=ready`;
- `/api/status`: `closed_alpha=true`, `overwolf_qa_reviewer_gateway=true`;
- `/reviewer` открывается, но reviewer code не выводится сервером;
- `/docs`, `/openapi.json` и demo auth недоступны в production;
- в `docker compose ps` healthy web/db и running worker/caddy.

После успешной проверки:

```bash
ln -sfn /opt/deadlock-contracts/releases/deadlock-contracts-web-vnext-0.10.1-alpha.7 /opt/deadlock-contracts/current
```

## 5. Обновление существующей 0.10.0-alpha.2 / 0.10.0-alpha.1

Сначала определите старый каталог и сделайте SQL backup. Команды ниже ничего не удаляют:

```bash
sudo -i
if [[ -f /opt/deadlock-contracts/current/compose.prod.yaml ]]; then
  OLD=/opt/deadlock-contracts/current
elif [[ -f /opt/deadlock-contracts/v035/compose.prod.yaml ]]; then
  OLD=/opt/deadlock-contracts/v035
elif [[ -f /opt/deadlock-contracts/compose.prod.yaml ]]; then
  OLD=/opt/deadlock-contracts
else
  echo "Не найден compose.prod.yaml старой установки" >&2
  exit 1
fi
printf 'Старая установка: %s\n' "$OLD"
cd "$OLD"
mkdir -p backups
chmod 700 backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  pg_dump -U deadlock -d deadlock_contracts --no-owner --no-privileges \
  | gzip -9 > "backups/before-alpha101-adaptive-${STAMP}.sql.gz"
gzip -t "backups/before-alpha101-adaptive-${STAMP}.sql.gz"
sha256sum "backups/before-alpha101-adaptive-${STAMP}.sql.gz" > "backups/before-alpha101-adaptive-${STAMP}.sql.gz.sha256"
```

Скопируйте backup за пределы VPS. Затем распакуйте новый релиз в отдельный каталог и перенесите конфигурацию:

```bash
NEW=/opt/deadlock-contracts/releases/deadlock-contracts-web-vnext-0.10.1-alpha.7
cp -a "$OLD/.env.production" "$NEW/.env.production"
cp -a "$OLD/secrets" "$NEW/secrets"
chmod 600 "$NEW/.env.production"
cd "$NEW"
```

Проверьте новые параметры:

```bash
grep -E '^(COMPANION_DOWNLOAD_URL|CLOSED_ALPHA|ALPHA_ALLOWED_STEAM_IDS|OVERWOLF_QA_ACCESS_ENABLED|OVERWOLF_QA_ACCESS_UNTIL)=' .env.production
```

Если `COMPANION_DOWNLOAD_URL` отсутствует, добавьте HTTPS-ссылку. Если QA hash/срок отсутствуют или истекли, выполните `./scripts/init-qa-access.sh`; уже переданный код не заменяйте без согласования с Overwolf.

Запуск обновления:

```bash
./scripts/preflight.sh
./scripts/deploy-current.sh
ln -sfn "$NEW" /opt/deadlock-contracts/current
```

Compose project называется `deadlock-contracts`, поэтому новый каталог повторно использует существующие именованные volumes PostgreSQL/Caddy/evidence. `.env.production` и `secrets/` всё равно копируются явно — они не входят в volumes и никогда не входят в релизный ZIP.

### 5.1. Проверка partial settlement и старого зависшего дела

При первом старте `worker` запускает idempotent startup repair `final-v5`. Он повторно ставит на автоматическую оценку только активные `VERIFYING`/`REVIEW_REQUIRED` назначения с точным привязанным Match ID и сохранённым сильным terminal evidence. Он не помечает контракт выполненным вручную и не начисляет XP напрямую.

Проверьте журнал и версию:

```bash
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=250 worker \
  | grep -E 'Startup finality repair|final-v5|evaluate-final-v4|ERROR|Traceback' || true
curl -fsS "https://$(sed -n 's/^DOMAIN=//p' .env.production)/api/health"
```

В кабинете старое дело должно выйти из бесконечного ожидания после штатного evaluate job. Результат каждого условия рассчитывается заново; не ожидайте автоматического `COMPLETED`, если фактическая цель не достигнута. Повторный job безопасен: settlement outbox и reward ledger защищены от двойного начисления.

Затем установите Companion `0.5.2-alpha.1` как packed OPK через Overwolf Developer Options. Эта версия добавляет Adaptive Profile/`WHY THIS CONTRACT?`, authoritative Debrief, dynamic Overwolf hotkey binding и bounded post-match refresh, сохраняя существующую session/finality защиту. Pairing token и серверная учётная запись должны сохраниться; если Overwolf потребует переподключение, создайте новый pairing code на сайте.

## 6. Rollback

Если новая версия не проходит smoke, переключите код обратно, не удаляя volumes:

```bash
sudo -i
PREVIOUS=/opt/deadlock-contracts/releases/ИМЯ_ПРЕДЫДУЩЕГО_РЕЛИЗА
cd "$PREVIOUS"
docker compose --env-file .env.production -f compose.prod.yaml up -d --build web worker caddy
ln -sfn "$PREVIOUS" /opt/deadlock-contracts/current
```

Восстановление SQL — отдельная разрушительная операция и обычно не требуется для отката кода. Используйте его только если подтверждено повреждение данных:

```bash
cd /opt/deadlock-contracts/current
./scripts/restore.sh /полный/путь/к/backup.sql.gz
```

Скрипт потребует вручную ввести `RESTORE`.

## 7. Что передать Overwolf QA

- URL сайта и путь `/reviewer`;
- reviewer code через приватный канал;
- SteamID64 reviewer не нужно добавлять в alpha allowlist: gateway пропускает его только после валидного Steam OpenID;
- версия Компаньона `0.5.2-alpha.1` и публичная ссылка на проверенную OPK/store build;
- краткий сценарий: Steam login → pairing → bootstrap → lock → active case → post-match verdict → archive;
- ссылка на Privacy, Terms и Support;
- указание, что Companion live telemetry предварительна, а verdict/XP серверные.

## Частые проблемы

- **Caddy не выдаёт сертификат:** DNS ещё не обновился, A/AAAA указывает не туда или закрыты 80/443. Не используйте AAAA без работающего IPv6.
- **`preflight` падает на QA:** hash должен быть 64 lowercase hex, срок — в будущем, `CLOSED_ALPHA=true`, reviewer gateway включён.
- **Compose не видит secret:** повторите `./scripts/init-secrets.sh`; каталог должен иметь 700, файлы 600/640.
- **Steam возвращает ошибку:** проверьте точный `DOMAIN`, HTTPS и исходящий доступ к `steamcommunity.com`.
- **Worker перезапускается:** `docker compose ... logs --tail=200 worker`; не сбрасывайте БД и не удаляйте volume до диагностики.

## Официальные материалы

- [Docker: Compose в production](https://docs.docker.com/compose/how-tos/production/)
- [Docker: `docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/)
- [Timeweb Cloud: Firewall](https://timeweb.cloud/docs/firewall)
- [Timeweb Cloud: резервные копии серверов](https://timeweb.cloud/docs/cloud-servers/manage-servers/backup)
- **Компаньон не видит доски:** проверьте pairing, HTTPS URL сервера и `GET /api/desktop/v1/bootstrap` в server logs; не подставляйте verdict на клиенте.
