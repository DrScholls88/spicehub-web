# Deterministic Parser + Cross-Check (Spec C)

**Date:** 2026-06-22
**Status:** Approved — implementing
**Builds on:** Spec A (structured ingredient as source of truth)
**Sprint theme:** Import reliability + offline sovereignty

## Problem

Two gaps remain after Spec A:

1. **Offline / no-key imports are second-class.** `captionToRecipe`'s heuristic
   fallback (`parseCaption`) emits flat strings through the weak
   `structureIngredient`, bypassing Spec A's structured `Item[]`, kind detection,
   sections, and category. When there is no API key or the device is offline,
   imports lose all the structure online imports get. This violates the
   Offline Sovereignty principle.
2. **Nothing validates the LLM's qty/unit split.** A single confidence number is
   the only signal. There is no cheap, model-independent check that the LLM
   didn't drop a unit or mis-split a quantity.

## Goal

A deterministic, local, pure-ish parser that (a) gives offline imports the same
structured quality, and (b) cross-checks every online LLM import for free.
Mealie models this with `RegisteredParser = nlp | brute | openai`; we add a
deterministic parser alongside the existing LLM path.

Non-goals (later specs): per-field confidence UI surfacing (B consumes the
cross-check signal this spec produces); alias learning (D).

## Constraints

- Build incrementally. Reuse existing primitives — do not write a new caption
  parser or a new ingredient NLP. `parse-ingredient` (already a dependency, used
  by `looksLikeIngredientLine`) is the qty/unit/name engine.
- `recipeSchema.js` stays import-free; the pure comparison logic lives there. The
  parser (which uses `parse-ingredient` + `parseCaption`) lives in
  `recipeParser.js`.
- Strictly additive. A cross-check miss must never degrade a good LLM import.

## Cross-check policy (decided)

**Flag + fill gaps only.** Always record qty/unit/name disagreements (audit +
per-item flags for Spec B). Auto-fill a field *only* when the LLM left it empty
and the deterministic parser produced a value. **Never override a non-empty LLM
value.**

## Components

### recipeSchema.js (pure, exported)

- `crossCheckStructured(aiItems, detItems, { fillGaps = true })`
  - Index `detItems` by `normalizeIngredientForMatching(name)`.
  - For each `aiItem` with a deterministic match: compare `quantity` and `unit`
    (case/space-insensitive). If the AI field is empty and the deterministic
    field is set and `fillGaps`, fill it and tag `_xcheck.filled`. If both are
    set and differ, record `_xcheck.disagree`. Never overwrite a populated AI
    field.
  - Returns `{ items, audit: { compared, matched, disagreements, filled } }`.
    `items` is `aiItems` with `_xcheck` tags on changed/conflicting rows.
- `reconcileStructuredWithFlat(structured, flatIngredients, meta)`
  - Aligns `ingredientsStructured` to the post-enforcement `ingredients[]`
    (which `enforceDeterministicRules` may reclassify/dedupe). Keeps existing
    Items for unchanged lines, `upgradeFlatIngredient`s any moved-in line, drops
    removed ones. Fixes a latent Spec A drift where enforcement could desync the
    structured array from the flat array.

### recipeParser.js

- `structureDeterministic(caption, { type, imageUrl, sourceUrl })`
  - `parseCaption(caption)` → `{ title, ingredients[], directions[] }`.
  - `kind` = explicit `type==='drink'` else `detectKindHeuristic(caption)`.
  - Build `ingredientGroups`: walk ingredient lines; `isSectionHeader` starts a
    new section (`sectionLabelFrom`); `isTrashIngredientLine` drops junk; each
    real line → `parse-ingredient` → `{ quantity, unit (canonicalized), name,
    prep, category (categorizeIngredient) }`.
  - Assemble a `RECIPE_SCHEMA`-shaped object (confidence 0.5, needsReview true,
    blank servings/times/cuisine — see guardrail), run it through the SAME
    `thinFromStructured` → `finalizeAIRecipe`, so the output is structurally
    identical to an LLM result with `_structuredVia: 'deterministic'`.
  - Returns `null` when no ingredients and no directions were found.
- `finalizeAIRecipe`: after `enforceDeterministicRules`, set
  `ingredientsStructured = reconcileStructuredWithFlat(...)` so every path keeps
  structure aligned with the enforced flat list.
- `captionToRecipe`:
  - *Online:* after a good `aiResult`, also run `structureDeterministic` on the
    same text; `crossCheckStructured(aiResult.ingredientsStructured,
    det.ingredientsStructured)`; attach `_crossCheckAudit`, replace
    `ingredientsStructured` with the cross-checked items, and on disagreements
    set `needsReview` + nudge confidence down slightly. Best-effort: wrapped in
    try/catch, never blocks the import.
  - *Offline:* replace the flat `parseCaption` fallback with
    `structureDeterministic` so offline imports return Spec-A-shaped structured
    ingredients.

## Guardrails (YAGNI)

- The deterministic parser infers only what existing heuristics support well:
  kind, sections, ingredient structure, category. It leaves servings, prep/cook
  time, and cuisine blank rather than guessing — those go to review.
- No formal parser registry until a third parser needs one.
- Gap-fills update only the structured `quantity`/`unit` (for aggregation); the
  displayed `original_text`/`ingredients[]` line is left as the LLM rendered it.

## Error handling

All pure helpers defensive. `structureDeterministic` returns `null` on empty
input. Cross-check and the deterministic run in `captionToRecipe` are wrapped so
any failure leaves the LLM result untouched.

## Testing

- `crossCheckStructured`: fills an empty AI unit from a confident deterministic
  parse; records (does not fix) a real qty disagreement; never overrides a
  populated AI field; audit counts correct.
- `reconcileStructuredWithFlat`: unchanged lines keep their original Item;
  a moved-in line is upgraded; a removed line is dropped.
- `structureDeterministic` (Windows/vitest, needs `parse-ingredient`): meal +
  drink exemplar captions yield correct kind and Spec-A-shaped
  `ingredientsStructured`.
- Pure helpers also validated via a standalone Node harness in-session.
- `npm run test` + `npm run build` green on Windows before commit.

## Rollout

Single change package. Conventional commit provided; user commits manually.
