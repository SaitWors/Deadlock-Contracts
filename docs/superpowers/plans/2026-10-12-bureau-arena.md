# Bureau arena implementation plan

**Goal:** Complete the supplied proposal's remaining software in PR #50 on top of merged PR #49.

**Spec:** `docs/superpowers/specs/2026-10-12-bureau-arena-design.md` and the user's supplied balance proposal.

**Execution:** Parallel domain implementation in the existing clean task checkout on `codex/bureau-arena`; root integrates cross-domain changes. Agents do not commit or edit another domain's files. Start each domain with failing behavioural tests, then implement and verify. Existing 620 backend, 175 frontend and 134 Companion tests are the merged baseline.

## Tasks

- [x] Battle domain: versioned definitions/artwork approval, canonical catalogue, deterministic rules/abilities, persistent squads and instances, tutorial/PvE/EX/weekly/copy/PvP/season, private API and focused tests. Owner: battle agent.
- [x] Pack domain: EX archive protocol/direct-purchase gate, typed paid packs, hero-first artwork selection, scoped guarantees/disclosure/immutable receipts, tests. Owner: pack agent.
- [x] Reward domain: qualifying activity facts, new bounded entitlement sources, daily/weekly/tutorial/milestone/bureau settlement, trusted contract progress and delivery validation, tests. Owner: root.
- [x] UI domain: lazy arena navigation, patron selection, legal roster editor, persistent round plans/field/results, rewards/trials/rooms/seasons/showcase, EX archive and pack guarantees, mobile/themes/reduced motion/RU/EN. Owner: frontend agent.
- [x] Integration: router/model registration, startup seed, item reservations, reward hooks, public privacy, migration 0022, telemetry and deployment documentation. Owner: root.
- [x] Validation: complete suites, type/format/lint/build/budgets, PostgreSQL migration and concurrent rewards/pack actions, browser QA, independent review/fixes. Owner: root and reviewers. Publication and GitHub CI are the final integration step recorded on PR #50.

## Shared interfaces

- Battle owns `app/battle_models.py`, `app/card_battle.py`, `app/services/card_battle.py` and `battle_*` helpers/assets/tests. It publishes the API payload contract to frontend before integration.
- Pack owns `app/pack_models.py`, archive backend files and pack tests. Existing archive payload fields remain compatible; new fields are additive.
- Root owns `app/economy_models.py`, `app/services/extra_coin_rewards.py`, coin delivery changes, hooks in main/worker/bureau services, migrations and CI smoke.
- Frontend owns all `frontend/` changes and tests, preserving existing store retry semantics and scopes.
- Root registers new models after existing model declarations and adds private routers after permission setup. No reads create rewards.
- New monetary rights reuse `CoinEntitlement` and `coin.reward`. Reward events are validated against original server facts; no UI-supplied outcome or amount is accepted.

## Review focus

Concurrent creation of reward slots/quotas/guarantee state; scoped instance reservations and recycling; stale bot/PvP plans; undisclosed sealed plans; artwork publication versus approval; trial temporary ownership; no ranked rewards/farm; post-deletion privacy; epoch/UTC boundary and late verification; historical receipts and migration parity; actual UI recovery after uncertain mutation responses.

## Decisions and evidence

- Full remaining software is in scope per the user. Live pilot observations remain a post-deployment measurement, with telemetry provided by this PR.
- Canonical artworks are original symbolic assets bundled locally; no external asset fetch is required and no official artwork ownership is implied.
- A normal branch in the existing task-owned clean checkout avoids copying the nested repository/dependency runtime. Base: `51157a6`.
- Final local verification: 722 backend tests and 1188 subtests, 192 frontend tests, 134 Companion tests; types, format, production build, budgets, critical Python lint and release checks pass. Real PostgreSQL validates migration round-trip/schema parity, simultaneous friendly plans, bounded payouts, duplicate delivery, v2 guarantee races/rollback and account-deletion privacy.
- Independent review fixes include append-only reversal of all bureau participants' dependent rewards, canonical participant locking, per-instance approved-definition previews, surrender with a sealed plan, and purging peer command receipts containing a deleted player's battle.
