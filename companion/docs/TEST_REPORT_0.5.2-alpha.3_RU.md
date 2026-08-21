# Test report — Companion 0.5.2-alpha.3

Дата: 2026-08-19

- `node --test tests/*.test.mjs` — **35 passed / 0 failed**
- `node scripts/check-release.mjs` — **PASS**
- `node --check src/*.js` — **PASS**

Regression gate Evidence v7 проверяет, что:

- `getInfo(match_outcome)` не создаёт доверенный result marker;
- настоящий `onInfoUpdates2` для `match_outcome` создаёт marker с timestamp и exact Match ID;
- marker отправляется в authenticated heartbeat/session evidence;
- client не получает settlement/XP authority.
