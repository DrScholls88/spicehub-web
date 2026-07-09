# Import Engine Unification — Implementation Design (triaged)

**Date:** 2026-07-08
**Status:** Approved (scope: Core + Phase 4) — pending spec review, then writing-plans
**Origin:** Triage of `2026-07-08-import-engine-enhancement.md` (Grok) against the current codebase.
**North star:** `docs/superpowers/specs/2026-07-02-import-engine-unification-design.md`

## Triage summary

The source plan is codebase-accurate. Claims verified against `src/recipeParser.js`:

- **Dual structuring brains — TRUE.** `captionToRecipe` routes through `structureWithAI` → `structureWithAIClient`, which truncates to **8k** (`rawText.slice(0, 8000)`, line ~1218). It does **not** use `structurePack` (50k budget, reconciliation, verifier).
- **IG transcript not merged — TRUE.** `importFromInstagram` builds `textForGemini` from caption-or-pagetext (line ~5248) and calls `captionToRecipe` on it; the transcript (`videoRecipe`) is only a gated fallback, never merged into one pack.
- **Dead legacy code — TRUE.** `_structureWithAIClientLegacy` + `_buildExtractionPrompt` have no call sites.
- **Server plugin extractors — TRUE.** `api/extract.js` has no WPRM/Tasty/EasyRecipe; they live client-only in `parseHtml`.

**Already shipped (excluded as redundant):** CDN-403 → data-URL-first/proxy fallback (`resolveDisplayableImage`); carousel + vision hero gate (`import/images.js`); base prompt (SYSTEM_INSTRUCTION `2026.07.2` + reconciliation + verifier). The Phase 2 "weak-caption policy" is not separate work — it falls out of the Phase 1 transcript merge.

**Excluded as over-scoped this pass:** race-quality scoring; `recipeParser` barrel re-export; all documented non-goals (monolith dismantle, CORS/parseHtml prune, Grok re-enable, numeric ingredientIds, ImportSheet redesign, new paid APIs).

## Goals

- One structuring brain: every path builds a `ContextPack` → `structurePack`.
- Instagram reels with weak captions but strong transcripts import successfully (caption + transcript merged before Gemini).
- Same quality whether the source is IG or a blog.
- Zero regressions: golden corpus is law; legacy stays as fallback.
- $0 / free tier; no new paid APIs; no public API signature changes.

## Non-goals

- Physically splitting `recipeParser.js`; `captionToRecipe` / `importFromInstagram` stay put and re-route internally.
- Deleting the client `parseHtml` / CORS cascade (fallback only).
- Any Phase 2 image work (already shipped) or ImportSheet UI redesign.

## Architecture

```
URL → classify (IG | website | reddit | social/video | text)
    → acquire/*  →  ContextPack (caption + transcript + markdown + jsonLd + images + provenance)
    → structurePack  (single Gemini brain: 50k, reconciliation, verify)
    → finalize (thinFromStructured → enforceDeterministicRules → cross-check → images)
    → ImportReview → Dexie

Legacy structureWithAIClient (8k) + client parseHtml cascade remain FALLBACKS only.
```

Public API unchanged: `importRecipeFromUrl`, `importFromInstagram`, `captionToRecipe`.

## Components

### C1 — `packFromCaption` adapter (`src/import/contextPack.js`)

New helper: `packFromCaption({ caption, title, sourceUrl, images, transcript, sourceType }) -> ContextPack`.
`captionToRecipe` becomes: build pack → `structurePack` (client key → `/api/structure` fallback) →
existing `finalizeAIRecipe` + deterministic cross-check. On empty/throw, fall through to today's
`structureWithAI` path. The 8k ceiling no longer applies on the pack path (50k lives in `contextPack.js`).

### C2 — IG caption + transcript merge (`importFromInstagram` in `src/recipeParser.js`)

After all acquire phases, build one pack:
`{ sourceType:'instagram', sourceUrl, title, caption:cleaned, transcript: ytdlpSubs||whisper,
   markdown: rawPageText only if caption+transcript both weak, images: carousel ≤6, acquiredVia, provenance, confidence }`
Then `structurePack(pack)` → finalize → existing image resolve (`selectHeroImage` /
`persistCarousel` / `resolveDisplayableImage`). Reconciliation policy: structured quantities/lists
prefer caption; narrative steps fill from transcript; never invent. The BrowserAssist early-exit
only fires when caption **and** transcript are both empty.

### C3 — IG reconciliation addendum (`src/import/structure/gemini.js`)

Append to the system instruction **only when** `sourceType === 'instagram'`: prefer numbered/ingredient
lists in the caption over spoken fluff in the transcript; transcript fills missing steps/amounts, never
invents; reinforce stripping music credits, timestamps, "link in bio". Bump `ENGINE_PROMPT_VERSION`
only if the instruction text changes meaningfully (so I-5 re-extract offers improve).

### C4 — delete verified-dead code (`src/recipeParser.js`)

Remove `_structureWithAIClientLegacy` + `_buildExtractionPrompt` once corpus is green. Do **not** touch
CORS / parseHtml / endpoint-nudge / Render helpers.

### C5 — Phase 4 server extractors (`api/extract.js`)

Port WPRM / Tasty / EasyRecipe CSS extractors server-side. When the candidate is incomplete but a plugin
card is complete, promote the candidate and prefer verifier mode. Client cascade stays as fallback.
Independent of C1–C4; sequenced after them.

## Data flow

`acquire/* → ContextPack → structurePack → finalizeAIRecipe → ImportReview → Dexie.`
Transcript enters the pack as a labeled `transcript` section, never as a second parallel engine.

## Error handling / rollout

- **Additive first:** pack path returns a real recipe → return; else fall through to existing behavior.
- **Flag:** `VITE_IMPORT_PACK_ONLY=1` forces pack-only in dev; default = pack-then-legacy.
- No signature changes to ImportSheet / BrowserAssist / batch / photo import.

## Testing plan (Phase 0 first, gates every step)

Lock fixtures **before** moving code:
- IG reel: weak caption + rich transcript → ingredients/directions from transcript, tips from caption.
- IG: caption + transcript both present → no double-counted steps, no junk in notes.
- IG: carousel images → hero + `_carouselImages` length ≥ 2.
- Paste text → still structures via pack (parity).
Recorded Gemini responses for CI; live checks opt-in (`npm run test:live`).
**Every step:** `npm run test:corpus` + `npm run build` green before commit. No step merges red.

Files: `tests/import/fixtures/**`, `tests/import/corpus.*.test.js`.

## Implementation order & gates

| Step | Work | Gate |
|------|------|------|
| 0 | Fixtures + corpus baseline | `test:corpus` green, no behavior change |
| 1 | `captionToRecipe` → `packFromCaption` + `structurePack` | all structure paths use labeled pack; corpus green |
| 2 | IG caption+transcript merge + BrowserAssist gate | weak-caption+transcript imports succeed; corpus green |
| 3 | IG reconciliation addendum (+ version bump if needed) | zero-junk asserts; corpus green |
| 4 | Delete `_structureWithAIClientLegacy` + `_buildExtractionPrompt` | corpus green after removal |
| 5 | Server WPRM/Tasty/EasyRecipe extractors | more blogs complete without Gemini; corpus green |

## Suggested commit sequence

1. `test(import): pack-path fixtures for IG caption+transcript merge`
2. `feat(import): route captionToRecipe through structurePack (packFromCaption)`
3. `feat(import): merge IG caption+transcript into ContextPack before Gemini`
4. `feat(import): IG-specific reconciliation addendum`
5. `chore(import): remove dead _structureWithAIClientLegacy path`
6. `feat(import): WPRM/Tasty/EasyRecipe extractors on /api/extract`

## Success criteria

- Paste an IG reel/post → title, ingredients, directions, notes, dish photo(s) in review without
  BrowserAssist in the common case, including weak-caption-but-strong-transcript reels.
- Same URL quality whether IG or blog (one brain).
- No junk hashtags/CTAs in fields.
- Offline library unaffected; only import needs network/Gemini.
- $0 at personal volume.

## Cost posture

Unchanged / free tier: Gemini flash-lite→flash, Vercel `/api/extract` + `/api/structure`, Apify free
credits, Render yt-dlp + Whisper, Tesseract offline. No new paid APIs this pass.
