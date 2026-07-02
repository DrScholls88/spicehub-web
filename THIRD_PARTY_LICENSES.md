# Third-Party Licenses

SpiceHub is built with the open-source packages listed below. This file is a
human-readable summary generated from `package.json` / `server/package.json`
and a manual audit of bundled/vendored assets. Full license texts for npm
packages ship inside `node_modules/<package>/LICENSE` and are not
reproduced here; consult each package's own repository for the canonical
text.

Generated / last reviewed: 2026-07-01.

## Frontend dependencies (package.json)

| Package | License | Notes |
|---|---|---|
| react, react-dom | MIT | Meta Platforms, Inc. |
| dexie | Apache-2.0 | IndexedDB wrapper |
| dexie-observable | Apache-2.0 | |
| framer-motion, motion | MIT | Framer |
| lucide-react | ISC | Icon set |
| clsx | MIT | |
| tailwind-merge | MIT | |
| jszip | MIT / GPLv3 (dual-licensed) | SpiceHub uses it under the MIT option |
| parse-ingredient | MIT | |
| react-element-to-jsx-string | MIT | |
| tesseract.js | Apache-2.0 | OCR, used client-side |
| turndown | MIT | HTML→Markdown, used in export |
| @capacitor/core, @capgo/capacitor-share-target | MIT | Present in deps; confirm still in active use before next capacitor build |
| @google/generative-ai | Apache-2.0 | Gemini SDK |
| idb | ISC | |
| rimraf, cross-env | ISC / MIT | Build tooling only, not shipped to the browser |

## Backend dependencies (server/package.json)

| Package | License | Notes |
|---|---|---|
| express | MIT | |
| cors | MIT | |
| express-rate-limit | MIT | Added in the Phase 1/2 security hardening pass |
| @google/generative-ai | Apache-2.0 | Gemini SDK, server-side recipe structuring |

Server also shells out to **yt-dlp** (Unlicense) and **ffmpeg** (LGPL/GPL
depending on build configuration) as external system binaries — these are
not bundled into the repo or npm-installed; they must be present on the host
running `server/index.js`. If SpiceHub's backend is ever redistributed as a
container image or installer, ffmpeg's LGPL/GPL terms (dynamic linking vs.
static linking) need a second look before shipping a GPL-configured build.

## Vendored (bundled directly in source, not via npm)

| File(s) | Library | Version | License | Notes |
|---|---|---|---|---|
| `src/lib/photoswipe/photoswipe.min.js`, `photoswipe-ui-default.min.js`, `default-skin.css`, `photoswipe.css`, `default-skin.svg` | PhotoSwipe | 4.1.1 | MIT | © Dmitry Semenov. Vendored (not npm-installed) — kept as-is for the photo gallery lightbox. MIT license requires the copyright notice below be preserved wherever the code is redistributed: `Copyright (c) 2015 Dmitry Semenov`. |

## Assets needing attribution confirmation

| Asset | Status |
|---|---|
| `src/assets/bartender_sprites.png` | **Unconfirmed origin.** No license or provenance metadata found alongside this file, and no attribution is recorded anywhere in the repo. Before any wider/public release, confirm with the project owner (bjgoeke@gmail.com) whether this was AI-generated, licensed stock art, or custom commissioned art — and record the license/attribution here. If AI-generated, note which tool/service, since some image-gen providers restrict commercial redistribution. |
| `public/icon-192.svg`, `public/icon-512.svg`, `public/icon-maskable.svg`, `public/vite.svg` | App icons — `vite.svg` is the stock Vite logo (MIT-adjacent, Vite project trademark guidelines apply if kept in production builds; consider replacing with a SpiceHub-only icon set before public release). The `icon-*.svg` files appear to be custom SpiceHub icons; no action needed unless origin is uncertain. |

## Fonts

| Font | Source | License |
|---|---|---|
| Press Start 2P | Google Fonts (`fonts.googleapis.com`) | SIL Open Font License 1.1 |

## How to keep this current

Re-run a dependency license check after adding any new npm package:

```
npx license-checker --summary
```

and update the tables above if a new package with a non-MIT/Apache/ISC/BSD
license is introduced (e.g. GPL/AGPL, which would need separate review
before shipping).
