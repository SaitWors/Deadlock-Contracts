# Deadlock Contracts Companion 0.5.2-alpha.4 — test report

Дата: 22 августа 2026 года.

## Исправления candidate

- nested `onInfoUpdates2` сохраняет provenance `info_update`;
- cached `getInfo(match_outcome)` остаётся diagnostic-only;
- exact-match Evidence v7 marker создаётся только из real info update;
- Standard/Ranked final GEP `hero_healing` получает `summary.healing`;
- Street Brawl сохраняет отдельную `gep.scoreboard_healing`;
- minimum GEP поднят до `311.0.0`, где Deadlock `match_outcome`
  содержит `winning_team`.

## Автоматические проверки

Ожидаемый gate перед commit:

- Companion: 39/39;
- backend: 93/93;
- JS syntax: PASS;
- Companion release-check: PASS;
- web release-check: PASS;
- actionlint: PASS;
- OPK integrity: PASS.

## Обязательная ручная проверка до Overwolf submission

Автоматические тесты не заменяют live Deadlock/GEP QA.

Нужно подтвердить хотя бы одним новым матчем:

1. `match_outcome_event_match_id` совпадает с текущим Match ID;
2. `match_outcome_event_at` появляется у terminal snapshot;
3. сервер выдаёт `summary.result`;
4. Standard/Ranked final healing выдаёт `summary.healing`;
5. cached/stale previous-match outcome не засчитывается новому матчу.
