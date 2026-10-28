# Import Flagship — Next Wave (verified 2026-10-27)

> **For agentic workers:** Use superpowers:executing-plans. Checkbox steps. Ponytail full; the Protected Rungs in `CLAUDE.md` win. Every task ends with `npm run test:corpus` green, a build, a Conventional Commit command with explicit paths, and a PowerShell test plan for Brian.

**Inputs reviewed:** (1) the "Import (flagship) / Best path forward" brief pasted 2026-10-27, (2) the OCR/multi-page attachment from the same day, (3) the plan of record `2026-09-04-import-engine-overhaul.md`.

**Bottom line:** The plan of record is ~85% shipped but its checkboxes were never ticked, so it reads as unstarted. Both pasted briefs describe a codebase from roughly August. Most of what they ask for already exists. The highest-value work is one they did not find: a long-standing **double-encoded (mojibake) regex bug** in the heuristic parser.

> **Status 2026-10-28:** Tasks 1 and 2 shipped (uncommitted). Found while doing them:
> - `saut[eé]\b` never matched even before the corruption (`é` is not `\w`); fixed with a separate `sauté` alternative.
> - The emoji classes needed the `u` flag. Restored as surrogate pairs without it, they would strip every emoji-led line.
> - The September bait-cache guard was a no-op: `schemaQualityGate` returns `{ pass }`, not `verdict`. All five writes now use `cacheIfNotEmpty`.
> - The offline photo-upgrade queue passed no `kindLocked`. Fixed. Still open: it only looks the recipe up in `db.meals`, so drink drafts never upgrade.
> - Batch rows now go through `gateRecipe` and use the heuristic score instead of a hard-coded 0.5.
> - `eslint.config.js`'s dynamic-import selector contained `/`, which esquery can't parse, so ESLint crashed on every file. Fixed.
> - Drink units were already in `UNITS_RE`; 2b needed no change.

---

## Part A — Plan of record: actual status

Verified against code on 2026-10-27 (HEAD `27c45302`). Most landed in `c5b3258f` (2026-09-06).

| Task | Status | Evidence |
|---|---|---|
| 0 Backup | Done | `_import_backup_2026-09-04/` |
| 1 Barrel seam | Done, 5 review fixes open | Only `BrowserAssist.jsx`, `db.js`, `photoImportEngine.js` import `recipeParser` directly (all sanctioned). The `await import()` bypass, wrong override comments and the missing barrel test are still open. |
| 2 Drink-lock holes | Done | `kindLocked` threads through `photoImportEngine.js:633`, `ReExtractSheet.jsx:179/188`, `batchImportEngine.js:29-32` |
| 3 One Whisper pass | Done | `src/import/acquire/videoAudio.js` |
| 4 Pack survives | Done | `contextPack.js`, `acquire/*`, `structure/gemini.js` |
| 5 One request object | Done | `ImportSheet.jsx:614` uses `importRequest`; `detectSource.js` |
| 6 Forks return packs | **Partial** | `photoImportEngine.js:710` still calls `captionToRecipe` (the `acquireOnly` path exists, but the legacy structure call is still there) |
| 7 Gate owns UI state | **Partial** | `gate.js` (`pass/salvage/empty`, drink-aware, bait-aware). Miss retry uses the edited text (`ImportSheet.jsx:1090,1260`). **Still open:** the video/yt-dlp paths cache without the gate (`recipeParser.js:5145, 5155, 5165`) |
| 8 Cache/dedupe key | Done | `db.js:1659` `url::kind::ENGINE_PROMPT_VERSION`; `importGuards.js:184-185` |
| 9 Shrink parser | **Partial** | Server trio deleted; no `_DEAD_*`; no `setPhase`. `recipeParser.js` is still 5,359 lines (target signal ~2,000). `isCaptionWeak` still lacks `oz/dash/jigger` |
| 10 Working surface | Done | `ImportTimeline` mounted at `ImportSheet.jsx:1019` |
| 11 Humanizer leaks | Done | `ImportSheet.jsx:580-625` |
| 12 Kind decides shelf | Done | Destination grid gone; save label is derived at `ImportSheet.jsx:1282` |
| 13 Miss diagnosis | **Partial** | Fallback, `bait-caption` diagnosis and "Give up on this one" shipped. The gate only emits 5 reasons, so no-caption, too-dark and offline-queued can't be diagnosed yet |

- [ ] **Housekeeping:** tick the shipped boxes in `2026-09-04-import-engine-overhaul.md` so the next agent doesn't re-plan them (CLAUDE.md: "check its task status before starting").

---

## Part B — Accuracy of the pasted briefs

### Brief 1: "Import (flagship)"

| Claim | Verdict |
|---|---|
| Collapse-and-reveal, URL/paste/multi-page photo, transcription fallback, drafts, offline banner, self-heal stamps (`sourceCaption`, `engineVersion`, `needsReview`) | **Accurate** |
| Review has Reorder, cross-list drag, misplaced heuristic, per-field confidence, alias learning | **Accurate** (`ImportReview.jsx:448-480, 648-660, 742-760`) |
| Review routes to "Library / Week / Grocery / Bar" | **Outdated.** Week and Grocery were deliberately removed (Task 12). Kind alone decides Meal vs Bar Library. Do not re-add them |
| 1a. Comments + transcript as first-class inputs | **Already done.** `instagramFollowers.js` (comments) and `videoAudio.js` (Whisper) feed the ContextPack |
| 1a. **Carousel text** as an input | **Real gap.** `api/proxy.js:546` only takes `childPosts` image URLs; text printed on slides is never read. → Task 3 |
| 1b. OCR-confidence badge | **Real gap, cheap.** Tesseract returns `data.confidence`, but `photoImportEngine.js:529` throws it away. → Task 4 |
| 1b. One-tap "Re-extract offline" from the stored caption | **Conflicts with design.** Improve (`ReExtractSheet.jsx:171`) needs a network connection because structuring is Gemini. Running the heuristic offline would produce a worse result than the stored one. → Task 4 queues it instead |
| 1c. Promote misplaced-ingredient heuristic earlier | **Already early.** `enforceDeterministicRules` runs after every structure call and records `_postProcessAudit`. Review's `flaggedSteps` is a second net, not the first |
| 1c. Auto-group ingredients by course/prep | **Partly exists** (`SECTION_HEADERS`, `recipeSchema.js:499`). Not scheduled; see Deferred |
| 1d. Keep the confidence blend | **Accurate** (`ReExtractSheet.jsx:34-44`, 0.6 model + 0.4 heuristic) |
| 2a. Offline queue explicit about what syncs later | **Mostly done** (`ImportSheet.jsx:663-668, 945-950`). Copy check only |
| 2b. Extraction audit trail | **Half done.** Review shows a correction count (`ImportReview.jsx:806-809`) but not *which* lines moved. → Task 5 |
| 2c. Every path goes through `normalizeRecipeForReview` + confidence | **True for the engine path.** The confidence blend is called only in `ImportSheet`; the batch path should be checked in Task 2 |
| 3a. `--text-muted` contrast | **Done 2026-07-20** (`#6d6d6d` light ≈ 5.3:1). Pixel-UI text (chalkboard, posters, catalog) has **not** been audited. → Task 7 |
| 3b. iOS scrim + honest update prompt | **Done 2026-07-16** (`pwaUpdateSignal.js`). The icon PNG is still pending from Brian |
| 3c. IG image fallback hardening | **Done** (persistImage on Render, CDN 403 fix 2026-06-19) |
| 3d. "48px targets" | **Mis-stated.** design.md requires 44px minimum and 48px for primary actions. Use design.md |

### Brief 2: OCR / multi-page attachment

| Claim | Verdict |
|---|---|
| "Gap is almost certainly capture side (single-shot camera)" | **False.** `PhotoScanSession.jsx` has a reorderable thumbnail strip with add and remove, `pdfPages.js` renders PDFs, and `PageAligner.jsx` does crop and perspective-flatten. Its integration step 1 is already shipped |
| Preprocessing (contrast/deskew/crop) | **Already shipped** (`PageAligner` warp + auto-levels; `photoImportEngine.js:296` contrast) |
| **litert-ocr** "excellent offline upgrade, tesseract.js-compatible" | **Real but immature.** v0.1.0, Apache-2.0, 1 GitHub star, tests dated Oct 19–21 2026. About 87 MB on first use (vs Tesseract's small self-hosted bundle). Threads need COEP `require-corp`, which this app doesn't send (`vercel.json:23` COOP only) and can't easily add without breaking cross-origin images, so it would run single-threaded, "several times slower." It does return confidence. → Task 6 spike only |
| **@ryancasas/indra-ocr-wasm** | **Unverified.** No such package found. Indra OCR (Datalab) is a Python/ONNX CLI with a modified OpenRAIL-M weights licence. Drop it |
| PaddleOCR via ONNX Runtime Web | **Real** (`@paddleocr/paddleocr-js`). Has the same COEP caveat for threads/WebGPU. Second candidate in the Task 6 spike |
| "Mistral OCR 4 … you already have a Mistral key" | **Key: true** (`api/vision.js:56`). But tier 2 calls `pixtral-12b-latest` via chat/completions (`photoImportEngine.js:70`), not the OCR endpoint. OCR 4 exists, is billed per page, and 4.1 adds block confidence. → Task 6 (live-verify the model first; the Gemini-death rule applies) |
| Specialized Apify reel/recipe actors | **Exist** (many third-party transcript actors), but they're paid per run and from small authors. They duplicate free in-browser Whisper. **Not recommended** (zero-cost rule) |
| Video frame sampling for on-screen text | **Valid gap**, but it needs server-side ffmpeg on Render. Deferred |

---

## Part C — Implementation plan (priority order)

### Task 1 (P0): Repair the double-encoded regex classes — extraction quality

**Why first:** this silently degrades the offline/heuristic parser that the Protected Rungs say must not regress, and it has been in HEAD since at least 2026-08-07. Several character classes were saved through a Windows-1252 round-trip **twice** (`•` became `Ã¢â‚¬Â¢`). The 2026-08-24 fix (`8cf73082`) repaired one emoji class and missed these. I ran the live regexes against inputs:

| Input | `BULLET_RE` | `FRACTION_RE` | Should be |
|---|---|---|---|
| `• 2 cups flour` | false | false | bullet |
| `⅓ cup oil` / `⅔ tsp` | false | false | fraction |
| `½ cup milk` | **true** | true | not a bullet |

`½ ¼ ¾ °` only match by luck (their last byte survives). Worse, `BULLET_RE` now treats `½` as a bullet, so the strip at `recipeParser.js:2072` can delete a leading `½` from a direction line. Also broken: en/em dashes in title/timestamp separators, `sauté` in both `COOKING_VERBS_RE`, `·`/`…` in caption cleaners, and every emoji in the caption-header class at `socialCaption.js:29`.

**Files:** `src/recipeParser.js` (lines 267-279, 313, 1279, 1594-1626, 1715, 2072, 2103, plus log strings), `src/import/clean/socialCaption.js` (lines 7, 29, 41-78, 101), new `tests/import/corpus.encoding.test.js`.

- [ ] **Step 1: Inventory.** Run `grep -rn "Ã\|Â" src api server --include=*.js --include=*.jsx`. Separate code (regex/string) from comments. Expect `recipeParser.js` and `socialCaption.js`; confirm nothing else.
- [ ] **Step 2: Failing test** in `corpus.encoding.test.js`:
  - `• 2 cups flour`, `▪ salt` and `– 1 egg` are classified as ingredients.
  - `⅓ cup oil` matches `FRACTION_RE`.
  - `Sauté the onions` is a direction.
  - `½ cup milk` keeps its `½` after the bullet strip.
  - `180°C` makes `isCaptionWeak` false.
  - A title `Pasta — Bon Appétit` splits on the em dash.
  - **Guard:** no file under `src/` contains `/Ã[\u0080-¿‘-›]|Â[ -¿]/`. This locks the third recurrence out.
- [ ] **Step 3: Rewrite each class with `\u` escapes**, never literal glyphs, so a future codepage round-trip can't corrupt them. Example: `BULLET_RE = /^[-•*▪▸►◦‣⁃✓✔…]/u`. Recover the intended glyphs by reversing the mojibake twice: `s.encode('cp1252').decode('utf8')`, applied two times, in a scratch script. Diff the recovered set against the August-repaired emoji class.
- [ ] **Step 4: Line endings.** Check each file's EOL right before editing and preserve it. Edit with a Python read-modify-write, not by re-typing.
- [ ] **Step 5:** `npm run test:corpus` green; full `npm test` shows only the known reds (profile ×10, v28 ×1); build.
- [ ] **Step 6: Bump `ENGINE_PROMPT_VERSION`** (`recipeSchema.js`) so cached imports with the old cleaner don't keep being served and the Improve badge offers a re-run.
- [ ] **Commit:** `fix(import): repair double-encoded regex classes in caption cleaners and heuristic parser`

### Task 2 (P1): Close the plan-of-record leftovers

- [ ] **2a Gate the video cache writes.** Run `gateRecipe(finalRecipe, { kind: type, caption })` before the three unconditional `setCachedImport` calls at `recipeParser.js:5145, 5155, 5165`, using the same `verdict !== 'empty'` guard as `:4850`. Test: a yt-dlp result with one ingredient is not cached.
- [ ] **2b Drink units in `isCaptionWeak`** (`socialCaption.js:93+`): add `oz|dash(?:es)?|jigger|barspoon|part`. Test: `2 oz gin, 4 oz tonic, lime` is not weak.
- [ ] **2c Photo fork.** Grep callers of `importRecipeFromPages` without `acquireOnly`. If only `AddEditMeal`/batch use the structuring path, leave it alone (it is the offline heuristic fallback, `:700`). Otherwise point them at the engine. Do not delete the offline fallback.
- [ ] **2d Batch confidence.** Confirm `batchImportEngine.js` results go through `normalizeRecipeForReview` and get a blended confidence. If not, route them through `engine.importRequest`.
- [ ] **2e Task-1 lint fixes 1–5** from the 2026-09-04 review (comment truths, `no-restricted-syntax` for `ImportExpression`, one barrel-surface test, `@/import` doc, "Step 3" reference).
- [ ] **Commit:** `fix(import): gate video-path cache writes, recognise drink units in weak-caption check`

### Task 3 (P1): Read carousel slide text — the real social gap

**Why:** many recipe carousels put the ingredients on the slides and leave a two-line caption. Today those posts go to the comment and blog followers, then audio, and then reach Miss.

**Flow (no new deps, no new endpoint):** the IG acquire leg already returns `childPosts` image URLs (`api/proxy.js:546`), and `contextPack` already tags them `kind: 'carousel'`. When the gate would return `empty` or `isCaptionWeak(caption)` is true, **and** the pack has carousel images:
1. Fetch up to 6 slides through the existing image persistence path (IG CDN URLs expire and return 403 without it).
2. Run them through `importRecipeFromPages(slides, { acquireOnly: true, kind, kindLocked })`, which is the same Gemini → Mistral vision tiers as photo import.
3. Add the transcript to the pack as `pack.slidesText`. `structure/gemini.js` gets one new labelled section.
4. Set provenance chip "from the slides" via `chipLabel()` (not `CHIP_RULES`, which the progress test asserts).

- [ ] **Step 1: Failing corpus test** `corpus.carouselSlides.test.js`: a fixture pack with a weak caption plus a mocked vision transcript results in ≥4 ingredients and `_extractionSource: 'carousel'`. A strong caption must **not** trigger the slide pass (cost guard).
- [ ] **Step 2:** Add an `acquire/instagramSlides.js` helper (≤80 lines). Wire it into `engine.js` between the comment follower and audio. engine.js is already at 412 lines, so move an existing helper out to stay ≤400.
- [ ] **Step 3:** Status ladder line in `importCopy.js`: "Reading the slides…".
- [ ] **Step 4:** Online only. URLs are already offline-blocked at `ImportSheet.jsx:666`.
- [ ] **Step 5:** Corpus + build. Manual smoke: one text-on-slides carousel, and one normal captioned post (make sure no extra vision call shows in the network tab).
- [ ] **Commit:** `feat(import): read recipe text from Instagram carousel slides when the caption is thin`

### Task 4 (P2): Honest photo-quality signal

- [ ] **4a** In `transcribeWithTesseract` (`photoImportEngine.js:529`) keep `result.data.confidence` per page. For the cloud tiers, if the Gemini/Mistral contract has no confidence, leave it null. Don't invent one.
- [ ] **4b** Stamp `recipe._ocrConfidence = { min, perPage }`. In `ImportReview`, when `min < 60`, show the chip "Page N was hard to read" with a **Retake page N** action that reopens `PhotoScanSession` at that index. Use design.md tokens, a 44px target and an `aria-label`.
- [ ] **4c** Instead of "re-extract offline": when Improve is pressed offline (`ReExtractSheet.jsx:171`), offer **"Improve when I'm back online"**. This enqueues into the existing offline photo-upgrade queue pattern (`ImportSheet.jsx:745`) rather than a dead-end screen.
- [ ] **4d** Fold the low-OCR state into the gate as reason `photo-unreadable`. That unblocks the "too dark to read" Miss diagnosis from 09-04 Task 13 step 5.
- [ ] **Commit:** `feat(import): surface per-page OCR confidence and queue offline Improve`

### Task 5 (P2): Show what the cleaner changed

- [ ] Make the existing correction-count chip (`ImportReview.jsx:806-809`) a disclosure that lists `_postProcessAudit.moved` / `.filtered` lines (`recipeParser.js:725-726`), each with **Undo** (puts the line back where it came from). Use plain language: "Moved 2 lines from steps to ingredients." No new state store; it reads the audit already on the recipe.
- [ ] Test: Undo restores the exact line at its original index.
- [ ] **Commit:** `feat(review): list and undo deterministic cleanup moves`

### Task 6 (P3): OCR tier spike — measure, don't adopt

**Gate for adoption:** beats Tesseract by ≥15 points of ingredient-line recall on a photo set that does not exist yet: create `tests/import/fixtures/photos/` with ~10 real phone photos from Brian (cookbook page, screenshot, handwritten card, low light) and hand-written expected ingredient lines, and Brian approves the first-use download size.

- [ ] **6a** Scratch branch-free spike in `scripts/ocr-bench.mjs` (Node: litert-ocr supports Node 24). Run Tesseract vs litert-ocr vs `@paddleocr/paddleocr-js` on the same pages. Record recall, time and model bytes. Nothing goes into `package.json` until the gate passes.
- [ ] **6b** If it wins: lazy, opt-in only ("Download sharper offline reading — ~90 MB"), cached via the Cache API. Tesseract stays as the floor; the tier order becomes Gemini → Mistral → litert → Tesseract. Note `ponytail:` single-threaded without COEP.
- [ ] **6c Mistral tier health:** live-verify `pixtral-12b-latest` is still served (`GET /v1/models` server-side). Separately, price out `mistral-ocr` per page against the zero-cost rule before proposing it as tier 2.

### Task 7 (P3): Targeted polish

- [ ] **7a** Contrast audit on pixel-UI text only: BarShelf chalkboard, bounty posters, pantry catalog tiles. Measure computed colours in both themes and fix with design.md tokens.
- [ ] **7b** Touch-target and label sweep on BarShelf, Grocery swipe rows and ImportReview tabs to the design.md spec (44 min / 48 primary). The `.review-tab` row is already 46px; leave it.
- [ ] **7c** Offline-banner copy check: URL imports say they need a connection; photo/paste say "works offline, sharpens when you reconnect."

---

## Deferred / not recommended

- **Ingredient auto-grouping by course/prep.** `SECTION_HEADERS` already drives grouping when the source has headers. Inventing groups for ungrouped lists risks wrong structure. Revisit only with corpus evidence.
- **Specialized Apify transcript actors.** Paid and third-party; Whisper is free and already in place.
- **Video keyframe OCR.** Needs ffmpeg on Render plus vision cost per reel. Do it after Task 3 shows how much on-screen text is worth.
- **Indra OCR.** Python only; no browser build.

## Definition of done (this wave)

1. `corpus.encoding.test.js` green, including the no-mojibake guard; `ENGINE_PROMPT_VERSION` bumped.
2. No `setCachedImport` call reachable without a non-`empty` gate verdict.
3. A text-on-slides carousel reaches Review; a well-captioned post makes zero extra vision calls.
4. A blurry photo page is named in Review with a retake path; offline Improve queues instead of dead-ending.
5. Plan of record checkboxes reflect reality.
