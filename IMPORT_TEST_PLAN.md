# SpiceHub Unified Import Engine — Test Plan

This document describes manual test coverage for the unified import engine
(`importItemFromUrl`) following the April 2026 overhaul. Run through each
test case when regressions are suspected. All tests should be executed on
mobile (Android/iOS) and desktop to validate touch targets and slide-down
gestures alongside core extraction.

## Build verification

    cd spicehub-web
    npm run build
    # Expect: "✓ 503 modules transformed" and no Rollup / ESM errors.
    # Warnings about chunk size and dynamic imports are pre-existing.

## Test URLs

| # | Source              | URL pattern                                            | Expected type | Expected image | Expected content |
|---|---------------------|--------------------------------------------------------|---------------|----------------|------------------|
| 1 | Instagram Reel      | `instagram.com/reel/…`                                 | meal          | ✓ base64       | subtitle or caption → structured recipe |
| 2 | TikTok cocktail     | `tiktok.com/@user/video/…` (cocktail keyword)          | drink         | ✓ base64       | mixology units (oz/dash), glass+garnish |
| 3 | Liquor.com          | `liquor.com/recipes/…` or `/cocktail-recipes/…`        | drink         | ✓              | JSON-LD-backed drink with glass+garnish |
| 4 | AllRecipes          | `allrecipes.com/recipe/…`                              | meal          | ✓              | JSON-LD Recipe w/ ingredients+directions |
| 5 | YouTube Short       | `youtube.com/shorts/…`                                 | meal          | ✓ hunted       | yt-dlp subtitles → Gemini polish |
| 6 | Random blog         | any `smittenkitchen.com` / `foodwishes.com` blog post  | meal          | ✓              | Turndown+Gemini fallback succeeds |

## Per-URL success criteria

### 1. Instagram Reel
- Phase 0 (yt-dlp subtitles) OR Phase 1 (embed) OR Phase 2 (agent) succeeds.
- Final recipe has: `name` (non-default), ≥ 1 ingredient, ≥ 1 direction,
  `imageUrl` as a `data:image/...` (base64) — NEVER a live CDN URL.
- No `"See original post for ingredients"` placeholder leaks into the preview.
- `_type === 'meal'` unless explicitly toggled.
- If a cocktail reel — ensure ingredients contain mixology units and direction
  count is terse (2–4 steps).

### 2. TikTok cocktail (drink auto-detect)
- URL heuristic OR body keyword scan flips `type` → `drink` in the badge
  ("🍹 Drink") before user taps Import.
- Gemini receives the drink prompt (recognises `oz`, `ml`, `dash`, `splash`,
  `barspoon`, `float`).
- `glass` and `garnish` fields populated when present in caption.
- Image captured from TikTok CDN (`tiktokcdn`) → base64 persisted.
- Extraction does NOT crash or hang on Shorts/Reels (60s top-level timeout).

### 3. Liquor.com
- JSON-LD found → recipe extracted in Phase 1 (parseFromUrl).
- `type` auto-detected as `drink` from host pattern.
- Ingredients include oz/ml measurements exactly as written.
- Directions show cocktail actions: shake / stir / strain / build / top.
- og:image or JSON-LD image downloaded + persisted.

### 4. AllRecipes
- JSON-LD Recipe structured data consumed directly (no Gemini call needed).
- `_extractedVia` includes `'parse-url'` or `'json-ld'`.
- Ingredients and directions have realistic counts (8–20 ing, 4–12 dir).
- Image from hero photo downloaded + persisted via `_ensurePersistentImage`.
- No placeholder leaks.

### 5. YouTube Short
- Phase 0 yt-dlp runs with 45s timeout.
- Subtitles (if present) flow through Gemini polish → structured recipe.
- Image hunted via og:image/twitter:image fallback if yt-dlp thumbnail missing.
- `_extractedVia` includes `'yt-dlp+ai'` or `'yt-dlp'`.
- 60s global timeout prevents infinite spinner.

### 6. Random blog
- Phase 1 CORS proxy + JSON-LD extraction first, then Turndown → Gemini.
- Gemini receives type-appropriate prompt (meal by default).
- Image + title extracted even if ingredients/directions are partial
  (partial recipe still rendered in preview, not a dead error).

## Failure behaviors (must be graceful)

| Scenario                                  | Expected behaviour                                              |
|-------------------------------------------|-----------------------------------------------------------------|
| URL times out > 60s                       | Return `{ _needsManualCaption: true, _timedOut: true }` — no throw |
| Gemini API key missing                    | Client-side Gemini skipped; server fallback attempted          |
| CORS proxy down                           | Other proxies tried; ultimately BrowserAssist opens           |
| Image CDN returns 403/signed URL expired  | Original URL kept; preview falls back to placeholder           |
| Weak result (title + 1 ingredient only)   | `isWeakResult()` → BrowserAssist opens with seed               |
| User toggles badge to drink mid-detection | `itemTypeUserOverride=true` locks type; Gemini re-runs w/ drink prompt |

## Regression checks (must still work)

- Offline queue (import while offline → queued and processed when back online).
- Drag-and-drop between ingredients ↔ directions in preview.
- Tap-to-aim + expand captions inside BrowserAssist iframe.
- Pinch-to-zoom and text selection inside BrowserAssist.
- Share-target flow: share an IG Reel to SpiceHub → auto-starts import.
- Preview editing (click-to-edit, delete rows, merge duplicates).

## What changed in this overhaul

1. `importItemFromUrl(url, options)` is now the canonical public entry.
   `importRecipeFromUrl` is kept as a backwards-compatible alias and accepts
   either a progress callback OR an options object `{ type, initialText, onProgress, timeoutMs }`.
2. `detectImportType(url, initialText)` auto-classifies meal vs drink from
   host heuristics, URL path tokens, and weighted keyword scoring.
3. Gemini prompt is type-aware (meal vs drink), with schema including
   `glass` and `garnish` fields for drinks and mixology-unit rules.
4. Universal image capture: `_huntPageImage(url)` hunts og:image →
   twitter:image → JSON-LD image → itemprop image → video poster → first
   plausible `<img>` if the primary pipeline misses an image.
5. Expanded `EPHEMERAL_HOSTS` regex covers TikTok, Pinterest, FB, Snap,
   YouTube thumbnails, Twitter/X media, Reddit preview, Imgur, Cloudfront-signed.
6. Placeholder `"See original post…"` strings no longer leak through.
   `_finalizeRecipe` preserves empty arrays, and flips to
   `_needsManualCaption` only when ingredients + directions + title + image
   are all missing.
7. Top-level 60s `Promise.race` timeout prevents Reels/Shorts infinite-load.
8. ImportModal surfaces a drink/meal badge next to the URL input with
   one-tap override. The type is threaded into `importRecipeFromUrl`,
   `BrowserAssist`, `parseFromUrl`, `tryMarkdownExtraction`,
   `extractInstagramAgent`, `captionToRecipe`, and `structureWithAIClient`.

## Conventional Commit suggestion

    feat(import): unified import engine with drink/meal type routing

    - Add detectImportType() with URL heuristics + weighted keyword scoring
    - Add importItemFromUrl() as canonical public entry point
    - Thread type={meal|drink} through full pipeline (parseFromUrl,
      tryMarkdownExtraction, extractInstagramAgent, captionToRecipe,
      structureWithAIClient, BrowserAssist)
    - Drink-specific Gemini prompt: mixology units, terse directions,
      glass + garnish fields
    - Universal image hunt helper (_huntPageImage) runs og:image/twitter:image/
      JSON-LD image / schema itemprop / video poster / best <img> as fallback
    - Expanded EPHEMERAL_HOSTS to TikTok, Pinterest, FB, Snap, YT, X, Reddit,
      Imgur, Cloudfront-signed
    - Stop leaking "See original post…" placeholders; preserve empty arrays;
      flip to _needsManualCaption only when truly empty
    - 60s top-level timeout guard prevents Reels/Shorts infinite-spin
    - ImportModal: drink/meal badge with one-tap override + 40px touch target
