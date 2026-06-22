# Structured Ingredient as Source of Truth (Spec A)

**Date:** 2026-06-22
**Status:** Approved — implementing
**Sprint theme:** Import reliability + auto-sorting the right information

## Problem

SpiceHub's LLM extraction already emits Mealie-grade structure. `RECIPE_SCHEMA`
makes Gemini/Grok return, per ingredient, `{ quantity, unit, name, prep,
category }` grouped by `section`. That is the right shape.

But `thinFromStructured` immediately throws it away. `flattenIngredientGroups`
collapses each item to a single string (`"2 cups flour (sauce)"`) and only
`category` survives — in a *parallel* `_ingredientMeta` array indexed
positionally. Consequences:

- Every downstream consumer (grocery aggregation, Store Mode, scaling, dedup)
  re-parses that string back into qty/unit/food. `GroceryList.jsx` carries its
  own third copy of a quantity parser (`parseIngredient` / `parseAmount`).
- The `_ingredientMeta` sidecar can drift out of sync with the flat list if
  either is filtered independently.
- Section grouping degrades to a `(sauce)` text suffix.

The reliability gap is **not** extraction quality — it is that we discard the
structure before persisting it, then reconstruct it lossily on every read.

## Goal

Persist the structured ingredient as the source of truth, derive the existing
string views from it, and prove the win by rewiring the most reparse-heavy path
(grocery aggregation + Store Mode) to read structure directly.

Non-goals (later specs): per-field confidence (B), deterministic parser /
cross-check (C), alias learning from edits (D), scaling/MealDetail/export
rewire, step↔ingredient references.

## Core constraints (from the constitution)

- Build incrementally, never rewrite. Preserve Dexie, the offline queue, and the
  service worker.
- Strictly additive: nothing already on disk may break.
- `recipeSchema.js` keeps its ZERO-imports rule (safe in browser, worker,
  server). All new helpers are pure.

## Data shape

New per-recipe field, additive:

```
ingredientsStructured: Item[]

Item = {
  ref:           string,  // stable id for reorder + future step-links (B/C/D)
  quantity:      string,  // "2", "1/2", "2-3", ""  (string — matches RECIPE_SCHEMA)
  unit:          string,  // canonical unit ("cup") or "" or original if unknown
  name:          string,  // "all-purpose flour"
  prep:          string,  // "minced", "to taste", ""
  category:      string,  // one of GROCERY_CATEGORIES
  section:       string,  // "" when ungrouped, else "sauce"
  original_text: string,  // the joined display line WITHOUT section suffix
  display:       string,  // cached render string, == original_text
}
```

The existing `ingredients: string[]` and `_ingredientMeta: [{text,category}]`
fields remain and are **derived** from `ingredientsStructured`. Downstream code
that reads them is untouched.

## Where the logic lives

All pure, in `src/recipeSchema.js`:

- `makeIngredientRef()` — short random id, no deps.
- `parseIngredientLine(line)` — pure qty/unit/name/prep splitter built from the
  module's own primitives (`UNIT_ALIASES_ALL`, `canonicalizeUnit`,
  `normalizeFraction`). Used only to upgrade legacy strings; the LLM path already
  has the fields.
- `deriveDisplay(item)` — clean line from `{quantity,unit,name,prep}`
  (no section). Equivalent to `ingredientItemToString`.
- `structuredItemFromRaw(rawItem, section)` — build an `Item` from a
  RECIPE_SCHEMA item object: canonicalize unit (keep original if unknown),
  resolve `category` (LLM value if in `GROCERY_CATEGORIES` else
  `categorizeIngredient`), compute `original_text`/`display`, assign `ref`.
- `structuredFromGroups(groups)` — `Item[]` preserving every field. Applies the
  SAME `isTrashIngredientLine` filter as `flattenIngredientGroups`, on the same
  derived line, so structured and flat stay 1:1.
- `flatIngredientsFromStructured(items)` — `string[]`, appending `(section)`
  when present. MUST equal `flattenIngredientGroups(groups)`.
- `metaFromStructured(items)` — `[{text,category}]`. MUST equal
  `ingredientMetaFromGroups(groups)`.
- `upgradeFlatIngredient(str, category)` — parse a legacy
  `"2 cups flour (sauce)"` string (+ optional category) into an `Item`: strip a
  trailing `(section)`, run `parseIngredientLine`, fill category (given →
  `categorizeIngredient`).
- `upgradeRecipeIngredients(recipe)` — idempotent. If
  `ingredientsStructured` already present & non-empty, return unchanged. Else
  build it from `ingredients[]` + `_ingredientMeta[]`. Never throws.

`thinFromStructured` is rewired: it builds `ingredientsStructured` from
`structuredFromGroups(...)` first, then derives `ingredients` and
`_ingredientMeta` from that single array. Output for the two legacy fields is
byte-identical to today (pinned by test).

## Persistence + lazy upgrade

`src/db.js` v14 (matching the v10 backfill pattern):

- Re-declare `meals` store identically (`ingredientsStructured` needs no index)
  and add `drinks` re-declare.
- `.upgrade()` walks `meals` and `drinks`; any record lacking
  `ingredientsStructured` gets `upgradeRecipeIngredients` applied. Idempotent,
  offline, no network.

New imports populate the field via `thinFromStructured`. Consumers additionally
fall back to on-the-fly upgrade when the field is absent (covers records synced
from another device or any path that bypassed `thinFromStructured`). Triple
coverage; never blocks a render or save.

## Consumer rewire (grocery + Store Mode)

`App.jsx buildGroceryList`:

- When a meal has `ingredientsStructured`, iterate it (else
  `upgradeRecipeIngredients(meal)` on the fly). Each grocery item keeps the same
  `name` (derived display-with-section, so nothing visual changes) and `category`
  (from `struct.category`), and additionally carries `_struct` (the `Item`).

`GroceryList.jsx consolidateItems`:

- When `item._struct` is present, aggregate off real `_struct.quantity` /
  `_struct.unit` / `_struct.name` instead of `parseIngredient(item.name)`.
  Fall back to the current string-parse path when absent.

`StoreMode.jsx`:

- Prefer `item._struct.category` for the department and `item._struct.name` for
  the dedup key; fall back to `item.category || categorizeIngredient(item.name)`.

## Error handling

Every helper is defensive and pure (no throws on bad input, matching the
existing `recipeSchema.js` conventions). Any upgrade/parse failure falls back to
the current string path. The grocery/Store rewire is gated on `_struct` presence,
so the legacy path is always intact.

## Testing

New `src/__tests__/recipeSchema.structured.test.js`:

1. `structuredFromGroups` preserves every field across both `EXEMPLARS`.
2. **Byte-identical proof:** `flatIngredientsFromStructured(structuredFromGroups(g))`
   deep-equals `flattenIngredientGroups(g)` for meal + drink exemplars.
3. `metaFromStructured(structuredFromGroups(g))` deep-equals
   `ingredientMetaFromGroups(g)`.
4. `upgradeFlatIngredient("2 cups flour (sauce)")` →
   `{ quantity:'2', unit:'cup', name:'flour', section:'sauce' }`.
5. `deriveDisplay` round-trips a known item.
6. `upgradeRecipeIngredients` is idempotent (second call === first).
7. Grocery aggregation: two meals contributing "1 cup flour" + "1 cup flour"
   sum to "2 cups flour" via the `_struct` path.

Verification: `npm run test` green, `npm run build` clean (no truncated files,
no build-breaking syntax — full-output enforcement).

## Rollout / commit

Single change package. Conventional commit provided at the end; the user commits
manually (per constitution, Claude does not run git).
