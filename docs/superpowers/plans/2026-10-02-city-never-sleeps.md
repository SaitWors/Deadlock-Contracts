# City Never Sleeps PR45 Implementation Plan

> **For agentic workers:** Use the scoped independent tasks below; read the spec before editing. Parent integrates shared tokens and performs whole-branch verification/review.

**Goal:** Give every existing surface the City Never Sleeps print/poster identity and add six collectible hero cards.

**Architecture:** Existing React/vanilla Companion/server pages retain routes, handlers and schemas. Replace owning presentation layers in place; shared documented tokens align independent surfaces. Add one idempotent catalogue release and a strictly allowlisted public artwork route.

**Tech Stack:** React 19, TypeScript, Vite, CSS, FastAPI/SQLAlchemy, vanilla Overwolf UI.

**Spec:** `docs/superpowers/specs/2026-10-02-city-never-sleeps.md`

## Global Constraints

- Preserve all 15 account routes (including conditional votes), 17 staff tabs, five theme IDs, saved settings, RU/EN and original mascot.
- No new runtime packages, runtime artwork downloads, pack-odds changes, authentication changes or invented hero abilities.
- Keep CSS/JS/image asset budgets. Replace old owners, do not stack another theme over them.
- Keep current release versions unless an actual protocol change requires one; PR45 is additive presentation/catalogue work.

## Review Focus

- Existing saved custom/radius preferences and system/light transitions must remain readable on every separate runtime.
- Concurrent/repeated seeding must preserve moderation decisions and every existing purchase/pack record.
- Public release image access must not make private/custom card artwork public or permit path traversal.
- Long Russian headings, populated admin/detail panels and mobile dialogs must fit without losing actions.
- A dropped signing/acquisition response must still recover authoritative state without double spending or false confirmation.

### Task 1 — Reference and shared presentation (parent)
- [x] Capture official desktop sections, read CSS/type/color/art/motion, verify six heroes and merged base.
- [x] Make isolated 628-file snapshot with all available file hashes matching main; preserve missing unused original PNG remotely.
- [x] Run existing frontend baseline: 123 passing.
- [x] Bundle licensed fonts and city artwork, document provenance. Update appearance.css/state, index/vnext font ownership, Appearance copy.
- [x] Recompose Landing/home/nav/gallery, rewrite owning layout/core/public/shared styles and obsolete inline decoration.
- [x] Verify guest/account/screens/themes/languages in real browser plus frontend test/TS/build.

### Task 2 — Additive card release (catalogue worker)
Files: app/services/archive.py, new archive_seed.py, app/main.py lifespan hook, app/archive.py, app/data/archive/city-never-sleeps/*, tests/test_archive_seed.py and existing roster assertion.
Interface: public allowlisted artwork route defined in spec; published cards preserve existing API shape.
- [x] Write failing tests for 44 heroes, six stable records, restart/admin-archive preservation, read-only public art allowlist and acquisition idempotency.
- [x] Implement deterministic conflict-safe insert-only seed, bundled images and source metadata; all existing F tier (20 tokens), no pack mutation.
- [x] Run targeted real DB/API tests then full backend suite at integration.

### Task 3 — Archive/community (feature worker)
Files: frontend/src/archive/* and community/* plus ProfileStudio styles as needed. Own no global tokens or Dashboard.tsx.
- [x] Replace Nightshift green card backs/glass, add paper-framed catalogue/collection/pack/studio/ledger/community presentation. Preserve custom artworks/accent data and all hooks.
- [x] Verify existing archive/community tests and inspect populated fixtures desktop/mobile in dark/light.

### Task 4 — Staff and signing (staff worker)
Files: frontend/src/admin/*, contract-signing.css, minimal ContractSigning.tsx presentation markup if needed. Own no Dashboard.tsx.
- [x] Rework all 17 staff tabs/detail/edit/review surfaces into the same restrained print language; keep TOTP/RBAC/actions.
- [x] Rework contract signing sheet/stamp/receipt in new palette and motion, retaining state machine.
- [x] Run admin-i18n/signing tests, inspect populated staff/signing fixtures including 360 px.

### Task 5 — Companion and server documents (independent runtime worker)
Files: companion styles/HTML/appearance/i18n; app/static documents/reviewer styles/appearance; app/seo.py presentation only.
- [x] Align palettes, new font assets, custom contrast/runtime theme colors, 7 Companion views and overlay, preserve protocol/IDs.
- [x] Apply same identity to both-locale documents/reviewer/no-JS/404; preserve content and auth behavior.
- [x] Verify Companion tests/contrast/package and document/reviewer/SEO tests plus rendered desktop/mobile.

### Task 6 — Integration, audit, PR45 (parent)
- [x] Inspect all visual coverage; eliminate remaining old-style colors/copy, run format/TS/tests/build/budget and local real-API browser journeys.
- [x] Fresh independent whole-diff review; fix functional/important visual findings with evidence.
- [ ] Publish changed-file tree over real main using Git Data API (local history is a synthetic snapshot); verify unchanged remote blobs.
- [ ] Open PR45, inspect all CI jobs including Docker; return PR link and screenshots/source ZIP.
