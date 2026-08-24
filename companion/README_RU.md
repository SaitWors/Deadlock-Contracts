# Deadlock Contracts Companion 0.5.2-alpha.6

QA candidate для Deadlock Contracts от Mandarin Creator Group. Desktop — основной control room. Сайт/Backend остаётся единственным authority для контрактов, вердиктов и XP; Companion не имеет права сам закрывать задания или выдавать награды.

## Что в этой версии

- реальные server-issued boards STANDARD / RANKED / STREET_BRAWL;
- выбор и server lock 1–3 `option_ids`, server reset/reroll, Active Case, Debrief, History и Profile;
- provisional live progress из GEP, но только server-authoritative verdict и `reward_granted_xp`;
- activity-focused Overlay без cross-mode fallback;
- фактический hotkey из Overwolf Settings: default `Ctrl+Shift+C`, update без relaunch и отображение `UNASSIGNED`;
- временный, input-pass-through Overlay: повторный hotkey скрывает его, иначе он сам исчезает через 6.5 сек;
- новый rounded motion design: progress sweep, смена focus, brief provisional completion burst, reduced-motion fallback;
- один подготовленный Overwolf Managed Ads `400×60` слот в Desktop HQ, без рекламы в Overlay и без рекламы при `GameInProgress`;
- self-hosted шрифты, строгий CSP, OS-bound encrypted pairing token.

## Версии и границы

- Companion: `0.5.2-alpha.6` / manifest `0.5.2.6`;
- требуется Backend/Web: `0.10.1-alpha.8`;
- Deadlock game id: `24482`;
- minimum Overwolf: `0.305.0.9`; minimum GEP: `311.0.0`.

Рекламный код готов к проверке, но объявления начинают реально отдаваться только после включения Overwolf. Этот архив не является гарантией одобрения QA: финальная проверка делается Overwolf на реальном Windows/Overwolf/Deadlock окружении.

## Локальные gates

```bash
npm test
npm run check
for f in src/*.js; do node --check "$f"; done
npm run package
node scripts/package-qa-bundle.mjs
```

Получившийся `.opk` — normal-compression ZIP с `manifest.json` в корне. Рядом создаются SHA-256 и воспроизводимый CycloneDX 1.6 SBOM с хешем каждого файла runtime. В OPK не попадают тесты, docs, preview fixture или server secrets.

## Перед Overwolf submission

Открыть `docs/OVERWOLF_QA_HANDOFF_RU.md`, `docs/OVERWOLF_RELEASE_MATRIX_RU.md` и `docs/ADVERTISING_AND_OVERLAY_POLICY_0.5.2-alpha.6_RU.md`. Особо проверить на реальном клиенте: exact packed OPK, hotkey, авто-скрытие, DPI/resolution matrix, fullscreen/windowed, Alt+Tab, live GEP и положение плашки относительно HUD.
