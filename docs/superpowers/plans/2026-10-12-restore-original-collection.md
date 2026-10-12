# Restore original collection implementation plan

**Goal:** Correct PR #50 in a new PR: use original owned archive cards and their images in the arena, stop the parallel geometric catalogue, preserve every issued item and paid transaction.

**Architecture:** Seed approved battle definitions independently of archive artwork. Resolve supported original hero/rank cards against those definitions while preserving explicit approval/revocation overrides. Retire proven untouched PR50 placeholders with an idempotent data migration/startup repair; append corrected system pack versions from authentic published artwork only when complete.

**Scope:** The user's supplied correction and screenshot define the bug. No invented artwork, hero aliases, new hero abilities, collection deletion, financial remapping or unrelated arena redesign. Unsupported heroes remain collectible with a clear explanation. EX approval stays explicit.

**Review focus:** Existing paid/free REAL/SANDBOX items and immutable receipts; curator-edited seeds and paused packs; archived art privacy in active PvP; incomplete starter/pack availability without payment; exact original images through collection → squad → battle.

- [x] Reproduce: definition seed creates 110 cards and original owned supported cards are excluded. Record failing behavioural tests.
- [x] Arena: definitions-only seed, shared hero/rank resolver, original starter selection, truthful availability, original EX artwork and participant-scoped battle image serving. Test exact item/image preservation and explicit revocations.
- [x] Data repair: frozen `0023`, idempotent startup retirement, untouched-seed fingerprint and preservation tests. No data-deleting downgrade.
- [x] Packs: original art pool, independent collection/battle eligibility, preserve old versions and append a corrected pristine preset revision, incomplete pool blocks charges/guarantee movement.
- [x] UI: original collection explanation, starter availability and unsupported-card visibility in RU/EN.
- [x] Verify: full Linux backend (790 passed, 1188 subtests), final focused backend (74 passed), 40 PostgreSQL repair tests plus migration/concurrency smoke, 197 frontend tests, types/format/build/budgets, exact WebP HTTP workflow, RU/EN QA DOM and fresh independent review. Browser screenshots unavailable in this environment.


Publication: create a new pull request against main and inspect CI for its exact head; no merge or production deployment requested.
