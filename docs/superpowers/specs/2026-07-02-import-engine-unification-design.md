# Import Engine Unification — Design Spec

**Date:** 2026-07-02
**Status:** Approved pending user review
**Goal:** One unified, modular import pipeline — seamless, fast, accurate — for Instagram/social URLs and any recipe website. Zero cost. No regressions (golden corpus enforced). Offline-first behavior preserved.

---

## 1. Problem

`src/recipeParser.js` is a 5,368-line monolith holding ~100 functions: URL routing, Instagram phase orchestration, website extraction tiers, two separate Gemini prompt systems (modern RECIPE_SCHEMA structured-output path and a legacy prose prompt), a disabled Grok engine, and a deterministic parser. Symptoms:

- Multiple overlapping "engines" with divergent output shapes and rules.
- Input truncation at 7–8K chars silently drops content on long blog pages (Gemini Flash has a 1M-token context; the cap is self-inflicted).
- Junk text (hashtags, "link in bio", sponsor codes, nav/comment noise) reaches the model because cleaning happens inconsistently per path.
- Instagram photo capture is single-image and fragile (CDN 403s).
- File contains mojibake (double-encoded UTF-8 in comments/strings; greps as binary).

## 2. Architecture Decision

**Approach: "Funnel + Context Pack."** One entry, per-source acquisition modules, one normalized intermediate payload, one Gemini structuring path. Fallback tiers survive but become internal implementation details.

Decided via brainstorm 2026-07-02:
- Modular pipeline, fallbacks kept (not aggressive prune).
- New consolidated serverless endpoint(s) on Vercel free tier.
- Golden corpus built FIRST.
- UI (ImportSheet/ImportReview) in scope.
- Photos: full carousel + vision-validated video frames.

## 3. Module Layout

```
src/import/
  index.js           — importItemFromUrl entry; PUBLIC SIGNATURE UNCHANGED
  classify.js        — URL/type detection (isInstagramUrl, detectImportType, …)
  acquire/
    instagram.js     — IG phases: Apify ∥ embed ∥ ig-json ∥ oEmbed race; yt-dlp; ASR
    website.js       — JSON-LD → microdata → plugin CSS (WPRM/Tasty/EasyRecipe)
                       → WP endpoint nudging → Readability+Turndown markdown
    reddit.js        — .json endpoint + external-link redirect handling
    video.js         — yt-dlp subtitles / Whisper hybrid glue (existing services)
  contextPack.js     — normalization: every acquirer emits one ContextPack
  structure/
    gemini.js        — THE single structuring path (responseSchema + few-shots
                       + reconciliation rules + confidence escalation)
    deterministic.js — offline / no-key fallback ONLY (demoted, not deleted)
  finalize.js        — enforceDeterministicRules, _enrichWithNormalizer,
                       finalizeAIRecipe, thinFromStructured
  images.js          — carousel capture, data-URL persistence, vision frame gate
```

**Compatibility shim:** `src/recipeParser.js` becomes a re-export barrel. All existing consumers (ImportSheet, BrowserAssist, ReExtractSheet, photoImportEngine, transcriptionService, batchImportEngine, server) keep their import paths unchanged. Mojibake is fixed as code moves (clean UTF-8 rewrite of comments/strings).

**Deletions (after corpus is green on the new path):**
- `_buildExtractionPrompt` legacy prose prompt + `_structureWithAIClientLegacy`
- `src/lib/grokSender.draft.js` and Grok client path in `structureWithAI`
- Duplicated tier logic left stranded by the split

## 4. Server Consolidation (Vercel free tier)

### `api/extract.js` — scoped narrowly:
- **Website fetching + basic parsing:** server-side fetch (no CORS proxy), then JSON-LD, microdata, and Readability-isolated main content → Turndown markdown. Returns a ContextPack-ready payload.
- **Instagram embed / `?__a=1`-style JSON calls** as a fallback to Apify (Apify orchestration stays where it is today).
- Rate-limited; no secrets in client bundle; graceful 4xx/5xx with reason strings.

### `api/structure.js` — Gemini passthrough:
- Accepts a ContextPack, calls Gemini with server-side `GOOGLE_AI_KEY` env var, returns RECIPE_SCHEMA JSON.
- Client-side `VITE_GOOGLE_AI_KEY` path remains as fallback when the endpoint is cold/unreachable (client-only deploys keep working).

### Render server (existing) — unchanged role:
- yt-dlp subtitles/thumbnails, headless extraction, Whisper ASR, image persistence. No new responsibilities.

Client keeps a thin CORS-proxy fallback for when serverless is unreachable. Offline behavior identical: import attempts while offline enter the existing pending-import queue.

## 5. ContextPack (the seam)

```js
{
  sourceUrl:  string,
  sourceType: 'instagram' | 'website' | 'reddit' | 'video' | 'text',
  title:      string,          // best-known hint
  caption:    string | null,   // social caption (cleaned)
  transcript: string | null,   // ASR / subtitles
  markdown:   string | null,   // Readability-isolated page content
  jsonLd:     object | null,   // partial Schema.org Recipe if found
  images:     [{ url, dataUrl?, kind: 'hero' | 'carousel' | 'frame' }],
  provenance: [{ field, via, confidence? }],  // per-field origin + optional 0–1 score
  acquiredVia: string,         // winning tier, e.g. 'apify', 'json-ld', 'embed'
  confidence:  number          // overall acquisition confidence 0–1
}
```

Rules:
- Acquisition modules fill this honestly and do nothing else. Structuring consumes it and does nothing else. The seam is independently testable.
- `provenance[].confidence` (optional per-entry) feeds ImportReview badges and future escalation logic.
- Junk stripping (hashtags, "link in bio", sponsor codes, nav, comment sections) happens at acquisition time, before anything reaches the model.

## 6. Gemini Templating (single prompt system)

Base: existing RECIPE_SCHEMA structured output (responseSchema JSON mode) + shared SYSTEM_INSTRUCTION + few-shot exemplars + flash-lite → flash confidence escalation + deterministic post-processor. Extended:

1. **Provenance-labeled context sections.** The user turn is assembled from the ContextPack with explicit labels:
   ```
   CAPTION:
   …
   TRANSCRIPT:
   …
   PAGE CONTENT (markdown):
   …
   STRUCTURED DATA FOUND (JSON-LD):
   …
   ```
   Only sections that exist are included.

2. **Explicit reconciliation rules** appended to SYSTEM_INSTRUCTION:
   > If JSON-LD is present and complete, prefer it for ingredients and directions. Only override with caption/transcript content when JSON-LD is missing a field or clearly contradicts it. Use caption/transcript to enrich notes, tips, and serving suggestions. Report which source each major field came from in the provenance output field.
   The response schema gains an optional `provenance` array mirroring the ContextPack shape so decisions are auditable and deterministic to post-process.

3. **Truncation raised:** 7–8K → ~50K chars, budgeted per section (JSON-LD never trimmed; markdown trimmed from the tail; comments/junk already removed at acquisition).

4. **Verifier mode:** when `jsonLd` is complete (title + ingredients + directions all present), the prompt instructs Gemini to verify/clean rather than extract — faster, cheaper, junk-proof. Incomplete JSON-LD = normal extraction with reconciliation.

5. **Zero-junk contract:** the ban list (hashtags, @mentions, "link in bio", "save this", promo codes, view counts, emoji-only lines) lives in ONE place, shared by acquisition-time cleaning, the system instruction, and the test assertions.

Free-tier budget: Gemini Flash/Flash-Lite free tier (≈10–15 RPM, 1,500 req/day as of mid-2026) comfortably covers personal import volume, including escalation calls.

## 7. Photos

- **Carousel:** capture all sidecar images from Apify `images[]` / embed nodes, persist up to 6 as compressed data URLs (existing imageCompressor) so nothing 403s later. ImportReview gets a cover picker.
- **Video-only reels:** poster/thumbnail first; if unusable, Render server pulls a frame via yt-dlp.
- **Vision quality gate:** before accepting any frame/thumbnail as the hero image, a lightweight Gemini vision check rejects frames that are mostly text, logos, watermarks, or profile pictures, and prefers frames showing food/plated dishes. Existing `isProfilePicUrl`/`isValidImageUrl` heuristics run first (free); vision runs only when heuristics are inconclusive.
- SafeMediaImage 3-tier fallback and `proxyImageUrl` unchanged.

## 8. Errors, Offline, Budgets

- Offline queue, Dexie storage, service worker, PWA manifest: **untouched.**
- Every tier failure appends to `provenance` with a reason; a fully failed import surfaces the actual cause chain ("embed blocked; Apify quota exhausted; page has no schema") plus one clear next action. BrowserAssist remains the last-resort handoff.
- 60s global import budget and AbortSignal threading preserved. Import cache (getCachedImport) preserved.

## 9. Golden Corpus (built first)

- `tests/import/fixtures/` — ~25 real-world cases:
  - IG captions: clean structured, messy prose, cocktail reel, transcript-style narration, weak/empty caption
  - Website HTML snapshots: JSON-LD site, WPRM, Tasty Recipes, microdata-only, schema-less blog, JS-rendered shell, long page (>8K chars — regression guard for the truncation fix)
  - Reddit post JSON; video transcript
- Each fixture: expected `{ title, ingredients, directions, notes }` with tolerant matchers (count + key content, not byte equality).
- **Zero-junk assertions on every fixture:** output must never contain hashtags, @mentions, "link in bio", "follow me", sponsor/promo codes.
- Gemini mocked in CI (recorded responses) for determinism. `npm run test:live` (opt-in) runs end-to-end against real Gemini with the local key.
- Gate: every implementation step keeps the corpus green AND `npm run build` clean before its conventional-commit cmd is issued.

## 10. Import Experience (UI)

- **ImportSheet:** replace phase spam with a single three-stage timeline — *Fetching → Understanding → Polishing* — plus a tier chip showing the winning method ("via Apify", "via JSON-LD"). Skeleton rows instead of spinner text; spring transitions; inline errors with provenance reason + next action. Touch targets ≥48px.
- **ImportReview:** per-field confidence badges driven by `provenance[].confidence` (extends existing I-5 work), carousel cover picker, large-handle drag to reclassify a line (ingredient ↔ direction), structured notes display.
- **Share-to-app auto-start:** verify/wire share-target → automatic import kickoff as part of this package.

## 11. Build Order

Each step ships independently; corpus green + build clean at every boundary.

1. Golden corpus + fixtures + CI harness (no product code changes)
2. `api/extract.js` + `acquire/website.js` (server-side website path)
3. ContextPack + `structure/gemini.js` templating upgrade (reconciliation, 50K budget, verifier mode)
4. `acquire/instagram.js` + `images.js` (carousel, vision gate) + `api/structure.js`
5. Cleanup: shim `recipeParser.js`, delete legacy prompt/Grok, mojibake fixes
6. UI: ImportSheet timeline, ImportReview upgrades, share-to-app verification

## 12. Cost

$0. Vercel Hobby (serverless), Gemini free tier, Apify free credits (~5–10K posts/mo), existing Render free tier, yt-dlp/Whisper (self-hosted/browser). Optional future tiers (Jina Reader free ~20 RPM) documented but not required.

## 13. Non-Goals

- No changes to Dexie schema, offline queue, sync, or non-import features.
- No new paid services; no Grok re-enable.
- No full rewrite of consumers — public API of `importItemFromUrl` / `importRecipeFromUrl` is stable.
