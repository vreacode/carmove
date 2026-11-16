# FlClash and prism_ui attribution

The following frontend files contain adaptations of FlClash and its pinned prism_ui UI library:

- `src/components/FlClashIcons.tsx`: SVG adapters for AppGlyphs and Glyphs; 24×24 source coordinates, rounded polyline construction and 1.8 stroke width. Flutter continuous rounded boxes are represented by SVG rounded rectangles; rasterization and filled-icon animation are not identical across the two platforms. Five vehicle-specific symbols remain from Heroicons (MIT).
- `src/components/ResourceTrends.tsx`: source line-chart smoothing and path construction, 2px strokes and 0.14 area opacity, adapted to percent telemetry with no fabricated history samples.
- `src/flclash-theme.css`, `src/flclash-surfaces.css`, and `scripts/generate-flclash-theme.mjs`: default vivid theme roles, surface mapping and dashboard style values.

Copyright: chen08209 and the FlClash / prism_ui contributors. Adaptations made for CarMove on 2026-11-16. These adaptations are provided under GPL-3.0; see `GPL-3.0.txt`. Retain this notice and the corresponding source when redistributing them.

Upstream sources:

- https://github.com/chen08209/FlClash/tree/be84736605527034689c95bf27828ff27d912c5e
- https://github.com/chen08209/prism_ui/tree/63450c0ac0e8e1b2c0f3ed4ad7926dc94e083185

Theme selection: the upstream default seed `#007AFF`, `ColorStyle.vivid`, light/dark, without operating-system accent extraction or pure-black modification. This is the default source palette; a particular FlClash installation may display a different palette when its owner selects another accent or dynamic color.

HCT calculations used to generate static CSS use Google's Material Color Utilities 0.4.0 (Apache-2.0; Copyright Google LLC). The generator is a development tool and is not included in the runtime bundle. See `Material-Color-Utilities-LICENSE.txt`.

Regeneration:

- `npm run generate:theme` regenerates the checked-in theme CSS and color-role inventory.
- `python scripts/import-flclash-icons.py --flclash-source PATH --prism-source PATH` regenerates the SVG adapters from the pinned source checkouts.
