# SpiceHub — Unified Recipe Import Engine (May 2026)

## Architecture

The import pipeline lives in `recipeParser.js` with helpers in `api.js`. Entry points:
- `importRecipeFromUrl(url)` — universal entry (detects URL type, routes to correct handler)
- `importFromInstagram(url, onProgress, { type })` — Instagram-specific multi-phase engine

## Instagram Import Pipeline (priority order)

```
Phase 0    — yt-dlp video subtitles (Reels with narration)
Phase 0.25 — Apify Instagram scraper (PRIMARY — managed proxies, full caption + fresh CDN image)
Phase 0.5  — Instagram oEmbed API (requires FB_APP_TOKEN)
Phase 0.75 — Instagram JSON endpoint (?__a=1&__d=dis)
Phase 1    — Instagram embed page (/embed/captioned/ via CORS proxy)
Phase 2    — AI browser / extractInstagramAgent (Puppeteer fallback)
Phase 3    — Gemini AI structuring (ALWAYS runs on captured text)
Fallback   — { _needsManualCaption: true } with pre-filled caption
```

### Apify Integration (Phase 0.25)
- Server-side via Vercel: `/api/proxy?mode=instagram-apify&url=...`
- Requires `APIFY_TOKEN` env var on Vercel
- Returns: caption, displayUrl (fresh CDN), videoUrl, ownerUsername, hashtags
- Image is eagerly downloaded to base64 data URL before CDN token expires
- Falls through silently if token not configured (503)

### Image Persistence Strategy
Instagram CDN URLs (scontent/fbcdn) expire within hours. Fix:
1. At import time, `downloadImageAsDataUrl()` converts CDN URL → base64 data URL
2. Data URL stored in Dexie alongside recipe — works offline forever
3. `SafeMediaImage.jsx` handles display: data URLs direct, CDN URLs via proxy fallback chain

### Gemini Auto-Sorting
- Client-side Gemini Flash via `VITE_GOOGLE_AI_KEY` (preferred — no server roundtrip)
- Server-side via `VITE_SERVER_URL` + `/api/structure-recipe` (fallback)
- Prompt enforces strict ingredient/direction separation with explicit examples
- Handles section headers ("Spice Mix:"), numbered steps, mixed content

## Environment Variables (Vercel)
```
VITE_GOOGLE_AI_KEY  — Gemini API key (client-side, baked into bundle)
APIFY_TOKEN         — Apify API token (server-side only, never exposed)
FB_APP_TOKEN        — Facebook Graph API token for oEmbed (server-side)
IG_COOKIES_JSON_B64 — Optional Instagram session cookies (server-side)
```

## Key Files
- `src/recipeParser.js` — All parsing logic, import engine, Gemini prompts
- `src/api.js` — CORS proxy cascade, Instagram helpers, image download
- `api/proxy.js` — Vercel Edge Function (server-side proxy for all modes)
- `src/components/SafeMediaImage.jsx` — Image display with proxy fallback chain
- `server/persistImage.js` — Server-side image → base64 conversion

## Testing
Test with these shortcodes from the error log:
1. `DIt_c6eTF2P` — Cauliflower Fajitas (full recipe caption + video)
2. `DCaQkFNytrh` — Crispy Mushroom Parm (full recipe caption + video)
3. `DNtaNx_XpaY` — Sheet Pan Gnocchi (full recipe caption + video)

All three should import with: complete title, ingredients array, directions array, and persisted image.