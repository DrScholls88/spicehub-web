# Import Engine Enhancement Plan

**Date:** 2026-07-08  
**Status:** Approved for implementation (pending go-ahead)  
**Goal:** Make the flagship Import Engine seamless, reliable, and accurate — especially for Instagram Reels/videos — via surgical unification. One brain, zero cost, no regressions.

**Priorities (user):**
- Instagram Reels/videos (caption + photo)
- Unification / reliability

**Approach:** Surgical — route all paths through ContextPack + `structurePack`; keep legacy cascades as safety nets; delete only proven-dead code.

**IG strategy:** Harden the current free stack (Apify ∥ oEmbed ∥ ig-json → embed → yt-dlp → Whisper); merge caption + transcript into one ContextPack before Gemini.

---

## 1. Problem

The Import Engine is functional and mostly accurate, but not yet reliable or smooth enough for a flagship feature.

Root causes:

1. **Dual structuring paths** — websites use `ContextPack` + `structurePack` (50k budget, reconciliation, verifier mode); Instagram/paste still use `captionToRecipe` → `structureWithAIClient` with an 8k raw-text truncate and no labeled CAPTION/TRANSCRIPT sections.
2. **Instagram pack is discarded** — `acquireInstagramPack` returns a ContextPack, then `importFromInstagram` throws it away and structures caption text alone.
3. **Monolith debt** — `recipeParser.js` still owns routing, IG phases, and structure; `src/import/` is only partially landed.
4. **Fragile IG video path** — empty/weak captions on reels, CDN 403s on photos, transcript not systematically merged with caption before Gemini.
5. **Website plugin extractors client-only** — WPRM/Tasty/EasyRecipe live in client `parseHtml`, not in `/api/extract`.

Design north-star remains:  
`docs/superpowers/specs/2026-07-02-import-engine-unification-design.md`

---

## 2. Target architecture (surgical)

```
URL
 → classify (IG | website | reddit | social/video | text)
 → acquire/*  →  ContextPack
     (caption + transcript + markdown + jsonLd + images + provenance)
 → structurePack
     (single Gemini brain: 50k budget, reconciliation, verify mode)
 → finalize
     (thinFromStructured → enforceDeterministicRules → cross-check → images)
 → ImportReview → Dexie

Legacy cascades remain as FALLBACKS only (never alternate product engines).
```

**Public API unchanged:**
- `importRecipeFromUrl`
- `importFromInstagram`
- `captionToRecipe`

**Product path:** sync ImportSheet + Vercel `/api/extract` + `/api/structure`  
**Render role:** yt-dlp / Whisper / stealth resource helpers only — not a second import UX.

---

## 3. Current state (keep)

| Layer | Status |
|-------|--------|
| `ContextPack` + `structurePack` | Works for website `/api/extract` path |
| `acquire/instagram.js` race | Works; returns caption + images only |
| IG structure path | Still caption path (8k raw text) |
| `recipeParser.js` | ~5.5k LOC monolith still owns routing + IG |
| Golden corpus | ~100 offline tests — gate for every step |
| Free stack | Gemini free tier, Apify free, Vercel extract/structure, Render yt-dlp/Whisper |

---

## 4. Phase 0 — Safety net (before product code)

1. Confirm `npm run test:corpus` is green.
2. Add fixture cases that lock intended behavior *before* code moves:
   - IG reel: weak caption + rich transcript → ingredients/directions from transcript; tips from caption
   - IG: caption + transcript both present → no double-counted steps; no junk
   - IG: carousel images → hero + `_carouselImages` length ≥ 2
   - Paste text → still structures via pack (parity)
3. Keep recorded Gemini responses for CI; live checks stay opt-in (`npm run test:live`).

**Gate:** corpus green; no product behavior change yet.

**Files:** `tests/import/fixtures/**`, `tests/import/corpus.*.test.js`

---

## 5. Phase 1 — One structure path (highest leverage)

**Problem:** Dual brains (`structurePack` vs `structureWithAIClient` 8k truncate).

### 5.1 `captionToRecipe` → ContextPack adapter

- Build pack: `{ sourceType: 'text'|'instagram', caption: cleaned, title, images }`
- Call `structurePack` (client key → `/api/structure` fallback)
- Keep deterministic cross-check + `finalizeAIRecipe` after
- Remove effective 8k ceiling for pack path (50k already in `contextPack.js`)

### 5.2 `importFromInstagram` pack merge (flagship fix)

After all acquire phases, build **one** pack before any Gemini call:

```js
{
  sourceType: 'instagram',
  sourceUrl,
  title: capturedTitle,
  caption: cleanedCaption,          // junk-stripped
  transcript: ytdlpSubs || whisper, // if any
  markdown: null | rawPageText,     // only if caption+transcript both weak
  images: carouselCandidates,       // ≤6
  acquiredVia,
  provenance: [],
  confidence: number,
}
```

Then: `structurePack(pack)` → finalize → existing image resolve  
(`selectHeroImage` / `persistCarousel` / `resolveDisplayableImage`).

### 5.3 Video weak-caption path

- If caption weak but transcript strong: pack has both; reconciliation prefers structured quantities from text, narrative steps from transcript.
- ImportSheet Whisper auto-call stays; feed result into pack as `transcript`, not a second parallel engine.

### 5.4 Delete proven-dead only (after corpus green)

- `_structureWithAIClientLegacy` + `_buildExtractionPrompt`
- Grok client remnants if any call sites remain
- **Do not** delete CORS / parseHtml / endpoint-nudge / Render helpers yet

**Files:**
- `src/recipeParser.js` (`captionToRecipe`, `importFromInstagram`)
- `src/import/structure/gemini.js`
- `src/import/contextPack.js` (optional `packFromCaption` helper)
- tests

**Risk control:** pack path succeeds → return; on failure fall through to existing caption/client behavior until corpus proves pack wins. Optional `VITE_IMPORT_PACK_ONLY=1` for forced pack path in dev.

**Gate:** corpus green; IG + paste paths use pack sections in tests.

---

## 6. Phase 2 — Instagram accuracy hardening (free stack only)

Keep order:

```
Apify ∥ oEmbed ∥ ig-json
  → /api/extract embed
  → client embed
  → imginn / picuki
  → browser agent
  → yt-dlp
  → Whisper
```

| Area | Change |
|------|--------|
| Caption + transcript merge | Always both in pack when available (Phase 1); never structure caption alone when transcript exists |
| Weak-caption policy | If weak caption + any transcript ≥ N chars → structure (don't early-exit to BrowserAssist) |
| Empty caption + video | Prefer yt-dlp metadata/subs first; if still empty, Whisper; only then `_emptyCaption` + BrowserAssist |
| Photos / reels | Prefer post-specific CDN over oEmbed avatar; vision hero gate only when video-only / heuristic fail; always persist carousel ≤6 data URLs |
| CDN 403 | Data-URL first, proxy fallback; never store raw scontent that dies later |
| Provenance UX | Surface `acquiredVia` + "via Apify / subtitles / Whisper" on timeline (`progressMap` chips) |
| Race quality (optional) | Prefer longer/recipe-signal caption over first-to-finish if multiple race winners available (`Promise.allSettled` + score) |

**Do not add** Cobalt/extra scrapers this pass unless Apify free tier is exhausted in practice.

**Files:**
- `src/import/acquire/instagram.js`
- `src/import/images.js`
- `importFromInstagram` in `src/recipeParser.js`
- `api/extract.js` IG fallback only if embed parse gaps found

**Gate:** corpus IG fixtures; manual 3–5 real reels (clean caption, weak caption + subs, carousel photo post).

---

## 7. Phase 3 — Prompt / response quality (pack path)

Base already present: `SYSTEM_INSTRUCTION` v`2026.07.2` + reconciliation + verifier.

1. **IG-specific reconciliation addendum** (append only when `sourceType === 'instagram'`):
   - Prefer numbered/ingredient lists in caption over spoken fluff in transcript
   - Transcript fills missing steps/amounts; never invent
   - Reinforce strip of music credits, timestamps, "link in bio"
2. **Notes field discipline**
   - Tips/substitutions → `notes[]`
   - Never put promo/hashtags in notes (corpus assert)
3. **Post-structure auto-sort**
   - Keep `enforceDeterministicRules` + `crossCheckStructured` as single post-pass
   - Title fallback `generateTitleFromIngredients` only when title empty/junk
   - Map model `provenance` into review badges
4. **Version bump** only if instruction text changes meaningfully → `ENGINE_PROMPT_VERSION` so I-5 re-extract offers improve

**Files:** `src/import/structure/gemini.js`, possibly `src/recipeSchema.js`, finalize helpers

**Gate:** schema/corpus fixtures; zero-junk assertions

---

## 8. Phase 4 — Website reliability (secondary, surgical)

1. Port WPRM / Tasty / EasyRecipe CSS extractors into `/api/extract` (today client-only in `parseHtml`).
2. When candidate incomplete but plugin card complete → promote candidate; prefer verifier mode.
3. Leave long client cascade as fallback; **do not prune** until corpus + live blogs prove server path wins.

**Files:** `api/extract.js`, `tests/import/fixtures/html/**`

---

## 9. Phase 5 — Dead weight & clarity (low risk)

1. Document product path: sync ImportSheet + Vercel extract/structure is the product. Render v2 async = optional server resource only.
2. Ensure no UI entry advertises a separate "alt engine."
3. Optional later: thin re-export barrel for `recipeParser` (full monolith split deferred).

---

## 10. Cost posture (zero / free tier)

| Service | Role | Cost |
|---------|------|------|
| Gemini flash-lite → flash escalate | Structure + vision hero gate | Free tier |
| `/api/extract` | HTML / JSON-LD / IG embed | Vercel free, no secrets |
| `/api/structure` | Server Gemini key | Free tier |
| Apify IG | Primary caption | Free credits |
| oEmbed / ig-json / embed | Free fallbacks | $0 |
| Render yt-dlp + Whisper | Transcript for reels | Existing free tier |
| Tesseract | Photo offline draft | $0 |

**No new paid APIs.** If free tiers hit limits later, present options (higher Gemini tier, Apify paid, self-hosted reader) — not in this pass.

---

## 11. Explicit non-goals (this pass)

- Full dismantle of `recipeParser.js` monolith
- Deleting website CORS / parseHtml cascade
- Re-enabling Grok
- Numeric `ingredientIds` schema migration
- Full ImportSheet UI redesign (critique P0 drag/a11y — separate unless blocking)
- New paid Instagram APIs

---

## 12. Implementation order & gates

| Step | Work | Success criteria |
|------|------|------------------|
| 0 | Fixtures + corpus baseline | `npm run test:corpus` green |
| 1 | `captionToRecipe` + IG → `structurePack` | All structure paths use labeled pack; corpus green |
| 2 | IG merge/harden + images | Weak caption + transcript imports succeed; photos persist |
| 3 | Prompt addenda + post-sort polish | Less junk, better notes; version bump if needed |
| 4 | Server plugin extractors | More blogs complete without Gemini |
| 5 | Docs + dead-code delete | One product mental model |

Every step: `npm run test:corpus` + `npm run build` green before commit.

---

## 13. Risk control ("don't break it")

- **Additive first:** pack path succeeds → return; on failure fall through to existing behavior until corpus proves pack wins.
- **Optional flag:** `VITE_IMPORT_PACK_ONLY=1` for forced pack path in dev; default = pack-then-legacy.
- **No signature changes** for ImportSheet / BrowserAssist / batch / photo.
- **Golden corpus is law** — no step merges red.

---

## 14. Suggested commit sequence

1. `test(import): pack-path fixtures for IG caption+transcript merge`
2. `feat(import): route captionToRecipe through structurePack`
3. `feat(import): merge IG caption+transcript into ContextPack before Gemini`
4. `fix(import): harden IG weak-caption and carousel hero selection`
5. `feat(import): WPRM/Tasty extractors on /api/extract`
6. `chore(import): remove legacy prose/Grok dead paths`

---

## 15. Success criteria

- Paste any Instagram reel/post → title, ingredients, directions, notes, dish photo(s) in review without BrowserAssist in the common case.
- Same URL quality whether source is IG or blog (one brain).
- No junk hashtags/CTAs in fields.
- Offline library still works; only import needs network/Gemini.
- $0 at personal volume.

---

## 16. Key file map

| Path | Role |
|------|------|
| `src/import/contextPack.js` | ContextPack seam + budgets |
| `src/import/structure/gemini.js` | Single Gemini pack structurer |
| `src/import/acquire/instagram.js` | Free IG race → pack |
| `src/import/acquire/website.js` | Client for `/api/extract` |
| `src/import/junk.js` | Zero-junk contract |
| `src/import/images.js` | Carousel + hero vision gate |
| `src/recipeParser.js` | Orchestration (still host) |
| `src/recipeSchema.js` | SYSTEM_INSTRUCTION + RECIPE_SCHEMA |
| `api/extract.js` | Server acquisition |
| `api/structure.js` | Server Gemini passthrough |
| `src/components/ImportSheet.jsx` | Import UX |
| `tests/import/**` | Golden corpus |

---

## 17. Related specs

- `docs/superpowers/specs/2026-07-02-import-engine-unification-design.md` — primary north-star
- `docs/superpowers/specs/2026-07-07-import-prompt-optimization-design.md` — prompt reshape (landed shape)
- `docs/superpowers/specs/2026-06-11-import-engine-critique.md` — UI critique (mostly out of scope this pass)
