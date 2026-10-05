# City Never Sleeps — PR45 design specification

User direction: closely study the official update page, carry its visual language across the entire existing product, add the six new hero cards, and avoid mixing the old and new designs. This is an existing-product presentation update plus an additive catalogue release, not a replacement of its functional workflows.

## Reference findings

Source: https://www.playdeadlock.com/cityneversleeps (observed 2026-10-02). The rendered page is approximately 50,549 px tall at 1440 px. Inspected hero, district tour, haunt panels, Broker, six hero posters, HUD, shop, accessibility, settings, footer and narrow viewport. The visual vocabulary is printed visitor-guide / supernatural city poster: charcoal and warm cream, orange pasted labels, tinted deep-green paper, scratched surfaces, rotated photographic borders, dotted routes, oversized angular display lettering, varied portrait scale, and deliberate card lift/reveal motion. Official headings use Valve Oracle, labels use Pulp, text uses Jost. We use openly licensed Ruslan Display (large poster titles) and Jost (readable UI, bilingual) instead of redistributing Valve's custom fonts.

Official six posters: Nurse Harrow, Rat King, Solomon, Deadman Danny, Baba, Violet. This release is a catalogue series; do not fabricate abilities, numeric gameplay IDs or release-order assertions. Do not imply affiliation with Valve.

## Shared visual contract

Keep existing semantic `--ns-*` names to preserve component interfaces. Replace their values and the owning feature CSS directly; do not append a second full override theme. Preserve existing selectors used by handlers/tests. Large poster typography uses `--font-poster: 'Ruslan Display', Georgia, serif`; UI/display labels and dense headings use `--font-display` / `--font-body: Jost, sans-serif`. New fonts live in `frontend/src/imports/city-fonts/`, with copies in Companion/static document asset folders.

| Token | Dark | Light | Black | Custom |
|---|---|---|---|---|
| bg | #181715 | #eee6d5 | #000000 | #201921 |
| deep | #100f0e | #e2d6bf | #000000 | #140f18 |
| surface | #252a26 | #faf2e2 | #111210 | #2d2532 |
| elevated | #343b34 | #e5dbc7 | #20221e | #403347 |
| line | #596052 | #bdb097 | #45483e | #6b5874 |
| text | #f7e9d5 | #292b24 | #f7e9d5 | #f6e9ef |
| muted | #bdb9a8 | #625b4b | #c1bcab | #c9b7cd |
| accent | #f6a26d | #983b1c | #f6a26d | #e6b6e2 |
| fill | #ee7d45 | #ee7d45 | #ee7d45 | #d6a2d1 |
| on-accent | #21150e | #21150e | #21150e | #211622 |

Semantic success remains green, warning gold, danger coral/red, information blue, distinct from the orange action accent; never use accent as the only state signal. Tokens include `--ns-paper:#eddfc3`, `--ns-ink:#2e3329`, `--ns-paper-muted:#62604f`, `--ns-paper-line:#bcb292`, `--ns-poster:#f7e9d5`, `--ns-stamp:#ee7d45`. Paper is deliberately warm across modes; dark surfaces remain theme-aware. Theme IDs, storage keys, manual accent/radius/motion choices and system-following behavior remain compatible. Default radius stays 22 to respect existing preferences; decorative poster corners use `calc(var(--ns-radius) * .5)` and regular controls use `--ns-small`. No global clipping of interactive focus rings or tables. Custom contrast must test against #403347 and readable button text against actual fill.

## Composition and motion

Public cover: original Contracts identity; large editorial title, orange edition label, monochrome official city backdrop, preserved robot mascot in its three natural poses, tangible paper callout, six hero poster gallery. Authenticated home: same poster framing at compact scale, paper operative file, useful existing actions/data. Navigation: printed directory groups, ruled active ticket, same complete routes. Contracts: tactile dossier cards, category strip, clear objective/reward, perforated selection tray. Signing: warm official-looking fictional contract, numbered steps and stamp confirmation only after authoritative response. Other surfaces: consistent paper headers, rules, warm framing, sober forms/table rows; portrait artwork and user-custom designs remain intact. Static documents and Companion share typography, palette and control treatment.

Motion: brief card lift, masked content entrance, stamp impact only on confirmed receipt, slow mascot breath/pose crossfade. Respect both OS and in-app reduced motion, keyboard focus, mobile tap targets and scroll. Avoid continuous parallax or essential hover-only content.

## Functional coverage (required)

- Public RU/EN home, contracts, guide, cards, about, campaigns, leaderboard, preview; server SEO/no-JS and 404; language and appearance dialogs.
- All 15 account destinations when a poll campaign is active: home, quests, active, history, archive, collection, packs, studio, wallet, bureaus, achievements, leaderboard, profile, hero-votes, admin.
- All 17 staff tabs: overview, users, reviews, bureau_reports, cards, packs, announcements, matches, boards, companions, missions, generator, jobs, outbox, audit, system, hero_votes; TOTP, detail panes and editors.
- Signing review/pending/retry/conflict/success, server recovery, double-click protection and focus restoration.
- Catalogue, collection, favorites/showcase, cipher, envelope opening/recovery, studio art controls and receipts. Bureau/community/profile customization, moderation and roles.
- Account, notifications, guide, announcements, loading/error/empty/populated states.
- Companion seven views, settings/pairing, overlay, onboarding and evidence transport unchanged.
- Standalone privacy, terms, support, status, changelog, data-sources in both languages, reviewer gate without auth changes.

## Six-card release

Add static hero names/keys to meta and six deterministic system-authored catalogue records with official poster artwork and explicit provenance. All six same existing F rank (20 tokens) to avoid invented power/rarity claims and use existing cost rules. Insert-only deterministic IDs, safe concurrent startup, never overwrite or republish an administrator's edited/archived record. Keep pack versions, balances and inventory unchanged. New media bundled locally under app/data/archive/city-never-sleeps; no network needed at runtime. Expose only the six allowlisted release artworks for the public presentation gallery; user-uploaded/private images retain current authentication. Public image URL contract: `/api/archive/releases/city-never-sleeps/{hero_key}.webp` for the six exact hero keys.

## Acceptance

Functional frontend/backend/Companion suites, TS/format/build, Docker/CI and existing asset budgets. New tests pin deterministic insert-only release behavior, real acquisition/receipt and allowlisted public media. Visual browser coverage must include all routes and staff tabs, populated detail states, all five themes, RU/EN, 360/768/1440 widths, dialogs and standalone pages; inspect screenshots, console/network errors, clipping and missing images. Preserve the existing Windows Overwolf live-game limitation if that environment is unavailable. Publish the update named PR45 as a separate pull request (GitHub #45 is already the merged PR44.5) against real main 3f45f61494f072538530e262a2ba89c765a29559 (including merged PR44.5) after verification; do not merge/deploy.

Integration update (2026-10-04): preserve the incoming poll campaign workflow, cache, worker, migration 0020 and authorization. Only its owning presentation changes. Derive release-poster framing from the actual bundled artwork bytes, source and stable server identity; curator-replaced artwork and edited crops retain normal controls. Compare black/white button labels for arbitrary saved custom fills. Docker must ship all transitive standalone document fonts and images.
