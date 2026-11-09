# Contract completion implementation plan

> Archived initial implementation. The current visual and receipt contract is [the cinematic finale spec](../specs/2026-11-09-cinematic-finale.md); it supersedes the sequence and balance projection below.

**Goal:** explicit trustworthy result ceremony with sequential task absorption, failed-card splitting and level-up overflow.
**Spec:** docs/superpowers/specs/2026-11-09-case-completion-design.md
**Architecture:** isolated read-only Python receipt and lazy React modal; existing server rewards unchanged. CSS plus rAF, no new dependencies.

- [x] Backend owner-scoped completion receipt and tests: app/services/case_completion.py, app/case_completion.py, main router inclusion; final status and durable ledger gating; absolute server level bands.
- [x] Shared types/pure timeline + native modal: validation, loading/retry/cancel, frozen receipt, measured flight geometry, XP/level transitions, shards, keyboard and reduced motion. Tests exercise real public props.
- [x] Dashboard reusable lazy trigger in board/history and separate ready-results list; no extra API requests until invoked; chunk error/retry safe.
- [x] Independent review; full targeted regressions, frontend suite, TypeScript/formatter/build/budgets and desktop/mobile browser evidence.
- [ ] Commit, push new branch, create and attach new PR; report actual checks and limitations.


## Implementation decisions

- Results are read-only receipts, with no migration, POST or reward/contract-lifecycle changes. In-memory replay labels are intentionally cosmetic; history can always replay a result.
- Stable host survives board replacement/polling and tab navigation. Account changes remount it.
- Independent review findings addressed: replacement-control focus and band-by-band progression under stalled animation frames. Regression tests cover both, plus the previously observed trigger-unmount interruption.
- Existing Hugeicons ranking glyph reused for the level indicator; remaining existing control glyphs retained. No dependencies or art added.
- Backend: full suite 933 passed, 1 skipped, 1,209 subtests passed; 29 new endpoint cases. Ruff fatal checks passed.

- Final frontend suite: 292 passed, 0 failed. Includes20 isolated modal/timeline cases and12 Dashboard integration cases; provider survives polling/tab changes, no duplicate receipt/reward writes.
- TypeScript/full formatter/build/diff checks passed. Unchanged asset budgets passed: 736,439 total JS, 305,031 initial JS, 474,470 CSS, 356,200 largest image, 2,704,144 total asset bytes.
- Real production bundle in Chromium with clearly labeled isolated QA data: regular motion/flight/impact/shatter, multiple level overflow, skip/replay/Escape, pendingledger/retry, all failed zero XP, 320/390/760/1440px, RU/EN, dark/light/black/custom and reduced motion. No pageerrors or horizontal overflow; bottom controls reachable on narrow screens.
- Browser recording, screenshots and logs stay outside source in /tmp/dc-completion-qa. Live Steam and real matches/provider delivery were not exercised. Backend isolated tests cover authoritative receipt behavior; presentation never mutates XP.
