# Complete Nightshift Implementation Plan

> **For agentic workers:** Primary integration uses executing-plans; independent Companion, signing, archive/community and admin work is delegated under dispatching-parallel-agents. Shared files have one owner.

**Goal:** Make every working screen match the user-supplied Nightshift reference and improve signing and Companion presentation.

**Architecture:** Preserve production state and APIs. Replace legacy presentation in scoped component styles and targeted JSX structures; consolidate previous broad cosmetic overrides with owned feature styles. Shared appearance tokens remain the source of theme values.

**Tech Stack:** Existing React/TypeScript/Vite frontend, CSS, FastAPI, vanilla JS/HTML Overwolf Companion; no additional runtime dependencies.

**Spec:** ../specs/2026-09-29-nightshift-complete.md

## Global constraints

- Keep 16 admin sections and all existing destinations, roles, TOTP, CSRF and API payloads.
- Keep user artwork and bureau/profile customization.
- Preserve RU/EN, five website themes, manual/system reduced motion, all three mascot poses.
- No mock state in production and no fabricated progress/rewards.
- No deployment or automatic merge.

## Review focus

- Populated and empty states must both use the new visual hierarchy.
- Signing must not finish visually before a successful backend response; retry must preserve the selection.
- Narrow desktop Companion windows and 360 px website controls must remain reachable.
- Light/custom theme contrast must hold in all forms and dialogs.
- Existing user-selected covers and card art must survive theme/style replacements.

## Task 1: Shared shell and all core/public pages (primary)

Files: BureauHeader.tsx, nightshift-layout.tsx/css, Dashboard.tsx, Landing.tsx, ProfileStudio.tsx, PublicContent.tsx, account-menu.css, new core component styles and main.tsx imports.

- [x] Inventory all visible components against the ZIP's pages-play.js/pages-landing.js/panels.js.
- [x] Rebuild shared page/section headings, sidebar/header and homepage hierarchy using existing data.
- [x] Restyle contract selection, active/history, profile/settings/Companion site panel, public content and help/dialog components without changing handlers.
- [x] Run frontend tests, production build and screenshot representative populated views.

## Task 2: Signing (signing worker)

Files: ContractSigning.tsx, a dedicated signing CSS module, existing signing tests where behavior changes.

- [x] Read existing state machine and test every current guard before modifying presentation.
- [x] Implement a Nightshift dossier, clear terms, live signature preview, explicit confirmation and success stamp.
- [x] Keep onConfirm/onSigned timing, errors, keyboard, reduced motion, demo handling and selection intact.
- [x] Verify signing tests and typecheck; report changed interfaces (prefer none).

## Task 3: Feature surfaces (archive/community and admin workers)

Archive/community owns archive/* and community/* style/component files only. Admin owns admin CSS and a new admin-shell stylesheet, not Dashboard.tsx.

- [x] Replace feature panel layouts, controls, type and illustrations to match reference.
- [x] Preserve card finish/rarity meaning and user appearance selections.
- [x] Verify relevant tests and screenshots; report every covered screen/empty/detail/dialog state.

## Task 4: Companion (Companion worker)

Files: companion/* only.

- [x] Inventory desktop and overlay views, HTML IDs, i18n bindings and packaging constraints.
- [x] Apply complete Nightshift visual system and preferences with safe storage if adding controls.
- [x] Preserve protocol, data processing, window APIs, ads, privacy and in-game constraints.
- [x] Run release checks and OPK/QA packaging; capture real preview states.

## Task 5: Integration and release (primary)

- [x] Remove conflicting/obsolete broad overrides in the touched styling stack.
- [x] Run full frontend/backend/Companion checks and browser journeys across all sections.
- [x] Independently review integrated diff and address important findings.
- [ ] Publish changed-file Git tree over main; verify untouched-file hashes and CI.
