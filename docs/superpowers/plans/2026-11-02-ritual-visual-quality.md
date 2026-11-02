# Ritual Visual Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the deployed Ritual visual system to match the user's selected prototype: a visible occult background, Valve Oracle typography and consistently sized controls.

**Architecture:** Preserve React routes and application behavior. Use one shared foundation for fonts, decorative background and control geometry; edit the existing Ritual public/workspace owners instead of adding page-specific patch layers. Reuse the user's supplied Oracle font and local Inter files.

**Tech Stack:** React 19, TypeScript, CSS, Vite 8, existing Node tests and cloud browser QA.

**Spec:** `docs/superpowers/specs/2026-11-02-ritual-contracts-design.md`, corrected by the current user request and supplied prototype ZIP.

## Global Constraints

- Keep the existing near-black, ivory, muted olive and parchment palette.
- No neon, glass panels, decorative particles, large rounding or City Never Sleeps fonts.
- Preserve RU/EN, all five appearance modes, motion preference, signing and real server integrations.
- Keep the current asset budgets; no backend, deployment or migration changes.
- Work in the separate verified source snapshot of upstream `f8ceac6`; deliver on a new branch and PR without merging.

## Review Focus

- Cyrillic and Latin headings must load the provided display font, including numerals.
- The background must remain visible after loading and remain decorative, without intercepting clicks.
- Primary, secondary and header controls of the same role must have the same 44 px minimum height.
- 320/390 px layouts and 200% text zoom must preserve navigation and readable card content.
- Light, black and custom themes must keep text readable and respect reduced motion.

### Task 1: Restore and verify the shared visual system

**Files:** `frontend/src/appearance.css`, `index.css`, `vnext.css`, `main.tsx`, `ritual.css`, `ritual-workspace.css`, `Landing.tsx`; new `ritual-foundations.css`, `frontend/src/imports/ritual/`; remove superseded `frontend/public/assets/ritual/covenant-city.webp`.

**Interfaces:** Consume the existing theme variables and action classes. Preserve every existing React prop, endpoint and route. Produce `--font-display`, `--font-number` and `--ritual-control-height` used by the two Ritual style owners.

- [x] Capture the deployed site and DeadChaps and verify all 242 frontend baseline tests.
- [ ] Restore Oracle display/numeral typography with local Inter body text and consistent control tokens.
- [ ] Replace the faint city montage with a shared static transparent pentagram ornament; use real intrinsic image dimensions and stable layout.
- [ ] Improve hero spacing, readable paper cards and workspace hierarchy in the existing style files.
- [ ] Run `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build` and `python3 scripts/check_frontend_budget.py`; expect success within unchanged budgets.
- [ ] Inspect public and workspace UI in the cloud browser, compare before/after and record widths, font loading, control sizes and theme limits.
- [ ] Obtain a fresh whole-change review, resolve material findings and create the reviewable PR.

Visual-only CSS changes use real browser measurements and the existing functional suite. Do not add source-string tests that merely restate CSS.
