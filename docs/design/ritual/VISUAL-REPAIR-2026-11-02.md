# Ritual visual correction

The reported deployment was built after PR #54 and its working directory pointed at `f8ceac6`. The old directory name was not evidence of old source. The live page and the current repository were inspected together.

## Corrected causes

- The occult geometry was baked into a very dark city image and was difficult to see. It is now a separate static transparent ornament shared by the public and private shells. An inherited `mix-blend-mode: screen` is reset so the symbol remains visible in light mode too.
- The user's prototype supplied Valve Oracle, but the previous implementation assigned Jost to headings, body text and numbers alike. Oracle now owns headings and numerals; bundled local Inter owns body text and controls.
- Public and private controls specified different sizes at multiple breakpoints. Shared action and header controls now use a 44 px minimum height; mobile hero actions occupy the full available width.
- Lazy dashboard CSS had equal specificity with the Ritual owner and could replace parchment colors after loading. The owner is explicitly qualified by the active theme and Ritual shell. Paper cards define their own ink, muted text, accent and line tokens, so later legacy rules cannot turn rewards or labels white on paper.
- Hero text and actions now consume theme tokens. The appearance drawer uses the same restrained corners and updated theme samples.

## Verification

- All 242 frontend tests passed on the original snapshot and after the frontend changes.
- TypeScript, production build and formatting of changed TSX files passed.
- Asset budgets remain unchanged. Exact final totals are recorded in the PR.
- The cloud browser inspected the actual production build, public RU/EN pages and the real dashboard components with isolated test data.
- Browser measurements: principal public/private actions and header controls are 44 px; the account control is also 44 px. Public pages at 320 and 390 px iframe widths have no horizontal document overflow; the two mobile hero actions have equal width and 44 px height.
- Light/dark contrast and late-loaded paper styles were checked visually and through computed styles. Browser-native 200% zoom, real mobile hardware, Steam sign-in and a live match were not verified.

The preview uses copied production assets because the unmodified Vite dev server rejects the managed preview hostname. Preview fixtures and simulated API responses stay in ignored `.qa/` files and are not included in production.
