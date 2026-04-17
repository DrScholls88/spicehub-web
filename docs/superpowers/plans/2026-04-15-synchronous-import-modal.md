# Synchronous Import Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ghost-recipe/background-polling import system with a synchronous in-modal progress bar that shows live stage labels, writes to Dexie exactly once on success, and hands off to BrowserAssist on failure.

**Architecture:** The ImportModal fires one POST to `/api/v2/import/sync`, keeps the modal open with animated stage labels advancing on a timer, then closes on success or transitions to BrowserAssist on failure. The backend runs the full waterfall synchronously and returns a complete recipe JSON (or 422 with partial data). No ghost rows, no polling, no jobStore for this path.

**Tech Stack:** React (useState/useEffect/useRef), Express, existing coordinator.js waterfall, Dexie v4, AbortController, Playwright resource blocking.

---

## File Map

| File | Change |
|---|---|
| `server/importRoutes.js` | Add `GET /api/v2/ping` and `POST /api/v2/import/sync` |
| `server/coordinator.js` | Add `runWaterfallSync()` export (no jobStore) |
| `server/python/instagram_stealth_fetch.py` | Add resource-type blocking to Playwright |
| `server/__tests__/endpoints.test.js` | Add tests for ping + sync endpoints |
| `server/__tests__/coordinator.test.js` | Add test for `runWaterfallSync` |
| `src/components/ImportModal.jsx` | Replace V2 ghost handler with sync progress handler |
| `src/components/BrowserAssist.jsx` | Add `initialCapturedText` prop |
| `src/components/MealLibrary.jsx` | Remove ghost overlays; safe array access |
| `src/App.jsx` | Remove `useImportWorker`, `onRetry`, `onPasteManually` |
| `src/App.css` | Remove ghost recipe CSS block (lines 14198–14223) |
| `src/db.js` | Remove `mealStatus()` export |

---

## Task 1: Add `runWaterfallSync` to coordinator

**Files:**
- Modify: `server/coordinator.js`

- [ ] **Step 1: Add `runWaterfallSync` export at the bottom of coordinator.js**

The existing `runWaterfall` writes progress to jobStore. `runWaterfallSync` runs the same steps but returns the result directly and throws `ExtractError` on failure. The internal `finalize()` helper is already defined and can be shared.

Replace the last line of `server/coordinator.js` (after the `finalize` function closing brace) with:

```js
// ── Synchronous waterfall (no jobStore) ──────────────────────────────────────
// Returns the finalized recipe payload on success.
// Throws ExtractError with { message, capturedText } on failure.

export class ExtractError extends Error {
  constructor(message, capturedText = '') {
    super(message);
    this.name = 'ExtractError';
    this.capturedText = capturedText;
  }
}

export async function runWaterfallSync({ url }, deps = defaultDeps) {
  // STEP 1 — metadata_pass
  const meta = await deps.runMetadata({ url });
  if (meta.ok && (meta.confidence ?? 0) >= 0.9) {
    const result = await finalize(meta.recipe, { sourceUrl: url, deps });
    if (!result) throw new ExtractError('Metadata found but failed validation.');
    return result;
  }

  // STEP 2 — stealth fetch (Instagram only)
  let stealth = null;
  if (isInstagramUrl(url)) {
    stealth = await deps.runStealth({ url });
    if (stealth?.ok === false && stealth?.loginWall) {
      throw new ExtractError('Instagram login required. Try BrowserAssist.');
    }
  }

  // STEP 3 — build rawSources
  const rawSources = [
    meta.ok ? { kind: 'metadata', text: JSON.stringify(meta.recipe) } : null,
    stealth?.ok ? { kind: 'caption', text: stealth.caption || '', imageUrls: stealth.imageUrls || [] } : null,
  ].filter(Boolean);

  const capturedText = rawSources.map(s => s.text).join('\n');

  if (rawSources.length === 0) {
    throw new ExtractError('No recipe data could be extracted.', capturedText);
  }

  // STEP 4 — structure + persist image in parallel
  const imageUrl = stealth?.imageUrls?.[0] ?? '';
  const [structured, persistedImage] = await Promise.all([
    deps.structureWithGemini(rawSources, { sourceUrl: url }),
    imageUrl ? deps.persistImage(imageUrl) : Promise.resolve(''),
  ]);

  if (!structured.ok) {
    throw new ExtractError(structured.error || 'AI structuring failed.', capturedText);
  }

  const mergedRecipe = { ...structured.recipe };
  if (!firstImageUrl(mergedRecipe) && persistedImage) {
    mergedRecipe.image = persistedImage;
  }

  const payload = {
    name: (mergedRecipe.name || mergedRecipe.title || '').toString(),
    ingredients: asStringArray(mergedRecipe.ingredients),
    directions:  asStringArray(mergedRecipe.directions || mergedRecipe.instructions),
    imageUrl:    persistedImage || firstImageUrl(mergedRecipe) || '',
    link:        url,
    yield:       (mergedRecipe.yield || mergedRecipe.servings || '').toString(),
    prepTime:    (mergedRecipe.prepTime || '').toString(),
    cookTime:    (mergedRecipe.cookTime || '').toString(),
  };

  const { ok, value } = validateRecipePayload(payload);
  if (!ok) throw new ExtractError('Structured recipe failed validation.', capturedText);
  return value;
}
```

- [ ] **Step 2: Verify the file still exports `runWaterfall` (existing) and now also `runWaterfallSync` and `ExtractError`**

```bash
grep -n "^export" server/coordinator.js
```
Expected output includes three lines:
```
export async function runWaterfall(
export class ExtractError
export async function runWaterfallSync(
```

---

## Task 2: Add `/api/v2/ping` and `/api/v2/import/sync` routes

**Files:**
- Modify: `server/importRoutes.js`

- [ ] **Step 1: Write the failing tests first**

Open `server/__tests__/endpoints.test.js` and append these tests:

```js
import { runWaterfallSync as defaultSync, ExtractError } from '../coordinator.js';

describe('GET /api/v2/ping', () => {
  it('returns 200 immediately', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).get('/api/v2/ping');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('POST /api/v2/import/sync', () => {
  it('returns 400 when url is missing', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).post('/api/v2/import/sync').send({});
    expect(r.status).toBe(400);
  });

  it('returns 200 with recipe on success', async () => {
    const recipe = { name: 'Tacos', ingredients: ['beef'], directions: ['cook'], imageUrl: '', link: 'https://x', yield: '', prepTime: '', cookTime: '' };
    const app = mountAppSync(async () => recipe);
    const r = await request(app).post('/api/v2/import/sync').send({ url: 'https://x.com/recipe' });
    expect(r.status).toBe(200);
    expect(r.body.recipe.name).toBe('Tacos');
  });

  it('returns 422 with partial text on ExtractError', async () => {
    const app = mountAppSync(async () => { throw new ExtractError('blocked', 'some captured text'); });
    const r = await request(app).post('/api/v2/import/sync').send({ url: 'https://instagram.com/p/x' });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('extraction_failed');
    expect(r.body.partial.capturedText).toBe('some captured text');
  });
});
```

You also need a `mountAppSync` helper — add it after `mountApp`:

```js
function mountAppSync(runWaterfallSyncMock) {
  const app = express();
  app.use(express.json());
  registerImportRoutes(app, { runWaterfall: async () => {}, runWaterfallSync: runWaterfallSyncMock });
  return app;
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/__tests__/endpoints.test.js
```
Expected: FAIL — `mountAppSync is not defined` and route 404s.

- [ ] **Step 3: Update `registerImportRoutes` to accept `runWaterfallSync` and add the two new routes**

Replace `server/importRoutes.js` entirely:

```js
// server/importRoutes.js
import * as jobStore from './jobStore.js';
import { runWaterfall as defaultRunWaterfall, runWaterfallSync as defaultRunWaterfallSync, ExtractError } from './coordinator.js';

export function registerImportRoutes(app, {
  runWaterfall = defaultRunWaterfall,
  runWaterfallSync = defaultRunWaterfallSync,
} = {}) {

  // ── Warmup ping (keeps Render alive) ────────────────────────────────────────
  app.get('/api/v2/ping', (_req, res) => res.json({ ok: true }));

  // ── Synchronous waterfall (new primary path) ─────────────────────────────────
  app.post('/api/v2/import/sync', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    try {
      const recipe = await runWaterfallSync({ url });
      return res.json({ recipe });
    } catch (err) {
      if (err instanceof ExtractError || err?.name === 'ExtractError') {
        return res.status(422).json({
          error: 'extraction_failed',
          message: err.message,
          partial: { capturedText: err.capturedText || '' },
        });
      }
      console.error('[sync import error]', err);
      return res.status(500).json({ error: 'internal_error', message: err.message });
    }
  });

  // ── Background async import (kept for compatibility) ────────────────────────
  app.post('/api/v2/import', async (req, res) => {
    const { jobId, url, sourceHash } = req.body || {};
    if (!jobId || !url) return res.status(400).json({ error: 'jobId and url required' });

    const existing = jobStore.get(jobId);
    if (existing) return res.status(202).json({ jobId, status: existing.status });

    jobStore.put(jobId, { status: 'queued', url, sourceHash });
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/__tests__/endpoints.test.js
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/coordinator.js server/importRoutes.js server/__tests__/endpoints.test.js
git commit -m "feat(server): add runWaterfallSync + /api/v2/ping + /api/v2/import/sync"
```

---

## Task 3: Playwright resource blocking in instagram_stealth_fetch.py

**Files:**
- Modify: `server/python/instagram_stealth_fetch.py`

- [ ] **Step 1: Find the `page.goto()` call in instagram_stealth_fetch.py**

```bash
grep -n "page.goto\|page.route\|route\|block" server/python/instagram_stealth_fetch.py | head -20
```

- [ ] **Step 2: Add resource blocking before the `page.goto()` call**

Find the line that reads `await page.goto(url, ...)` and insert these lines immediately BEFORE it:

```python
    # Block heavyweight resources to cut fetch time by 2-3s
    async def _block_unnecessary(route):
        if route.request.resource_type in {"image", "stylesheet", "font", "media", "other"}:
            await route.abort()
        else:
            await route.continue_()
    await page.route("**/*", _block_unnecessary)
```

- [ ] **Step 3: Verify the file is valid Python**

```bash
python3 -m py_compile server/python/instagram_stealth_fetch.py && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/python/instagram_stealth_fetch.py
git commit -m "perf(python): block images/fonts/media in Playwright to cut IG fetch time"
```

---

## Task 4: Remove `useImportWorker` and ghost handlers from App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Remove the `useImportWorker` import and call**

In `src/App.jsx`:

Remove line 2:
```js
import { useImportWorker } from './importWorker.js';
```

Remove line 60:
```js
  useImportWorker();
```

- [ ] **Step 2: Remove `onRetry` and `onPasteManually` from the MealLibrary render**

Find this block (around line 585–602):
```js
            onRetry={async (meal) => {
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
              }).catch(() => {});
            }}
            onPasteManually={(meal) => {
              setImportModalKey(k => k + 1);
              setShowImportFor('meals');
            }}
```

Delete those lines entirely (just the two props — keep the surrounding MealLibrary JSX).

- [ ] **Step 3: Verify no remaining references**

```bash
grep -n "useImportWorker\|onRetry\|onPasteManually" src/App.jsx
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "chore(app): remove ghost-recipe worker wiring and retry handlers"
```

---

## Task 5: Remove ghost overlays from MealLibrary + fix safe array access

**Files:**
- Modify: `src/components/MealLibrary.jsx`

- [ ] **Step 1: Remove `onRetry` and `onPasteManually` from the component signature**

Line 23 currently reads:
```js
export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate, onRetry = () => {}, onPasteManually = () => {} }) {
```

Replace with:
```js
export default function MealLibrary({ meals, onAdd, onEdit, onDelete, onViewDetail, onShare, onImport, onReload, onToast, onToggleFavorite, onRate }) {
```

- [ ] **Step 2: Remove `mealStatus` and ghost overlay renders from the `sorted.map` block**

Find the `sorted.map((meal, idx) => {` block. Replace the entire opening section with a simplified version. The current block starts:

```js
          sorted.map((meal, idx) => {
            const mealStatus = meal?.status ?? 'done';
            return (
            <div
              key={meal.id}
              className={`ml-tile${selectMode && selectedIds.has(meal.id) ? ' ml-tile-selected' : ''} meal-card--${mealStatus}`}
```

Replace with:
```js
          sorted.map((meal, idx) => (
            <div
              key={meal.id}
              className={`ml-tile${selectMode && selectedIds.has(meal.id) ? ' ml-tile-selected' : ''}`}
```

- [ ] **Step 3: Remove the `onClick` guard that blocked non-done cards and the ghost overlays**

Find this block inside the tile div:
```js
              onClick={() => {
                if (mealStatus !== 'done') return;
                if (selectMode) {
```

Replace with:
```js
              onClick={() => {
                if (selectMode) {
```

- [ ] **Step 4: Remove the ghost overlay JSX blocks**

Find and delete these two JSX blocks entirely:
```jsx
              {/* Ghost Recipe overlays */}
              {mealStatus === 'processing' && (
                <div className="meal-card__ghost-overlay">
                  <div className="meal-card__shimmer" />
                  <div className="meal-card__progress">{meal.importProgress || 'Importing…'}</div>
                </div>
              )}
              {mealStatus === 'failed' && (
                <div className="meal-card__failed">
                  <div className="meal-card__error">{meal.importError || 'Import failed.'}</div>
                  <button onClick={(e) => { e.stopPropagation(); onRetry(meal); }}>Retry</button>
                  <button onClick={(e) => { e.stopPropagation(); onPasteManually(meal); }}>Paste Manually</button>
                </div>
              )}
```

Also update the select checkbox guard that previously checked `mealStatus === 'done'`:
```jsx
              {selectMode && mealStatus === 'done' && (
```
Change to:
```jsx
              {selectMode && (
```

- [ ] **Step 5: Fix `.ingredients.length` and `.directions.length` to use safe access**

Find the meta line (around old line 332):
```jsx
                  {meal.ingredients.length} ing · {meal.directions.length} steps
```

Replace with:
```jsx
                  {(meal.ingredients || []).length} ing · {(meal.directions || []).length} steps
```

Also fix the `.notes.length` guard two lines below — it already has `meal.notes &&` so it's safe.

- [ ] **Step 6: Fix the map closing syntax**

Since we changed `sorted.map((meal, idx) => {` with `return (...)` to `sorted.map((meal, idx) => (`, find the closing of the map. The old pattern had:
```js
            );
          })
```
(two closings). The new arrow-function expression just needs:
```js
          ))
```
Make sure the JSX closes properly: `</div>` (tile) + `)` (arrow fn expression) + `)` (map call).

- [ ] **Step 7: Verify no remaining ghost references**

```bash
grep -n "mealStatus\|onRetry\|onPasteManually\|ghost-overlay\|meal-card__failed\|meal-card--" src/components/MealLibrary.jsx
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/MealLibrary.jsx
git commit -m "chore(ui): remove ghost recipe overlays from MealLibrary; safe array access"
```

---

## Task 6: Remove ghost CSS from App.css

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Find and delete the ghost recipe CSS block**

The block starts at line 14198 with this comment:
```css
/* ── Ghost Recipe: processing / failed visual states ──────────────────────── */
```
And ends after:
```css
.meal-card__failed button:first-of-type { background: #2e7d32; color: #fff; border-color: #2e7d32; }
```

Delete everything from the comment through the last `.meal-card__failed button:first-of-type` rule. This is approximately lines 14198–14223.

- [ ] **Step 2: Verify removed**

```bash
grep -n "Ghost Recipe\|meal-card--processing\|meal-card__ghost\|meal-card--failed\|meal-card__failed" src/App.css
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "chore(css): remove ghost recipe shimmer and failed card styles"
```

---

## Task 7: Remove `mealStatus` from db.js

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Find and remove the mealStatus export**

```bash
grep -n "mealStatus" src/db.js
```

Delete the entire `export function mealStatus` block (it's a one-liner like):
```js
export function mealStatus(meal) { return meal?.status ?? 'done'; }
```

- [ ] **Step 2: Verify no remaining usages**

```bash
grep -rn "mealStatus" src/
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "chore(db): remove mealStatus helper (ghost recipe cleanup)"
```

---

## Task 8: Add `initialCapturedText` prop to BrowserAssist

**Files:**
- Modify: `src/components/BrowserAssist.jsx`

- [ ] **Step 1: Find the component signature**

```bash
grep -n "export default function BrowserAssist" src/components/BrowserAssist.jsx
```
Current signature: `function BrowserAssist({ url, onRecipeExtracted, onFallbackToText })`

- [ ] **Step 2: Add the new prop and wire it to the paste textarea**

Update the signature:
```js
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText, initialCapturedText = '' }) {
```

- [ ] **Step 3: Find where BrowserAssist renders its paste/manual text area**

```bash
grep -n "pasteText\|manual.*text\|textarea\|setPasteText" src/components/BrowserAssist.jsx | head -20
```

Find the `useState` for the paste text area (likely `const [pasteText, setPasteText] = useState('')`) and change it to:
```js
  const [pasteText, setPasteText] = useState(initialCapturedText);
```

This means if `initialCapturedText` is provided (from a failed sync import), the user sees the captured text already filled in when BrowserAssist opens.

- [ ] **Step 4: Verify**

```bash
grep -n "initialCapturedText" src/components/BrowserAssist.jsx
```
Expected: 2 lines (prop destructure + useState).

- [ ] **Step 5: Commit**

```bash
git add src/components/BrowserAssist.jsx
git commit -m "feat(browser-assist): accept initialCapturedText prop for pre-filling on import failure"
```

---

## Task 9: Replace V2 ghost handler with synchronous progress handler in ImportModal

This is the biggest task. The goal is:
1. On modal open → fire warmup ping
2. On Import click → keep modal open, show progress stages, await sync POST
3. On success → write to Dexie once, close modal
4. On failure → transition to BrowserAssist with captured text

**Files:**
- Modify: `src/components/ImportModal.jsx`

- [ ] **Step 1: Remove unused ghost-import imports**

At the top of `ImportModal.jsx`, remove these imports (they were only used by handleUrlImportV2):
```js
import { shaHex } from '../shaHex.js';
```
Keep: `db`, `normalizeInstagramUrl`, `BrowserAssist` — those are still used.

- [ ] **Step 2: Remove the V2 ghost handler block**

Find and delete the entire block from line 243 to line 283:
```js
  // ── V2 optimistic Ghost Recipe handler ─────────────────────────────────────
  const USE_V2 = import.meta.env.VITE_USE_V2_IMPORT !== 'false';
  const API_BASE = import.meta.env.VITE_API_BASE || '';

  async function handleUrlImportV2(...) { ... }
```

- [ ] **Step 3: Add the sync import state and constants near the other useState declarations (around line 30–50)**

Add after the existing `useState` declarations:

```js
  // ── Sync import progress state ────────────────────────────────────────────
  const API_BASE = import.meta.env.VITE_API_BASE || '';
  const STAGES = [
    { key: 'scraping',  label: 'Checking site…',       ms: 0    },
    { key: 'fetching',  label: 'Extracting recipe…',    ms: 2500 },
    { key: 'structuring', label: 'Structuring with AI…', ms: 5500 },
    { key: 'saving',    label: 'Almost done…',          ms: 8000 },
  ];
  const [syncPhase, setSyncPhase] = useState('idle'); // 'idle'|'running'|'failed'
  const [syncStageIdx, setSyncStageIdx] = useState(0);
  const abortRef = useRef(null);
  const stageTimersRef = useRef([]);
```

- [ ] **Step 4: Add warmup ping on modal open**

Find the existing `useEffect` blocks near the top of the component body. Add this new one:

```js
  // Warmup Render on mount so it's ready by the time user clicks Import
  useEffect(() => {
    if (API_BASE) {
      fetch(`${API_BASE}/api/v2/ping`, { method: 'GET' }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Add the sync import handler function**

Add this function just before `handleUrlImport`:

```js
  // ── Synchronous import handler ────────────────────────────────────────────
  async function handleUrlImportSync(trimmedUrl) {
    // Clear any previous timers
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];

    setSyncPhase('running');
    setSyncStageIdx(0);

    // Schedule stage label advances
    STAGES.forEach((stage, idx) => {
      if (idx === 0) return; // idx 0 is immediate
      const t = setTimeout(() => setSyncStageIdx(idx), stage.ms);
      stageTimersRef.current.push(t);
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${API_BASE}/api/v2/import/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
        signal: controller.signal,
      });

      stageTimersRef.current.forEach(clearTimeout);

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const capturedText = errBody?.partial?.capturedText ?? '';
        setSyncPhase('failed');
        // Hand off to BrowserAssist
        setBrowserAssistUrl(trimmedUrl);
        setBrowserAssistMode('showing');
        // The BrowserAssist component will receive initialCapturedText via capturedTextRef
        capturedTextRef.current = capturedText;
        return;
      }

      const { recipe } = await resp.json();
      await db.meals.add({
        name: recipe.name || '',
        ingredients: recipe.ingredients || [],
        directions: recipe.directions || [],
        imageUrl: recipe.imageUrl || '',
        link: recipe.link || trimmedUrl,
        yield: recipe.yield || '',
        prepTime: recipe.prepTime || '',
        cookTime: recipe.cookTime || '',
        notes: '',
        createdAt: new Date().toISOString(),
      });

      setSyncPhase('idle');
      onImport([recipe]);
      onClose();

    } catch (err) {
      stageTimersRef.current.forEach(clearTimeout);
      if (err.name === 'AbortError') {
        setSyncPhase('idle');
        return;
      }
      setSyncPhase('failed');
      setBrowserAssistUrl(trimmedUrl);
      setBrowserAssistMode('showing');
      capturedTextRef.current = '';
    }
  }
```

Also add `capturedTextRef` near `abortRef`:
```js
  const capturedTextRef = useRef('');
```

- [ ] **Step 6: Wire `handleUrlImportSync` into `handleUrlImport`**

Find the current `handleUrlImport` function. Replace the V2 branch:

```js
  const handleUrlImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Please enter a URL.');
      return;
    }
    setError('');

    // Sync import — keep modal open, show progress, close on success
    await handleUrlImportSync(trimmedUrl);
    return;

    // (dead code below — batch import is still reached via handleBatchImport directly)
  };
```

> Note: Batch import (`handleBatchImport`) is triggered separately when the user pastes multiple URLs. That path is unchanged.

- [ ] **Step 7: Add a Cancel button handler**

Add this function near the other handlers:
```js
  function handleCancelImport() {
    abortRef.current?.abort();
    stageTimersRef.current.forEach(clearTimeout);
    setSyncPhase('idle');
    setSyncStageIdx(0);
  }
```

- [ ] **Step 8: Add the progress UI to the modal render**

Find where the modal renders the URL input area. After the URL input section and before the "Import" button, add the progress view. Look for the existing Import button JSX (something like `<button ... onClick={handleUrlImport}`). Wrap the button section with:

```jsx
      {/* Sync import progress overlay */}
      {syncPhase === 'running' && (
        <div className="sync-import-progress">
          <div className="sync-import-stages">
            {STAGES.map((stage, idx) => (
              <div
                key={stage.key}
                className={`sync-stage ${idx < syncStageIdx ? 'sync-stage--done' : ''} ${idx === syncStageIdx ? 'sync-stage--active' : ''}`}
              >
                <span className="sync-stage-dot">
                  {idx < syncStageIdx ? '✓' : idx === syncStageIdx ? '●' : '○'}
                </span>
                <span className="sync-stage-label">{stage.label}</span>
              </div>
            ))}
          </div>
          <button className="sync-cancel-btn" onClick={handleCancelImport}>
            Cancel
          </button>
        </div>
      )}
```

- [ ] **Step 9: Pass `capturedTextRef.current` to BrowserAssist**

Find where `<BrowserAssist>` is rendered in ImportModal. It currently looks like:
```jsx
<BrowserAssist
  url={browserAssistUrl}
  onRecipeExtracted={handleBrowserAssistRecipe}
  onFallbackToText={handleBrowserAssistFallback}
/>
```

Replace with:
```jsx
<BrowserAssist
  url={browserAssistUrl}
  onRecipeExtracted={handleBrowserAssistRecipe}
  onFallbackToText={handleBrowserAssistFallback}
  initialCapturedText={capturedTextRef.current}
/>
```

- [ ] **Step 10: Remove the `VITE_USE_V2_IMPORT` feature flag check**

```bash
grep -n "VITE_USE_V2_IMPORT\|USE_V2" src/components/ImportModal.jsx
```
Delete any remaining references. The sync path is now always active.

- [ ] **Step 11: Commit**

```bash
git add src/components/ImportModal.jsx
git commit -m "feat(import): synchronous in-modal progress handler replaces ghost recipe"
```

---

## Task 10: Add progress CSS to App.css

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Append the sync import progress styles**

At the very end of `src/App.css`, append:

```css
/* ── Sync Import Progress ─────────────────────────────────────────────────── */
.sync-import-progress {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0 8px;
  animation: fadeIn 0.2s ease;
}
.sync-import-stages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sync-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
  color: var(--text-secondary, #888);
  transition: color 0.3s ease;
}
.sync-stage--active {
  color: var(--text-primary, #fff);
  font-weight: 600;
}
.sync-stage--done {
  color: var(--color-success, #4caf50);
}
.sync-stage-dot {
  font-size: 0.85rem;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.sync-stage--active .sync-stage-dot {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
.sync-cancel-btn {
  align-self: center;
  background: transparent;
  border: 1px solid var(--border-color, #444);
  color: var(--text-secondary, #888);
  border-radius: 6px;
  padding: 8px 20px;
  font-size: 0.9rem;
  cursor: pointer;
  min-height: 44px;
}
.sync-cancel-btn:hover {
  border-color: var(--text-secondary, #888);
  color: var(--text-primary, #fff);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat(css): add sync import progress stage styles"
```

---

## Task 11: Cleanup — remove shaHex and importWorker if fully unused

**Files:**
- Check: `src/shaHex.js`, `src/importWorker.js`

- [ ] **Step 1: Verify shaHex is no longer imported anywhere**

```bash
grep -rn "shaHex\|from.*shaHex" src/
```
If only the file itself, it's dead code. If other files import it, leave it.

- [ ] **Step 2: Verify importWorker is no longer imported anywhere**

```bash
grep -rn "importWorker\|useImportWorker" src/
```
If nothing imports it, leave the file in place (tests still reference it) but confirm no runtime import.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```
Expected: All existing tests pass. New sync endpoint tests pass.

- [ ] **Step 4: Run the build**

```bash
npm run build
```
Expected: `✓ built` with no new errors. The `db.js` dynamic import warning is pre-existing and acceptable.

- [ ] **Step 5: Smoke test locally**

```bash
# Terminal 1
ENABLE_V2_IMPORT=true GEMINI_API_KEY=your_key node server/index.js

# Terminal 2
npm run dev
```

Open `http://localhost:5173`, navigate to Meal Library, click Import, paste a public recipe URL (e.g., `https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/`). Expected:
- Modal stays open
- Stage labels advance: "Checking site…" → "Extracting recipe…" → "Structuring with AI…" → "Almost done…"
- Within 10s: modal closes, recipe card appears in library
- No ghost/pending cards ever visible

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: clean up unused imports and verify build after sync import refactor"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Warmup ping on modal open — Task 9 Step 4
- ✅ `/api/v2/ping` endpoint — Task 2 Step 3
- ✅ `/api/v2/import/sync` endpoint — Task 2 Step 3
- ✅ `runWaterfallSync` — Task 1
- ✅ Parallel image + Gemini — Task 1 Step 1 (Promise.all)
- ✅ Playwright resource blocking — Task 3
- ✅ Progress labels time-based — Task 9 Step 3 (STAGES array with ms)
- ✅ Cancel via AbortController — Task 9 Steps 5, 7
- ✅ Write Dexie once on success — Task 9 Step 5
- ✅ BrowserAssist on failure — Task 9 Step 5
- ✅ `initialCapturedText` prop on BrowserAssist — Task 8
- ✅ Remove ghost overlays from MealLibrary — Task 5
- ✅ Remove `onRetry`/`onPasteManually` from App.jsx — Task 4
- ✅ Remove ghost CSS — Task 6
- ✅ Remove `mealStatus()` — Task 7
- ✅ Safe `.length` access — Task 5 Step 5
- ✅ Tests for new endpoints — Task 2 Step 1
- ✅ Build verification — Task 11

**No placeholders found.**

**Type consistency verified:** `recipe.imageUrl`, `recipe.link`, `recipe.yield`, `recipe.prepTime`, `recipe.cookTime` — all match what `validateRecipePayload` returns in `coordinator.js` `finalize()`.
