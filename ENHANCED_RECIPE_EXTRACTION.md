# Enhanced Recipe Extraction — Current SpiceHub Implementation (recipeParser.js + BrowserAssist.jsx + ImportModal.jsx)

## Overview

SpiceHub uses a **unified, progressive extraction pipeline** optimized for a client-side PWA with strong offline support:

1. **Server-side first** (`/api/extract-url`) for social media (headless Chrome + yt-dlp metadata where available)
2. **Client-side auto-extraction** via `extractWithBrowserAPI()` in BrowserAssist
3. **Fallbacks**: embed pages, caption parsing, manual paste, and offline queuing
4. **Preview editing** with draggable reorganization in ImportModal

The core functions (`detectRecipePlugins`, `parseCaption`, `smartClassifyLines`, `parseIngredientLine`, `extractWithBrowserAPI`) provide robust handling of blogs, social posts, video descriptions, and OCR text.

## Current Key Functions (Aligned with recipeParser.js)

### `extractWithBrowserAPI(pageContent)`
- Unified entry point used by both server and BrowserAssist
- Order of confidence:
  1. Recipe plugin detection (WPRM, Tasty Recipes, JSON-LD, semantic HTML, common CSS patterns)
  2. `parseCaption()` on visible text / cleaned subtitles
  3. `smartClassifyLines()` as final heuristic fallback
- Returns structured recipe or `null`
- Fully supports offline queuing of partial results

### `parseCaption(text)`
- 4-pass heuristic parser optimized for social media + video content
- Handles Instagram captions, YouTube descriptions, TikTok text, abbreviated formats ("1c flour, 2 eggs…")
- Special handling for video transcripts (detects "Transcript:" sections)
- Timestamp stripping, hashtag cleanup, filler removal, and spoken-style direction detection
- Feeds into `smartClassifyLines()` when sections are unclear

### `smartClassifyLines(lines)`
- Multi-signal classification (headers, cooking verbs, measurements, length, bullets, spoken starters)
- Improved handling of video-style content and timestamps
- Returns clean `{ ingredients, directions }`

### `parseIngredientLine(text)`
- Structured parsing: quantity, unit, name
- Supports fractions (½, ¼, etc.), 50+ units, common variations
- Used in preview editing for better ingredient UX

### `detectRecipePlugins(html)`
- Detects WPRM, Tasty Recipes, JSON-LD, semantic markup, and common CSS patterns
- High-confidence structured extraction when plugins are present

### Supporting Helpers
- `isSocialMediaUrl()` + `getSocialPlatform()`
- `resolveShortUrl()` for bit.ly, t.co, etc.
- `selectBestImage()` for robust image picking
- Placeholder filtering to avoid “See original post” noise

## Current Frontend Integration

**BrowserAssist.jsx**:
- Auto-extraction pipeline on load (plugin → caption → smart classify)
- Fallback to larger iframe with zoom controls and floating “Extract Recipe” button
- Pinch-to-zoom support and improved mobile text selection
- Progress states and offline handling

**ImportModal.jsx**:
- Unified URL import with social detection and batch support
- Draggable reorganization of ingredients/directions in preview
- Share-target auto-import (direct from Android/iOS share sheet)
- Preview editing with add/remove fields
- Offline queue integration

## Recommended Next Enhancements (Building on Current Code)

1. **Subtitle-First Video Pipeline**
   - Lightweight yt-dlp wrapper (server-side) with version pinning
   - Subtitle-only mode + aggressive cleaning (WEBVTT, timestamps, XML tags, speaker labels)
   - Feed cleaned subtitles directly into `parseCaption()` → `smartClassifyLines()`

2. **UX Improvements (UI/UX Pro Max)**
   - Larger default iframe + better zoom/pinch controls
   - More intuitive drag handles and visual drop zones for text reorganization
   - Fixed preview scroll behavior
   - Prominent, touch-friendly Rotation toggle
   - Smooth slide-down gestures on modals

3. **Progress & Feedback**
   - Clear multi-step messages during video/social extraction
   - Better handling of partial results (metadata + cleaned text) into offline queue

These changes maintain **progressive enhancement** — current zero-cost behavior stays intact while adding powerful subtitle support and polished mobile UX.

**Integration Path**:
- Extend `parseCaption()` and `extractWithBrowserAPI()` for subtitle cleaning
- Enhance BrowserAssist + ImportModal with UI/UX Pro Max patterns
- Add optional yt-dlp route in server (keeps client-side fallback)

This keeps SpiceHub fast, reliable, and increasingly capable for modern video-only recipes while preserving the strong offline-first foundation.