# Alias Learning (Spec D)

**Date:** 2026-06-22 · **Status:** Approved — implementing
**Builds on:** A (structured Item), B (line→Item map in ImportReview)
**Model:** auto-learn on save + auto-apply (offline, additive)

## Goal
When the user edits an ingredient's food name in ImportReview, remember the
correction locally so future imports + grocery sorting resolve the raw name
correctly. Compounds over time; augments — never edits — the static
`INGREDIENT_ALIASES`.

## recipeSchema.js (pure, zero-import preserved)
- `LEARNED_ALIASES` in-memory map `raw → { canonical, aisle }`.
- `setLearnedAliases(map)`, `addLearnedAlias(raw, canonical, aisle)`,
  `getLearnedAliasMap()`.
- `resolveIngredientAlias` and `fuzzyResolveIngredient` consult LEARNED **before**
  the static dictionary (learned overrides on key collision).
- `learnableAliasFrom(importedName, editedLine)` → `{ raw, canonical, aisle,
  category }` or `null`. Returns null unless the normalized food name actually
  changed (≥2 chars, alphabetic) — so qty/unit-only edits never learn.
  `aisle` via `DEPARTMENT_TO_AISLE[categorizeIngredient(corrected)]`.

## db.js (v15)
- Table `ingredientAliases: 'raw, updatedAt'` with
  `{ raw, canonical, aisle, category, count, updatedAt }`.
- `getLearnedAliases()`, `saveLearnedAlias(entry)` (upsert + bump count),
  `saveLearnedAliases(list)`. All defensive.

## ImportReview.jsx (capture)
- Track each ingredient row's imported origin by stable `rowId`
  (`rowIdsRef.current.ingredients[i]` ↔ `recipe.ingredientsStructured[i]` at
  import) — reorder/delete-safe.
- On an ingredient edit, stage/unstage `learnableAliasFrom(origin.name, value)`
  in a ref keyed by `raw`.
- On save, persist staged learns via `saveLearnedAliases` and update the
  in-memory map via `addLearnedAlias`.

## App.jsx (bootstrap)
- On mount, `getLearnedAliases()` → `setLearnedAliases(map)` so learned aliases
  apply everywhere through the resolver (import categorization, grocery
  aggregation, Store Mode, ImportReview normalization-hints = transparency).

## Tests
- `learnableAliasFrom`: name change → entry; qty-only edit → null; revert → null.
- Resolver precedence: learned overrides static; fuzzy includes learned keys.
- Node harness in-session; `npm run test` + `npm run build` on Windows.
