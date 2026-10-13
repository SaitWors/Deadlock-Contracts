# Gwent Arena Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:dispatching-parallel-agents for independent file ownership. Follow red/green verification.

**Goal:** Replace arena combat with the Gwent round/card/pass loop, match the site design and issue existing illustrated hero cards.
**Architecture:** Separate pure gwent engine; existing service dispatches by frozen rules version. Artwork selection is an independent helper. UI uses versioned match rendering.
**Tech Stack:** Python/FastAPI/SQLAlchemy, React/TypeScript/Vite, existing CSS and SVG assets.
**Spec:** docs/superpowers/specs/2026-10-13-gwent-arena-design.md

## Global Constraints

- Keep original inventory, wallets, published artwork, moderation and historical definitions.
- New rules gwent-v1; old arena-v1 snapshots continue unchanged.
- Three rows, three rounds maximum, ten opening cards, two mulligans, six source heroes, 24-card combat deck, 24-point preparation budget, two SSS maximum.
- RU/EN, site themes, reduced motion and mobile 390px.
- Server owns all stats, outcomes, shuffle and rewards; hide opponent hand/deck and shuffle seed.

## Review Focus

- A player passes while the opponent still has cards: only the opponent may continue until they pass.
- A special card cannot target a forbidden/immune unit; failed commands leave the state unchanged.
- Replay/retry and stale tabs must not play cards or settle rewards twice.
- Existing hero artwork can be archived during a match: participant image remains available and other users cannot fetch it.
- Alternate catalogue hero/rank availability must not generate an empty-art starter or silently change hero identities.

### Task 1: Pure combat engine
**Files:** app/services/gwent.py; tests/test_gwent_engine.py.
**Interfaces:** exact signatures, side/card/state fields in the spec.
- [ ] Write failing engine tests for round wins, irreversible pass, hand conservation and hidden information.
- [ ] Run tests and observe missing new rules.
- [ ] Implement initialization, deploy effects, legal actions, scores, transitions and bot decision.
- [ ] Run engine suite; prove deterministic input and nonmutation on invalid commands.

### Task 2: Illustrated roster selection
**Files:** app/services/arena_artwork.py; app/services/card_battle.py (catalogue extension only); tests/test_arena_artwork_selection.py.
**Interfaces:** starter_cards and decorate_rules return types in the spec; engine source uses the expanded HEROES catalogue.
- [ ] Write regression tests for alternate available heroes/ranks and existing image ids.
- [ ] Observe old fixed selection failure; implement batched catalogue selection without creating art.
- [ ] Preserve explicit approval/revocation and frozen original versions; verify source counts and images.

### Task 3: Arena UI
**Files:** frontend/src/arena/*; frontend/tests/gwent.test.mjs; frontend/tests/gwent-entry.tsx.
**Interfaces:** new engine fields/actions in the spec; existing Match fields and plans callback remain supported.
- [ ] Write behavioral tests for PLAY/row, PASS, MULLIGAN/READY and waiting/finished states.
- [ ] Preserve legacy renderer and implement new board/hand/patron view with site CSS tokens.
- [ ] Update preparation/starter copy and choose visual cards, not technical stat forms.
- [ ] Run frontend suite and rendered 390px/1440px/theme layout checks.

### Task 4: Server integration and release
**Files:** app/services/battle_service.py; app/card_battle.py; tests/test_gwent_service.py; docs/development/gwent-arena.md.
**Interfaces:** version dispatch uses engine apply_action/public_state; existing request-key receipts/reservations/settlement stay authoritative.
- [ ] Write tests for new match version, multiple turns in a round, hidden PvP cards, stale revision, replay and completion.
- [ ] Observe old simultaneous-plan behavior, implement versioned turn submission and bounded bot advancement.
- [ ] Integrate roster helper and original image access for all new card zones.
- [ ] Run relevant backend suite, frontend test/build/budget, inspect full diff and independent review.
- [ ] Create a reviewable branch/PR on top of exact main 93c3d237; no merge/deployment.
