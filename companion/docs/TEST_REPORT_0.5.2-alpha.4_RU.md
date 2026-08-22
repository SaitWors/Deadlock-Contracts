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
- terminal lifecycle принимается только вместе с gameplay proof;
  одна фаза `PostGame` больше не может преждевременно завершить матч.

## Автоматические проверки

Ожидаемый gate перед commit:

- Companion: 44/44;
- backend: 97/97;
- Python dependency audit: обязательный GitHub CI gate (`pip-audit`);
- JS syntax: PASS;
- Companion release-check: PASS;
- web release-check: PASS;
- actionlint: PASS;
- reproducible OPK SHA-256 + integrity: PASS.

## Обязательная ручная проверка до Overwolf submission

Автоматические тесты не заменяют live Deadlock/GEP QA.

Нужно подтвердить хотя бы одним новым матчем:

1. короткий ложный `PostGame` до начала матча не закрывает сессию;
2. `match_outcome_event_match_id` совпадает с текущим Match ID;
3. `match_outcome_event_at` появляется у terminal snapshot;
4. сервер выдаёт `summary.result`;
5. Standard/Ranked final healing выдаёт `summary.healing`;
6. cached/stale previous-match outcome не засчитывается новому матчу.
