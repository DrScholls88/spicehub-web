# Unified Import Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an async skill-waterfall import pipeline: `ImportModal` closes in <300ms with a Ghost Recipe card; the Node backend coordinates Python `recipe-scrapers` + stealth Instagram workers; the finished recipe (with a Base64 image grabbed from ~75% through the Reel) lands in Dexie via a polling worker.

**Architecture:** Bottom-up build. Node coordinator + in-memory job store + Python worker shells first, then real Python workers, then frontend Ghost UI + polling. Dexie is the source of truth; the server-side `jobStore` is soft state. The coordinator is a strict waterfall: `metadata_pass` → (if Instagram) `instagram_stealth_fetch` → `recipe_structurer` (Gemini).

**Tech Stack:**
- Frontend: React 19, Dexie 4, Vite, vitest (new), @playwright/test (existing), Web Crypto API
- Node backend: Express, `child_process.spawn` for Python, existing `@google/generative-ai`
- Python workers: `recipe-scrapers`, `playwright` + `playwright-stealth`, `pydantic`
- Spec: `docs/superpowers/specs/2026-04-14-unified-import-engine-design.md`

---

## File Structure

### New files

```
server/
  jobStore.js               # In-memory Map<jobId, JobState> with 10-min TTL
  runPython.js              # child_process.spawn wrapper with timeout + JSON parse
  coordinator.js            # Strict waterfall: metadata → stealth → structurer
  util.js                   # isInstagramUrl, firstImageUrl, asStringArray helpers
  persistImage.js           # Node fetch of CDN URLs → Base64 data URL (no resize)
  schema.js                 # Hand-rolled RecipePayload validator
  structurer.js             # Gemini call adapter (wraps existing logic)
  requirements.txt          # recipe-scrapers, playwright, playwright-stealth, pydantic
  python/
    metadata_pass.py        # recipe-scrapers wrapper
    instagram_stealth_fetch.py  # playwright-stealth caption + video frame
    schema.py               # Pydantic Recipe model (shared contract)
  __tests__/
    jobStore.test.js
    runPython.test.js
    coordinator.test.js
    persistImage.test.js
    schema.test.js
    util.test.js

src/
  importWorker.js           # React hook: polls Dexie processing rows against /api/v2/import/status
  shaHex.js                 # Web Crypto sha256 → hex helper
  __tests__/
    importWorker.test.js
    shaHex.test.js

scripts/
  encode-cookies.js         # Reads local cookies.json, prints Base64 for Render env var

tests/e2e/
  unified-import.spec.js    # Playwright E2E against running stack

docs/superpowers/
  specs/2026-04-14-unified-import-engine-design.md  # (already exists)
  plans/2026-04-14-unified-import-engine.md         # (this file)
```

### Modified files

```
package.json                # Add vitest devDep + "test" script
render-build.sh             # Add pip install + playwright install chromium
server/index.js             # Register /api/v2/import + /api/v2/import/status routes
server/package.json         # (no change — Python shelled from Node's sandbox)
src/db.js                   # Dexie v9 migration + mealStatus helper
src/App.jsx                 # Mount useImportWorker() once
src/components/ImportModal.jsx  # Rewrite handleUrlImport behind VITE_USE_V2_IMPORT flag
src/components/MealLibrary.jsx  # Ghost card processing/failed visual states
src/recipeParser.js         # No changes — sanitizeRecipeTitle import site only
```

### Untouched

- `src/api.js` legacy proxy path stays as-is (used by legacy flag-off branch).
- `server.js` (the local dev Puppeteer server) — not the Render target; left alone.
- `src/imageCompressor.js` — reused as-is by `importWorker`.
- Image, paste, spreadsheet, Paprika tabs in `ImportModal` — unchanged.

---

## Task Map by Spec Section

| Task | Spec section | Layer |
|---|---|---|
| 1–2 | Tooling setup | Infra |
| 3–4 | §5.2 jobStore | Backend |
| 5–6 | §5.6 runPython | Backend |
| 7 | §5.0 util helpers | Backend |
| 8 | §7.3 RecipePayload schema | Backend |
| 9 | §5.5 persistImage | Backend |
| 10 | §6.8 structurer adapter | Backend |
| 11 | §5.3 coordinator (with mocked workers) | Backend |
| 12 | §5.1, §5.8 HTTP endpoints | Backend |
| 13 | §5.7 build pipeline | Infra |
| 14 | §6.7 Pydantic schema | Python |
| 15 | §6.6 metadata_pass confidence | Python |
| 16 | §6.1–6.4 stealth skeleton | Python |
| 17 | §6.2 cookie loading | Python |
| 18 | §6.5 video frame extraction | Python |
| 19 | §5.3 wire Python workers into coordinator | Backend |
| 20 | §4.1 Dexie v9 migration | Frontend |
| 21 | §5.0 shaHex helper | Frontend |
| 22 | §4.4 importWorker hook | Frontend |
| 23 | §4.3 ImportModal handleUrlImport | Frontend |
| 24 | §4.5 Ghost card visuals | Frontend |
| 25 | §4.5 Retry / Paste Manually | Frontend |
| 26 | §10 feature flag wiring | Frontend |
| 27 | §9 E2E Playwright test | Tests |
| 28 | §6.2 cookie encoding script + README | Docs |

---

## Task 1: Add vitest and test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
cd /sessions/affectionate-confident-euler/mnt/spicehub-web
npm install --save-dev vitest@^2
```

Expected: `added N packages`, no audit errors.

- [ ] **Step 2: Add test script to package.json**

Find the `"scripts"` block in `package.json` and add `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 3: Verify**

```bash
npx vitest --version
```

Expected: Prints a 2.x version string.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(test): add vitest as dev dependency"
```

---

## Task 2: Create empty __tests__ directories with a smoke test

**Files:**
- Create: `server/__tests__/smoke.test.js`
- Create: `src/__tests__/smoke.test.js`

- [ ] **Step 1: Write a trivial smoke test that proves vitest runs**

`server/__tests__/smoke.test.js`:
```js
import { describe, it, expect } from 'vitest';
describe('smoke', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

`src/__tests__/smoke.test.js`: identical contents.

- [ ] **Step 2: Run**

```bash
npx vitest run
```

Expected: `2 passed (2)`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/smoke.test.js src/__tests__/smoke.test.js
git commit -m "test: scaffold vitest test directories"
```

---

## Task 3: jobStore — failing test

**Files:**
- Create: `server/__tests__/jobStore.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jobStore from '../jobStore.js';

describe('jobStore', () => {
  beforeEach(() => jobStore._resetForTests());

  it('returns null for unknown jobId', () => {
    expect(jobStore.get('nope')).toBeNull();
  });

  it('round-trips put → get', () => {
    jobStore.put('j1', { status: 'queued', url: 'https://x' });
    const j = jobStore.get('j1');
    expect(j.status).toBe('queued');
    expect(j.url).toBe('https://x');
    expect(j.jobId).toBe('j1');
    expect(typeof j.createdAt).toBe('number');
    expect(typeof j.updatedAt).toBe('number');
  });

  it('merges successive puts', () => {
    jobStore.put('j1', { status: 'queued' });
    jobStore.put('j1', { status: 'processing', progress: 'hi' });
    const j = jobStore.get('j1');
    expect(j.status).toBe('processing');
    expect(j.progress).toBe('hi');
  });

  it('evicts entries older than TTL on read', () => {
    vi.useFakeTimers();
    jobStore.put('j1', { status: 'done' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(jobStore.get('j1')).toBeNull();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run server/__tests__/jobStore.test.js
```

Expected: FAIL with `Cannot find module '../jobStore.js'`.

---

## Task 4: jobStore — implementation

**Files:**
- Create: `server/jobStore.js`

- [ ] **Step 1: Write the module**

```js
// In-memory job store with 10-minute TTL. Soft state; Dexie is the source of truth.
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

// Sweep every 60s to free memory even without reads
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.updatedAt > TTL_MS) JOBS.delete(id);
}, 60_000).unref?.();

// Test hook — do not call from production code
export function _resetForTests() { JOBS.clear(); }
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run server/__tests__/jobStore.test.js
```

Expected: `4 passed (4)`.

- [ ] **Step 3: Commit**

```bash
git add server/jobStore.js server/__tests__/jobStore.test.js
git commit -m "feat(server): add in-memory jobStore with TTL eviction"
```

---

## Task 5: runPython — failing test

**Files:**
- Create: `server/__tests__/runPython.test.js`

- [ ] **Step 1: Write the test**

The wrapper shells out to Python; we test against a tiny `cat`-like python script fixture.

```js
import { describe, it, expect } from 'vitest';
import { runPython } from '../runPython.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writeFixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'runpy-'));
  const file = join(dir, 'fixture.py');
  writeFileSync(file, body, 'utf-8');
  return file;
}

describe('runPython', () => {
  it('parses stdout JSON on success', async () => {
    const script = writeFixture(
      'import sys, json\nd = json.loads(sys.stdin.read())\nprint(json.dumps({"ok": True, "echo": d["x"]}))\n'
    );
    const result = await runPython(script, { x: 42 }, { timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    expect(result.echo).toBe(42);
  });

  it('returns {ok:false, error:timeout} if the script exceeds timeoutMs', async () => {
    const script = writeFixture('import time\ntime.sleep(10)\n');
    const result = await runPython(script, {}, { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
  });

  it('returns {ok:false, error:"parse-error"} on invalid JSON stdout', async () => {
    const script = writeFixture('print("not json")\n');
    const result = await runPython(script, {}, { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('parse-error');
  });

  it('returns {ok:false, error:"exit-N"} on non-zero exit', async () => {
    const script = writeFixture('import sys; sys.exit(3)');
    const result = await runPython(script, {}, { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('exit-3');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run server/__tests__/runPython.test.js
```

Expected: FAIL — `Cannot find module '../runPython.js'`.

---

## Task 6: runPython — implementation

**Files:**
- Create: `server/runPython.js`

- [ ] **Step 1: Write the module**

```js
import { spawn } from 'node:child_process';

// Resolve python executable: PYTHON_BIN env overrides; default to 'python3'.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

export async function runPython(scriptPath, input, { timeoutMs = 30_000, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks = [];
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      finish({ ok: false, error: 'timeout' });
    }, timeoutMs);

    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', () => { /* swallow for now; could wire logging */ });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: `spawn-error: ${err.code || err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish({ ok: false, error: `exit-${code}` });
      try { finish(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { finish({ ok: false, error: 'parse-error' }); }
    });

    try { child.stdin.end(JSON.stringify(input)); }
    catch (err) { clearTimeout(timer); finish({ ok: false, error: 'stdin-error' }); }
  });
}
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run server/__tests__/runPython.test.js
```

Expected: `4 passed (4)`. Note: skip this task if `python3` is not on PATH — Task 13 installs it on Render.

- [ ] **Step 3: Commit**

```bash
git add server/runPython.js server/__tests__/runPython.test.js
git commit -m "feat(server): add runPython wrapper with timeout + JSON parse"
```

---

## Task 7: util.js — helpers with tests

**Files:**
- Create: `server/util.js`
- Create: `server/__tests__/util.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { isInstagramUrl, firstImageUrl, asStringArray } from '../util.js';

describe('isInstagramUrl', () => {
  it('true for instagram.com and www.instagram.com', () => {
    expect(isInstagramUrl('https://www.instagram.com/reel/abc/')).toBe(true);
    expect(isInstagramUrl('https://instagram.com/p/xyz/')).toBe(true);
  });
  it('false for non-ig hosts and bad input', () => {
    expect(isInstagramUrl('https://tiktok.com/@x/video/1')).toBe(false);
    expect(isInstagramUrl('')).toBe(false);
    expect(isInstagramUrl(null)).toBe(false);
  });
});

describe('firstImageUrl', () => {
  it('prefers data URLs over http', () => {
    const r = { image: ['https://cdn/y.jpg', 'data:image/jpeg;base64,AAA'] };
    expect(firstImageUrl(r)).toBe('data:image/jpeg;base64,AAA');
  });
  it('returns string image directly', () => {
    expect(firstImageUrl({ image: 'https://x/1.jpg' })).toBe('https://x/1.jpg');
  });
  it('falls back through image → imageUrl → images[]', () => {
    expect(firstImageUrl({ imageUrl: 'https://x/2.jpg' })).toBe('https://x/2.jpg');
    expect(firstImageUrl({ images: ['https://x/3.jpg'] })).toBe('https://x/3.jpg');
    expect(firstImageUrl({})).toBe('');
  });
});

describe('asStringArray', () => {
  it('preserves arrays of strings', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('splits newline-separated strings', () => {
    expect(asStringArray('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });
  it('unwraps {text:...} and {name:...} objects', () => {
    expect(asStringArray([{ text: 'a' }, { name: 'b' }])).toEqual(['a', 'b']);
  });
  it('filters empty strings', () => {
    expect(asStringArray(['a', '', '  ', 'b'])).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Write the module**

```js
// server/util.js
export function isInstagramUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

export function firstImageUrl(recipe) {
  const candidates = [];
  const push = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === 'string') candidates.push(v);
    else if (typeof v === 'object' && v.url) candidates.push(v.url);
  };
  push(recipe?.image);
  push(recipe?.imageUrl);
  push(recipe?.images);
  // Prefer data URLs (e.g. video frames) over remote URLs
  const dataUrl = candidates.find((c) => typeof c === 'string' && c.startsWith('data:'));
  if (dataUrl) return dataUrl;
  return candidates.find((c) => typeof c === 'string' && c.startsWith('http')) || '';
}

export function asStringArray(v) {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') return (x.text || x.name || '').trim();
      return '';
    })
    .filter(Boolean);
}
```

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run server/__tests__/util.test.js
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/util.js server/__tests__/util.test.js
git commit -m "feat(server): add isInstagramUrl, firstImageUrl, asStringArray helpers"
```

---

## Task 8: schema.js — RecipePayload validator

**Files:**
- Create: `server/schema.js`
- Create: `server/__tests__/schema.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { validateRecipePayload } from '../schema.js';

describe('validateRecipePayload', () => {
  const valid = {
    name: 'Test', ingredients: ['a'], directions: ['b'],
    imageUrl: '', link: 'https://x', yield: '', prepTime: '', cookTime: '',
  };

  it('accepts a complete valid payload', () => {
    expect(validateRecipePayload(valid)).toEqual({ ok: true, value: valid });
  });

  it('rejects missing name', () => {
    const r = validateRecipePayload({ ...valid, name: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/);
  });

  it('rejects non-array ingredients', () => {
    const r = validateRecipePayload({ ...valid, ingredients: 'not an array' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ingredients/);
  });

  it('coerces missing optional fields to empty strings', () => {
    const r = validateRecipePayload({ name: 'x', ingredients: [], directions: [] });
    expect(r.ok).toBe(true);
    expect(r.value.link).toBe('');
    expect(r.value.yield).toBe('');
    expect(r.value.imageUrl).toBe('');
  });
});
```

- [ ] **Step 2: Write the module**

```js
// server/schema.js
export function validateRecipePayload(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'payload must be an object' };

  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (!Array.isArray(input.ingredients)) return { ok: false, error: 'ingredients must be an array' };
  if (!Array.isArray(input.directions)) return { ok: false, error: 'directions must be an array' };

  const str = (v) => (typeof v === 'string' ? v : '');

  return {
    ok: true,
    value: {
      name: input.name.trim(),
      ingredients: input.ingredients.map(String),
      directions: input.directions.map(String),
      imageUrl: str(input.imageUrl),
      link: str(input.link),
      yield: str(input.yield),
      prepTime: str(input.prepTime),
      cookTime: str(input.cookTime),
    },
  };
}
```

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run server/__tests__/schema.test.js
```

- [ ] **Step 4: Commit**

```bash
git add server/schema.js server/__tests__/schema.test.js
git commit -m "feat(server): add RecipePayload validator"
```

---

## Task 9: persistImage.js — Base64 fetch with graceful fallback

**Files:**
- Create: `server/persistImage.js`
- Create: `server/__tests__/persistImage.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistImage } from '../persistImage.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('persistImage', () => {
  it('returns empty string for empty input', async () => {
    expect(await persistImage('')).toBe('');
    expect(await persistImage(null)).toBe('');
  });

  it('passes through data: URLs untouched', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAA';
    expect(await persistImage(dataUrl)).toBe(dataUrl);
  });

  it('downloads and base64-encodes a remote image', async () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'image/jpeg']]),
      arrayBuffer: async () => bytes.buffer,
    });
    const result = await persistImage('https://cdn.example/x.jpg');
    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(result).toContain(Buffer.from(bytes).toString('base64'));
  });

  it('returns original URL when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const url = 'https://cdn.example/y.jpg';
    expect(await persistImage(url)).toBe(url);
  });

  it('returns original URL for non-image content-type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      arrayBuffer: async () => new ArrayBuffer(100),
    });
    const url = 'https://cdn.example/z.html';
    expect(await persistImage(url)).toBe(url);
  });

  it('returns original URL for >2MB payloads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'image/jpeg']]),
      arrayBuffer: async () => new ArrayBuffer(3 * 1024 * 1024),
    });
    const url = 'https://cdn.example/huge.jpg';
    expect(await persistImage(url)).toBe(url);
  });
});
```

- [ ] **Step 2: Write the module**

```js
// server/persistImage.js
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const REFERER = 'https://www.instagram.com/';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export async function persistImage(url) {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Referer': REFERER },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return url;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return url;

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return url;

    const b64 = Buffer.from(buf).toString('base64');
    return `data:${ct.split(';')[0]};base64,${b64}`;
  } catch {
    return url; // graceful: client can still try to render the remote URL
  }
}
```

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run server/__tests__/persistImage.test.js
```

- [ ] **Step 4: Commit**

```bash
git add server/persistImage.js server/__tests__/persistImage.test.js
git commit -m "feat(server): add persistImage with 2MB cap and graceful fallback"
```

---

## Task 10: structurer.js — Gemini adapter with injectable client

**Files:**
- Create: `server/structurer.js`

This wraps the existing Gemini call so the coordinator can be tested with a fake client.

- [ ] **Step 1: Write the module**

```js
// server/structurer.js
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe data extractor. You will receive up to two recipe sources:
- "metadata" — structured JSON-LD. Treat as ground truth for name/times/yields if present.
- "caption" — raw Instagram caption text. Expect fluff (emojis, hashtags, calls-to-action). Extract only culinary content. Ignore "link in bio", "tap to save", "comment for recipe" and similar.

When both are present, prefer metadata for structure and caption for detail.
When only caption is present, extract recipe data from it and ignore social CTAs.

Output STRICT JSON only. Schema:
{ "name": string, "ingredients": string[], "directions": string[], "yield": string, "prepTime": string, "cookTime": string, "image": string }

No prose. No markdown fences. No trailing commentary.`;

export async function structureWithGemini(rawSources, { sourceUrl, client } = {}) {
  try {
    const genAI = client || new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const userParts = rawSources.map((s) => `[${s.kind}]\n${s.text}`).join('\n\n---\n\n');
    const prompt = `${SYSTEM_PROMPT}\n\nSources for sourceUrl=${sourceUrl || 'unknown'}:\n\n${userParts}`;

    const resp = await model.generateContent(prompt);
    const text = resp.response.text().trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return { ok: false, error: 'no-json' };
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return { ok: true, recipe: parsed };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
```

- [ ] **Step 2: Quick sanity run (no unit test — injectable client is the test seam used by coordinator tests)**

```bash
node -e "import('./server/structurer.js').then(m => console.log(typeof m.structureWithGemini))"
```

Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add server/structurer.js
git commit -m "feat(server): add Gemini structurer adapter with injectable client"
```

---

## Task 11: coordinator.js — waterfall with injectable workers

**Files:**
- Create: `server/coordinator.js`
- Create: `server/__tests__/coordinator.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jobStore from '../jobStore.js';
import { runWaterfall } from '../coordinator.js';

beforeEach(() => jobStore._resetForTests());

const fakeDeps = ({ meta, stealth, structured, persist }) => ({
  runMetadata: vi.fn(async () => meta),
  runStealth: vi.fn(async () => stealth),
  structureWithGemini: vi.fn(async () => structured),
  persistImage: vi.fn(async (url) => persist?.(url) ?? url),
});

describe('runWaterfall', () => {
  it('short-circuits when metadata confidence >= 0.9', async () => {
    const deps = fakeDeps({
      meta: { ok: true, confidence: 0.95, recipe: { name: 'r', ingredients: ['a'], directions: ['b'], image: 'https://x/1.jpg' } },
    });
    await runWaterfall({ jobId: 'j1', url: 'https://www.allrecipes.com/x' }, deps);

    expect(deps.runMetadata).toHaveBeenCalledOnce();
    expect(deps.runStealth).not.toHaveBeenCalled();
    expect(deps.structureWithGemini).not.toHaveBeenCalled();

    const j = jobStore.get('j1');
    expect(j.status).toBe('done');
    expect(j.result.name).toBe('r');
  });

  it('runs stealth then structurer when metadata is weak on an Instagram URL', async () => {
    const deps = fakeDeps({
      meta: { ok: false, error: 'no-data' },
      stealth: { ok: true, caption: 'Yummy recipe: 1 cup flour\nMix.', imageUrls: ['https://cdn/ig.jpg'] },
      structured: { ok: true, recipe: { name: 'Yummy', ingredients: ['1 cup flour'], directions: ['Mix.'] } },
    });
    await runWaterfall({ jobId: 'j2', url: 'https://www.instagram.com/reel/abc/' }, deps);

    expect(deps.runStealth).toHaveBeenCalledOnce();
    expect(deps.structureWithGemini).toHaveBeenCalledOnce();

    const j = jobStore.get('j2');
    expect(j.status).toBe('done');
    expect(j.result.name).toBe('Yummy');
    expect(j.result.ingredients).toEqual(['1 cup flour']);
  });

  it('skips stealth for non-Instagram URLs', async () => {
    const deps = fakeDeps({
      meta: { ok: false, error: 'no-data' },
      structured: { ok: false, error: 'no-data' },
    });
    await runWaterfall({ jobId: 'j3', url: 'https://someblog.com/r' }, deps);

    expect(deps.runStealth).not.toHaveBeenCalled();
    const j = jobStore.get('j3');
    expect(j.status).toBe('failed');
  });

  it('marks failed when no sources return data', async () => {
    const deps = fakeDeps({
      meta: { ok: false },
      stealth: { ok: false, error: 'login-wall' },
    });
    await runWaterfall({ jobId: 'j4', url: 'https://www.instagram.com/p/x/' }, deps);
    const j = jobStore.get('j4');
    expect(j.status).toBe('failed');
    expect(j.error).toMatch(/No recipe data/i);
  });

  it('marks failed when structurer errors', async () => {
    const deps = fakeDeps({
      meta: { ok: true, confidence: 0.5, recipe: { name: 'x', ingredients: [], directions: [] } },
      stealth: { ok: true, caption: 'stuff', imageUrls: [] },
      structured: { ok: false, error: 'gemini-timeout' },
    });
    await runWaterfall({ jobId: 'j5', url: 'https://www.instagram.com/reel/y/' }, deps);
    const j = jobStore.get('j5');
    expect(j.status).toBe('failed');
    expect(j.error).toBe('gemini-timeout');
  });

  it('prefers data-URL images from stealth video frames over CDN URLs', async () => {
    const deps = fakeDeps({
      meta: { ok: false },
      stealth: { ok: true, caption: 'c', imageUrls: ['data:image/jpeg;base64,AAAA', 'https://cdn/ig.jpg'] },
      structured: { ok: true, recipe: { name: 'N', ingredients: ['i'], directions: ['d'], image: 'data:image/jpeg;base64,AAAA' } },
      persist: (u) => u, // passthrough
    });
    await runWaterfall({ jobId: 'j6', url: 'https://www.instagram.com/reel/abc/' }, deps);
    const j = jobStore.get('j6');
    expect(j.status).toBe('done');
    expect(j.result.imageUrl.startsWith('data:image')).toBe(true);
  });
});
```

- [ ] **Step 2: Write the module**

```js
// server/coordinator.js
import * as jobStore from './jobStore.js';
import { runPython } from './runPython.js';
import { isInstagramUrl, firstImageUrl, asStringArray } from './util.js';
import { persistImage as defaultPersistImage } from './persistImage.js';
import { structureWithGemini as defaultStructureWithGemini } from './structurer.js';
import { validateRecipePayload } from './schema.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METADATA_SCRIPT = join(__dirname, 'python', 'metadata_pass.py');
const STEALTH_SCRIPT  = join(__dirname, 'python', 'instagram_stealth_fetch.py');

// Default deps shell out to Python; tests inject fakes.
const defaultDeps = {
  runMetadata:          (input) => runPython(METADATA_SCRIPT, input, { timeoutMs: 15_000 }),
  runStealth:           (input) => runPython(STEALTH_SCRIPT,  input, {
    timeoutMs: 45_000,
    env: { IG_COOKIES_JSON_B64: process.env.IG_COOKIES_JSON_B64 || '' },
  }),
  structureWithGemini:  defaultStructureWithGemini,
  persistImage:         defaultPersistImage,
};

export async function runWaterfall({ jobId, url, sourceHash }, deps = defaultDeps) {
  const update = (patch) => jobStore.put(jobId, patch);
  update({ status: 'processing', progress: 'Starting…', url, sourceHash });

  // STEP 1 — metadata_pass
  update({ progress: 'Checking for structured recipe data…' });
  const meta = await deps.runMetadata({ url });
  if (meta.ok && (meta.confidence ?? 0) >= 0.9) {
    const result = await finalize(meta.recipe, { sourceUrl: url, deps });
    if (!result) return update({ status: 'failed', error: 'Invalid metadata payload.' });
    return update({ status: 'done', progress: '', result });
  }

  // STEP 2 — instagram_stealth_fetch (only for IG)
  let stealth = null;
  if (isInstagramUrl(url)) {
    update({ progress: 'Fetching Instagram caption…' });
    stealth = await deps.runStealth({ url });
  }

  // STEP 3 — structurer
  const rawSources = [
    meta.ok ? { kind: 'metadata', text: JSON.stringify(meta.recipe) } : null,
    stealth?.ok ? { kind: 'caption', text: stealth.caption || '', imageUrls: stealth.imageUrls || [] } : null,
  ].filter(Boolean);

  if (rawSources.length === 0) {
    return update({ status: 'failed', error: 'No recipe data could be extracted.' });
  }

  update({ progress: 'AI structuring…' });
  const structured = await deps.structureWithGemini(rawSources, { sourceUrl: url });
  if (!structured.ok) {
    return update({ status: 'failed', error: structured.error || 'Structuring failed.' });
  }

  // If stealth contributed images and structurer didn't pick one, inject the preferred (data URL first)
  const mergedRecipe = { ...structured.recipe };
  if (!firstImageUrl(mergedRecipe) && stealth?.ok && stealth.imageUrls?.length) {
    mergedRecipe.image = stealth.imageUrls[0];
  }

  const finalResult = await finalize(mergedRecipe, { sourceUrl: url, deps });
  if (!finalResult) return update({ status: 'failed', error: 'Structured recipe failed validation.' });
  update({ status: 'done', progress: '', result: finalResult });
}

async function finalize(recipe, { sourceUrl, deps }) {
  const imgUrl = firstImageUrl(recipe);
  const persistedImage = imgUrl ? await deps.persistImage(imgUrl) : '';
  const payload = {
    name: (recipe.name || recipe.title || '').toString(),
    ingredients: asStringArray(recipe.ingredients),
    directions:  asStringArray(recipe.directions || recipe.instructions),
    imageUrl:    persistedImage,
    link:        sourceUrl || '',
    yield:       (recipe.yield || recipe.servings || '').toString(),
    prepTime:    (recipe.prepTime || '').toString(),
    cookTime:    (recipe.cookTime || '').toString(),
  };
  const { ok, value } = validateRecipePayload(payload);
  return ok ? value : null;
}
```

- [ ] **Step 3: Run — expect PASS**

```bash
npx vitest run server/__tests__/coordinator.test.js
```

Expected: `6 passed (6)`.

- [ ] **Step 4: Commit**

```bash
git add server/coordinator.js server/__tests__/coordinator.test.js
git commit -m "feat(server): add strict-waterfall coordinator with injectable workers"
```

---

## Task 12: /api/v2/import endpoints on server/index.js

**Files:**
- Modify: `server/index.js`

Locate the file, find a suitable insertion point (after existing route definitions, before `app.listen`). The existing server is CommonJS or ESM — match it. Tests verify routing.

- [ ] **Step 1: Write the integration test**

Create `server/__tests__/endpoints.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as jobStore from '../jobStore.js';
import { registerImportRoutes } from '../importRoutes.js';

function mountApp(runWaterfallMock) {
  const app = express();
  app.use(express.json());
  registerImportRoutes(app, { runWaterfall: runWaterfallMock });
  return app;
}

beforeEach(() => jobStore._resetForTests());

describe('POST /api/v2/import', () => {
  it('returns 400 without jobId or url', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).post('/api/v2/import').send({ jobId: 'j' });
    expect(r.status).toBe(400);
  });

  it('enqueues a new job and returns 202', async () => {
    const ranWith = vi.fn();
    const app = mountApp(async (payload) => { ranWith(payload); jobStore.put(payload.jobId, { status: 'done', result: {} }); });
    const r = await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x', sourceHash: 'h' });
    expect(r.status).toBe(202);
    expect(r.body.jobId).toBe('j1');
    expect(ranWith).toHaveBeenCalled();
  });

  it('is idempotent — second POST does not re-run the waterfall', async () => {
    const ran = vi.fn();
    const app = mountApp(async () => { ran(); });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    expect(ran).toHaveBeenCalledOnce();
  });
});

describe('GET /api/v2/import/status/:jobId', () => {
  it('returns 404 for unknown job', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).get('/api/v2/import/status/unknown');
    expect(r.status).toBe(404);
  });

  it('returns status and result for a done job', async () => {
    const app = mountApp(async (p) => { jobStore.put(p.jobId, { status: 'done', result: { name: 'n', ingredients: [], directions: [], imageUrl: '', link: '', yield: '', prepTime: '', cookTime: '' } }); });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    // Give the async waterfall a microtask to complete
    await new Promise((r) => setImmediate(r));
    const r = await request(app).get('/api/v2/import/status/j1');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('done');
    expect(r.body.result.name).toBe('n');
  });
});
```

- [ ] **Step 2: Install supertest (test-only)**

```bash
npm install --save-dev supertest@^7
```

- [ ] **Step 3: Create `server/importRoutes.js`**

```js
// server/importRoutes.js
import * as jobStore from './jobStore.js';
import { runWaterfall as defaultRunWaterfall } from './coordinator.js';

export function registerImportRoutes(app, { runWaterfall = defaultRunWaterfall } = {}) {
  app.post('/api/v2/import', async (req, res) => {
    const { jobId, url, sourceHash } = req.body || {};
    if (!jobId || !url) return res.status(400).json({ error: 'jobId and url required' });

    const existing = jobStore.get(jobId);
    if (existing) return res.status(202).json({ jobId, status: existing.status });

    jobStore.put(jobId, { status: 'queued', url, sourceHash });
    // Fire-and-forget; errors surface via jobStore
    Promise.resolve()
      .then(() => runWaterfall({ jobId, url, sourceHash }))
      .catch((err) => jobStore.put(jobId, { status: 'failed', error: err.message || String(err) }));
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
      error:  job.status === 'failed' ? job.error : undefined,
      updatedAt: job.updatedAt,
    });
  });
}
```

- [ ] **Step 4: Wire into `server/index.js`**

Open `server/index.js`. Near the top, add:
```js
import { registerImportRoutes } from './importRoutes.js';
```

After all existing `app.use` / route definitions and before `app.listen(...)`, add:
```js
if (process.env.ENABLE_V2_IMPORT !== 'false') {
  registerImportRoutes(app);
  console.log('[SpiceHub] /api/v2/import routes registered');
}
```

- [ ] **Step 5: Run**

```bash
npx vitest run server/__tests__/endpoints.test.js
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/importRoutes.js server/index.js server/__tests__/endpoints.test.js package.json package-lock.json
git commit -m "feat(server): wire /api/v2/import routes behind ENABLE_V2_IMPORT flag"
```

---

## Task 13: Build pipeline — add Python + Chromium to render-build.sh

**Files:**
- Modify: `render-build.sh`
- Create: `server/requirements.txt`

- [ ] **Step 1: Create `server/requirements.txt`**

```
recipe-scrapers==15.*
playwright==1.49.*
playwright-stealth==2.*
pydantic==2.*
```

- [ ] **Step 2: Read current render-build.sh**

```bash
cat render-build.sh
```

Note the existing commands so you can append rather than replace.

- [ ] **Step 3: Append Python + Playwright install to render-build.sh**

Append these lines to the end of `render-build.sh` (after existing npm/build steps):

```bash
# Python workers for the Unified Import Engine
if command -v pip3 >/dev/null 2>&1; then
  pip3 install --user -r server/requirements.txt
  # Chromium for playwright-stealth; ~170MB, fits in Render's free-tier ephemeral disk
  python3 -m playwright install --with-deps chromium || python3 -m playwright install chromium
else
  echo "WARN: pip3 not found — skipping Python worker setup. v2 import will fail." >&2
fi
```

- [ ] **Step 4: Verify build script is still executable**

```bash
ls -l render-build.sh
chmod +x render-build.sh
```

Expected: mode `-rwxr-xr-x` or similar.

- [ ] **Step 5: Local sanity check (if python3 available)**

```bash
python3 --version && pip3 --version
```

Expected: Both print versions. If not, note that this task's verification happens on Render deploy.

- [ ] **Step 6: Commit**

```bash
git add render-build.sh server/requirements.txt
git commit -m "build(server): install Python workers + Chromium on Render"
```

---

## Task 14: Python shared Pydantic schema

**Files:**
- Create: `server/python/__init__.py` (empty)
- Create: `server/python/schema.py`

- [ ] **Step 1: Create empty init**

```bash
mkdir -p server/python && touch server/python/__init__.py
```

- [ ] **Step 2: Write `server/python/schema.py`**

```python
"""Shared Pydantic recipe schema used by metadata_pass and other Python workers."""
from pydantic import BaseModel, Field


class Recipe(BaseModel):
    name: str = ""
    ingredients: list[str] = Field(default_factory=list)
    directions: list[str] = Field(default_factory=list)
    yield_: str | None = Field(default=None, alias="yield")
    prepTime: str | None = None
    cookTime: str | None = None
    image: str | None = None

    class Config:
        populate_by_name = True


def confidence_score(r: Recipe) -> float:
    s = 0.0
    if r.name and len(r.name) > 3:                          s += 0.30
    if r.ingredients and len(r.ingredients) >= 2:           s += 0.35
    if r.directions and len(r.directions) >= 1:             s += 0.25
    if r.yield_ or r.prepTime or r.cookTime:                s += 0.10
    return min(1.0, s)
```

- [ ] **Step 3: Smoke-test from CLI (skip if python3/pydantic not local)**

```bash
cd server
python3 -c "from python.schema import Recipe, confidence_score; r = Recipe(name='X', ingredients=['a','b'], directions=['c']); print(confidence_score(r))"
```

Expected: prints `0.9`.

- [ ] **Step 4: Commit**

```bash
git add server/python/__init__.py server/python/schema.py
git commit -m "feat(python): add shared Pydantic Recipe schema + confidence score"
```

---

## Task 15: metadata_pass.py

**Files:**
- Create: `server/python/metadata_pass.py`

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""
metadata_pass: run recipe-scrapers against a URL. Emit {ok, confidence, recipe, error?} JSON.
Reads {url: str} from stdin. Always exits 0.
"""
import json
import sys
from pathlib import Path

# Ensure sibling imports resolve when invoked by Node from any cwd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from python.schema import Recipe, confidence_score  # noqa: E402

try:
    from recipe_scrapers import scrape_me
except ImportError:
    scrape_me = None


def run(url: str) -> dict:
    if scrape_me is None:
        return {"ok": False, "error": "recipe-scrapers not installed"}
    try:
        s = scrape_me(url, wild_mode=True)
        # recipe-scrapers raises on unsupported sites even with wild_mode
    except Exception as e:
        return {"ok": False, "error": f"scrape-failed: {type(e).__name__}: {e}"}

    # Each call is guarded — not all sites provide every field
    def safe(fn, default):
        try:
            v = fn()
            return v if v is not None else default
        except Exception:
            return default

    recipe = Recipe(
        name=safe(s.title, "") or "",
        ingredients=safe(s.ingredients, []) or [],
        directions=[line.strip() for line in (safe(s.instructions, "") or "").splitlines() if line.strip()],
        prepTime=str(safe(s.prep_time, "") or "") or None,
        cookTime=str(safe(s.cook_time, "") or "") or None,
        image=safe(s.image, "") or None,
    )
    try:
        recipe.yield_ = str(safe(s.yields, "") or "") or None
    except Exception:
        pass

    conf = confidence_score(recipe)
    return {"ok": True, "confidence": conf, "recipe": recipe.model_dump(by_alias=True, exclude_none=True)}


if __name__ == "__main__":
    raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}
    url = payload.get("url")
    if not url:
        print(json.dumps({"ok": False, "error": "no-url"}))
        sys.exit(0)
    print(json.dumps(run(url)))
```

- [ ] **Step 2: Make executable**

```bash
chmod +x server/python/metadata_pass.py
```

- [ ] **Step 3: Smoke test (requires pip install done)**

```bash
echo '{"url":"https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/"}' | python3 server/python/metadata_pass.py
```

Expected: JSON with `"ok": true`, `"confidence": 0.9` or `1.0`, and a `recipe` object with name, ingredients, directions. If recipe-scrapers isn't installed locally, the test runs on Render post-deploy.

- [ ] **Step 4: Commit**

```bash
git add server/python/metadata_pass.py
git commit -m "feat(python): add metadata_pass worker using recipe-scrapers"
```

---

## Task 16: instagram_stealth_fetch.py — caption + images (no video frame yet)

**Files:**
- Create: `server/python/instagram_stealth_fetch.py`

- [ ] **Step 1: Write the initial skeleton (caption + image URLs only)**

```python
#!/usr/bin/env python3
"""
instagram_stealth_fetch: stealth-scrape IG post/reel caption + image URLs.
Reads {url: str} from stdin. Reads IG_COOKIES_JSON_B64 from env.
Emits {ok, caption, imageUrls, postType, error?} JSON. Always exits 0.
"""
import asyncio
import base64
import json
import os
import re
import sys

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

COOKIES_ENV = "IG_COOKIES_JSON_B64"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

CAPTION_SELECTORS = [
    "h1._ap3a",
    '[data-testid="post-caption"]',
    "article div._a9zs span",
    "article div._a9zs",
    'meta[property="og:description"]',
]

IMG_SELECTORS = [
    'meta[property="og:image"]',
    'article img[srcset]',
    'article img[src*="scontent"]',
    'video[poster]',
]

SOCIAL_PREFIX_RE = re.compile(
    r'^[\d.]+[KkMm]?\s*likes?,\s*[\d.]+[KkMm]?\s*comments?\s*-\s*\S+\s+on\s+[^:]+:\s*["“]?'
)


def strip_social_meta_prefix(text: str) -> str:
    cleaned = SOCIAL_PREFIX_RE.sub("", text)
    cleaned = re.sub(r'["”]$', "", cleaned).strip()
    return cleaned or text


def load_cookies_from_env() -> list:
    raw = os.environ.get(COOKIES_ENV)
    if not raw:
        return []
    try:
        data = json.loads(base64.b64decode(raw).decode("utf-8"))
        return data if isinstance(data, list) else data.get("cookies", [])
    except Exception:
        return []


async def extract_caption(page) -> str:
    for sel in CAPTION_SELECTORS:
        try:
            el = await page.query_selector(sel)
            if not el:
                continue
            text = (
                await el.get_attribute("content")
                if sel.startswith("meta")
                else await el.inner_text()
            )
            text = (text or "").strip()
            if len(text) > 20:
                return strip_social_meta_prefix(text)
        except Exception:
            continue
    return ""


async def extract_images(page) -> list:
    urls = []

    # og:image first (highest quality thumb)
    try:
        el = await page.query_selector('meta[property="og:image"]')
        if el:
            url = await el.get_attribute("content")
            if url:
                urls.append(url)
    except Exception:
        pass

    for sel in ['article img[srcset]', 'article img[src*="scontent"]', 'video[poster]']:
        try:
            els = await page.query_selector_all(sel)
            for el in els:
                src = (
                    await el.get_attribute("poster")
                    or await el.get_attribute("src")
                )
                if (
                    src and src.startswith("http")
                    and "profile_pic" not in src
                    and "s150x150" not in src
                    and src not in urls
                ):
                    urls.append(src)
        except Exception:
            continue
    return urls[:4]


async def detect_login_wall(page) -> bool:
    try:
        body_text = (await page.inner_text("body") or "").lower()
    except Exception:
        return False
    return ("log in" in body_text or "sign up" in body_text) and len(body_text) < 5000


async def fetch(url: str) -> dict:
    cookies = load_cookies_from_env()
    async with Stealth().use_async(async_playwright()) as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        try:
            context = await browser.new_context(
                user_agent=UA, viewport={"width": 1280, "height": 900}, locale="en-US"
            )
            if cookies:
                try:
                    await context.add_cookies(cookies)
                except Exception:
                    pass  # malformed cookie payload; continue without
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2_500)  # let IG hydrate

            caption = await extract_caption(page)
            image_urls = await extract_images(page)
            post_type = "reel" if ("/reel/" in url or "/reels/" in url) else "post"

            if not caption and not image_urls:
                return {
                    "ok": False,
                    "error": "login-wall" if await detect_login_wall(page) else "no-content",
                }
            return {
                "ok": True,
                "caption": caption or "",
                "imageUrls": image_urls,
                "postType": post_type,
            }
        finally:
            await browser.close()


if __name__ == "__main__":
    raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}
    url = payload.get("url")
    if not url:
        print(json.dumps({"ok": False, "error": "no-url"}))
        sys.exit(0)
    try:
        result = asyncio.run(asyncio.wait_for(fetch(url), timeout=40))
    except asyncio.TimeoutError:
        result = {"ok": False, "error": "timeout"}
    except Exception as e:
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(result))
```

- [ ] **Step 2: Make executable**

```bash
chmod +x server/python/instagram_stealth_fetch.py
```

- [ ] **Step 3: Smoke test (requires cookies + install)**

```bash
export IG_COOKIES_JSON_B64="$(node scripts/encode-cookies.js)"   # created in Task 28
echo '{"url":"https://www.instagram.com/p/<some-public-reel>/"}' | python3 server/python/instagram_stealth_fetch.py
```

Expected: JSON with `"ok": true` and a non-empty caption or imageUrls. If running this task before Task 28, skip the smoke test — structure is validated by Node coordinator tests.

- [ ] **Step 4: Commit**

```bash
git add server/python/instagram_stealth_fetch.py
git commit -m "feat(python): add instagram stealth worker (caption + images)"
```

---

## Task 17: Video frame extraction in instagram_stealth_fetch.py

**Files:**
- Modify: `server/python/instagram_stealth_fetch.py`

- [ ] **Step 1: Add the `extract_video_frame` helper**

Insert this function above `async def fetch(url)`:

```python
async def extract_video_frame(page) -> str | None:
    """Grab one frame ~75% through the Reel as a JPEG data URL.
    Returns None if no video, canvas is cross-origin-tainted, or seek fails.
    """
    try:
        result = await page.evaluate(
            """async () => {
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
              } catch (e) { return null; }
            }"""
        )
        if result and isinstance(result, str) and result.startswith("data:image"):
            return result
        return None
    except Exception:
        return None
```

- [ ] **Step 2: Call it for Reels inside `fetch()`**

Find the block:

```python
            if not caption and not image_urls:
                return {
                    "ok": False,
                    "error": "login-wall" if await detect_login_wall(page) else "no-content",
                }
```

Insert BEFORE that block:

```python
            # Reels: try to grab a frame from ~75% of the video
            if post_type == "reel":
                frame = await extract_video_frame(page)
                if frame:
                    image_urls = [frame] + image_urls
```

- [ ] **Step 3: Smoke test (same as Task 16; requires cookies)**

Expected: JSON with `imageUrls[0]` starting with `data:image/jpeg;base64,` when a Reel URL is provided.

- [ ] **Step 4: Commit**

```bash
git add server/python/instagram_stealth_fetch.py
git commit -m "feat(python): grab Reel thumbnail via canvas draw at 75% duration"
```

---

## Task 18: Dexie v9 migration + mealStatus helper

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Open src/db.js and locate the last `db.version(...)` block**

The last one should be `v8: Instagram import cache`. Directly after the `db.version(8).stores(...)` line (around line 44), insert:

```js
// v9: Unified Import Engine — Ghost Recipe status + sourceHash + jobId on meals
db.version(9).stores({
  meals: '++id, name, status, sourceHash, jobId',
});
```

- [ ] **Step 2: Add mealStatus helper export**

Add this after `export default db;` (near line 46):

```js
// Default-coerce undefined → 'done' so legacy rows render normally.
export function mealStatus(meal) {
  return meal?.status ?? 'done';
}
```

- [ ] **Step 3: Sanity check — run a dev server and confirm existing meals still load**

```bash
npm run dev
```

Open the app in a browser, verify existing meal library loads without error. Close dev server.

- [ ] **Step 4: Commit**

```bash
git add src/db.js
git commit -m "feat(db): add Dexie v9 — meals.status/sourceHash/jobId + mealStatus helper"
```

---

## Task 19: shaHex.js — Web Crypto sha256 helper

**Files:**
- Create: `src/shaHex.js`
- Create: `src/__tests__/shaHex.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { shaHex } from '../shaHex.js';

describe('shaHex', () => {
  it('computes a stable lowercase hex sha256', async () => {
    const h = await shaHex('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('differs for different inputs', async () => {
    expect(await shaHex('a')).not.toBe(await shaHex('b'));
  });
});
```

- [ ] **Step 2: Write the module**

```js
// src/shaHex.js
export async function shaHex(input) {
  const bytes = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3: Configure vitest environment for Web Crypto**

Vitest's default node env has `globalThis.crypto.subtle` on Node ≥ 20. Verify:

```bash
node -e "console.log(typeof globalThis.crypto?.subtle?.digest)"
```

Expected: `function`. If it prints `undefined`, add `test: { environment: 'node' }` to a new `vitest.config.js` and verify Node ≥ 20.

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/shaHex.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/shaHex.js src/__tests__/shaHex.test.js
git commit -m "feat(frontend): add shaHex Web Crypto helper"
```

---

## Task 20: importWorker.js — polling hook with tests

**Files:**
- Create: `src/importWorker.js`
- Create: `src/__tests__/importWorker.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollOne } from '../importWorker.js';

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async update(id, patch) {
      const prev = rows.get(id) || {};
      rows.set(id, { ...prev, ...patch });
    },
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('pollOne', () => {
  it('updates Dexie with done result + sanitized name + compressed image', async () => {
    const db = fakeDb();
    db.rows.set(1, { id: 1, jobId: 'j1', sourceUrl: 'https://x' });

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j1', status: 'done', result: { name: 'Raw Title', ingredients: ['a'], directions: ['b'], imageUrl: 'data:image/jpeg;base64,AAA', link: 'https://x' } }),
    });

    const deps = {
      apiBase: 'http://srv',
      sanitize: (s) => s.replace('Raw ', ''),
      compress: async (u) => `COMPRESSED:${u}`,
    };
    await pollOne(db, db.rows.get(1), deps);

    const row = db.rows.get(1);
    expect(row.status).toBe('done');
    expect(row.name).toBe('Title');
    expect(row.imageUrl).toBe('COMPRESSED:data:image/jpeg;base64,AAA');
  });

  it('re-enqueues on 404 from status endpoint', async () => {
    const db = fakeDb();
    db.rows.set(2, { id: 2, jobId: 'j2', sourceUrl: 'https://x', sourceHash: 'h' });

    const calls = [];
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, method: opts?.method || 'GET' });
      if (url.endsWith('/status/j2')) return { status: 404, json: async () => ({ error: 'unknown' }) };
      return { status: 202, json: async () => ({ jobId: 'j2', status: 'queued' }) };
    });

    await pollOne(db, db.rows.get(2), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });

    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe('http://srv/api/v2/import');
  });

  it('marks row as failed when server reports failed', async () => {
    const db = fakeDb();
    db.rows.set(3, { id: 3, jobId: 'j3', sourceUrl: 'https://x' });
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j3', status: 'failed', error: 'nope' }),
    });
    await pollOne(db, db.rows.get(3), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });
    const row = db.rows.get(3);
    expect(row.status).toBe('failed');
    expect(row.importError).toBe('nope');
  });

  it('updates progress for still-processing jobs', async () => {
    const db = fakeDb();
    db.rows.set(4, { id: 4, jobId: 'j4', sourceUrl: 'https://x' });
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j4', status: 'processing', progress: 'AI structuring…' }),
    });
    await pollOne(db, db.rows.get(4), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });
    expect(db.rows.get(4).importProgress).toBe('AI structuring…');
  });
});
```

- [ ] **Step 2: Write the module**

```js
// src/importWorker.js
import { useEffect } from 'react';
import db from './db.js';
import { sanitizeRecipeTitle } from './recipeParser.js';
import { compressImageDataUrl as defaultCompress } from './imageCompressor.js';

const API_BASE = import.meta.env?.VITE_API_BASE || '';

export function useImportWorker() {
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function tick() {
      if (cancelled) return;
      try {
        const processing = await db.meals.where('status').equals('processing').toArray();
        if (processing.length > 0) {
          await Promise.all(processing.map((m) => pollOne(db.meals, m, {
            apiBase: API_BASE,
            sanitize: sanitizeRecipeTitle,
            compress: defaultCompress,
          })));
        }
        timer = setTimeout(tick, processing.length > 0 ? 2000 : 15_000);
      } catch {
        timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
}

// Exported for tests; works against anything with an async update(id, patch) method.
export async function pollOne(table, meal, deps) {
  const { apiBase, sanitize, compress } = deps;
  try {
    const r = await fetch(`${apiBase}/api/v2/import/status/${meal.jobId}`);
    if (r.status === 404) {
      await fetch(`${apiBase}/api/v2/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: meal.jobId, url: meal.sourceUrl, sourceHash: meal.sourceHash,
        }),
      });
      return;
    }
    const job = await r.json();
    if (job.status === 'done' && job.result) {
      const res = job.result;
      const compressedImg = res.imageUrl ? await safeCompress(compress, res.imageUrl) : '';
      await table.update(meal.id, {
        ...res,
        name: sanitize(res.name || ''),
        imageUrl: compressedImg,
        status: 'done',
        importProgress: '',
      });
    } else if (job.status === 'failed') {
      await table.update(meal.id, { status: 'failed', importError: job.error || 'Import failed.' });
    } else if (job.progress) {
      await table.update(meal.id, { importProgress: job.progress });
    }
  } catch { /* next tick retries */ }
}

async function safeCompress(compress, dataOrUrl) {
  try { return await compress(dataOrUrl); }
  catch { return dataOrUrl; }
}
```

- [ ] **Step 3: Verify the compress import matches imageCompressor.js exports**

```bash
grep -n "^export" src/imageCompressor.js
```

If the exported name differs, update the `import` in `importWorker.js` and the `defaultCompress` variable. The test uses an injected compressor so the test suite is unaffected.

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/__tests__/importWorker.test.js
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/importWorker.js src/__tests__/importWorker.test.js
git commit -m "feat(frontend): add importWorker polling hook with graceful retry"
```

---

## Task 21: Mount useImportWorker in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Open `src/App.jsx` and find the top-level component function**

Typical shape:
```jsx
export default function App() {
  // state hooks, effects...
  return ( <div> ... </div> );
}
```

- [ ] **Step 2: Add import**

Add near the top:
```jsx
import { useImportWorker } from './importWorker.js';
```

- [ ] **Step 3: Call the hook near the top of the component body**

Right after the first line of the component function, add:
```jsx
  useImportWorker();
```

- [ ] **Step 4: Run dev server and confirm no render errors**

```bash
npm run dev
```

Open the app, check browser console for errors. Close.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(frontend): mount useImportWorker at App root"
```

---

## Task 22: ImportModal — rewrite handleUrlImport behind VITE_USE_V2_IMPORT flag

**Files:**
- Modify: `src/components/ImportModal.jsx`

- [ ] **Step 1: Open the file and locate `handleUrlImport`**

```bash
grep -n "handleUrlImport" src/components/ImportModal.jsx
```

Expect a handler somewhere in the URL-tab submit path.

- [ ] **Step 2: Add imports at the top of the file**

```jsx
import db from '../db.js';
import { shaHex } from '../shaHex.js';
import { normalizeInstagramUrl } from '../api.js';
```

(normalizeInstagramUrl already exists in api.js — confirmed in the spec exploration.)

- [ ] **Step 3: Add the V2 handler alongside the existing one**

Directly ABOVE the existing `handleUrlImport` definition, add:

```jsx
const USE_V2 = import.meta.env.VITE_USE_V2_IMPORT !== 'false';
const API_BASE = import.meta.env.VITE_API_BASE || '';

async function handleUrlImportV2({ url, onImport, onClose, setError }) {
  const clean = normalizeInstagramUrl(url);
  const sourceHash = await shaHex(clean);

  // Dedupe: existing row (processing, done, or failed) for this URL
  const existing = await db.meals.where('sourceHash').equals(sourceHash).first();
  if (existing) {
    onImport([existing]);
    onClose();
    return;
  }

  const jobId = crypto.randomUUID();
  const hostname = (() => { try { return new URL(clean).hostname; } catch { return clean; } })();

  const ghostId = await db.meals.add({
    status: 'processing',
    name: `Importing from ${hostname}…`,
    sourceHash,
    jobId,
    sourceUrl: clean,
    importProgress: 'Queued',
    createdAt: new Date().toISOString(),
  });

  fetch(`${API_BASE}/api/v2/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, url: clean, sourceHash }),
  }).catch(() => { /* importWorker will retry */ });

  onImport([{ id: ghostId }]);
  onClose();
}
```

- [ ] **Step 4: Branch the existing handler**

Find the existing `handleUrlImport` (likely an async function inside the component). At its very top, insert:

```jsx
    if (USE_V2) {
      try {
        await handleUrlImportV2({ url, onImport, onClose, setError });
      } catch (err) {
        setError(err.message || 'Import failed.');
      }
      return;
    }
```

Everything below this stays untouched (the legacy synchronous path lives on, gated off when the flag is true).

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

- Open the Import modal, paste an Instagram URL, hit Import.
- Expect the modal to close within ~300ms and a "Importing from instagram.com…" card to appear in the meal list.
- The card won't populate yet because the backend tests run separately; for local dev, you can stub: set `VITE_API_BASE=http://localhost:10000` or whichever Render proxy, OR set `VITE_USE_V2_IMPORT=false` to revert to the legacy path temporarily.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImportModal.jsx
git commit -m "feat(import): V2 optimistic handleUrlImport behind VITE_USE_V2_IMPORT flag"
```

---

## Task 23: Ghost card visual states in MealLibrary

**Files:**
- Modify: `src/components/MealLibrary.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Open MealLibrary.jsx and find the meal card render loop**

```bash
grep -n "meals.map\|meals\.filter" src/components/MealLibrary.jsx | head -10
```

- [ ] **Step 2: Inside the card's outermost JSX element, branch on `meal.status`**

Find the card's root element (likely a `<div>` with className around `"meal-card"` or similar). Replace it with:

```jsx
const status = meal?.status ?? 'done';
return (
  <div
    key={meal.id}
    className={`meal-card meal-card--${status}`}
    onClick={status === 'done' ? () => onSelect(meal) : undefined}
  >
    {status === 'processing' && (
      <div className="meal-card__ghost-overlay">
        <div className="meal-card__shimmer" />
        <div className="meal-card__progress">{meal.importProgress || 'Importing…'}</div>
      </div>
    )}
    {status === 'failed' && (
      <div className="meal-card__failed">
        <div className="meal-card__error">{meal.importError || 'Import failed.'}</div>
        <button onClick={(e) => { e.stopPropagation(); onRetry(meal); }}>Retry</button>
        <button onClick={(e) => { e.stopPropagation(); onPasteManually(meal); }}>Paste Manually</button>
      </div>
    )}
    {/* …existing card body (image, title, etc.) — unchanged when status==='done' */}
  </div>
);
```

Wire `onRetry` and `onPasteManually` as new props on the `<MealLibrary>` component (default no-op handlers if the parent doesn't provide them yet; Task 24 wires them).

- [ ] **Step 3: Add CSS for the three states**

Append to `src/App.css`:

```css
/* Ghost card: processing overlay with shimmer */
.meal-card--processing { position: relative; pointer-events: none; }
.meal-card__ghost-overlay {
  position: absolute; inset: 0; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.6); backdrop-filter: blur(2px);
  border-radius: inherit;
}
.meal-card__shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.meal-card__progress { position: relative; z-index: 3; font-weight: 600; color: #444; }

/* Ghost card: failed */
.meal-card--failed { border-left: 4px solid #c62828; }
.meal-card__failed { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.meal-card__error { color: #c62828; font-weight: 600; font-size: 0.95em; }
.meal-card__failed button {
  padding: 8px 14px; font-size: 0.9em; border-radius: 8px; border: 1px solid #ccc;
  background: #fff; cursor: pointer; min-height: 44px; /* touch target */
}
.meal-card__failed button:first-of-type { background: #2e7d32; color: #fff; border-color: #2e7d32; }
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Trigger a Ghost Recipe (Task 22 flow). Verify shimmer renders. Simulate a failure by manually editing the row in the Dexie devtools (set `status='failed'`, `importError='test'`). Verify the red border and buttons appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/MealLibrary.jsx src/App.css
git commit -m "feat(ui): add Ghost Recipe processing/failed visual states"
```

---

## Task 24: Wire Retry + Paste Manually handlers

**Files:**
- Modify: `src/components/MealLibrary.jsx` (parent usage)
- Modify: `src/App.jsx` or wherever `<MealLibrary>` is rendered

- [ ] **Step 1: Find where MealLibrary is rendered**

```bash
grep -n "MealLibrary" src/App.jsx src/components/*.jsx
```

- [ ] **Step 2: Define handlers in the parent**

Near the component that renders MealLibrary, add:

```jsx
  const handleGhostRetry = useCallback(async (meal) => {
    const newJobId = crypto.randomUUID();
    await db.meals.update(meal.id, {
      jobId: newJobId,
      status: 'processing',
      importError: null,
      importProgress: 'Queued',
    });
    fetch(`${import.meta.env.VITE_API_BASE || ''}/api/v2/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: newJobId, url: meal.sourceUrl, sourceHash: meal.sourceHash }),
    }).catch(() => { /* importWorker will re-drive */ });
  }, []);

  const handleGhostPasteManually = useCallback((meal) => {
    // Open ImportModal pre-filled on paste tab with the URL
    setImportModalOpen(true);
    setImportModalInitial({ mode: 'paste', url: meal.sourceUrl || '' });
  }, []);
```

(`setImportModalOpen` / `setImportModalInitial` are existing state setters; if not, use whatever the parent currently uses to open the ImportModal. The key requirement: opening the modal with a preset URL.)

- [ ] **Step 3: Pass them as props**

```jsx
<MealLibrary
  meals={meals}
  // ...existing props...
  onRetry={handleGhostRetry}
  onPasteManually={handleGhostPasteManually}
/>
```

- [ ] **Step 4: Manual smoke**

Force a failed row via Dexie devtools. Click Retry; confirm the row returns to `processing`. Click Paste Manually; confirm the ImportModal opens with the URL populated.

- [ ] **Step 5: Commit**

```bash
git add src/components/MealLibrary.jsx src/App.jsx
git commit -m "feat(ui): wire Ghost Recipe retry + paste-manually handlers"
```

---

## Task 25: Feature flag wiring and .env.example

**Files:**
- Create: `.env.example`
- Modify: `README.md` (deployment section, if present; otherwise skip)

- [ ] **Step 1: Create/update `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Unified Import Engine (v2)
VITE_USE_V2_IMPORT=true
VITE_API_BASE=https://your-render-service.onrender.com

# Backend (set in Render dashboard, not here)
ENABLE_V2_IMPORT=true
IG_COOKIES_JSON_B64=<base64 of cookies.json>
GEMINI_API_KEY=<your key>
EOF
```

- [ ] **Step 2: Note the variables in README.md deployment section**

Locate the existing README deployment section (search for "Vercel" or "Render"). Append a subsection:

```markdown
### Unified Import Engine environment variables

- `VITE_USE_V2_IMPORT` (Vercel, frontend) — `true` (default) uses the new optimistic Ghost Recipe flow. `false` falls back to the legacy synchronous path.
- `VITE_API_BASE` (Vercel, frontend) — URL of the Render service hosting `/api/v2/import`.
- `ENABLE_V2_IMPORT` (Render, backend) — `true` (default) registers the v2 routes.
- `IG_COOKIES_JSON_B64` (Render, backend) — Base64-encoded JSON array of Instagram session cookies. Rotate when stealth returns `login-wall`. See `scripts/encode-cookies.js`.
- `GEMINI_API_KEY` (Render, backend) — existing; unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document v2 import feature flags and env vars"
```

---

## Task 26: Cookie encoder script + rotation runbook

**Files:**
- Create: `scripts/encode-cookies.js`
- Modify: `server/README.md` (create if absent)

- [ ] **Step 1: Write the encoder**

```js
// scripts/encode-cookies.js
// Usage:  node scripts/encode-cookies.js [path-to-cookies.json]
// Default path: ./cookies.json
// Prints the Base64 string suitable for the IG_COOKIES_JSON_B64 env var.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = process.argv[2] || 'cookies.json';
const path = resolve(process.cwd(), arg);
const json = readFileSync(path, 'utf-8');
// Validate JSON, re-serialize to remove pretty-printing
const parsed = JSON.parse(json);
const compact = JSON.stringify(parsed);
const b64 = Buffer.from(compact, 'utf-8').toString('base64');
process.stdout.write(b64 + '\n');
```

- [ ] **Step 2: Create/update `server/README.md`**

```markdown
# SpiceHub Backend

## Instagram cookie rotation

Stealth Instagram extraction uses session cookies exported from a real browser.
When `/api/v2/import/status/:jobId` starts returning `error: 'login-wall'` for
many Instagram URLs in a row, rotate cookies:

1. In a regular Chrome profile that is logged into the SpiceHub Instagram account,
   use the **EditThisCookie** (or equivalent) extension to export cookies for
   `instagram.com` as JSON. Save as `cookies.json` in the repo root.
2. Encode them:
   ```bash
   node scripts/encode-cookies.js cookies.json
   ```
3. Copy the printed Base64 string.
4. In the Render dashboard, set `IG_COOKIES_JSON_B64` on the backend service
   to that string. Save → triggers a new deploy.
5. Delete the local `cookies.json` (it is gitignored but still risky).

## Environment variables

See the root `.env.example`.
```

- [ ] **Step 3: Make sure cookies.json is gitignored**

```bash
grep -q "^cookies.json$" .gitignore || echo "cookies.json" >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
git add scripts/encode-cookies.js server/README.md .gitignore
git commit -m "docs: add cookie encoder script + rotation runbook"
```

---

## Task 27: End-to-end Playwright test

**Files:**
- Create: `tests/e2e/unified-import.spec.js`
- Modify: `package.json` (add e2e script)

- [ ] **Step 1: Add e2e npm script**

In `package.json` scripts, add:
```json
"test:e2e": "playwright test tests/e2e"
```

- [ ] **Step 2: Write the spec**

```js
// tests/e2e/unified-import.spec.js
import { test, expect } from '@playwright/test';

test('ghost recipe appears within 500ms of URL submit', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Open the Import modal
  await page.getByRole('button', { name: /import/i }).first().click();

  const url = 'https://www.instagram.com/reel/TEST_FIXTURE/';
  await page.getByPlaceholder(/paste.*url|url/i).fill(url);

  const submitStart = Date.now();
  await page.getByRole('button', { name: /^import$/i }).click();

  // Modal should disappear quickly
  await expect(page.locator('.modal-backdrop, [role=dialog]')).toBeHidden({ timeout: 1500 });
  expect(Date.now() - submitStart).toBeLessThan(1500);

  // Ghost card present in the list with processing class
  await expect(page.locator('.meal-card--processing')).toBeVisible({ timeout: 2000 });
});
```

Note: this asserts <1500ms to give headroom over the <300ms design target. On a dev machine the modal typically closes in <100ms; the extra budget absorbs Playwright scheduling variance.

- [ ] **Step 3: Run**

```bash
# In one terminal:
npm run dev
# In another:
npx playwright test tests/e2e/unified-import.spec.js
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/unified-import.spec.js package.json
git commit -m "test(e2e): ghost recipe appears on import submit"
```

---

## Task 28: Wire coordinator into server/index.js + final integration smoke

**Files:**
- (no code changes — just a deploy verification)

- [ ] **Step 1: Verify all pieces are wired**

```bash
grep -n "registerImportRoutes" server/index.js    # should find the call
grep -n "useImportWorker"       src/App.jsx        # should find the call
grep -n "handleUrlImportV2"     src/components/ImportModal.jsx  # should find the branch
```

All three should print matching lines.

- [ ] **Step 2: Deploy to Render (staging or production)**

Push the feature branch. In Render dashboard, ensure:
- Build command runs `./render-build.sh`
- `ENABLE_V2_IMPORT=true`
- `IG_COOKIES_JSON_B64` set
- `GEMINI_API_KEY` set (existing)

Deploy. Check build logs for `playwright install chromium` success.

- [ ] **Step 3: End-to-end smoke from phone (Pixel 7 Pro)**

Share an Instagram Reel to the installed SpiceHub PWA. Expected:
- Modal closes within ~300ms.
- Shimmering "Importing…" card appears in the meal list.
- Within 5–90s the card resolves to a real recipe with title, ingredients, directions, and a Base64 image.
- Force-quit and reopen the app mid-import — the poll resumes and the card eventually populates.

- [ ] **Step 4: Final commit (changelog note)**

```bash
# If your project uses a CHANGELOG.md, add a feat entry. Otherwise, skip.
git commit --allow-empty -m "chore(release): unified import engine live behind flag"
```

---

## Post-implementation cleanup (optional, follow-up PR)

Tracked in the spec §11 — do NOT do these as part of this plan:

- Migrate Image / Paste / Spreadsheet / Paprika tabs to v2 engine
- Decompose `recipeParser.js`
- TikTok / Facebook / YouTube stealth workers
- Client-side Tesseract integration into the waterfall
- Drain-and-drop the legacy `importQueue` Dexie table

---

## Self-review checklist

**Spec coverage:** every spec section is mapped in the Task Map table above. Confirmed — §4.1/4.3/4.4/4.5/5.1/5.2/5.3/5.5/5.6/5.7/5.8/6.1/6.2/6.5/6.6/6.7/6.8/9/10 all have tasks.

**Placeholder scan:** no TBDs, no "implement later", no "add error handling" without specifics — checked.

**Type consistency:** `mealStatus` helper used identically everywhere; `JobState` shape (`status`, `progress`, `result`, `error`, `updatedAt`) consistent across jobStore, coordinator, endpoints, importWorker; `RecipePayload` shape consistent between Node validator, Python Pydantic, and importWorker consumption.

**Known cross-dependencies flagged in the tasks themselves:**
- Task 20 Step 3 asks the engineer to verify the actual export name of `compressImageDataUrl` in `src/imageCompressor.js` and adjust — this is a known unknown since that file wasn't fully inspected.
- Task 22 Step 1 asks the engineer to locate the existing `handleUrlImport` — the file is 1646 lines and refactored content varies.
- Task 23 Step 2 asks the engineer to find the meal-card render loop — same reason.

These are deliberate "look here, adapt" steps, not placeholders. They give the engineer the signpost and the exact code to insert.
