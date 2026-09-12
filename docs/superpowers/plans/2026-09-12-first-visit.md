# First Visit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest try the archive cipher and give an authenticated player an honest next action based on server state.
**Architecture:** One lazy guest screen within Landing's hash navigation; one small authenticated home component using the existing read-only wallet endpoint. No backend changes. Existing Steam flow and server reward ownership remain intact.
**Tech Stack:** React 19, TypeScript, Vite, existing Lucide SVGs, node:test + jsdom.
**Spec:** `docs/superpowers/specs/2026-09-12-first-visit-design.md`

## Global Constraints

- Work in `/workspace/scratch/05fc97d1ada5/dc-pr37`, branch `feat/first-visit-archive`. This is already an isolated linked worktree.
- No backend mutations, new dependencies, database migrations, role changes, rewards in browser storage, or automatic real round/pack actions.
- Use the existing `/auth/steam` entry point; no new auth redirect parameters. Guest demo must not call archive APIs.
- Keep RU/EN, existing deep links, guide behavior, SVG style, keyboard interaction and narrow-screen layout.
- Do not raise frontend budgets. Run node tests, formatter and build from `frontend`, not repository root.
- Local git history is synthetic. Local commits are bookkeeping only; do not push or make GitHub changes. Controller publishes a tree using the verified real GitHub main parent.
- Browser local previews were blocked by tool URL policy in this session. Do not try alternate URLs, ports, CDP, data URLs, or a published workaround. Build the existing offline review artifact instead; never claim a visual inspection that did not happen.

### Task 1: Guest trial and authenticated next step

**Files:**
- Create `frontend/src/archive/GuestCipher.tsx` and `frontend/src/archive/first-visit.css`.
- Create `frontend/src/archive/ArchiveNextStep.tsx` and its small component-owned `archive-next-step.css` (review refinement: authenticated styling must not depend on the guest route).
- Modify `frontend/src/Landing.tsx` and `frontend/src/Dashboard.tsx` at the integration points only.
- Add `frontend/tests/first-visit-entry.tsx` and `frontend/tests/first-visit.test.mjs`; reuse existing test harness patterns. Extend existing navigation tests if needed.
- Extend `frontend/tests/build-bureau-layout.mjs` with a `first-visit.html` offline page and add `frontend/tests/first-visit-layout-entry.tsx` using real components. Avoid changing existing preview pages beyond linking the new one.

- [ ] Write and run failing behavior tests before implementation. Expose real components through a Vite IIFE entry as existing DOM suites do. Test guest selection prevents duplicates and more than four symbols, incomplete submission, correct exact/misplaced feedback, successful completion, sixth failed guess/assisted explanation, reset, and zero archive writes. Check the real Landing entry reaches `#try` and returns to existing routes. Fixtures must use real response shapes; mock only network/browser APIs.
- [ ] Implement the guest component. Use the existing six named SVG symbols from `regalia/catalog`. Fixed teaching code indexes `[0, 5, 4, 2]` (Compass, Hourglass, Hands, Documents). Maintain local choices, guesses and completion only; no persistence. Existing unique-symbol scoring is a tiny local calculation: exact by matching position, misplaced by set membership minus exact. Disable duplicate/incomplete actions. Show a concise live result and a visible history; on success or assisted explanation show the known solution and Steam action. Offer reset and return to home throughout. Explain before play and after completion that this is a demo with no awarded tokens or transferred progress. Keep an early guided-explanation action so visitors need not exhaust attempts.
- [ ] Integrate lazy `#try` navigation in Landing with a Suspense loading state. Make «Попробовать без входа» / «Try without signing in» the prominent guest action, keep Steam entry and a discoverable contract signing example. Briefly explain browser activities and separate tokens from XP. Do not import the complete archive, wallet hooks or pack components into Landing.
- [ ] Replace Dashboard's existing `dc-home-archive-callout` with `ArchiveNextStep({ revision, onNavigate })`; callback accepts `archive`, `collection`, `bureaus`. Use `useResource<Wallet>` and `/api/archive/wallet?view=${revision}` while mounted. Loading does not pretend to have data. Error has Retry. When `round.status === "OPEN"`, main action continues it; otherwise `completed < weekly_limit` starts via navigation to archive; otherwise main action opens collection and shows localized reset time. Show balance, reward and limits from server fields, not duplicated economic constants. Secondary collection/bureau navigation must remain available on loading/error. No polling or new backend endpoint.
- [ ] Add tests of real home component for loading/error/retry, open round, reward eligibility, exhausted limit and callbacks. Include English and Russian interaction coverage. New feature must be tested in integration through real Landing/Dashboard where practical, not source-text assertions.
- [ ] Add compact responsive styles using existing design tokens, minimum 44 px controls, wrapping labels, no horizontal overflow from fixed widths, text labels beside SVGs, visible focus and no required animation. Keep changes within resource budgets. The guest CSS can be lazy-loaded with the guest module; home essentials can use existing callout classes if needed.
- [ ] Build offline first-visit fixture with real guest and home components plus explicit mocked wallet states, self-contained assets and no network requests. Reuse the existing export script and styling. Include a link back to bureau fixture.
- [ ] Run focused tests during edits; full suite once at the end. From `frontend`: `node --test tests/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/oxfmt --check src tests`, `node_modules/.bin/vite build`, `python3 ../scripts/check_frontend_budget.py dist`, `node tests/build-bureau-layout.mjs ../.qa/bureau-layout`. Fix actual failures without loosening checks. Capture exact RED/GREEN and final commands/results in the report.
- [ ] Self-review diff, stage only task files and commit locally. Do not include controller-owned roadmap/spec/plan docs in the implementation commit. Report concerns and changed files; controller will perform independent review and GitHub publication.

## Controller delivery

- [ ] Publish the release roadmap in `docs/design/ROADMAP_RU.md`, explicitly marking designer tooling as future work.
- [ ] Review implementation and update checked steps only after evidence; add manual pilot criteria.
- [ ] Create a new GitHub PR from the verified main tree, wait for required CI and report actual results plus visual-review limitations. No merge or server deployment.
