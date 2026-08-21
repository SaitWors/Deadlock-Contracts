# Test report — Companion 0.5.0-alpha.3

Дата: 2026-08-18.

## Автоматические проверки

| Набор | Результат |
|---|---:|
| Companion release/product/session-guard tests | 16/16 PASS |
| JavaScript syntax (`src`, `scripts`, `tests`) | PASS |
| Release checker: manifest/CSP/assets/permissions/secrets | PASS |
| Official Overwolf Draft-07 manifest schema | PASS |
| Backend/web `0.10.0-alpha.2` | 64/64 PASS |
| Post-final bounce + duplicate terminal regression | PASS |

Проверено, что клиент не принимает и не отправляет settlement authority: forged-поле `completion` получает `422`, а lock принимает только mode и 1–3 server option IDs.

## Визуальный QA

Headless Chromium, локальные self-hosted assets, строгий production CSP:

- 900×620;
- 1200×700;
- 1366×720;
- 1366×768;
- эквивалент 1920×1080 @ 125%;
- эквивалент 3840×2160 @ 150%;
- Overlay 420×196;
- Overlay 540×252.

Проверены HQ, Contracts, выбор карточки, lock confirmation, Active Case, History, Profile, Settings и оба размера Overlay. Горизонтального overflow, page errors, console errors и CSP violations не обнаружено. Сохранено 10 QA screenshots.

## Проверенные продуктовые состояния

- unpaired / connecting / online / offline / degraded / incompatible;
- loading / empty / retry / stale cache;
- board offered / locked;
- выбор 1–3 и блокировка четвёртого;
- reroll available / exhausted;
- Active Case / mode mismatch / live provisional / post-match only;
- history completed / failed / active;
- pairing, disconnect, sync, diagnostics, overlay scale/reset;
- EN/RU/AUTO и reduced motion.
- `PostGame → Init → GameInProgress` того же Match ID не открывает новую сессию;
- повторные `match_end`/recovery polls создают один `match_ended` upload key.

## Что требует реального Overwolf/Deadlock окружения

Следующие пункты нельзя честно закрыть в headless-контейнере и должны быть выполнены перед нажатием Submit:

1. Установка packed OPK в Overwolf Client.
2. Manual/dock/GameLaunch/mid-game launch.
3. Реальный Deadlock GEP: match start/end, roster, Steam identity, mode classification.
4. Fullscreen/windowed/Alt+Tab и изменённый hotkey.
5. Production pairing + deploy `desktop.v1` + финальная server settlement цепочка.
6. Антивирусная проверка финального OPK.
7. Проверка Appstore listing assets и privacy/support URLs в консоли разработчика.

Кодовый QA-кандидат и воспроизводимый OPK готовы; незакрытые пункты — внешняя pre-submission проверка, а не замаскированный runtime preview.
