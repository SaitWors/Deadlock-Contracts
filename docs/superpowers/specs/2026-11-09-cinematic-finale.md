# Floating contract finale

The user's frames and explicit sequence supersede the previous panel-style recap. Work starts from current main 512bd1a; the not-yet-merged result API/entry integration from PR59 is carried forward as the implementation seam. No AGENTS.md was found under the workspace or its parent directories.

## Visual contract

Ready scene contains only a single profile plaque and 1–3 chosen task plaques against an almost black backdrop. No headings, recap footer, extra metrics, logo, explanatory copy or visible action bar. Profile contains avatar/name/level, XP numbers and a bar. Keep semantic live feedback and return control available to assistive technology. Escape immediately returns to cabinet result and restores focus; tapping empty backdrop also exits on touch devices.

Palette uses the dedicated --finale-* text/surface/accent stage tokens in appearance.css; motion preference comes from motion.ts prefersReducedMotion() plus reactive Appearance preference. The scene deliberately has its own dark stage in all app themes, with pale text/sage effects matching the frames. Use existing type and icons. No generated background or media dependency.

## Transform layers and sequence

Profile and tasks have independent entry, drift and action transforms. Profile drops from above, overshoots, springs back; tasks follow with short stagger. After landing, each drifts vertically and tilts with a separate phase. Pause drift at its actual current transform before flight; never reset a flying card to a synthetic origin.

Process failed tasks first so the centered level accent stays unobstructed, then successful tasks in stable saved order. Success pulls back, travels along a curved multi-keyframe path into the fill endpoint of the XP bar and scales into the plaque, leaving an attached light trail. Await Web Animation.finished before impact/XP. Profile bounces and gets a short edge glint/spark on ordinary impact. XP count and bar update from the same tween state.

XP changes are segmented at server-authored boundaries: fill the old band to exactly100%, hold briefly, shift the SAME profile plaque toward scene center and scale it up, replace level, trace the edge, emit two waves/sparks, then show leftover XP on the new band. Multiple crossed levels are separate accents. Keep the profile centered and floating in the final frame after a level-up.

Failed outcomes grey, reveal an angular crack, then separate into two falling/rotating halves with grey fragments. Actual reward0XP. No ordinary impact waves: only actual level crossings trigger the full two-wave effect.

Phone: compact profile above task stack; all panels and effects fit/reflow. Reduced motion: short fade to confirmed static final, no flight/bobbing. Loading/pending/error feedback only while no ready scene; close/retry remain possible.

## Saved result contract

Actual reward_granted_xp/ledger and server progression remain authoritative; ceremony cannot awardXP. Persist result snapshot when final verdict and all XP receipts exist, atomically with existing reward delivery. Reopen the same saved before/after/bands and task amounts regardless of later accountXP. Historical receipts can only animate if their immutable ledger chain proves the starting balance; ambiguous old results show a static ledger final. No inferred currentXP-minus-caseXP start. Preserve owner authorization and max_attempts from case; VERIFYING/REVIEW_REQUIRED after last attempt is still pending.

## Evidence and validation

Cases:1/2/3 tasks, partial/all failure, within-band, exact threshold, remainder/multiple levels, delayedframes, pending last attempt and XPdelivery, close/reopen, mobile/reducedmotion and focus. Run frontend pnpm test, tsc --noEmit, build; run relevant backend snapshot/delivery/migration tests. Review actual entry/flight/threshold/level-up frames in Chromium and include3real captures or a short recording in the new PR.
