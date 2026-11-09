# Occult city bureau — visual refinement

## Evidence and current decisions

This work starts from main `82f8595` after the completion finale merged. No AGENTS.md exists in the workspace/repository. The current request authorizes stronger game atmosphere while retaining the working structure, functionality and coherent digital appearance.

The current conversation was reviewed, including the independent design feedback: preserve pentagram/background and ranking, keep the simpler navigation and readable explanations, remove paper-coloured panels/generated scrolls/desk props, avoid terminal heading periods, keep the active navigation line inside the header, and make navigation smooth. The final contract ceremony remains intentionally minimal, with its specific animation and confirmed XP.

History access was checked before implementation. The Codex catalogue and the separate chat “Настройка Deadlock-Contracts” were available; that chat contains environment setup, not visual decisions. Requests for older UUID-thread messages did not return content. ChatGPT history/archive access explicitly requires a local desktop caller; this cloud task cannot read them. No requirement is inferred from unreturned messages or a thread-list summary. This document is not a claim that inaccessible chats were reviewed.

Repository chronology also matters: the October compact board and November 2 literal parchment treatments precede the November 4 digital-coherence decision. Current `DESIGN.md`, `UX-CONTRACT.md`, appearance tokens and the latest user request govern this iteration. Old peach/Jost/Ruslan defaults and paper/scrolls are not revived. Older removals of Arena, coins, cipher and user catalogue remain outside scope. DeadChaps/Statlocker/Deadlabs are previously user-named references, not sites newly inspected during this iteration.

## Assessment and chosen direction

Preserve local Valve Oracle/Inter (Cyrillic verified in Chromium), the pentagram, supplied atmospheric loop/fallback, real routes, functional preview/signing and accepted ranking. What flattened the game character was repeated neutral opaque boxes, blank card middles, equally weighted target/reward/status and explicit CSS suppression of all card feedback.

Chosen direction: a nighttime bureau issuing contracts in Deadlock's city. One map-backed objective carries the main visual expression; ordinary working surfaces use framed category symbols, a short accent rail, a distinct factual XP block and readable status. The gain is a stronger game-world composition; the trade-off is greater first-screen visual weight. Keep the rest quiet and usable.

- First screen: existing `uptown_02.webp` inside the preview's target field, full-width image band, real target/reward, restrained frame depth. Existing content and preview action retained.
- Missions: consistent public/live category frame, reward block and selection mark; actual failure/review/verifying tones keep textual status. No random hero/category association or invented rarity/reward.
- Progress/cases: existing account bar, primary goal/reward, active case and history inherit the same frame/XP vocabulary.
- Motion: short first-screen 520ms WAAPI entry with ≤160ms stagger; 4px fine-pointer hover lift, press response and brief selected check. Selection/signing are immediate; no extra infinite motion.

## Owners and deliberate evolution

| Earlier rule / source | Resolution |
|---|---|
| Quiet foreground / DESIGN.md | Retain digital opaque panels; deliberately allow one city-backed objective and restrained edge/XP details. No paper, glass cards, arbitrary neon or disconnected generated art. |
| Runtime palette / appearance.css | All palette, theme and locale roles retained. No new theme, font, dependency or downloaded asset. |
| Board overrides in two stylesheets | Consolidate card recipe into contract-board.css; remove duplicate ritual-workspace rules. Shared feedback stays in ritual-foundations.css. |
| Old no-transform card suppression | Replace with purposeful hover/press and reduced-motion variants requested now. Body/condition reading remains stable. |
| Completion scene | Preserve its separate transforms, full choreography and saved reward receipt; no new effects spill into it. |

## Verification

- `cd frontend && pnpm test`: 307 passed. TypeScript, formatter and production build passed.
- DESIGN.md lint: 0 errors and 0 warnings. Frontend budgets pass without relaxed limits; CSS is smaller than the main baseline, and no dependency/lockfile was added.
- Chromium: public/home/contracts/collection/how/about/ranking, persistent navigation shell and Back, preview signing/Escape/focus, keyboard Space and the three-card cap; live-board selection/status/account-progress fixtures; desktop 1440/1728 and mobile 320/390; dark/light/black/custom and OS/saved reduced motion, including interruption during the actual intro.
- Corrected mobile numeric wrapping and the reduced-motion native-bar selector specificity after independent browser/code review. Selected cards rise without moving siblings; image geometry is reserved; lazy collection portraits load when scrolled into view. No page errors in the matrix.
- Cold-load CLS was about 0.04 in this harness (BODY replacement/font load); the new image and hover introduced no measured geometry shift. Headless rAF timings were unstable even with the new intro disabled, so they are not presented as a device FPS guarantee. No intro long tasks were observed.

Isolated QA API fixtures are used only outside production code. Live Steam authentication, live match-provider validation, real mobile hardware and production reward mutations were not exercised by this visual change.
