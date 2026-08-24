# Deadlock Contracts Companion 0.5.2-alpha.6 — test report

Дата сборки и проверки: 24 августа 2026 года.

## Автоматический прогон

- Backend: `111 passed`.
- Companion (Node test runner): `57 passed`, `0 failed`.
- Companion release metadata: `PASS`.
- Синтаксис всех `companion/src/*.js`: `PASS`.
- Frontend TypeScript и production build: `PASS`.
- Python и pnpm dependency audit: известных уязвимостей не найдено.
- OPK integrity (`unzip -t`): `PASS`, 53 файла.
- Две последовательные сборки дали одинаковый SHA-256: `PASS`.
- CycloneDX 1.6 SBOM: `PASS`, 53 file components; SBOM также воспроизводим.

Frozen OPK:

- файл: `Deadlock-Contracts-Companion-0.5.2-alpha.6.opk`;
- размер: `906870` байт;
- SHA-256: `b1882c783159e9ce036ed3107ffdb5ff1fe8cf78248ab248a8a2f3a7376d8ecd`;
- SBOM: `Deadlock-Contracts-Companion-0.5.2-alpha.6.cdx.json`;
- SBOM SHA-256: `a5e30d1a921070dabd4edaf22fb49e1d738e9eb4c5e17bf756ce4b0718c8dcdc`.

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
