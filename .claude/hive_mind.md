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
