# Resources used by the contract board refresh

Audit date: 2026-10-29. No assets were downloaded or generated for this PR; no new dependency is added.

| Resource | Existing files used | Source and terms | Attribution |
| --- | --- | --- | --- |
| Jost, Latin and Cyrillic | `frontend/src/imports/city-fonts/jost-{latin,cyrillic}.woff2` | https://github.com/indestructible-type/Jost — SIL OFL 1.1; existing local copies | `licenses/OFL-Jost.txt`, adjacent font notice and `THIRD_PARTY_NOTICES.md` retained |
| Ruslan Display, Latin and Cyrillic | `frontend/src/imports/city-fonts/ruslan-{latin,cyrillic}.woff2` | https://github.com/google/fonts/tree/main/ofl/ruslandisplay — SIL OFL 1.1; existing local copies | `licenses/OFL-Ruslan-Display.txt` and adjacent notice retained |
| Lucide SVG geometry | `frontend/src/icons/Icon.tsx`, `nodes.ts`; existing swords, heart-handshake, coins, shield, layers, check, file-text, hourglass and triangle-alert icons | https://lucide.dev/license — ISC, including the vendored Feather MIT notice where applicable | Existing `frontend/public/licenses/lucide.txt` retained; no remote SVG or raw HTML inserted |
| Existing shared site branding/art | Unmodified navigation and application shell | Existing repository resources; this PR adds no game portraits, illustration or texture | Existing notices retained. The code/font licenses do **not** establish permission to redistribute Valve artwork; no new permission is claimed |

The board itself uses CSS and text backed by the existing API. It adds no image placeholders, hotlinks, downloaded illustrations, or generated imagery. The isolated test fixtures use deliberately labelled QA data and never enter the production bundle. Existing shell assets remain outside this PR's asset changes.

References are documented in `docs/design-direction.md`; no reference site's branding, source code, images or text were copied.
