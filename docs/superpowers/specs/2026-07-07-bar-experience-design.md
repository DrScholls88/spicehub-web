# SpiceHub — Bar Experience Upgrade (Phase 1) + Import Hardening (Phase 2)

**Date:** 2026-07-07
**Status:** Approved — Phase 1 in implementation
**Origin:** Triage of an external "LinkRundown" analysis (Grok) against the current codebase.

## Background & Triage

An external analysis recommended a set of import-engine and bar-experience upgrades.
Cross-referenced against the actual codebase, most import-engine items are **already
shipped** and are therefore out of scope:

- Whisper audio transcription — shipped (hybrid browser/server/cloud, `transcriptionService.js`, `whisperWorker.js`).
- Multi-modal vision / frame analysis — shipped (`import/acquire/instagram.js`, `import/images.js`).
- Structured outputs + confidence scoring — shipped (`geminiGenerateStructured`, `enforceDeterministicRules`, `scoreExtractionConfidence`, `ReExtractSheet`).
- Tiered OCR for screenshots — shipped (Gemini→Mistral→Tesseract photo engine).
- Hybrid blog-fast-path / social-heavy routing — shipped (`import/index.js`).
- Basic tiered bar matching (perfect / almost / ready) + Quest-to-grocery — shipped (`BarFridgeMode.jsx`).

**Genuinely useful residue** (this spec):

1. Granular bottle data (brand, subcategory, notes, qty) — inventory is currently flat strings.
2. Inferred / derived ingredients (e.g. simple syrup = sugar + water) — matching is naive `includes()`.
3. Smarter, alias-aware matching that reduces false positives (`ice`/`juice`).
4. "Surprise me" randomizer over makeable drinks.
5. Party / Kiosk read-only mode.
6. (Phase 2) Import: schema-gate validation retry loop + alias normalization of drink imports.

## Goals

- Make "what can I make right now?" accurate and inference-aware, fully offline and zero-cost.
- Preserve the existing Dexie store, offline queue, service worker, and PWA manifest.
- Keep all new matching logic deterministic and unit-tested.

## Non-Goals

- No LLM calls in the matching path (offline/zero-cost mandate).
- No rewrite of `BarFridgeMode` or `BarShelf`; incremental changes only.
- No change to import engine in Phase 1.

## Architecture — Phase 1

### Data model (Dexie v16 → v17)

`barInventory` primary key stays `ingredient` (canonical lowercase name). Records are
extended from `{ ingredient, addedAt }` to:

```
{ ingredient, displayName?, category?, subcategory?, brand?, qty?, notes?, addedAt }
```

Upgrade backfills existing rows: `category` inferred via `categorizeBottle(ingredient)`;
`displayName` defaults to `ingredient`; other new fields stay `undefined`/null. The PK
does not change, so the migration is additive and low-risk.

New/changed `db.js` helpers:

- `getBarInventory()` — unchanged signature, still returns `string[]` (canonical names) for legacy callers.
- `getBarInventoryRecords()` — returns the full record objects for the new UI.
- `addToBarInventory(ingredient, meta?)` — accepts optional `{ category, brand, subcategory, qty, notes }`; auto-categorizes when `category` omitted.
- `updateBarBottle(ingredient, patch)` — merges brand/subcategory/qty/notes onto an existing record.
- `removeFromBarInventory`, `clearBarInventory`, `isInBarInventory` — unchanged.

### Match engine — `src/lib/barMatch.js` + `src/data/bar/*.json`

Curated, local resources:

- `barCategories.json` — canonical categories and their members/rollups (bourbon, rye, scotch → whiskey), plus `categoryOf` keyword map used by `categorizeBottle()`.
- `barAliases.json` — synonym/equivalent groups with per-substitution acceptability (e.g. rye ↔ bourbon acceptable).
- `barDerived.json` — derived ingredients: `{ result, from: [components], allMissing }` (e.g. `simple syrup` from `sugar` + `water`).

Public API:

- `categorizeBottle(name) -> category|null`
- `canonicalizeIngredient(name) -> canonical token` (strips measures/adjectives via existing normalizer conventions; reused, not duplicated where possible).
- `matchDrink(drink, inventoryNames) -> { matched, missing, derivable, score, tier }`
  - An ingredient is satisfied by: direct match, alias match, or category-level match.
  - A still-missing ingredient is flagged **derivable** when all its `from` components are on the shelf.
  - `tier`: `ready` (0 hard-missing, derivables allowed) | `almost` (1 missing) | `reach` (2+).
  - `score` in [0,1]: matched / total, with derivables counted as partial credit.
- `pickSurprise(scored, { tiers }) -> drink` — random selection weighted to ready/almost.

Deterministic; covered by `src/__tests__/barMatch.test.js` with drink+shelf → expected-tier fixtures, following the existing regression-corpus test style.

### UI wiring (incremental)

**Package 1 (this change):** `BarFridgeMode.jsx` swaps its inline scoring for `matchDrink`;
renders derivable items distinctly ("you can make simple syrup"); adds a "Surprise me"
button using `pickSurprise`.

**Package 2 (follow-up):** shelf-chip edit sheet (brand / subcategory / qty / notes writing
through `updateBarBottle`); Party/Kiosk read-only mode (hides add/edit/delete, grocery-quest,
import; large-tile browse of ready drinks; exit via a **simple confirm dialog**, no PIN);
CSS polish.

## Error handling

- All new `db.js` helpers wrap IndexedDB access in try/catch and degrade to safe defaults, matching existing helpers.
- `matchDrink` tolerates malformed drinks (missing/empty `ingredients`) by returning a zero-score result rather than throwing.
- JSON resources are static imports; a missing/empty file degrades to direct-match-only behavior (no crash).

## Testing plan

- `barMatch.test.js`: categorization, alias match, category rollup, derivable detection, tier boundaries, malformed input.
- Existing suite must stay green (`npm test`).
- `npm run build` must pass with no errors before any commit.
- Manual: add shelf items in BarFridgeMode, confirm ready/almost/derivable tiers and "Surprise me".

## Rollout / commits

Conventional-commit suggestion provided per change package. Claude does not commit; the user commits.

## Open defaults (accepted)

- Party Mode exit: simple confirm dialog (no PIN).
- `qty` field carried on bottle records but optional; surfaced in Package 2 edit sheet.
