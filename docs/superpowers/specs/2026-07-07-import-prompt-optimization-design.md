# Import Prompt Optimization — Design Spec

**Date:** 2026-07-07
**Author:** Brian (with Claude)
**Status:** Approved for planning
**Source input:** `import_engine_critique.md` (§3 Gemini Prompt Optimization)

## Summary

Improve the fidelity of the SpiceHub recipe extraction engine by restructuring
the Gemini system instruction and few-shot exemplars. This is a **prompt-text-only**
change confined to `src/recipeSchema.js`. No change to `RECIPE_SCHEMA` shape,
`thinFromStructured`, CookMode, or the Dexie DB. The existing 295-test regression
corpus remains the authoritative safety net.

## Problem

The `import_engine_critique.md` audit identifies three weaknesses in the current
extraction prompt:

1. **Instruction bloat / attention degradation.** `SYSTEM_INSTRUCTION` is ~30
   flat prose blocks asking Gemini to perform ~12 distinct jobs (classify, clean,
   split ingredients vs directions, section-map, split quantities, categorize,
   ref-tag, extract nutrition, description, yield, times, notes, confidence) in a
   single structured generation. The model reads these as equally-weighted text,
   and minor fields degrade in quality as it prioritizes the main arrays.
2. **Fragile string-based referential tagging.** `directions[].ingredientRefs`
   are strings that must exactly match an item's `name`. Synonyms in step text
   ("scallion" vs "green onion") break the link.
3. **Few-shot exemplar imbalance.** The current exemplars are clean and short.
   Real IG/TikTok captions carry creator promos, music credits, inline
   timestamps, and multi-part formatting the model is never shown how to filter.

## Decisions (from brainstorming)

- **Scope: prompt-text only.** The critique's proposal to switch `ingredientRefs`
  (string) → integer `ingredientIds` is deferred to its own spec. That migration
  touches the schema, `thinFromStructured`, CookMode's name-based highlighting,
  the DB, and all 295 corpus expectations — too much blast radius to bundle with
  a prompt tune, and a silent schema bug could corrupt the string refs that still
  ship today. Logged as a fast-follow.
- **Approach: single restructured Gemini call.** No two-call split-cognition
  pipeline (doubles cost/latency, risks the 60s budget and offline queue timing)
  and no hidden reasoning block (adds tokens + parser changes). One call, with
  the instruction reshaped into an explicit ordered sequence. This preserves the
  zero-cost, offline-first constraints in the project constitution.

## Design

### Component: `src/recipeSchema.js` (only file touched)

Three edits plus a version bump.

#### 1. Restructure `SYSTEM_INSTRUCTION` into an ordered sequence

Reshape the current prose wall into three clearly headed sections. This is a
**reordering for attention, not a semantic rewrite** — every existing rule, enum
name, canonical unit, category instruction, and trash rule is preserved verbatim.

```
# Role
(one paragraph: what the engine is, input types, "output JSON only")

# Operational Sequence
1. Clean       — strip hashtags, @handles, emojis, CTAs, sponsor text,
                 view/like counts, blog boilerplate, music credits, inline
                 video timestamps ("at 0:45 add garlic").
2. Classify    — kind = "drink" | "meal" (existing rule, verbatim).
3. Split       — INGREDIENTS vs DIRECTIONS (the most-important rule; existing
                 verb list + re-scan rule preserved verbatim).
4. Sections    — map "For the sauce:" headers to ingredientGroups[].section.
5. Quantities  — split quantity/unit/name/prep; fraction + spoken-amount
                 normalization; canonical units.
6. Categorize  — grocery department per item (meal + bar department rules,
                 verbatim).
7. Directions  — {text, ingredientRefs}; numeric-prefix stripping rule; PLUS
                 the new verbatim-ref rule (see edit 2).
8. Metadata    — description, recipeYield, prep/cook/total time, nutrition
                 (extract-only, never fabricate), notes[].
9. Confidence  — confidence 0–1 + needsReview; not-a-recipe escape object.

# Constraints
- NEVER invent values (servings/time/nutrition left empty if absent).
- NEVER truncate or summarize steps; capture every step in order.
- NEVER emit trash as ingredients (scaling strings, bare labels, header
  remnants, colon-only lines).
- If the source is not a recipe, return the empty escape object and stop.
```

Acceptance: the reshaped instruction must carry the same rule set as the current
one — no enum, unit, or category rule dropped or reworded in a way that changes
meaning. Validated by the regression corpus staying green.

#### 2. Harden `ingredientRefs` (no schema change)

Add one explicit rule under step 7: `ingredientRefs` entries **must copy the
item's `name` field verbatim** (same wording and casing as it appears in
`ingredientGroups`). When a step mentions a synonym or shortened form
("scallion" for an item named "green onion", "chicken" for "chicken breast"),
the ref must use the canonical `name` from `ingredientGroups`, not the word used
in the step. Directly mitigates the string-fragility the critique flags and
de-risks the eventual numeric-ID migration.

#### 3. Add a messy real-world exemplar

Add a second `meal` entry to `EXEMPLARS.meal` whose `raw` mimics a noisy IG/TikTok
caption: creator promo ("Follow @chef_jake for more"), a music credit
("Music: Lo-Fi Chill"), an inline video timestamp ("at 0:45 add the garlic"),
engagement bait, and two ingredient sections. Its `output` shows the clean
structured result — noise stripped, sections labeled, `ingredientRefs` matching
`name` verbatim. `buildFewShotContents()` already slices to 2 shots, so the new
exemplar ships automatically without a code change to the builder.

The exemplar doubles as a parser unit-test fixture (per the existing comment on
the `EXEMPLARS` block).

#### 4. Bump `ENGINE_PROMPT_VERSION`

`2026.07.1` → `2026.07.2`. This is a results-improving change, so bumping the
version makes the I-5 self-healing "Improve" ledger offer re-runs on recipes
extracted with the older prompt (re-sends the cached caption; no re-scrape, no
Apify cost).

## Data flow

Unchanged. `SYSTEM_INSTRUCTION` + `buildFewShotContents(kind)` feed the Gemini
request exactly as today; `RECIPE_SCHEMA` (responseSchema) is untouched; output
flows through `thinFromStructured` unchanged. The only observable differences are
(a) higher extraction fidelity and (b) a new `engineVersion` stamp on saves.

## Error handling

No new failure modes. The not-a-recipe escape object is preserved. Because the
response schema is unchanged, any malformed model output is caught by the same
existing schema gate and post-processing (`enforceDeterministicRules`,
`reconcileStructuredWithFlat`) as today.

## Testing plan

1. `npm run build` — must complete with no errors (constitution requirement).
2. Full regression corpus (`recipeParser.regressionCorpus.test.js`) — must stay
   **295 green**. This is the primary guard that the instruction reshape did not
   drop or alter a rule.
3. Add corpus fixtures covering the new messy-caption patterns: inline timestamp,
   music credit, creator promo, dual-section ingredients. Assert noise is
   stripped and sections/refs are correct.
4. Add/confirm a fixture asserting `ingredientRefs` match `name` verbatim on a
   synonym case (e.g. step says "scallion", item name is "green onion").
5. Manual spot-check: run 2–3 live Instagram recipe URLs through import and
   verify clean titles, complete steps, and correct ref highlighting in CookMode.

## Out of scope (fast-follow specs)

- Numeric `ingredientIds` schema migration (critique §3 Pathway Step 1).
- Image proxy 3MB→5MB + Edge base64 chunking (critique §2 A/B).
- Mobile ergonomics: drag drop-zone hit area, haptics (critique §1, §4 Component 3).

## Conventional Commit (suggestion — user commits manually)

```
feat(import): restructure Gemini system instruction into ordered sequence

Reshape SYSTEM_INSTRUCTION from a flat prose wall into Role /
Operational Sequence / Constraints sections to reduce attention
degradation across the ~12 extraction subtasks. Add verbatim-name rule
for ingredientRefs and a messy real-world IG caption exemplar (promo,
music credit, inline timestamp, dual sections). Bump
ENGINE_PROMPT_VERSION 2026.07.1 -> 2026.07.2 to offer self-healing
re-runs. No schema shape change; 295-test corpus stays green.
```
