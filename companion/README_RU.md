# Deadlock Contracts Companion 0.5.2-alpha.3

Pre-submission кандидат публичного Overwolf-приложения. Desktop — основной gameplay hub; backend остаётся единственным authority для контрактов, verdict и XP, а сайт используется для Steam-входа, pairing, deep history/public dossier и admin.

## Что входит

- полноценные HQ / Contracts / Active Case / Debrief / History / Profile / Settings;
- реальные server-issued доски: STANDARD / RANKED / STREET_BRAWL;
- выбор 1–3 server option IDs, подтверждение и серверная фиксация;
- один общий дневной reroll и server reset time;
- единый Active Case в Desktop и компактном input-pass-through Overlay с single-focus live progress;
- provisional GEP-прогресс без права клиента закрыть контракт;
- Adaptive Profiles по трём режимам и объяснение `WHY THIS CONTRACT?`;
- post-match Debrief на authoritative evaluator/history/reward-ledger данных;
- реальный granted XP из server ledger, а не расчёт по потенциальной награде карточки;
- retryable miss показывает последнюю точную попытку, даже если backend уже освободил `bound_match_id` для следующей;
- AUTO / EN / RU, FTUE, offline/stale/incompatible/error states;
- Desktop 1200×700, resizable до минимума 900×620;
- Overlay host 420×320 с компактной 142px карточкой, пресетами S/M/L, hover dodge вниз и сбросом позиции;
- default hotkey `Ctrl+Shift+C`, но UI всегда читает фактический binding из Overwolf Settings и обновляет его без relaunch;
- `GameLaunch start_minimized=true`;
- self-hosted fonts, строгий CSP, OS-bound encrypted pairing token;
- только permissions `Extensions`, `GameInfo`, `Hotkeys`.

## Обязательная серверная версия

Сначала разверните **Web/Backend `0.10.1-alpha.6`**. Companion проверяет additive feature flags (`adaptive_profiles_v1`, `debrief_v1`) и не выдумывает Adaptive/Debrief данные при подключении к старому серверу.

## Файлы релиза

После `node scripts/package-release.mjs`:

- `dist/Deadlock-Contracts-Companion-0.5.2-alpha.3.opk` — packed OPK;
- `dist/SHA256SUMS.txt` — его SHA-256.

OPK — ZIP normal compression с `manifest.json` в корне. Preview fixture, tests, docs и server code в OPK не входят.

## Локальные автоматические проверки

```bash
node --test tests/*.test.mjs
node scripts/check-release.mjs
for f in src/*.js; do node --check "$f"; done
node scripts/package-release.mjs
```

Browser preview `/?preview=1` годится только для layout/data-state проверки. Он использует `tests/fixtures/preview.json`, который исключается из OPK и никогда не является runtime authority.

## Граница доверия

Companion может:

- запросить server boards/history/profile;
- отправить выбор server option IDs;
- передавать authenticated GEP/session evidence;
- показывать локальный live progress как `PROVISIONAL`.

Companion **не может** установить `COMPLETED/FAILED`, назначить reward/target, начислить XP, изменить role или объявить матч final. Verdict/settlement остаются на backend.

## Adaptive Contracts

Desktop не генерирует персональные цели. Он показывает immutable `BoardOption` и read-only `generator_meta.adaptive`, созданные сервером. При cold start/wildcard UI не маркирует контракт персонализированным без server evidence.

Adaptive Profile приходит отдельно по STANDARD / RANKED / STREET_BRAWL. Неизвестный будущий mode fail-closed: такой board/case не превращается молча в STANDARD/RANKED.

## Debrief

Debrief группируется по точному `last_attempt_match_id`/`latest_evaluation.match_id` и показывает:

- server evaluator status;
- текущий/последний progress, когда он authoritative;
- фактически начисленный `reward_granted_xp`;
- VERIFYING/REVIEW как ожидание сервера;
- retryable miss отдельно от окончательного закрытия задания;
- локальную статистику того же матча только с маркировкой `PROVISIONAL`.

## Overwolf QA

Автоматические unit/release проверки не заменяют реальный Overwolf/Deadlock QA. Перед submit пройти `docs/OVERWOLF_QA_HANDOFF_RU.md` и `docs/OVERWOLF_RELEASE_MATRIX_RU.md` именно на packed OPK.

Канонический визуал: near-black, cream typography, muted mint, тонкие рамки, минимальные радиусы, condensed/editorial headings, без generic SaaS/glassmorphism.
