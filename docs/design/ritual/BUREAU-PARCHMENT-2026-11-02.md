# Bureau parchment revision — 2 November 2026

The user's four annotated corrections replace the earlier static-background brief. All contract functions now sit on one parchment: actual conditions, operator, mode, potential XP, autograph, seal, errors and server receipt. The folder bar, stepper, side panel and signing video are removed. The native CSS seal animation has a transparent surroundings and does not hide the terms. Reduced motion goes directly to the receipt; skip does not submit again.

Text signatures and drawn signatures are remembered per stable account ID in this browser's localStorage. This is a cosmetic preference, not a server-synced signature or authentication. The UI states the scope and reports a storage failure without preventing signing. Anonymous previews use a separate key. Stored drawings contain bounded normalized coordinates, never arbitrary SVG. Typing remains available for keyboard users; undo, clear and pointer cancellation are supported.

## Assets and provenance

| Asset | Provenance |
| --- | --- |
| `frontend/public/assets/ritual/bureau-atmosphere.mp4` | Copied unchanged from the user's attached `deadlock-contracts-preview.zip`, `public/assets/ritual-loop.mp4` (287273 bytes). That archive attributes it to DeadChaps' `https://www.deadchaps.gg/roster_bg_loop.mp4`, also verified on the reference's rendered video on 2 November. User-supplied reference media; no claim that third-party media is public domain or independently licensed here. |
| `bureau-atmosphere.avif` | Compressed poster from the same supplied archive. Used when motion is off, loading or blocked. |
| `bureau-desk.avif` | Original art generated with built-in ImageGen, alpha preserved, optimized to 1024px/AVIF. No stock purchase or third-party illustration download. |
| Parchment, letterhead, seal, soul motes | New CSS/SVG interface artwork; existing local Lucide eye/feather icons. No signing film or watermark remains. |

Generated illustration prompt: “Transparent decorative illustration for a Deadlock-inspired occult contract bureau: a weathered 1920s brass-and-black typewriter, a glass soul vessel with mint spectral light, burgundy wax stamp, worn case folders and a brass desk lamp. Three-quarter painterly game-prop still life; tarnished brass, ivory paper, forest-green metal, soft alpha shadows. Full objects inside frame, no words, brands, logo, border or watermark.” The original PNG is retained separately; the application consumes the optimized asset.

The ambient loop is decorative, muted and noninteractive. It pauses in hidden tabs. Reduced-motion omits video entirely and stops motes; blocked playback leaves the local poster. The paper UI fixes ink colors independently of page themes. Contract status text is explicitly dark on paper in every state.

## Validation

- Baseline: 242 frontend tests passed.
- New behavior: 245 frontend tests passed, including signature reopen, separate accounts, drawing/undo, malformed and oversized storage, blocked storage, server failure/retry, duplicate-submit guard, native stamp completion/fallback, reduced motion and hidden-tab ambient playback.
- TypeScript and production build passed. Existing bundle limits unchanged; total assets 3062409/3100000 bytes at first validation.
- Browser QA and independent review are recorded in the PR's final validation notes. Local preview fixtures never contact the production API.

Browser QA: public desktop dark/light, actual ambient playback and motion-off, paper desktop and 320px (no horizontal overflow; equal-width actions), drawn signature restored after reload, and confirmed state preserving conditions. Independent review found a disappearing-tap issue; a failing regression was added and fixed, with all245 tests still passing. Real touch hardware and production authentication were not exercised.
