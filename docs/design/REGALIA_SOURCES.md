# Regalia source record

Artwork supplied by the project owner for PR36 on 2026-09-08. No web-sourced artwork or new licence claims.

| Uploaded source | Project asset | Original dimensions |
| --- | --- | --- |
| `1000042957.png` | `frontend/src/imports/regalia/medals-signal.webp` | 1536 × 1024 |
| `1000042958.png` | `frontend/src/imports/regalia/medals-bureau.webp` | 1448 × 1086 |
| `1000042961.png` | `frontend/src/imports/regalia/seals-latin.webp` | 1536 × 1024 |
| `1000042960.png` | `frontend/src/imports/regalia/seals-ornate.webp` | 1448 × 1086 |
| `1000042959.png` | `frontend/src/imports/regalia/seals-classic.webp` | 1448 × 1086 |

Sheets: WebP encoding, quality 84, unchanged dimensions and composition. The component uses rectangular SVG viewports and a separate explicit clip path for every instance. Matte backgrounds remain. No synthetic transparency is claimed for the sheets or their fragment exports.

Two accepted cutouts were made with the built-in imagegen tool (background extraction), then downscaled and encoded to WebP, quality 86. Both final files are 384 × 384, RGBA, alpha range 0–255. Other generated attempts with painted checkerboards were excluded from the repository.

## Accepted prompt: `medal-first.webp`

Input: `1000042957.png`.

> Extract the top-left FIRST CASE compass medal from this image into a transparent PNG cutout for a web interface. Output RGBA with true zero-alpha pixels outside the object. Preserve the existing medal exactly, including its FIRST CASE label and metalwork; retain complete edges. Only that one medal, centered on a square canvas with generous transparent padding. No scene, no backdrop, no background pattern.

## Accepted prompt: `seal-team.webp`

Input: `1000042959.png`.

> Use case: background-extraction. Edit target: supplied sheet of six wax seals. Extract ONLY the BOTTOM MIDDLE purple ring of clasped hands wax seal as ONE separate website asset. Genuinely transparent alpha background, not a checkerboard drawing. Preserve this seal's original silhouette, engraving, colours, textures, composition and lighting. Remove sheet background, exterior shadows and all other objects. Do not redesign, add text or change the emblem. Center the complete seal with 4% transparent margin on a square canvas. Clean antialiased edges.

These are prepared derivative versions, not pixel-identical hand-masked originals. Original layer exports from the owner would improve fidelity. The user-facing notes and PR explicitly request these for the next art pass.

## Reuse and export

The runtime registry contains 12 medal and 18 seal IDs, including 13 reserved designs. `tests/build-bureau-layout.mjs` exports every entry as a self-contained SVG and a manifest. The production UI uses shared bitmaps; the bigger independent exports live only in the QA artifact. No preview of a locked award counts as an award, publication or role grant.
