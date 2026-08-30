# Deadlock Contracts Companion 0.5.2-alpha.13 — матрица изменений

Основа: `Deadlock_Contracts_Companion_Alpha9_Exact_Replacement_Plan_RU` и проверенный production snapshot сайта `0.10.1-alpha.9`.

Статусы:
- **AUTO PASS** — изменение реализовано и покрыто автоматическим gate/test.
- **IMPLEMENTED / MANUAL** — код внесён; требуется реальный Windows/Overwolf/Deadlock smoke-test.
- **PROD ADAPTED** — требование скорректировано под фактически развёрнутый production API/маршрут.
- **SERVER PREREQ** — клиентская часть готова, но окончательная гарантия требует отдельного изменения backend перед QA/OPK.

## Lifecycle, GEP, queue, storage

| ID | Alpha.9 | Статус |
|---|---|---|
| DC-001 | `game_stopped` и `match_history` больше не создают synthetic final; terminal только из игрового proof/correlation | AUTO PASS |
| DC-002 | causal FIFO по `session_key + sequence`; final ждёт ack предшественников | AUTO PASS |
| DC-003 | `AUTH / RETRY / DEAD_LETTER`, max 8 retries, poison session не блокирует другую | AUTO PASS |
| DC-004 | desktop × скрывает окно; background/GEP/queue продолжают работать; Exit отдельный | AUTO PASS + MANUAL |
| DC-005 | terminal context/evidence захватываются immutable до задержки/correlation | AUTO PASS |
| DC-006 | обязательные local idempotency/session/match fields; final dedupe; production projection использует stable `client_event_id` | AUTO PASS + SERVER PREREQ |
| DC-007 | process start = `PROCESS_ONLY`; scoring session только по gameplay proof | AUTO PASS |
| DC-008 | GEP health `LIVE/LAGGING/STALE/UNAVAILABLE` по timestamps | AUTO PASS + MANUAL |
| DC-009 | evidence привязан к session/match, reset-aware; per-metric metadata содержит revision/value/observed_at/source | AUTO PASS |
| DC-010 | evidence/lifecycle checkpoint ограничен 15 s и transition/exit checkpoints | AUTO PASS |
| DC-011 | typed storage result + checksum/read-back + quota health | AUTO PASS |
| DC-012 | queue caps: 200 items / 1 MB; heartbeat compaction; critical data encrypted/exportable | AUTO PASS |
| DC-013 | auth transition только по HTTP 401/stable auth codes; 422 payload не очищает token | AUTO PASS |
| DC-014 | единый `transitionToUnpaired()` очищает auth/account state атомарно | AUTO PASS |
| DC-015 | reconnect single-flight: auth/queue/product/health recovery | AUTO PASS + MANUAL |
| DC-016 | `onGameInfoUpdated` основной источник + `getRunningGameInfo2()` watchdog 15/30 s | AUTO PASS + MANUAL |

## Контракты, schema, progress, локализация

| ID | Alpha.9 | Статус |
|---|---|---|
| DC-017 | `lte` — budget/within-limit; `0/5` не объявляется completed до final | AUTO PASS |
| DC-018 | exact overshoot отображается `OVERSHOT/MISSED` | AUTO PASS |
| DC-019 | desktop/overlay используют единый `DCProgress.evaluate()` | AUTO PASS |
| DC-020 | target/operator/id/mode валидируются; missing target не превращается в 0 | AUTO PASS |
| DC-021 | strict API/schema compatibility; current production bootstrap schema 1 разрешена через compat set | AUTO PASS |
| DC-022 | active case строго по текущему mode, без fallback другого режима | AUTO PASS |
| DC-023 | `PARTIALLY_SETTLED` — отдельный partial result | AUTO PASS |
| DC-024 | exhaustive status grouping | AUTO PASS |
| DC-025 | `null/undefined/'' → —`, настоящий `0 → 0` | AUTO PASS |
| DC-026 | attempt counters взаимно валидируются | AUTO PASS |
| DC-027 | Lock/Reroll fail-closed при offline/stale/incompatible/busy; при запущенной игре также блокируются на stale/unavailable GEP | AUTO PASS |
| DC-028 | lock confirmation показывает mode/expiry/attempt/contracts/reward/server data age | AUTO PASS + MANUAL |
| DC-029 | draft selection сохраняется по `board_id`, новый board сбрасывает старый draft | AUTO PASS + MANUAL |
| DC-030 | mode нормализуется в KNOWN/UNKNOWN/UNSUPPORTED, raw остаётся diagnostics | AUTO PASS |

## Pairing, auth, privacy

| ID | Alpha.9 | Статус |
|---|---|---|
| DC-031 | исходный план `/pair` скорректирован: production route отсутствует; кнопка открывает официальный сайт и явно ведёт `PROFILE → Companion` | PROD ADAPTED |
| DC-032 | durable typed pairing error + cause/request ID/retry guidance | IMPLEMENTED / MANUAL |
| DC-033 | `secureStorage` и `backend` health раздельны | AUTO PASS |
| DC-034 | decrypt failure → `AUTH_STORAGE_INVALID`, без молчаливого уничтожения unrelated cache/queue | AUTO PASS + MANUAL |
| DC-035 | `REVOKE & DISCONNECT` и offline `FORCE LOCAL SIGN-OUT` разделены | AUTO PASS + MANUAL |
| DC-036 | strict pair-code validation; paste/Enter; invalid chars не исправляются молча | AUTO PASS + MANUAL |
| DC-037 | pending queue/lifecycle encrypted; product cache sanitized; TTL + export/clear controls | AUTO PASS |
| DC-038 | SteamID masked по умолчанию; Show/Copy отдельно; overlay его не получает | AUTO PASS + MANUAL |
| DC-039 | FTUE/privacy copy соответствует SteamID/telemetry/sync/diagnostics/ad technical events | AUTO PASS |
| DC-040 | Sync возвращает structured result и показывает success только при успешном fresh result | AUTO PASS |

## Overlay, desktop, accessibility, support

| ID | Alpha.9 | Статус |
|---|---|---|
| DC-041 | overlay показывает stale/unavailable/backend recovery state | AUTO PASS + MANUAL |
| DC-042 | minimal DTO v2, revision-based render, 1 s fallback; size counter instrumented | AUTO PASS + MANUAL |
| DC-043 | информативный текст >= 11 px; contrast tokens проверяются >= 4.5:1 | AUTO PASS + MANUAL DPI |
| DC-044 | Never/5/10/30 s, default 10 s | AUTO PASS + MANUAL |
| DC-045 | UNASSIGNED warning + CTA в Overwolf hotkey settings | AUTO PASS + MANUAL |
| DC-046 | top-right placement + clamp on show/resolution change | IMPLEMENTED / MANUAL multi-monitor |
| DC-047 | overlay 440×280 с preset max 560×340 | AUTO PASS + MANUAL |
| DC-048 | hover-dodge/sensor удалён | AUTO PASS |
| DC-049 | overlay `resizable:false`, управление размером через presets | AUTO PASS |
| DC-050 | window actions проверяют success/state после операции | AUTO PASS + MANUAL |
| DC-051 | `overwolf.utils.Clipboard` + manifest `Clipboard`; `execCommand` удалён | AUTO PASS + MANUAL |
| DC-052 | modal focus trap/return/inert + ARIA tabs/keyboard | IMPLEMENTED / MANUAL keyboard |
| DC-053 | automated contrast gate: 28 token pairs >= 4.5:1 | AUTO PASS |
| DC-054 | game/GEP/auth/backend/storage/queue health разнесены | AUTO PASS |
| DC-055 | единый RU/EN catalog + locale-invariant fingerprints + critical UI string scanner | AUTO PASS |
| DC-056 | Help/Privacy/Support/Replay intro/export controls добавлены | AUTO PASS + MANUAL links |
| DC-057 | explicit desktop show: obtain → restore → bringToFront → verify | AUTO PASS + MANUAL |
| DC-058 | update states нормализованы/локализованы с retry path | AUTO PASS + MANUAL |
| DC-059 | OwAd failure скрывает rail и включает cooldown; game/hidden state shutdown | AUTO PASS + MANUAL ad test |

## Preview, automation, backend contract, release

| ID | Alpha.9 | Статус |
|---|---|---|
| DC-060 | bundled `fixtures/preview.json`, desktop/overlay используют packaged path | AUTO PASS + MANUAL preview |
| DC-061 | Node test runner, syntax/i18n/UI/contrast gates, CI, GEP traces | AUTO PASS |
| DC-062 | официальный GEP service status endpoint проверяется при start/failure/stale | AUTO PASS |
| DC-063 | privacy-safe diagnostics + anonymous install/runtime IDs + performance counters | AUTO PASS + MANUAL perf |
| DC-064 | bundled schemas/OpenAPI + contract tests against captured production contract | AUTO PASS; live staging MANUAL |
| DC-065 | `release.json` → generated `src/release-meta.js`; mismatch ломает release check | AUTO PASS |
| DC-066 | README, changelog, QA matrix, compatibility note, change/support matrices | AUTO PASS |
| PKG-001 | source ZIP имеет верхний каталог намеренно; будущий OPK должен паковать **содержимое** root с `manifest.json` в корне | AUTO PASS for source ZIP; OPK later |

## Отдельный backend prerequisite перед OPK/Overwolf QA

Source ZIP Alpha.9 не может сам изменить Timeweb backend. До OPK необходимо отдельно подтвердить/развернуть server-side terminal gate/quarantine/idempotency. Текущий production `0.10.1-alpha.9` совместим с Alpha.9 через `src/server-compat.js`: внутренний Evidence v8 проецируется в строгий heartbeat v1 allow-list, а stable local idempotency key — в `client_event_id`.

Нельзя переводить production minimum Companion version на Alpha.9 до ручного Windows QA.
