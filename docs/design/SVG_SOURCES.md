# SVG sources — stage 7

The interface uses **Lucide**, pinned to commit [`75955ec47b764f253ded2baea7a1c2b3ec64efec`](https://github.com/lucide-icons/lucide/tree/75955ec47b764f253ded2baea7a1c2b3ec64efec/icons).

- Original SVG files: `frontend/src/icons/lucide/` (60 icons).
- React geometry registry derived from those files: `frontend/src/icons/nodes.ts`.
- Renderer: `frontend/src/icons/Icon.tsx`; default 24 × 24 viewBox, currentColor, 1.8 px stroke. Original upstream stroke is 2 px. Only these local shapes are rendered; no user SVG or remote scripts.
- Full ISC and applicable Feather MIT notices: `frontend/public/licenses/lucide.txt`, included in the built website and the preview download.
- Official license: [lucide.dev/license](https://lucide.dev/license).

Every source URL is the pinned repository URL above followed by the filename, for example [compass.svg](https://github.com/lucide-icons/lucide/blob/75955ec47b764f253ded2baea7a1c2b3ec64efec/icons/compass.svg). The names in `ICON_NODES` correspond exactly to the filenames. To update an icon, update the original SVG and its geometry entry together, keeping the license and source revision documented.

The existing 30 cosmetic IDs in `regalia/catalog.ts` map to these SVG icons. These are native vectors with paths and shapes, without embedded bitmap sheets. Prior AI-derived cutouts and cropped bitmap regalia from stage 6 are no longer shipped. The stage 6 documents describe historical assets, not the current rendering method.

Interface reference: user-supplied screenshots `1000043151.jpg`, `1000043149.jpg`, `1000043147.jpg` of ReManga. Their composition informed the guild cover, avatar placement, tabs, roster and settings navigation. ReManga artwork, its icons, user avatars, screenshots and source code are not bundled in this PR. Project branding and existing user card artwork are unaffected by this icon replacement.
