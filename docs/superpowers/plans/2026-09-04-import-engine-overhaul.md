# Import Engine Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project constitution (AGENTS.md):** never execute git commands. Every task ends with a Conventional Commit *message* for Brian to run. `git add`/`git commit` lines in this plan are text to hand over, not commands for the worker to execute.

**Goal:** Collapse SpiceHub's four overlapping import spines into one thin `src/import/engine.js` (detect → acquire fork → ContextPack → structure → gate → Review | Salvage | Miss), with `kindLocked` intact on every path, one Whisper pass, and a gate that refuses to cache or review bait.

**Architecture:** Strangler-fig, not rewrite. `src/import/index.js` — the compat barrel a previous refactor already built and no caller ever adopted — becomes the enforced seam first. Only then does the spine move behind it. Acquire forks return a ContextPack and nothing else: they never structure, never gate, never set a UI phase. A social fork may call the blog fork nested, but still returns exactly one pack.

**Tech Stack:** Vite 7 / React 19 / Dexie / framer-motion; Vitest for the `tests/import` corpus; Gemini Flash-Lite via `/api/structure` with Flash escalation; Vercel serverless (`api/`) + an Express server (`server/`) for local dev.

**Verification environment:** `npm run build`, `npm run lint`, and `npm run test:corpus` all run in the Cowork Linux VM using the `NODE_PATH` / `ESBUILD_BINARY_PATH` overrides recorded in project memory (`feedback_vitest_runs_in_linux_vm_2026_09_03.md`). The exact invocations are repeated in Task 0, Step 6 — do not re-derive them.

---

## 0. Where the repo contradicts the brief

The brief says the repo wins. It does, in eight places. Each of these changes the work, and four of them delete work the brief asks for.

**0.1 — The facade already exists and is imported by nobody.**
`src/import/index.js` (80 lines) re-exports `importRecipeFromUrl`, `parseFromUrl`, `importFromInstagram`, `captionToRecipe`, `structurePack`, `createContextPack`, the junk contract, and the acquire modules. Its header comment says "New code should import from HERE, not from recipeParser.js directly." A repo-wide grep for `from '@/import'`, `from '../import'`, `from './import'` returns **zero matches outside its own docblock**. `ImportSheet.jsx:8-13` still imports `recipeParser.js` directly.

*Consequence:* the brief's "Slice 1 is a zero-behavior-change facade" is already built. Writing `engine.js` as a second unused facade is the single most likely way this overhaul stalls. **Slice 1 in this plan is adoption and enforcement of the existing barrel, not creation of a new one.** `engine.js` appears in Slice 4, when there is real spine logic to put in it.

**0.2 — The acquire modules are already on the live path; the pack is destroyed on arrival.**
`acquireInstagramPack` is called at `recipeParser.js:5059`, `acquireWebsitePack` at `:3094`, `acquirePinterestPack` at `:3039`. The brief's premise ("forks acquire, then the parser does it again") is wrong. What actually happens at `recipeParser.js:5059-5077` is that the returned pack is immediately shredded into thirteen loose locals — `capturedCaption`, `capturedRawCaption`, `capturedImages`, `capturedImageUrl`, `capturedComments`, `capturedOwnerUsername`, `capturedProfileBioUrl`, `capturedIsVideo`, `capturedSource`, `capturedAuthor`, `capturedTitle`, `capturedRawPageText`, `captured` — and ~400 lines later a *new* pack is rebuilt from those locals. The website path does the same in one line: `:3097-3106` spreads `serverPack.candidate` and returns, pack gone.

*Consequence:* the work is not "move acquire out." It is "stop un-packing what acquire already returned." That is Slice 4 and it is the hardest slice in this plan.

**0.3 — The cache key is already kind-aware.**
`db.js:1652` — `cacheKey(url, type) => \`${url}::${type || 'meal'}\`` — with a comment explaining that a URL imported as a drink must never collide with the same URL imported as a meal. Only `ENGINE_PROMPT_VERSION` is missing from the key. The **dedupe** key *is* URL-only (`importGuards.js:184-196`, `normalizeImportUrl` reduces to host+path). The brief conflates the two. Slice 8 fixes the prompt-version gap and the dedupe key, not a "meal-shaped cache row."

**0.4 — Double ASR is already guarded.**
`recipeParser.js:5400` sets `_asrAttempted`; `ImportSheet.jsx:605` reads it and skips the second pass. The brief's "one Whisper pass" is largely already true. The residual hole is narrower and unnamed in the brief: `isVideoPostForAsr` at `recipeParser.js:5356` is `wouldExitEmpty && /\/(reel|tv)\//i.test(url)` and lives *inside* `importFromInstagram`. A TikTok or YouTube Shorts URL never reaches it, so the flag is never set for those hosts. Slice 3 fixes the host coverage; there is no double-ASR bug to fix on Instagram.

**0.5 — Photos already share the one brain.**
`photoImportEngine.js:693` calls `captionToRecipe`, which at `recipeParser.js:1261-1281` already routes through `packFromCaption → structurePack(pack, { type, kindLocked })`. There is no second prompt stack for photos. The photo defect is exactly one missing argument at `:693`. That is a one-line fix in Slice 2, not a slice of its own.

**0.6 — `server/coordinator.js` is dead, not a fourth fork.**
`runWaterfall` is referenced only by `server/importRoutes.js`, and `server/index.js` never mounts `importRoutes` — the mounted routes are `/api/resolve-url`, `/api/extract-video`, `/api/extract-url`, `/api/extract-instagram-agent`, `/api/structure-recipe`, `/api/transcribe`, `/api/tmp-audio/:filename`. `coordinator.js`, `jobStore.js`, and `importRoutes.js` are unreachable from any client. They are **retire**, not **delegate**. Their tests (`server/__tests__/coordinator.test.js`, `server/__tests__/jobStore.test.js`) still pass and must keep passing until the files are deleted, so Slice 9 deletes code and tests together or leaves both alone.

**0.7 — Discover is already on the sheet path.**
`App.jsx:716-721` `handleQuickImport` sets `showImportFor('any')` and `sharedContent` and opens `ImportSheet`. It does not do a private URL parse. It is **leave**, and it is the reason `showImportFor === 'any'` must keep meaning "not kind-locked."

**0.8 — Path and naming corrections.**
`importGuards.js` and `importConfig.js` are in `src/lib/`, not `src/`. `progress.js` is not new — `src/import/progressMap.js` (105 lines) exists and is pinned by `tests/import/corpus.progress.test.js` with the three-stage vocabulary `Fetching → Understanding → Polishing`. `detect.js` collides conceptually with the already-exported `detectImportType` (`recipeParser.js:5610`), which detects **kind** (meal|drink), not **source** — and `batchImportEngine.js:12` imports it. This plan names the new one `detectSource` and leaves `detectImportType` alone.

**Progress vocabulary is explicitly out of scope.** The brief implies renaming stages to `acquiring | structuring | done`. `progressMap.js`, `ImportTimeline.jsx`, and `corpus.progress.test.js` are a coherent, tested three-stage system. Renaming user-visible stages is product work smuggled into a structural move — precisely what the source analysis's own "do not touch" section warns against. Slice 5 keeps the existing vocabulary and only guarantees every fork emits into it.

---

## 1. Live caller inventory — facade / retire / leave

Verified by grep on 2026-09-04. Every row must be resolved before Slice 4 begins; a single row left on `recipeParser.js` re-splits the spine.

| # | Caller | Site | Calls today | Disposition |
|---|---|---|---|---|
| 1 | `ImportSheet.executeUrlImport` | `ImportSheet.jsx:556` | `importRecipeFromUrl` | **facade** |
| 2 | `ImportSheet.executePasteImport` | `ImportSheet.jsx:721` | `captionToRecipe` | **facade** |
| 3 | `ImportSheet.executePhotoImport` | `ImportSheet.jsx:797` | `importRecipeFromPages` | **facade** |
| 4 | `ImportSheet.executeTranscribeImport` | `ImportSheet.jsx:880` | `transcribeVideoForRecipe` | **facade** |
| 5 | `AddEditMeal.handleImportUrl` | `AddEditMeal.jsx:191` | `parseFromUrl(url)` — no opts at all | **facade + drink-lock fix** |
| 6 | `AddEditMeal.handleOcrImport` | `AddEditMeal.jsx:229` | `importRecipeFromPages` with `type` | **facade + drink-lock fix** |
| 7 | `ReExtractSheet` caption path | `ReExtractSheet.jsx:182` | `captionToRecipe`, no `kindLocked` | **facade + drink-lock fix** |
| 8 | `ReExtractSheet` audio path | `ReExtractSheet.jsx:177` | `transcribeVideoForRecipe`, no `kindLocked` | **facade + drink-lock fix** |
| 9 | `photoImportEngine` structure line | `photoImportEngine.js:693` | `captionToRecipe(input, { type })` | **drink-lock fix, then line removed in Slice 6** |
| 10 | `batchImportEngine.processOne` | `batchImportEngine.js:29` | `importRecipeFromUrl`, no `kindLocked` | **facade + drink-lock fix** |
| 11 | `db.js` background improve | `db.js:1373-1375` | dynamic `import('./lib/photoImportEngine.js')` | **facade** — not in the brief's list; found by grep |
| 12 | `BrowserAssist` | `BrowserAssist.jsx:285, 317, 422, 882` | `importFromInstagram`, `captionToRecipe` ×3 | **leave, unmounted** — do not edit, do not revive |
| 13 | Discover → `handleQuickImport` | `App.jsx:716` | opens `ImportSheet` | **leave** (see §0.7) |
| 14 | Zip export | `InstagramZipImport.jsx` → `addBatchQueueItems` → `batchImportEngine` | via row 10 | **leave** (UI only) |
| 15 | `coordinator.runWaterfall` | `server/coordinator.js:29` | unmounted | **retire** (see §0.6) |
| 16 | `src/import/index.js` barrel | — | re-exports, 0 importers | **becomes the seam in Slice 1** |

`parseFromUrl` is an alias of `importRecipeFromUrl` (`recipeParser.js:2914-2916`). `recipeParser.js:2993` self-recurses through `parseFromUrl` for Reddit link-posts — see hole D below.

---

## 2. Drink-lock holes

Five, all verified. Slice 2 closes A–E in one commit, ahead of any structural work, because each is a one-argument fix that ships user-visible correctness immediately.

| ID | Site | Defect | Symptom |
|---|---|---|---|
| **A** | `photoImportEngine.js:693` | `captionToRecipe(captionInput, { type })` — no `kindLocked`, no `sourceUrl` | Bar-opened camera import returns a meal |
| **B** | `ReExtractSheet.jsx:177, 182` | `type: itemType` passed, `kindLocked` absent on both audio and caption paths | Improve on a Bar card rewrites it as a meal |
| **C** | `AddEditMeal.jsx:191` | `parseFromUrl(importUrl.trim())` — no options object at all, so `type` defaults `'meal'` and `kindLocked` `false` | The brief and the source analysis both wave this off as "fine if that form stays meals-only." **It is not meals-only** — `AddEditMeal.jsx:229` passes `type: isMealMode ? 'meal' : 'drink'`. Drink URL imports from this form are already silently typed `meal` |
| **D** | `recipeParser.js:2993` | Reddit external-link recursion calls `parseFromUrl(redditData.externalUrl, onProgress)` — drops `type`, `kindLocked`, `signal`, *and* `requestBudget` | A Reddit link-post to a cocktail blog, imported from Bar, returns a meal on an unabortable, unbudgeted request |
| **E** | `batchImportEngine.js:29` | Passes `type: detectedType` but no `kindLocked`, and ignores `item.itemTypeUserOverride` at import time — the override is only applied *after* structuring, at `:36-38` | A zip-queue row the user explicitly marked as a drink is structured with meal-shaped prompting, then relabelled |

`showImportFor === 'any'` (`App.jsx:718`) must continue to mean *not* kind-locked. Detect may guess drink; an explicit user chip still wins. Do not "fix" this into a lock.

---

## 3. Files: move vs stay

### Create

| Path | Responsibility | Slice |
|---|---|---|
| `src/import/detectSource.js` | `detectSource(request) → 'social' \| 'blog' \| 'photo' \| 'text' \| 'reddit' \| 'pinterest'`. Pure, no network. Named `detectSource` to avoid colliding with the exported kind-detector `detectImportType` | 3 |
| `src/import/engine.js` | The spine. `importRequest(request)` and `restructure(pack, opts)`. Hard cap 400 lines | 4 |
| `src/import/gate.js` | `gateRecipe(recipe, pack) → { verdict: 'pass' \| 'salvage' \| 'empty', reasons[] }`. Drink-aware | 7 |
| `src/import/acquire/reddit.js` | Wraps `src/scrapers/redditDiscovery.js`; returns a pack, may nest into `acquire/blog` | 6 |
| `src/import/acquire/blog.js` | Thin wrapper over `blogLinkFollower` + `acquireWebsitePack`; returns a pack | 6 |
| `src/import/acquire/photo.js` | Wraps `photoImportEngine` OCR/vision; returns `onScreenText` + `images` + `scanPages`. **Must keep `scanPages` on the pack** or ImportReview loses its recrop affordance | 6 |
| `src/import/acquire/videoAudio.js` | One Whisper pass, host-agnostic; no-ops if the pack has a transcript or `_asrAttempted` | 3 |
| `tests/import/corpus.gate.test.js` | Drink-aware gate cases | 7 |
| `tests/import/corpus.detectSource.test.js` | Source-detect cases | 3 |
| `tests/import/corpus.kindlock.test.js` | One assertion per hole A–E | 2 |

### Move

| From | To | Slice |
|---|---|---|
| `schemaQualityGate` in `src/lib/importGuards.js:127-172` | `src/import/gate.js` (re-export shim left behind until Slice 9) | 7 |
| `cleanSocialCaption`, `isCaptionWeak` in `recipeParser.js` | `src/import/clean/socialCaption.js` | 8 |

### Stay — do not touch

`src/import/contextPack.js`, `src/import/images.js`, `src/import/junk.js`, `src/import/structure/gemini.js`, `src/import/progressMap.js`, `src/components/import/ImportTimeline.jsx`, `src/lib/importConfig.js`, `src/lib/recipeHtmlExtraction.js`, `src/recipeSchema.js` prompt text, `api/structure.js`, `api/extract.js`, `api/proxy.js`, `db.js` schema (except the cache-key string in Slice 8), `BarShelf.jsx`, pantry/grocery matching, `WeekView`, `DocumentScanner.jsx`, `PageAligner.jsx`, `BrowserAssist.jsx`.

### Shrink last

`src/recipeParser.js` (5,764 lines) → compat facade + leftover line parsers. `src/components/ImportSheet.jsx` (1,490 lines) → three surfaces, one submit handler.

---

## Task 0: Backup gate — MANDATORY, blocks every later slice

No slice below may begin until this task is complete and verified. Backup is by file copy, not `git stash` / `git reset`, so the working tree stays untouched and diffs stay possible while the refactor is in flight.

**Files:**
- Create: `_import_backup_2026-09-04/` at repo root

- [ ] **Step 1: Create the dated backup folder and copy the import surface**

Run from the repo root:

```bash
BK=_import_backup_2026-09-04
mkdir -p "$BK"/{src/components,src/components/import,src/lib,src/import,src/scrapers,server,tests}
cp src/recipeParser.js                  "$BK"/src/
cp src/recipeSchema.js                  "$BK"/src/
cp src/batchImportEngine.js             "$BK"/src/
cp src/db.js                            "$BK"/src/
cp src/App.jsx                          "$BK"/src/
cp src/components/ImportSheet.jsx       "$BK"/src/components/
cp src/components/ImportInput.jsx       "$BK"/src/components/
cp src/components/ImportReview.jsx      "$BK"/src/components/
cp src/components/ReExtractSheet.jsx    "$BK"/src/components/
cp src/components/BrowserAssist.jsx     "$BK"/src/components/
cp src/components/AddEditMeal.jsx       "$BK"/src/components/
cp src/components/BatchImportQueue.jsx  "$BK"/src/components/
cp src/components/InstagramZipImport.jsx "$BK"/src/components/
cp -r src/components/import/.           "$BK"/src/components/import/
cp src/lib/photoImportEngine.js         "$BK"/src/lib/
cp src/lib/blogLinkFollower.js          "$BK"/src/lib/
cp src/lib/recipeHtmlExtraction.js      "$BK"/src/lib/
cp src/lib/importGuards.js              "$BK"/src/lib/
cp src/lib/importConfig.js              "$BK"/src/lib/
cp src/lib/transcriptionService.js      "$BK"/src/lib/
cp -r src/import/.                      "$BK"/src/import/
cp src/scrapers/redditDiscovery.js      "$BK"/src/scrapers/
cp server/coordinator.js                "$BK"/server/
cp server/jobStore.js                   "$BK"/server/
cp server/importRoutes.js               "$BK"/server/
cp -r tests/import/.                    "$BK"/tests/
```

- [ ] **Step 2: Record a manifest with hashes**

```bash
BK=_import_backup_2026-09-04
find "$BK" -type f ! -name MANIFEST.txt -print0 \
  | sort -z | xargs -0 sha256sum > "$BK"/MANIFEST.txt
wc -l "$BK"/MANIFEST.txt
```

Expected: **45 or more** lines. A smaller count means a `cp` silently failed — stop and fix before continuing.

- [ ] **Step 3: Verify the two largest files copied whole**

```bash
BK=_import_backup_2026-09-04
diff -q src/recipeParser.js "$BK"/src/recipeParser.js && echo PARSER_OK
diff -q src/components/ImportSheet.jsx "$BK"/src/components/ImportSheet.jsx && echo SHEET_OK
```

Expected: `PARSER_OK` and `SHEET_OK`, no diff output.

- [ ] **Step 4: Exclude the backup from lint, build, and git**

Append to `.gitignore`:

```
_import_backup_2026-09-04/
```

Add to the `ignores` array in `eslint.config.js` (the flat-config ignore block that already lists `dist`):

```js
'_import_backup_2026-09-04/**',
```

- [ ] **Step 5: Confirm the backup is invisible to tooling**

```bash
node_modules/.bin/eslint _import_backup_2026-09-04 2>&1 | tail -3
git status --porcelain | grep _import_backup || echo "IGNORED_OK"
```

Expected: eslint reports it is ignored; `IGNORED_OK` prints.

- [ ] **Step 6: Capture the green baseline**

Prepare the Linux natives once (skip if `/tmp/nm_extra` and `/tmp/esb2` already exist at matching versions):

```bash
RV=$(node -p "require('./node_modules/rollup/package.json').version")
EV=$(node -p "require('./node_modules/esbuild/package.json').version")
mkdir -p /tmp/nm_extra && (cd /tmp/nm_extra && npm i "@rollup/rollup-linux-x64-gnu@$RV")
mkdir -p /tmp/esb2    && (cd /tmp/esb2    && npm i "@esbuild/linux-x64@$EV")
```

Then, from the repo root:

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
npx vite build --outDir /tmp/dist-baseline
```

Expected: exit 0, 2400+ modules transformed. `--outDir` **must** stay outside the mounted repo.

Two known quirks, both recorded in project memory — do not rediscover them:
- `/tmp/nm_extra` and `/tmp/esb2` may already exist and be owned by another session. Check the versions match this repo's `rollup`/`esbuild`; if they don't, or if `npm i` there fails on permissions, build your own copies under `$HOME` instead and adjust both env vars.
- A build run **inside** the mounted repo can fail with `Rollup failed to resolve import "jszip"` while the identical source builds fine from a `git archive HEAD` copy with `node_modules` symlinked. If that error appears and `jszip` is present in `package.json`, it is the mount, not the diff.

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
node node_modules/vitest/vitest.mjs run tests/import 2>&1 | tail -20
```

Expected: the `tests/import` corpus green. If the full suite is run instead, **11 failures are pre-existing** (10 in `src/__tests__/profile.test.js` from cross-file Dexie pollution, 1 in `src/__tests__/v28.adhoc.test.js`) — do not attribute them to this work. Record the exact pass/fail counts in the commit body; every later slice compares against them.

- [ ] **Step 7: Note the build-number side effect**

`vite build` bumps `buildNumber.json`. Do not commit that churn and do not run `git checkout` yourself — list it in the handover note so Brian can revert it.

- [ ] **Step 8: Commit message to hand to Brian**

```
chore(import): snapshot import surface before engine overhaul

Adds _import_backup_2026-09-04/ (gitignored, eslint-ignored) with a
sha256 MANIFEST of every file the overhaul will touch, so each slice can
be diffed and restored by file copy without stash/reset.

Baseline recorded: vite build exit 0; tests/import green.
```

---

## Task 1: Adopt the existing barrel as the enforced seam — zero behavior change

**Rationale:** §0.1. The seam exists. Nothing goes through it. Forcing every caller through it *before* moving any logic is what makes Slices 4–8 safe, and it is verifiable by grep rather than by hope.

**Files:**
- Modify: `src/import/index.js` (add the four missing re-exports)
- Modify: `src/components/ImportSheet.jsx:8-13`
- Modify: `src/components/ReExtractSheet.jsx:4`
- Modify: `src/components/AddEditMeal.jsx:4-5`
- Modify: `src/batchImportEngine.js:12`
- Modify: `src/lib/photoImportEngine.js:30`
- Modify: `src/db.js:1373`
- Modify: `eslint.config.js`

- [ ] **Step 1: Add the re-exports the barrel is missing**

`src/import/index.js` currently omits four symbols live callers need. Add to the existing `export { … } from '../recipeParser.js'` block:

```js
  scoreExtractionConfidence,
  transcribeFromUrl,
  normalizeIngredientList,
  hasRecipeContent,
```

Before adding each one, confirm it is actually exported from `recipeParser.js`:

```bash
for s in scoreExtractionConfidence transcribeFromUrl normalizeIngredientList hasRecipeContent; do
  printf '%s: ' "$s"; grep -c "^export function $s\|^export const $s\|^export async function $s" src/recipeParser.js
done
```

Any symbol reporting `0` is not exported — drop it from the list rather than exporting it now. Widening `recipeParser`'s public surface in Slice 1 is out of scope.

Add `photoImportEngine`'s entry point too, so callers stop reaching past the barrel:

```js
export { importRecipeFromPages, PhotoImportError } from '../lib/photoImportEngine.js';
```

- [ ] **Step 2: Repoint all seven callers, imports only**

No call-site argument changes in this task — imports only, so a failure here can only be a resolution error. Example, `ImportSheet.jsx:8-13`:

```js
// before
import { importRecipeFromUrl, captionToRecipe, transcribeVideoForRecipe, … } from '../recipeParser';
import { importRecipeFromPages, PhotoImportError } from '../lib/photoImportEngine.js';

// after
import {
  importRecipeFromUrl, captionToRecipe, transcribeVideoForRecipe,
  importRecipeFromPages, PhotoImportError, …
} from '../import/index.js';
```

Apply the same shape to `ReExtractSheet.jsx:4`, `AddEditMeal.jsx:4-5`, `batchImportEngine.js:12`, `db.js:1373` (dynamic import → `await import('./import/index.js')`), and `photoImportEngine.js:30`.

**`photoImportEngine.js:30` is the one to think about:** `src/import/index.js` will now re-export `importRecipeFromPages` *from* `photoImportEngine.js`, while `photoImportEngine.js` imports `captionToRecipe` *from* the barrel. Vite/Rollup ESM handles this cycle, but it is a cycle. If the build reports a circular-dependency warning naming these two files, leave `photoImportEngine.js:30` importing `recipeParser.js` directly and add it to the eslint rule's `allow` list in Step 4 with a comment pointing at this step. Do not restructure the barrel to dodge it.

**Do not touch `BrowserAssist.jsx`.** It is unmounted (§0.6, row 12). Repointing its imports would put a dead file back in the dependency graph.

- [ ] **Step 3: Verify no direct imports remain**

```bash
grep -rn "from '.*recipeParser'" src --include=*.js --include=*.jsx \
  | grep -v "^src/import/index.js" \
  | grep -v "^src/components/BrowserAssist.jsx" \
  | grep -v __tests__
```

Expected: **no output** (or only `src/lib/photoImportEngine.js`, if Step 2's cycle escape hatch was taken).

- [ ] **Step 4: Add the eslint rule that keeps it that way**

In `eslint.config.js`, add to the rules block that applies to `src/**`:

```js
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['**/recipeParser', '**/recipeParser.js'],
    message: 'Import from src/import/index.js — the engine barrel — not recipeParser directly.',
  }],
}],
```

Then add an override that exempts the barrel itself, the unmounted BrowserAssist, and the test corpus:

```js
{
  files: [
    'src/import/index.js',
    'src/components/BrowserAssist.jsx',
    'tests/**',
    'src/**/__tests__/**',
  ],
  rules: { 'no-restricted-imports': 'off' },
},
```

- [ ] **Step 5: Verify lint and build**

```bash
node_modules/.bin/eslint src --ext .js,.jsx -f json > /tmp/lint-slice1.json; echo "exit=$?"
node -e "const r=require('/tmp/lint-slice1.json');console.log('errors',r.reduce((a,f)=>a+f.errorCount,0))"
```

Expected: error count equal to the Task 0 baseline. Any `no-restricted-imports` error means a caller was missed in Step 2.

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
npx vite build --outDir /tmp/dist-slice1
```

Expected: exit 0. **Watch stderr for circular-dependency warnings naming `photoImportEngine.js` / `index.js`** — that is Step 2's known risk surfacing.

- [ ] **Step 6: Manual smoke — the acceptance that matters**

Import one known-good Instagram reel URL and one photo. Both must reach Review with the same title, ingredient count, and cover image as before the change. This slice is defined by *nothing happening*.

- [ ] **Step 7: Commit message**

```
refactor(import): route every caller through the src/import barrel

The barrel (src/import/index.js) has existed since the last refactor and
had zero importers — ImportSheet and six other callers still reached into
recipeParser.js directly. Repoints all of them and adds a
no-restricted-imports rule so the seam cannot silently rot again.

Imports only; no call-site arguments changed. Zero behavior change.
```

---

## Task 2: Close the five drink-lock holes

**Rationale:** §2. Five one-argument fixes. Shipping them before any structural work means Bar correctness is live even if the overhaul later pauses.

**Files:**
- Modify: `src/lib/photoImportEngine.js:633, 693`
- Modify: `src/components/ReExtractSheet.jsx:177-186`
- Modify: `src/components/AddEditMeal.jsx:191`
- Modify: `src/recipeParser.js:2993`
- Modify: `src/batchImportEngine.js:29`
- Test: `tests/import/corpus.kindlock.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/import/corpus.kindlock.test.js`. Mock `structurePack` and assert the options object each path forwards. Follow the mocking style already used in `tests/import/corpus.structure-server.test.js`.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const structurePack = vi.fn(async () => ({ isRecipe: true, name: 'X', ingredients: ['a', 'b'], directions: ['c'] }));
vi.mock('../../src/import/structure/gemini.js', async (orig) => ({
  ...(await orig()),
  structurePack,
}));

beforeEach(() => structurePack.mockClear());

describe('kindLocked survives every structure path', () => {
  it('A: photo import forwards kindLocked and sourceUrl', async () => {
    const { importRecipeFromPages } = await import('../../src/lib/photoImportEngine.js');
    await importRecipeFromPages(
      [{ id: 'p1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', source: 'gallery' }],
      { type: 'drink', kindLocked: true, sourceUrl: 'https://example.test/card' },
    );
    expect(structurePack).toHaveBeenCalled();
    expect(structurePack.mock.calls.at(-1)[1]).toMatchObject({ type: 'drink', kindLocked: true });
  });
});
```

Add one `it(...)` per hole B–E in the same shape. For **D**, assert that the Reddit recursion forwards options rather than asserting on `structurePack` directly:

```js
  it('D: reddit external-link recursion forwards type, kindLocked, signal and budget', async () => {
    const parser = await import('../../src/recipeParser.js');
    const spy = vi.spyOn(parser, 'parseFromUrl');
    // drive a reddit link-post fixture through _importRecipeFromUrlInner, then:
    const opts = spy.mock.calls.at(-1)[2];
    expect(opts).toMatchObject({ type: 'drink', kindLocked: true });
    expect(opts.signal).toBeDefined();
    expect(typeof opts.requestBudget).toBe('function');
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
node node_modules/vitest/vitest.mjs run tests/import/corpus.kindlock.test.js
```

Expected: 5 failing. Hole A fails with `kindLocked: undefined`; D fails on the missing options object.

- [ ] **Step 3: Fix hole A — photo**

`photoImportEngine.js:633`, widen the signature:

```js
export async function importRecipeFromPages(
  pages,
  { type = 'meal', kindLocked = false, sourceUrl = '', onProgress, signal } = {},
) {
```

`photoImportEngine.js:693`:

```js
    recipe = await captionToRecipe(captionInput, { type, kindLocked, sourceUrl, sourceType: 'photo' });
```

- [ ] **Step 4: Fix hole B — Improve**

`ReExtractSheet.jsx:177-186`, add `kindLocked: true` to both branches. Improve always operates on a card whose kind the user already chose, so the lock is unconditional here:

```js
      const result = source === 'audio'
        ? await transcribeVideoForRecipe(videoSource.originalUrl, {
            type: itemType,
            kindLocked: true,
            imageUrl: meal.imageUrl || '',
            model: getPreferredWhisperModel(),
          })
        : await captionToRecipe(meal.sourceCaption, {
            title: meal.name || meal.title || '',
            imageUrl: meal.imageUrl || '',
            sourceUrl: meal.link || meal.sourceUrl || '',
            type: itemType,
            kindLocked: true,
          });
```

- [ ] **Step 5: Fix hole C — AddEditMeal**

`AddEditMeal.jsx:191`. The form already knows its mode via `isMealMode` (used at `:229`):

```js
      const result = await parseFromUrl(importUrl.trim(), undefined, {
        type: isMealMode ? 'meal' : 'drink',
        kindLocked: true,
      });
```

And at `:229`, forward the lock the OCR path is already close to having:

```js
      const recipe = await importRecipeFromPages(
        [{ id: `aem-${Date.now()}`, dataUrl: imageDataUrl, source: 'gallery' }],
        {
          type: isMealMode ? 'meal' : 'drink',
          kindLocked: true,
          onProgress: (_stage, msg) => setImportProgress(msg),
        },
      );
```

- [ ] **Step 6: Fix hole D — Reddit recursion**

`recipeParser.js:2993`. The enclosing `_importRecipeFromUrlInner` already has all four values in scope:

```js
        const externalRecipe = await parseFromUrl(redditData.externalUrl, onProgress, {
          type, signal, kindLocked, requestBudget,
        });
```

`parseFromUrl` (`:2914`) currently drops `requestBudget` when forwarding to `importRecipeFromUrl`. Widen both signatures to accept and forward it, or the budget fix is a no-op:

```js
export async function parseFromUrl(url, onProgress, { type = 'meal', signal, kindLocked = false, requestBudget } = {}) {
  return await importRecipeFromUrl(url, onProgress, { type, signal, kindLocked, requestBudget });
}
```

Apply the same widening to `importRecipeFromUrl` (`:2919`) and `_importRecipeFromUrlOuter` (`:2923`). In the outer function, an inherited `requestBudget` must **extend** the deadline, never replace it — reuse the existing budget-extension logic rather than reassigning.

- [ ] **Step 7: Fix hole E — batch queue**

`batchImportEngine.js:29`. The queue row already carries the user's explicit choice:

```js
    const userLocked = !!item.itemTypeUserOverride;
    const result = await importRecipeFromUrl(item.url, () => {}, {
      type: userLocked ? item.itemType : detectedType,
      kindLocked: userLocked,
      signal: controller.signal,
    });
```

Leave the post-hoc relabel at `:36-38` in place — it is now consistent rather than corrective.

- [ ] **Step 8: Run the tests and confirm they pass**

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
node node_modules/vitest/vitest.mjs run tests/import
```

Expected: `corpus.kindlock.test.js` 5 passing, rest of the corpus unchanged from the Task 0 baseline.

- [ ] **Step 9: Manual smoke**

From the **Bar** tab: import a cocktail Reel; Improve that saved card; import a cocktail photo; import a cocktail blog URL through AddEditMeal. All four land as drinks and stay drinks after save.

- [ ] **Step 10: Commit message**

```
fix(import): thread kindLocked through every structure and ASR path

Five paths structured without the drink lock, so Bar imports came back as
meals: photo (photoImportEngine:693), Improve (ReExtractSheet:177,182),
AddEditMeal URL import (:191 — the form is not meals-only, it has
isMealMode), the Reddit external-link recursion (recipeParser:2993, which
also dropped signal and requestBudget), and the zip/batch queue
(batchImportEngine:29, which ignored itemTypeUserOverride until after
structuring).

Adds tests/import/corpus.kindlock.test.js pinning all five.
```

---

## Task 3: One Whisper pass, host-agnostic

**Rationale:** §0.4. Instagram is already guarded; TikTok and Shorts are not, because `isVideoPostForAsr` lives inside `importFromInstagram` and pattern-matches `/reel/` and `/tv/`.

**Files:**
- Create: `src/import/acquire/videoAudio.js`
- Modify: `src/recipeParser.js:5356-5400`
- Modify: `src/components/ImportSheet.jsx:605-640`
- Test: `tests/import/corpus.videoaudio.test.js`

- [ ] **Step 1: Write the failing test**

Assert the helper runs exactly once across a parser attempt plus a sheet fallback, for each of an Instagram reel, a TikTok URL, and a YouTube Shorts URL. Spy on `transcribeFromUrl` and assert `toHaveBeenCalledTimes(1)` per URL.

- [ ] **Step 2: Run it and confirm TikTok and Shorts fail with 2 calls**

- [ ] **Step 3: Extract the helper**

`src/import/acquire/videoAudio.js` — one exported function, no UI, no structuring:

```js
import { detectVideoSource } from '../../lib/videoSource.js';

/**
 * Attach a transcript to `pack` if — and only if — it still needs one.
 * Never structures. Never sets a UI phase. Idempotent: safe to call from
 * both the parser's pre-exit and the sheet's fallback.
 * @returns {Promise<{ transcript: string|null, attempted: boolean, via: string|null }>}
 */
export async function acquireVideoAudio(pack, { signal, model, onProgress, budgetMs = 40_000 } = {}) {
  if (pack?.transcript || pack?._asrAttempted) return { transcript: null, attempted: false, via: null };
  if (!detectVideoSource(pack?.sourceUrl || '')) return { transcript: null, attempted: false, via: null };
  // …existing recipeParser.js:5365-5392 body, verbatim: AbortController wiring,
  // the 40s inner timeout, transcribeFromUrl, the >= 20 char guard.
}
```

Move the body from `recipeParser.js:5365-5392` rather than rewriting it — the abort wiring and the 40s inner timeout are load-bearing.

- [ ] **Step 4: Replace the host regex with the shared detector**

`recipeParser.js:5356` — `/\/(reel|tv)\//i` becomes the same `detectVideoSource` call the sheet already uses at `ImportSheet.jsx:596`. Set `_asrAttempted` for **every** host the helper attempted, not just Instagram.

- [ ] **Step 5: Point both call sites at the helper**

The parser's pre-exit (`recipeParser.js:5357`) and the sheet's fallback (`ImportSheet.jsx:607`) both call `acquireVideoAudio`. The helper's own no-op guard replaces `alreadyTriedAsr` as the source of truth; leave the `alreadyTriedAsr` read in place as a cheap short-circuit.

- [ ] **Step 6: Run the tests**

Expected: all three URLs transcribe exactly once.

- [ ] **Step 7: Manual smoke**

A silent Instagram reel and a silent TikTok each spin through audio **once**. Time both — a regression here doubles a 40s wait and is the most user-visible failure mode in this plan.

- [ ] **Step 8: Commit message**

```
refactor(import): single Whisper pass on every video host

_asrAttempted was only set inside importFromInstagram, behind a
/(reel|tv)/ path test, so TikTok and Shorts transcribed twice — once in
the parser's pre-exit and again in the sheet's fallback. Extracts
acquire/videoAudio.js with its own idempotence guard and switches the
host test to the shared detectVideoSource.
```

---

## Task 4: The pack survives — stop un-packing what acquire returned

**Rationale:** §0.2. This is the overhaul. Everything before it was preparation.

**Files:**
- Create: `src/import/engine.js`
- Modify: `src/recipeParser.js:5052-5077` and the ~400 lines downstream that read `captured*`
- Test: `tests/import/corpus.packflow.test.js`

- [ ] **Step 1: Write the failing test**

Assert that for an Instagram fixture, the object handed to `structurePack` is **the same pack object** `acquireInstagramPack` returned — extended, not rebuilt:

```js
  it('carries the acquired pack through to structure without rebuilding it', async () => {
    const acquired = [];
    vi.mock('../../src/import/acquire/instagram.js', async (orig) => {
      const m = await orig();
      return { ...m, acquireInstagramPack: async (...a) => { const p = await m.acquireInstagramPack(...a); acquired.push(p); return p; } };
    });
    await importFromInstagram(IG_FIXTURE_URL, () => {}, { type: 'meal' });
    const sent = structurePack.mock.calls.at(-1)[0];
    expect(sent.provenance).toEqual(expect.arrayContaining(acquired[0].provenance));
    expect(sent.sourceUrl).toBe(acquired[0].sourceUrl);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Expected failure: provenance from the acquire pack is absent, because the downstream pack is rebuilt from locals.

- [ ] **Step 3: Introduce the pack as the carrier**

At `recipeParser.js:5059`, keep `igPack` in scope for the whole function instead of draining it into thirteen locals. Replace each `captured*` read downstream with the corresponding pack field. Work **one variable at a time**, running the corpus after each, in this order (least to most entangled):

1. `capturedOwnerUsername` → `igPack.ownerUsername`
2. `capturedProfileBioUrl` → `igPack.profileBioUrl`
3. `capturedIsVideo` → `igPack.isVideo`
4. `capturedAuthor` → `igPack.author`
5. `capturedTitle` → `igPack.title`
6. `capturedSource` → `igPack.acquiredVia`
7. `capturedComments` → `igPack.latestComments`
8. `capturedImages` / `capturedImageUrl` → `igPack.images` (keep the data-URL persistence step at `:5068-5071` — it mutates the pack's first image in place rather than a local)
9. `capturedRawCaption` → `igPack.caption`
10. `capturedCaption` → a derived `cleanSocialCaption(igPack.caption)`, memoized once

Leave `capturedRawPageText` alone in this task — it is written by the blog-follower branch, not by the IG pack, and belongs to Task 6.

**Do not batch these.** Each step is a commit-sized change with a corpus run behind it. The IG cascade has many early-return paths and a batched edit will strand one of them.

- [ ] **Step 4: Do the same for the website path**

`recipeParser.js:3097-3106` spreads `serverPack.candidate` and returns, discarding provenance and images. Return a pack-derived object that keeps `_contextPack` populated the way the Gemini branch at `:3112-3125` already does.

- [ ] **Step 5: Create the spine**

`src/import/engine.js`. Keep it boring: detect, dispatch to one acquire fork, structure once, gate once, return.

```js
/**
 * @typedef {object} ImportRequest
 * @property {string}  [url]
 * @property {string}  [text]
 * @property {Array}   [pages]
 * @property {'meal'|'drink'} kind
 * @property {boolean} kindLocked
 * @property {AbortSignal} [signal]
 * @property {(msg: string) => void} [onProgress]
 * @property {'share'|'discover'|'batch'|'sheet'|'form'} [via]
 */

/**
 * `gate` is the `verdict` returned by gateRecipe (Task 7), renamed on the way
 * out because that is the field name the sheet switches on.
 * @returns {Promise<{ recipe: object|null, pack: object, gate: 'pass'|'salvage'|'empty', reasons: string[] }>}
 */
export async function importRequest(request) { /* … */ }

/** Re-structure an existing pack — Improve, DomAimSheet apply. Never re-acquires. */
export async function restructure(pack, { kind, kindLocked }) { /* … */ }
```

**Hard cap: 400 lines.** If `engine.js` passes it, acquire logic has leaked in — move it back out to a fork rather than raising the cap.

- [ ] **Step 6: Run the corpus after every sub-step of Step 3**

```bash
NODE_PATH=/tmp/nm_extra/node_modules \
ESBUILD_BINARY_PATH=/tmp/esb2/node_modules/@esbuild/linux-x64/bin/esbuild \
node node_modules/vitest/vitest.mjs run tests/import
```

Expected: green after each. A red run isolates to the single variable just moved — that is the whole reason for the one-at-a-time rule.

- [ ] **Step 7: Verify the line cap**

```bash
wc -l src/import/engine.js
```

Expected: ≤ 400.

- [ ] **Step 8: Manual smoke**

An Instagram reel whose recipe is in the comments must still import — that path reads `capturedComments` and is the most likely casualty of Step 3.7.

- [ ] **Step 9: Commit message**

```
refactor(import): carry the ContextPack through to structure

acquireInstagramPack has returned a pack since the last refactor, but
recipeParser drained it into thirteen captured* locals at :5059 and
rebuilt a fresh pack ~400 lines later, losing provenance and image
metadata. The website path did the same in one line at :3097.

Threads the acquired pack through instead and adds the thin
import/engine.js spine (detect -> acquire -> pack -> structure -> gate).
```

---

## Task 5: One request object; forks stop setting UI phase

**Files:**
- Create: `src/import/detectSource.js`
- Modify: `src/components/ImportSheet.jsx:556, 721, 797, 880`
- Test: `tests/import/corpus.detectSource.test.js`

- [ ] **Step 1: Write the failing test** — one case per return value, plus the three the brief's three-enum detect would miss: a Pinterest URL, a Reddit URL, and pasted text with a URL inside it (must return `blog`/`social`, not `text`).

- [ ] **Step 2: Run it, confirm it fails** (module does not exist).

- [ ] **Step 3: Implement `detectSource`** — pure, no network. **Do not touch `detectImportType`** (`recipeParser.js:5610`); it detects kind, is exported, and `batchImportEngine.js:12` imports it (§0.8).

- [ ] **Step 4: Collapse the sheet's four executors into one submit handler**

`ImportSheet.jsx` builds one `ImportRequest` and calls `engine.importRequest`. The four executors (`:556`, `:721`, `:797`, `:880` — note the brief and the source analysis both say *three*; `executeTranscribeImport` is the fourth) become one.

- [ ] **Step 5: Run the corpus and the build.**

- [ ] **Step 6: Manual smoke** — paste a caption that contains a blog URL. Before: text forever. After: the blog is followed.

- [ ] **Step 7: Commit message**

```
refactor(import): one request object, one submit handler

Adds import/detectSource.js (source, distinct from the existing
kind-detecting detectImportType) and collapses ImportSheet's four
executors into a single engine.importRequest call.
```

---

## Task 6: Remaining forks return packs

**Files:** Create `src/import/acquire/blog.js`, `src/import/acquire/photo.js`, `src/import/acquire/reddit.js`. Modify `photoImportEngine.js` to stop structuring.

- [ ] **Step 1: Write failing tests** — each fork returns a pack and calls neither `structurePack` nor `captionToRecipe`.

- [ ] **Step 2–4: Implement the three forks.**

`acquire/photo.js` returns `onScreenText`, `images`, **and `scanPages`**. `ImportReview` takes `scanPages` as a prop (`ImportSheet.jsx:1332`) and uses it for cover recrop — a fork that discards pages silently removes that affordance.

`acquire/blog.js` wraps `tryBlogLinkExtraction` and `acquireWebsitePack`. It must attach `pack.html` (capped at 2MB, as `capHtml` already does) so a later DomAimSheet has something to render.

`acquire/reddit.js` wraps `redditDiscovery` and may nest into `acquire/blog` for link-posts — one pack out, per the brief. This supersedes the hole-D patch from Task 2: the recursion becomes a nested acquire rather than a self-call through `parseFromUrl`. Keep the Task 2 test green through the transition.

- [ ] **Step 5: Remove the structure call from `photoImportEngine.js:687-696`.** The engine structures; the fork acquires. Keep the offline heuristic fallback at `:700` — it is the offline-sovereignty path, and deleting it makes photo import fail closed with no connection.

- [ ] **Step 6: Run corpus + build. Step 7: Manual smoke** — photo, blog, and a Reddit link-post all reach Review. **Step 8: Commit message.**

```
refactor(import): blog, photo and reddit forks return ContextPacks

Forks now acquire only — photoImportEngine no longer structures, and the
reddit link-post recursion becomes a nested blog acquire returning one
pack instead of a self-call through parseFromUrl.
```

---

## Task 7: The gate owns the next UI state

**Files:** Create `src/import/gate.js`, `tests/import/corpus.gate.test.js`. Modify `src/lib/importGuards.js:127` (leave a re-export shim), `recipeParser.js:5291, 5525`, `ImportSheet.jsx`.

- [ ] **Step 1: Write the failing test.** Minimum cases: a gin-and-tonic (2 ingredients, `kind: 'drink'`) → `pass`, not `empty` — the current `ings.length < 2` rule at `importGuards.js:145` is the cocktail bug. A bait caption ("recipe in comments!") → `empty`. A recipe with ingredients and no directions → `salvage`. A `kind: 'meal'` two-ingredient result → `salvage`, not `pass`.

- [ ] **Step 2: Run it, confirm it fails** — today `schemaQualityGate` returns `{ pass, reasons }` with no third state and no kind awareness.

- [ ] **Step 3: Implement `gateRecipe(recipe, pack)` → `{ verdict, reasons }`.** Drink rules: 2 ingredients is a pass when `pack.kind === 'drink'`; a missing method is `salvage`, not a fail. Meal rules keep today's thresholds.

- [ ] **Step 4: Stop caching bait.** `recipeParser.js:5302, 5536, 5551, 5561, 5571` all call `setCachedImport` unconditionally — including immediately after a gate failure is logged at `:5291` and `:5525`. Guard every one of them with `verdict !== 'empty'`. Today a bait extraction is cached for seven days and re-served on every retry, which is why "try again" feels broken.

- [ ] **Step 5: Extend the gate to the paths it never covered.** `schemaQualityGate` is called at exactly two sites, both inside the Instagram cascade. Photo, paste, Pinterest, and the generic website path have never been gated at all. The engine gates all of them once.

- [ ] **Step 6: Map verdict to surface in `ImportSheet`** — `pass` → Review; `salvage` → Review with the weak block open; `empty` → Miss.

- [ ] **Step 7: Fix the Miss "Try again" trap.** `ImportSheet.jsx:1305-1315` calls `setRecoveryText('')` and then re-runs the identical `handleUrlImport(importUrl, itemType)`. The text the user just edited in the recovery textarea is **discarded and never used**, and the retry hits the same 7-day cache. Miss is paste-first per the brief, so the button must send the edited text: `engine.importRequest({ text: recoveryText, kind, kindLocked, via: 'miss' })`.

- [ ] **Step 8: Run corpus + build. Step 9: Manual smoke** — a two-ingredient highball from the Bar tab reaches Review; a bait caption reaches Miss and is not cached; editing the Miss textarea and pressing the button uses the edit. **Step 10: Commit message.**

```
feat(import): pass/salvage/empty gate replaces the observational one

schemaQualityGate only ever logged, ran at two Instagram-only call sites,
and failed any 2-ingredient recipe — so highballs were rejected and bait
was cached for 7 days and re-served on retry. Moves it to import/gate.js
with drink-aware rules and a third state, gates every fork, and stops
caching on empty.

Also fixes the Miss retry discarding the user's edited text
(ImportSheet:1305) — it now re-imports what they typed.
```

---

## Task 8: Cache and dedupe keyed by url + kind + prompt version

**Files:** Modify `src/db.js:1652`, `src/lib/importGuards.js:184`.

- [ ] **Step 1: Write the failing test** — same URL, same kind, bumped `ENGINE_PROMPT_VERSION` → cache miss. Same URL, different kind, concurrent → two in-flight imports, not one shared.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Extend the cache key.** `db.js:1652` already includes kind (§0.3). Add the version — `ENGINE_PROMPT_VERSION` already exists at `src/recipeSchema.js:1127` (`'2026.07.3'`), so import it rather than inventing a constant:

```js
import { ENGINE_PROMPT_VERSION } from './recipeSchema.js';
function cacheKey(url, type = 'meal') {
  return `${url}::${type || 'meal'}::${ENGINE_PROMPT_VERSION}`;
}
```

`clearInstagramCache` at `db.js:1703` bulk-deletes two hardcoded key shapes and will silently stop matching. Update it, or switch it to a prefix scan.

- [ ] **Step 4: Extend the dedupe key.** `importGuards.js:184` `deduplicateImport(url, fn)` → `deduplicateImport(url, kind, fn)`; `normalizeImportUrl` output gains `::${kind}`. Update the caller at `recipeParser.js:2968`.

- [ ] **Step 5: Point Improve at `restructure`.** `ReExtractSheet` calls `engine.restructure(pack, { kind, kindLocked: true })` and never opens intake.

- [ ] **Step 6: Run corpus + build. Step 7: Manual smoke** — import a URL from Meals, then the same URL from Bar; two distinct results, neither served from the other's cache. **Step 8: Commit message.**

```
feat(import): key cache and dedupe on url + kind + prompt version

The cache key was already kind-aware (db.js:1652); it lacked the prompt
version, so a prompt change kept serving stale rows for 7 days. The
in-flight dedupe key was genuinely url-only, so a Bar tap of a URL
already importing as a meal joined that import.
```

---

## Task 9: Shrink the parser; retire dead code

**Files:** Move `cleanSocialCaption` / `isCaptionWeak` to `src/import/clean/socialCaption.js`. Delete `server/coordinator.js`, `server/jobStore.js`, `server/importRoutes.js` and their tests. Reduce `recipeParser.js` to a facade plus leftover line parsers.

- [ ] **Step 1: Confirm the server trio is still unreachable** before deleting:

```bash
grep -rn "importRoutes\|runWaterfall\|jobStore" src api server --include=*.js --include=*.jsx | grep -v __tests__
grep -n "app.use\|app.post\|app.get" server/index.js
```

Expected: no client reference; `importRoutes` absent from `server/index.js`. **If either check contradicts §0.6, stop and re-plan this task** — something was mounted after 2026-09-04.

- [ ] **Step 2: Delete the three server files and their two test files in one change.** Deleting source while leaving `server/__tests__/coordinator.test.js` turns the suite red for a reason unrelated to this work.

- [ ] **Step 3: Move the caption cleaners**, adding drink units (`oz`, `dash`, `jigger`, `cl`) to the `isCaptionWeak` test so a terse cocktail caption is not judged weak and sent to audio.

- [ ] **Step 4: Delete any `_DEAD_*` HTML paths** still in `recipeParser.js`. Keep `parseIngredientLine`, `scoreExtractionConfidence`, and the title helpers until nothing imports them.

- [ ] **Step 5: Verify the parser no longer owns the spine:**

```bash
grep -n "setPhase\|Phase 0\|Phase 1\|Phase 2\|Phase 3\|browserAssist" src/recipeParser.js
wc -l src/recipeParser.js
```

Expected: no `setPhase`, no numbered-phase comments driving control flow. Line count materially below 5,764 — treat ~2,000 as the signal that acquire and structure really left, not as a target to hit by deleting comments.

- [ ] **Step 6: Full suite + build. Step 7: Commit message.**

```
refactor(import): shrink recipeParser to a facade; retire dead server waterfall

server/coordinator.js, jobStore.js and importRoutes.js were never mounted
in server/index.js and unreachable from any client — deleted with their
tests. Moves cleanSocialCaption/isCaptionWeak to import/clean/ with
drink units added to the weak test.
```

---

## Not in scope

Do not revive the `browserAssist` sheet phase. `BrowserAssist.jsx` (2,390 lines) stays in the tree, unmounted and unedited: its iframe fallback is CSP-blocked for everything but Instagram/YouTube embeds, and on Instagram it re-enters `importFromInstagram` — the pipeline that just failed. Miss is paste-first.

`DomAimSheet` is a later, separate plan. Its precondition is Task 6 attaching `pack.html` to website packs; until then there is nothing for it to render. When it is built, its first slice is extracting `sanitizeHtmlForEmbed` from `BrowserAssist.jsx` with unit tests — **not** copying `BrowserAssist.jsx` and deleting phases, which reproduces the second spine.

Also out of scope: the progress vocabulary rename (§0.8); `ImportTimeline` wiring (`ImportSheet` computes `timeline` state in ten places and renders none of it — a real UX gap, but product work, not this move); intake redesign; destination routing; the age gate; Dexie save paths.

---

## Rollback

Per slice, by file copy. No `git stash`, no `git reset`.

```bash
BK=_import_backup_2026-09-04
# one file
cp "$BK"/src/recipeParser.js src/recipeParser.js
# whole surface
cp -r "$BK"/src/import/. src/import/
cp "$BK"/src/components/ImportSheet.jsx src/components/ImportSheet.jsx
# verify against the manifest
(cd "$BK" && sha256sum -c MANIFEST.txt | grep -v ': OK$') || echo "BACKUP_INTACT"
```

Files **created** by a slice are not in the backup — remove them by name when rolling back. Each task lists its creations under **Files:**.

After any rollback, re-run the Task 0 Step 6 baseline build and corpus before continuing. If a rollback restores a file that a *later* slice also touched, roll back the later slice first — the backup is a single point-in-time snapshot, not a per-slice history.

---

## Definition of done

**Structural**

1. One production entry: `engine.importRequest`. `ImportSheet` has one submit handler, not four.
2. Three primary acquire forks plus Pinterest and Reddit helpers. One structure call. One gate.
3. No fork calls `structurePack`, `captionToRecipe`, or `setPhase`.
4. `src/import/engine.js` ≤ 400 lines.
5. `recipeParser.js` contains no numbered-phase control flow and no `setPhase` knowledge.
6. `grep -rn "from '.*recipeParser'" src` returns only the barrel (and `BrowserAssist.jsx`, unmounted).

**Behavioral**

7. `kindLocked` survives photo, blog-from-IG, Reddit-to-blog, Improve, and the batch queue. A Bar import never lands as a meal.
8. Audio runs at most once per URL, on every video host.
9. A two-ingredient highball passes the gate. A bait caption reaches Miss and is not cached.
10. Cache and in-flight dedupe are keyed on url + kind + `ENGINE_PROMPT_VERSION`.
11. Miss retry re-imports the text the user edited.

**Verification**

12. `npm run build` clean — via the Linux VM invocation in Task 0 Step 6, `--outDir` outside the repo, exit 0.
13. `npm run lint` at or below the Task 0 baseline error count.
14. `npm run test:corpus` green; full-suite failures no worse than the 11 pre-existing.
15. Manual smoke, all from **both** Meals and Bar: an Instagram reel with the recipe in comments; a silent reel (audio once); a cocktail blog URL; a cookbook photo; a Reddit link-post; a pasted caption containing a blog URL; a zip batch row with an explicit kind override.
16. `buildNumber.json` churn from verification builds listed in the handover for Brian to revert.

---
---

# Part II — The import surface

Settled at the design bench on 2026-09-04. **Tasks 10 and 11 ship independent of every engine slice** — they touch only the display layer and need nothing from the pack work. Tasks 12 and 13 depend on Task 7's gate.

Task 0's backup already covers every file below.

## What the bench found that changes the work

**The status line was never leaking engine words.** `src/importCopy.js` has humanized engine output since the June CX pass and is wired at `ImportSheet.jsx:581`, so `apify: caption (847 chars)` already reaches the user as *"Grabbing the recipe caption…"*. The failure is that nothing accumulates — one line replaces another with no sense of travel, so a long import reads as a stalled one.

**The tabs are already right.** `ImportSheet.css:945` — `.review-tab` is a horizontal flex row at `min-height: 46px`. The amber flag dot (`:988`), the cross-list drag targets (`:972`, `:980`) and the count pill (`:996`) all exist. No restructuring; at most a 46 → 42px trim, and that is cosmetic and optional.

**The destination grid was never a real choice.** `ImportReview.jsx:962–1000` — the kind-correction buttons already flip `itemType` *and* call `setDest()` in the same handler. Kind has always decided the shelf. A separate picker let the two disagree.

---

## Task 10: Working surface — rail, spinner, plain language

**Files:**
- Modify: `src/components/ImportSheet.jsx:1226–1282` (loading branch), `:1379` (footer)
- Modify: `src/import/progressMap.js` (add a display map; leave `mapProgress` alone)
- Modify: `src/components/import/ImportTimeline.jsx` (chip + spinner)
- Test: `tests/import/corpus.progress.test.js` (extend, do not rewrite)

- [ ] **Step 1: Write the failing test for the chip display map**

`mapProgress` must keep returning internal ids — `corpus.progress.test.js:54–58` asserts `'Apify'`, `'IG data'`, `'Gemini'`, `'Reddit'`, `'Video audio'`. Add a *separate* export and test it alongside:

```js
describe('progressMap — chip display labels', () => {
  it('never shows a tool name', () => {
    expect(chipLabel('Apify')).toBe('from the post');
    expect(chipLabel('IG data')).toBe('from the post');
    expect(chipLabel('Embed')).toBe('from the post');
    expect(chipLabel('JSON-LD')).toBe('from the page');
    expect(chipLabel('SpiceHub server')).toBe('from the page');
    expect(chipLabel('Reddit')).toBe('from the thread');
    expect(chipLabel('Video audio')).toBe('from the video');
    expect(chipLabel('Gemini')).toBeNull();   // a step, not a source
    expect(chipLabel('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `chipLabel` does not exist.

- [ ] **Step 3: Add the display map to `progressMap.js`**

```js
const CHIP_LABELS = {
  'Apify': 'from the post', 'IG data': 'from the post', 'Embed': 'from the post',
  'JSON-LD': 'from the page', 'Microdata': 'from the page', 'SpiceHub server': 'from the page',
  'Caption': 'from the post', 'Reddit': 'from the thread', 'Video audio': 'from the video',
  'On-device': 'from the page',
  'Gemini': null,
};
/** Internal tier id → what a person reads. null = show no chip. */
export function chipLabel(chip) { return CHIP_LABELS[chip] || null; }
```

Do not touch `CHIP_RULES` or `mapProgress`. The engine keeps its vocabulary; only the boundary translates.

- [ ] **Step 4: Render the timeline, with the spinner under the rail**

In `ImportTimeline.jsx`, run the incoming `chip` through `chipLabel` and drop the literal `via ` prefix — the label carries its own preposition. Between `.itl-rail-row` and `.itl-status-row`, add the ring, hidden once every node is done:

```jsx
{!allDone && (
  <div className="itl-spin"><div className="ring-spinner" aria-hidden="true" /></div>
)}
```

The rail carries *how far*; the ring carries *still alive*. A three-node rail alone goes visually static between stages, and Understanding is exactly where the long waits sit.

- [ ] **Step 5: Replace the ring-only loading branch**

`ImportSheet.jsx:1226–1282` renders `.import-sheet-ring-spinner` and `.import-sheet-status-text` directly. Swap in `<ImportTimeline stage={timeline.stage} chip={timeline.chip} statusMsg={progressMsg} slow={elapsedTime >= 8} />` — the state is already computed in ten places and read in none. Keep the cover-image block above it.

- [ ] **Step 6: Rewrite the status ladder in `importCopy.js`**

Report outcomes, not attempts, so the sequence reads as travel:

```js
const STATUS_MAP = [
  [/subtitle|transcript|asr|audio|whisper/i, 'Not much written down — having a listen'],
  [/photo|vision|ocr|analyzing image/i,      'Reading your photo…'],
  [/structur|gemini|\bai\b|markdown|parse/i, 'Sorting ingredients from steps…'],
  [/multiple extraction|deeper|another method|retry/i, 'Trying another way in…'],
  [/comment/i,                               'Reading the caption, comments and all'],
  [/caption|embed|oembed|instagram|reel|tiktok|scanning/i, 'Got the post — lifting the words out'],
  [/browser|server|yt-dlp|puppeteer|headless|proxy|fetching page|page text|page content/i, 'Reading the recipe page…'],
  [/json|endpoint|structured data|schema|metadata/i, 'Looking for the recipe…'],
  [/start|import/i,                          'Sniffing out the recipe…'],
];
const DEFAULT_STATUS = 'Working on your recipe…';
```

Order matters — first match wins, and the comments rule must sit above the caption rule or it never fires.

- [ ] **Step 7: Give the finish a beat**

On a successful structure, set the line to **`Plated up.`** before the review transition. One string; it is the only moment the import gets to feel finished rather than merely stopped.

Change the 8-second subtext at `ImportSheet.jsx:1268` to **"Still going — some posts hide the recipe well."** The current wording promises "trying another way", which is not always true.

- [ ] **Step 8: Make cancel visible**

`useBackHandler` already covers `phase === 'loading'` (`ImportSheet.jsx:542`), so back raises the discard confirm. Add a matching footer button during loading — **Cancel import** — so the exit is not only the corner ✕. It aborts via the existing `abortRef` controller.

- [ ] **Step 9: Run corpus + build.** Expected: `corpus.progress.test.js` green including the new block.

- [ ] **Step 10: Manual smoke** — an Instagram reel with the recipe in comments, and a silent reel. Watch the whole ladder. No tool name may appear on screen in either.

- [ ] **Step 11: Commit message**

```
feat(import): render the progress timeline in plain language

ImportTimeline.jsx has been built, styled and tested since the July
unification and was never mounted — ImportSheet computed `timeline` in ten
places and read it in zero, drawing a bare ring instead. Mounts it, keeps
the ring underneath so the rail isn't static during long Understanding
waits, and adds progressMap.chipLabel() so the tier chip reads "from the
post" instead of "Apify".

mapProgress and CHIP_RULES are untouched — the corpus asserts those
strings. Translation happens at the render boundary, same split
importCopy.js already uses for the status line.
```

---

## Task 11: Close the two humanizer leaks

Only the URL path is humanized. Photo and transcribe imports show raw engine text today.

**Files:** `src/components/ImportSheet.jsx:608, 614, 822, 895, 902`

- [ ] **Step 1: Write the failing test** — assert `setProgressMsg` never receives a string matching `/apify|gemini|oembed|yt-dlp|whisper|json-ld|ig-json|transcrib/i` across all four executors.

- [ ] **Step 2: Run it, confirm the photo and transcribe paths fail.**

- [ ] **Step 3: Wrap the three raw pass-throughs** — `:614`, `:822`, `:902` all do `setProgressMsg(msg)`. Wrap each in `humanizeImportStatus(...)`, which is already imported at `:18`.

- [ ] **Step 4: Replace the two hardcoded strings**

```js
// :608 — was 'No caption found — transcribing video audio…'
setProgressMsg('Not much written down — having a listen');
// :895 — was 'Transcribing video audio…'
setProgressMsg('Having a listen to the video…');
```

- [ ] **Step 5: Run corpus + build. Step 6: Manual smoke** — import a cookbook photo and a silent reel; read every line.

- [ ] **Step 7: Commit message**

```
fix(import): humanize progress on the photo and transcribe paths

humanizeImportStatus was only applied to the URL executor, so photo and
video imports surfaced raw engine strings, and two messages hardcoded
"transcribing video audio".
```

---

## Task 12: Review — kind decides the shelf

**Depends on:** Task 7 for the salvage open-state. The destination removal is independent and can ship first.

**Files:** `src/components/ImportReview.jsx:684–694, 962–1000, 1296–1316`; `src/components/ImportSheet.css:1349+`

- [ ] **Step 1: Write the failing test** — flipping kind to `drink` sets destination `bar` and the save label reads `Save to Bar Library`; flipping back sets `library` / `Save to Meal Library`. Assert no `week` or `grocery` destination is reachable.

- [ ] **Step 2: Run it, confirm it fails** — `destinations` at `:685–694` still offers `week` and `grocery`.

- [ ] **Step 3: Delete the destination grid**

Remove the `destinations` array (`:684–694`), the `.review-destination` block (`:1296–1316`), and its CSS from `ImportSheet.css:1349` onward. Keep `destValue` / `setDest` — they still carry the derived value to `onSave`.

- [ ] **Step 4: Replace the two correction buttons with one kind chip**

`:962–1000` currently renders two mutually exclusive one-tap buttons ("Actually, this is a Drink → Bar" / the reverse). Collapse them into a single chip near the title that opens a two-item menu, each item naming its consequence:

```
Meal   — Saves to Meal Library
Drink  — Saves to Bar Library
```

Keep everything the existing handlers do: set `itemType` / `type` / `_type`, call `setDest`, and call `invalidateCachedImport(recipe.link || recipe.sourceUrl)` — without that last line the 7-day cache keeps re-serving the wrong kind on every re-import of the same link.

- [ ] **Step 5: Derive the save label** — `Save to Meal Library` / `Save to Bar Library`, so the consequence is visible at the moment of committing.

- [ ] **Step 6: Move the disagreement warning next to the chip**

`review-type-disagreement` (`:947`) is now the *only* place a kind mismatch surfaces, since there is no second control to notice it in. It must render adjacent to the chip, not further down the sheet.

- [ ] **Step 7: Salvage opens on the weak part** (needs Task 7)

On `gate === 'salvage'`, open `activeTab` on the list carrying the flags rather than defaulting to `ingredients` (`:401`), and set the trust line under the title: *"Pieced together from the caption and 3 comments — worth a quick look."* `flaggedSteps` and `moveAllFlaggedToIngredients` already exist (`:648`, `:660`), and `.review-tab.flagged` already draws the amber dot (`ImportSheet.css:988`) — this is wiring, not new UI.

- [ ] **Step 8: Put Discard beside Save on a salvage.** On a thin extraction the odds of wanting out are high enough that the exit should not hide in the corner. It raises the existing `showDiscardConfirm` footer (`:1379`).

- [ ] **Step 9: Leave the tabs alone.** `.review-tab` is already a 46px horizontal row with counts, drag targets and the flag dot. A 46 → 42px trim is optional and cosmetic; nothing else changes.

- [ ] **Step 10: Run corpus + build. Step 11: Manual smoke** — import a cocktail from Meals, flip the chip to Drink, save, confirm it lands in Bar and the cache was invalidated.

- [ ] **Step 12: Commit message**

```
feat(import): kind picks the shelf; drop the destination grid

The grid offered a choice that was never real — the kind-correction
buttons already flipped itemType and called setDest() together, so two
controls could disagree about one fact. Replaces both with a single kind
chip whose menu names the consequence, and derives the save label from it.

Week and Grocery are gone: an import lands in a library, and planning it
into a week is a separate act on a recipe that already exists.
```

---

## Task 13: Miss — the diagnosed ask

**Depends on:** Task 7. The gate must return real reasons before the screen can name one.

**Files:** `src/components/ImportSheet.jsx:1290–1318`; `src/import/gate.js`

- [ ] **Step 1: Write the failing test** — each gate reason maps to its own copy and its own pre-focused affordance; an unrecognized reason falls back to paste-first rather than rendering an empty shell.

- [ ] **Step 2: Run it, confirm it fails** — today there is one generic recovery screen.

- [ ] **Step 3: Ship the fallback first.** Fix the discard bug from Task 7 step 7 — **Use this text** sends `{ text: recoveryText }` through the engine instead of clearing it and re-running the URL. Every reason below degrades to this.

- [ ] **Step 4: Add the first diagnosis — link-in-bio**, the most common Instagram miss:

> **The recipe's on their blog.** The post just points at "link in bio" — there's nothing here to cook from yet.

Pre-focused field asks for the blog URL. Secondary: *Paste the recipe text instead*.

- [ ] **Step 5: Add the remaining three** as the gate learns to name them: no caption at all · photo too dark to read · offline and queued. A wrong diagnosis is worse than a generic one, so each ships only once its reason is reliable.

- [ ] **Step 6: Add the third way out** — **Give up on this one** in the footer, so a dead end is never a trap.

- [ ] **Step 7: Do not mount BrowserAssist.** Miss stays one surface. `DomAimSheet` remains a later, separate plan whose precondition is Task 6 attaching `pack.html`.

- [ ] **Step 8: Run corpus + build. Step 9: Manual smoke** — a bait caption with a link in bio reaches Miss, names the cause, and pasting the blog URL completes the import.

- [ ] **Step 10: Commit message**

```
feat(import): Miss names the reason and asks for the one thing it needs

The recovery screen invited an edit and discarded it — setRecoveryText('')
then a re-run of the same URL against a cache written after a failed gate.
Sends the edited text through the engine instead, and uses the gate's
reason to ask for the right thing: a blog link when the caption is bait,
the caption when there is none, a re-shot photo when it was too dark.
```

---

## Part II definition of done

1. No engine word reaches the screen on any path — URL, photo, paste or transcribe.
2. The timeline renders, with the ring under the rail and the chip reading as provenance.
3. An import that succeeds says so — `Plated up.` — before Review opens.
4. Discard is reachable from Working, Miss and Review, by button and by back.
5. Kind is the only shelf control; the save button names where it lands.
6. Miss names its reason and pre-focuses the matching field; the edited text is used.
7. `npm run build` clean; `npm run test:corpus` green; full suite no worse than the 11 pre-existing.
