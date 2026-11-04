# Digital coherence implementation plan

> **For agentic workers:** use focused parallel implementation with one independent final review. The user delegates design choices; proceed within this approved scope.

**Goal:** a coherent digital foreground over the preserved pentagram background, with stable public navigation.
**Architecture:** React 19, TypeScript, existing CSS semantic tokens and native links; no new dependencies. Extend existing modules instead of duplicating theme or signing behavior.
**Spec:** docs/superpowers/specs/2026-11-04-digital-coherence-design.md

## Global constraints

Preserve BureauAtmosphere and game logic, API contracts, five appearance modes, Russian/English content, real anchor semantics, legal content and current asset-budget limits. Existing local Lucide UI/brand symbols remain. User-authorized follow-up adds five official Hugeicons Free Stroke Rounded public navigation glyphs through one shared renderer. Use existing Valve portraits, without implying sample art is a received reward.

## Review focus

Rapid public navigation must never install stale content. Back/Forward and language must keep metadata and visible copy aligned. Modified/new-tab/auth links remain native. Card/signature contrast must work in every theme. Mobile widths must reflow without clipping or shifting the header.

### Task 1: Shared foreground and landing

Files: appearance.css, appearance-state.ts, ritual.css, Landing.tsx, new CollectionPreview.tsx; DESIGN.md and UX-CONTRACT.md.
- [x] Tokenize remaining public paper colors and legacy paper aliases; use cool graphite, neutral text and the existing sage accent. Reserve scrollbar gutter globally.
- [x] Replace obsolete illustration DOM and exclusive styles with functional contract preview, shared local portrait composition and useful feature links.
- [x] Keep page copy/actions and existing board selection. Reset route-local preview/selection on route and language changes.
- [x] Browser-check desktop/mobile and all appearance modes; run frontend verification.

### Task 2: Workspace/signing visual consistency

Files: ritual-workspace.css, contract-signing.css.
- [x] Replace local parchment colors with semantic theme roles and rectangular pack/status geometry.
- [x] Remove paper texture/wax decoration while preserving signature input, accessible dialog and sealing state animation event.
- [x] Inspect signing and authenticated board in browser; run existing signing and workspace tests.

### Task 3: Public navigation

Files: App.tsx, publicRoutes.ts, BureauHeader.tsx, public-navigation.tsx and focused tests.
- [x] Test and implement atomic public content/metadata updates with retained shell, history, locale and native-link exceptions.
- [x] Test rapid navigation, loading/failure recovery and destination focus; parent fixes underline geometry in ritual.css.

### Task 4: Informational pages

Files: PublicContent.tsx, shared/public-pages.json, standalone document CSS/appearance script.
- [x] Remove repeated book ornament, trim terminal heading periods and align all standalone theme palettes.
- [x] Run public SEO/legal/document appearance tests, preserving content and destination routes.

### Task 5: Verification and review

- [x] Run pnpm test, pnpm exec tsc --noEmit, targeted formatter check, pnpm build and scripts/check_frontend_budget.py.
- [x] Use local Playwright (Browser plugin unavailable) for matched screenshots and interactions; keep artifacts in /tmp/dc-design-qa.
- [x] Independent review of changed source and evidence; fix material regressions and document actual limitations.


## Verification record

- Full frontend suite: 260 tests passed, 0 failed.
- Backend public SEO suite: 59 passed.
- `pnpm exec tsc --noEmit`, full `pnpm exec oxfmt --check`, production build and `git diff --check`: passed.
- Unchanged resource budgets passed: 713,798 bytes total JS, 298,367 initial JS, 462,452 CSS, 356,200 largest image, 2,669,485 total assets.
- `DESIGN.md` official lint: 0 errors, 0 warnings.
- Premium static audit compared against the original source: 40 existing findings, 40 current, 0 newly introduced. The existing findings concern legacy form validation/textarea declarations, an unrelated admin action and a per-file scrollbar false positive; the repo-wide static audit is not claimed clean.
- Browser: local Chromium/Playwright, real production build with isolated public/authenticated QA fixtures. Desktop 1440, responsive 1000/760/390/320; dark/light/black/custom and reduced motion; working motion playback verified separately. Public routes preserve the exact header/video elements. Selection cap, keyboard Space, preview signing/Escape, mobile menu, history, slow Back/cancellation, hash removal/top and locale checked. No script errors in normal public or authenticated board flows; no horizontal document overflow.
- Independent review found and fixed committed-route history rendering, same-page/hash cancellation and mobile locale menu closure. Added focused regressions.
- Screenshots/scripts/logs are outside source in `/tmp/dc-design-qa`; no production data or reward mutation was used. Live Steam authentication and real match/provider behavior were not exercised.


## User follow-up: navigation icons and commit

- Added five catalog-verified Hugeicons: `ContractsIcon`, `Cards01Icon`, `RankingIcon`, `GameController01Icon` and `InformationCircleIcon`.
- One shared `NavigationIcon` renderer supplies decorative 16px icons to existing labeled desktop/mobile public links. Authentication and game behavior are unchanged.
- Official packages: `@hugeicons/react` 1.1.10 and `@hugeicons/core-free-icons` 4.4.0, locked by pnpm. Their MIT notice is shipped in `frontend/public/licenses/hugeicons.txt`.

- Follow-up verification: all 260 frontend tests, TypeScript, full formatter and production build passed. RU/EN browser checks at 320, 390, 760, 1100, 1200, 1280, 1440 and 1728px found no overlapping header controls, document overflow or runtime errors; keyboard navigation and hidden decorative icon semantics remain correct.
- Updated resource budgets passed without changing limits: 720,454 total JS; 305,023 initial JS; 462,598 CSS; 356,200 largest image; 2,676,287 total asset bytes. Added MIT license text is shipped with public licenses.
