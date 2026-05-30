# SpiceHub Import Engine — Deep Audit & Redesign Roadmap

**Date:** 2026-05-29
**Scope:** `recipeParser.js`, `ImportModal.jsx`, `BrowserAssist.jsx`, `api/proxy.js`, `server/*`, `recipeTemplates.js`, `paprika_import_data.js`, import CSS.
**Method:** Four parallel read-only audits (pipeline robustness, Gemini/photo, templating, UI/UX) cross-referenced against the Mealie vs. Paprika comparison doc.
**Deliverable status:** Analysis + roadmap only. No code changed. Conventional-commit suggestions are listed per workstream for you to apply incrementally.

---

## TL;DR — The 8 things that matter most

1. **There is no single import entry point.** `handleUrlImport` (ImportModal) reimplements its own fetch+parse and bypasses the engine for social URLs, while the real engine `importRecipeFromUrl` is only reached from batch import. Two code paths drift apart. **Unify them.**
2. **No real global timeout or global cancel.** The "60s budget" is actually the *cumulative* sum of sequential per-phase timeouts; a failing Instagram import can run ~3 minutes, and the Cancel button doesn't abort the deep fetches. **Thread one AbortController + a hard 45s `Promise.race`.**
3. **Instagram phases run strictly sequentially** (Apify 35s → oEmbed 10s → IG JSON 10s → embed → 75s agent → Gemini). **Run the cheap high-yield phases in parallel (`Promise.any`)** to turn minutes into ~15–20s.
4. **Gemini is never asked for structured output.** Zero uses of `responseSchema`/`responseMimeType`. All JSON is requested in prose and hand-parsed; one stray token silently nukes the import. **Switch to native structured output.**
5. **Three divergent Gemini prompts** (strong client, bare server, weak vision). Photo + server-fallback imports auto-sort far worse because they don't get the good rules. **Consolidate to one shared system instruction + schema.**
6. **Photo import bypasses the good tooling.** The OCR fallback runs a *duplicate, weaker* line classifier and can emit `['See photo for recipe details']`. **Route photos through `captionToRecipe` like everything else.**
7. **The "template" files are misnamed and disconnected.** `recipeTemplates.js` is dead code (output rendering only); `paprika_import_data.js` is one-time seed data. The real controlled vocabularies are hardcoded inline in the parser. **Centralize them into one extraction knowledge base and feed it to Gemini + reuse the seed data as few-shot exemplars.**
8. **The import UI is one infinitely tall column.** A 10-ingredient/8-step recipe is ~1500–2500px inside a ~650px viewport; the social embed pushes the Import button off-screen. **Move to a 3-step wizard with sticky header/footer, collapsible sections, and progressive disclosure.**

---

## 1. How import works today (verified pipeline map)

### Two entry points (the core structural problem)

- **UI:** `ImportModal.handleUrlImport(overrideUrl)` — `ImportModal.jsx:376`. For **social URLs** it skips the engine and hands off to BrowserAssist (`:404-416`). For **non-social URLs** it runs its *own* `fetchHtmlViaProxy + parseHtml` (`:418-435`), then routes to BrowserAssist if the result is weak.
- **Engine:** `importRecipeFromUrl(url, onProgress, {type})` — `recipeParser.js:2563` (aliased `parseFromUrl`). **Only invoked from batch import** (`ImportModal.jsx:553`).

Because the single-URL path and the engine path are separate implementations, bug fixes and improvements land in only one of them.

### Engine strategy order (`recipeParser.js:2563`)
`§0 Reddit JSON → §1 Instagram (→ importFromInstagram) → §2 social/video → §3 blogs (JSON-LD/microdata → WP REST nudging → server extraction → markdown→Gemini) → §4 Gemini raw-text → §5 fail`.

### `importFromInstagram` phases (`recipeParser.js:4419`)
Cache → Phase 0 yt-dlp → **Phase 0.25 Apify (primary)** → Phase 0.5 oEmbed → Phase 0.75 IG JSON `?__a=1` → Phase 1 embed (imginn/picuki fallback) → Phase 2 agent → Phase 3 Gemini `captionToRecipe`. On exhaustion returns `{_needsManualCaption, capturedCaption, capturedImageUrl}`.

### Image capture
`downloadImageAsDataUrl` (`api.js:613`): direct fetch → `/api/proxy?mode=image-data-url` → weserv.nl (IG CDN) → allorigins, validated by magic-byte sniff + 5MB cap. Displayed via `SafeMediaImage` 3-tier fallback.

### Drink-vs-meal routing
`detectImportType` (`recipeParser.js:4796`): host regex + path hints + keyword scan. Per project memory, `itemTypeUserOverride` must be seeded `true` when `initialItemType==='drink'` so URL auto-detect can't reset the type back to meal.

### The built-in browser — answer to "where is it?"
**It's `BrowserAssist.jsx` and it IS wired in (not orphaned).** It renders from `ImportModal.jsx:924` when `browserAssistMode === 'showing'`, and it is the **primary surface for every single-URL social import** (`handleUrlImport` routes there at `:404-416`). It is genuinely Paprika-style: a sanitized in-iframe browser with tap-to-pick parsing (`postMessage` bridge, `BrowserAssist.jsx:182`), "Clear Clutter," a caption expander, manual parse via `captionToRecipe` (`:398`), live pipeline-step UI for Instagram (`:271`), and offline queueing. It is arguably the strongest part of the system and is under-promoted in the UI.

---

## 2. Weak points & robust fixes (robustness workstream)

### Obvious
| # | Weak point | Evidence | Robust fix |
|---|-----------|----------|------------|
| A | Sequential phases, no global cancel | `importFromInstagram` 8+ phases in series; `handleCancelImport` (`ImportModal.jsx:454`) only aborts `abortRef`, not deep timeouts | Thread one `AbortController` UI→engine→every fetch; wire Cancel to it; add hard `Promise.race` 45s cap |
| B | Pervasive silent catches | `recipeParser.js:2644,2679,4433,4555,4571,4644,4691,4774`; `api.js:190,629,643,657,668`; `ImportModal.jsx:401,557` | Return `{ok:false, stage, reason}` from each phase; log to one telemetry sink; never throw across the offline-queue boundary |
| C | Fragile IG regexes | `extractInstagramEmbed` ~15 hand-written regexes (`api.js:282-480`) | Make the JSON path (`?__a=1`/Apify structured) the trusted primary; centralize regexes in one tested module as last resort |
| D | Public-proxy fragility | 7 public proxies, comments admit 403/429 (`api.js:146-154`) | Cut to 2–3 reliable proxies; hard aggregate cap; trust `X-Proxy-Status` only when present |

### Subtle
| # | Weak point | Evidence | Robust fix |
|---|-----------|----------|------------|
| E | Duplicated parse logic | `handleUrlImport` reimplements fetch+parse (`ImportModal.jsx:419-439`) | Always call `importRecipeFromUrl`; let engine return `_needsBrowserAssist` |
| F | "Success" is length-gated | requires `text.length>1000 && !text.includes('"error"')` (`api.js:131,193`) | Drop the brittle `"error"` substring gate; lower floor for known-good content types |
| G | Internal-proxy status leak | missing `X-Proxy-Status` defaults to 200 (`api.js:126`) | Treat missing header as "unknown," not success |
| H | Caption scoring quirk | ranks by `caption.length \|\| rawPageText.length*0.1` (`api.js:454`) | Score by structural signals (has ingredients/steps), not raw length |
| I | Image cascade returns bare `null` | `api.js:613-669` | Return a reason (expired/blocked/network) so retry + SafeMediaImage choose intelligently |
| J | Partial offline-queue captures | caption captured, image not, queued anyway | Enqueue only when caption + persisted data-URL image both present, else flag `_imagePending` for re-fetch on sync |

### Speed
- **Redundant fetches:** same HTML fetched up to 3× (`recipeParser.js:2664,2700,2712`) — always forward `fetchedHtml`.
- **Proxy waterfall:** up to 7 proxies × 15s ≈ 105s worst case (`api.js:159`).
- **75s agent timeouts** (`recipeParser.js:2041,2110`) fire late, after the user already waited.
- **Win:** `Promise.any` over Apify + oEmbed + IG JSON (first good caption wins) + short-circuit on strong result + dedup fetch → common failing-import wall time drops from minutes to a bounded ~15–20s.

**Suggested commits:**
`refactor(import): unify single-URL path onto importRecipeFromUrl` ·
`feat(import): thread AbortController + 45s global race through engine` ·
`perf(instagram): parallelize Apify/oEmbed/IG-JSON with Promise.any` ·
`fix(proxy): drop brittle "error" gate, honor X-Proxy-Status only when present` ·
`feat(import): structured phase results + telemetry, no silent catches`

---

## 3. Gemini prompting for seamless auto-sorting (AI workstream)

### What exists
- **Strong client text prompt** `_buildExtractionPrompt` (`recipeParser.js:480-653`): good ingredient/direction rules (`:567-575`), section handling (`:573`), social-chrome cleaning (`:551-560`), self-audit (`:629-646`). **But not Schema.org compliant** (uses internal field names; constitution requires Schema.org) and **truncates at 8000 chars** (`:651`).
- **Bare server prompt** (`server/index.js:369`): no sorting rules, no self-audit. This is the prod fallback when the client key is missing → sharply worse sorting.
- **Weak vision prompt** (`recipeParser.js:695-735`): only 4 strict rules.
- **No `responseSchema` anywhere** (grep = 0). All JSON is prose-requested + manually fence-stripped + `JSON.parse` in a try/catch that returns `null` on any failure.

### Auto-sorting gaps
No structured-output enforcement; three divergent prompts; sections flattened to parenthetical suffixes (no first-class `section` field); quantities are free-text (no `quantity`/`unit` split → no scaling/dedup); brittle keyword drink classification; no confidence signal in the text path; titles never validated by the post-processor; long content silently truncated.

### Recommended prompt architecture
1. **Native structured output** on every call:
   ```js
   generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: RECIPE_SCHEMA }
   ```
   Eliminates the entire class of `JSON.parse` failures.
2. **One shared `RECIPE_SCHEMA`** that makes sorting *structural*, not prose-dependent:
   - `isRecipe` (bool), `kind` ("meal"|"drink") — model classifies, not pre-guessed in JS
   - `ingredientGroups[]` → `{ section, items[] }`; each item `{ quantity, unit, name, prep }` (first-class sections + split quantities)
   - `directions[]`, timing fields, `cuisine`, `dietaryTags[]`, drink `glass/garnish/method`
   - `confidence` (0–1) + `needsReview` (bool) — drives "please review" UX
3. **One shared `systemInstruction`** (cached, identical across text/server/vision) containing: classify-first rule, the ingredient-vs-direction rule with the verb list, section rule, quantity normalization, cleaning rule, completeness, and the confidence rule. (Full proposed text is in the agent appendix; the key change is the verb-scan re-pass that *moves* misfiled lines.)
4. **Few-shot exemplars** as prior `contents` turns (a messy IG caption with a `For the glaze:` header + spoken amount, and a cocktail caption) — cheaper and more reliable than inflating the system prompt.
5. **Derive the thin SpiceHub shape in JS** from the rich structured output so `buildStructuredFields` and downstream stay unchanged.

**Suggested commits:**
`feat(ai): adopt Gemini responseSchema + shared RECIPE_SCHEMA` ·
`refactor(ai): single shared systemInstruction for text/server/vision` ·
`feat(ai): few-shot exemplars + confidence/needsReview signal`

---

## 4. Photo import — why it's bad and how to fix it (AI workstream)

### Today (`ImportModal.jsx:622-713`)
Gallery + camera `<input>` → data URL → **Path 1** Gemini Vision `structureRecipeFromImage` (weakest of the 3 prompts) → **Path 2** Tesseract OCR fallback that runs a *duplicate, weaker* line classifier `classifyOcrLines` (`:1977-2045`), with guesswork fallthroughs and a worst case of `directions = ['See photo for recipe details']` (`:701`). The OCR text is **never** sent to the strong text structurer, even though messy multi-column OCR text is exactly what that prompt was built for.

### Fix — reuse the existing pipeline
1. **Vision transcribes, doesn't structure.** Change `structureRecipeFromImage` to return a faithful text transcript, then feed it to `captionToRecipe(transcript, {type, imageUrl})` (`recipeParser.js:984`) — which already runs `cleanSocialCaption → structureWithAI (strong prompt) → postProcessGeminiResult (validator) → parseCaption fallback`.
2. **OCR fallback rejoins the pipeline:** replace the `parseCaption`+`classifyOcrLines`+`'See photo…'` block with `captionToRecipe(cleanedText, …)`; **delete** the duplicate `classifyOcrLines`.
3. **Unify on the shared prompt + schema** from §3 (vision just appends the `inlineData` part).
4. **Carry `confidence`/`needsReview`** so low-confidence photo parses pre-flag review.

Net: photo imports get the *same* sorting rules, section handling, quantity splitting, and validator as the best caption imports; one prompt to maintain; dead-code removal.

**Suggested commit:** `feat(photo): route vision transcript + OCR through captionToRecipe; drop duplicate classifier`

---

## 5. Recipe templating — expand into a real knowledge base (data workstream)

### Reality check
- `recipeTemplates.js` (305 lines) is a **Mustache output renderer** for print/export/share — **dead code, zero imports** (its own comment admits it). Holds no vocabularies.
- `paprika_import_data.js` (1036 lines) is **~30 hardcoded example recipes** used once as seed data (`App.jsx:3` → `db.js:510`). Flat string arrays, inconsistent free-text `category` (`""`/`"Dinner"`/`"Pasta"`/`"Tailgate"`), leaked section headers, **no drinks**.
- The **real** controlled vocabularies (`UNITS`, `FOOD_RE`, `SPIRITS`, `COCKTAIL_ACTIONS`, `INGREDIENTS_HEADERS`) are **hardcoded inline** in `recipeParser.js` and not shared with the Gemini prompt or the renderer → definition drift.

### Expansion proposal — `src/recipeSchema.js` (single source of truth)
Centralize and then feed both the parser and the Gemini prompt:
- **`UNIT_CANON`** alias→canonical map (tbsp/tsp/cup/oz/g/ml + drink dash/splash/part) → canonical units everywhere + grocery aggregation.
- **`INGREDIENT_ALIASES`** synonym→{canonical, aisle} (scallion/green onion, chickpea/garbanzo) → dedup + grocery merge + aisle sort.
- **`COURSE` / `DISH_TYPE` / `CUISINE`** controlled enums → add `course`+`dishType` to the schema; finally gives the library reliable filters; migrate the messy seed `category` onto them.
- **`SECTION_HEADERS`** one shared list for the client splitter *and* the prompt rules (kills the two-list drift).
- **`EXEMPLARS`** — repurpose the Paprika seed data into cleaned input→output pairs (add a drink exemplar) and inject 2–3 into the prompt; they double as parser unit-test fixtures (highest-leverage win).
- **`SCHEMA.meal` / `SCHEMA.drink`** exported once, imported by both the renderer and the parser, collapsing the current double-definition of `glass/method/garnish`.

**Suggested commits:**
`feat(schema): add src/recipeSchema.js (units, aliases, taxonomy, sections)` ·
`refactor(parser): consume recipeSchema vocabularies inline-free` ·
`feat(ai): inject few-shot exemplars derived from seed data`

---

## 6. UI/UX — kill the constant scrolling (presentation workstream)

### Why the user scrolls
- The preview is **one long single-column stack** (`.preview-detail-list`, App.css:17280) — title → all ingredients → all steps → drink fields → source → notes, nothing collapsed. ~18 rows × 44px + auto-expanding step textareas = **1500–2500px inside a ~650px viewport**.
- On the input screen the **live social embed is 500–700px tall** (`SocialPreview` `minHeight:180`, no max, `ImportModal.jsx:51`) and sits *above* the Import button → CTA pushed off-screen (the roadmap already flags the cut-off Save button).
- **Two nested scroll containers** fight on mobile (`.preview-scroll-content` + `.preview-detail-list`).
- **No progressive disclosure** — every section renders at full height even on a clean import.

### Ergonomics issues
Up to **6–7 interactive controls per row** (handle + input + hint + move + 2× reorder + remove); remove button only 28×28 (sub-44px); three overlapping reorder mechanisms; no drag-down-to-dismiss (the constitution requires it); header bar overcrowded (title + 2 badges + Auto-Sort + confidence on one row); autofocus throws the keyboard up on review mount.

### Redesign direction (mocked up — see companion file)
A **3-step wizard** in a fixed-height sheet with pinned header + footer, so only the middle scrolls:
- **Step 1 Paste/Source:** segmented tab control; **collapse the social embed** behind a "tap to preview" card; Import button pinned in sticky footer.
- **Step 2 Review:** full-bleed hero image with title overlay (promote the wasted 84px thumb); a single confidence chip; **collapsible accordion sections** (Ingredients · 10 / Steps · 8 / Notes / drink fields) each with a count badge and its own inner `max-height` so a 15-step recipe can't blow out the page; raw caption collapsed by default ("Show original ▾"); on desktop ≥720px an optional **two-pane** (raw caption left, fields right); **rows simplified to `handle | text`** with move/remove behind a swipe or "⋯".
- **Step 3 Save/Route:** the existing smart-bar destinations as one primary CTA + "change destination ▾" instead of a wrapping 4-button row.

### Visual polish
Pick **one accent** (warm orange `#e65100`) + neutral; express Meal/Drink with a subtle tint + icon, not competing cyan/amber. Move inline-styled toggles into tokenized CSS. Softer section labels (12–13px medium neutral + muted count pill, color reserved for state). 8px spacing scale, hairline dividers over heavy borders. Quiet the dashed drop-zones until actually dragging. Single crossfading progress line instead of the utilitarian 4-dot list.

**Suggested commits:**
`feat(import-ui): 3-step wizard shell with sticky header/footer` ·
`feat(import-ui): collapsible review sections + hero image + confidence chip` ·
`feat(import-ui): drag-down-to-dismiss; simplify row controls` ·
`style(import-ui): single-accent system, tokenized toggles, spacing scale`

---

## 7. Competitive verdict vs. Mealie & Paprika

| Capability | Mealie | Paprika | **SpiceHub today** | Verdict |
|---|---|---|---|---|
| Video/spoken recipes | **Excellent** (yt-dlp + Whisper + LLM) | Weak | Partial (yt-dlp Phase 0, no transcription) | **Behind Mealie** — no audio transcription path yet |
| Traditional blogs | Very good | **Excellent** (browser) | Strong (JSON-LD → WP REST → server → markdown→Gemini) | **At parity / ahead** |
| Instagram/social | Good | Manual caption expand | **Strong** (Apify + embed + agent + BrowserAssist tap-to-pick) | **Ahead** when it works; reliability/speed hurt it |
| In-app browser | No | **Yes** (keystone) | **Yes** (BrowserAssist, sanitized iframe + tap-to-pick + clear-clutter) | **At parity, arguably ahead** — but under-promoted |
| AI structuring | Strong | None | Strong prompt, **but no structured output, 3 divergent prompts** | **Mixed** — best-case ahead, fallback paths behind |
| Photo import | n/a | n/a | **Poor** (bypasses good tooling) | **Behind its own potential** |
| Offline | Partial | **Full** | **Full** (Dexie + offline queue + SW) | **At parity with Paprika, ahead of Mealie** |
| Auto-sort polish / preview UX | Weak | Functional | Ambitious (drag-drop, confidence, Auto-Sort) but **scroll-heavy** | **Ahead in ambition, held back by UX** |

**Bottom line:** SpiceHub is **not yet exceeding** these tools consistently — but it is genuinely ahead on offline + in-app browser + social tap-to-pick, and only a handful of fixes (structured output, parallel phases, one shared prompt, photo routing, the wizard UI) separate it from clearly beating both. The single biggest gap vs. Mealie is **no audio/video transcription**; the comparison doc's recommendation to add a lightweight yt-dlp subtitle/Whisper path remains the right next frontier once the above reliability work lands.

---

## 8. Prioritized roadmap

**Phase 1 — Reliability & speed (highest ROI, low risk):** unify entry points; AbortController + 45s race; parallelize cheap IG phases; dedup HTML fetches; trim proxy list; structured phase results. *Turns minutes-long failing imports into bounded ~15–20s and fixes silent failures.*

**Phase 2 — AI quality:** Gemini `responseSchema` + one shared `RECIPE_SCHEMA` + shared `systemInstruction` + confidence signal. *Eliminates JSON-parse failures and lifts server/photo paths to the caption path's quality.*

**Phase 3 — Photo import:** vision-transcribe → `captionToRecipe`; OCR rejoins pipeline; delete duplicate classifier.

**Phase 4 — Templating knowledge base:** `recipeSchema.js` (units/aliases/taxonomy/sections/exemplars/schema); wire into parser + prompt; add `course`/`dishType` filters.

**Phase 5 — UI redesign:** 3-step wizard, collapsible review, hero image, drag-to-dismiss, single-accent polish (see companion mockup).

**Phase 6 — Frontier (optional):** lightweight yt-dlp subtitle + Whisper transcription path to match Mealie on video-only recipes.

---

*Appendix: full per-file citations and verbatim prompt rewrites are available from the four investigation reports backing this document.*
