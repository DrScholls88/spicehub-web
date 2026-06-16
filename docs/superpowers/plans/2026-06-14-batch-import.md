# Batch Import (Multi-Share) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user shares 2+ social-media recipe links to SpiceHub at once, queue them all in a persistent Dexie `batchQueue`, process them sequentially in the background, and let the user review/save each one through the existing `ImportSheet` review UI — without changing single-URL share behavior.

**Architecture:** A new pure-function `extractMultipleUrls()` in `recipeParser.js` detects multi-URL shares at the existing App.jsx share-target entry points. Detected batches are written to a new Dexie `batchQueue` table (v13) immediately, then a new `batchImportEngine.js` module processes them one at a time using the existing `importRecipeFromUrl` + `detectImportType` functions, pausing when offline and resuming on the `online` event. A new `BatchImportQueue.jsx` modal (matching the `CookMode`/`FridgeMode` slide-up + drag-to-dismiss pattern) shows live progress via a `window` CustomEvent refresh pattern (no `dexie-react-hooks` dependency). Tapping a "ready" row opens `ImportSheet` directly into its `review` phase via two new optional props (`initialRecipe`, `initialPhase`) — no re-extraction.

**Tech Stack:** React 19, Dexie 4 (+ `fake-indexeddb` for vitest), framer-motion, lucide-react, vitest.

---

## Task 1: Add `fake-indexeddb` test setup (prerequisite)

`db.js` calls `new Dexie('SpiceHubDB')` and `db.version(N).stores(...)` at module load. `recipeParser.js` imports from `db.js`. The current vitest config has no `test` block and no IndexedDB shim, so any test that imports `recipeParser.js` or `db.js` needs IndexedDB available in the `node` test environment. `fake-indexeddb` is the standard, zero-config shim for this.

**Files:**
- Modify: `package.json` (devDependency)
- Create: `src/__tests__/setup.js`
- Modify: `vite.config.js:47-53`

- [ ] **Step 1: Install the dependency (run on Windows, in repo root)**

```bat
npm install -D fake-indexeddb
```

Expected: `package.json` devDependencies gains `"fake-indexeddb": "^X.Y.Z"`.

- [ ] **Step 2: Create the vitest setup file**

Create `src/__tests__/setup.js`:

```js
// Provides an in-memory IndexedDB implementation for vitest's default
// 'node' environment so Dexie-backed modules (db.js, recipeParser.js)
// can be imported and exercised in tests.
import 'fake-indexeddb/auto';
```

- [ ] **Step 3: Wire the setup file into vite.config.js**

In `vite.config.js`, the `export default defineConfig({...})` object currently starts:

```js
export default defineConfig({
  define: {
```

Add a `test` key as a sibling of `define`/`plugins`/`server`/`build` (insert immediately after the closing `}` of the `define` block, i.e. after line 52's `},`):

```js
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.js'],
  },
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: PASS — `smoke.test.js` and `shaHex.test.js` both still pass (2 files, all green).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js src/__tests__/setup.js
git commit -m "test: add fake-indexeddb setup for Dexie-backed unit tests"
```

---

## Task 2: `extractMultipleUrls()` in recipeParser.js

**Files:**
- Modify: `src/recipeParser.js` (add export near `isSocialMediaUrl`, after line 169)
- Test: `src/__tests__/recipeParser.extractMultipleUrls.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/recipeParser.extractMultipleUrls.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { extractMultipleUrls } from '../recipeParser.js';

describe('extractMultipleUrls', () => {
  it('returns [] for plain text with no URLs', () => {
    expect(extractMultipleUrls('just some text, no links here')).toEqual([]);
  });

  it('returns a single-item array for one social URL', () => {
    expect(extractMultipleUrls('check this out https://www.instagram.com/p/ABC123/'))
      .toEqual(['https://www.instagram.com/p/ABC123/']);
  });

  it('returns all URLs for newline-separated multi-share text', () => {
    const text = [
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
      'https://www.tiktok.com/@user/video/123456',
    ].join('\n');
    expect(extractMultipleUrls(text)).toEqual([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
      'https://www.tiktok.com/@user/video/123456',
    ]);
  });

  it('dedupes repeated URLs', () => {
    const text = 'https://www.instagram.com/reel/AAA111/ https://www.instagram.com/reel/AAA111/';
    expect(extractMultipleUrls(text)).toEqual(['https://www.instagram.com/reel/AAA111/']);
  });

  it('ignores non-social-media URLs', () => {
    const text = 'https://www.instagram.com/reel/AAA111/ https://example.com/page';
    expect(extractMultipleUrls(text)).toEqual(['https://www.instagram.com/reel/AAA111/']);
  });

  it('strips trailing punctuation from space-separated URLs', () => {
    const text = 'Look at https://www.instagram.com/p/XYZ987/, and https://www.tiktok.com/@u/video/9.';
    expect(extractMultipleUrls(text)).toEqual([
      'https://www.instagram.com/p/XYZ987/',
      'https://www.tiktok.com/@u/video/9',
    ]);
  });

  it('returns [] for empty/non-string input', () => {
    expect(extractMultipleUrls('')).toEqual([]);
    expect(extractMultipleUrls(null)).toEqual([]);
    expect(extractMultipleUrls(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- recipeParser.extractMultipleUrls`
Expected: FAIL — `extractMultipleUrls is not a function` (or similar export error).

- [ ] **Step 3: Implement `extractMultipleUrls`**

In `src/recipeParser.js`, immediately after the existing `getSocialPlatform` function (ends at line 182, just before the `// ── Mealie-inspired image selection` comment at line 184), insert:

```js
// Scan free-form shared text for 2+ recognizable social-media URLs
// (Instagram "Send to" with multiple posts selected bundles several URLs,
// usually newline- or space-separated, into one EXTRA_TEXT string).
// Returns a deduped array of validated URLs — callers check `.length >= 2`
// to decide whether to route to the batch-import flow.
export function extractMultipleUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const candidates = text.split(/\s+/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const urls = [];
  for (const candidate of candidates) {
    // Strip trailing punctuation commonly appended in shared captions/messages
    const cleaned = candidate.replace(/[).,;]+$/, '');
    if (!isSocialMediaUrl(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
  }
  return urls;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- recipeParser.extractMultipleUrls`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/recipeParser.js src/__tests__/recipeParser.extractMultipleUrls.test.js
git commit -m "feat(import): add extractMultipleUrls for multi-share detection"
```

---

## Task 3: `batchQueue` Dexie table (v13) + helper functions

**Files:**
- Modify: `src/db.js` (add `db.version(13)` after line 73, helpers after the existing import-queue helpers around line 432)
- Test: `src/__tests__/db.batchQueue.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/db.batchQueue.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import db, {
  addBatchQueueItems,
  getBatchQueueItems,
  getNextPendingBatchItem,
  updateBatchQueueItem,
  setBatchItemType,
  deleteBatchQueueItem,
  clearFinishedBatchItems,
} from '../db.js';

describe('batchQueue helpers', () => {
  beforeEach(async () => {
    await db.batchQueue.clear();
  });

  it('addBatchQueueItems writes pending rows for each url', async () => {
    const ids = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    expect(ids).toHaveLength(2);

    const items = await getBatchQueueItems();
    expect(items).toHaveLength(2);
    expect(items.every(i => i.status === 'pending')).toBe(true);
    expect(items.every(i => i.itemType === 'meal')).toBe(true);
    expect(items.every(i => i.itemTypeUserOverride === false)).toBe(true);
  });

  it('getNextPendingBatchItem returns the oldest pending item', async () => {
    const [firstId] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await addBatchQueueItems(['https://www.instagram.com/reel/BBB222/']);

    const next = await getNextPendingBatchItem();
    expect(next.id).toBe(firstId);
  });

  it('updateBatchQueueItem updates status and recipe', async () => {
    const [id] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await updateBatchQueueItem(id, { status: 'ready', recipe: { title: 'Test Recipe' } });

    const items = await getBatchQueueItems();
    const item = items.find(i => i.id === id);
    expect(item.status).toBe('ready');
    expect(item.recipe.title).toBe('Test Recipe');
    expect(item.updatedAt).toBeGreaterThan(0);
  });

  it('setBatchItemType sets itemType and itemTypeUserOverride', async () => {
    const [id] = await addBatchQueueItems(['https://www.instagram.com/reel/AAA111/']);
    await setBatchItemType(id, 'drink');

    const items = await getBatchQueueItems();
    const item = items.find(i => i.id === id);
    expect(item.itemType).toBe('drink');
    expect(item.itemTypeUserOverride).toBe(true);
  });

  it('deleteBatchQueueItem removes a single row', async () => {
    const [id1, id2] = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    await deleteBatchQueueItem(id1);

    const items = await getBatchQueueItems();
    expect(items.map(i => i.id)).toEqual([id2]);
  });

  it('clearFinishedBatchItems removes only saved rows', async () => {
    const [id1, id2] = await addBatchQueueItems([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
    ]);
    await updateBatchQueueItem(id1, { status: 'saved' });
    await updateBatchQueueItem(id2, { status: 'ready' });

    await clearFinishedBatchItems();

    const items = await getBatchQueueItems();
    expect(items.map(i => i.id)).toEqual([id2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- db.batchQueue`
Expected: FAIL — `db.batchQueue` is undefined (table not yet registered) and the helper exports don't exist.

- [ ] **Step 3: Add the v13 schema and helper functions**

In `src/db.js`, immediately after the v12 block (lines 70-73):

```js
// v12: Unified Import Engine — Draft Persistence
db.version(12).stores({
  importDrafts: 'url, timestamp',
});
```

add:

```js

// v13: Batch Import — multi-share queue (P12)
db.version(13).stores({
  batchQueue: '++id, status, createdAt',
});
```

Then, after `clearCompletedImports` (ends at line 432), add a new helper section:

```js
// ── Batch Import Queue helpers ────────────────────────────────────────────
export async function addBatchQueueItems(urls) {
  const now = Date.now();
  const ids = [];
  for (const url of urls) {
    const id = await db.batchQueue.add({
      url,
      status: 'pending',
      itemType: 'meal',
      itemTypeUserOverride: false,
      recipe: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    ids.push(id);
  }
  return ids;
}

export async function getBatchQueueItems() {
  return db.batchQueue.orderBy('createdAt').toArray();
}

export async function getNextPendingBatchItem() {
  return db.batchQueue.where('status').equals('pending').first();
}

export async function updateBatchQueueItem(id, changes) {
  await db.batchQueue.update(id, { ...changes, updatedAt: Date.now() });
}

export async function setBatchItemType(id, itemType) {
  await db.batchQueue.update(id, {
    itemType,
    itemTypeUserOverride: true,
    updatedAt: Date.now(),
  });
}

export async function deleteBatchQueueItem(id) {
  await db.batchQueue.delete(id);
}

export async function clearFinishedBatchItems() {
  await db.batchQueue.where('status').equals('saved').delete();
}

export async function recoverStuckBatchItems() {
  const stuck = await db.batchQueue.where('status').equals('extracting').toArray();
  for (const item of stuck) {
    await db.batchQueue.update(item.id, { status: 'pending', updatedAt: Date.now() });
  }
  return stuck.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- db.batchQueue`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS — all test files green (smoke, shaHex, extractMultipleUrls, db.batchQueue).

- [ ] **Step 6: Commit**

```bash
git add src/db.js src/__tests__/db.batchQueue.test.js
git commit -m "feat(import): add batchQueue Dexie table (v13) and CRUD helpers"
```

---

## Task 4: `batchImportEngine.js` — sequential background processor

**Files:**
- Create: `src/batchImportEngine.js`

No new automated test for this task — it drives `importRecipeFromUrl` (network/AI calls) and `navigator.onLine`/`online` events, which aren't meaningfully testable under the `node` vitest environment without heavy mocking. It is covered by the manual Testing Plan (Task 8, scenarios 4 and 5).

- [ ] **Step 1: Create the engine module**

Create `src/batchImportEngine.js`:

```js
// Batch Import Engine — sequential background processor for `batchQueue`.
//
// Runs one extraction at a time (Apify/Gemini rate-limit friendly), driven
// from App.jsx on mount and on `online` events. Pauses automatically when
// `navigator.onLine` is false and resumes when connectivity returns.
import db, {
  getNextPendingBatchItem,
  updateBatchQueueItem,
  recoverStuckBatchItems,
} from './db';
import { importRecipeFromUrl, detectImportType } from './recipeParser';

let running = false;
let listenersAttached = false;

export function dispatchBatchQueueUpdate() {
  window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
}

async function processOne(item) {
  await updateBatchQueueItem(item.id, { status: 'extracting' });
  dispatchBatchQueueUpdate();

  const controller = new AbortController();
  const detectedType = detectImportType(item.url, '');

  try {
    const result = await importRecipeFromUrl(item.url, () => {}, {
      type: detectedType,
      signal: controller.signal,
    });

    const hasRecipe = result && !result._needsBrowserAssist &&
      ((result.title || result.name) || (Array.isArray(result.ingredients) && result.ingredients.length > 0));

    if (hasRecipe) {
      const finalType = item.itemTypeUserOverride
        ? item.itemType
        : (result.itemType || result.type || detectedType || 'meal');
      await updateBatchQueueItem(item.id, {
        status: 'ready',
        recipe: result,
        itemType: finalType,
      });
    } else {
      await updateBatchQueueItem(item.id, {
        status: 'failed',
        error: result?._timeoutReason || 'Could not find a recipe at this link.',
      });
    }
  } catch (err) {
    await updateBatchQueueItem(item.id, {
      status: 'failed',
      error: err?.message || 'Import failed.',
    });
  }

  dispatchBatchQueueUpdate();
}

export async function runBatchImportEngine() {
  if (running) return;
  running = true;
  try {
    await recoverStuckBatchItems();
    dispatchBatchQueueUpdate();

    while (true) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const next = await getNextPendingBatchItem();
      if (!next) break;
      await processOne(next);
    }
  } finally {
    running = false;
  }
}

// Call once on app mount. Safe to call multiple times — listener registration
// is idempotent and `runBatchImportEngine` is reentrancy-guarded via `running`.
export function startBatchImportEngine() {
  runBatchImportEngine();

  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('online', () => {
    runBatchImportEngine();
  });
}

// Exported for table existence checks from BatchImportQueue without a
// second db.js import in callers that already import this module.
export { db };
```

- [ ] **Step 2: Commit**

```bash
git add src/batchImportEngine.js
git commit -m "feat(import): add sequential batch import engine with offline pause/resume"
```

---

## Task 5: ImportSheet.jsx — batch review entry point

**Files:**
- Modify: `src/components/ImportSheet.jsx`

- [ ] **Step 1: Add new props**

In `src/components/ImportSheet.jsx`, the component signature at lines 99-105 is:

```js
export default function ImportSheet({
  onImport,
  onClose,
  title = 'Import Recipe',
  sharedContent = null,
  initialItemType = 'meal',
}) {
```

Change to:

```js
export default function ImportSheet({
  onImport,
  onClose,
  title = 'Import Recipe',
  sharedContent = null,
  initialItemType = 'meal',
  initialRecipe = null,
  initialPhase = null,
}) {
```

- [ ] **Step 2: Add a batch-review mount effect**

Immediately after the existing "Auto-import from share target" effect (lines 220-225):

```js
  // ── Auto-import from share target ────────────────────────────────────────
  useEffect(() => {
    if (sharedContent && sharedContent.url) {
      handleUrlImport(sharedContent.url, initialItemType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

add:

```js

  // ── Batch review: open directly into review with a pre-extracted recipe ──
  // Used by BatchImportQueue when the user taps a "ready" row — skips
  // re-extraction entirely and reuses the existing review/save UI.
  useEffect(() => {
    if (initialRecipe && initialPhase === 'review') {
      const fallbackType = initialRecipe.itemType || initialRecipe.type || initialItemType;
      const normalized = normalizeRecipeForReview(initialRecipe, fallbackType);
      setRecipe(normalized);
      setConfidence(computeReviewConfidence(normalized));
      setItemType(normalized.itemType);
      setPhase('review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Note: the "retry" flow (failed batch item) needs **no changes** here — `BatchImportQueue`'s retry action will pass `sharedContent={{ mode: 'url', url: item.url, isShare: true }}`, which the existing auto-import effect (lines 220-225) already handles via `handleUrlImport`.

- [ ] **Step 3: Manual verification**

This is a UI entry-point change with no isolated unit test (it depends on `BatchImportQueue` from Task 6 to invoke it). Verified end-to-end in Task 8's Testing Plan, scenario 3.

- [ ] **Step 4: Commit**

```bash
git add src/components/ImportSheet.jsx
git commit -m "feat(import): add initialRecipe/initialPhase props for batch review"
```

---

## Task 6: `BatchImportQueue.jsx` — queue UI + floating pill

**Files:**
- Create: `src/components/BatchImportQueue.jsx`
- Modify: `src/App.css` (append new `.biq-*` styles)

- [ ] **Step 1: Create the component**

Create `src/components/BatchImportQueue.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, RefreshCw, AlertTriangle, CheckCircle2, ChevronRight, Loader2, Inbox } from 'lucide-react';
import { getBatchQueueItems, deleteBatchQueueItem, setBatchItemType, clearFinishedBatchItems } from '../db';

const STATUS_LABELS = {
  pending: 'Queued',
  extracting: 'Extracting…',
  ready: 'Ready to review',
  failed: 'Failed',
  saved: 'Saved',
};

function confidenceBand(recipe) {
  const c = typeof recipe?.confidence === 'number' ? recipe.confidence : null;
  if (c == null) return null;
  if (c >= 0.7) return 'high';
  if (c >= 0.4) return 'medium';
  return 'low';
}

/**
 * BatchImportQueue — full-screen slide-up modal showing live progress for a
 * multi-share batch import. Live-reads `batchQueue` via Dexie + refreshes on
 * the `spicehub:batch-queue-updated` CustomEvent (dispatched by
 * batchImportEngine and by this component's own mutations).
 *
 * Props:
 *   onReview(item) — open ImportSheet in review phase for a 'ready' item
 *   onRetry(item)  — open ImportSheet in input phase, pre-filled with item.url
 *   onClose()
 */
export default function BatchImportQueue({ onReview, onRetry, onClose }) {
  const [items, setItems] = useState([]);
  const dragControls = useDragControls();

  const refresh = useCallback(() => {
    getBatchQueueItems().then(setItems).catch(err => console.warn('[BatchImportQueue] refresh failed:', err));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('spicehub:batch-queue-updated', refresh);
    return () => window.removeEventListener('spicehub:batch-queue-updated', refresh);
  }, [refresh]);

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }, [onClose]);

  const handleTypeToggle = useCallback(async (item) => {
    const next = item.itemType === 'drink' ? 'meal' : 'drink';
    await setBatchItemType(item.id, next);
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (item) => {
    await deleteBatchQueueItem(item.id);
    refresh();
    window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
  }, [refresh]);

  const handleClearAll = useCallback(async () => {
    await clearFinishedBatchItems();
    const remaining = items.filter(i => i.status !== 'saved' && i.status !== 'extracting');
    for (const item of remaining) {
      await deleteBatchQueueItem(item.id);
    }
    refresh();
    window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
  }, [items, refresh]);

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'extracting').length;
  const readyCount = items.filter(i => i.status === 'ready').length;

  return (
    <div className="biq-overlay" onClick={onClose}>
      <motion.div className="biq-sheet" onClick={e => e.stopPropagation()}
        drag="y" dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
        <div className="biq-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />

        <div className="biq-header">
          <div>
            <h2 className="biq-title">Importing {items.length} recipe{items.length !== 1 ? 's' : ''}</h2>
            <p className="biq-subtitle">
              {pendingCount > 0 ? `${pendingCount} in progress` : 'All done'}
              {readyCount > 0 ? ` · ${readyCount} ready to review` : ''}
            </p>
          </div>
          <button className="biq-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="biq-list">
          {items.length === 0 ? (
            <div className="biq-empty">
              <Inbox size={32} strokeWidth={1.5} className="biq-empty-icon" />
              <p>No imports queued.</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className={`biq-row biq-row-${item.status}`}>
                <div className="biq-row-main">
                  {item.status === 'extracting' && <Loader2 size={18} strokeWidth={1.75} className="biq-spin" />}
                  {item.status === 'ready' && <CheckCircle2 size={18} strokeWidth={1.75} className="biq-icon-ready" />}
                  {item.status === 'failed' && <AlertTriangle size={18} strokeWidth={1.75} className="biq-icon-failed" />}
                  {item.status === 'saved' && <CheckCircle2 size={18} strokeWidth={1.75} className="biq-icon-saved" />}
                  <div className="biq-row-text">
                    <span className="biq-row-title">
                      {item.recipe?.title || item.recipe?.name || item.url}
                    </span>
                    <span className="biq-row-status">{STATUS_LABELS[item.status] || item.status}</span>
                    {item.status === 'failed' && item.error && (
                      <span className="biq-row-error">{item.error}</span>
                    )}
                  </div>
                </div>
                <div className="biq-row-actions">
                  {item.status === 'ready' && (
                    <>
                      <button className={`biq-type-pill biq-type-${item.itemType}`} onClick={() => handleTypeToggle(item)}>
                        {item.itemType === 'drink' ? 'Drink' : 'Meal'}
                      </button>
                      {confidenceBand(item.recipe) && (
                        <span className={`biq-confidence biq-confidence-${confidenceBand(item.recipe)}`}>
                          {Math.round((item.recipe.confidence || 0) * 100)}%
                        </span>
                      )}
                      <button className="biq-action-btn" onClick={() => onReview(item)}>
                        Review <ChevronRight size={16} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                  {item.status === 'failed' && (
                    <button className="biq-action-btn biq-retry-btn" onClick={() => onRetry(item)}>
                      <RefreshCw size={16} strokeWidth={1.75} /> Retry
                    </button>
                  )}
                  {(item.status === 'failed' || item.status === 'pending' || item.status === 'saved') && (
                    <button className="biq-dismiss-btn" onClick={() => handleDismiss(item)} aria-label="Remove">
                      <X size={16} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="biq-footer">
            <button className="biq-clear-btn" onClick={handleClearAll}>Clear all</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * BatchQueuePill — floating re-entry pill shown when BatchImportQueue is
 * closed but pending/ready items remain. Positioned bottom-right, clear of
 * existing FABs (which anchor bottom-left / center).
 */
export function BatchQueuePill({ count, onClick }) {
  if (!count) return null;
  return (
    <motion.button
      className="biq-pill"
      onClick={onClick}
      initial={{ opacity: 0, y: 16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.9 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      <Loader2 size={16} strokeWidth={1.75} className="biq-spin" />
      <span>{count} importing</span>
    </motion.button>
  );
}
```

- [ ] **Step 2: Append styles to App.css**

Append to the end of `src/App.css`:

```css
/* ═══════════════════════════════════════════════════════════════════════════
   BATCH IMPORT QUEUE — multi-share import modal + floating re-entry pill
   ═══════════════════════════════════════════════════════════════════════════ */
.biq-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 60;
  display: flex;
  align-items: flex-end;
}

.biq-sheet {
  width: 100%;
  max-height: 85vh;
  background: var(--card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.biq-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  margin: 10px auto 4px;
  cursor: grab;
}

.biq-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-lg) var(--space-md);
}

.biq-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
}

.biq-subtitle {
  margin-top: 2px;
  font-size: 0.85rem;
  color: var(--text-light);
}

.biq-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--surface);
  color: var(--text-light);
  cursor: pointer;
  transition: background 0.2s var(--ease-spring), transform 0.2s var(--ease-spring);
}
.biq-close:active { transform: scale(0.95); }

.biq-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-lg) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.biq-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xl) 0;
  color: var(--text-muted);
  text-align: center;
}
.biq-empty-icon { color: var(--text-muted); }

.biq-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  min-height: 56px;
}

.biq-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  flex: 1;
}

.biq-row-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.biq-row-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60vw;
}

.biq-row-status {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.biq-row-error {
  font-size: 0.78rem;
  color: var(--danger);
}

.biq-row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.biq-icon-ready { color: var(--success); }
.biq-icon-failed { color: var(--danger); }
.biq-icon-saved { color: var(--text-muted); }

.biq-spin {
  animation: biq-spin 1s linear infinite;
  color: var(--primary);
}
@keyframes biq-spin {
  to { transform: rotate(360deg); }
}

.biq-type-pill {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-light);
  cursor: pointer;
  min-height: 32px;
  transition: background 0.2s var(--ease-spring), transform 0.2s var(--ease-spring);
}
.biq-type-pill.biq-type-drink {
  border-color: var(--primary);
  color: var(--primary);
}
.biq-type-pill:active { transform: scale(0.96); }

.biq-confidence {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
}
.biq-confidence-high { background: rgba(46, 125, 50, 0.12); color: var(--success); }
.biq-confidence-medium { background: rgba(245, 158, 11, 0.14); color: var(--warning); }
.biq-confidence-low { background: rgba(211, 47, 47, 0.12); color: var(--danger); }

.biq-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 8px 14px;
  min-height: 36px;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  transition: transform 0.2s var(--ease-spring), background 0.2s var(--ease-spring);
}
.biq-action-btn:active { transform: scale(0.96); }

.biq-retry-btn {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
}

.biq-dismiss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: var(--radius-pill);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.2s var(--ease-spring), transform 0.2s var(--ease-spring);
}
.biq-dismiss-btn:active { transform: scale(0.95); }

.biq-footer {
  padding: var(--space-sm) var(--space-lg) var(--space-lg);
  display: flex;
  justify-content: center;
}

.biq-clear-btn {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-light);
  background: transparent;
  border: none;
  padding: 10px 16px;
  min-height: 40px;
  cursor: pointer;
}

/* ── Floating re-entry pill ── */
.biq-pill {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
  right: var(--space-md);
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 10px 18px;
  min-height: 44px;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
}
.biq-pill:active { transform: scale(0.96); }

@media (max-width: 768px) {
  .biq-row {
    flex-wrap: wrap;
  }
  .biq-row-title {
    max-width: 50vw;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BatchImportQueue.jsx src/App.css
git commit -m "feat(import): add BatchImportQueue modal and floating re-entry pill"
```

---

## Task 7: App.jsx — routing, engine bootstrap, and rendering

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports**

Near the top of `src/App.jsx`, the existing db import (line 3) is:

```js
import db, { importPaprikaMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getCookingLog, getWeekHistory, saveWeekToHistory, toggleRotation } from './db';
```

Change to:

```js
import db, { importPaprikaMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getCookingLog, getWeekHistory, saveWeekToHistory, toggleRotation, addBatchQueueItems, getBatchQueueItems } from './db';
```

Immediately after the `ImportSheet` import (line 14: `import ImportSheet from './components/ImportSheet';`), add:

```js
import BatchImportQueue, { BatchQueuePill } from './components/BatchImportQueue';
import { startBatchImportEngine } from './batchImportEngine';
import { extractMultipleUrls } from './recipeParser';
```

- [ ] **Step 2: Add state**

After the existing `sharedContent` state declaration (line 89: `const [sharedContent, setSharedContent] = useState(null); // { mode, url, text } from share-target`), add:

```js
  // ── Batch import (multi-share) state ────────────────────────────────────
  const [showBatchQueue, setShowBatchQueue] = useState(false);
  const [batchQueueCount, setBatchQueueCount] = useState(0);
  const [batchReviewItem, setBatchReviewItem] = useState(null); // { item } opened in ImportSheet
```

After the back-handler block (lines 99-111, ending with `useBackHandler(showSettings, () => setShowSettings(false), 'settings');`), add:

```js
  useBackHandler(showBatchQueue, () => setShowBatchQueue(false), 'batch-queue');
  useBackHandler(!!batchReviewItem, () => setBatchReviewItem(null), 'batch-review');
```

- [ ] **Step 3: Bootstrap the engine and track the pill count**

Add a new effect alongside the other top-level mount effects (near the existing "Background worker has been deprecated..." effect at lines 135-151). Insert this as a new, separate `useEffect` block right after that effect's closing `}, [loadMeals, loadDrinks]);`:

```js
  // ── Batch Import Engine bootstrap ────────────────────────────────────────
  useEffect(() => {
    startBatchImportEngine();

    const refreshBatchCount = () => {
      getBatchQueueItems().then(items => {
        const count = items.filter(i => i.status === 'pending' || i.status === 'extracting' || i.status === 'ready').length;
        setBatchQueueCount(count);
      }).catch(() => {});
    };
    refreshBatchCount();

    window.addEventListener('spicehub:batch-queue-updated', refreshBatchCount);
    return () => window.removeEventListener('spicehub:batch-queue-updated', refreshBatchCount);
  }, []);
```

- [ ] **Step 4: Route multi-URL shares in both share handlers**

The PWA Web Share Target handler (lines 286-300) currently reads:

```js
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('share-target')) {
    const sharedUrl   = params.get('url')   || '';
    const sharedTitle = params.get('title') || '';
    const sharedText  = params.get('text')  || '';
    const target = _looksLikeDrink(sharedUrl, sharedTitle, sharedText) ? 'drinks' : 'meals';
    if (sharedUrl) {
      setImportModalKey(k => k + 1);
      setShowImportFor(target);
      setSharedContent({ mode: 'url', url: sharedUrl, title: sharedTitle, text: sharedText, isShare: true });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}, []);
```

Change the body to check for a batch first:

```js
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('share-target')) {
    const sharedUrl   = params.get('url')   || '';
    const sharedTitle = params.get('title') || '';
    const sharedText  = params.get('text')  || '';

    const batchUrls = extractMultipleUrls(`${sharedUrl} ${sharedText}`);
    if (batchUrls.length >= 2) {
      addBatchQueueItems(batchUrls).then(() => {
        setShowBatchQueue(true);
        window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
      });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const target = _looksLikeDrink(sharedUrl, sharedTitle, sharedText) ? 'drinks' : 'meals';
    if (sharedUrl) {
      setImportModalKey(k => k + 1);
      setShowImportFor(target);
      setSharedContent({ mode: 'url', url: sharedUrl, title: sharedTitle, text: sharedText, isShare: true });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}, []);
```

The Capacitor native share listener (lines 306-323) currently reads:

```js
useEffect(() => {
  const handler = (e) => {
    const detail = e?.detail;
    if (!detail || (!detail.url && !detail.text)) return;
    const target = _looksLikeDrink(detail.url, detail.title, detail.text) ? 'drinks' : 'meals';
    setImportModalKey(k => k + 1);
    setShowImportFor(target);
    setSharedContent({
      mode: detail.mode || (detail.url ? 'url' : 'text'),
      url: detail.url || '',
      text: detail.text || '',
      title: detail.title || '',
      isShare: true,
    });
  };
  window.addEventListener('spicehub:share-import', handler);
  return () => window.removeEventListener('spicehub:share-import', handler);
}, []);
```

Change the handler body to:

```js
useEffect(() => {
  const handler = (e) => {
    const detail = e?.detail;
    if (!detail || (!detail.url && !detail.text)) return;

    const batchUrls = extractMultipleUrls(`${detail.url || ''} ${detail.text || ''}`);
    if (batchUrls.length >= 2) {
      addBatchQueueItems(batchUrls).then(() => {
        setShowBatchQueue(true);
        window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
      });
      return;
    }

    const target = _looksLikeDrink(detail.url, detail.title, detail.text) ? 'drinks' : 'meals';
    setImportModalKey(k => k + 1);
    setShowImportFor(target);
    setSharedContent({
      mode: detail.mode || (detail.url ? 'url' : 'text'),
      url: detail.url || '',
      text: detail.text || '',
      title: detail.title || '',
      isShare: true,
    });
  };
  window.addEventListener('spicehub:share-import', handler);
  return () => window.removeEventListener('spicehub:share-import', handler);
}, []);
```

- [ ] **Step 5: Add review/retry handlers**

Near `handleImport` (which starts at line 518: `const handleImport = useCallback(async (imported, destination) => {`), add two new callbacks immediately before it:

```js
  // ── Batch import: open a 'ready' row directly into ImportSheet review ─────
  const handleBatchReview = useCallback((item) => {
    setBatchReviewItem(item);
  }, []);

  // ── Batch import: open a 'failed' row into ImportSheet for retry ──────────
  const handleBatchRetry = useCallback((item) => {
    setImportModalKey(k => k + 1);
    setShowImportFor(item.itemType === 'drink' ? 'drinks' : 'meals');
    setSharedContent({ mode: 'url', url: item.url, title: '', text: '', isShare: true });
  }, []);

  // ── Batch import: mark a batchQueue row 'saved' after ImportSheet save ────
  const handleBatchReviewSave = useCallback(async (imported, destination) => {
    const item = batchReviewItem;
    setBatchReviewItem(null);
    await handleImport(imported, destination);
    if (item) {
      const { updateBatchQueueItem } = await import('./db');
      await updateBatchQueueItem.call(null, item.id, { status: 'saved' });
      window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
    }
  }, [batchReviewItem, handleImport]);
```

> Note: `handleBatchReviewSave` is defined after `handleImport` in execution order is fine because both are `useCallback`s created during render — but since `handleBatchReviewSave` references `handleImport`, place `handleBatchReviewSave` **after** the `handleImport` definition (i.e., split this step: `handleBatchReview` and `handleBatchRetry` go immediately before `handleImport`, and `handleBatchReviewSave` goes immediately after `handleImport`'s closing `}, [...]);` at line 597).

Also replace the dynamic `import('./db')` with a static import for `updateBatchQueueItem` — add it to the Step 1 db import list instead. Revise Step 1's db import line to:

```js
import db, { importPaprikaMeals, logCook, logMix, saveWeekPlan, loadWeekPlan, saveGroceryList, loadGroceryList, getCookingLog, getWeekHistory, saveWeekToHistory, toggleRotation, addBatchQueueItems, getBatchQueueItems, updateBatchQueueItem } from './db';
```

And simplify `handleBatchReviewSave` to:

```js
  // ── Batch import: mark a batchQueue row 'saved' after ImportSheet save ────
  const handleBatchReviewSave = useCallback(async (imported, destination) => {
    const item = batchReviewItem;
    setBatchReviewItem(null);
    await handleImport(imported, destination);
    if (item) {
      await updateBatchQueueItem(item.id, { status: 'saved' });
      window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
    }
  }, [batchReviewItem, handleImport]);
```

- [ ] **Step 6: Render BatchImportQueue, the pill, and the batch-review ImportSheet**

The existing `ImportSheet` render block (lines 825-834) is:

```jsx
      {showImportFor && (
        <ImportSheet
          key={importModalKey}
          onImport={handleImport}
          onClose={() => { setShowImportFor(null); setSharedContent(null); }}
          title={showImportFor === 'drinks' ? 'Import Drink' : 'Import Recipe'}
          sharedContent={sharedContent}
          initialItemType={showImportFor === 'drinks' ? 'drink' : 'meal'}
        />
      )}
```

Immediately after this block (before the `{/* ── New feature overlays ── */}` comment on line 836), add:

```jsx
      {showBatchQueue && (
        <BatchImportQueue
          onClose={() => setShowBatchQueue(false)}
          onReview={(item) => { setShowBatchQueue(false); handleBatchReview(item); }}
          onRetry={(item) => { setShowBatchQueue(false); handleBatchRetry(item); }}
        />
      )}

      {!showBatchQueue && (
        <BatchQueuePill count={batchQueueCount} onClick={() => setShowBatchQueue(true)} />
      )}

      {batchReviewItem && (
        <ImportSheet
          key={`batch-review-${batchReviewItem.id}`}
          onImport={handleBatchReviewSave}
          onClose={() => setBatchReviewItem(null)}
          title={batchReviewItem.itemType === 'drink' ? 'Review Drink' : 'Review Recipe'}
          initialItemType={batchReviewItem.itemType || 'meal'}
          initialRecipe={batchReviewItem.recipe}
          initialPhase="review"
        />
      )}
```

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(import): wire batch import routing, engine bootstrap, and queue UI into App.jsx"
```

---

## Task 8: Manual Testing Plan + final build verification

This task is manual — run on Windows after all prior tasks are complete.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS — all test files (smoke, shaHex, extractMultipleUrls, db.batchQueue) green.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: clean build, no TypeScript/ESLint/Vite errors, `dist/` produced with `sw.js`.

- [ ] **Step 3: Manual scenario — multi-URL share detection (3 URLs)**

In the dev build, simulate (or trigger via Android share sheet on a device/emulator) a share payload containing 3 newline-separated Instagram URLs.
Expected: `BatchImportQueue` opens automatically; `batchQueue` table has 3 rows, all `status: 'pending'`; rows begin transitioning to `extracting` → `ready`/`failed` one at a time.

- [ ] **Step 4: Manual scenario — single-URL share regression**

Share a single Instagram URL (no batch).
Expected: behaves exactly as before — `ImportSheet` opens directly with `phase: 'loading'` → `review`; `BatchImportQueue` does NOT open; no `batchQueue` rows created.

- [ ] **Step 5: Manual scenario — mixed meal/drink auto-detection**

Share a batch containing one meal-recipe URL and one cocktail-recipe URL.
Expected: each row's `itemType` reflects independent `detectImportType` results; tapping the `biq-type-pill` on either row toggles it and sets `itemTypeUserOverride: true` without affecting the other row.

- [ ] **Step 6: Manual scenario — failure + retry**

Share a batch including one invalid/unsupported URL (e.g., a non-recipe page).
Expected: that row reaches `status: 'failed'` with an `error` message and a "Retry" button; tapping "Retry" closes the queue and opens `ImportSheet` with `phase: 'input'` pre-filled with that URL (via `sharedContent`).

- [ ] **Step 7: Manual scenario — offline pause/resume**

Start a batch, then disable network mid-processing (e.g., DevTools "Offline" or airplane mode).
Expected: the engine stops advancing past the item currently `extracting` (or before starting the next `pending` item); re-enabling network fires `online`, and `runBatchImportEngine` resumes processing remaining `pending` items. `recoverStuckBatchItems` resets any `extracting` row left over from a hard reload back to `pending`.

- [ ] **Step 8: Manual scenario — close mid-processing, pill re-entry**

While a batch is processing, close `BatchImportQueue` (drag down or tap X).
Expected: `BatchQueuePill` appears showing the correct `pending + extracting + ready` count; processing continues in the background (toasts/state update even with the modal closed); tapping the pill reopens `BatchImportQueue` with current state.

- [ ] **Step 9: Manual scenario — reload mid-batch persistence**

Mid-batch, reload the app (hard refresh).
Expected: `batchQueue` rows persist in Dexie; on reload, `startBatchImportEngine` calls `recoverStuckBatchItems` (resetting any `extracting` row to `pending`) and resumes processing from the next `pending` item.

- [ ] **Step 10: Review/save flow**

Tap "Review" on a `ready` row.
Expected: `ImportSheet` opens directly in `phase: 'review'` with the pre-extracted recipe (no re-extraction/loading spinner); saving via the existing footer marks the `batchQueue` row `status: 'saved'` and the row disappears from the active count (pill count decreases).

---

## Self-Review

**Spec coverage:**
- Section 1 (Detection & Routing) → Task 2 (`extractMultipleUrls`) + Task 7 Step 4 (both share handlers).
- Section 2 (Data Model) → Task 3 (`batchQueue` v13 + shape matches spec exactly: `id, url, status, itemType, itemTypeUserOverride, recipe, error, createdAt, updatedAt`).
- Section 3 (Queue UI) → Task 6 (`BatchImportQueue.jsx`, slide-up + drag-to-dismiss, status-based rows, floating pill with pending+ready count).
- Section 4 (Processing Engine) → Task 4 (`batchImportEngine.js`, sequential, online/offline pause-resume, runs independent of modal open state since it's bootstrapped at App.jsx level).
- Section 5 (Review, Retry, Cleanup) → Task 5 (ImportSheet review props) + Task 7 Steps 5-6 (review/retry/save handlers, `clearFinishedBatchItems`/`handleClearAll`).
- Section 6 (Testing Plan) → Task 8 (all 8 spec scenarios covered as Steps 3-10, plus automated Step 1 and build Step 2).
- Open Questions (manual multi-paste, cross-launch queue, bulk-save-all) → correctly left out of scope; no task implements them.

**Placeholder scan:** No "TBD"/"similar to Task N"/bare prose-only steps remain — every code-bearing step includes complete code. Task 4 explicitly states why it has no automated test (network/AI-dependent) rather than leaving a vague placeholder.

**Type/signature consistency:**
- `extractMultipleUrls(text)` — defined in Task 2, consumed identically in Task 7 Step 4 (both handlers).
- `batchQueue` row shape (`url, status, itemType, itemTypeUserOverride, recipe, error, createdAt, updatedAt`) — defined in Task 3's `addBatchQueueItems`, read identically in Task 6 (`BatchImportQueue.jsx`) and Task 4 (`batchImportEngine.js`).
- `addBatchQueueItems`, `getBatchQueueItems`, `getNextPendingBatchItem`, `updateBatchQueueItem`, `setBatchItemType`, `deleteBatchQueueItem`, `clearFinishedBatchItems`, `recoverStuckBatchItems` — all defined once in Task 3, imported with matching names in Tasks 4, 6, 7.
- `startBatchImportEngine` / `runBatchImportEngine` / `dispatchBatchQueueUpdate` — defined in Task 4, `startBatchImportEngine` consumed in Task 7 Step 3; `dispatchBatchQueueUpdate`'s effect (the `spicehub:batch-queue-updated` CustomEvent) is listened for identically in Task 6 and Task 7 Step 3.
- `initialRecipe` / `initialPhase` — defined as ImportSheet props in Task 5, passed with matching names from Task 7 Step 6's batch-review render block.
- `BatchQueuePill` — exported as a named export from `BatchImportQueue.jsx` in Task 6, imported as `{ BatchQueuePill }` in Task 7 Step 1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-batch-import.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
