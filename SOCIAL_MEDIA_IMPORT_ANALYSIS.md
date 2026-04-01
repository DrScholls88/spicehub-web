# Social Media Recipe Import Analysis & SpiceHub Recommendations (Current Setup)

## Executive Summary

SpiceHub currently uses a **robust client-side + server-assisted pipeline** for social media imports:
- Automatic detection via `isSocialMediaUrl()` + `getSocialPlatform()`
- `extractWithBrowserAPI()` (plugin detection → `parseCaption()` → `smartClassifyLines()`)
- `BrowserAssist.jsx` + `ImportModal.jsx` with auto-extraction, preview editing, and offline queuing
- Full integration with Dexie storage and SyncQueue for partial/offline results

This document updates the earlier Mealie PR analysis to match SpiceHub’s **existing architecture** and recommends targeted enhancements (subtitle support via yt-dlp, draggable reorganization, improved preview UX, etc.).

## Current SpiceHub Capabilities (as of latest recipeParser.js + BrowserAssist.jsx)

**Strengths**:
- Unified extraction: `extractWithBrowserAPI()` tries plugin markup → caption parsing → smart classification
- Strong heuristic parser (`parseCaption`, `smartClassifyLines`, `parseIngredientLine`) handles abbreviated formats, spoken-style text, timestamps, and Instagram/TikTok captions
- Auto-extraction in BrowserAssist (no button needed when successful) with fallback to manual iframe + floating “Extract Recipe” button
- Offline queue support via `queueRecipeImport()` — partial results (metadata + cleaned text) are saved and synced later
- Drag-and-drop reorganization support already wired into ImportModal preview (ingredients/directions lists)
- Image selection via `selectBestImage()` and proxy handling
- Short URL resolution (`resolveShortUrl`)
- Progress feedback and loading states

**Current Limitations**:
- No native subtitle extraction from video-only posts (Reels, TikTok, YouTube Shorts)
- Internal browser/iframe is sometimes too small on mobile → hard to select text
- Preview scroll can be unreliable on some devices
- No dedicated yt-dlp metadata/subtitle pipeline (relies on embed + caption fallback)
- Rotation toggle and slide-down gestures need more prominence and polish (UI/UX Pro Max will help)

## Recommended Enhancements (Aligned with Current Code)

### Tier 1: Quick, Zero-Cost Wins (No New Dependencies)

1. **Improve Internal Browser View (BrowserAssist.jsx)**
   - Make iframe significantly larger on mobile with pinch-to-zoom (already partially present — enhance controls and default zoom-out)
   - Fix preview scroll reliability (ensure proper `overflow` + touch scrolling)
   - Make draggable text reorganization more intuitive (larger drag handles, visual drop zones, follow UI/UX Pro Max guidelines)

2. **Enhance Subtitle/Timestamp Handling in parseCaption()**
   - Aggressively clean video-style text (strip WEBVTT, timestamps, XML tags, speaker labels, line numbers)
   - Better detection of chapter/timestamp lists and conversion to structured steps
   - Feed cleaned text directly into `smartClassifyLines()` and `parseIngredientLine()`

3. **Unified Progress Feedback**
   - Clear step-by-step messages in ImportModal + BrowserAssist (“Detecting video…”, “Trying subtitles…”, “No subtitles — falling back to caption…”, “Extracting recipe…”)

### Tier 2: Lightweight yt-dlp Integration (Server-Side)

Add a clean yt-dlp wrapper (inspired by social-to-mealie patterns) with:
- Version pinning via `YTDLP_VERSION` env var + startup check
- Subtitle-only mode first (`--skip-download --write-subs --write-auto-subs --sub-lang en --sub-format vtt`)
- Aggressive cleaning pipeline after fetching subtitles
- Extend `/api/extract-url` with platform detection and unified routing:
  1. Subtitles (if available and useful after cleaning)
  2. Current embed + headless Chrome + caption parsing
  3. Paste Text fallback

Feed cleaned subtitles directly into existing `parseCaption()` → `smartClassifyLines()` → `extractWithBrowserAPI()`.

Keep everything **progressive** — works without yt-dlp (current behavior) and enhances when available.

### Tier 3: UX Polish (Leverage UI/UX Pro Max Skill)

- Prominent, touch-friendly Rotation toggle with clear visual state
- Smooth slide-down gesture on meal detail / preview modals (especially on iOS standalone)
- Larger, more forgiving drag targets for text reorganization in preview
- Consistent offline indicators and queue status during import

## Integration Notes with Current Files

- **recipeParser.js**: Extend `parseCaption()` and `smartClassifyLines()` for better subtitle cleaning. `extractWithBrowserAPI()` already serves as the unified entry point.
- **BrowserAssist.jsx**: Enhance iframe sizing/zoom, inject better progress messages, improve floating button visibility, and ensure drag-and-drop works seamlessly in preview mode.
- **ImportModal.jsx**: Wire in draggable reorganization (already partially present), add progress steps, handle share-target auto-import, and ensure preview scroll works reliably.
- **Offline Queue**: All partial video results (metadata + cleaned text) must continue to queue correctly via `queueRecipeImport()`.

These changes build directly on the existing robust foundation without breaking offline-first behavior or requiring heavy new dependencies.

**Next Steps Recommendation**:
Use Ruflo + UI/UX Pro Max to implement Tier 1 first (iframe improvements + draggable UX + subtitle cleaning in parser), then add the lightweight yt-dlp wrapper as a progressive enhancement.

This keeps SpiceHub lightweight, zero-cost by default, and increasingly powerful for video-only recipes.