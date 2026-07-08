# SpiceHub — "My Bar" Pixel Build-Out (BarFridgeMode full redesign)

**Date:** 2026-07-08
**Status:** Approved (locked decisions) — Package A in implementation
**Depends on:** barMatch engine + granular inventory (2026-07-07 spec, Phase 1 complete)

## Goal

Transform `BarFridgeMode` ("What's on My Shelf?") from a utilitarian bottom sheet into a
full-screen, retro pixel-art **"My Bar"** — shelves of pixel bottle/ingredient sprites,
a "FRIDGE 2000" item counter, neon accents — that connects to the **Saloon** (`BarShelf`)
through a doorway behind the bar. Reference aesthetic: the "Mixel" pixel cocktail app.

## Non-negotiables

- **Offline-first, zero-cost, deterministic.** No network, no external assets, no LLM in
  the render path. Every sprite is generated procedurally from the ingredient name.
- **Incremental.** Extend the existing `PixelBottle` engine from `BarShelf.jsx`; do not
  rewrite `BarShelf`. Preserve the `barMatch` engine, Party/Kiosk mode, and the bottle
  edit sheet shipped in the 2026-07-07 packages.
- **Coverage.** A sprite for *most if not all* ingredients — spirits, liqueurs, wine, beer,
  mixers/soda, citrus, herbs, garnishes, glassware, ice — with a generic fallback so
  nothing renders blank.

## Locked decisions

- **Sprite strategy:** Procedural SVG, extending `PixelBottle`. (Chosen over a curated
  atlas or AI-generated sprites: infinite coverage, ~0 bundle weight, fully offline.)
- **Navigation:** Full-screen pixel My Bar; a doorway sprite behind the bar walks into the
  Saloon (`BarShelf`). Launched from the Bar tab as today — no IA rewrite.
- **Party Mode exit:** unchanged (simple confirm, no PIN).

## Architecture — three packages

### Package A — Shared sprite engine (`src/lib/barSprites.jsx`)

Pure, deterministic core plus a thin render component.

- `spriteSpec(name) -> { kind, shape?, palette:{ body, label, cap, accent }, glow? }`
  - Pure and total: any string returns a spec; unknown names fall back to a generic bottle.
  - `kind` ∈ `bottle | can | citrus | herb | garnish | glass | ice | egg | sugar`.
  - `bottle` carries a `shape` ∈ `tall | square | round | wine | beer | mini` (superset of
    the existing `PixelBottle` shapes).
  - Keyword table extends `BOTTLE_STYLES`; matching is whole-word / phrase-aware to avoid
    substring false hits (reuses the philosophy from `barMatch`).
- `IngredientSprite({ name, size, glow })` — React component rendering the right SVG for
  the spec's `kind`. Pixel styling via `image-rendering: pixelated`, no external assets.
- Determinism: identical input → identical output, so shelves are stable across renders.
- Unit-tested in `src/__tests__/barSprites.test.js` (category resolution, phrase matching,
  fallback totality). `IngredientSprite` returns a valid element for any name.

The Saloon (`BarShelf`) keeps its private `PixelBottle` for now; migrating it onto
`barSprites` is a noted, non-blocking follow-up (avoids touching a large working file).

### Package B — My Bar scene (rebuild `BarFridgeMode` render)

Presentation only; state/data logic (records, matching, party mode, edit sheet) is reused.

- **Scene:** brick-wall backdrop, 3–4 wooden shelves. Stocked ingredients (from
  `getBarInventoryRecords`) are laid out as `IngredientSprite`s across the shelves,
  packed left-to-right, wrapping to new shelves. A bar counter sits at the bottom with a
  **FRIDGE 2000** LED-style counter showing the item count, a neon cactus, and the doorway.
- **Interactions:** tap a bottle sprite → the existing bottle edit sheet; remove via the
  edit sheet (keeps touch targets clean vs. tiny ✕ on sprites). The "+"/search adds items
  (existing add flow). A **Drinks »** button slides up the makeable-drinks panel (the
  existing `barMatch` scored results, unchanged logic — ready/almost/derivable tiers,
  Surprise me, Quest-to-grocery).
- **Party/Kiosk mode:** retained — hides add/edit/doorway-in-edit, shows the makeable panel
  full-screen for guests.
- **Empty state:** empty shelves with a "stock your bar" prompt and quick-add chips.

### Package C — Doorway wiring (`App.jsx`)

- Pass a new `onOpenSaloon` prop to `BarFridgeMode`; the doorway calls it, which closes My
  Bar (`setShowBarFridge(false)`) and opens the Saloon (`setShowBarShelf(true)`).
- Optional reverse affordance (a "My Bar" exit inside the Saloon) is a follow-up, not in scope.

## Data flow

`getBarInventoryRecords()` → sprite list (via `spriteSpec`) → shelves.
`barMatch.matchDrink` over stocked names → Drinks panel tiers. All synchronous, offline.

## Error handling

- `spriteSpec` is total: unknown/empty names → generic bottle; never throws, never blank.
- Scene tolerates 0 items (empty state) and many items (wraps to more shelf rows / scrolls).
- Doorway is a no-op if `onOpenSaloon` is not provided (defensive optional-call).

## Testing plan

- `barSprites.test.js`: category mapping, phrase matching (e.g. "fresh lime juice" → citrus,
  not bottle), bottle-shape selection, fallback totality, `IngredientSprite` returns an element.
- Existing suites stay green (`npm test`).
- `npm run build` on Windows before commit (Linux sandbox can't reproduce vite build).
- Manual: stock varied ingredients → confirm sprites/shelves/counter; doorway → Saloon;
  Party Mode; Drinks panel tiers.

## Rollout

Conventional-commit suggestion + testing plan per package. Claude does not commit.
