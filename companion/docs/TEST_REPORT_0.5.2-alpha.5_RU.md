# Deadlock Contracts Companion 0.5.2-alpha.5 — test report

Дата сборки: 22 августа 2026 года.

## Результат этой сборки

- `node --test tests/*.test.mjs`: **46/46 PASS**;
- `node scripts/check-release.mjs`: **PASS**;
- `node --check src/*.js` и packaging scripts: **PASS**;
- OPK integrity (`unzip -t`): **PASS**;
- две последовательные OPK-сборки дали одинаковый SHA-256: `1a417e0fd90f6ce74bb7d790d96321edcd973baade724700090b6205309d7cb6`;
- source ZIP был распакован в чистую временную папку: tests, release check и повторная упаковка дали тот же OPK checksum.

## Новые automated/static gates

- Alpha.5 version parity: release.json, manifest, Desktop fallback, notices и OPK filename.
- Transient Overlay: наличие 6.5-second lifecycle, повторное ручное скрытие, bounded/input-pass-through config.
- Overlay visual surfaces: rounded shell, progress transition, selected focus и provisional completion burst.
- Managed Ads: только официальный SDK, нужные permissions, empty `400×60` container, transparent parent, shutdown и safe-phase gating.
- Запрет third-party ad iframe, remote fonts, server secret paths и client-side settlement.

## Команды, которые должны пройти на frozen source

```bash
npm test
npm run check
for f in src/*.js; do node --check "$f"; done
npm run package
node scripts/package-qa-bundle.mjs
```

## Что остаётся ручной проверкой

Автотесты не эмулируют Windows/Overwolf/Deadlock. Нельзя ими доказать actual GEP, exact Overlay placement, DPI/fullscreen/Alt+Tab, hotkey rebind, no-fill/served ad behaviour, performance или итоговый DevRel verdict. Полный список — `OVERWOLF_QA_HANDOFF_RU.md`.
