# Deadlock Contracts Companion 0.5.2-alpha.7 — test report

Дата сборки и проверки: 25 августа 2026 года.

## Автоматический прогон

- Backend: `117 passed`.
- Companion (Node test runner): `57 passed`, `0 failed`.
- Companion release metadata: `PASS`.
- Синтаксис всех `companion/src/*.js`: `PASS`.
- Repository release check и Python critical lint: `PASS`.
- Trust-boundary, whole-case History и lifecycle queue regressions: `PASS`.

Готовый OPK и его checksum намеренно не зафиксированы в ветке: владелец
собирает exact artifact после зелёного CI. CI обязан доказать повторяемость
двух сборок, integrity архива и CycloneDX 1.6 file inventory.

Ручные Windows/Overwolf/Deadlock проверки на реальном клиенте ещё обязательны и не заменяются этим отчётом.

Обязательные gates:

```bash
npm test
npm run check
for f in src/*.js; do node --check "$f"; done
npm run package
node scripts/package-qa-bundle.mjs
```

Отдельно вручную проверяются: реальный GEP всех режимов, hotkey/rebind, fullscreen/windowed/Alt+Tab, DPI/resolution matrix, offline/reconnect, overlay placement, CPU/RAM/network и рекламный safe-state.
