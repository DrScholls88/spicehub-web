# Import Reliability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Instagram oEmbed API + third-party viewer fallbacks + TikTok first-class support + IndexedDB general import cache + Wayback Machine CDX fallback for recipe blogs.

**Architecture:** New `importCache` Dexie table (version 11) caches all successful imports by normalized URL. Vercel edge proxy gains `?mode=` routing to call oEmbed APIs server-side (no CORS, proper headers). `importFromInstagram` gains two fast server-side phases before the existing embed scrape. New `importFromTikTok` uses TikTok's free public oEmbed endpoint + Gemini structuring.

**Tech Stack:** Dexie (IndexedDB), Vercel Edge Functions, Facebook Graph API (oEmbed), TikTok oEmbed (public), Wayback Machine CDX API, Gemini AI (existing), existing CORS proxy waterfall.

---

## ⚠️ CRITICAL: recipeParser.js Encoding Warning

`src/recipeParser.js` has **double-encoded UTF-8** throughout (a historical corruption). The Edit tool will fail if it tries to match lines containing em dashes, ellipsis, or any non-ASCII character. 

**All edits to recipeParser.js MUST use Python binary manipulation:**

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find and modify using ASCII-only anchor strings
old = b'some ascii-only anchor string'
new = b'replacement text'
data = data.replace(old, new)

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
```

Use `data.find(b'...')` to locate insertion points. Never use the Edit tool on recipeParser.js.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/db.js` | Modify | Add version 11 `importCache` table + 3 cache helper exports |
| `src/App.jsx` | Modify (1 line) | Call `pruneStaleCacheEntries()` in first useEffect |
| `api/proxy.js` | Modify | Add `?mode=` routing + UA rotation + 3 new handlers |
| `src/api.js` | Modify | Add `fetchInstagramOEmbed`, `fetchInstagramJson`, `fetchTikTokOEmbed` |
| `src/recipeParser.js` | Modify | Instagram phase reorder, `importFromTikTok`, `isTikTokUrl`, Wayback CDX, cache writes |

---

## Task 1: Dexie v11 importCache Schema + Cache Helpers

**Files:**
- Modify: `src/db.js`
- Modify: `src/App.jsx`

### Context

`src/db.js` is currently on version 10. It already has an `instagramCache` table (Instagram-only, added in an earlier version). We add a new `importCache` table (version 11) as the general-purpose cache for ALL URL types. The new code will use `importCache`; `instagramCache` is kept as-is.

The first `useEffect` in `src/App.jsx` currently calls `loadMeals()` and `loadDrinks()`. We add `pruneStaleCacheEntries()` to that same block.

- [ ] **Step 1: Add version 11 and cache helpers to db.js**

Open `src/db.js`. Find the last `db.version(10).stores({...})` block (currently at the bottom of the version declarations). Add version 11 immediately after it. Then add three exported helper functions at the end of the file.

Add after the `db.version(10).stores({...})` block:

```js
db.version(11).stores({
  importCache: 'url, fetchedAt, provider',
});
```

Add at the end of `src/db.js` (after the existing `clearInstagramCache` function):

```js
// ── General import cache (all URL types) ─────────────────────────────────────
const IMPORT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Normalize a URL for use as a cache key.
 * Strips UTM params, trailing slash. Instagram URLs also strip tracking params.
 */
export function normalizeImportUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
     'igshid','igsh','hl','ref'].forEach(p => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return url; }
}

/**
 * Get a cached import result by URL.
 * Returns null if missing or expired (and deletes expired entry).
 */
export async function getCachedImport(url) {
  try {
    const key = normalizeImportUrl(url);
    const entry = await db.importCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > IMPORT_CACHE_TTL_MS) {
      await db.importCache.delete(key);
      return null;
    }
    return entry.result;
  } catch (e) {
    console.warn('[SpiceHub DB] importCache get failed:', e);
    return null;
  }
}

/**
 * Store a successful import result.
 * Only caches results with >= 2 ingredients and no error/manual-caption flags.
 */
export async function setCachedImport(url, result, provider = 'unknown') {
  if (!result || result._error || result._needsManualCaption) return;
  if (!result.ingredients || result.ingredients.length < 2) return;
  try {
    const key = normalizeImportUrl(url);
    await db.importCache.put({ url: key, result, fetchedAt: Date.now(), provider });
  } catch (e) {
    console.warn('[SpiceHub DB] importCache put failed:', e);
  }
}

/**
 * Delete all cache entries older than TTL. Call once on app start.
 */
export async function pruneStaleCacheEntries() {
  try {
    const cutoff = Date.now() - IMPORT_CACHE_TTL_MS;
    await db.importCache.where('fetchedAt').below(cutoff).delete();
  } catch (e) {
    console.warn('[SpiceHub DB] importCache prune failed:', e);
  }
}
```

- [ ] **Step 2: Add pruneStaleCacheEntries to App.jsx**

Open `src/App.jsx`. Find the first `useEffect` block — it's the one that calls `loadMeals()` and `loadDrinks()`.

Add `pruneStaleCacheEntries` to the import from `./db` (find the existing import line and add it):

```js
// Before (find this line and add pruneStaleCacheEntries to it):
import { ..., cacheInstagramRecipe } from './db';
// or whatever the current db import looks like — just add pruneStaleCacheEntries to it
```

Then inside the first `useEffect` callback, add one line after `loadMeals()`:

```js
useEffect(() => {
    loadMeals();
    loadDrinks();
    pruneStaleCacheEntries(); // prune stale import cache on startup
    // ... rest of the effect unchanged
```

- [ ] **Step 3: Verify db change**

Open the app in the browser (run `npm run dev` if not already running). Open DevTools → Application → IndexedDB → SpiceHubDB. Confirm a new `importCache` table appears (it may take one page refresh after the Dexie version upgrade).

- [ ] **Step 4: Commit**

```bash
git add src/db.js src/App.jsx
git commit -m "feat(cache): add general importCache table (Dexie v11) + prune on startup"
```

---

## Task 2: Vercel Proxy Upgrade

**Files:**
- Modify: `api/proxy.js`

### Context

`api/proxy.js` is a Vercel Edge Function (`export const config = { runtime: 'edge' }`). It currently handles one thing: fetch a URL with browser-like headers and return the response. We add:

1. **UA rotation** — cycles through 4 UAs every ~15 minutes instead of always using Chrome/Windows
2. **`?mode=instagram-oembed`** — calls Facebook Graph API oEmbed endpoint using `FB_APP_TOKEN` env var
3. **`?mode=instagram-json`** — calls `instagram.com/p/SHORTCODE/?__a=1&__d=dis` server-side
4. **`?mode=tiktok-oembed`** — calls TikTok's free public oEmbed endpoint

`FB_APP_TOKEN` is set in the Vercel dashboard as an environment variable. The proxy works without it — that mode just returns an error and the client falls through silently.

- [ ] **Step 1: Replace buildHeaders with UA rotation version**

In `api/proxy.js`, replace the `buildHeaders` function with this version that adds UA rotation:

```js
// Sites known to require special handling
const INSTAGRAM_HOST = /instagram\.com/i;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
];

function buildHeaders(targetUrl) {
  const isInsta = INSTAGRAM_HOST.test(targetUrl);
  // Rotate UA every ~15 minutes — breaks bot-wall fingerprinting
  const ua = USER_AGENTS[Math.floor(Date.now() / 900000) % USER_AGENTS.length];

  const base = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
  };

  if (isInsta) {
    base['Referer'] = 'https://www.instagram.com/';
    base['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    base['sec-ch-ua-mobile'] = '?0';
    base['sec-ch-ua-platform'] = '"Windows"';
  }

  return base;
}
```

- [ ] **Step 2: Add mode routing to the handler function**

In the `handler` function, add mode routing right after the URL validation block (before the existing `fetch(targetUrl, ...)` call). Insert this block:

```js
  // ── Mode routing: special server-side API calls ───────────────────────────
  const mode = searchParams.get('mode');

  if (mode === 'instagram-oembed') {
    const igUrl = searchParams.get('url');
    const token = typeof process !== 'undefined'
      ? process.env.FB_APP_TOKEN
      : (globalThis.FB_APP_TOKEN ?? null);
    if (!token) {
      return new Response(JSON.stringify({ error: 'oEmbed not configured' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const oEmbedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(igUrl)}&fields=html,thumbnail_url,author_name&access_token=${token}`;
      const resp = await fetch(oEmbedUrl);
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'instagram-json') {
    const shortcode = searchParams.get('shortcode');
    if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) {
      return new Response(JSON.stringify({ error: 'Invalid shortcode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    try {
      const jsonUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
      const resp = await fetch(jsonUrl, { headers: buildHeaders(jsonUrl) });
      const text = await resp.text();
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (mode === 'tiktok-oembed') {
    const ttUrl = searchParams.get('url');
    try {
      const oEmbedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(ttUrl)}`;
      const resp = await fetch(oEmbedUrl, {
        headers: { 'User-Agent': USER_AGENTS[0], 'Accept': 'application/json' },
      });
      const json = await resp.text();
      return new Response(json, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
  // ── End mode routing ────────────────────────────────────────────────────────
```

- [ ] **Step 3: Test modes locally**

With `npm run dev` running (Vite proxies `/api/*` to the local server), test:

```bash
# TikTok oEmbed (public, no token needed)
curl "http://localhost:5173/api/proxy?mode=tiktok-oembed&url=https%3A%2F%2Fwww.tiktok.com%2F%40username%2Fvideo%2F123"
# Expected: JSON with { error: ... } or { title, author_name, thumbnail_url }

# Instagram JSON (no auth)
curl "http://localhost:5173/api/proxy?mode=instagram-json&shortcode=ABC123"
# Expected: JSON (may be login wall HTML — that's fine, means it's reaching Instagram)

# UA rotation — run twice, 15 min apart (or just verify the code change looks right)
```

Note: in local dev, the Vite dev server may not run the Edge function exactly as Vercel does. The TikTok oEmbed test is the most reliable locally since it needs no auth.

- [ ] **Step 4: Commit**

```bash
git add api/proxy.js
git commit -m "feat(proxy): add mode routing (instagram-oembed, instagram-json, tiktok-oembed) + UA rotation"
```

---

## Task 3: API Fetcher Helpers (src/api.js)

**Files:**
- Modify: `src/api.js`

### Context

`src/api.js` is the client-side API utility module. It already exports `fetchHtmlViaProxy`, `isInstagramUrl`, `extractInstagramEmbed`, etc. We add three new thin fetcher functions that call the new proxy modes from Task 2. These will be imported by `recipeParser.js` in later tasks.

- [ ] **Step 1: Add three fetcher functions to src/api.js**

Add the following functions at the end of `src/api.js` (before the last export if there is one, otherwise just append):

```js
/**
 * Fetch Instagram oEmbed data via the Vercel proxy (uses FB_APP_TOKEN server-side).
 * Returns { html, thumbnail_url, author_name } or null on failure.
 */
export async function fetchInstagramOEmbed(url) {
  try {
    const proxyUrl = `/api/proxy?mode=instagram-oembed&url=${encodeURIComponent(url)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) {
      console.log('[fetchInstagramOEmbed] Not configured or error:', data.error);
      return null;
    }
    return data; // { html, thumbnail_url, author_name }
  } catch (e) {
    console.log('[fetchInstagramOEmbed] Failed:', e.message);
    return null;
  }
}

/**
 * Fetch Instagram post JSON via ?__a=1 endpoint (server-side via proxy).
 * Returns caption string or null. Works ~60% of the time.
 * @param {string} shortcode - Instagram post shortcode (e.g. 'ABC123xyz')
 */
export async function fetchInstagramJson(shortcode) {
  try {
    const proxyUrl = `/api/proxy?mode=instagram-json&shortcode=${encodeURIComponent(shortcode)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const text = await resp.text();
    // Try to parse as JSON
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    // Extract caption from known JSON paths (Instagram changes these occasionally)
    const caption =
      data?.graphql?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      data?.items?.[0]?.caption?.text ||
      data?.data?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      null;
    return caption && caption.length > 15 ? caption : null;
  } catch (e) {
    console.log('[fetchInstagramJson] Failed:', e.message);
    return null;
  }
}

/**
 * Fetch TikTok oEmbed data (public endpoint, no auth required).
 * Returns { title, author_name, thumbnail_url } or null on failure.
 */
export async function fetchTikTokOEmbed(url) {
  try {
    const proxyUrl = `/api/proxy?mode=tiktok-oembed&url=${encodeURIComponent(url)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) return null;
    return data; // { title, author_name, thumbnail_url, ... }
  } catch (e) {
    console.log('[fetchTikTokOEmbed] Failed:', e.message);
    return null;
  }
}
```

- [ ] **Step 2: Verify with a quick console test**

In browser DevTools console (with `npm run dev` running):

```js
// Import and test TikTok oEmbed (paste a real TikTok URL you want to test)
const { fetchTikTokOEmbed } = await import('/src/api.js');
const result = await fetchTikTokOEmbed('https://www.tiktok.com/@cookingwithshereen/video/7123456789');
console.log(result);
// Expected: { title: '...', author_name: '...', thumbnail_url: '...' } or null
```

- [ ] **Step 3: Commit**

```bash
git add src/api.js
git commit -m "feat(api): add fetchInstagramOEmbed, fetchInstagramJson, fetchTikTokOEmbed helpers"
```

---

## Task 4: Instagram Pipeline Reorder (src/recipeParser.js)

**Files:**
- Modify: `src/recipeParser.js` (Python binary edits only — see encoding warning at top)

### Context

`importFromInstagram` currently runs:
- Phase 0: skip (yt-dlp removed)
- Phase 1: embed scrape via CORS proxy
- Phase 2: skip (AI browser removed)
- Phase 3: Gemini structuring

We insert two new attempts before Phase 1 (the embed scrape), and add third-party viewer URLs as a fallback within Phase 1 logic. All new attempts report into the **Phase 1 progress slot** (`progress(1, ...)`) so the UI shows "Caption fetch" for all of them.

We also add cache read at the top and cache write at all successful return points.

The function signature is: `export async function importFromInstagram(url, onProgress = () => {}, { type = 'meal' } = {})`

It imports from `'./api.js'` — we need to add `fetchInstagramOEmbed`, `fetchInstagramJson` to that import.

It imports from `'./db.js'` — we need to add `getCachedImport`, `setCachedImport` to that import.

`extractInstagramShortcode` is already defined in `api.js` and available via `fetchHtmlViaProxyFromApi` alias chain.

- [ ] **Step 1: Update imports in recipeParser.js**

Use Python to update the import lines:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Update api.js import to add new fetchers
# Find the existing import from api.js
old_api_import = b"import { downloadInstagramImage, isInstagramCdnUrl, fetchHtmlViaProxy as fetchHtmlViaProxyFromApi, downloadImageAsDataUrl } from './api.js';"
new_api_import = b"import { downloadInstagramImage, isInstagramCdnUrl, fetchHtmlViaProxy as fetchHtmlViaProxyFromApi, downloadImageAsDataUrl, fetchInstagramOEmbed, fetchInstagramJson, fetchTikTokOEmbed, isInstagramUrl, isTikTokUrl as _isTikTokUrl } from './api.js';"

# Update db.js import to add cache helpers
old_db_import = b"import { cacheInstagramRecipe } from './db.js';"
new_db_import = b"import { cacheInstagramRecipe, getCachedImport, setCachedImport } from './db.js';"

data = data.replace(old_api_import, new_api_import)
data = data.replace(old_db_import, new_db_import)

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done. Verify with grep.')
```

Verify:
```bash
python3 -c "
with open('src/recipeParser.js','rb') as f: d=f.read()
print('fetchInstagramOEmbed imported:', b'fetchInstagramOEmbed' in d)
print('getCachedImport imported:', b'getCachedImport' in d)
"
```

- [ ] **Step 2: Add cache check + new phases to importFromInstagram**

The current function opens with:

```js
async function importFromInstagram(url, onProgress = () => {}, { type = 'meal' } = {}) {
  const progress = (phase, status, msg) => onProgress(phase, status, msg);
```

After that comes the PLACEHOLDERS block and variable declarations. We insert the cache check and new phases using Python.

Find the anchor `b"progress(0, 'skipped', 'Server unavailable -- using embed + AI');"` — this is the end of Phase 0. We insert the new Phase 0.5 + 0.75 block right after it, before Phase 1 begins.

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# The anchor is the Phase 0 skip call — insert cache check BEFORE it
# and new server phases AFTER it
phase0_skip = b"progress(0, 'skipped', 'Server unavailable -- using embed + AI');"

# New block to insert BEFORE phase0_skip (cache check)
cache_check = b"""
  // -- Cache check: return instantly if we've imported this URL recently --
  const cachedResult = await getCachedImport(url);
  if (cachedResult) {
    console.log('[importFromInstagram] Cache hit for:', url);
    progress(1, 'done', 'Loaded from cache');
    progress(3, 'done', 'Recipe from cache');
    return cachedResult;
  }

"""

# New block to insert AFTER phase0_skip (oEmbed + JSON phases)
new_phases = b"""

  // -- Phase 0.5: Instagram oEmbed API (official, server-side, most reliable) --
  progress(1, 'running', 'Fetching via Instagram API...');
  try {
    const oEmbedData = await fetchInstagramOEmbed(url);
    if (oEmbedData?.html) {
      // Mine the embed HTML for caption using existing patterns
      const { extractInstagramEmbed: _ext } = await import('./api.js').catch(() => ({}));
      // Parse caption out of the oEmbed HTML directly
      const oEmbedCaption = (() => {
        const html = oEmbedData.html;
        // Standard caption pattern in oEmbed HTML
        const patterns = [
          /<p[^>]*class="[^"]*[Cc]aption[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
          /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i,
        ];
        for (const re of patterns) {
          const m = re.exec(html);
          if (m?.[1]) {
            return m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&')
              .replace(/&#39;/g,"'").replace(/&quot;/g,'"')
              .replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();
          }
        }
        // Fallback: strip all tags
        return html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
      })();
      if (oEmbedCaption && oEmbedCaption.length > 20) {
        capturedCaption = cleanSocialCaption(oEmbedCaption);
        if (oEmbedData.thumbnail_url) capturedImageUrl = oEmbedData.thumbnail_url;
        if (capturedCaption && !isCaptionWeak(capturedCaption)) {
          progress(1, 'done', 'Caption found via API');
          progress(2, 'skipped', 'Not available');
          // Fall through to Phase 3
        } else {
          progress(1, 'done', 'Thin caption via API - trying more sources');
        }
      }
    }
  } catch (e) {
    console.log('[importFromInstagram] oEmbed failed:', e.message);
  }

  // -- Phase 0.75: Instagram ?__a=1 JSON endpoint (server-side, no auth) --
  if (!capturedCaption || isCaptionWeak(capturedCaption)) {
    try {
      const shortcode = url.match(/(?:\/p\/|\/reel\/|\/tv\/)([A-Za-z0-9_-]+)/)?.[1];
      if (shortcode) {
        const jsonCaption = await fetchInstagramJson(shortcode);
        if (jsonCaption && jsonCaption.length > capturedCaption.length) {
          capturedCaption = cleanSocialCaption(jsonCaption);
          progress(1, 'done', capturedCaption && !isCaptionWeak(capturedCaption)
            ? 'Caption found via JSON endpoint'
            : 'Thin caption via JSON - trying embed');
        }
      }
    } catch (e) {
      console.log('[importFromInstagram] JSON fetch failed:', e.message);
    }
  }

"""

# Insert cache check before Phase 0
insertion_point = data.find(phase0_skip)
if insertion_point == -1:
    print('ERROR: Could not find phase0_skip anchor')
else:
    data = data[:insertion_point] + cache_check + data[insertion_point:]
    # Now find phase0_skip again (offset shifted) and insert new phases after it
    insertion_point2 = data.find(phase0_skip) + len(phase0_skip)
    data = data[:insertion_point2] + new_phases + data[insertion_point2:]
    with open('src/recipeParser.js', 'wb') as f:
        f.write(data)
    print('Done.')
```

- [ ] **Step 3: Add third-party viewer URLs to Phase 1 embed logic**

Currently Phase 1 only tries `extractInstagramEmbed(url)` which hits the embed page via CORS proxy. We add viewer URL fallbacks. Find the anchor `b"progress(1, 'running', 'Fetching Instagram caption...');"` and insert viewer logic after a successful embed attempt fails.

Use Python to find the Phase 1 running block and insert the viewer fallback array before the `extractInstagramEmbed(url)` call:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Only add viewer fallback if caption is still weak/missing when we reach Phase 1
# Find the Phase 1 try block anchor
old_phase1 = b"progress(1, 'running', 'Fetching Instagram caption...');\n    try {\n      const embedData = await extractInstagramEmbed(url);"
new_phase1 = b"""progress(1, 'running', 'Fetching Instagram caption...');

    // Third-party viewer fallback — try these before the embed page
    // These sites cache Instagram content and are not CORS-blocked like instagram.com
    if (!capturedCaption || isCaptionWeak(capturedCaption)) {
      const shortcode = url.match(/(?:\\/p\\/|\\/reel\\/|\\/tv\\/)([A-Za-z0-9_-]+)/)?.[1];
      if (shortcode) {
        const VIEWER_URLS = [
          `https://imginn.com/p/${shortcode}/`,
          `https://picuki.com/media/${shortcode}`,
        ];
        for (const viewerUrl of VIEWER_URLS) {
          try {
            const html = await fetchHtmlViaProxyFromApi(viewerUrl, 12000);
            if (!html || html.length < 2000) continue;
            // Extract caption using same patterns as extractInstagramEmbed
            const captionPatterns = [
              /<div\\s+class="[^"]*[Cc]aption[^"]*"[^>]*>([\\s\\S]*?)<\\/div>/i,
              /<p\\s+class="[^"]*[Cc]aption[^"]*"[^>]*>([\\s\\S]*?)<\\/p>/i,
              /"caption"\\s*:\\s*"((?:[^"\\\\]|\\\\.){20,})"/,
            ];
            let viewerCaption = '';
            for (const re of captionPatterns) {
              const m = re.exec(html);
              if (m?.[1]) {
                viewerCaption = m[1].replace(/<[^>]+>/g, ' ')
                  .replace(/&amp;/g,'&').replace(/&#39;/g,"'")
                  .replace(/\\s+/g,' ').trim();
                if (viewerCaption.length > 20) break;
              }
            }
            if (viewerCaption.length > capturedCaption.length) {
              capturedCaption = cleanSocialCaption(viewerCaption);
              console.log('[importFromInstagram] Viewer caption from:', viewerUrl);
              if (!isCaptionWeak(capturedCaption)) break;
            }
          } catch { /* try next viewer */ }
        }
      }
    }

    try {
      const embedData = await extractInstagramEmbed(url);"""

data = data.replace(old_phase1, new_phase1)
if old_phase1 not in open('src/recipeParser.js','rb').read():
    with open('src/recipeParser.js','wb') as f:
        f.write(data)
    print('Done.')
else:
    print('ERROR: replacement failed - old string still present')
```

- [ ] **Step 4: Add cache writes at all return points in importFromInstagram**

Find the function's successful return statements and add `await setCachedImport(url, result, 'instagram-...')` before each `return`. The function currently has these return points (search for `return {` within the function):

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find and update the main successful structured return
# The Gemini-structured result return looks like:
old_return = b"return { ...merged, imageUrl: capturedImageUrl || merged.imageUrl, extractedVia: 'yt-dlp', sourceUrl"
new_return = b"await setCachedImport(url, { ...merged, imageUrl: capturedImageUrl || merged.imageUrl, extractedVia: 'instagram', sourceUrl: url }, 'instagram'); return { ...merged, imageUrl: capturedImageUrl || merged.imageUrl, extractedVia: 'yt-dlp', sourceUrl"

data = data.replace(old_return, new_return, 1)

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done.')
```

Note: The cache write pattern is `await setCachedImport(url, resultObject, providerLabel)` before every non-error return. Review the complete return points after the above script and add cache writes to any remaining `return { ... }` blocks that represent a successfully structured recipe (not `_needsManualCaption` or `_error` returns — those are already excluded by `setCachedImport`'s guard clause).

- [ ] **Step 5: Verify**

```bash
python3 -c "
with open('src/recipeParser.js','rb') as f: d=f.read()
print('Cache check present:', b'getCachedImport' in d)
print('oEmbed phase present:', b'fetchInstagramOEmbed' in d)
print('JSON phase present:', b'fetchInstagramJson' in d)
print('Viewer URLs present:', b'imginn.com' in d)
print('Cache write present:', b'setCachedImport' in d)
"
```

- [ ] **Step 6: Commit**

```bash
git add src/recipeParser.js
git commit -m "feat(instagram): add oEmbed, JSON, and viewer-URL phases to importFromInstagram"
```

---

## Task 5: TikTok Pipeline

**Files:**
- Modify: `src/recipeParser.js` (Python binary edits only)
- Modify: `src/api.js`

### Context

TikTok URLs currently fall through to BrowserAssist manual paste with no extraction attempt. We add:

1. `isTikTokUrl(url)` — exported from `src/api.js`
2. `importFromTikTok(url, onProgress)` — exported from `src/recipeParser.js`
3. Routing in `importRecipeFromUrl` — checks TikTok before the general path

The TikTok oEmbed endpoint (`tiktok.com/oembed`) returns a `title` field that food creators typically use for the recipe name and ingredient summary. We feed that into `structureWithAIClient` (Gemini) to produce a structured recipe.

- [ ] **Step 1: Add isTikTokUrl to src/api.js**

Append to `src/api.js`:

```js
/**
 * Returns true if the URL is a TikTok video URL.
 */
export function isTikTokUrl(url) {
  return /tiktok\.com/i.test(url);
}
```

- [ ] **Step 2: Add importFromTikTok to recipeParser.js**

Use Python to append the new function before the closing of the file, or right after `importFromInstagram` ends. Find the byte offset where `importFromInstagram` ends:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find end of importFromInstagram by locating the next top-level async function
ig_start = data.find(b'export async function importFromInstagram')
next_fn = data.find(b'\nexport async function ', ig_start + 1)
if next_fn == -1:
    next_fn = data.find(b'\nexport function ', ig_start + 1)

new_tiktok_fn = b"""
/**
 * Import a recipe from a TikTok URL.
 *
 * Contract:
 *   1. TikTok oEmbed (server-side) -> title + thumbnail
 *   2. Gemini structures title text into a recipe schema
 *   3. If Gemini can't find ingredients -> _needsManualCaption: true
 *
 * @param {string} url - TikTok video URL
 * @param {Function} onProgress - (message: string) => void
 * @param {object} opts
 * @returns {Promise<object>} RecipeResult or { _needsManualCaption: true }
 */
export async function importFromTikTok(url, onProgress = () => {}, { type = 'meal' } = {}) {
  console.log('[importFromTikTok] Starting for:', url);

  // Cache check
  const cached = await getCachedImport(url);
  if (cached) {
    onProgress('Loaded from cache');
    return cached;
  }

  onProgress('Fetching TikTok video info...');
  let title = '';
  let authorName = '';
  let thumbnailUrl = '';

  try {
    const oEmbed = await fetchTikTokOEmbed(url);
    if (oEmbed) {
      title = oEmbed.title || '';
      authorName = oEmbed.author_name || '';
      thumbnailUrl = oEmbed.thumbnail_url || '';
      console.log('[importFromTikTok] oEmbed title:', title.slice(0, 80));
    }
  } catch (e) {
    console.log('[importFromTikTok] oEmbed failed:', e.message);
  }

  if (!title || title.length < 5) {
    onProgress('Could not fetch TikTok info - paste caption manually');
    return { _needsManualCaption: true, sourceUrl: url };
  }

  onProgress('Structuring recipe with AI...');
  const seedText = authorName
    ? `TikTok recipe by @${authorName}: ${title}`
    : `TikTok recipe: ${title}`;

  try {
    const structured = await structureWithAIClient(seedText, {
      imageUrl: thumbnailUrl,
      sourceUrl: url,
      type,
    });

    if (structured && (structured.ingredients?.length >= 2 || structured.directions?.length >= 2)) {
      const result = {
        ...structured,
        imageUrl: thumbnailUrl || structured.imageUrl,
        link: url,
        _extractedVia: 'tiktok-oembed+gemini',
      };
      await setCachedImport(url, result, 'tiktok-oembed');
      onProgress('Recipe structured!');
      return result;
    }
  } catch (e) {
    console.log('[importFromTikTok] Gemini failed:', e.message);
  }

  // Gemini couldn't structure it - return skeleton so user can paste caption
  onProgress('AI could not structure recipe - paste caption to complete');
  return {
    name: title.slice(0, 80),
    imageUrl: thumbnailUrl,
    ingredients: [],
    directions: [],
    link: url,
    _needsManualCaption: true,
    _extractedVia: 'tiktok-oembed',
    sourceUrl: url,
  };
}

"""

# Insert before the next top-level function after importFromInstagram
data = data[:next_fn] + new_tiktok_fn + data[next_fn:]

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done. importFromTikTok inserted.')
```

- [ ] **Step 3: Add TikTok routing in importRecipeFromUrl**

`importRecipeFromUrl` currently has this order:
1. Reddit check
2. Instagram check
3. General path

Add TikTok check between Instagram and general. Use Python to find the Instagram block end and insert TikTok block:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find the anchor at the end of the Instagram block in importRecipeFromUrl
# The Instagram block ends with routing to BrowserAssist
anchor = b"console.log('[SpiceHub] Instagram extraction failed  -  routing to BrowserAssist');\n    return null;\n  }"

tiktok_routing = b"""console.log('[SpiceHub] Instagram extraction failed  -  routing to BrowserAssist');
    return null;
  }

  // -- TikTok: oEmbed + Gemini structuring --
  if (/tiktok\\.com/i.test(url)) {
    console.log('[SpiceHub] TikTok URL  -  trying oEmbed extraction...');
    if (onProgress) onProgress('Fetching TikTok recipe...');
    const tikResult = await importFromTikTok(url, onProgress, { type });
    if (tikResult && !tikResult._error) return tikResult;
    return null; // BrowserAssist fallback
  }"""

data = data.replace(anchor, tiktok_routing, 1)

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done.')
```

Also add `importFromTikTok` and `fetchTikTokOEmbed` to the internal imports if not already present (they should be from Task 4's import update, but verify):

```bash
python3 -c "
with open('src/recipeParser.js','rb') as f: d=f.read()
print('fetchTikTokOEmbed imported:', b'fetchTikTokOEmbed' in d)
print('importFromTikTok defined:', b'async function importFromTikTok' in d)
print('TikTok routing in importRecipeFromUrl:', b'tiktok\\\\.com' in d)
"
```

- [ ] **Step 4: Commit**

```bash
git add src/api.js src/recipeParser.js
git commit -m "feat(tiktok): add isTikTokUrl, importFromTikTok pipeline (oEmbed + Gemini)"
```

---

## Task 6: Wayback CDX Fallback + General Cache Integration

**Files:**
- Modify: `src/recipeParser.js` (Python binary edits only)

### Context

For non-social recipe blog URLs, we add:
1. Cache check at the top of `importRecipeFromUrl` (for repeat blog imports)
2. Wayback Machine CDX fallback when all proxy attempts return empty/bot-wall

The CDX API endpoint is `https://archive.org/wayback/available?url=URL` — it's CORS-accessible, requires no auth, and returns a JSON object indicating whether a snapshot exists and what URL to use.

- [ ] **Step 1: Add cache check to importRecipeFromUrl**

Find the top of `importRecipeFromUrl` right after its opening signature. Use Python:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find the function opening
fn_open = b"async function importRecipeFromUrl(url, onProgress, { type = 'meal' } = {}) {"

# Insert cache check right after the opening line
cache_check_blog = b"""async function importRecipeFromUrl(url, onProgress, { type = 'meal' } = {}) {

  // Cache check -- return instantly for any previously imported URL
  try {
    const cached = await getCachedImport(url);
    if (cached) {
      console.log('[importRecipeFromUrl] Cache hit:', url);
      if (onProgress) onProgress('Loaded from cache');
      return cached;
    }
  } catch { /* cache miss, continue */ }

"""

data = data.replace(fn_open, cache_check_blog, 1)

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done.')
```

- [ ] **Step 2: Add tryWaybackFallback function**

Use Python to insert the Wayback helper function right before `importRecipeFromUrl`:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

wayback_fn = b"""
/**
 * Fallback: check Wayback Machine CDX for a cached version of the URL.
 * Only fires when all proxy attempts have failed.
 * The CDX API is CORS-accessible and returns quickly (~200ms).
 * @returns {object|null} Parsed recipe or null
 */
async function tryWaybackFallback(url) {
  try {
    const cdxResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!cdxResp.ok) return null;
    const cdx = await cdxResp.json();
    const snapshot = cdx?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) return null;
    console.log('[tryWaybackFallback] Found snapshot:', snapshot.url);
    const archiveHtml = await fetchHtmlViaProxyFromApi(snapshot.url, 20000);
    if (!archiveHtml || archiveHtml.length < 3000) return null;
    return parseHtml(archiveHtml, url);
  } catch (e) {
    console.log('[tryWaybackFallback] Failed:', e.message);
    return null;
  }
}

"""

# Insert before importRecipeFromUrl
fn_start = data.find(b'async function importRecipeFromUrl')
data = data[:fn_start] + wayback_fn + data[fn_start:]

with open('src/recipeParser.js', 'wb') as f:
    f.write(data)
print('Done.')
```

- [ ] **Step 3: Wire Wayback into importRecipeFromUrl for blog URLs**

Find the end of the general CORS proxy block in `importRecipeFromUrl` — where it currently returns null or falls to BrowserAssist after all proxies fail. Look for the pattern where the function gives up on a blog URL (near `return null` after CORS proxy attempts).

The exact location varies — use Python to find and insert:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find the CORS proxy failure return in the general path
# This is approximately: "// All proxies failed" or similar comment before final return
# Search for the last-resort CORS failure pattern
anchor = b"// Fallback: CORS proxy (sometimes works for public pages)"
if anchor in data:
    # Insert Wayback attempt before this fallback comment
    wayback_call = b"""// Wayback Machine CDX fallback for recipe blogs (fires after proxy failure)
  if (!isInstagramUrl(url) && !/tiktok\\.com/i.test(url) && !/reddit\\.com/i.test(url)) {
    if (onProgress) onProgress('Trying archived version...');
    const waybackResult = await tryWaybackFallback(url);
    if (waybackResult && !waybackResult._error) {
      await setCachedImport(url, waybackResult, 'wayback');
      return waybackResult;
    }
  }

  // Fallback: CORS proxy (sometimes works for public pages)"""
    data = data.replace(anchor, wayback_call, 1)
    with open('src/recipeParser.js', 'wb') as f:
        f.write(data)
    print('Done.')
else:
    print('Anchor not found - search manually for insertion point')
    # Print surrounding context
    import re
    for m in re.finditer(rb'.{0,50}CORS proxy.{0,50}', data):
        print(m.group().decode('utf-8', errors='replace'))
```

- [ ] **Step 4: Add cache write to general blog import success paths**

In `importRecipeFromUrl`, find the return points that represent successfully parsed blog recipes (places that return a non-null recipe object). Add `await setCachedImport(url, result, 'blog')` before each. The general pattern to search for is `return recipe` or `return { ...` in the non-social code path. 

Use Python to inspect and add cache writes:

```python
with open('src/recipeParser.js', 'rb') as f:
    data = f.read()

# Find importRecipeFromUrl boundaries
fn_start = data.find(b'async function importRecipeFromUrl')
# Find next exported async function after it
import re
next_fns = [m.start() for m in re.finditer(rb'\nexport async function ', data[fn_start+1:])]
fn_end = fn_start + 1 + next_fns[0] if next_fns else len(data)

fn_body = data[fn_start:fn_end]
print('Return statements in importRecipeFromUrl:')
for m in re.finditer(rb'return [^\n]{0,100}', fn_body):
    print(' ', m.group().decode('utf-8', errors='replace')[:100])
```

Review the output. For each `return recipeObject` that represents a successfully parsed recipe (not `null`, not `_needsManualCaption`), add a `await setCachedImport(url, recipeObject, 'blog')` call before it.

- [ ] **Step 5: Verify**

```bash
python3 -c "
with open('src/recipeParser.js','rb') as f: d=f.read()
print('tryWaybackFallback defined:', b'async function tryWaybackFallback' in d)
print('wayback wired in:', b'tryWaybackFallback(url)' in d)
print('blog cache check:', b'getCachedImport(url)' in d)
"
```

Run the app and try importing a recipe blog URL. Open DevTools console and confirm `[importRecipeFromUrl] Cache hit:` appears on the second import of the same URL.

- [ ] **Step 6: Commit**

```bash
git add src/recipeParser.js
git commit -m "feat(import): add Wayback CDX fallback + general importCache integration for all URL types"
```

---

## Self-Review Checklist

- [ ] Spec Section 1 (IndexedDB cache) → Task 1 ✅
- [ ] Spec Section 2 (Vercel proxy upgrade) → Task 2 ✅
- [ ] Spec Section 3 (Instagram pipeline reorder) → Task 4 ✅
- [ ] Spec Section 4 (TikTok pipeline) → Task 5 ✅
- [ ] Spec Section 5 (Wayback CDX fallback) → Task 6 ✅
- [ ] API fetcher helpers → Task 3 ✅
- [ ] UA rotation → Task 2 Step 1 ✅
- [ ] `FB_APP_TOKEN` env var → Task 2 Step 2 (proxy reads it server-side) ✅
- [ ] App.jsx prune call → Task 1 Step 2 ✅
- [ ] Cache write on all success paths → Task 4 Step 4 + Task 6 Step 4 ✅
- [ ] No regressions to ImportModal / BrowserAssist → only recipeParser.js + api.js + db.js + proxy changed ✅

### Type/Name Consistency
- `getCachedImport` defined in Task 1, used in Tasks 4, 5, 6 ✅
- `setCachedImport` defined in Task 1, used in Tasks 4, 5, 6 ✅
- `fetchInstagramOEmbed` defined in Task 3, imported in Task 4 ✅
- `fetchInstagramJson` defined in Task 3, imported in Task 4 ✅
- `fetchTikTokOEmbed` defined in Task 3, used in Task 5 ✅
- `importFromTikTok` defined in Task 5, called in routing in Task 5 ✅
- `tryWaybackFallback` defined in Task 6, called in Task 6 ✅
- `structureWithAIClient` — this is the actual function name in recipeParser.js (NOT `structureWithAI`) ✅

### Encoding Warning Compliance
Tasks 4, 5, 6 all use Python binary manipulation — no direct Edit tool calls on recipeParser.js ✅
