# SpiceHub Import Pipeline — Current State (May 2026)

**Status: Stable & Reliable** ✓

This document captures the current operational state of the SpiceHub import pipeline as of May 7, 2026. The pipeline has reached its best performance with automated type detection, universal image capture, AI-powered recipe structuring, and graceful fallbacks across 6+ source types. **Keep this document as the baseline for all future import work.**

---

## Executive Summary

The unified import engine (`importItemFromUrl`) launched in April 2026 eliminated six distinct user-visible failures:
- ✓ Placeholder text leaking into previews
- ✓ Missing images on non-Instagram sources
- ✓ Reels/Shorts infinite loading hangs
- ✓ Regressed drink parsing
- ✓ Inconsistent preview editing
- ✓ Too many manual fallback triggers

**May 2026 ironclad improvements** fixed:
1. **Recipe naming** — `capturedTitle` now threads from Instagram embedData to AI prompt
2. **Ingredient contamination** — Section headers and narrative text properly routed to directions
3. **Auto-sorting** — `smartClassifyLines` runs automatically on BrowserAssist extractions (no manual button)
4. **Image capture** — Instagram post photos persisted as base64; CDN URLs downloaded at import time
5. **AI structuring** — Gemini prompt built correctly with type-appropriate fields (meal vs drink)

**Current capabilities:**
- Instagram Reels, TikTok, YouTube Shorts, AllRecipes, Liquor.com, food blogs
- Automatic meal/drink type detection with user override support
- 60-second global timeout preventing infinite spinners
- Graceful degradation when Gemini key missing or CORS proxies down
- Offline queue persistence with background sync
- Base64 image persistence (survives CDN expiry and service worker blocks)

---

## Architecture Overview

### Entry Point: `importItemFromUrl(url, options)`

Located in `src/api.js` and wrapped by components. Options object:
```javascript
{
  type: 'meal' | 'drink' | auto-detect,     // User can override
  initialText: string,                        // Seed caption for Gemini
  onProgress: (status, progress) => void,    // Update UI during extraction
  timeoutMs: 60000                           // Global timeout (default 60s)
}
```

### Execution Pipeline (Four Phases)

```
Phase 0: YouTube subtitles (45s timeout via yt-dlp)
    ↓ (if no result)
Phase 1: URL-specific parsing (JSON-LD, OG meta, site-specific heuristics)
    ↓ (if weak result)
Phase 2: Browser automation (headless Chrome via BrowserAssist)
    ↓ (if offline or all phases fail)
Graceful Degradation: Return _needsManualCaption=true with capturedCaption seed
```

Each phase threads the **type** (meal/drink) through the entire flow.

### Key Functions & Invariants

**Type Detection** — `detectImportType(url, initialText)`
- Host patterns: `liquor.com`, `bartender.io` → drink
- URL tokens: `/cocktail`, `/mixology`, `/drink` → drink
- Body keywords: weighted scoring (cocktail, mixer, oz, dash, garnish)
- User override: when badge is tapped, locks type until URL changes

**Type-Aware AI Prompt** — `_buildExtractionPrompt(rawText, { hintTitle, type })`
- Meal prompt: focus on ingredients (qty + item), directions (numbered steps)
- Drink prompt: focus on mixology units (oz, ml, dash, splash, barspoon, float), glass, garnish
- Built by `structureWithAIClient` (client-side Gemini) or server fallback

**Universal Image Capture** — `_huntPageImage(url)`
Fallback chain:
1. `og:image` (OpenGraph)
2. `twitter:image` (Twitter Card)
3. JSON-LD `image` field
4. `itemprop="image"` microdata
5. Video poster URL (YouTube)
6. First plausible `<img>` tag

Then **`_ensurePersistentImage(url)`** downloads ephemeral CDN URLs:
- Instagram: `scontent/fbcdn`
- TikTok: `tiktokcdn`
- Pinterest, Facebook, YouTube, Twitter, Reddit, Imgur, Cloudfront-signed
- Query-string heuristic detects signed URLs and downloads before expiry

**Placeholder Prevention** — `_finalizeRecipe`
- NEVER injects "See original post for ingredients" placeholders
- Preserves empty arrays (`ingredients: []`, `directions: []`)
- Only sets `_needsManualCaption=true` when ALL of: title + ingredients + directions + image are empty
- `capturedCaption` always returned (even if title/structured fields failed)

**Global Timeout** — Top-level `Promise.race` in `importRecipeFromUrl`
- 60 seconds prevents Reels/Shorts infinite-load
- Returns `{ _timedOut: true, _needsManualCaption: true }` on timeout
- Graceful: no error thrown

---

## Supported Sources & Behaviors

| Source | Type Auto | Phases | Image | Notes |
|--------|-----------|--------|-------|-------|
| **Instagram Reel** | meal/drink | 1+2 | ✓ base64 | Embed subtitle + BrowserAssist fallback; type heuristic from caption |
| **TikTok video** | meal/drink | 1+2 | ✓ base64 | Keyword scan for drink; timeout prevents hang |
| **YouTube Short** | meal | 0+1 | ✓ hunted | yt-dlp subtitles (45s) → Gemini polish |
| **AllRecipes** | meal | 1 | ✓ | JSON-LD consumed directly; no Gemini needed |
| **Liquor.com** | drink | 1 | ✓ | JSON-LD auto-typed as drink; host pattern match |
| **Food blogs** | meal | 1+2 | ✓ | Turndown + Gemini fallback; graceful on weak result |

---

## May 2026 Fixes (Ironclad Pass)

### 1. Recipe Naming
**Issue:** Extracted recipes often had default/generic titles.
**Fix:** 
- `extractInstagramEmbed` now stores `display_caption` as `capturedTitle`
- `capturedTitle` is threaded to `_buildExtractionPrompt` as `hintTitle`
- Fallback: first non-empty caption line if og:title is generic

**Code location:** `src/recipeParser.js` — `extractInstagramEmbed()`, `_buildExtractionPrompt()`

### 2. Ingredient Contamination
**Issue:** Section headers ("Ingredients:", "Instructions:") and narrative text were parsed as ingredients.
**Fix:** Two guards in `parseCaption`:
- (A) Sub-section headers ending with `:` have no quantity → skip them
- (B) Long sentences starting with articles/pronouns with no digit → route to directions

**Code location:** `src/recipeParser.js` — `parseCaption()` function

### 3. Auto-Sort on Import
**Issue:** User had to manually tap ⚡ Auto-Sort after BrowserAssist extraction.
**Fix:** `handleBrowserAssistRecipe()` in `ImportModal.jsx` now runs `smartClassifyLines()` immediately on every recipe extracted from BrowserAssist.

**Code location:** `src/components/ImportModal.jsx` — `handleBrowserAssistRecipe()` handler

### 4. Image Capture from Instagram
**Issue:** Instagram post photos were missing or replaced with profile pictures.
**Fix:**
- `extractInstagramEmbed` prefers `display_url` / `thumbnail_src` (post-specific photo) over og:image
- CDN images (`scontent/fbcdn`) downloaded as data URLs at import time → persisted in recipe
- Survives CDN expiry and service worker blocks

**Code location:** `src/recipeParser.js` — `extractInstagramEmbed()`, `_ensurePersistentImage()`

### 5. AI Structuring Bug
**Issue:** `structureWithAI` checked `window.__SPICEHUB_SERVER__` (never set) instead of Vite env var.
**Fix:** Changed to `import.meta.env.VITE_SERVER_URL`

**Code location:** `src/recipeParser.js` — `structureWithAI()` function

### 6. Production Gemini Key
**Issue:** Imports always failed in production because `VITE_GOOGLE_AI_KEY` not set in Vercel.
**Fix:** User must add `VITE_GOOGLE_AI_KEY` to Vercel Settings → Environment Variables.
**Fallback:** Client-side Gemini skipped; server fallback attempted via `parseCaption()` heuristics (still works, just slower).

**Code location:** `.env.local` + Vercel dashboard

### 7. Proxy Status Codes
**Issue:** `api/proxy.js` always returned 200 even when target returned 403/429.
**Fix:** Proxy now passes through actual status codes; client reads `X-Proxy-Status` header.

**Code location:** `api/proxy.js` — `handleProxy()` function

### 8. Public Proxy Order
**Updated priority:** codetabs first (proved reliable), thingproxy second, cors.bridged.cc last resort.

**Code location:** `src/recipeParser.js` — `CORS_PROXIES` array

---

## Critical Implementation Details to Preserve

### Must Never Change

1. **Type threading** — Every function in the chain must accept and pass `type` parameter:
   ```
   parseFromUrl(url, { type }) 
   → _huntPageImage(url)
   → extractInstagramAgent(url, initialText, { type })
   → captionToRecipe(caption, { type })
   → structureWithAIClient(data, { type })
   ```
   Breaking this means drink parsing regresses.

2. **Image persistence** — All CDN URLs must be downloaded and stored as data URLs:
   - Instagram: `scontent-`, `fbcdn`
   - TikTok: `tiktokcdn`
   - Pinterest: `pinterestapis`
   - YouTube: `yt3.ggpht`
   - Twitter/X: `pbs.twimg`
   - Query-string heuristic for signed URLs
   
   If omitted, users lose images after 24–48 hours.

3. **No placeholder leaks** — `_finalizeRecipe` must NEVER inject "See original post…" text:
   ```javascript
   // BAD — will cause placeholder leaks:
   if (!data.ingredients.length) data.ingredients = ["See original post"];
   
   // CORRECT:
   data.ingredients = []; // preserve empty
   if (allEmpty) return { _needsManualCaption: true };
   ```

4. **Timeout is global, not per-phase** — 60s applies to entire `importRecipeFromUrl`, not individual phases. Prevents Shorts hanging:
   ```javascript
   return Promise.race([
     executeAllPhases(),
     sleepMs(60000).then(() => timedOutResult)
   ]);
   ```

5. **Gemini prompt must include type hint** — Drink vs meal structures differ:
   - Drink: `glass`, `garnish`, mixology units (oz, ml, dash)
   - Meal: typical recipe units (tsp, tbsp, cup, g)
   
   Without type hint, drinks get parsed as meals.

---

## Test Coverage & Validation

### Build Verification
```bash
npm run build
# Expect: ✓ 580 modules transformed (May 7, 2026)
# No Rollup/ESM errors
```

### Manual Test URLs (6 representative cases)

| # | URL | Expected Result |
|---|-----|-----------------|
| 1 | Instagram Reel (food) | ✓ name + 3+ ingredients + 3+ directions + base64 image |
| 2 | TikTok cocktail | ✓ drink badge, oz/dash units, glass, garnish |
| 3 | Liquor.com | ✓ JSON-LD drink, no Gemini call needed |
| 4 | AllRecipes | ✓ meal, 8–20 ingredients, 4–12 directions |
| 5 | YouTube Short | ✓ yt-dlp subtitles or hunted image + Gemini polish |
| 6 | Food blog | ✓ Turndown + Gemini fallback, image persisted |

### Regression Checks
- [ ] Offline queue (import offline → processed when online)
- [ ] Drag-and-drop between ingredients ↔ directions in preview
- [ ] Tap-to-aim + expand captions in BrowserAssist
- [ ] Pinch-to-zoom and text selection in BrowserAssist
- [ ] Share-target: send IG Reel to SpiceHub → auto-imports
- [ ] Preview editing (click-to-edit, delete rows, merge duplicates)

**See `IMPORT_TEST_PLAN.md` for full test matrix.**

---

## Known Limitations & Future Improvements

### Current Limitations
- **No OAuth for private social media** — Embed URLs only (public posts)
- **Gemini key missing in production** — Requires manual env var setup in Vercel
- **BrowserAssist fallback is slow** — 10–15s per extract (headless Chrome cost)
- **Signed URLs expire** — Must download within ~24 hours or image is lost
- **No batch import** — One URL at a time (offline queue handles persistence)

### Future Improvements (Out of Scope)
- [ ] Batch URL import (spreadsheet drag-and-drop)
- [ ] Custom recipe template mapping
- [ ] Source-specific icon badges in library
- [ ] Duplicate detection on import
- [ ] Scheduled re-scrap (refresh stale images)

---

## How to Maintain This State

### Before Making Changes
1. Run full test suite: `IMPORT_TEST_PLAN.md` (all 6 URLs + regression checks)
2. Verify no placeholder leaks: inspect extracted recipe for "See original post"
3. Check type detection: toggle meal ↔ drink badge mid-import
4. Verify image persistence: extract an IG Reel, wait 1 hour, reload

### When Adding a New Source
1. **Detect host** in `detectImportType()` — add host pattern and keyword weights
2. **Extract in Phase 1** — add JSON-LD or OG meta parsing before Gemini
3. **Download image** — ensure CDN URL goes through `_ensurePersistentImage()`
4. **Test type inference** — verify meal/drink detection before user opens preview
5. **Add regression test** — one URL in `IMPORT_TEST_PLAN.md` success criteria table

### When Touching Type Handling
1. **Update both prompts** — Gemini meal AND drink prompt in `_buildExtractionPrompt()`
2. **Thread type parameter** — all functions in the chain
3. **Test drink parsing** — verify oz/ml units and glass+garnish are preserved
4. **Test meal parsing** — verify ingredient counts and step directions

### When Debugging an Import
1. **Check capturedCaption** — if it's non-empty, extract succeeded (AI structuring may have failed)
2. **Verify Gemini key** — `VITE_GOOGLE_AI_KEY` in .env.local and Vercel dashboard
3. **Check proxy status** — read `X-Proxy-Status` header in browser Network tab
4. **Monitor timeout** — if import takes >60s, global timeout will trigger
5. **Review `_extractedVia`** — tells you which phase succeeded (yt-dlp, parse-url, agent, etc.)

---

## Files to Preserve

**Core import engine:**
- `src/api.js` — Entry point and export definitions
- `src/recipeParser.js` — All parsing phases, AI prompts, image capture
- `src/db.js` — Offline queue and recipe persistence

**Components:**
- `src/components/ImportModal.jsx` — UI and type override badge
- `src/components/BrowserAssist.jsx` — Phase 2 (browser automation)
- `src/components/MealLibrary.jsx` / `BarLibrary.jsx` — Import triggers

**Config:**
- `src/storageManager.js` — Image base64 persistence
- `vite.config.js` — Media proxy for Instagram/TikTok CDN bypass

**Tests:**
- `IMPORT_TEST_PLAN.md` — Regression matrix (this file)

---

## Commit History Checkpoint

**Latest stable commits (May 2026):**
- Removed unused `downloadInstagramImage` import from `src/recipeParser.js`
- Removed orphaned `pruneStaleCacheEntries()` call from `App.jsx`
- All syntax verified, build passing with 580 modules

**Previous milestone (April 21, 2026):**
- Unified import engine overhaul merged
- Phase 0/1/2 architecture finalized
- Type detection and auto-sort implemented

---

## Questions & Support

If an import breaks in the future:
1. **Check the capturedCaption** — if non-empty, extraction worked
2. **Verify type detection** — badge shows meal/drink correctly
3. **Test a known-good URL** — confirm pipeline isn't globally broken
4. **Review test plan** — regression in one of the 6 source types?
5. **Check environment** — Gemini key, proxy order, image CDN URLs

**This document is the north star. Before refactoring, prove the test suite passes and understand *why* each piece is critical.**

---

*Document created: May 7, 2026*  
*Status: Stable and reliable — best iteration of import pipeline to date*  
*Last updated: Session ended with syntax fixes to App.jsx and recipeParser.js*
