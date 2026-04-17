# Synchronous Import Modal — Design Spec

**Date:** 2026-04-15  
**Replaces:** `2026-04-14-unified-import-engine-design.md` (Ghost Recipe / background waterfall)

---

## Goal

Replace the asynchronous "Ghost Recipe" import system with a **synchronous, in-modal progress experience**. The user sees the recipe appear in the library within 8–10 seconds of clicking Import, with no pending cards, no polling, and no state to manage after failure.

---

## Architecture Overview

```
Modal opens
  └─ Warmup ping → GET /api/v2/ping  (fires immediately on modal open)

User clicks Import
  └─ Modal transitions to progress view
  └─ POST /api/v2/import/sync  (single blocking request, 20s client timeout)
       │
       ├─ Stage 1: metadata_pass.py        (recipe-scrapers, 0-2s)
       │     └─ confidence ≥ 0.9 → skip to Stage 4
       │
       ├─ Stage 2: instagram_stealth_fetch.py  (IG/social only, 2-6s)
       │     └─ Playwright with resource blocking + immediate cookie injection
       │
       ├─ Stage 3: structureWithGemini()   (parallel with image download, 2-4s)
       │
       └─ Stage 4: persistImage()          (base64 encode, concurrent with Stage 3)
            └─ Return complete RecipePayload JSON

On success → write to Dexie once → close modal → card appears (complete, never ghost)
On failure → transition modal to BrowserAssist (iframe) with captured text pre-filled
```

---

## What Gets Removed

The following are **fully decommissioned**:

| Item | Location |
|---|---|
| `useImportWorker()` hook | `src/importWorker.js`, `src/App.jsx` |
| `handleUrlImportV2()` handler | `src/components/ImportModal.jsx` |
| Ghost row creation (`status: 'processing'`) | `src/components/ImportModal.jsx` |
| Processing/failed card overlays | `src/components/MealLibrary.jsx` |
| `onRetry` / `onPasteManually` handlers | `src/App.jsx`, `src/components/MealLibrary.jsx` |
| Ghost Recipe CSS (shimmer, red border) | `src/App.css` |
| `mealStatus()` helper | `src/db.js` |
| `status`, `jobId` Dexie indexes | kept in schema (harmless), not used |
| Fire-and-forget background POST | `src/components/ImportModal.jsx` |
| Job TTL eviction sweep | `server/jobStore.js` (file kept, unused) |

**Kept intact:**
- `coordinator.js` waterfall logic
- `server/python/` workers
- `persistImage.js`, `structurer.js`, `util.js`, `runPython.js`
- All existing unit tests (they still pass)
- BrowserAssist (becomes the primary failure fallback)

---

## Backend Changes

### New endpoint: `POST /api/v2/import/sync`

Runs the full waterfall **synchronously** and returns a complete recipe.

**Request:**
```json
{ "url": "https://www.instagram.com/p/XXXXX/" }
```

**Response 200:**
```json
{
  "recipe": {
    "name": "...",
    "ingredients": [...],
    "directions": [...],
    "image": "data:image/jpeg;base64,...",
    "prepTime": "...",
    "cookTime": "..."
  }
}
```

**Response 422 (waterfall exhausted, partial data available):**
```json
{
  "error": "extraction_failed",
  "partial": { "capturedText": "..." }
}
```

**Response 400:** Missing/invalid URL.

**Response 504:** Waterfall exceeded 18s server-side timeout (client should treat as 422).

### New endpoint: `GET /api/v2/ping`

Returns `200 OK` instantly. Used by frontend to warm up Render on modal open. No body required.

### Performance Optimizations in Coordinator

**1. Playwright resource blocking (instagram_stealth_fetch.py):**
```python
await page.route("**/*", lambda route: route.abort()
    if route.request.resource_type in {"image", "stylesheet", "font", "media", "other"}
    else route.continue_())
```
Saves 2–3s on Instagram stealth fetch.

**2. Cookie injection on context creation** (already done — verify it's before `page.goto()`).

**3. Parallel image + Gemini:**  
In `coordinator.js`, after stealth fetch returns `rawSources` and an image URL:
```js
const [structured, imageData] = await Promise.all([
  structureWithGemini(rawSources, { sourceUrl }),
  persistImage(imageUrl),
]);
```

---

## Frontend Changes

### `ImportModal.jsx` — Progress State Machine

New `phase` state values:
```
'idle'            → default, shows URL input
'warming'         → warmup ping in flight (silent, no UI change)
'scraping'        → POST sent, stage 1 label
'fetching_social' → stage 2 label
'structuring'     → stage 3 label  
'saving'          → stage 4 label
'done'            → closes modal
'failed'          → transitions to BrowserAssist
```

**Progress labels (time-based advancement):**
```
0ms    → "Checking site…"
2500ms → "Extracting recipe…"
5500ms → "Structuring with AI…"
8000ms → "Almost done…"
```
Labels advance on a timer regardless of actual backend state. The real result overrides on arrival.

**Warmup ping fires on modal open:**
```js
useEffect(() => {
  fetch(`${API_BASE}/api/v2/ping`, { method: 'GET' }).catch(() => {});
}, []);
```

**Import button handler (simplified):**
```js
async function handleUrlImport() {
  setPhase('scraping');
  startProgressTimer();
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/v2/import/sync`, {
      method: 'POST',
      body: JSON.stringify({ url: trimmedUrl }),
      timeout: 20_000,
    });
    if (!resp.ok) throw await resp.json();
    const { recipe } = await resp.json();
    await db.meals.add({ ...recipe, createdAt: new Date().toISOString() });
    onImport([recipe]);
    onClose();
  } catch (err) {
    setPhase('failed');
    setCapturedText(err?.partial?.capturedText ?? '');
    // BrowserAssist takes over
  }
}
```

**On failure:** Modal does NOT close. Instead it transitions the existing BrowserAssist component with `capturedText` pre-filled. BrowserAssist's existing "Paste text" mode receives whatever partial data the backend captured.

### `MealLibrary.jsx` — Remove Ghost State UI

Remove:
- Processing overlay (shimmer + progress text)
- Failed overlay (error + Retry + Paste Manually buttons)
- `meal-card--${mealStatus}` class application
- `mealStatus` computation per card

The library now only ever shows complete recipes.

### `App.css` — Remove Ghost Recipe CSS

Remove:
- `.meal-card--processing` shimmer animation block
- `.meal-card--failed` red border block

### `App.jsx` — Remove Worker Wiring

Remove:
- `import { useImportWorker }` 
- `useImportWorker()` call
- `onRetry` callback and handler
- `onPasteManually` callback and handler
- Props passed to `MealLibrary` for those handlers

---

## Progress UI Design

```
┌─────────────────────────────────────────┐
│  🍳 Importing Recipe                    │
│                                         │
│  [████████░░░░░░░░░░░░]  45%           │
│  Extracting recipe…                     │
│                                         │
│  ○ Checking site      ✓ done           │
│  ● Extracting recipe  ← current        │
│  ○ Structuring AI                       │
│  ○ Saving                               │
│                                         │
│  [Cancel]                               │
└─────────────────────────────────────────┘
```

Cancel aborts the fetch (via `AbortController`) and closes the modal. No cleanup needed since nothing was written to Dexie yet.

---

## Error Path — BrowserAssist Fallback

When `phase === 'failed'`:
- Modal transitions to BrowserAssist (already rendered, just visible)
- `capturedText` from the backend's `partial` field is pre-filled into BrowserAssist's paste view
- User can navigate the iframe, select text, or paste manually
- Existing BrowserAssist → parser → onImport flow handles the rest

**BrowserAssist needs one new prop:** `initialCapturedText?: string`
- Add to component signature: `function BrowserAssist({ url, onRecipeExtracted, onFallbackToText, initialCapturedText })`
- When set, pre-populate the manual paste textarea with the captured text so the user can edit and import without re-pasting
- If empty or undefined, BrowserAssist behaves exactly as today

---

## Dexie Write Contract

Recipes are written to Dexie **exactly once**, on success, with complete data:
```js
await db.meals.add({
  name, ingredients, directions,
  image, prepTime, cookTime, yield: yieldStr,
  notes: '',
  createdAt: new Date().toISOString(),
  // NO status field, NO jobId, NO sourceHash
});
```

Ghost rows with `status: 'processing'` currently in the database should be cleaned up on app load (one-time migration utility, optional).

---

## Testing Plan

### Unit Tests (keep all existing, add new)
- `server/__tests__/coordinator.test.js` — add test for sync waterfall returning complete recipe
- `server/__tests__/endpoints.test.js` — add test for `POST /api/v2/import/sync` and `GET /api/v2/ping`

### Manual Smoke Tests
1. Instagram URL → full recipe in <10s
2. Non-Instagram URL (allrecipes.com) → fast path via metadata_pass
3. Private Instagram URL → modal transitions to BrowserAssist with no card created
4. Click Cancel during import → modal closes, nothing written to Dexie
5. Open modal → check network tab → warmup ping fires immediately

### Regression Tests
- MealLibrary renders existing recipes without crash (no `.length` on undefined)
- No ghost cards appear under any condition
- App.jsx has no `useImportWorker` call

---

## Definition of Done

1. User pastes Instagram link, clicks Import
2. Progress modal shows stage labels advancing
3. Within 8–10s, modal closes, complete recipe card appears in library
4. No ghost/pending/failed cards ever created
5. On failure, BrowserAssist appears with partial text pre-filled
6. All existing unit tests pass
7. `npm run build` succeeds with no new warnings
