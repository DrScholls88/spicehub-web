# Plan: Visual Scraper + Pipeline Unification
**Date:** 2026-04-21  
**Branch:** main  
**Goal:** Merge Paprika-style visual scraper into BrowserAssist + recipeParser, and unify the import pipeline so it feels like ONE engine, not three.

---

## Context

### The "3 pipelines" problem
Currently ImportModal has three distinct import paths that all modify overlapping state:

| Path | Entry point | State footprint |
|------|-------------|-----------------|
| 1. Sync backend | `handleUrlImport → handleUrlImportWithWarmup → handleUrlImportSync` | `syncPhase`, `syncStageIdx`, `_serverWarm` (module-level) |
| 2. Client-side extraction | `performUrlExtraction` | `importing`, `importProgress`, `progress[]` (dead code for URL imports — only used by sharedContent auto-trigger) |
| 3. BrowserAssist | `<BrowserAssist>` shown when `browserAssistMode === 'showing'` | has its own internal multi-phase pipeline |

The "memory bleed" feeling: `_serverWarm` (module-level, never resets), `capturedTextRef.current` (ref — resets on unmount but NOT cleared on failed imports), and `browserAssistSeed` state can carry over context from previous import attempts in the same session.

### Fix strategy
- Add a `handleClose()` wrapper that clears all transient import state before calling `onClose()`.
- Reset `capturedTextRef.current = ''`, `browserAssistUrl`, `browserAssistMode`, `browserAssistSeed`, `syncPhase`, `error`, `importProgress`, `importing` on every close.
- **DO NOT** reset `_serverWarm` — that's a performance feature (Render spin-up cost paid once). But add a clear comment so it's obvious.
- `performUrlExtraction` is effectively dead code for button-triggered imports (the URL import button now routes through `handleUrlImportSync`). Keep it for the `sharedContent` auto-trigger path but add a `// LEGACY: only called by sharedContent auto-trigger` comment.
- Rename the status messages to be consistent ("Unified Import Engine" language) so users see one clear linear flow.

---

## Tasks

### Task 1: Clean up pipeline state + memory wipe on close
**File:** `src/components/ImportModal.jsx`  
**Risk:** Low — pure state management, no logic changes  

**What to do:**
1. Find the existing close handler (look for `onClose()` calls — there are multiple places in the JSX).
2. Create a `handleClose` function at the top of the component that:
   ```js
   const handleClose = useCallback(() => {
     // Wipe all transient import state so reopening feels fresh
     capturedTextRef.current = '';
     setBrowserAssistUrl(null);
     setBrowserAssistMode('off');
     setBrowserAssistSeed(null);
     setSyncPhase('idle');
     setSyncStageIdx(0);
     setError('');
     setImporting(false);
     setImportProgress('');
     // Note: _serverWarm intentionally NOT reset — Render stays warm cross-modal.
     onClose();
   }, [onClose]);
   ```
3. Replace ALL `onClose()` direct calls (including in the JSX close-button `onClick`) with `handleClose()`. Do NOT replace `onClose` inside `handleUrlImportSync`'s success branch (where we call `onImport([recipe]); onClose()`) — that IS the correct terminal close after a successful save. Actually DO replace them all with `handleClose` for consistency — the state-clearing is idempotent after success anyway.
4. Add a `// LEGACY: only called by sharedContent auto-trigger` comment at the top of `performUrlExtraction`.
5. In the `sharedContent` useEffect that calls `performUrlExtraction`, add a check: if we're on the sync path (`_serverWarm || VITE_API_BASE`), route sharedContent through `handleUrlImportWithWarmup` instead.

**Acceptance criteria:**
- Closing and reopening ImportModal shows a blank state every time.
- No previous URL, error, or BrowserAssist state carries over.
- `_serverWarm` is NOT reset (correct — performance feature).
- All existing import flows still work.

---

### Task 2: Add `parseVisualJSON` to recipeParser.js
**File:** `src/recipeParser.js`  
**Risk:** Low — additive, no changes to existing functions  

**What to do:**
Add a new exported function `parseVisualJSON(visualJson, url)` after the `isWeakResult` export (around line 3580). This function takes a visual JSON payload (array of text nodes with styles + bounding rects) and returns a recipe in the standard SpiceHub schema.

**Visual JSON payload contract:**
```js
{
  url: "https://...",
  viewport: { width: 390, height: 844 },
  scrollY: 0,
  nodes: [
    {
      text: "Creamy Pasta",
      rect: { x: 20, y: 140, width: 350, height: 42, top: 140 },
      style: {
        fontSize: "32px",
        fontWeight: "700",
        color: "rgb(30,30,30)",
        backgroundColor: "transparent",
        fontFamily: "...",
        lineHeight: "1.2",
        textDecoration: "none"
      },
      depth: 4,          // DOM depth from body
      zIndex: 0,
      tagName: "H1"
    },
    ...
  ]
}
```

**Heuristics to implement:**

```js
/**
 * parseVisualJSON — Paprika-style layout-based recipe extractor.
 *
 * CONTRACT:
 *   Input:  visualJson { url, viewport, scrollY, nodes[] }
 *   Output: standard SpiceHub recipe schema (same as parseFromHTML/parseFromText)
 *
 * Strategy: rank nodes by visual weight (fontSize × fontWeight × position),
 * then cluster by vertical proximity + style consistency.
 */
export function parseVisualJSON(visualJson, url) { ... }
```

**Heuristic rules:**
1. **Title**: Highest `fontSize` + `fontWeight >= 600` + `rect.top < viewport.height * 0.4` + text length 5-80 chars. If tie, prefer topmost.
2. **Ingredients**: Nodes with `fontSize` 13-18px + `fontWeight` 400-500 + consistent left X alignment (within 30px) + text matches ingredient pattern (`/^\d|^[¼½¾⅓⅔⅛]/` or starts with bullet `•-*`) OR vertically clustered within 800px band. Group by vertical proximity (gap < 60px = same cluster).
3. **Instructions**: Numbered (`/^\d+\./`) or longer text blocks (>30 chars) with `fontWeight <= 500`, sequential vertical stacking. 
4. **Image**: Look for nodes adjacent to title with `tagName === 'IMG'` (add img nodes to the visual JSON in the DOM walker — see Task 3). Fallback: use `bestImage` from the seed if available.
5. **Noise filtering**: Skip nodes where `rect.width < 20` || `rect.height < 8` || `fontSize < 10px` || `rect.top > viewport.height * 3` (footer/comments below fold).
6. **Caption/overlay detection (IG/TikTok)**: Nodes with `zIndex > 5` or `backgroundColor` with alpha < 1 and non-white — likely video captions. Extract these first.

**Output schema:**
```js
{
  name: string,
  ingredients: string[],
  directions: string[],
  image: string | null,
  sourceUrl: url,
  _visualParsed: true,       // flag for debugging
  _visualConfidence: 0..1,   // ratio of nodes successfully classified
}
```

**Debug logging:**
```js
if (import.meta.env?.DEV || process.env.NODE_ENV === 'development') {
  console.debug('[parseVisualJSON]', { titleNode, ingredientNodes, instructionNodes, confidence });
}
```

**Acceptance criteria:**
- `parseVisualJSON` is exported and returns the standard recipe schema.
- Debug log only fires in development.
- Handles empty/malformed `visualJson` gracefully (returns `{ _error: true }`).
- `isWeakResult(parseVisualJSON(...))` returns `false` for a valid recipe.

---

### Task 3: Add visual scraper mode to BrowserAssist.jsx
**File:** `src/components/BrowserAssist.jsx`  
**Risk:** Medium — adds new UI controls + DOM injection, must not break existing flows  

**What to do:**

**3a. Add state:**
```js
const [visualScrapeMode, setVisualScrapeMode] = useState(false);
const [visualScrapeStatus, setVisualScrapeStatus] = useState('idle'); // 'idle'|'running'|'done'|'error'
```

**3b. Add "V" toggle button** in the power row (the row with Expand/Aim/Parse buttons — around line 1049):
```jsx
<button
  className={`ba-btn ba-btn-sm ${visualScrapeMode ? 'ba-btn-active' : ''}`}
  title="Visual parse mode (Paprika-style)"
  onClick={() => setVisualScrapeMode(v => !v)}
  aria-label="Toggle visual parse"
>
  V
</button>
```
Style: same size as existing power-row buttons, `ba-btn-active` gets `background: var(--accent)` (or equivalent in context). Keep it subtle — one letter.

**3c. Add `runVisualScrape` function** (called when user clicks "Parse Recipe" and `visualScrapeMode` is true, OR auto-triggered when page loads if `visualScrapeMode` is on):

```js
const runVisualScrape = useCallback(async () => {
  setVisualScrapeStatus('running');
  // Show toast
  setAimToast('Visual parse active — detecting structure by layout');
  setTimeout(() => setAimToast(''), 3000);

  try {
    const iframe = iframeRef.current;
    if (!iframe) throw new Error('No iframe');

    // Inject the DOM walker script into the iframe's document context
    // (uses parent JS context to access iframe.contentDocument)
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) throw new Error('Cannot access iframe document');

    // VISUAL DOM WALKER — injected as a string and eval'd in the parent context
    // (NOT in the iframe sandbox — we walk the DOM from the parent side)
    const walker = `
      (function() {
        const nodes = [];
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','HEAD','META','LINK','TITLE']);
        
        function walkNode(el, depth) {
          if (!el || SKIP_TAGS.has(el.tagName)) return;
          
          // Collect text nodes
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent.trim();
              if (text.length < 3) continue;
              
              const rect = el.getBoundingClientRect();
              if (rect.width < 20 || rect.height < 8) continue;
              
              const style = window.getComputedStyle(el);
              const fontSize = parseFloat(style.fontSize) || 14;
              if (fontSize < 10) continue;
              
              nodes.push({
                text,
                tagName: el.tagName,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top },
                style: {
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  color: style.color,
                  backgroundColor: style.backgroundColor,
                  fontFamily: style.fontFamily,
                  lineHeight: style.lineHeight,
                  textDecoration: style.textDecoration,
                },
                depth,
                zIndex: parseInt(style.zIndex) || 0,
              });
            }
          }
          
          // Also collect IMG elements
          if (el.tagName === 'IMG' && el.src) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 80 && rect.height > 80) {
              nodes.push({
                text: el.alt || '',
                tagName: 'IMG',
                src: el.src,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top },
                style: {},
                depth,
                zIndex: parseInt(window.getComputedStyle(el).zIndex) || 0,
              });
            }
          }
          
          for (const child of el.children) walkNode(child, depth + 1);
        }
        
        walkNode(document.body, 0);
        
        // Limit to 800 nodes max (visible portion only) for < 50ms latency
        const visibleNodes = nodes
          .filter(n => n.rect.top < viewport.height * 4)
          .slice(0, 800);
        
        return JSON.stringify({
          url: window.location.href,
          viewport,
          scrollY: window.scrollY,
          nodes: visibleNodes,
        });
      })()
    `;

    // Execute the walker via iframe.contentWindow.eval (available because we have
    // allow-same-origin in the sandbox). Fallback: use postMessage bridge.
    let visualJson;
    try {
      const result = iframe.contentWindow.eval(walker);
      visualJson = JSON.parse(result);
    } catch (evalErr) {
      // Fallback: inject as <script> and retrieve via postMessage
      throw new Error('Visual walker eval failed: ' + evalErr.message);
    }

    if (!visualJson?.nodes?.length) throw new Error('No text nodes captured');

    // POST to server for ML-style heuristic parsing
    const resp = await fetch(`${API_BASE}/api/import/visual-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visualJson),
    });

    if (!resp.ok) throw new Error('Visual parse server error: ' + resp.status);
    const { recipe } = await resp.json();

    setVisualScrapeStatus('done');
    if (recipe && !isWeakResult(recipe)) {
      // Hand off directly — same as aim-parse success
      onImport([recipe]);
      onClose();
    } else {
      // Server returned weak result — fall back to existing manual flow
      setAimToast('Visual parse: partial result — use aim to fill gaps');
      setTimeout(() => setAimToast(''), 3000);
      setVisualScrapeStatus('idle');
    }
  } catch (err) {
    console.warn('[BrowserAssist] Visual scrape failed, falling back:', err.message);
    setVisualScrapeStatus('error');
    setAimToast('Visual parse unavailable — using standard mode');
    setTimeout(() => setAimToast(''), 2500);
    setVisualScrapeStatus('idle');
    // NEVER break existing flow — failure is silent to the user beyond the toast
  }
}, [API_BASE, onImport, onClose, iframeRef]);
```

**3d. Hook into "Parse Recipe" button:** When `visualScrapeMode` is true and user clicks Parse Recipe, call `runVisualScrape()` before (or instead of) the existing parse flow. If visual scrape succeeds, done. If it fails or returns weak, fall through to existing aim-parse logic.

**3e. Auto-trigger on page load** (optional, off by default): If `visualScrapeMode` is true and a page finishes loading, auto-run `runVisualScrape()` once after a 1.5s delay (to let JS render). Add a ref `visualAutoTriggeredRef` to prevent double-trigger.

**Acceptance criteria:**
- "V" button toggles visual mode on/off with visual feedback.
- When visual mode is on and user clicks Parse, `runVisualScrape` fires.
- Toast "Visual parse active — detecting structure by layout" appears.
- On failure, gracefully falls back — existing parse still works.
- No breaking changes to existing Aim, Expand, or drag-drop flows.
- Works in Capacitor/Tauri (no native browser APIs — uses `iframe.contentWindow.eval` which is sandboxed).

---

### Task 4: Add `/api/import/visual-parse` server endpoint
**File:** `server/importRoutes.js`  
**Risk:** Low — additive endpoint  

**What to do:**
Add a new route immediately after the existing `/api/v2/import/sync` route:

```js
// ── Visual parse (Paprika-style layout heuristics) ───────────────────────────
app.post('/api/import/visual-parse', async (req, res) => {
  const visualJson = req.body;
  
  if (!visualJson?.nodes?.length) {
    return res.status(400).json({ error: 'nodes array required' });
  }
  
  try {
    // parseVisualJSON lives in server/structurer.js (import it there) OR
    // inline the heuristics here for simplicity.
    // For now: delegate to structurer.js which can call Gemini if needed.
    const recipe = await parseVisualPayload(visualJson);
    return res.json({ recipe });
  } catch (err) {
    console.error('[visual-parse error]', err);
    return res.status(500).json({ error: 'parse_failed', message: err.message });
  }
});
```

**Where does `parseVisualPayload` live?**
- Option A (preferred for server): Implement the heuristics directly in `server/structurer.js` as `parseVisualPayload(visualJson)`. This keeps the pure heuristics on the server where Node.js can apply them efficiently.
- Option B: If structurer.js is too complex, inline a simplified version directly in importRoutes.js.

The server-side `parseVisualPayload` should implement the SAME heuristics as `parseVisualJSON` in recipeParser.js (they can share logic via a comment linking them — keep them in sync manually, they're deterministic rules not model weights).

For robustness: if the heuristics yield a weak result, optionally pass the top 10 text nodes to Gemini for a quick structuring pass. This is the "ML-style" layer.

**Acceptance criteria:**
- `POST /api/import/visual-parse` accepts `{ url, viewport, scrollY, nodes[] }` and returns `{ recipe }`.
- Returns 400 if `nodes` is missing.
- Returns a recipe in standard SpiceHub schema.
- If heuristics fail, gracefully returns `{ recipe: { _error: true } }` (not 500).

---

### Task 5: Integration — wire status in ImportModal + latency guard
**File:** `src/components/ImportModal.jsx`  
**Risk:** Low — cosmetic + one-liner latency guard  

**What to do:**
1. In the sync progress stages array, change the labels to make the unified flow clearer:
   ```js
   const STAGES = [
     { key: 'scraping',    label: 'Reading the recipe…'           },
     { key: 'fetching',    label: 'Extracting content…'           },
     { key: 'structuring', label: 'Using universal visual scraper…' },  // ← updated
     { key: 'saving',      label: 'Almost done…'                  },
   ];
   ```
   
2. Add a one-line note in `handleUrlImportSync` before the fetch that signals visual mode is available as a next step if backend fails.

3. When `browserAssistMode` becomes `'showing'`, set the BrowserAssist prop `defaultVisualMode={true}` if the URL is social media (Instagram/TikTok/Reels) — auto-enable the "V" toggle for those sites since they need it most.

4. Latency guard: the visual JSON is capped at 800 nodes in the DOM walker (Task 3). Add a `JSON.stringify(visualJson).length > 500_000` check before POSTing — if the payload exceeds 500KB, trim `nodes` to the first 400 to stay under 50ms extra latency.

**Acceptance criteria:**
- Status messages read naturally as a single unified flow.
- Social media URLs auto-enable visual mode in BrowserAssist.
- Payload size guard prevents oversized requests.

---

## Implementation Order

Tasks are mostly independent but Task 4 (server endpoint) should be done before Task 3 (client calls it), and Task 2 (parser function) can be done in parallel with anything:

```
Task 1 (memory wipe) — independent
Task 2 (parseVisualJSON) — independent  
Task 4 (server endpoint) — needs Task 2's heuristics
Task 3 (BrowserAssist visual mode) — needs Task 4's endpoint
Task 5 (integration polish) — needs Tasks 1, 3, 4
```

## Commit Convention

```
feat(import): unify pipeline state + wipe memory on modal close
feat(parser): add parseVisualJSON — Paprika-style visual layout heuristics
feat(server): add /api/import/visual-parse endpoint
feat(browser-assist): add visual scrape mode with DOM walker + V toggle
feat(import): wire visual scraper into ImportModal flow + latency guard
```

## Testing Plan

1. **Memory wipe**: Open Import Modal → start an import → let it fail/cancel → close → reopen. Verify: blank URL field, no BrowserAssist shown, no "previous" error message.
2. **Visual scrape — recipe blog**: Load a recipe blog URL in BrowserAssist → enable V mode → Parse. Verify: recipe extracted without manual aiming.
3. **Visual scrape — Instagram**: Load an Instagram reel URL → BrowserAssist opens with V mode auto-enabled → Parse. Verify: caption text extracted from video overlay nodes.
4. **Visual scrape failure fallback**: Disable the `/api/import/visual-parse` endpoint → enable V mode → Parse. Verify: toast "Visual parse unavailable — using standard mode" appears, then standard parse runs normally.
5. **isWeakResult guard**: Mock backend returning `{ ingredients: [], directions: [] }`. Verify: BrowserAssist opens instead of importing an empty recipe.
