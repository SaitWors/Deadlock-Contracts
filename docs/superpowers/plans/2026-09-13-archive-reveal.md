# Archive reveal and visual reset implementation

Spec: `docs/superpowers/specs/2026-09-13-archive-reveal-design.md`.

Global constraints: React/CSS only; preserve request keys, revisions, wallet authority, owner permissions and pack probabilities. No real purchase or production mutation during QA. RU/EN, reduced motion, keyboard accessibility. Repository is an isolated linked worktree. Local commits are synthetic bookkeeping and MUST NOT be pushed. Root publishes via GitHub API using real main parent `70d05c60b0f6bdd8781c8f00153e5135f44d34f2`. Never raise asset budgets. No AGENTS.md applies.

### Task 1: Receipt-driven pack opening

Own only `frontend/src/archive/transactions.tsx`, new `frontend/src/archive/PackReveal.tsx`, new `frontend/src/archive/pack-reveal.css`, `frontend/tests/archive-entry.tsx`, `frontend/tests/archive.test.mjs` and new `frontend/tests/pack-reveal-layout-entry.tsx`. Root owns PackShop, packs.css and the broader presentation. Work in `/workspace/scratch/05fc97d1ada5/dc-pr37` on the current feature branch; do not switch branches or touch unrelated changes.

Implement the receipt reveal described in the spec. Use a native dialog for the immersive scene, opened through an explicit button in the pack receipt. Show a sealed envelope, animate its opening briefly (under one second), reveal the actual saved cards one at a time with rarity accents and a complete summary. Use existing Lucide SVG and CardPreview. Keep an always available skip-to-results control and close/Escape behavior; preserve the receipt when the dialog closes. History (`ReceiptView` without an explicit animation opt-in) and non-pack receipts show immediately. TransactionStatus may opt new pack receipts into the cinematic button. Replay uses only the existing receipt, never fetch. Define short RU/EN labels, duplicates and test grants remain visible. Reduced motion must open directly to results, honor changes during a session and disable transforms. Explicit receipt ID keys reset state; timers and media listeners clean up. Respect actual item count, including empty/one-card receipts. Keep title/hero text inside card safe areas.

Write meaningful failing tests before implementation: actual items appear in original receipt order, next/skip/replay/close cannot create extra network writes or alter wallet, repeated receipt IDs/new IDs behave correctly, history/non-pack are immediate, reduced motion is immediate, focus returns and timers clean up. Extend existing archive harness; native dialog can be stubbed narrowly for jsdom. Keep all existing transaction/recovery tests. Add an offline fixture entry rendering real receipt components with sample card data explicitly labeled as demo; include rank choice and optional reduced-motion explanation. It may reference fixture art.webp that root will copy; never issue production API requests.

Run `pnpm exec tsc --noEmit`, targeted archive tests, and targeted `pnpm exec oxfmt` in frontend. New minified CSS target under 3 KB; root will reclaim obsolete landing styles. Do not edit budgets or build dist. Commit only owned files. Report outcome, tests, limitations and commit to the assigned report file. No subagents.

### Task 2: Coherent presentation

Root updates the existing Landing component, bureau/interface styles, archive owning styles and PackShop. Remove redundant hero animation/decorations and replace the dense headline with a compact editorial composition and two clear paths. Fix the desktop/menu breakpoint conflict at its owner. Keep all existing public navigation and demo signing reachable. Give the archive consistent controls and surfaces, cover art and readable price/actions. No new general CSS override layer. Reclaim unused animation CSS where source references prove it is unused.

### Task 3: Delivery and review

Root integrates the offline reveal fixture with the existing CI preview artifact, updates design QA notes, runs all frontend tests, typecheck, format, production build, release check and size budgets. Task-scoped review of Task 1, then a broad final branch review. Document public live screenshots as observations, not proof of the new build; new private-page visual QA remains pending until access is available. Publish new branch and PR via GitHub API; verify all required CI checks on the exact head. Do not merge or deploy.
