# Contract board implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Make the existing contract selection screen compact, coherent and usable in every data state.
**Architecture:** Retain Dashboard state and handlers. Add board-local presentation and request feedback; reuse the current theme tokens and signing dialog.
**Tech Stack:** React 19, TypeScript, Vite, pnpm, CSS, node:test and JSDOM.
**Spec:** `docs/design-direction.md`

## Global constraints

- One existing screen: `/#quests`; no shared-theme or navigation redesign.
- No new dependencies, asset downloads, lockfile changes or server/API changes.
- Real server data and 1–3 selection/signing rules remain authoritative.
- Russian/English, current themes, keyboard and reduced motion remain supported.

## Review focus

- An empty category must offer recovery without discarding selected contracts.
- Initial failure, missing board and slow request must be distinguishable.
- Late responses must not replace newer data or feedback.
- Locked cases must remain readable and unavailable for selection/refresh.
- Long localized content and a three-item summary must fit 320 px without covering actions.

### Task 1: Contract board presentation and state feedback

**Files:** modify `frontend/src/Dashboard.tsx` and migrate its exclusive card rules out of `frontend/src/nightshift-core.css`; create `frontend/src/contract-board.css`; create `frontend/tests/contract-board.test.mjs` and `contract-board-fixtures.mjs`; reuse `tests/first-visit-entry.tsx`.
**Consumes:** existing BoardsPayload, selection state, loadBoards, toggle, reroll and openSigning.
**Produces:** the same screen/actions with scoped dossier styling and explicit board request state.

- [ ] Write DOM tests for initial loading, board retry, missing mode, empty category recovery, filter pressed state, selection/signing preservation and stale request handling.
- [ ] Run `node --test tests/contract-board.test.mjs`; verify the new state/semantics assertions fail before implementation.
- [ ] Add board loading/error state guarded by the existing request counter. Preserve request propagation and polling.
- [ ] Scope presentation to `.dc-contract-dossier`; keep the original handlers and information. Add concise heading/rules, category counts, explicit recovery and accessible selected count.
- [ ] Run targeted tests, then the complete frontend suite, TypeScript, formatter and production build with existing budgets.
- [ ] Inspect before/after production frontend at 1440 and 390 px plus 320 px, all themes, RU/EN, long text, keyboard, reduced motion, error/empty/locked states. Check another screen for CSS leakage.
- [ ] Document assets, commands/results and limitations; review diff; commit only task files.

### Task 2: Review and publish

**Files:** task diff and documentation only.
**Consumes:** verified implementation and evidence from Task 1.
**Produces:** a new PR targeting `main`, without merge/deploy.

- [ ] Obtain a fresh code review, address important findings and run the affected checks.
- [ ] Publish the branch through the authorized GitHub connector, preserving the original base tree.
- [ ] Create PR with actual scope, reference principles, checks, resources, evidence limitations and excluded work. Use draft if a material blocker remains.
- [ ] Read back URL, number, base, head and draft status.
