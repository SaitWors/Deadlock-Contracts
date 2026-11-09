# Contract completion ceremony

## Intent and chosen approach

The user supplied a scene sketch and authorized designing the full interaction, implementing it, and creating a new PR. Preserve the digital bureau/pentagram identity. After the selected 1–3 assignments reach final authoritative outcomes, an explicit button opens a 5–8 second results ceremony. Do not open it automatically during gameplay.

Chosen approach: a read-only authoritative result receipt plus a native modal and CSS/DOM motion. A frontend-only reward estimate would falsely animate nominal XP before the asynchronous ledger is ready. Deferring actual XP awards until a cosmetic click would change progression and trust semantics. Neither alternative fits this presentation feature.

## Sequence

1. Show finish entry only for SETTLED cases with 1–3 selected final tasks and either all completed or exhausted attempts. A third attempt still VERIFYING/REVIEW_REQUIRED is not a failure.
2. Modal dims the screen, freezes a freshly fetched owner-scoped receipt and reveals profile/avatar/level/XP plus exactly the selected tasks.
3. Each completed task brightens, flies toward the measured avatar position and disappears into it; impact fills XP over a bounded tween. XP comes from trusted positive ledger entries, not nominal rewards.
4. At every level threshold the bar resets to the next band, the level changes, a sage ring expands around the avatar, and remaining XP continues. Never award or mutate profile XP from animation.
5. Failed tasks turn grey and split into two fading, outward-moving halves. VOID/EXPIRED use neutral labels, not a claim that unverifiable data was a player failure. Zero successes leaves the profile unchanged and uses a calm exhausted-attempts ending.
6. End with success count, actual case XP and current profile progress. Skip/Escape during playback immediately reveals final state; Escape/close afterward dismisses. Replay is available and safe.

## Data and integration

GET /api/boards/{board_id}/completion is authenticated and owner-scoped. No POST, schema migration or new reward operation. Completed positive-reward tasks require durable trusted XP ledger entries; otherwise response ready=false/REWARDS_PENDING and UI offers retry. Receipt includes actual task XP, current progression and server-authored absolute level bands. Visual starting XP is max(0,currentXP-caseXP), explicitly a replay projection, not an asserted historical balance; final XP is clamped to current authoritative XP if later adjustments reduced it. Label XP as already credited. Interleaved rewards cannot be granted again by viewing.

Keep replay accessible from history after a day reset. Active view gets a separate ready-results section so a settled case does not disappear without an entry. Current active counts remain unchanged. Main Dashboard only consumes a reusable button; an isolated case-completion module owns request cancellation, retry, dialog focus and timeline.

## Accessibility and resilience

Native modal focus/inert background/scroll lock; restore visible trigger or brand. RU/EN, all themes, keyboard, narrow/short screens. Profile above cards on mobile, scene internally scrollable. Decorative flight/shard duplicates aria-hidden; announce task outcomes and levels, not every tween frame. System/manual reduced motion shows the static result immediately. If reduced motion turns on during playback, finish immediately. Skip/close never depend on animationend. Clean timers/rAF/requests on unmount; late responses cannot replace another case.

## Verification

Backend: ownership/unauthenticated, early completion, mixed/all failed, unresolved third attempt, ledger delay/source filters, actual vs nominal XP, zero XP, repeated reads without mutation and level boundaries. Frontend: 1/2/3 tasks, threshold overflow/multiple levels, zero reward/failure, skip/Escape, reactive reduced motion, loading/retry/stale/unmount, keyboard/focus and replays. Production browser checks desktop/mobile, motion and reduced motion, zero errors/clipping. Existing frontend/backend suites, typecheck, formatter/build and unchanged asset budgets.
