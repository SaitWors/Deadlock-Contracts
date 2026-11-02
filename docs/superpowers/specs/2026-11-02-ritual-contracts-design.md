# Deadlock Contracts: Ritual design

User-authorized full redesign and a new PR against main 4e397a6. User selected the supplied ZIP's contract/scroll treatment, the attached open/sealed scroll images and 5-second rolling video, and DeadChaps / Statlocker / Deadlock API as visual references. Prior City Never Sleeps styling and piecemeal overrides were rejected.

## Intent
A focused Deadlock companion website: choose up to three real match contracts, sign once, play, see verified progress, collect a free daily pack. Keep authentication, permissions, admin functions, RU/EN, profile and community features. No fabricated live player counts, match verification or promised Overwolf availability.

## Visual direction
Dark near-black #0b0d0d canvas, warm white #eeeadd headings, muted olive #aec69b accent, parchment #e3d3ad contracts, restrained oxblood #9c3d37 seal. Modern local sans type with a condensed display face supporting Cyrillic. Sharp 2–6 px surfaces, quiet borders, generous hero and compact usable workspace. Atmospheric monochrome city and a large engraved occult seal inspired by the references; no neon, glass panels, decorative particles, large rounding or City Never Sleeps fonts. Motion is restricted to ambient seal movement and signing / pack reveal with reduced-motion support.

## Functional decisions
Remove Arena Bureau, coin balance/history and earning/spending, cipher and catalogue from user navigation and user-facing functionality. Preserve legacy data and migration history; disable old transactional entry points safely. Collection and daily pack remain. Daily claim uses server UTC calendar days (shown with server next reset), locks and a unique claim key, grants no more than one successful claim per user/date, uses existing server-side card drawing and immutable operation receipts. No payout if pool unavailable. Paid/direct acquisition and recycling for coins are retired. Admin catalogue tools remain for managing the collection.

Signing reviews exact server contract choices and reward XP. A server-confirmed receipt is required before success / rolling animation. Failed or ambiguous signing can retry through the existing recovery logic. Input signature, keyboard/focus trap, Escape, skip animation, reduced motion and mobile layout remain usable. Use supplied transparent scrolls and rolling video without modifying their original art or watermark.

## Approaches considered
1. More overrides on Nightshift: rejected because prior PRs left the public site and shell unchanged.
2. An unrelated standalone demo: rejected because this must update the production repo and real contract flow.
3. Replace the public composition and private navigation, establish a shared Ritual theme and retain proven server integrations: selected by implementation judgment to satisfy the request.

## Verification
Frontend build/type checks and test suite, relevant backend and full regression tests where available, daily pack replay/date/concurrency/error coverage, keyboard/signing failure/reduced-motion checks and cloud browser captures for public, contract, collection and mobile layouts. PR describes actual validation and any untested production dependencies. No merge or production deployment.
