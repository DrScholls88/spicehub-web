# Photo Import CSP Cascade — Fix Design Spec

**Date:** 2026-07-07
**Status:** Approved for planning
**Evidence:** `PhotoImportErrors.md` (captured prod console log)
**Relates to:** `2026-07-02-photo-import-design.md` (the pipeline this fixes)

## Summary

Photo/document import fails on every attempt in production. The pipeline logic
is correct; it is broken by the app's Content Security Policy. A single strict
CSP (defined identically in `index.html` and `vercel.json`) disables all three
transcription tiers in a cascade, plus the image compressor relies on
`fetch()`ing `data:` URLs which the CSP forbids. The fix keeps the CSP strict
and changes the code to operate within it — preserving both the security posture
and the offline-first guarantee.

## Evidence → cause mapping (no speculation)

The CSP in force:

```
default-src 'self'; script-src 'self';
img-src 'self' data: blob: https:; media-src 'self' data: blob: https:;
connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; …
```

Each failure in `PhotoImportErrors.md` maps to a directive:

1. **Compressor blocked (log L13–19).** `compressImageUrl()` in
   `src/imageCompressor.js` calls `fetch(imageUrl, { mode: 'cors' })`. In the
   photo path `imageUrl` is a `data:` URL. `connect-src 'self' https: wss:` does
   not list `data:`, so the fetch is blocked (`[ImageCompressor] Failed to
   fetch/compress`). `prepPageForUpload` catches this and returns the **original,
   uncompressed** camera image.
2. **Online vision tiers fail — HTTP 429 (log confirmed).** `connect-src` allows
   `https:`, so CSP does not block the Gemini/Mistral calls. The failure is a
   `429 Too Many Requests` from
   `gemini-2.0-flash-lite:generateContent` → `[PhotoImport] Gemini tier failed:
   Gemini vision HTTP 429`. This is a direct consequence of link 1: because the
   image was never downscaled, the pipeline sends a full-resolution multi-MB
   photo as inline base64. Vision APIs bill images as a large input-token count,
   so a single uncompressed photo can exceed the free-tier **per-minute token
   quota (TPM)** on the first request — which is why tiny-payload text/link
   import never 429s but every photo does. The log also shows the Mistral tier
   then failed (`All online tiers failed`); its reason was `console.warn`'d and
   not captured, so this spec surfaces it (429 as well, or a request-shape error).
3. **Tesseract fallback dead (log L37–41, L47).** tesseract.js loads its worker
   from `https://cdn.jsdelivr.net/...worker.min.js`. `script-src 'self'` and
   `worker-src 'self' blob:` block it → `failed to load … worker.min.js`. Tier 3
   cannot run at all.
4. **User-visible result (log L43):** `PhotoImportError: couldn't read a recipe`.

Text/link import is unaffected because it fetches `https:` sources, which
`connect-src` permits. That is why links work while photos never do.

## Decision

Fix the code to live within the strict CSP; do **not** loosen the CSP. Rationale:
adding `data:` to `connect-src` and the jsdelivr CDN to `script-src` would weaken
the policy, retain a network dependency, and leave on-device OCR non-functional
offline — all in conflict with the constitution's Security-First and Offline
Sovereignty principles.

## Design

### Component 1 — `src/imageCompressor.js`: decode `data:`/`blob:` without fetch

`compressImageUrl` must not `fetch()` a `data:` (or `blob:`) URL. Detect those
schemes and route them directly into the existing canvas path, which is
CSP-legal because `img-src` allows `data: blob:`.

- If `imageUrl` starts with `data:` — decode straight via an `Image` element into
  the existing `compressBlob` canvas logic (or a shared `compressFromImageSrc`
  helper), skipping `fetch`/`blob()` entirely.
- If `imageUrl` starts with `blob:` — same direct-decode path.
- Otherwise (`http(s):`) — keep the current `fetch` path unchanged.

Acceptance: `compressImageUrl('data:image/png;base64,…')` resolves to a
downscaled data URL with no network request. Existing `http(s)` callers behave
identically.

Effect: `prepPageForUpload` now yields a ~1280px JPEG, so online vision tiers
receive a sane payload — expected to resolve failure link 2.

### Component 2 — self-host Tesseract worker + core + language data

tesseract.js 5.1.1 and tesseract.js-core are already installed; the dist assets
exist locally (`node_modules/tesseract.js/dist/worker.min.js`,
`node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm`). Serve them from
the same origin and point Tesseract at them so nothing loads from a CDN.

- Copy into `public/tesseract/` at build (a `prebuild`/`postinstall` copy step or
  committed vendored assets): `worker.min.js`, the core `.wasm` (+ its `.js`
  loader), and `eng.traineddata.gz` (fetch/vendor the tessdata_fast `eng` file;
  it is not in node_modules).
- In `transcribeWithTesseract` (`src/lib/photoImportEngine.js`) pass explicit
  same-origin paths:

  ```js
  Tesseract.recognize(canvas, 'eng', {
    workerPath: '/tesseract/worker.min.js',
    corePath:   '/tesseract/',          // dir; tesseract picks simd/non-simd
    langPath:   '/tesseract/',          // serves eng.traineddata.gz
    logger: …,
  });
  ```

Acceptance: on-device OCR runs with CSP `script-src 'self'` / `worker-src 'self'
blob:` and works with the network offline. No request to jsdelivr.

### Component 3 — 429 / rate-limit handling + honest errors

The confirmed online failure is `429 Too Many Requests`. Component 1 is expected
to greatly reduce it (compressed images cut input tokens ~10–50×), but a genuinely
exhausted free-tier quota can still 429. Handle it explicitly instead of
collapsing into the generic "couldn't read a recipe."

- **Detect + surface.** In `transcribeWithGemini` / `transcribeWithMistral`: on
  `!res.ok`, read the response body (`await res.text()`, truncate ~300 chars) and
  attach `err.status` + `err.detail`. Parse `Retry-After` and the Gemini
  `RetryInfo` (`retryDelay`) when present into `err.retryAfterMs`.
- **Backoff, one retry.** On a 429 from a tier, wait the smaller of
  `retryAfterMs` and a cap (e.g. 3s) and retry that tier once before moving on.
  Keep the whole thing inside the existing 45s budget and honor `signal`.
- **Fall through, then report.** Gemini 429 → Mistral (existing behavior; verify
  it actually runs). If all online tiers 429/fail, propagate the real reason:
  set `recipe._visionError = { engine, status, detail }` on any Tesseract-draft
  result, and when nothing is readable throw a `PhotoImportError('rate-limited',
  …)` with a specific message ("Recipe photo reading is busy right now — try
  again in a moment, or paste the text") distinct from `nothing-readable`.
- **UI.** `ImportSheet` shows the specific rate-limit message on the
  `'rate-limited'` code, and a one-line "Used on-device OCR — vision failed:
  <reason>" when a draft carries `_visionError`. No more silent degradation.
- **Offline queue tie-in (reuse, don't build new).** A 429 is transient, so the
  existing offline photo re-extract queue (`db.js` photo-upgrade branch) is the
  natural retry home: on `rate-limited`, offer "retry later" which enqueues the
  stored compressed pages for a background re-run rather than forcing an immediate
  re-hit of the quota.

### Component 4 — CSP source-of-truth cleanup

The CSP string is duplicated in `index.html` (meta) and `vercel.json` (header),
and the meta copy emits a harmless `frame-ancestors is ignored in <meta>` warning
(log L33–36). Keep both byte-identical; if divergence risk is a concern, drop the
`<meta>` CSP and keep the `vercel.json` header as the single source (the header
form supports `frame-ancestors`). No directive values change in this fix.

## Out of scope (separate specs)

- `/api/vision` server-side proxy to move `VITE_GOOGLE_AI_KEY` out of the client
  bundle (latent security gap; the client key currently works). When built, it
  must read the correctly-named Vercel var `GOOGLE_GENERATIVE_AI_API_KEY` — note
  `api/structure.js` currently reads `GOOGLE_AI_KEY`, which is unset in this
  project, so its server fallback is dead code today.
- Vision request-shape hardening (role/responseSchema, Mistral `image_url` object
  form) — only pursue if Component 3 surfaces a shape error after Component 1.
- Prompt optimization (separate `2026-07-07-import-prompt-optimization-design.md`).

## Testing plan

1. `npm run build` — clean, no errors (constitution requirement).
2. Unit: `compressImageUrl` on a `data:` URL performs no fetch and returns a
   smaller data URL; `http(s)` path unchanged.
3. Unit: `transcribeWithGemini`/`Mistral` attach `status`+`detail` on non-OK and
   `retryAfterMs` on 429; a 429 triggers exactly one backoff-retry then
   fall-through; `_visionError` propagates to the returned recipe on fallback;
   an all-tiers-429 outcome throws `PhotoImportError('rate-limited', …)`.
4. Manual (production build, since `VITE_GOOGLE_AI_KEY` is Production-only):
   single camera photo, gallery multi-select, and a PDF — verify a real recipe
   lands in review with a dish photo, and confirm the DevTools console shows no
   CSP violations.
5. Offline manual: airplane mode → confirm self-hosted Tesseract produces a draft
   (no jsdelivr request, no CSP block) and the `_visionError`/draft badge shows.

## Conventional Commit (suggestion — user commits manually)

```
fix(photo-import): resolve CSP cascade breaking all transcription tiers

- imageCompressor: decode data:/blob: URLs via canvas instead of fetch()
  (connect-src forbids data:), so pages downscale before vision upload —
  cutting per-request input tokens that were tripping the Gemini 429
- tesseract: self-host worker + core wasm + eng.traineddata under
  /tesseract and pass workerPath/corePath/langPath (script-src 'self',
  offline-capable) instead of loading worker.min.js from jsdelivr
- photoImportEngine: capture vision HTTP status+body + Retry-After, back
  off once on 429, propagate _visionError and a distinct 'rate-limited'
  error instead of silent degradation to OCR
- csp: keep index.html and vercel.json policies in sync

No CSP directives loosened. Fixes photo/document import in production.
```
