# Contract board: dossier direction

Date: 2026-10-29. Continues the unfinished 2026-10-28 plan. Scope: the existing authenticated `/#quests` screen only.
Chosen autonomously under the user's explicit instruction; this is not a site-wide redesign.

## Intent and alternatives

Make choosing up to three contracts and signing a case the clear purpose of the screen.

1. **Contract board / case archive (chosen).** Charcoal, warm light text, restrained peach accent, thin rules and compact dossier cards. Keeps long conditions readable and makes selection unmistakable.
2. **Operations ledger.** Dense rows and aligned numeric columns. Faster scanning of rewards, but less space for multi-condition contracts and weaker mobile reading.
3. **City poster.** Larger Ruslan Display headings and more space between offers. Strong atmosphere, but pushes the working controls and contracts down the page.

The first option fits this functional screen. Keep the existing city identity in the shared navigation and typefaces; use the compact hierarchy observed in DeadChaps inside the board.

## References actually inspected

| Source | Access on this date | Useful principle and adaptation |
| --- | --- | --- |
| https://www.deadchaps.gg/ | Live homepage, accessibility tree and screenshot inspected on 2026-10-28 in the preceding task; recovered notes used here. On 2026-10-29 both text fetch and cloud browser failed (connection timeout after one reload) | Compact navigation; clear section headings; data in bounded, readable panels. Adapt the hierarchy and density, not its logo, purple effects, background artwork or text. |
| https://statlocker.gg/ | Live homepage shell, screenshot and navigation in cloud browser; FAQ and page text through web search (2026-10-29) | Group related controls and data. Retain the existing match-mode control and put time limits together; do not import the promotional hero or overlays. |
| https://godly.design/website/papermark/ | Catalogue detail text re-read on 2026-10-29; the linked desktop hero screenshot was inspected in the preceding task | One dominant typographic message and quiet supporting controls. Only this hierarchy informs the compact board heading; no marketing layout or imagery is copied. |
| https://mobbin.com/ | MCP task-dashboard search refused in the preceding task: paid plan required; no repeat or workaround attempted | No screens inspected or used. |
| https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md | Full rendered source text | Subject-specific hierarchy, restraint and visual review; used as guidance, not application code. |

## Existing architecture

React 19 + TypeScript + Vite 8; pnpm lockfile; existing CSS/Tailwind pipeline.
`App.tsx` resolves public URLs and session state. Authenticated sections use Dashboard hash navigation.
Dashboard owns API requests, selection per mode, polling, refresh and signing. `ContractSigning` validates the current authoritative board before posting. The server remains authoritative.
Existing Jost/Ruslan Display fonts and local Lucide SVG icon component are reused.
No AGENTS.md, CLAUDE.md or PR template exists in the inspected source tree. Backend is FastAPI + SQLAlchemy; its routes, services and persistence are unchanged.

## Tokens and layout

Use the existing `--ns-*` theme variables; do not add a second theme provider or change global defaults.

| Role | Existing token / board treatment |
| --- | --- |
| Page / panel / selected surface | `--ns-bg`, `--ns-surface`, `--ns-soft` |
| Main / secondary text | `--ns-text`, `--ns-muted` |
| Action / selection | `--ns-fill`, `--ns-on-accent`, `--ns-accent` |
| Status | Existing danger, warning, success and info tokens plus explicit text/icons |
| Default dark palette | #181715 background, #252a26 surface, #f7e9d5 text, #bdb9a8 secondary, #f6a26d accent, #596052 border |
| Heading / body | Local Ruslan Display, 30–42 px page title; Jost, 14–16 px reading text |
| Spacing / width | 4/8/12/16/24 px steps; existing workspace width; 3/2/1 card columns |
| Borders / radius / shadow | 1 px rules; radius capped at 6 px inside board; no card shadow |
| Motion | 140 ms colour/border feedback only; no card tilt, sheen or entrance effects; system and manual reduced motion respected |

Three compact controls remain distinct: mode, category filter and selected-contract summary.
The selection summary is in document flow after the cards, so it never covers a card or the mobile navigation. Time limits and attempt counters follow it as secondary information. Contract rules are available through a native keyboard-accessible disclosure.
Long titles and conditions wrap; no required information is limited to hover.
Light, black, custom and system themes continue through the current theme mechanism.

## First PR boundary

Change Dashboard's quest presentation, a stylesheet scoped to `.dc-contract-dossier`, targeted existing-stack DOM tests and these documents. Remove the superseded contract-card/selection rules from `nightshift-core.css`; these selectors occur only on this screen. Keep shared navigation, mode controls and other page styles.
Add initial loading, retryable board errors, absent-board/empty-filter feedback and accessible filter state.
Keep API endpoints and request bodies, polling intervals, per-mode selection, three-contract limit, refresh quotas, signing dialog, CSRF, session checks, routes and server logic.
No dependencies, lockfile changes, downloaded game art or generated images.
Shared navigation, home, active cases, history, archive, arena, profile and administration remain outside the visual change.

## Baseline and verification approach

Base commit: `690eb66315c73e7001c7ad5add23e17e694275ca` on `main`; no open PRs at start.
All 774 source files were read through the authorized GitHub connector and verified against Git blob hashes; the original signed commit and exact tree were reconstructed locally. Direct Git transport has no credentials here.
Baseline: 213 frontend tests pass in this task. Prior task logs also record successful TypeScript, formatter, production build and asset budgets. Current checks are recorded separately below.
Browser checks use the real production frontend with explicitly labelled, isolated API test fixtures; these never replace production data. Live Steam login and external match-provider validation are outside this UI-only change.

Tool audit: GitHub read/write permissions confirmed; terminal and Node work; Figma identity check succeeded with a View seat (no Figma file authored); cloud browser inspected Statlocker; DeadChaps timed out today (prior observations retained). Superpowers planning/testing guidance used. Open Design MCP, its installed runtime, and 21st.dev MCP were not found. Image generation is exposed but unnecessary for this screen.

## Implementation notes

- One isolated worktree/branch: `design/contract-board-dossier-20261029` from the verified default `main`. The preceding checkout and its uncommitted files are unchanged.
- Request feedback uses the existing monotonic board request counter for both success and failure. Background failures keep the last board and selection visible. A successful signing response invalidates older pending board requests and clears loading/error feedback.
- The source adds no backend behavior, browser storage format, dependency or lockfile change. Existing Jost/Ruslan Display Cyrillic fonts and vendored Lucide icons are reused; see `docs/assets-sources.md`.
- Cloud Browser cannot connect to executor localhost. Browser tests therefore use a local headless Chromium test runtime with the production bundle and an isolated fixture HTTP server. Nothing is sent to production. Fixture user is explicitly named “Демо · QA”.
- Moving exclusive legacy card rules into the scoped stylesheet avoids accumulating two generations of card styles. Build budgets remain unchanged.
- No UI from Figma, Mobbin, Open Design or 21st.dev was imported. Figma account access (View) was verified; no file was authored. The frontend-design guide was read from the user's official repository link. No generated imagery is needed.

## Validation of this implementation

- `cd frontend && pnpm test`: 223 tests passed (213 baseline, 10 board tests).
- `cd frontend && pnpm exec tsc --noEmit`: passed.
- `cd frontend && pnpm exec oxfmt --check`: passed; the project has no separate lint script.
- `cd frontend && pnpm build`: passed.
- `python scripts/check_frontend_budget.py frontend/dist`: passed without relaxing limits (826,070 bytes JS; 301,575 initial JS; 474,695 CSS; 356,200 largest image; 2,656,369 total assets).
- Local Chromium with the real production frontend and isolated QA API fixtures: widths 1440, 1000, 760, 390, 320; keyboard Space selection and visible focus; three-selection cap; empty-filter recovery retaining selections; existing signing dialog opening and closing; no horizontal document overflow; reduced motion; zero script/resource errors in these normal scenarios.
- English at 390 px in dark/light/black/custom/system themes; Russian loading/error/missing-board/locked/long-title states at 320 px. Screenshots inspected; no horizontal overflow.
- Fixture server initially lacked six existing lazy art routes. It was corrected to serve the existing files; final normal browser scenarios report zero resource errors. No production assets were added.
- Steam authentication against the live service, production API signing, real matches, database and backend integration were not exercised by this UI change. Existing signing tests cover the authoritative validation path.
- Screenshots contain explicitly labelled QA data, not live player statistics; supplied separately rather than committed to the repository.

## Alternative directions considered

| Direction | Palette and type | Layout and controls | Motion, benefit and trade-off |
| --- | --- | --- | --- |
| Contract board / case archive (selected) | Existing charcoal/ivory/peach dark theme; Jost body, restrained Ruslan Display heading | Compact 3/2/1-column cards; clear objective, reward and selection; existing sidebar and mode controls | 140 ms colour feedback only. Retains character and space for conditions; longer cards still require scrolling on phones |
| Operations ledger | Graphite `#171a1b`, off-white `#f0eee6`, muted teal `#94b3a5`; Jost for headings and data | Table-like rows, aligned XP column, filters above list, compact buttons | Immediate row selection. Best for comparing many rewards, but multiple conditions wrap awkwardly on phones; informed by Statlocker's grouping |
| City poster | Dark ink `#1e201c`, paper `#e8dcc3`, rust `#bf6949`; stronger Ruslan Display headings | Two spacious columns and broad section labels, existing navigation, large outlined action buttons | Short opacity response on selection. Distinctive display typography, but too much vertical space for a frequently used working screen |

DeadChaps is the primary reference for compact section hierarchy and bounded data panels in the recovered observations. Its purple effects, unique imagery and branding are not adopted. The chosen palette comes from this application's existing themes, keeping the rest of the product coherent.

## Independent review

Fresh read-only review found no critical or important issues and independently ran the 10 focused board tests successfully. One minor follow-up remains: after an initial request failure, a slow retry disables the retry button but keeps the error wording until the response, without a separate loading announcement. Initial loading is announced correctly.

Review deliberately excluded existing shared navigation/toast styling, generic API timeout/companion-polling behavior, broader global CSS cleanup, live service integration and additional page redesigns. These are unchanged by this first-screen PR.
