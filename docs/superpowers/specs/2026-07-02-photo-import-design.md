# Photo & Document Recipe Import — Design Spec

**Date:** 2026-07-02
**Status:** Approved by Brian
**Goal:** Replace the single-shot, Gemini-or-nothing photo import with a multi-page, tiered, zero-cost visual importer that handles cookbook pages, menu boards, handwritten cards, website screenshots, and PDFs — and grabs the dish photo for the recipe card.

## Current State (what this replaces)

- `structureRecipeFromImage()` in `src/recipeParser.js` (~line 669): single image → Gemini 2.0-flash-lite vision transcribe → `captionToRecipe()`. Returns bare `null` on any failure. No compression, no multi-page, no dish-photo detection; the raw scan becomes `recipe.imageUrl`.
- `handleOcrImport()` in `src/components/AddEditMeal.jsx` (~line 93): legacy Tesseract.js path with heuristic classification. Bypasses the modern engine entirely.
- `ImportInput.jsx`: camera + gallery buttons, single file only, `readAsDataURL` → `executePhotoImport` in `ImportSheet.jsx`.

## Decisions (clarified with Brian)

1. **Input types:** images AND PDFs (pdf.js renders pages client-side).
2. **Offline:** Tesseract.js draft immediately + queue full vision re-extract for reconnect.
3. **Multi-page UX:** scanner-style session (capture → thumbnail strip → add page/done), plus gallery multi-select.
4. **Legacy path:** unified — AddEditMeal's scan launches the same pipeline.
5. **Architecture:** A — tiered vision-first.
6. **Tier 2 provider:** Mistral free tier (Pixtral / OCR model), optional key.

## 1. Pipeline — `src/lib/photoImportEngine.js` (new module)

Entry point:

```js
importRecipeFromPages(pages, { type, onProgress, signal })
// pages: [{ dataUrl, source: 'camera'|'gallery'|'pdf'|'share' }]
// returns structured recipe (same shape as captionToRecipe output) or throws typed error
```

`recipeParser.js` is 5,368 lines; this lives in its own module and calls into the existing engine. `structureRecipeFromImage` becomes a thin deprecated wrapper (single page → `importRecipeFromPages`) until call sites migrate.

### Stages

**Stage 1 — Preprocess.** Each page compressed via existing `imageCompressor.js` (`compressBlob`, ~1280px max edge, JPEG q0.8) before any upload. Originals retained in memory for dish-photo cropping.

**Stage 2 — Vision transcribe (tiered).**

- **Tier 1 — Gemini.** All pages in ONE `generateContent` call (multi-image input; preserves cross-page ordering, one request against the free-tier daily quota). Model from `VITE_GEMINI_VISION_MODEL` (default current flash-lite). JSON mode. 45s budget consistent with import engine. Contract:

```json
{
  "pages": [{ "transcript": "..." }],
  "dishPhoto": { "page": 1, "box": [ymin, xmin, ymax, xmax] } | null,
  "contentType": "recipe" | "menu" | "dish-photo" | "other"
}
```

  Box coords normalized 0–1000 (Gemini convention). Transcription prompt keeps the current faithful-transcript rules (preserve headers, bullets, quantities; describe plated dish if no text; best-effort handwriting).

- **Tier 2 — Mistral.** Fires on Gemini failure, 429, or missing key. `VITE_MISTRAL_API_KEY` (La Plateforme free "Experiment" tier), Pixtral vision model, same JSON contract. Graceful skip if key absent.

- **Tier 3 — Tesseract.js (on-device, always available).** Per-page `Tesseract.recognize` with the existing `preprocessImageForOCR`. Joined text becomes the transcript. Result flagged low-confidence (`_ocrDraft: true`) → existing "Improve" badge; no dish-photo detection (page 1 scan used).

**Stage 3 — Structure.** Joined transcript (pages separated by `\n\n---\n\n`) → `captionToRecipe()` → existing Gemini structuring (Grok stays dormant unless `VITE_AI_PROVIDER=grok`), deterministic post-processor (`enforceDeterministicRules`), normalizer enrichment (`_enrichWithNormalizer`). Untouched. `sourceCaption` = joined transcript (enables I-5 re-extract). Provenance split across `_visionEngine` (gemini/mistral/tesseract) and `_structuredVia` (set by the structuring engine).

**Stage 4 — Dish photo.** If `dishPhoto.box` present: canvas-crop that region from the ORIGINAL (uncompressed) page, sanity-check the crop (≥15% of page area, aspect 0.4–2.5), `compressBlob` → `recipe.imageUrl`. If `contentType === 'dish-photo'`: whole image is the photo. Else: compressed page-1 scan as fallback image.

**Confidence & provenance.** Existing `computeReviewConfidence`. Engine chip strings: `vision:gemini`, `vision:mistral`, `ocr:tesseract`.

### Error handling

- Typed per-tier failures surfaced through `onProgress` / `pipelineSteps` — no silent `null` returns.
- Partial page failure (some transcripts empty): proceed with successful pages + warning in review.
- All tiers produce nothing readable: friendly error with capture tips (lighting, fill frame, flatten page).
- JSON contract parser tolerates fenced/dirty JSON (reuse existing extraction-hardening helpers).

## 2. Scanner-Session UI

New `PhotoScanSession` component rendered inside `ImportSheet` (new phase `'scan'`):

- Thumbnail strip: Framer Motion `layoutId` springs, drag-to-reorder, tap-to-remove (48px targets), page-count badge.
- "Add page" → camera (`capture="environment"`) or gallery (`multiple` on the file input).
- Single primary CTA: "Extract recipe".
- PDF dropped/selected → pdf.js (lazy `import()`, only loads when a PDF appears) renders pages to canvas → thumbnails join the strip. Cap 10 pages, warn beyond.
- Progress reuses `pipelineSteps`: "Reading pages (n/N)" → "Organizing the recipe" → "Grabbing dish photo".
- Camera/gallery buttons in `ImportInput` route here; single-image drop/paste also lands in the session (pre-populated with one page) so "add another page" is always one tap away.

## 3. Unification & Entry Points

- `AddEditMeal.handleOcrImport` replaced: its scan button opens the unified pipeline; results populate the form fields via the structured recipe. `cleanOcrText`/`classifyOcrLines` heuristics move into the Tier-3 path if still needed, else retire.
- Share-target: images shared to the app auto-open the scan session and auto-start extraction after a beat (mirrors IG link auto-import), via the existing `@capgo/capacitor-share-target` wiring.

## 4. Offline & Queue

- `navigator.onLine === false` or all online tiers fail → Tier 3 draft immediately.
- Compressed page images + joined OCR text stored on the saved recipe (Dexie); re-extract job queued via existing `backgroundSync`.
- On reconnect: queued job re-runs Tiers 1–2 with stored pages; user sees accept/reject diff via existing `ReExtractSheet`; stored pages purged after successful re-extract (storage hygiene).
- Pending state visible via the existing offline pending-import banner.

## 5. Testing & Verification

- **Unit:** JSON-contract parser (valid, fenced, malformed), bbox crop math + sanity gates, multi-page transcript merge, tier-fallthrough order (Gemini fail → Mistral → Tesseract), Mistral skip when key absent.
- **Fixture:** canned transcripts (menu board, handwritten card, 2-page cookbook spread, website screenshot) through `captionToRecipe` snapshot checks.
- **Manual plan:** camera single + multi-page, gallery multi-select, PDF 1-page + 5-page, offline draft → reconnect re-extract, share-target image, AddEditMeal scan, drink-type photo import (respect `itemTypeUserOverride` seeding).
- `npm run build` clean before any commit cmds are provided.

## 6. Security & Cost

- No hardcoded secrets. New env vars: `VITE_MISTRAL_API_KEY` (optional), `VITE_GEMINI_VISION_MODEL` (optional override).
- Cost: $0. Gemini free tier (~1,000+ req/day on flash-lite class models; multi-page = 1 request), Mistral Experiment tier free, Tesseract/pdf.js on-device. No new paid services; if free tiers tighten, tiers degrade gracefully down to on-device OCR.

## Out of Scope

- Video frame extraction (Whisper path already covers video).
- Cloud OCR services requiring cards (Google Cloud Vision, AWS Textract).
- Editing/re-cropping the detected dish photo manually (future enhancement).
