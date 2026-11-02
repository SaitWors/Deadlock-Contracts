# Bureau parchment and atmosphere implementation plan

> Execute with superpowers:executing-plans; the user's four annotated changes are the approved visual brief.

**Goal:** Replace the signing window with one readable parchment, remember a personal autograph, and bring back the glowing animated DeadChaps atmosphere.

**Architecture:** Keep the existing React signing state machine and authoritative server receipt. Present all terms, identity, signature, errors and confirmation on one paper document. Replace the signing film with transparent native stamp animation. Reuse the supplied archive's ambient loop with local poster fallback, reduced-motion and visibility controls. Add original generated bureau art without changing gameplay or backend endpoints.

**Tech stack:** existing React/TypeScript, local assets, CSS, SVG pointer signature, localStorage scoped by stable user ID.

**Spec:** user's screenshots and four numbered changes, 2 November 2026. New motion/glow request supersedes earlier static-background constraints.

## Constraints and decisions

- Preserve server confirmation, duplicate-submit guards, stale-selection errors, receipt, keyboard focus, RU/EN, mobile and theme support.
- Signature preference persists per account in this browser; disclose device scope and storage failure. It is cosmetic, not an authentication or legal signature.
- Anonymous demo uses an isolated preference key; never opens a real case or awards XP.
- No new packages, backend changes, CI budget relaxation, production deployment or merge.
- This scratch checkout is already isolated from user work. Branch from verified main tree f987ae79ba2545b640cc2144d30067652578f297; apply only changed files when creating the remote commit.

## Tasks

- [ ] Signing: add behavior tests for persistence, account isolation, blocked/corrupt storage, drawing and failure/confirmed animation. Observe failure; implement SignatureField and storage helper, then one-sheet ContractSigning and replace obsolete film tests with native animation lifecycle tests.
- [ ] Atmosphere: replace static seal with supplied ambient loop, pause on reduced motion/hidden tab, poster on blocked playback; generate and integrate transparent bureau still-life. Document source attribution. Fix paper badge contrast at component scope.
- [ ] Verify: full frontend suite, types, formatting, production build, unchanged bundle budget, browser desktop/mobile RU/EN, draw/type/reopen and signed/error states; final independent review; commit to new PR and verify CI.

## Review focus

- Reject malformed/oversized stored strokes; never interpolate stored SVG markup.
- Stable account keys, no signature leakage between accounts; storage exceptions cannot block contract submission.
- Touch scrolling outside drawing surface; cancel/undo/clear; keyboard typing alternative.
- No success or seal before validated server receipt; animation skip never posts again.
- Light text on parchment and header specificity after lazy dashboard CSS; narrow viewport and long names.
