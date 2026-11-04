# Digital coherence redesign

User direction: preserve the pentagram and supplied animated background; other visual decisions are delegated. Remove parchment tiles, AI scrolls and desk, terminal heading periods and disconnected illustrations. Repair active navigation and page-switch flicker. Existing useful explanation, ranking layout, routes, game data and signing behavior remain.

## Approach and trade-off

Chosen: retain the atmospheric occult background and local Valve Oracle / Inter identity; build the foreground as a digital contract workspace with graphite panels, neutral text, restrained sage selection and straight edges. This keeps the existing identity while losing the literal antique-paper metaphor. A complete rebrand would discard the background the user wants; recoloring scrolls would keep the conflicting illustration language.

## Components and scope

- Replace the hero scroll/desk with a rectangular, functional contract preview using the existing example objective and signing dialog.
- Replace sealed scroll illustrations with a shared composition of existing local Valve hero portraits; retain collection descriptions and sign-in actions. Retire landing mascot decoration in favor of useful feature links.
- Replace paper surfaces in public contracts, authenticated contracts, daily packs, signing, shared legacy token aliases and standalone informational documents. All five themes inherit the same semantic roles.
- Fix the navigation underline within each header link and reserve scrollbar geometry.
- Add narrow public-route navigation that keeps React shell/background alive, obtains destination copy and metadata from its server document, supports browser history and leaves auth/private/external links native. Keep old content visible while pending and recover through normal document navigation on failure.
- Remove trailing periods in headings and repeated book-header ornament; preserve prose and legal content.

## Constraints and verification

No backend game, auth, reward, collection or permission changes. No generated art. Follow-up explicitly authorized by the user: add five Hugeicons Free Stroke Rounded navigation icons using official `@hugeicons/react` and `@hugeicons/core-free-icons` packages; retain existing Lucide UI and brand symbols. Existing local portraits and notices are sufficient; no competitor layout or assets are copied. CSS token owner remains frontend/src/appearance.css; standalone documents mirror theme values. Runtime checks: frontend tests, TypeScript, formatter, production build and unchanged asset budget. Browser checks: matched desktop/mobile before and after; routes, Back/Forward, locale, slow/error transitions, keyboard selection and signing, light/black/custom themes, reduced motion, absence of overflow and console errors. Steam provider authentication cannot be verified by isolated local UI checks.
