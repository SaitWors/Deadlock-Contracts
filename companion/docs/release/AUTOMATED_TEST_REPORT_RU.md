# Alpha.13 automated test report

Дата полного прогона: **2026-08-29**.

Финальный source ZIP / OPK создаётся только после `npm run release:check`.

Последний полный прогон перед упаковкой:

- JavaScript syntax: **PASS, 41 file**.
- Node tests: **PASS, 90/90**.
- RU/EN logic invariants: **PASS**.
- Critical UI/recovery string scanner: **PASS**.
- Contrast: **PASS, 28 token pairs >= 4.5:1**.
- Release metadata: **PASS, 0.5.2-alpha.13 / 0.5.2.13**.
- Alpha.13 post-match/recovery safety invariants: **PASS**.

Критические регрессии, которые теперь покрыты тестами:

- terminal proof остаётся `TERMINAL_PENDING` до commit, а final details захватываются в конце 5-секундного grace;
- поздний exact Match ID может скоррелировать уже pending `match_end`;
- final сохраняется в durable queue до lifecycle `FINALIZED`;
- terminal candidate/proof/deadline переживает restart;
- causal key не меняется при `match_id: null -> exact ID`;
- final не обходит не подтверждённый `match_started` той же session;
- persisted `IN_FLIGHT` после crash становится безопасным `RETRY_WAIT` с тем же idempotency key;
- предыдущий finalized Match ID не привязывается к новой session;
- phase/clock не оживляют interrupted known-ID session без identity;
- outcome-before-ID сначала привязывается к session и затем bind'ится к exact Match ID;
- две scoring-session не делят match-scoped evidence;
- Street Brawl partial/lower roster samples не уменьшают накопленный evidence;
- Street Brawl `PostGame` не синтезирует конец всей scoring-session.

Этот отчёт **не заменяет** Windows/Overwolf/Deadlock manual QA. Реальные event ordering, fullscreen/borderless/windowed, DPI, multi-monitor, hotkey conflicts, offline/reconnect, процессный crash, ad lifecycle и установка финального OPK проверяются отдельно перед submission.

Также Alpha.13 **не заявляет arbitrary-late repair после grace window**: полноценный `match_enriched` требует отдельного cross-repo Companion + backend изменения.
