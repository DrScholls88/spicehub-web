# Whisper / ASR Import Reliability — Implementation Plan
**Date:** 2026-07-20
**Source doc:** `Whisper Implement2.md` (verdict against current code)
**Goal:** reliability and trust improvements to the existing import engine. No rebuild, no engine swap.

## Verdict on the source doc

Checked every claim against the live code. It's accurate. Key confirmations:

- `transcribeVideoForRecipe()` (`src/recipeParser.js:5524`) exists, works, and its own docstring says it "can be wired into `importFromInstagram` as a fallback" — it currently isn't. It's only called from `ImportSheet.jsx` (lines 423, 656) as a **manual** "Transcribe Video" button after a failed import, never automatically.
- `importFromInstagram`'s Phase E.3 empty-caption exit (`src/recipeParser.js:5290-5307`) returns `_needsManualCaption` **before** any ASR is attempted. Confirmed.
- `captionToRecipe()` already accepts a `transcript` param (`src/recipeParser.js:1487`) and merges it into the ContextPack via `packFromCaption` — the plumbing to accept a transcript is already built. Confirmed. This makes the P0 fix smaller than it sounds.
- `progressMap.js:48,96` already has a "Video audio" chip. Confirmed, no new UI plumbing needed there.
- `whisperWorker.js:66` loads `@huggingface/transformers` from `cdn.jsdelivr.net` at runtime — not in `package.json` dependencies. Confirmed CDN-only.
- `ReExtractSheet.jsx` only re-runs on the *stored caption* (line 217 comment) — no "re-run with audio" option exists yet. Confirmed gap.
- No model-tier picker exists anywhere in `ImportSheet.jsx` — always defaults to `base`. Confirmed gap.
- TikTok/generic video imports go through a **different** path — `tryVideoExtraction()` (`src/recipeParser.js:2572`), which calls `/api/extract-video` for yt-dlp subs only and never calls `transcribeFromUrl`. Same gap as Instagram, separate code path.

One thing the source doc didn't check, which changes the P0 implementation: **the outer import timeout.**

## The risk the doc missed

`importRecipeFromUrl()` wraps the whole import in a 45s race (`recipeParser.js:3142-3148`). `transcribeFromUrl()`'s server tier alone allows up to 90s (`transcriptionService.js:135`), then a browser-Whisper fallback on top of that. If ASR is wired into the cascade naively, the outer 45s race will fire first on any real transcription, silently discarding the in-flight work and returning the timeout stub — the user sees the same "needs manual caption" result as today, just slower and with a wasted transcription running in the background. This has to be solved *before* the ASR call is wired in, or P0 will ship with no visible effect.

## Non-goals (explicitly out of scope, per the doc and the constitution)

- No server `faster-whisper` / GPU worker (only revisit if metrics show browser Whisper is the bottleneck).
- No Instaloader / session-auth scraping.
- No Mealie/Paprika bulk migration tooling.
- No Grok re-enable.
- No replacing fuzzy matching with fuse.js.
- Nothing here touches Dexie schema, the offline queue, or the service worker.

---

## Phase 0 — Prerequisite: budget reconciliation

**Do this first.** Without it, Phase 1 is dead code under load.

Give video-ASR attempts their own budget instead of sharing the general 45s import race:
- In `importFromInstagram`, when the ASR branch (below) triggers, race `transcribeFromUrl` against its own ~40s cap (leaving headroom inside a raised outer ceiling), not the shared 45s.
- Raise `importRecipeFromUrl`'s `TIMEOUT_MS` only for the video-detected + weak-caption case (e.g. 80–90s), or restructure so `_importRecipeFromUrlInner` can request a longer budget when it knows it's about to attempt ASR. Simplest: pass an optional `budgetMs` through `importFromInstagram`'s options and have `importRecipeFromUrl` pick the larger of 45s / that value.
- Surface this to the user: when ASR kicks in, `progress()` should say something like "Transcribing audio — this can take up to a minute" so a longer wait doesn't feel broken.

**Files:** `recipeParser.js` (`importRecipeFromUrl`, `_importRecipeFromUrlInner`, `importFromInstagram`)
**Effort:** small · **Risk:** low if scoped to the new branch only — existing fast paths keep their 45s.

---

## Phase 1 (P0) — Wire ASR into the Instagram acquire cascade

Replace the Phase E.3 early-exit with a routing decision:

```
subs/videoRecipe already has content?     → use it (unchanged)
caption strong?                            → structurePack (unchanged)
caption weak + URL is a video (reel/tv)?  → transcribeFromUrl → merge as transcript → structurePack
still weak/no transcript?                  → existing manual-caption exit (unchanged)
```

Concretely, in `importFromInstagram` right before the current E.3 block (`recipeParser.js:5290`):
1. Detect video post (reel/tv URL pattern, already used at line 5220: `/\/(p|reel|tv)\//`).
2. If weak caption + video + no usable `videoRecipe` transcript yet, call `transcribeFromUrl(url, { onProgress, signal })` under the Phase 0 budget.
3. On success, don't return the exit stub — fall through to the existing `captionToRecipe(textForGemini, { ..., transcript: <whisper text> })` call (line 5333), which already knows how to merge a transcript. This is almost entirely reuse of the existing `igTranscriptForPack` pattern at lines 5325-5332, just sourcing from Whisper instead of only `videoRecipe._hasSubtitles`.
4. On failure/timeout, fall through to the existing manual-caption exit unchanged — no regression for cases that fail today.
5. Tag the result: `recipe._transcriptSource = transcription.extractedVia` (mirrors what `transcribeVideoForRecipe` already does at line 5551) so downstream trust UI (Phase 3) can show it.

Apply the same pattern to `tryVideoExtraction` (`recipeParser.js:2572`, the TikTok/generic path) as a **separate, follow-up PR** — same shape, but land Instagram first, verify it's stable, then port. Don't do both in one PR; the constitution's "build incrementally, never full rewrites" cuts against a single sweeping change across two independently-tested cascades.

**Files:** `recipeParser.js` (`importFromInstagram`), later `tryVideoExtraction`
**Effort:** medium · **Deps:** none new · **Risk:** medium (touches the keystone import path) — mitigated by falling through to unchanged behavior on any failure, and by the existing pack→legacy fallback already in `captionToRecipe`.

---

## Phase 2 (P1) — Pin browser Whisper as a real dependency

- Add `@huggingface/transformers` to `package.json` dependencies (pin the same v3 major currently pulled from the jsdelivr CDN in `whisperWorker.js:66`).
- Change the dynamic import in `whisperWorker.js` to import from the package instead of the CDN URL.
- Why this matters for *this* project specifically: SpiceHub is offline-first and installable — a CDN fetch at first-use is a silent single point of failure for an installed PWA on a flaky connection, which cuts against the constitution's offline-sovereignty principle even though Whisper itself isn't in the critical offline path.
- Verify the bundled model loading still works from `vite build` output (Transformers.js lazy-loads model weights separately from the JS bundle regardless, so this shouldn't meaningfully change bundle size — worth confirming with a build, not assuming).

**Files:** `package.json`, `src/workers/whisperWorker.js`
**Effort:** small · **Risk:** low, but verify build output before merging.

---

## Phase 3 (P1) — Trust loop in ImportReview / ReExtractSheet

- `ImportReview.jsx` already has an engine-label chip (`engineLabel(recipe._structuredVia)`, line 571) and a confidence chip. Extend the label logic to recognize `_transcriptSource` (set in Phase 1) so the badge reads e.g. "Gemini + Whisper transcript" instead of just the structuring engine.
- `ReExtractSheet.jsx` currently only re-runs on `meal.sourceCaption` (line 217). Add a second action, gated on the recipe having a video `sourceUrl` and low confidence: "Re-run with audio" → calls `transcribeVideoForRecipe(meal.sourceUrl, ...)` (already exists, already wired for the manual ImportSheet flow) and offers the same accept/reject diff `ReExtractSheet` already does for caption re-runs.
- No new component needed — this reuses existing diff/accept UI, just adds a second trigger and a new data source.

**Files:** `ImportReview.jsx`, `ReExtractSheet.jsx`
**Effort:** medium · **Risk:** low — additive UI on top of existing, tested re-run flow.

---

## Phase 4 (P1) — Model tier toggle

- Expose `WHISPER_MODELS` (`transcriptionService.js:22`, already has `tiny`/`base`/`small` with labels) as a picker in `ImportSheet.jsx`'s transcription-triggered UI: default `base`, offer `small` as "Best accuracy (slower)".
- Persist the choice (localStorage or a settings field) so it doesn't reset every import.

**Files:** `ImportSheet.jsx`, possibly a small settings addition
**Effort:** small · **Risk:** low, UI-only.

---

## Phase 5 (P1, lower priority) — Alias failure logging

- Where ingredients resolve with `method: 'none'` (already a recognized state — see `recipeSchema.js`, `ImportReview.jsx`, `ingredientNormalizer.js`), log the raw ingredient string to a Dexie table or a simple export list instead of only surfacing it in-session.
- This is a data-collection change, not a matching-algorithm change — the fuzzy/normalizer logic is confirmed adequate; the lever is corpus growth, not more Levenshtein math (matches the source doc's read).
- Manual weekly review of the export remains a human step — no auto-alias-generation in this phase.

**Files:** `ingredientNormalizer.js`, wherever `method: 'none'` currently surfaces in `ImportReview.jsx`
**Effort:** small · **Risk:** low.

---

## Deferred / only-if-metrics-say-so

- **Server `faster-whisper` sidecar** — only if telemetry shows browser Whisper is consistently the bottleneck (slow devices, long videos). `ASR_ENDPOINT` env var already exists as the hook; no client changes needed if this happens later.
- **Gemini multimodal spike** (send video/frames directly instead of Whisper→text) — worth a 20-Reel A/B eventually, not blocking.
- **Instaloader/session auth** — only if Apify/oEmbed rate-limiting becomes the dominant failure mode (would need to check current failure telemetry first; not currently instrumented).

---

## Suggested sequencing

1. Phase 0 (budget reconciliation) — ships invisibly, unblocks everything else.
2. Phase 1 (Instagram ASR wiring) — the actual quality jump, ship and soak before touching TikTok.
3. Phase 2 (pin dependency) — independent, can land anytime, do it early since it's low-risk.
4. Phase 3 + 4 (trust UI + model toggle) — after Phase 1 is confirmed stable in real imports, since they depend on `_transcriptSource` existing on real data.
5. Phase 5 (alias logging) — anytime, fully independent.
6. TikTok port of Phase 1 — once Instagram version has proven out.

## Testing plan (Windows)

Per constitution: full-output enforcement, `npm run build` clean before any commit suggestion, Windows terminal only.

```
npm run build
npm run lint
npm test
npm run test:corpus
```

Manual pass (Windows browser, since Whisper/worker/audio-decode behavior doesn't fully surface in vitest/jsdom):
- A known weak-caption Reel (spoken-only recipe, thin/no caption) — confirm it now returns a structured recipe instead of `_needsManualCaption`.
- A strong-caption post — confirm identical behavior to today (no ASR triggered, no timeout change).
- A Reel where ASR times out or the server is unreachable — confirm graceful fallback to today's manual-caption exit, not a hang or a bad silent state.
- ImportReview on an ASR-derived recipe — confirm the engine badge reflects the transcript source.
- ReExtractSheet "Re-run with audio" on a low-confidence saved recipe.
- Offline: confirm the app still installs/launches with `@huggingface/transformers` as a pinned dependency (Phase 2) — no new runtime CDN dependency introduced.

## Conventional commits (for manual `git` — not run by Claude, per constitution)

```
git add src/recipeParser.js
git commit -m "fix(import): reconcile ASR timeout budget ahead of transcription wiring"

git add src/recipeParser.js
git commit -m "feat(import): run Whisper transcription before empty-caption exit on Instagram video posts"

git add package.json src/workers/whisperWorker.js
git commit -m "chore(whisper): pin @huggingface/transformers as a dependency instead of CDN import"

git add src/components/ImportReview.jsx src/components/ReExtractSheet.jsx
git commit -m "feat(import): surface transcript source in review UI and add re-run-with-audio action"

git add src/components/ImportSheet.jsx
git commit -m "feat(import): add Whisper model tier toggle (base/small)"

git add src/utils/ingredientNormalizer.js
git commit -m "feat(grocery): log unresolved ingredient matches for alias corpus growth"
```
