# Nightshift Production Implementation Plan

> **For agentic workers:** Execute the primary integration inline; independent surface CSS and admin localization are delegated under dispatching-parallel-agents. Complete one fresh whole-branch review before publishing the PR.

**Goal:** Bring the approved Nightshift design, new mascot poses and visible RU/EN controls into the existing functional site.

**Architecture:** Keep existing pages and data handlers. Add appearance context, a reusable mascot, public art sections and desktop navigation. Map existing color tokens and scoped surfaces into the new themes. Preserve server routes and admin permission checks.

**Tech Stack:** Existing React 19, TypeScript, Vite, CSS, FastAPI; no new runtime dependencies.

**Spec:** ../specs/2026-09-29-nightshift-production.md

## Global Constraints

- Preserve 16 admin sections, requests, form payloads, CSRF and role permissions.
- Theme values: system, light, dark, black, custom; radius 12–28 px.
- Preserve existing public locale URLs and SEO content; language choice survives Steam login.
- Preserve mascot identity. Honor prefers-reduced-motion and manual motion choice.
- No mock login, artificial balances or prototype API substitutions in production.

## Review Focus

- Explicit language choice on public routes must persist into the authenticated session.
- Light mode must keep admin tables and role editors readable.
- Theme/language changes must not reset tab, form values or contract selection.
- All admin tabs must remain reachable on a 360 px viewport.
- Reduced motion and disabled localStorage must not prevent core actions.

### Task 1: Appearance and language preferences

Files: Appearance.tsx, appearance-state.ts, appearance.css, BureauHeader.tsx, i18n.tsx, main.tsx, App.tsx; tests/nightshift.test.mjs.

- [ ] Run failing guest-theme and persistent-language tests.
- [ ] Implement appearance provider, 5-theme chooser, safe storage and system listener.
- [ ] Keep RU/EN visible at mobile sizes; persist public locale link clicks.
- [ ] Pass preference tests and existing suite.

### Task 2: Mascot and approved visual layout

Files: Mascot.tsx, nightshift-layout.tsx/css, Landing.tsx, Dashboard.tsx, imports/nightshift/*.

- [ ] Copy generated poses and existing scene art into project-owned assets.
- [ ] Add manual pose changes, subtle CSS motion and reduced-motion handling.
- [ ] Replace public/dashboard hero art, add scene links and full desktop navigation.
- [ ] Apply delegated existing-surface themes without changing handlers.
- [ ] Verify guest, dashboard, scene routes and mobile layout in Chromium.

### Task 3: Admin preservation and localization

Files: admin/*, Dashboard.tsx AdminConsole translations; tests/admin-i18n* and admin navigation browser checks.

- [ ] Translate UI copy while retaining payload enums, permission names and user-generated data.
- [ ] Verify all 16 sections, RU/EN changes with state preserved, and owner/restricted roles.
- [ ] Run frontend suite, backend suite, typecheck and production build.

### Task 4: Review and GitHub delivery

- [ ] Review integrated diff and fix concrete regressions.
- [ ] Document validation and honest limitations.
- [ ] Publish changed files over the original Git tree, preserving all unrelated files.
- [ ] Create PR against main and inspect remote checks.
