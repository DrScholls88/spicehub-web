# Import Reliability Overhaul — Design Spec
**Date:** 2026-05-03  
**Approaches:** A (Third-Party Viewer Stack) + B (Vercel Proxy Hardening)  
**Status:** Approved, ready for implementation planning

---

## Problem Statement

The SpiceHub import pipeline has three reliability failure modes:

1. **Instagram** — CORS proxy waterfall is the only mechanism. Meta actively rate-limits public proxies (allorigins.win, corsproxy.io). No first-class API path exists. Result: frequent empty caption / "server not available" failures.
2. **TikTok** — No extraction at all. Falls straight to BrowserAssist manual paste every time.
3. **Recipe blogs** — Single User-Agent string gets flagged by bot walls (Allrecipes, NYTimes, etc). No fallback to cached versions when live fetch fails.
4. **Repeat imports** — Every import re-fetches the network even for URLs previously imported successfully. No caching layer.

---

## Architecture Overview

Four layers added on top of the existing code. Nothing existing is removed.

```
EVERY IMPORT REQUEST
        │
        ▼
┌─────────────────────────┐
│  1. IndexedDB Cache     │  → HIT: instant return (7-day TTL)
│     (new, Dexie v11)    │  → MISS: continue
└─────────────┬───────────┘
              │
        ┌─────┴──────┐
        │  Platform? │
        └──┬──────┬──┘
           │      │
        Instagram  TikTok      Recipe Blog
           │         │              │
    ┌──────┴──┐  ┌───┴───┐   ┌────┴────┐
    │B: oEmbed│  │B: oEmb│   │B: UA    │
    │B: ?__a=1│  │Gemini │   │  rotated│
    │A: imginn│  │paste  │   │A: Wayback│
    │embed(cur)│  └───────┘  │existing │
    └──────────┘              └─────────┘
              │
        ┌─────▼─────┐
        │ Write cache│  → success always writes to IndexedDB
        └────────────┘
```

**Key contract:** `importRecipeFromUrl` and `importFromInstagram` gain a cache check at entry and a cache write on success. All additions are layered inside existing functions. Zero breaking changes to ImportModal, BrowserAssist, App.jsx, or the recipe schema.

---

## Section 1: IndexedDB Import Cache

### Dexie Schema — Version 11

```js
// src/db.js
db.version(11).stores({
  importCache: 'url, fetchedAt, provider'
  // url        — normalized URL string (primary key, indexed)
  // fetchedAt  — epoch ms (for TTL pruning, indexed)
  // provider   — string label for debugging which path succeeded
  // result     — full recipe object (not indexed, just stored as-is)
});
```

### Cache Helpers (`src/api.js`)

```js
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns cached recipe for the given URL, or null if missing/expired.
 */
export async function getCachedImport(url) {
  const key = normalizeImportUrl(url);
  const entry = await db.importCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    await db.importCache.delete(key); // prune on read
    return null;
  }
  return entry.result;
}

/**
 * Store a successful import result. Only caches results with >= 2 ingredients
 * and no error/manual-caption flags.
 */
export async function setCachedImport(url, result, provider = 'unknown') {
  if (!result || result._error || result._needsManualCaption) return;
  if (!result.ingredients || result.ingredients.length < 2) return;
  const key = normalizeImportUrl(url);
  await db.importCache.put({ url: key, result, fetchedAt: Date.now(), provider });
}

/**
 * Delete all cache entries older than TTL. Call once on app start.
 */
export async function pruneStaleCacheEntries() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  await db.importCache.where('fetchedAt').below(cutoff).delete();
}
```

### URL Normalizer

```js
/**
 * Generic import URL normalizer. Strips UTM params and trailing slash.
 * Instagram URLs use the existing normalizeInstagramUrl() instead.
 */
export function normalizeImportUrl(url) {
  if (isInstagramUrl(url)) return normalizeInstagramUrl(url);
  try {
    const u = new URL(url);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(p =>
      u.searchParams.delete(p)
    );
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return url; }
}
```

### Integration Points

- `importRecipeFromUrl()` — cache check at top, cache write before every `return recipe`
- `importFromInstagram()` — cache check at top, cache write on successful structured result
- `pruneStaleCacheEntries()` — called once in `App.jsx` after Dexie opens (existing db init hook)

---

## Section 2: Vercel Proxy Upgrade (`api/proxy.js`)

The existing Edge function gains `?mode=` routing. All security checks (SSRF blocklist, method, protocol) remain identical.

### New Mode: `instagram-oembed`

```
GET /api/proxy?mode=instagram-oembed&url=ENCODED_IG_URL
```

Server-side call to:
```
https://graph.facebook.com/v18.0/instagram_oembed
  ?url=ENCODED_IG_URL
  &fields=html,thumbnail_url,author_name
  &access_token=FB_APP_TOKEN
```

- `FB_APP_TOKEN` = `APP_ID|APP_SECRET` from a free Facebook Developer App, stored as a Vercel environment variable. **Never referenced in client-side code.**
- Response is passed through as-is to the client. Client parses `html` field for caption using existing regex patterns.
- If `FB_APP_TOKEN` is not set, this mode returns `{ error: 'oEmbed not configured' }` and the pipeline falls through silently.

### New Mode: `instagram-json`

```
GET /api/proxy?mode=instagram-json&shortcode=SHORTCODE
```

Server-side call to:
```
https://www.instagram.com/p/SHORTCODE/?__a=1&__d=dis
```
With full Instagram headers (already defined in `buildHeaders()`). Returns raw JSON. Client extracts `graphql.shortcode_media.edge_media_to_caption.edges[0].node.text` for caption. Works ~60% of the time — zero cost to attempt.

### New Mode: `tiktok-oembed`

```
GET /api/proxy?mode=tiktok-oembed&url=ENCODED_TIKTOK_URL
```

Server-side call to TikTok's official public oEmbed endpoint:
```
https://www.tiktok.com/oembed?url=ENCODED_TIKTOK_URL
```
No auth required. Returns `{ title, author_name, thumbnail_url }`. Title on food TikToks frequently contains the full ingredient list.

### UA Rotation (all existing `?url=` calls)

Replace the single static Chrome UA in `buildHeaders()` with a small rotation:

```js
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
];

// Rotate based on time — deterministic but cycles every ~15 min
const ua = USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length];
```

This breaks the pattern that bot walls use to fingerprint repeated requests from the same proxy IP.

### Environment Variables Required

| Variable | Where set | Used by |
|----------|-----------|---------|
| `FB_APP_TOKEN` | Vercel dashboard → Environment Variables | `api/proxy.js` (server-side only) |

---

## Section 3: Instagram Pipeline Reorder (`src/recipeParser.js`)

`importFromInstagram` execution order becomes:

| Step | Source | UI row | Notes |
|------|--------|--------|-------|
| 0 | Dexie cache | (silent) | Returns instantly on hit |
| 0.5 | `/api/proxy?mode=instagram-oembed` | Caption fetch | Official Meta API |
| 0.75 | `/api/proxy?mode=instagram-json` | Caption fetch | `?__a=1` JSON, best-effort |
| 1 | Third-party viewers (imginn → picuki → ddinstagram) | Caption fetch | Via existing CORS proxy |
| 2 | Existing embed page scrape | Caption fetch | Current behavior, now last resort |
| 3 | Gemini structuring | AI structuring | Unchanged — runs on any captured text |

The BrowserAssist pipeline UI still shows 4 rows. Steps 0.5, 0.75, 1, and 2 all report into the "Caption fetch" row — whichever succeeds first sets it to `done` and the rest are skipped.

### Third-Party Viewer URLs (Step 1)

```js
const VIEWER_TEMPLATES = [
  sc => `https://imginn.com/p/${sc}/`,
  sc => `https://picuki.com/media/${sc}`,
  sc => `https://www.ddinstagram.com/p/${sc}/`,
];
```

Each is fetched through `fetchHtmlViaProxy()`. Caption regex patterns are identical to those in `extractInstagramEmbed` — the viewer sites use similar HTML structure. First viewer returning `caption.length > 20` wins and skips the rest.

### Cache Write

```js
// At every successful return point in importFromInstagram:
await setCachedImport(url, result, providerLabel);
return result;
```

---

## Section 4: TikTok Pipeline (new)

New exported function added to `src/recipeParser.js`:

```js
/**
 * Import a recipe from a TikTok URL.
 * Phase 1: TikTok oEmbed → title + thumbnail
 * Phase 2: Gemini structures the title text into a recipe
 * Phase 3: If Gemini can't find ingredients, set _needsManualCaption
 *
 * @param {string} url - TikTok video URL
 * @param {function} onProgress - (message: string) => void
 * @returns {Promise<RecipeResult>}
 */
export async function importFromTikTok(url, onProgress = () => {}) { ... }
```

Execution:
1. Cache check — return instantly if hit
2. `GET /api/proxy?mode=tiktok-oembed` — extract `title`, `author_name`, `thumbnail_url`
3. Feed title into `structureWithAI()` with prompt: *"This is the title/caption of a TikTok food video by @{author_name}. Extract a structured recipe if the text contains ingredients and steps: {title}"*
4. Attach `thumbnail_url` as `imageUrl` on the result object
5. If Gemini result has `ingredients.length < 2` → set `_needsManualCaption: true` (BrowserAssist fallback with URL pre-populated)
6. Cache successful result

`importRecipeFromUrl` gains a `isTikTokUrl()` check that routes to `importFromTikTok` before the existing Instagram/general paths.

```js
function isTikTokUrl(url) {
  return /tiktok\.com/i.test(url);
}
```

---

## Section 5: Recipe Blog Improvements

### UA Rotation (automatic)
Handled entirely by the Section 2 proxy upgrade. All `fetchHtmlViaProxy` calls in production route through `/api/proxy`, so blog fetches automatically get rotating UAs with zero client-side changes.

### Wayback Machine CDX Fallback

Added to `importRecipeFromUrl` for non-social URLs, fires only after all proxy attempts return empty or a bot-wall response:

```js
// Wayback CDX check — CORS-accessible, no proxy needed
async function tryWaybackFallback(url) {
  try {
    const cdxResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const cdx = await cdxResp.json();
    const snapshot = cdx?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) return null;

    const archiveHtml = await fetchHtmlViaProxy(snapshot.url, 20000);
    if (!archiveHtml || archiveHtml.length < 3000) return null;

    // Run existing JSON-LD + OG meta parser on archived HTML
    return parseHtml(archiveHtml, url);
  } catch { return null; }
}
```

The CDX check itself is ~200ms. Only fires as a last resort, so it doesn't add latency to the happy path.

---

## Files Changed

| File | Change type | Description |
|------|-------------|-------------|
| `api/proxy.js` | Modify | Add `?mode=` routing, UA rotation, 3 new oEmbed/JSON handlers |
| `src/db.js` | Modify | Version 11, `importCache` table |
| `src/api.js` | Modify | `getCachedImport`, `setCachedImport`, `pruneStaleCacheEntries`, `normalizeImportUrl` |
| `src/recipeParser.js` | Modify | Reorder Instagram phases, add viewer URLs, new `importFromTikTok`, `isTikTokUrl`, Wayback CDX fallback, cache writes at all return points |
| `src/App.jsx` | Modify (1 line) | Call `pruneStaleCacheEntries()` in existing db-init effect |

**Zero changes** to: `ImportModal.jsx`, `BrowserAssist.jsx`, or any other UI component. Recipe schema output is identical.

---

## Environment Setup (one-time)

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → Consumer → get App ID + Secret
2. In Vercel dashboard → Project → Settings → Environment Variables → add `FB_APP_TOKEN` = `APP_ID|APP_SECRET`
3. Redeploy (automatic on next push)

The app works without this variable — the oEmbed mode returns an error and the pipeline falls through to the next layer silently.

---

## Success Criteria

- Instagram captions extracted on first attempt (not just proxy waterfall) for public posts
- TikTok URLs produce a structured recipe skeleton (title + image at minimum) instead of immediate manual paste
- Repeat imports of any URL return in < 100ms from cache
- Recipe blog imports succeed even when the live site is behind a bot wall (Wayback fallback)
- No regressions in ImportModal, BrowserAssist, or offline queue behavior
