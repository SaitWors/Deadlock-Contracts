# Deadlock Contracts — полный test/deploy runbook

Версии кандидата: Web/Backend `0.10.1-alpha.9`, Companion
`0.5.2-alpha.7`, Overwolf manifest `0.5.2.7`.

Alpha 6 собрана поверх присланной рабочей alpha 5. Не смешивайте файлы разных
OPK: тестируется и публикуется один frozen archive с одним SHA-256.

## 1. Локальные автоматические проверки

Рекомендуемая среда: Python 3.13, Node.js 22, pnpm 11.19.0, Docker Compose,
`zip` и `unzip`. Все команды выполняются из корня чистого checkout ветки PR.

### Backend

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
python -m pip check
python -m pip_audit -r requirements.txt
python -m compileall -q app alembic tests scripts
python -m ruff check app alembic tests scripts --select E9,F63,F7,F82
python -m pytest -q -p no:cacheprovider
python scripts/release_check.py .
```

Ожидается: `111 passed`, audits без известных уязвимостей и
`[release-check] PASS`.

### Frontend

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm exec oxfmt --check src vite.config.ts package.json index.html
pnpm exec tsc --noEmit
pnpm run build
cd ..
```

Ожидается: audit без известных уязвимостей, format/types/build без ошибок.

### Companion и frozen OPK

```bash
cd companion
node scripts/check-release.mjs
find src -type f -name '*.js' -print0 | xargs -0 -n1 node --check
node --test tests/*.test.mjs
node scripts/package-release.mjs
sha256sum dist/Deadlock-Contracts-Companion-0.5.2-alpha.7.opk
sha256sum dist/Deadlock-Contracts-Companion-0.5.2-alpha.7.cdx.json
unzip -t dist/Deadlock-Contracts-Companion-0.5.2-alpha.7.opk
node scripts/package-release.mjs
sha256sum dist/Deadlock-Contracts-Companion-0.5.2-alpha.7.opk
sha256sum dist/Deadlock-Contracts-Companion-0.5.2-alpha.7.cdx.json
node scripts/package-qa-bundle.mjs
cd ..
```

Ожидается: `57 passed`, две OPK/SBOM-сборки имеют одинаковые SHA-256:

```text
b1882c783159e9ce036ed3107ffdb5ff1fe8cf78248ab248a8a2f3a7376d8ecd  OPK
a5e30d1a921070dabd4edaf22fb49e1d738e9eb4c5e17bf756ce4b0718c8dcdc  CycloneDX SBOM
```

Если hash отличается, архив не отправляется тестерам: сначала выясняется
причина недетерминированности.

## 2. PostgreSQL migration gate

Используйте только отдельную пустую тестовую БД, никогда production URL.
GitHub CI автоматически проверяет blank bootstrap, ORM schema и
`previous -> current -> previous/current` smoke для последней миграции.

Эквивалентный локальный порядок после запуска throwaway PostgreSQL:

```bash
export DATABASE_URL='postgresql+psycopg://deadlock_ci:deadlock_ci_password@127.0.0.1:55432/deadlock_ci'
python -m app.migrate
python -m alembic current --check-heads
python -m alembic check
python scripts/ci_migration_smoke.py
python -m alembic current --check-heads
```

Проверить отдельно копию production backup: восстановить её в изолированную
БД, выполнить `python -m app.migrate`, затем smoke-сценарии раздела 3.

## 3. Web/API acceptance test

Проводится на staging с отдельными Steam-аккаунтами пользователя и админа.

### Пользовательская часть

1. Войти через Steam, выйти, повторно войти; проверить suspension и истечение
   сессии. Demo/dev auth в production должен быть выключен.
2. Открыть все три boards, выбрать 1/2/3 контракта и одновременно отправить
   два запроса lock. Должен появиться ровно один Active Case и ровно один
   первый job на контракт.
3. Одновременно отправить reroll из двух вкладок. Списывается одна попытка,
   состояние доски не раздваивается.
4. Пройти discovery -> verifying -> evaluation; убедиться, что XP в UI равен
   фактической записи ledger, а не клиентскому прогнозу.
5. Проверить stale LOCKED и stale VERIFYING/REVIEW: reconciler должен безопасно
   завершить lifecycle без ложного проигрыша и без награды.
6. Проверить history с несколькими evaluations, пагинацию и большие Match ID:
   во внешнем JSON Match ID всегда строка.
7. Проверить public profile/slug, конфликт slug в двух вкладках и showcase.
8. Переключить RU/EN, перезагрузить страницу и Companion; проверить сохранение
   locale и IANA timezone. Суточный reset остаётся глобальным UTC.
9. Проверить `/ru/privacy`, `/en/privacy`, Terms/Support, `/robots.txt`,
   `/sitemap.xml`, `/api/status`, `/api/health`, `/api/ready`.
10. Для 4xx/422/429/500 проверить безопасный объект `code`, `message_key`,
    локализованный `message` и `request_id`; traceback/секретов быть не должно.

### Pairing и Companion API

1. Создать pairing code, выполнить claim один раз и повторить тот же claim:
   повтор должен быть идемпотентным, код нельзя присвоить другому устройству.
2. Подключить два устройства одного пользователя и одновременно отправить
   snapshot одного Match ID. Должна остаться одна нормализованная evidence
   запись без lost update.
3. Отправить timestamp из далёкого будущего/прошлого: сервер его отклоняет и
   пишет диагностический `rejected_client_times`, но не меняет verdict.
4. Отключить сеть, накопить telemetry + terminal snapshot, перезапустить
   Companion и восстановить сеть. Terminal transition не теряется, а обычная
   telemetry уступает место при queue pressure.
5. Проверить смену Match ID: match-scoped state предыдущего матча очищается.
6. Подменить локальные win/XP/contract completion поля. Сервер не должен
   начислить XP без provider/evaluator result.

### Админ-панель

1. Проверить Steam allowlist + TOTP + CSRF и audit log на каждой mutation.
2. Изменить опубликованную mission: должна появиться новая DRAFT-версия, а
   опубликованный текст для действующих контрактов не меняется.
3. Публикация требует RU и EN; rollback делается публикацией сохранённой
   предыдущей версии.
4. Принять/отклонить internal review: создаётся неизменяемая Evaluation и
   стандартное `assignment.settled` outbox событие; прямой правки XP нет.
5. Проверить outbox filters/details/health. Replay разрешён только для
   dead-letter/unpublished события, требует причину и попадает в audit.
6. Retry board должен поставить jobs для всех уникальных final bound Match ID,
   не создавать дубликаты и не выбирать приблизительный матч.

## 4. Overwolf/Windows/Deadlock QA

Автотесты не заменяют этот этап. Установите exact OPK по hash через Overwolf
Developer Options/testing channel и используйте
`companion/docs/OVERWOLF_QA_HANDOFF_RU.md`.

Обязательная матрица:

- `1366x720 @100%`, `1366x768 @100%`, `1920x1080 @125%`,
  `3840x2160 @150%`;
- fullscreen/windowed, Alt+Tab, launch/exit/relaunch и установка во время игры;
- Standard, Ranked и Street Brawl на реальном GEP;
- hotkey show/hide, rebind без relaunch и `UNASSIGNED`;
- overlay input pass-through, hover dodge, bounds, auto-hide и положение
  относительно критического HUD;
- offline/reconnect, 1/2/3 контракта, длинные RU/EN названия;
- Desktop ad только в safe HQ state: никогда в overlay, FTUE, pairing,
  error/empty screen или `GameInProgress`;
- CPU/RAM/network, антивирус/VirusTotal frozen OPK.

Любой локальный verdict/XP, неправильный mode, реклама в gameplay или overlay,
потеря terminal snapshot, сломанный hotkey/rebind — stop-ship.

## 5. PR и release gate

1. Открыть PR из release-ветки; не push напрямую в `main`.
2. Дождаться зелёных jobs: Backend, Frontend, PostgreSQL migrations,
   Companion/OPK, Docker/release image.
3. Провести review diff и migration plan; merge только проверенный commit SHA.
4. Создать immutable tag/release и скачать OPK artifact именно из этого CI run.
5. Сверить artifact SHA-256 с QA report до testing-channel upload.

## 6. Production deployment

Сначала staging. На production сервере checkout должен указывать на exact
проверенный merge/tag; секреты не передаются в чат, Git или shell history.

```bash
git fetch --tags --prune
git checkout <verified-tag-or-sha>
python3 scripts/release_check.py .
./scripts/preflight.sh
./scripts/deploy-current.sh
```

`deploy-current.sh` выполняет release gate, build, запускает PostgreSQL и Redis,
ждёт health, создаёт checksum-verified backup до миграции, применяет Alembic,
явно запускает idempotent content-maintenance, пересоздаёт web/worker и
проверяет public version/access mode/worker/Redis.
Скопируйте новый backup и `.sha256` за пределы сервера.

Emergency switches в `.env.production`:

- `REWARD_SETTLEMENT_ENABLED=false` оставляет reward outbox события durable и
  непубликованными, не теряя их для последующего replay;
- `COMPANION_INGEST_ENABLED=false` закрывает pairing/heartbeat с безопасным 503;
- `COMPANION_ADS_ENABLED=false` не выдаёт клиенту feature `desktop_ads_v1`.
- `COMPANION_MINIMUM_VERSION` блокирует устаревшие клиенты стабильным 426,
  сохраняя pairing/очередь на клиенте для обновления; до завершения QA floor
  остаётся на подтверждённой alpha 5.

После изменения switch пересоздайте web/worker через тот же deploy script и
зафиксируйте причину/время инцидента. Ads по умолчанию выключены до Overwolf QA.

После deploy:

```bash
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --since=10m web worker redis
curl -fsS https://deadlock-contracts.online/api/health
curl -fsS https://deadlock-contracts.online/api/ready
curl -fsS https://deadlock-contracts.online/api/status
curl -fsS https://deadlock-contracts.online/robots.txt
curl -fsS https://deadlock-contracts.online/sitemap.xml
```

Затем повторить короткий acceptance: Steam login, board lock, pairing/heartbeat,
один тестовый lifecycle, RU/EN, admin outbox health. Следить за 5xx, queue age,
dead letters, worker restarts и Redis health.

## 7. Rollback

При ошибке остановить rollout и сохранить логи/request IDs. Не выполнять
Alembic downgrade на работающем трафике. Сначала откатить приложение на
предыдущий проверенный image/tag, если его schema-compatibility подтверждена.

Если повреждены данные или старая версия несовместима с новой схемой:

1. включить maintenance/закрыть запись;
2. сохранить аварийный backup текущего состояния;
3. взять точный pre-migration backup и проверить его `.sha256`;
4. выполнить `./scripts/restore.sh backups/<file>.sql.gz` — команда намеренно
   требует ручного подтверждения `RESTORE` и полностью заменяет БД;
5. развернуть предыдущий проверенный tag, выполнить health/smoke и только затем
   открыть трафик.

Restore сначала репетируется на staging. Наличие backup без успешной тестовой
реставрации не считается готовым rollback plan.
