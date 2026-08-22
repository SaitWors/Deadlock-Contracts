# Deadlock Contracts Companion — QA candidate 0.5.2-alpha.4

Это pre-submission комплект, а не заявление об одобрении Overwolf.

## Порядок

1. Развернуть **Backend/Web `0.10.1-alpha.8`**.
2. Проверить production health/ready, pairing и server feature flags.
3. Установить packed `Deadlock-Contracts-Companion-0.5.2-alpha.4.opk` через Overwolf Developer Options.
4. Пройти `OVERWOLF_QA_HANDOFF_RU.md` на реальном Overwolf Client + Deadlock.
5. Проверить финальный OPK антивирусом/VirusTotal и только затем использовать его для submission.

## Что реально закрыто автоматикой 2026-08-19

- Companion unit/release/session/product suite: **39/39 PASS**.
- Backend/Web `0.10.1-alpha.8`: **93/93 PASS**.
- `node scripts/check-release.mjs`: PASS.
- JS syntax `src/*.js`: PASS.
- DOM ID/reference audit: PASS.
- EN/RU i18n parity + used-key audit: PASS.
- launcher ICO: только 16/32/48/256 layers, size gate PASS; PNG icon dimensions/size PASS.
- package secret/CSP/permission/runtime-asset checks: PASS.
- current official Overwolf manifest schema/documentation reviewed; a fresh automated schema download was blocked by sandbox DNS, so official AJV validation remains a pre-submit recheck instead of a claimed PASS.

## Что НЕ было автоматически доказано в sandbox

- реальный Windows/Overwolf runtime;
- packed OPK install/launch/exit;
- реальный Deadlock GEP для этого exact build;
- resolution/DPI/fullscreen/windowed/Alt+Tab;
- hotkey rebinding through Overwolf Settings on a real client;
- mid-game install;
- offline/performance/memory behavior on Windows;
- screenshot-based visual matrix: sandbox Chromium was blocked by environment policy, поэтому визуальный QA не объявляется выполненным;
- VirusTotal/antivirus.

## Ключевые исправления после глубокого аудита

- `UNRANKED` больше нельзя ошибочно классифицировать как `RANKED` по подстроке; mapping exact + fail-closed для неизвестных mode;
- live `object_damage` корректно попадает в provisional progress;
- Deadlock `VICTORY/DEFEAT` корректно мапятся в provisional `match.win` без превращения результата клиента в verdict;
- actual Overwolf hotkey binding и `UNASSIGNED` обновляются без relaunch;
- post-match server refresh bounded, без бесконечного polling;
- Debrief сохраняет последнюю evaluator attempt после release `bound_match_id`;
- XP берётся только из trusted reward-ledger sources; `ADMIN_ADJUSTMENT` не маскируется под reward контракта;
- malformed adaptive numbers не превращаются в NaN/Infinity UI;
- FTUE i18n больше не уничтожает DOM-элемент динамического hotkey.

## Граница доверия

Live GEP и локальный прогресс — provisional. Target/reward/status/finality/evaluator/settlement/XP остаются server-authoritative.
