# Deadlock Contracts Companion

Текущие версии продукта, manifest, evidence и целевого backend указаны в
`release.json`. Последние изменения — в `RELEASE_NOTES_<product_version>_RU.md`.

Для подготовки QA-комплекта:

```bash
npm run release:check
npm run test:qa-bundle
npm run build:qa-bundle
```

На Linux / CI нужны Node.js 22, `zip` и `unzip`. Комплект появляется в
`release/`; его `CANDIDATE.json` фиксирует версии, имена файлов и SHA-256.
Проверка упаковки распаковывает исходники, запускает их release checks и
собирает OPK с тем же хешем. Порядок ручной проверки и отправки описан в
[QA_BUNDLE_START_HERE_RU.md](QA_BUNDLE_START_HERE_RU.md).

Состояние отправленной сборки команды:
[SUBMISSION_STATUS_RU.md](docs/review/SUBMISSION_STATUS_RU.md).
Версии и результаты ниже относятся к историческим релизам.

## История Alpha.16

Alpha.16 — QA-кандидат поверх проверенного Alpha.15: durable queued-match UX, сохранение `hero_id`, QA-cleanup diagnostics/naming и синхронизация release metadata. Финальный verdict и XP остаются server-authoritative.

## История Alpha.13

## Alpha.13 — post-match finality hardening + сохранение live evidence

Alpha.13 собрана поверх фактического QA-кандидата `0.5.2-alpha.12(4)` и прежде всего исправляет послеигровую доставку данных.

### Что исправлено

- `match_end` больше не замораживает финальный snapshot мгновенно. После подтверждённого terminal signal открывается **bounded grace window 5 секунд**, в течение которого Companion продолжает принимать поздние `roster`, `match_outcome`, `match_id` и `match_clock`.
- `TERMINAL_PENDING` вместе с proof/deadline сохраняется в checkpoint и восстанавливается после рестарта.
- Явный Exit при подтверждённом конце матча сначала создаёт и сохраняет durable final packet, а уже потом закрывает background root.
- Durable queue теперь сохраняет final **до** перевода lifecycle в `FINALIZED`, поэтому нет окна «сессия закрыта, а final ещё только в таймере».
- Causal queue key основан только на immutable `session_id`: `match_started` с ещё неизвестным Match ID и `match_ended` с уже известным Match ID остаются в одном FIFO.
- Queue schema v3 восстанавливает persisted `IN_FLIGHT` как `RETRY_WAIT`, сохраняя прежний idempotency key для безопасного повторения после crash/ACK-loss.
- При новой scoring-session очищается весь match-scoped state; Match ID/outcome/team/mode/clock предыдущего матча не могут протечь во вторую игру.
- Старый finalized Match ID используется как tombstone и не может привязаться к новой session до появления нового exact ID.
- При restart/getInfo identity (`match_id`) обрабатывается раньше phase/clock. Interrupted session с уже известным ID не оживает только по `GameInProgress`/clock без подтверждения identity.
- `match_outcome`, пришедший раньше Match ID, сначала привязывается к immutable session, а после появления exact ID получает корректный match marker.
- Сохраняются улучшения Alpha.12 для Street Brawl: partial roster не стирает уже известные метрики, меньшие временные значения не откатывают накопленный evidence, PostGame не считается окончанием всей Street Brawl scoring-session, overlay выбирает актуально меняющееся условие.

### Что намеренно НЕ заявляется

Alpha.13 закрывает bounded late-data/crash/queue проблемы вокруг финала, но **не вводит новый server contract `match_enriched`**. Данные, пришедшие произвольно поздно уже после завершения grace window, требуют отдельного совместного изменения Companion + backend. Это следующий этап, а не скрытая часть этого релиза.

Также автоматические тесты не заменяют реальный Windows / Overwolf / Deadlock QA. До отправки в QA channel необходимо проверить минимум: обычный матч, выход сразу после `match_end`, restart во время grace, offline→reconnect, две игры подряд, Standard/Ranked/Street Brawl, hotkey/overlay/DPI.

## Совместимость

- Product version: `0.5.2-alpha.13`
- Overwolf manifest: `0.5.2.13`
- Deadlock Game ID: `24482`
- Minimum GEP: `311.0.0`
- Local Evidence schema: `v8`
- Production backend target: `0.10.1-alpha.9`
- Server wire contract: `companion-heartbeat.v1`

Финальный verdict и XP остаются server-authoritative. Локальный GEP evidence помогает корреляции и UX, но не выдаёт награду сам.

## Release gates

Перед упаковкой:

```bash
npm run release:check
```

См. также:

- `CHANGELOG.md`
- `docs/release/AUTOMATED_TEST_REPORT_RU.md`
- `docs/release/ALPHA13_POSTMATCH_QA_RU.md` — обязательная ручная post-match матрица Alpha.13
- `docs/release/SOURCE_ZIP_AUDIT_RU.txt`
- `docs/release/ALPHA9_QA_MATRIX_RU.md` — исторически названная, но всё ещё используемая ручная runtime-матрица
- `docs/release/SUPPORT_MATRIX_RU.md`
- `docs/architecture/PRODUCTION_SERVER_COMPAT_RU.md`

Исходный ZIP — это **source artifact, не OPK**. OPK должен собираться только после зелёных release gates и затем проходить отдельную проверку установки в Overwolf.
