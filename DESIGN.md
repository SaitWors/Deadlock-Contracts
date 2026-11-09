---
version: alpha
name: Deadlock Contracts
description: A digital contract workspace against Deadlock's occult city atmosphere
colors:
  background: "#0b0d0d"
  deep: "#090b0b"
  surface: "#13191c"
  elevated: "#1d2529"
  border: "#303b40"
  text: "#edf1ef"
  muted: "#a5b0b4"
  primary: "#aec69b"
  fill: "#aec69b"
  on-accent: "#172017"
  success: "#aec69b"
  warning: "#cfbc8e"
  danger: "#e6a8a0"
  info: "#9eb9bb"
typography:
  body:
    fontFamily: "Inter, system-ui, sans-serif"
  display:
    fontFamily: "Valve Oracle, Inter, system-ui, sans-serif"
  standalone:
    fontFamily: "Jost, system-ui, sans-serif"
rounded:
  DEFAULT: "4px"
  panel: "2px"
spacing:
  public-max: "79rem"
  public-inset: "3rem"
  public-mobile-inset: "1.25rem"
  board-gap: "1.125rem"
components:
  button:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.on-accent}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  navigation:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.text}"
  selected: { backgroundColor: "{colors.primary}" }
  elevated: { backgroundColor: "{colors.elevated}" }
  divider: { backgroundColor: "{colors.border}" }
  supporting-copy: { textColor: "{colors.muted}" }
  success: { textColor: "{colors.success}" }
  warning: { textColor: "{colors.warning}" }
  danger: { textColor: "{colors.danger}" }
  info: { textColor: "{colors.info}" }
---

# Deadlock Contracts design

## Overview

A digital bureau for Deadlock players choosing objectives before a match and checking their progress afterward. The public landing has room for expression; the authenticated workspace prioritizes readable conditions, factual status and predictable controls. RU and EN share the same hierarchy and script-capable fallbacks; locale support does not imply a particular market.

The signature is an occult city contract bureau: the preserved pentagram/animated backdrop in `frontend/src/BureauAtmosphere.tsx`, Valve Oracle typography and one city-backed objective on the first screen. The real map image is part of the functional contract preview, not a detached illustration. Graphite frames, short edge rails, framed category symbols and clearly separated XP give the working surfaces a game identity without competing with the conditions. The current evolution is recorded in `docs/design/2026-11-09-occult-bureau.md`; it retains the paper/scroll removal accepted in `docs/superpowers/specs/2026-11-04-digital-coherence-design.md`.

Runtime CSS remains canonical. `frontend/src/appearance.css` owns semantic tokens and legacy aliases; `appearance-state.ts` applies saved preferences. This file mirrors their accepted defaults and explains intent; it generates no runtime files. Update the owner and this document together, then verify the standalone mirror and appearance tests.

## Colors

The frontmatter records dark defaults; `primary` names the accent role. Values below map to `--ns-bg`, `--ns-deep`, `--ns-surface`, `--ns-elevated`, `--ns-line`, `--ns-text`, `--ns-muted`, `--ns-accent`, `--ns-fill` and `--ns-on-accent`, respectively.

| Mode | Background / deep | Surface / elevated | Border | Text / muted | Accent / fill / on-accent |
|---|---|---|---|---|---|
| Dark | `#0b0d0d` / `#090b0b` | `#13191c` / `#1d2529` | `#303b40` | `#edf1ef` / `#a5b0b4` | `#aec69b` / `#aec69b` / `#172017` |
| Light | `#edf1f2` / `#e1e7e9` | `#f9fbfc` / `#e2e9ec` | `#b9c5ca` | `#202b30` / `#53646c` | `#3f6037` / `#425f38` / `#f5f8f4` |
| Black | `#000000` / `#000000` | `#0d1215` / `#181f23` | `#2c383e` | `#edf1ef` / `#a5b0b4` | Dark roles |
| Custom | Dark roles | Dark roles | Dark role | Dark roles | Saved fill; contrast-adjusted accent; black or white label |
| System | Resolves to dark or light through `prefers-color-scheme` | Resolved theme | Resolved theme | Resolved theme | Resolved theme |

Custom links are adjusted against the elevated surface to at least 4.5:1; filled controls use `--ns-on-accent`. Status colors retain success, warning, danger and information meanings across themes. Legacy `--ns-paper`, `--ns-ink`, `--ns-paper-muted` and `--ns-paper-line` alias surface, text, muted and border; they do not introduce beige panels.

Native standalone legal/support/status pages and crawlable fallback documents mirror the palette in `app/static/nightshift-documents.css`; `app/static/document-appearance.js` shares the saved `dc.ui.appearance` contract and browser theme color. Keep these adapters aligned with the runtime owner.

## Typography

`--font-body` uses local Inter; `--font-display` and `--font-poster` use local Valve Oracle with Inter/system fallbacks. Standalone documents retain their local Jost stack. Display type expresses the game world; conditions, supporting copy and controls remain readable sans serif. Preserve comfortable prose line heights and RU/EN wrapping. Use sentence case, direct action verbs and headings without terminal full stops; prose keeps its punctuation.

## Layout

`frontend/src/ritual.css` owns the public layout: a 79rem maximum container, 3rem desktop side insets, 2rem below 1100px and 1.25rem below 800px. Contract cards use a 1.125rem gap and collapse for narrow screens. Preserve the document's natural height, reachable actions and reserved image geometry. `appearance.css` reserves a stable scrollbar gutter and supplies the global scrollbar baseline.

## Elevation & Depth

Use surface/elevated tones, one-pixel frames and short accent rails to distinguish regions; `--ns-shadow` is `none`. Only the first-screen objective has a restrained offset frame/depth shadow. Ordinary mission cards stay opaque and stable; on a fine pointer, the hovered card may rise 4px, with a small press response. These are interaction feedback, not permanent floating. Keep paper textures, folded corners, desk/scroll illustrations, rotated plaques and heavy offset shadows out of the foreground. The completion finale has its own floating plaques and attached light effects; ordinary surfaces retain this rule. Modal backdrops and the existing appearance drawer may separate overlays from content without changing ordinary panel depth.

## Shapes

The default `--ns-radius` is 4px; many panels use half that radius. Saved preferences may vary radius from 0–8px, with `--ns-small` derived by the appearance adapter. Use rectangular cards and controls; circular utility indicators remain purposeful exceptions.

## Components

`Landing.tsx` integrates the existing `imports/city/uptown_02.webp` map into a functional objective preview and `CollectionPreview.tsx` uses existing local Valve portraits (`hero-votes/portraits/84.webp`, `85.webp`, `86.webp`), never invented pack results. Preserve existing artwork notices; see `docs/assets-sources.md`. Existing UI and brand symbols use vendored Lucide geometry through `frontend/src/icons/Icon.tsx`. At the user’s request, public navigation uses five verified Hugeicons Free Stroke Rounded glyphs through `frontend/src/icons/NavigationIcon.tsx`: contracts, cards, ranking, game controller and information. Keep their 16px size, visible labels and consistent meaning across desktop and mobile menus. Do not add repeated book ornaments above page headings.

Primary actions consume fill/on-accent; secondary actions use surface/border/text. Selected contracts and navigation use the accent without replacing text labels. Keep distinct hover, visible focus, pressed, disabled and busy states; retain inline errors and the shared announcement surfaces. `UX-CONTRACT.md` records their behavioral owners.

`contract-board.css` owns the authenticated mission card recipe and actual status variants; `ritual-workspace.css` must not duplicate it. Public `.ritual-contract` uses the same framed category/XP/selected-rail vocabulary. `ritual-foundations.css` owns shared hover, focus, press and the brief selected-check response. Status text remains authoritative and visible; the data attribute only styles the existing verdict. Account/progress/active/history XP uses existing confirmed values, with no new metrics.

`motion.ts` owns `useSceneEntrance`: first-screen title, actions and objective enter over 520ms with at most 160ms stagger. Content is visible without WAAPI; no action waits for choreography. Appearance changes cancel entry immediately. Do not apply scroll reveals or continuous motion to ordinary mission grids. Both system and saved reduced motion keep all content and outcomes available.

Keep `BureauAtmosphere` mounted during enhanced public navigation. Its fallback image remains available; reduced motion and hidden documents pause ambient video. State transitions and signing confirmation remain understandable without animation.

### Contract completion

`frontend/src/case-completion/CaseCompletion.tsx` owns a fullscreen dark stage with only one profile plaque and the 1–3 selected task plaques. Its stage palette belongs to `appearance.css` (`--finale-*`); motion consumes `motion.ts` and reactive saved/system preferences. `finale-motion.ts` composes separate entrance, drift, flight, center and impact transforms. Await actual flight completion before synchronously changing XP text/bar. Failed plaques grey and split first, leaving the center free for the level accent; successful plaques fly in their saved order.

Fill each server-authored band to 100%, pause, center the same profile, change its level inside, pulse the contour and emit exactly two waves only for a real level-up. Then refill the next band with the remainder. Preserve final floating; on phones start with profile above tasks. Reduced motion uses a short fade to the saved final. No heading, recap footer, extra metrics or visible action bar. Escape and empty backdrop return directly to the cabinet; a focus-visible return control remains available. Scene playback never awards XP or projects a historical start from the current account balance.

## Do's and Don'ts

- Do reuse semantic tokens, shared navigation, signing and announcement components across public and private screens.
- Do keep explanations, real objective data, rewards and status readable in every theme.
- Don't reintroduce parchment, generated scroll/desk art, ornamental heading icons or unrelated mascots.
- Don't make animation, a decorative seal or a local preview imply a confirmed server result.
