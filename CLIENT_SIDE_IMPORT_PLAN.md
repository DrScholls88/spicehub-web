# SpiceHub Client-Side Instagram Import Architecture

**Date**: April 7, 2026  
**Goal**: Move Instagram recipe extraction from server-side (Playwright MCP) to client-side (browser DOM), while preserving the unified import engine and offline-first behavior.

---

## Executive Summary

**Current Strategy** (Server-Side, documented in recipeParser.js):
- ALL URLs → `/api/extract-url` (server-side headless Chrome)
- Social media → headless browser rendering
- Recipe blogs → HTTP fetch + JSON-LD parsing
- **Problem**: Server-side Playwright hits sandbox restrictions, IP blocking, bot detection, and creates round-trip latency

**Proposed Strategy** (Client-Side, within Unified Engine):
- Instagram URLs → run DOM extraction **in the user's browser** (no server round-trip)
- Use Instagram's public embed endpoint or direct page scraping
- Cache results in Dexie (offline-first)
- Fall back to unified manual caption paste if extraction fails
- **Benefit**: Zero bot detection, instant offline availability, PWA-friendly, works on mobile without server resources

**Key Principle**: The **Unified Import Engine** (importRecipeFromUrl) stays the same. We're just changing *how* we extract from Instagram, not *where* it feeds into the pipeline.

---

## Architecture Comparison

### Current (Server-Side) Flow
```
ImportModal.jsx
  └─→ importRecipeFromUrl(url)  [in recipeParser.js]
       └─→ /api/extract-url (server-side)
            ├─→ headless Chrome for Instagram
            ├─→ HTTP + JSON-LD for recipe blogs
            └─→ returns { title, ingredients, directions, image }
       └─→ structureWithAI()
       └─→ save to Dexie
```

**Issues**:
- ❌ Playwright sandbox restrictions prevent browser install
- ❌ Server CPU cost (Vercel cold start or server overhead)
- ❌ Instagram IP blocking & bot detection on server IPs
- ❌ Latency: User → Server → Instagram → back to user (100ms+)
- ❌ Not truly offline-first (requires server connection)

### Proposed (Client-Side) Flow
```
ImportModal.jsx (user's browser)
  └─→ importRecipeFromUrl(url)
       ├─→ Phase 0: tryVideoExtraction()
       │    └─→ fetch Instagram embed endpoint (no auth needed)
       │         └─→ parse <video>, <script type="application/ld+json">
       │
       ├─→ Phase 1: fetchInstagramCaption()
       │    └─→ fetch https://www.instagram.com/reel/XXX/embed/captioned/
       │         └─→ CORS via proxy or direct if allowed
       │         └─→ extract caption + image
       │
       ├─→ Phase 2: fallback to manual paste
       │    └─→ _needsManualCaption flag → show paste tab
       │
       └─→ Phase 3: structureWithAI()
            └─→ client-side Gemini (if VITE_GOOGLE_AI_KEY set)
            └─→ or fallback to heuristic parser
            └─→ save to Dexie
```

**Benefits**:
- ✅ Runs in user's browser (own IP, own context)
- ✅ No server overhead
- ✅ Instant offline availability (cached in Dexie)
- ✅ Works on iOS/Android/Windows
- ✅ No Playwright sandbox issues
- ✅ User controls timing (no server load spikes)

---

## Current Code State

### recipeParser.js (Lines 1–9)
```javascript
/**
 * Strategy: ALL URLs → server-side extraction first (/api/extract-url)
 *   • Social media → headless Chrome
 *   • Recipe blogs → fast HTTP + JSON-LD
 * CORS PROXY → fallback if server unreachable
 */
```

**Current public functions**:
- `isSocialMediaUrl()` ✅ (keep)
- `getSocialPlatform()` ✅ (keep)
- `selectBestImage()` ✅ (keep)
- `importRecipeFromUrl()` (needs refactor)
- `parseCaption()` ✅ (keep)
- `structureWithAI()` ✅ (keep)

### ImportModal.jsx (Line 3)
```javascript
import { importRecipeFromUrl, ... } from '../recipeParser.js';
```

**Currently calls**: `importRecipeFromUrl()` → which does `await fetch('/api/extract-url')`

### BrowserImport.jsx (unused in new plan)
- This component opens a **native in-app browser** (different from our strategy)
- We're proposing **DOM extraction without the native browser UI**
- Can deprecate or repurpose this component

---

## Implementation Plan

### Phase 1: Refactor importRecipeFromUrl() (Core Engine)

**File**: `src/recipeParser.js`

**Changes**:
1. Move Instagram logic to client-side branch
2. Keep recipe blog logic server-side (or client-side heuristic)
3. Preserve graceful degradation (manual paste fallback)

**New structure** (pseudocode):
```javascript
export async function importRecipeFromUrl(url, progressCallback = () => {}) {
  url = await resolveShortUrl(url);
  progressCallback({ step: 'start', message: 'Starting import...' });

  if (isInstagramUrl(url)) {
    // NEW: Client-side extraction
    return await importFromInstagramClient(url, progressCallback);
  } else if (isRecipeBlogUrl(url)) {
    // Keep server-side for blogs (or add client heuristic)
    return await importFromBlogClient(url, progressCallback);
  } else {
    // Generic fallback
    return await importFromGenericUrl(url, progressCallback);
  }
}

async function importFromInstagramClient(url, progressCallback) {
  progressCallback({ step: 'phase0', message: 'Fetching Instagram page...' });
  
  // Phase 1: Try embed endpoint
  let caption, imageUrl;
  try {
    const embedUrl = url.replace(/\/$/, '') + '/embed/captioned/';
    const html = await fetch(embedUrl).then(r => r.text());
    // Parse caption from embed HTML
    caption = extractCaptionFromEmbed(html);
    imageUrl = selectBestImage(parseImages(html));
  } catch (e) {
    console.warn('Embed fetch failed, trying manual paste:', e);
    return { _needsManualCaption: true, sourceUrl: url };
  }

  // Phase 2: Clean & structure
  if (!caption || isCaptionWeak(caption)) {
    return { _needsManualCaption: true, sourceUrl: url };
  }

  progressCallback({ step: 'phase3', message: 'Structuring recipe...' });
  const recipe = await structureWithAI(cleanSocialCaption(caption));
  recipe.imageUrl = imageUrl;
  recipe.sourceUrl = url;

  progressCallback({ step: 'complete', message: 'Recipe imported!' });
  return recipe;
}
```

**Key Functions to Add**:
- `extractCaptionFromEmbed(html)` — parse HTML from embed endpoint
- `parseImages(html)` — extract image URLs from embed HTML
- `importFromInstagramClient()` — main client-side flow
- `importFromBlogClient()` — heuristic parser for recipe blogs (optional, can stay server)

### Phase 2: Handle CORS

**Problem**: Instagram's embed endpoint may block direct fetch from browser.

**Solutions** (in priority order):

1. **Use Instagram's public embed endpoint** (most likely to work):
   ```javascript
   const embedUrl = `${url.replace(/\/$/, '')}/embed/captioned/`;
   // This endpoint is meant for embedding, so CORS is more permissive
   ```

2. **Use a rotating CORS proxy** (if embed endpoint fails):
   ```javascript
   const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(embedUrl)}`;
   const data = await fetch(proxyUrl).then(r => r.json());
   const html = data.contents;
   ```

3. **Cache results in Dexie** (so user doesn't need server after first import):
   ```javascript
   // In importFromInstagramClient:
   const cached = await db.instagramCache.get(url);
   if (cached) return cached;
   // ... fetch and structure ...
   await db.instagramCache.put({ url, recipe, timestamp: Date.now() });
   ```

4. **Fall back to manual paste** (worst case, but always available):
   ```javascript
   if (allPhasesFail) {
     return { _needsManualCaption: true, sourceUrl: url };
   }
   ```

### Phase 3: Update ImportModal.jsx

**File**: `src/components/ImportModal.jsx`

**Changes**:
1. No changes needed! The component already calls `importRecipeFromUrl()`
2. Just ensure `progressCallback` state updates work:
   ```javascript
   const [progress, setProgress] = useState([]);
   
   const handleImport = useCallback(async () => {
     setImporting(true);
     try {
       const recipe = await importRecipeFromUrl(url, (update) => {
         setImportProgress(update.message);
       });
       // ... handle recipe ...
     } finally {
       setImporting(false);
     }
   }, [url]);
   ```

### Phase 4: Wire up Dexie Caching (Optional but Recommended)

**File**: `src/db.js` (or wherever Dexie is initialized)

**Add table**:
```javascript
db.version(2).stores({
  recipes: '++id, name, createdAt',
  meals: '++id, date, mealType',
  instagramCache: 'url, timestamp',  // ← NEW
  // ... others ...
});
```

**Usage in recipeParser.js**:
```javascript
import { db } from './db.js';

// Check cache before fetching
const cached = await db.instagramCache
  .where('url').equals(url)
  .filter(entry => Date.now() - entry.timestamp < 7 * 24 * 60 * 60 * 1000) // 7 day TTL
  .first();

if (cached) return cached.recipe;

// ... fetch from Instagram ...

// Cache the result
await db.instagramCache.put({
  url,
  recipe,
  timestamp: Date.now(),
});
```

### Phase 5: Update BrowserAssist.jsx (if needed)

**File**: `src/components/BrowserAssist.jsx`

**Current use**: Shows progress during import.

**No changes needed** if progress state is already wired to `setImportProgress()` callback.

**If new**: Wire progress updates:
```javascript
const [steps, setSteps] = useState([
  { phase: 'phase0', label: 'Fetching page', complete: false },
  { phase: 'phase1', label: 'Extracting caption', complete: false },
  { phase: 'phase3', label: 'Structuring recipe', complete: false },
  { phase: 'complete', label: 'Done', complete: false },
]);

const progressCallback = (update) => {
  setSteps(prev => prev.map(step =>
    step.phase === update.step ? { ...step, complete: true } : step
  ));
};
```

---

## Differences from Current Configuration

| Aspect | Current (Server-Side) | Proposed (Client-Side) |
|--------|----------------------|------------------------|
| **Extraction Location** | Server (Vercel/Node.js) | User's Browser |
| **Bot Detection Risk** | ❌ High (shared server IP) | ✅ Low (user's IP) |
| **Latency** | 100–500ms+ | <50ms (local DOM) |
| **Offline Support** | ❌ Requires server | ✅ Works offline (Dexie) |
| **Mobile-Friendly** | ⚠️ Depends on server | ✅ Native browser APIs |
| **Playwright Needed** | ❌ Required (broken in sandbox) | ✅ Not needed |
| **Server Infrastructure** | ✅ Server required | ❌ Completely client-side |
| **CORS Handling** | Transparent (server-side) | ✅ Via embed endpoint + proxy |
| **Graceful Degradation** | Manual paste fallback | ✅ Same, but faster |
| **Caching** | ❌ Doesn't cache | ✅ Dexie cache (offline) |

---

## Integration with Unified Import Engine

**The key insight**: We're not breaking the unified engine. We're just changing the *implementation of Phase 1* (fetch caption).

**Old flow**:
```
importRecipeFromUrl(url)
  → fetch /api/extract-url (server)
    → returns caption + image
  → structureWithAI(caption)
```

**New flow**:
```
importRecipeFromUrl(url)
  → fetch embed endpoint (client)
    → returns caption + image
  → structureWithAI(caption)
```

**Everything downstream stays the same**:
- ✅ `structureWithAI()` — unchanged
- ✅ `cleanSocialCaption()` — unchanged
- ✅ `parseCaption()` — unchanged
- ✅ Dexie save — unchanged
- ✅ Share-target handler — unchanged
- ✅ Offline queue — unchanged
- ✅ PWA manifest — unchanged

---

## Testing Strategy

### Unit Tests
1. **`extractCaptionFromEmbed(html)`** — parse HTML fixture of Instagram embed
2. **`parseImages(html)`** — ensure `selectBestImage()` picks correctly
3. **`importFromInstagramClient(url)`** — mock fetch, verify caption extraction

### Integration Tests
1. **Real Instagram Reel** — paste actual URL, verify caption extraction
2. **Weak Caption** — Reel with minimal text, verify fallback to manual paste
3. **Video-Heavy Reel** — mostly video, verify graceful degradation
4. **CORS Proxy Fallback** — disable embed endpoint, verify proxy fallback works

### Manual Smoke Tests (Post-Deploy)
1. **Mobile (iOS/Android)** — import from Instagram, verify offline cache
2. **Desktop** — multiple imports, check Dexie cache growth
3. **Share Target** — paste Instagram link via app's share handler
4. **Offline Mode** — disable network, verify cached imports still work

---

## Rollout Plan

### Step 1: Code Review
- Review refactored `recipeParser.js`
- Review CORS proxy strategy
- Ensure graceful fallback is solid

### Step 2: Local Testing
- Test with 10–15 real Instagram Reels (various formats)
- Test weak captions, video-heavy posts, etc.

### Step 3: Staging Deploy
- Deploy to staging branch
- Smoke test on mobile & desktop
- Check Dexie cache for memory issues

### Step 4: Production Deploy
- Roll out gradually (10% → 50% → 100% of users)
- Monitor error rates, fallback-to-manual-paste % 
- If issues, roll back to server-side

### Step 5: Deprecate Server-Side
- Once client-side is stable, remove `/api/extract-url`
- Reduce server memory/CPU footprint

---

## Next Steps

1. **You review** this plan — any questions or changes?
2. **I implement** Phase 1: Refactor `importRecipeFromUrl()` to client-side
3. **You test** on real Instagram URLs
4. **Deploy** and monitor

**Questions to clarify**:
- Do you want Dexie caching for Instagram imports? (Recommended for offline)
- Should we use the embed endpoint or a CORS proxy as primary? (Embed is preferred)
- Any existing CORS proxy infrastructure I should use?
- Timeline: When do you want this shipped?

---

## Files to Modify

```
src/
  ├── recipeParser.js              ← Main refactor (move Instagram to client-side)
  ├── components/
  │   ├── ImportModal.jsx          ← No changes (already calls importRecipeFromUrl)
  │   └── BrowserAssist.jsx        ← Wire up progress callback (if needed)
  ├── db.js                        ← Add instagramCache table (optional)
  └── api.js                       ← No changes (CORS proxy fallback already there)
```

**Lines of code**: ~150–200 new/modified (mostly in recipeParser.js)  
**Breaking changes**: None (public API stays the same)  
**Backwards compatibility**: Full (server-side fallback still works)
