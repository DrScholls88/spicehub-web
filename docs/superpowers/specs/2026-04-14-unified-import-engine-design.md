# Unified Import Engine — Design Spec

**Status:** Ready for implementation
**Date:** 2026-04-14
**Owner:** Brian
**Related:** `CLAUDE.md` (SpiceHub Constitution), `UNIFIED_IMPORT_ENGINE_PROMPT.md`

## 1. Goal

Replace the current synchronous, Gemini-heavy URL-import pipeline with an asynchronous "skill waterfall" that:

1. Closes the Import modal in under 300ms and surfaces a **Ghost Recipe** card immediately.
2. Uses zero-cost local extraction (`recipe-scrapers`) before falling back to paid AI.
3. Makes Instagram import reliable via `playwright-stealth` with session cookies.
4. Persists Instagram CDN images as Base64 so they never 403 later.
5. Pulls a strong thumbnail from Reels by grabbing a frame ~75% through the video.

The terminal UX contract: **"You share a Reel → the modal disappears → a card appears in the list → 5–90 seconds later it populates with a real recipe."** Zero user waiting on foregrounded spinners.

## 2. Scope

### In scope

- Dexie schema v9: `status`, `sourceHash`, `jobId` fields on `meals`.
- `ImportModal.jsx` URL path: optimistic Ghost Recipe insertion, sub-300ms modal close.
- `importWorker.js`: React hook polling Dexie `processing` rows against the Render backend.
- `POST /api/v2/import` and `GET /api/v2/import/status/:jobId` on the Node server.
- In-memory job store on Node with 10-minute TTL.
- Python worker `metadata_pass.py` using `recipe-scrapers`.
- Python worker `instagram_stealth_fetch.py` using `playwright-stealth` + cookies from env.
- Video frame extraction via Playwright canvas draw for Reels.
- Base64 image persistence on the backend; client-side compression before Dexie write.
- Strict-waterfall coordinator: `metadata_pass` → `instagram_stealth_fetch` → `recipe_structurer` (Gemini).
- Feature flag rollout.

### Out of scope (follow-up specs)

- Client-side Tesseract OCR integration into the waterfall.
- TikTok / Facebook / YouTube stealth workers.
- `recipeParser.js` decomposition (the 3778-line file stays; we adapt it, don't refactor).
- Image-tab, paste-text, spreadsheet, Paprika import path migration to the v2 engine.
- `yt-dlp` subtitle-based extraction changes.
- EasyOCR or any paid-tier server-side vision.

## 3. System Architecture

```
┌──────────────────────────── Pixel 7 Pro (Vercel) ─────────────────────────────┐
│                                                                                 │
│   ImportModal.jsx  ──[1. POST /api/v2/import]──►  Render (Node)                │
│        │                                                                        │
│        │ 2. Insert Ghost Recipe in Dexie                                        │
│        ▼                                                                        │
│   Dexie.meals  (status='processing', jobId, sourceHash, placeholder fields)    │
│        │                                                                        │
│        ▼                                                                        │
│   importWorker.js  (hook, mounted once in App.jsx)                              │
│        │                                                                        │
│        └─[3. GET /api/v2/import/status/:jobId every 2s]──►  Render (Node)      │
│                         ▲                                                       │
│                         │ 4. final payload (recipe + Base64 image)             │
└─────────────────────────┼───────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────── Render (Node orchestrator) ────────────┐
│                         │                                                       │
│   /api/v2/import        │──► jobStore: Map<jobId, JobState>  (10-min TTL)      │
│        │                │                                                       │
│        ▼ (async background)                                                     │
│   Coordinator ──spawn──► python/metadata_pass.py       ◄── recipe-scrapers     │
│        │       (stdin JSON, stdout JSON)                                        │
│        │                                                                        │
│        │  if metadata.confidence >= 0.9 → finalize                              │
│        │  else if isInstagramUrl(url):                                          │
│        ▼                                                                        │
│   Coordinator ──spawn──► python/instagram_stealth_fetch.py                      │
│                 (env IG_COOKIES_JSON_B64)                                       │
│                 (output: {caption, imageUrls[]})                                │
│        │                                                                        │
│        ▼                                                                        │
│   persistImage (Node fetch of CDN URLs → Base64 data URLs; no resize)          │
│        │                                                                        │
│        ▼                                                                        │
│   recipe_structurer (Node + Gemini, existing code adapted)                      │
│        │                                                                        │
│        ▼                                                                        │
│   jobStore.put(jobId, {status: 'done', result})                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key invariant:** Dexie is the source of truth for recipes. The server-side `jobStore` is soft state — if a poll returns 404 (Render restart), the client re-POSTs the same `jobId` idempotently.

## 4. Phase 1 — Ghost Recipe UI & Dexie Schema

### 4.1 Dexie schema v9

```js
// src/db.js
db.version(9).stores({
  meals: '++id, name, status, sourceHash, jobId',
});
```

Additive migration. Legacy rows have `status === undefined` and are default-coerced to `'done'` on read. The existing `importQueue` table stays for backward-compat but is no longer written to by the new path.

### 4.2 Meal row shape during import

```ts
type MealRow = {
  id: number;                // Dexie-assigned
  status: 'processing' | 'done' | 'failed';
  name: string;              // 'Importing from instagram.com…' while processing
  sourceHash: string;        // sha256(sourceUrl || rawSource)
  jobId: string;             // stable across retries
  sourceUrl?: string;
  rawSource?: string;
  importProgress?: string;   // e.g. 'Fetching caption…'
  importError?: string;
  createdAt: string;         // ISO
  // Once status='done', populated from server response:
  ingredients?: string[];
  directions?: string[];
  imageUrl?: string;         // compressed Base64 data URL
  link?: string;
  // …existing meal fields
};
```

**Default-coerce on read:** every meal card / list renderer treats `status === undefined` as `'done'`. Helper in `src/db.js`: `export const mealStatus = (m) => m?.status ?? 'done';`.

### 4.3 `ImportModal.jsx` URL-tab rewrite

```js
async function handleUrlImport() {
  const cleanUrl = normalizeInstagramUrl(url);
  const sourceHash = await sha256(cleanUrl);

  const existing = await db.meals.where('sourceHash').equals(sourceHash).first();
  if (existing) {
    onImport([existing]);
    onClose();
    return;
  }

  const jobId = crypto.randomUUID();
  const ghostId = await db.meals.add({
    status: 'processing',
    name: `Importing from ${hostname(cleanUrl)}…`,
    sourceHash, jobId, sourceUrl: cleanUrl,
    importProgress: 'Queued',
    createdAt: new Date().toISOString(),
  });

  fetch(`${API_BASE}/api/v2/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, url: cleanUrl, sourceHash }),
  }).catch(() => { /* importWorker will retry */ });

  onImport([{ id: ghostId }]);
  onClose();  // <300ms target
}
```

The existing synchronous `handleUrlImport` stays in the file behind `VITE_USE_V2_IMPORT` flag for fast rollback. Image, paste, spreadsheet, and Paprika tabs keep their current synchronous behavior.

### 4.4 `importWorker.js` — polling hook

New file: `src/importWorker.js`. Mounted once at the top of `App.jsx` via `useImportWorker()`.

```js
export function useImportWorker() {
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      const processing = await db.meals.where('status').equals('processing').toArray();
      if (processing.length > 0) await Promise.all(processing.map(pollOne));
      setTimeout(tick, processing.length > 0 ? 2000 : 15000);
    }
    tick();
    return () => { cancelled = true; };
  }, []);
}

async function pollOne(meal) {
  try {
    const r = await fetch(`${API_BASE}/api/v2/import/status/${meal.jobId}`);
    if (r.status === 404) {
      // Re-enqueue idempotently
      await fetch(`${API_BASE}/api/v2/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: meal.jobId, url: meal.sourceUrl, sourceHash: meal.sourceHash }),
      });
      return;
    }
    const job = await r.json();
    if (job.status === 'done') {
      const cleaned = {
        ...job.result,
        name: sanitizeRecipeTitle(job.result.name || ''),        // client-only sanitize
        imageUrl: await compressDataUrl(job.result.imageUrl),     // client-side resize
        status: 'done',
        importProgress: '',
      };
      await db.meals.update(meal.id, cleaned);
    } else if (job.status === 'failed') {
      await db.meals.update(meal.id, { status: 'failed', importError: job.error });
    } else {
      await db.meals.update(meal.id, { importProgress: job.progress });
    }
  } catch { /* next tick retries */ }
}
```

`sanitizeRecipeTitle` is imported from `src/recipeParser.js` (already exported). `compressDataUrl` delegates to the existing `src/imageCompressor.js` (max 1600px long edge, JPEG 0.82); on failure returns the input unchanged.

### 4.5 Ghost card visuals

Three states in `MealLibrary.jsx` / `WeekView.jsx` / anywhere meal cards render:

- **processing** — shimmering gradient overlay on the card, `importProgress` text centered, no cook/edit actions, generic spinner where the photo would go.
- **failed** — red left border, `importError` message, two buttons: "Retry" (generates a **new** `jobId` via `crypto.randomUUID()`, writes it to the row, resets `status='processing'`, re-POSTs with the new jobId — this bypasses a cached `failed` state in the server-side `jobStore`) and "Paste Manually" (opens `ImportModal` on the paste tab with URL pre-filled).
- **done** — indistinguishable from a normal meal card.

### 4.6 Failure modes handled by Phase 1

| Scenario | Behavior |
|---|---|
| Network drops mid-poll | Next tick retries; no visible error. |
| Render restart drops jobStore | Poll returns 404; client re-POSTs; waterfall runs again. |
| App force-quit mid-import | On next launch, worker finds `processing` row and resumes polling. |
| Duplicate import of same URL | `sourceHash` dedupe: existing row surfaced instead of creating a new ghost. |
| Backend returns `failed` | Card shows Retry / Paste Manually. |

## 5. Phase 2 — Skill Orchestrator (Backend)

### 5.0 Helpers required on the server

Two small utilities live in `server/util.js`:

- `isInstagramUrl(url)` — mirror of the client-side helper from `src/api.js` (host check for `instagram.com`). Used by the coordinator to gate the stealth step.
- `sha256(str)` on the **client** uses Web Crypto: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))` returning a lowercase hex string. No Node-side sha256 is needed — `sourceHash` is computed in the browser.

### 5.1 New endpoints on `server/index.js`

```
POST /api/v2/import
  body: { jobId, url, sourceHash }
  202: { jobId, status: 'queued' }
  Idempotent: existing jobId returns current state.

GET /api/v2/import/status/:jobId
  200: { jobId, status, progress, result?, error?, updatedAt }
  404: unknown jobId (client re-enqueues)
```

No auth required — `jobId` is a UUID so guessing is impractical and the result contains no PII.

### 5.2 Job store

`server/jobStore.js`:

```js
const JOBS = new Map();
const TTL_MS = 10 * 60 * 1000;

export function put(jobId, patch) {
  const prev = JOBS.get(jobId) || { jobId, createdAt: Date.now() };
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  JOBS.set(jobId, next);
  return next;
}
export function get(jobId) {
  const j = JOBS.get(jobId);
  if (!j) return null;
  if (Date.now() - j.updatedAt > TTL_MS) { JOBS.delete(jobId); return null; }
  return j;
}
setInterval(() => {
  for (const [id, j] of JOBS) if (Date.now() - j.updatedAt > TTL_MS) JOBS.delete(id);
}, 60_000);
```

### 5.3 Coordinator

`server/coordinator.js`:

```js
export async function runWaterfall({ jobId, url, sourceHash }) {
  const update = (patch) => jobStore.put(jobId, patch);
  update({ status: 'processing', progress: 'Starting…' });

  // STEP 1 — metadata_pass
  update({ progress: 'Checking for structured recipe data…' });
  const meta = await runPython('python/metadata_pass.py', { url }, { timeoutMs: 15_000 });
  if (meta.ok && meta.confidence >= 0.9) {
    return update({ status: 'done', progress: '', result: await finalize(meta.recipe, { sourceUrl: url }) });
  }

  // STEP 2 — instagram_stealth_fetch (only for IG URLs)
  let stealth = null;
  if (isInstagramUrl(url)) {
    update({ progress: 'Fetching Instagram caption…' });
    stealth = await runPython('python/instagram_stealth_fetch.py', { url }, {
      timeoutMs: 45_000,
      env: { IG_COOKIES_JSON_B64: process.env.IG_COOKIES_JSON_B64 },
    });
  }

  // STEP 3 — recipe_structurer (Node + Gemini)
  const rawSources = [
    meta.ok ? { kind: 'metadata', text: JSON.stringify(meta.recipe) } : null,
    stealth?.ok ? { kind: 'caption', text: stealth.caption, imageUrls: stealth.imageUrls } : null,
  ].filter(Boolean);

  if (rawSources.length === 0) {
    return update({ status: 'failed', error: 'No recipe data could be extracted.' });
  }

  update({ progress: 'AI structuring…' });
  const structured = await structureWithGemini(rawSources, { sourceUrl: url });
  if (!structured.ok) {
    return update({ status: 'failed', error: structured.error || 'Structuring failed.' });
  }

  update({ status: 'done', progress: '', result: await finalize(structured.recipe, { sourceUrl: url }) });
}
```

Confidence threshold: `0.9`. Short-circuit is rare — it only triggers on URLs where `recipe-scrapers` returns a complete recipe (name + ≥2 ingredients + ≥1 direction + any time/yield field).

### 5.4 `finalize()`

```js
async function finalize(recipe, { sourceUrl }) {
  const imageUrl = firstImageUrl(recipe);
  const persistedImage = imageUrl ? await persistImage(imageUrl) : '';
  return {
    name:        recipe.name || recipe.title || '',   // client sanitizes
    ingredients: asStringArray(recipe.ingredients),
    directions:  asStringArray(recipe.directions || recipe.instructions),
    imageUrl:    persistedImage,
    link:        sourceUrl,
    yield:       recipe.yield || recipe.servings || '',
    prepTime:    recipe.prepTime || '',
    cookTime:    recipe.cookTime || '',
  };
}
```

`firstImageUrl` returns the first string from `recipe.image` / `recipe.imageUrl` / `recipe.images[]` — preferring data URLs (from the video frame path) over CDN URLs.

### 5.5 `persistImage()`

```js
async function persistImage(url) {
  if (!url) return '';
  if (url.startsWith('data:')) return url;          // video frame already inline
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return url;                        // graceful: return remote URL
    const ct = resp.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return url;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) return url;  // >2MB: leave as URL, client can still use it
    const b64 = Buffer.from(buf).toString('base64');
    return `data:${ct};base64,${b64}`;
  } catch { return url; }
}
```

No backend resize. Client compresses via `imageCompressor.js` before Dexie write.

### 5.6 Python worker contract

```
stdin:  JSON (one line or whole document)
stdout: JSON  { ok: bool, ...worker-specific fields, error?: string }
exit:   always 0 — Node treats non-zero as a crash and normalizes to {ok: false, error: 'crash'}
```

Enforced by `server/runPython.js`:

```js
export async function runPython(scriptPath, input, { timeoutMs, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('python3', [scriptPath], { env: { ...process.env, ...env } });
    const chunks = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (d) => chunks.push(d));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: `exit-${code}` });
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch (e) { resolve({ ok: false, error: 'parse-error' }); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
```

### 5.7 Build pipeline

- `server/requirements.txt`:
  ```
  recipe-scrapers==15.*
  playwright==1.49.*
  playwright-stealth==2.*
  pydantic==2.*
  ```
- `render-build.sh` adds:
  ```
  pip install -r server/requirements.txt
  playwright install chromium
  ```
- Chromium binary (~170MB) fits within Render's free-tier ephemeral disk.
- No Dockerfile changes; Render's native Node buildpack handles Python via the build script.

### 5.8 Request handlers

```js
app.post('/api/v2/import', express.json(), async (req, res) => {
  const { jobId, url, sourceHash } = req.body || {};
  if (!jobId || !url) return res.status(400).json({ error: 'jobId and url required' });

  const existing = jobStore.get(jobId);
  if (existing) return res.status(202).json({ jobId, status: existing.status });

  jobStore.put(jobId, { status: 'queued', sourceHash, url });
  runWaterfall({ jobId, url, sourceHash }).catch((err) => {
    jobStore.put(jobId, { status: 'failed', error: err.message });
  });
  res.status(202).json({ jobId, status: 'queued' });
});

app.get('/api/v2/import/status/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown job' });
  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress || '',
    result: job.status === 'done' ? job.result : undefined,
    error: job.status === 'failed' ? job.error : undefined,
    updatedAt: job.updatedAt,
  });
});
```

### 5.9 Timeouts

| Step | Timeout |
|---|---|
| `metadata_pass` | 15s |
| `instagram_stealth_fetch` | 45s |
| `structureWithGemini` | 20s |
| `persistImage` (per URL) | 10s |
| Waterfall worst case | ~90s |

Client polls every 2s → ~45 polls worst case.

## 6. Phase 3 — Instagram Stealth Agent

### 6.1 `python/instagram_stealth_fetch.py`

One file. Reads `{url}` from stdin, prints `{ok, caption, imageUrls, postType, error?}` to stdout.

Core structure:

```python
import asyncio, base64, json, os, sys
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

async def fetch(url):
    cookies = load_cookies_from_env()
    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        if cookies:
            await context.add_cookies(cookies)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2500)   # let IG JS hydrate

            caption = await extract_caption(page)
            image_urls = await extract_images(page)
            post_type = "reel" if "/reel" in url else "post"

            # Video frame extraction for Reels — preferred over og:image
            if post_type == "reel":
                frame = await extract_video_frame(page)
                if frame:
                    image_urls = [frame] + image_urls

            if not caption and not image_urls:
                return {"ok": False, "error": "login-wall" if await detect_login_wall(page) else "no-content"}
            return {"ok": True, "caption": caption or "", "imageUrls": image_urls, "postType": post_type}
        finally:
            await browser.close()
```

Selector chain, login-wall detection, and caption metadata-prefix stripping mirror the existing logic in `server.js` `extractWithHeadlessBrowser`. See section 6.3 for the full selector list.

### 6.2 Cookie handling

- **Env var:** `IG_COOKIES_JSON_B64` — Base64-encoded JSON array of cookie dicts in Playwright format. Set in Render dashboard, never committed.
- **Encoding helper:** `scripts/encode-cookies.js` — reads a local `cookies.json`, prints the Base64 string to paste into Render.
- **Rotation runbook:** documented in `server/README.md`. When stealth starts returning `login-wall`, re-export cookies from the user's browser extension, re-encode, update the env var.
- **No cookies path:** worker still runs; just hits the login wall more often. Not fatal.

### 6.3 Caption extraction selector chain

Ordered most-specific first:

1. `h1._ap3a` — current Reel/post title (2025/26).
2. `[data-testid="post-caption"]`.
3. `article div._a9zs span`.
4. `article div._a9zs`.
5. `meta[property="og:description"]` — server-rendered fallback.

After extraction, run `strip_social_meta_prefix()` to remove "13K likes, 213 comments - username on Date: …" wrapper. Port of the existing Node helper in `server.js`.

### 6.4 Image URL extraction

Preference order:
1. Video frame data URL (Reels only — see 6.5).
2. `og:image` (usually high-quality thumbnail).
3. `article img[srcset]`, `article img[src*="scontent"]`, `video[poster]`.
4. Reject known-bad URLs: `profile_pic`, `s150x150`.

Cap at 4 image URLs (handles carousels).

### 6.5 Video frame extraction

For Reels only. Grabs one frame at `max(1, min(duration * 0.75, 8))` seconds via canvas draw:

```python
async def extract_video_frame(page):
    try:
        result = await page.evaluate("""async () => {
          const video = document.querySelector('article video, video');
          if (!video || (!video.src && !video.currentSrc)) return null;
          if (video.readyState < 1) {
            await new Promise((res, rej) => {
              video.addEventListener('loadedmetadata', res, {once: true});
              setTimeout(() => rej('metadata-timeout'), 5000);
            });
          }
          if (!isFinite(video.duration) || video.duration <= 0) return null;
          const target = Math.max(1, Math.min(video.duration * 0.75, 8));
          video.currentTime = target;
          await new Promise((res, rej) => {
            video.addEventListener('seeked', res, {once: true});
            setTimeout(() => rej('seek-timeout'), 5000);
          });
          try {
            const canvas = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 720;
            canvas.height = video.videoHeight || 1280;
            canvas.getContext('2d').drawImage(video, 0, 0);
            return canvas.toDataURL('image/jpeg', 0.82);
          } catch (e) { return null; }   // cross-origin canvas taint
        }""")
        return result if result and result.startswith("data:image") else None
    except Exception:
        return None
```

**Rationale:**
- Creators typically show the finished dish in the final quarter of a Reel. 75% target captures that.
- Clamped to `[1s, 8s]` so we skip intro cards (1s minimum) and don't wait forever for long Reels (8s cap).
- Canvas `drawImage(video)` is more reliable than `elementHandle.screenshot()` on `<video>` in headless mode.
- If the canvas taints cross-origin, returns `null` and the caller falls back to `og:image` — no regression.
- The returned data URL is prepended to `imageUrls`; `persistImage()` detects `data:` prefix and passes through without a CDN fetch.

### 6.6 Confidence scoring for `metadata_pass`

```python
def score(r):
    s = 0.0
    if r.name and len(r.name) > 3: s += 0.3
    if r.ingredients and len(r.ingredients) >= 2: s += 0.35
    if r.directions and len(r.directions) >= 1: s += 0.25
    if r.yield_ or r.prepTime or r.cookTime: s += 0.10
    return min(1.0, s)
```

Full recipe → 1.0 → short-circuit.
Missing directions (ingredients-only list) → 0.65 → continues into the waterfall.

### 6.7 Schema enforcement

**Python** (`python/schema.py`) — Pydantic validates `metadata_pass` output before emitting:

```python
from pydantic import BaseModel, Field
class Recipe(BaseModel):
    name: str
    ingredients: list[str] = Field(default_factory=list)
    directions: list[str] = Field(default_factory=list)
    yield_: str | None = Field(default=None, alias="yield")
    prepTime: str | None = None
    cookTime: str | None = None
```

**Node** (`server/schema.js`) — hand-rolled ~20-line validator runs on structurer output before the job result is published. Belt-and-suspenders; rejects malformed Gemini responses rather than forwarding them to the client.

### 6.8 Structurer prompt adjustments

The existing Gemini call in `server/index.js` is adapted to accept a `rawSources: [{kind, text, imageUrls?}]` array. New system prompt excerpt:

> You will receive up to two recipe sources: **metadata** (from structured JSON-LD — treat as ground truth for times/yields if present) and **caption** (from Instagram — expect fluff, emojis, calls-to-action; extract only culinary content). When both are present, prefer metadata for structure and caption for detail. When only caption is present, ignore social calls-to-action ("link in bio", "tap to save"). Output strict JSON matching the schema.

Same API key, same model — just a new prompt builder and a new output validator.

## 7. Data Contracts

### 7.1 POST /api/v2/import

```ts
Request:  { jobId: string; url: string; sourceHash: string }
Response: 202 { jobId: string; status: 'queued' | 'processing' | 'done' | 'failed' }
          400 { error: string }
```

### 7.2 GET /api/v2/import/status/:jobId

```ts
Response: 200 {
  jobId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  progress: string;        // human-readable
  result?: RecipePayload;  // present when status='done'
  error?: string;          // present when status='failed'
  updatedAt: number;       // epoch ms
}
Response: 404 { error: 'unknown job' }
```

### 7.3 RecipePayload

```ts
type RecipePayload = {
  name: string;            // raw; client sanitizes
  ingredients: string[];
  directions: string[];
  imageUrl: string;        // data:image/...;base64,… or CDN URL (fallback)
  link: string;            // original sourceUrl
  yield: string;
  prepTime: string;
  cookTime: string;
};
```

### 7.4 Python worker outputs

```ts
// metadata_pass.py
{ ok: true,  confidence: 0..1, recipe: Recipe } | { ok: false, error: string }

// instagram_stealth_fetch.py
{ ok: true,  caption: string, imageUrls: string[], postType: 'reel' | 'post' } | { ok: false, error: string }
```

## 8. Error Handling & Retry

| Failure | Layer | Behavior |
|---|---|---|
| Python worker timeout | `runPython` | Resolve `{ok:false, error:'timeout'}`. Coordinator treats as a failed step. |
| Python crash (non-zero exit) | `runPython` | Resolve `{ok:false, error:'exit-<code>'}`. Same. |
| Python JSON parse error | `runPython` | Resolve `{ok:false, error:'parse-error'}`. |
| Gemini timeout / 5xx | `structureWithGemini` | Returns `{ok:false, error}`. Job ends `failed`. |
| IG login wall | stealth worker | Returns `{ok:false, error:'login-wall'}`. Coordinator may still have metadata; otherwise job ends `failed`. |
| Canvas cross-origin taint | stealth worker | `extract_video_frame` returns null; image falls back to og:image chain. |
| `persistImage` 4xx/5xx | finalize | Returns the original URL; client still renders it (may 403 later). |
| Render restart drops job | status poll | 404 → client re-POSTs with same `jobId`; waterfall runs again. |
| Network drop on client | `importWorker` | Next 2s tick retries silently. |
| User force-quits app | `importWorker` | On next launch, hook resumes polling `processing` rows. |

All user-facing errors surface as `importError` text on the Ghost card with Retry / Paste Manually actions.

## 9. Testing Strategy

### Backend (Node)
- Unit: `jobStore` TTL, `runPython` timeout/parse, `persistImage` (mock fetch), `coordinator` with mocked Python workers.
- Integration: In-process test hits `/api/v2/import`, polls `/status/:jobId`, asserts state transitions queued → processing → done.

### Python workers
- CLI-runnable: `echo '{"url":"…"}' | python3 metadata_pass.py`.
- `metadata_pass.py` pinned-URL suite: AllRecipes, NYT Cooking, Serious Eats (3 URLs, recorded expected output).
- `instagram_stealth_fetch.py` manual smoke test — requires valid cookies, not CI-able. Documented in `server/README.md`.

### Frontend
- `importWorker.js` — unit tests with fake fetch + fake Dexie simulate done/failed/404/network responses.
- `ImportModal` — assert modal closes in <300ms and Ghost row is inserted before close.
- Manual smoke suite (documented): IG post, IG reel, AllRecipes, TikTok, blog-with-no-structured-data.

### End-to-end
- One Playwright test against the locally-running stack: submit IG URL, see Ghost card within 300ms, see populated recipe within 90s.

## 10. Rollout

- **Feature flags:**
  - `VITE_USE_V2_IMPORT` (frontend) — controls whether `handleUrlImport` uses the optimistic Ghost path or the legacy synchronous path.
  - `ENABLE_V2_IMPORT` (backend) — gates the `/api/v2/*` routes.
  - Both default **true** once Phase 2 + 3 are green.
- **Rollback:** flip both flags off; legacy `/api/extract-url` + synchronous `handleUrlImport` are untouched and functional.
- **First cut** ships with only the URL tab using v2. Image, paste, spreadsheet, Paprika tabs keep their existing behavior.

## 11. Open Items Tracked for Follow-Up Specs

1. Client-side Tesseract OCR integration into the waterfall (Image tab stays as-is for now).
2. TikTok / Facebook / YouTube stealth workers (same contract as `instagram_stealth_fetch.py`).
3. `recipeParser.js` decomposition (file is 3778 lines; a future spec should split it by concern: JSON-LD parser, heuristic classifier, caption parser, social helpers).
4. Migrating Image / Paste / Spreadsheet / Paprika tabs to the v2 async engine.
5. Persistent job store (Dexie on the server via `better-sqlite3`, or Redis) if Render cold-starts become a frequent UX issue.

## 12. Definition of Done

1. User shares an Instagram Reel to SpiceHub via the share target.
2. `ImportModal` closes within 300ms.
3. A Ghost card appears in the meal list with shimmer + "Fetching…" status.
4. Within 5–90 seconds, the card resolves to a real recipe with:
   - Sanitized title.
   - ≥2 ingredients and ≥1 direction (or a clean `failed` state if Gemini couldn't structure anything).
   - A Base64 data URL image — preferring a video frame grabbed from ~75% through the Reel — that never 403s.
5. Force-quitting the app mid-import and reopening it resumes the polling and lands the recipe.
6. Toggling `VITE_USE_V2_IMPORT=false` reverts to today's synchronous behavior with zero user-visible breakage.
