# Per-Field Confidence (Spec B)

**Date:** 2026-06-22
**Status:** Approved — implementing
**Builds on:** Spec A (structured Item), Spec C (cross-check `_xcheck`)
**Sprint theme:** Import reliability — tell the user exactly what to check

## Problem

A single recipe-level `confidence` number can't point the user at the *specific*
token that's shaky. Mealie models this with `IngredientConfidence` (separate
scores for quantity, unit, food, name). Spec C now produces a per-item `_xcheck`
disagreement/fill signal that nothing yet consumes.

## Goal

Attach a per-field confidence to each structured `Item`, derived from C's
cross-check plus light presence heuristics, and surface it in ImportReview as
subtle per-row hint pills so the reviewer knows precisely which field to verify.

Non-goal (later): alias learning (D). Out of scope: field-split row editor (we
keep the flat-string row; chosen treatment is hint pills).

## Data model — recipeSchema.js (pure)

- `fieldConfidence(item)` → `{ quantity, unit, name, overall }`, each 0..1.
  - From `item._xcheck` (Spec C): a field in `disagree` → 0.4 (conflict); a field
    in `filled` → 0.7 (was empty, deterministic supplied it).
  - Presence heuristics (only when cross-check didn't already speak):
    - `quantity` → 0.5 when a unit is present but quantity is empty
      ("cup" with no number).
    - `name` → 0 when empty; 0.5 when > 40 chars or it leads with a cooking verb
      (a direction that leaked in).
  - `overall = min(quantity, unit, name)`.
- `annotateFieldConfidence(items)` → returns items with `confidenceFields`
  attached (additive; never mutates input, never throws).

## Wiring — recipeParser.js

- `finalizeAIRecipe`: after reconciliation, set
  `ingredientsStructured = annotateFieldConfidence(reconciled)` — covers every
  path (LLM + deterministic/offline), persisted on save.
- `captionToRecipe`: after the Spec C cross-check tags `_xcheck`, re-run
  `annotateFieldConfidence(xc.items)` so the cross-check signal is reflected in
  the persisted confidence.

## UI — ImportReview.jsx + ListItem + App.css

- Build a `line → confidenceFields` lookup from `recipe.ingredientsStructured`
  (keyed by the flat line, so it survives reorder/delete; an edited line simply
  stops matching, which is the desired "user fixed it" behavior).
- For each ingredient row, derive hint pills from the matched
  `confidenceFields`:
  - `quantity < 0.6` → "Add qty" (empty) or "Check qty" (present).
  - `unit < 0.6` → "Add unit" / "Check unit".
  - `name < 0.6` → "Check name".
- `ListItem` (ingredient rows) renders the pills inline after the input; tapping
  a pill focuses the row's input. Directions rows are unaffected.
- Recipe-level: when there are low-confidence fields and no misplaced-step flags,
  append a subtle "· N to check" to the confidence chip.
- Styling: premium, restrained — soft amber pill, rounded-full, small, gentle
  hover/active, with a dark-theme variant. Never alarming red.

## Error handling

All pure helpers defensive. UI lookups guard missing `ingredientsStructured`
(older recipes simply show no pills). Hint pills are purely additive and never
block editing or saving.

## Testing

- `fieldConfidence`: `disagree` lowers the right field to 0.4; `filled` → 0.7;
  unit-present-but-no-quantity → 0.5; verb-leading name → 0.5; clean item → all
  1.0; `overall` is the min.
- `annotateFieldConfidence`: attaches `confidenceFields`, leaves input untouched,
  tolerates nulls/empties.
- Pure model validated via standalone Node harness in-session.
- `npm run test` + `npm run build` green on Windows before commit.

## Rollout

Single change package. Conventional commit provided; user commits manually.
