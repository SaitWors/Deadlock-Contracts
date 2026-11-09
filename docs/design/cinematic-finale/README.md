# Cinematic contract finale — rendered evidence

Captured from the production frontend build in Chromium at 1440×900, using isolated authenticated API fixtures. These are actual DOM/CSS/WAAPI frames and a continuous recording, not design mockups. No live account or reward was changed.

- [Full transition](finale.mp4): cabinet trigger → entry/bobbing → grey crack/split → sequential flights → XP fill → threshold hold → centered level accent → overflow → floating final → Escape.
- [Entry and floating plaques](01-floating.png)
- [Failed task splits into two halves](02-shatter.png)
- [Same profile centered at level-up with two waves](03-levelup.png)

The fixture uses the application's current progression curve, not the illustrative costs in the brief: level 3 starts at 50/220 XP (350 total); +120 reaches 170/220; +80 fills the remaining 50, then carries 30 to level 4's 280-XP band. The failed task gives 0 XP. The level screenshot captures the accent before the remainder refill; the recording includes the final 30/280 XP.

Validation on this change:

- `cd frontend && pnpm test`: 307 passed.
- `pnpm exec tsc --noEmit`, `pnpm build`, formatter and asset budgets: passed.
- Completion, snapshot concurrency, worker stability and migration regressions: 74 passed; migration head 0025; critical Python lint, compilation and release contents check passed.
- Browser: 1/2/3 tasks; partial/all failure; within-band, exact threshold, overflow/multiple levels; retained profile drift; actual flight completion before XP; immutable repeat after later account XP; early Escape/focus; last-match pending/review gates with case limits 2 and 5; 320/390 mobile layouts; OS/saved reduced motion in light/dark/black/custom themes; known/unknown legacy static results. Also verified reduced→full changes during flight and after centering, same profile node, one receipt GET and no page errors.

The screenshot/recording files live in documentation only and are excluded from the frontend build.
