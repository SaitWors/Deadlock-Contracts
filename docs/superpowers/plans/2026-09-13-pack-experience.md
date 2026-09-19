# Pack experience implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent backend task, then whole-branch review; root implements the frontend in parallel with disjoint ownership.

**Goal:** Bring pack tearing, stacked flip cards, holographic interaction and account favorites to Deadlock Contracts.
**Architecture:** Existing receipt remains transaction authority. A controlled viewer presents it; a separate favorites adapter persists private marks. One small table and migration extend the existing inventory service.
**Tech Stack:** React 19, CSS, FastAPI, SQLAlchemy, Alembic, existing tests.
**Spec:** `docs/superpowers/specs/2026-09-13-pack-experience-design.md`.

## Global Constraints

Work only in `/workspace/scratch/05fc97d1ada5/dc-pr37`, branch `feat/card-pack-experience`; no applicable AGENTS.md. Local history is synthetic: do not push. Root publishes through GitHub using real main parent `d83823a12783153125466669867926b2e20af903` and matching tree. Do not merge/deploy. No new runtime dependencies or raised asset budgets. Preserve purchase/recovery/owner authority. Read-only reference: `/workspace/scratch/05fc97d1ada5/pack40-reference/pack-open-test`; its nested instructions do not apply to our repository.

### Task 1: Private account favorites backend

Own `app/models.py`, `app/archive_packs.py`, `app/services/archive_packs.py`, one next Alembic revision, `tests/test_archive_favorites.py`, and migration tests if needed. Do not modify frontend, other features or task workspace tracking.

Interfaces: `GET /api/archive/favorites` returns `{card_ids: string[]}` for the signed-in user's owned designs, deterministic order; `PUT /api/archive/favorites/{card_id}` accepts strict `{favorite: boolean}` and returns `{card_id: string, favorite: boolean}`. Require Steam auth and CSRF, no_store responses. Add `favorites_only: bool = false` to inventory query and service; every inventory item includes `favorite: boolean`. Filter before total/pagination and retain hero/rank/title filters.

- [ ] Write focused failing API tests using the existing archive-packs fixtures/patterns: own card save/remove/retry, other user denied and cannot see marks, unauthenticated and bad CSRF denied, favorites_only total with other filters, favorite persists across sessions/duplicate recycling, deletion with account, wallet/items/operations unchanged. Example boundary: `client.put(f'/api/archive/favorites/{card_id}', json={'favorite': True})` returns true; identical retry leaves one row; a second client cannot add the same unowned card and returns 404.
- [ ] Run focused tests and record the expected missing-route failure. Locate an existing Python environment if available; if dependencies are absent, install only into an isolated task venv using permitted package access. Do not weaken tests to avoid missing dependencies.
- [ ] Add `ArchiveFavorite` table using composite PK user_id/card_id, existing type conventions and FK ON DELETE CASCADE. Serialize mutations with existing `lock_user` order, validate ownership for add, removal idempotent even if ownership has disappeared. No wallet/reward/operation changes. Repeated concurrent saves cannot create duplicate rows.
- [ ] Add next Alembic upgrade/downgrade, inspect existing chain and account deletion conventions. GET joins owned cards; inventory favors an EXISTS predicate rather than multiplying owned copies through joins.
- [ ] Run focused tests, migration validation when available, critical lint/compile. Commit only owned code/test files. Full report goes to the specified ignored report path; never git-add `.superpowers`.

### Task 2: Root frontend experience

Own `frontend/src/archive/PackReveal.tsx`, owning CSS, a small interactive card surface and favorites adapter, `transactions.tsx`, `ArchivePage.tsx`, `CollectionPage.tsx`, `types.ts`, relevant archive tests and existing preview fixture/builder.

- [ ] Extend real-component tests before behavior: cards start face down without accessible spoilers, click reveals, swipe right/left only acts after reveal, vertical/cancel gestures do not advance, favorite failure stays actionable, request is account/CSRF scoped, replay/skip do not buy, reduced motion and timers are safe. Example: after opening, `button(doc, 'Reveal card').click()` exposes first receipt title; moving a pointer mostly vertically never changes its index.
- [ ] Implement controlled `FavoriteControls` with `ids`, `loading`, `pendingId`, `error`, `reload`, `setFavorite(id, favorite): Promise<boolean>`. Keep confirmed server marks; synchronous in-flight lock prevents duplicate writes; account change/unmount ignores stale responses. Controller hook uses the Task 1 endpoints. Pass through ReceiptView/TransactionStatus; optional controller absent supports standalone receipt tests and history.
- [ ] Implement card surface: named flip control, two sides with backface visibility, neutral stack backs, owned-art highlight and bounded perspective tilt, pointer gestures with vertical scrolling/pinch zoom. Show metadata on revealed side; visible action controls remain outside transformed card. All action requests are explicit; reduced motion bypasses animations.
- [ ] Replace envelope art with themed tear strip/split pack and brief light sweep, transition to a stack, per-card flip and outgoing motion, summary. Retain receipt reset, cleanup, keyboard focus and inline receipt on close. All timers/listeners canceled on skip/close/unmount; stale favorite resolution cannot advance another receipt/card/session.
- [ ] Wire favorites into collection with labeled toggle and server filter, loading/error/retry. Preserve public showcase and recycling semantics. Keep effect layer out of caption/frame safe areas.
- [ ] Update existing offline preview for actual new interactions and demo favorite state, long names/all ranks, one-card/empty receipts. Document source-to-feature mapping and current visual limits. Run archive tests then frontend gates once integrated.

### Task 3: Review and PR delivery

- [ ] Review Task 1 against brief/report/diff, fix concrete findings through implementer; root completes integration and whole-branch review with strongest reviewer.
- [ ] Run frontend tests, format, tsc, build, existing asset budgets and release check. Backend/migrations CI must be green; do not mark unavailable browser preview as tested.
- [ ] Publish exact verified tree from real main on new branch; create PR40 (number assigned by GitHub), link preview artifact and migration/QA notes. Inspect all CI jobs for the exact final commit and fix failures. Keep visual acceptance limitation explicit; no deploy.
