# SpiceHub Hive-Mind Synthesis
**Swarm Session**: Build 15 | 2026-04-11  
**Workers**: sw-c1nt (audit), sw-tvkq (ux-critique)  
**Scope**: `recipeParser.js`, `api.js`, `ImportModal.jsx`

---

## Cross-Pollination Summary

Both agents identified a shared root failure mode:  
**Silent bypass without user awareness** — the pipeline skips valid recipes without surfacing why, leaving users stranded.

| Audit Finding | UX Finding | Shared Root |
|---|---|---|
| AUDIT-10: No AbortController → silent hang | UX: isCaptionWeak false positive → silent bypass | No user-visible signal on failure |
| AUDIT-06: Inverted MIME check → bad Dexie data | UX: Tier 4 blocks single-signal recipes → fallback confusion | Data quality degrades silently |
| AUDIT-12: No plain-text caption fallback | UX: COOKING_VERBS_RE misses multiline → false weak verdict | Extraction abandons valid captions |
| AUDIT-07: thingproxy no encodeURIComponent | UX: UNITS_RE misses compact metric (250g, 200ml) | European/metric creator recipes fail silently |

---

## Consensus Build — Prioritized Changes

### CB-01: Fix isCaptionWeak Signal-Before-Length Logic  
**Source**: UX Rec 1+2 (P0)  
**Files**: `recipeParser.js` lines 235–256

**Current logic is flawed**: Tier 1 (`< 50 chars`) fires BEFORE signal detection. A 45-char recipe with clear ingredient signals gets rejected before the system even checks whether it looks like a recipe.

**Consensus fix** (pseudocode — see code block below):
```
1. Raw junk check (< 20 raw chars) → weak
2. Clean the caption
3. Detect signals (UNITS_RE, FOOD_RE, COOKING_VERBS_RE_MULTILINE)
4. Strong: both signals → strong
5. Has either signal + length >= 60 → strong  (was 80 — lowered for TikTok/metric)
6. Has either signal + length >= 40 + ingredient-only pattern → strong
7. Cleaned < 50 AND no signals → weak (junk, not recipe)
8. Default → strong (accept edge cases; let AI structuring handle it)
```

---

### CB-02: Fix COOKING_VERBS_RE Multiline Anchor  
**Source**: UX Root Cause 2 (P1)  
**Files**: `recipeParser.js` (COOKING_VERBS_RE definition)

Change `^(mix|stir|...)` to `(?:^|(?<=\n))(mix|stir|...)` or use `(?:^|\n)` lookahead with multiline intent.

**Impact**: Pesto-style captions ("ingredients\nBlend until smooth") now detect "Blend" as a cooking verb.

---

### CB-03: Update UNITS_RE for Compact Metric Notation  
**Source**: UX Rec 1 (P0 for Maria persona)  
**Files**: `recipeParser.js` (UNITS_RE definition)

Add patterns for compact metric: `(?<!\d)g\b`, `ml\b`, `kg\b`, `°C\b`, `°F\b`.

**Impact**: "250g mascarpone", "200ml broth", "180°C" now trigger ingredient signal.

---

### CB-04: Fix Inverted MIME Check in downloadInstagramImage  
**Source**: AUDIT-06 (P2 — prevents Dexie corruption)  
**Files**: `api.js` line ~364

Change:  
`if (!blob.type.startsWith('image/') && blob.size < 500) continue;`  
To:  
`if (!blob.type.startsWith('image/')) continue;`

**Impact**: HTML error pages from CORS proxies are never stored as images in Dexie.

---

### CB-05: Add AbortController to downloadInstagramImage  
**Source**: AUDIT-10 (P1)  
**Files**: `api.js` in `downloadInstagramImage()`

Each proxy fetch should have its own AbortController with 8s timeout (matches existing pattern in `fetchHtmlViaProxy`).

---

### CB-06: Encode thingproxy URL  
**Source**: AUDIT-07 (P2)  
**Files**: `api.js` line ~348

Change:  
`` `https://thingproxy.freeboard.io/fetch/${imageUrl}` ``  
To:  
`` `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(imageUrl)}` ``

---

### CB-07: Expand Shortcode Regex for Stories  
**Source**: AUDIT-01 (P1)  
**Files**: `api.js` line 106 AND `recipeParser.js` equivalent

Change:  
`/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/`  
To:  
`/\/(?:p|reel|reels|tv|stories\/\w+)\/([A-Za-z0-9_-]+)/`

Note: Stories are unlikely to have recipes but the shortcode extraction should not silently fail.

---

### CB-08: Harden Instagram Login Wall Detection  
**Source**: AUDIT-11 (P2)  
**Files**: `api.js` line ~72

Add to `isLoginWall` check:  
```js
|| text.includes('data-testid="login_')
|| text.includes('instagram://login')
|| (text.includes('"is_viewer_logged_in":false') && text.length < 15000)
```

---

## Items NOT in Consensus Build (deferred)

| ID | Reason |
|---|---|
| AUDIT-04: Pattern C backtracking | Instagram HTML is real-world-tested; catastrophic backtracking unlikely in practice. Monitor if timeouts appear. |
| AUDIT-09: Dexie dirty image check | Requires magic byte validation — worth building but separate PR |
| AUDIT-12: Plain text caption fallback | Already handled by rawPageText AI path (line 1188); not a gap |
| AUDIT-08: 1.5MB size limit | Increase to 2MB in next pass; not breaking |
| UX Rec 5: Remove Tier 4 entirely | Too broad; CB-01 partial restructure is the conservative Consensus |

---

## Consensus Build Commit Plan

```
feat(recipeParser): loosen isCaptionWeak for metric/terse recipes (CB-01 to CB-03)
fix(api): MIME check inversion + AbortController + thingproxy encoding (CB-04 to CB-06)
fix(api): expand Instagram shortcode regex + harden login detection (CB-07 to CB-08)
```

**Estimated false positive improvement**: 13–30% → < 5% on real-world recipe captions.  
**Breaking risk**: None. All changes make extraction MORE permissive or MORE hardened. No tightened thresholds.

---

## Testing Plan

1. Short metric caption (< 80 chars, grams): "250g pasta, 200ml broth, 2 garlic cloves. Simmer 20min." → should NOT be weak
2. Ingredient-only TikTok caption (52 chars): "Shrimp, butter, garlic, lemon\nSeason and cook 3min" → should NOT be weak
3. Engagement bait only: "Recipe in comments! Save for later 🔗 #recipe #food" → should BE weak
4. Pesto multiline: "Basil, garlic, pine nuts, parmesan\nBlend with oil" → should NOT be weak
5. Instagram Story URL shortcode: verify extractInstagramShortcode returns null gracefully
6. thingproxy with query string URL: verify encodeURIComponent fix doesn't double-encode
7. CORS proxy returning HTML 401 error page: verify not stored as Dexie image after CB-04

---
*Generated by sw-c1nt + sw-tvkq | Distilled by sw-yute | Approved by queen-spicehub*

---

# Bar Environment Rules — BarShelf Immersive Scene
**Swarm Session**: Build 17 | 2026-04-12
**Scope**: `BarShelf.jsx`, `App.css` — Immersive 8-bit speakeasy visual + interaction contract

---

## Layering Contract (Non-Negotiable Z-index Stack)

```
[Back Shelf / Barback Display]  z-index: 1   (.bs-backbar)
        ↑
[Bartender Sprite]              z-index: 2   (.bs-bartender-wrap)
        ↑
[Bar Countertop Surface]        z-index: 5   (.bs-bar-surface)
        ↑
[Brass Foot Rail]               z-index: 6   (.bs-bar-rail)
        ↑
[Speech Bubbles]                z-index: 100 (.bs-quips-layer)
```

**Rule**: Never flatten these into adjacent values. The bartender MUST sit between the back shelf (z:1) and the bar counter (z:5). This gives the physical illusion of him standing behind the mahogany bar — lower body hidden, torso and head visible.

---

## Interaction Choreography

### Bottle Selection Flow
```
User taps bottle → bartender walks to bottle position
                → state: "grabbing" (arm raises, bottle lifted)
                → moves to center: state: "presenting"
                → barback display switches from marquee → recipe card
                → speech bubble: "Here ya go!" (anchored to correct side)
User dismisses  → state: "returning" → walks bottle back to shelf
                → state: "walking" → walks home to restPos
                → state: "idle" → wipe arm animation resumes
```

### Idle Behavior Loop
- **Default idle state**: bartender wipes bar (`.bs-bt-wipe-arm` CSS animation)
- **Swig timer**: `8000 + Math.random() * 7000` ms → triggers `runSwigSequence()`
  - Timer is stored in `swigTimerRef.current`
  - **Always cleared on unmount** via the cleanup `useEffect(() => () => { clearTimeout(swigTimerRef.current); ... }, [])`
  - **Reset on any user interaction** via `clearTimeout(swigTimerRef.current)` in `handleBottleTap`
- **Idle behavior cycle** (every 30–45s): randomly triggers `tipping` or `dozing` state
- **Idle quip cycle**: rotates `IDLE_QUIPS[]` via `setInterval` every 5s

### Swig Sequence
```
idle → swigwalk (walk to random bar position)
     → swigging (head tilts, arm raises bottle, swigQuip appears)
     → swigreturn (walk back to home position)
     → polishing (40% chance) OR idle
```

---

## Speech Bubble Rules

### Positioning Contract
- Speech bubbles live in `.bs-quips-layer` which translates with the bartender
- Bubbles use `position: absolute` + CSS custom property `--bubble-x` for direction
- **NEVER use `justify-content: center`** on `.bs-quips-layer` — this centered bubbles over the face

### Direction Logic
```
facingRight = true  → face is on RIGHT half of sprite
                    → bubble anchors LEFT:  --bubble-x: -85%  (class: bs-bt-speech--left)
                    → CSS triangle tail: right: 18px  (points toward face on right)

facingRight = false → sprite mirrored, face on LEFT half
                    → bubble anchors RIGHT: --bubble-x: -15%  (class: bs-bt-speech--right)
                    → CSS triangle tail: left: 18px   (points toward face on left)
```

### JSX Pattern
```jsx
<div className={`bs-bt-speech ${facingRight ? 'bs-bt-speech--left' : 'bs-bt-speech--right'}`}>
```

### Bubble Flavours
| Variant class         | Background | Use case        |
|-----------------------|-----------|-----------------|
| *(base)*              | `#fffef0` | Presenting      |
| `bs-bt-speech-idle`   | `#fffef0` | Idle quips (pulse animation) |
| `bs-bt-speech-swig`   | `#ffcc02` | Sneaky swig     |
| `bs-bt-speech-tip`    | `#e8f5e9` | Hat tip         |

---

## Memory Leak Guard

The swig timer `useEffect` MUST follow this pattern:
```jsx
useEffect(() => {
  if (bartenderState !== 'idle' || selectedDrink) {
    clearTimeout(swigTimerRef.current);
    return;
  }
  const delay = 8000 + Math.random() * 7000;
  swigTimerRef.current = setTimeout(() => runSwigRef.current?.(), delay);
  return () => clearTimeout(swigTimerRef.current); // ← cleanup on re-run & unmount
}, [bartenderState, selectedDrink]);
```

The stable ref pattern (`runSwigRef.current`) prevents the `useEffect` from re-running every time `bartenderX` changes, which would reset the timer unnecessarily.

---

## Zero-Cost Constraint

All bartender visuals are pure SVG pixel art (no external image assets).
All animations use CSS `@keyframes` + `transform`/`opacity` only (no layout-triggering props).
No 3D libraries. No canvas. No WebGL.

---
*Generated by queen-spicehub | Build 17 — Bar Environment Rules*

---

# Scraper Strategy v2 — Import Engine Hardening
**Swarm Session**: Build 16 | 2026-04-11
**Scope**: Zero-cost scraper tier expansion — Reddit JSON, Turndown blog pipeline, yt-dlp-exec plan, endpoint nudging

---

## Architecture Overview

The new import engine operates as a **tiered waterfall** — each tier is tried in sequence, returning on first success. All tiers are zero-cost (no paid APIs).

```
URL → [Tier 0: Reddit JSON]
     → [Tier 1: Instagram embed / Agent / yt-dlp]
     → [Tier 2: Social media Agent + yt-dlp]
     → [Tier 3a: CORS proxy + JSON-LD / microdata / CSS]
     → [Tier 3b: Endpoint nudging (WP REST / WPRM API / JSON suffix)]
     → [Tier 3c: Server-side (yt-dlp + headless Chrome)]
     → [Tier 3d: Turndown HTML→Markdown → Gemini]
     → [Tier 3e: Raw text → Gemini (legacy)]
     → [Tier 4: User paste fallback]
```

---

## Tier Specifications

### Tier 0: Reddit JSON Discovery (NEW — `src/scrapers/redditDiscovery.js`)

**Method**: Reddit `.json` endpoint trick — append `?raw_json=1` to any reddit.com URL.

**Mechanism**:
- `https://www.reddit.com/r/recipes/comments/{id}/.json` → structured post JSON
- `https://www.reddit.com/r/recipes/new.json?limit=25` → subreddit discovery feed
- No API key required. Rate limit: 60 req/min per IP.
- Reddit stores post body as **Markdown natively** — no Turndown needed.
- Direct browser fetch works (Reddit allows cross-origin on `.json`). CORS proxy as fallback.

**Link post handling**: If the Reddit post is a link to an external recipe site, the
engine follows the link recursively via `parseFromUrl(externalUrl)`.

**Files**:
- `src/scrapers/redditDiscovery.js` — `isRedditUrl`, `isRedditPostUrl`, `tryRedditJson`,
  `extractRedditPost`, `discoverRedditRecipes`

**Integration point** in `parseFromUrl`: Block 0, before Instagram check.

---

### Tier 3b: Endpoint Nudging (NEW — inline in `recipeParser.js`)

**Method**: Probe known background JSON endpoints before resorting to AI.

**Probes (in order)**:
1. **WordPress REST API**: `{origin}/wp-json/wp/v2/posts?slug={slug}`
   - Works on ~60% of recipe blogs (most use WordPress)
   - Returns full post HTML in `content.rendered` — we run JSON-LD + CSS + Turndown on it
2. **WP Recipe Maker API**: `{origin}/wp-json/wprm/v1/recipe/{post_id}`
   - Returns perfectly structured `{ ingredients, instructions }` JSON
   - Zero-cost alternative to WPRM-class CSS selectors that break on plugin updates
3. **JSON suffix**: `{url}.json` or `{url}?format=json`
   - Ghost CMS, some Craft CMS, headless WordPress sites

**Why this matters**: CSS class selectors like `.wprm-recipe-ingredient` break every time
the plugin updates its DOM structure. The WP REST API and WPRM API are versioned and stable.

**Files**: `tryEndpointNudging()` and `normalizeWprmApiResponse()` in `recipeParser.js`

---

### Tier 3d: Turndown HTML → Markdown → Gemini (NEW — `src/scrapers/markdownConverter.js`)

**Method**: Convert blog HTML to clean Markdown before Gemini, instead of stripping all tags.

**Why Turndown is better than `.replace(/<[^>]+>/g, ' ')`**:
- Preserves `<ol>` numbered steps → `1. Step\n2. Step` (parseCaption detects STEP_NUM_RE)
- Preserves `<ul>` ingredient lists → `- ingredient` (BULLET_RE matches)
- Preserves `##` section headings → `isIngredientsHeader` / `isDirectionsHeader` match them
- Output is 3–10x shorter than raw HTML (fewer tokens → cheaper + faster Gemini call)
- Turndown is already installed (v7.2.4 in package.json) — zero additional cost

**Pipeline**:
```
html → stripBlogNoise() → focusRecipeSection() → TurndownService.turndown() → cleanMarkdown() → Gemini
```

**`focusRecipeSection()`**: Narrows HTML to the recipe card before Turndown runs, using
patterns for WPRM, Tasty Recipes, Mediavine, Feast, schema.org itemtype, `<main>`, `<article>`.

**`htmlLooksLikeRecipe()`**: Fast pre-check that skips Turndown if the page clearly has no
recipe (saves Gemini calls on non-recipe pages that slipped through).

**Files**: `src/scrapers/markdownConverter.js` — `htmlToMarkdown`, `stripBlogNoise`,
`focusRecipeSection`, `htmlLooksLikeRecipe`

---

## yt-dlp-exec Migration Plan (Server-Side)

**Current state**: `server.js` calls yt-dlp via `child_process.exec` / `spawn` with raw
shell strings. This is fragile: path resolution varies by OS, escaping is manual, and
error messages are opaque.

**Target**: Replace with `yt-dlp-exec` npm package (`npm install yt-dlp-exec`).

**Why yt-dlp-exec**:
- Resolves yt-dlp binary path automatically (bundles or finds system install)
- Cleaner async API: `const info = await youtubeDl(url, { dumpSingleJson: true })`
- Better error handling: typed errors with exit codes
- Built-in subtitle extraction: `subtitlesLang: 'en'`, `writeAutoSub: true`
- Works in Render Docker environment when yt-dlp is in `/usr/local/bin`

**Migration steps** (server.js — separate PR):
```
1. npm install yt-dlp-exec
2. Replace: exec(`yt-dlp --dump-json "${url}"`, ...)
   With:    const info = await youtubeDl(url, { dumpSingleJson: true })
3. Replace: exec(`yt-dlp --write-auto-sub --skip-download ...`, ...)
   With:    await youtubeDl(url, { writeAutoSub: true, subLang: 'en', skipDownload: true, output: outputPath })
4. Add ytDlpPath option pointing to Render's /usr/local/bin/yt-dlp if auto-detect fails
5. Wrap all calls in try/catch with typed error logging
```

**Docker path note**: The Render `render-build.sh` already installs yt-dlp. The `yt-dlp-exec`
package's `YTDlpWrap` constructor accepts a custom binary path:
```js
import YTDlpWrap from 'yt-dlp-wrap';
const ytDlp = new YTDlpWrap('/usr/local/bin/yt-dlp');
```

**Zero-cost**: yt-dlp itself is free; yt-dlp-exec is an MIT npm package.

---

## New Files Summary

| File | Purpose | Exports |
|---|---|---|
| `src/scrapers/redditDiscovery.js` | Zero-auth Reddit JSON scraping | `isRedditUrl`, `isRedditPostUrl`, `tryRedditJson`, `discoverRedditRecipes` |
| `src/scrapers/markdownConverter.js` | Turndown HTML→MD pipeline | `htmlToMarkdown`, `stripBlogNoise`, `focusRecipeSection`, `htmlLooksLikeRecipe` |

## Modified Files Summary

| File | Changes |
|---|---|
| `src/recipeParser.js` | Added imports for new scrapers; added `tryEndpointNudging()`, `normalizeWprmApiResponse()`, `tryMarkdownExtraction()`, `structureRedditRecipe()`; updated `parseFromUrl()` with 3 new tiers |

---

## Testing Plan v2

**Reddit JSON**:
1. `https://www.reddit.com/r/recipes/comments/{id}/chicken_tikka_masala/` → should extract ingredients + directions
2. Reddit link post pointing to `allrecipes.com` URL → should follow link and extract from allrecipes
3. Old Reddit URL `old.reddit.com/r/...` → should normalize correctly

**Endpoint Nudging**:
4. Any WordPress recipe blog with WPRM → `/wp-json/wp/v2/posts?slug=...` should return content
5. `budgetbytes.com` (uses WPRM) → WP REST API should hit, WPRM API may hit
6. Non-WordPress site → nudging should fail silently within 6s timeout, fall through to Tier 3d

**Turndown Pipeline**:
7. Recipe blog where JSON-LD is empty but WPRM HTML exists → Turndown+Gemini should extract
8. Blog with only OG tags → `htmlLooksLikeRecipe()` should return false, skip Turndown (saves tokens)
9. Ghost blog with `/content.json` → JSON suffix probe should hit

**Zero-cost constraint verification**:
- No Firecrawl, Apify, or paid proxy calls in any new code path
- All CORS proxies in `api.js` are free-tier public services
- Gemini key usage is existing (client-side Gemini Flash, already budgeted)

---
*Generated by queen-spicehub | Build 16 — Scraper Hardening Sprint*
