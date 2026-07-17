/**
 * photoImportEngine.js — Tiered, zero-cost visual recipe importer.
 *
 * Spec: docs/superpowers/specs/2026-07-02-photo-import-design.md
 *
 * Pipeline (importRecipeFromPages):
 *   Stage 1  Preprocess   — downscale/compress every page before upload;
 *                           originals kept for dish-photo cropping.
 *   Stage 2  Transcribe   — Tier 1: Gemini vision (all pages, ONE call).
 *                           Tier 2: Mistral Pixtral (same JSON contract).
 *                           Tier 3: on-device Tesseract.js (offline draft).
 *   Stage 3  Structure    — joined transcript → captionToRecipe() → the
 *                           existing Gemini structuring engine, deterministic
 *                           post-processor, and normalizer. Untouched.
 *   Stage 4  Dish photo   — crop the vision-detected food photo out of the
 *                           original page for the recipe card image.
 *
 * All network tiers share one JSON contract:
 *   {
 *     "pages":       [{ "transcript": "..." }, …]   // one per input page
 *     "dishPhoto":   { "page": 1, "box": [ymin, xmin, ymax, xmax] } | null
 *     "contentType": "recipe" | "menu" | "dish-photo" | "other"
 *   }
 * Box coordinates are normalized 0–1000 (Gemini convention), page is 1-based.
 *
 * No silent nulls: failures throw PhotoImportError with a .code the UI can
 * message on, and every tier transition is reported through onProgress.
 */

import { captionToRecipe, parseCaption } from '../recipeParser.js';
import { compressImageUrl } from '../imageCompressor.js';

// ── Tunables ────────────────────────────────────────────────────────────────
export const MAX_PAGES = 10;
const UPLOAD_MAX_EDGE = 1280;   // px, longest edge sent to vision APIs
const UPLOAD_QUALITY = 0.8;
const DISH_PHOTO_MAX_EDGE = 800;
const VISION_TIMEOUT_MS = 45000; // matches the import engine's global budget
const MIN_TRANSCRIPT_CHARS = 15;
export const PAGE_SEPARATOR = '\n\n--- page break ---\n\n';

// Dish-photo sanity gates (spec §1 stage 4)
const CROP_MIN_AREA_RATIO = 0.15; // crop must cover ≥15% of the page
const CROP_MIN_ASPECT = 0.4;      // w/h
const CROP_MAX_ASPECT = 2.5;

// ── Errors ──────────────────────────────────────────────────────────────────
export class PhotoImportError extends Error {
  /**
   * @param {string} code    'no-pages' | 'nothing-readable' | 'aborted' |
   *                         'structure-failed' | 'rate-limited'
   * @param {string} message user-facing message
   */
  constructor(code, message) {
    super(message);
    this.name = 'PhotoImportError';
    this.code = code;
  }
}

// ── Env helpers ─────────────────────────────────────────────────────────────
function env(key) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || null;
}

const GEMINI_KEY = () => env('VITE_GOOGLE_AI_KEY');
const GEMINI_VISION_MODEL = () => env('VITE_GEMINI_VISION_MODEL') || 'gemini-2.0-flash-lite';
const MISTRAL_KEY = () => env('VITE_MISTRAL_API_KEY');
const MISTRAL_MODEL = () => env('VITE_MISTRAL_MODEL') || 'pixtral-12b-latest';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * parseVisionContract — tolerant parser for the shared vision JSON contract.
 * Accepts raw model output that may be wrapped in markdown fences or have
 * leading/trailing prose. Returns a validated contract object or null.
 */
export function parseVisionContract(rawText, expectedPageCount = 1) {
  if (!rawText || typeof rawText !== 'string') return null;
  let text = rawText.trim();

  // Strip markdown fences (```json … ``` or ``` … ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  // Fall back to the first balanced {...} block
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    if (start === -1) return null;
    text = text.slice(start);
  }
  // Trim trailing prose after the final closing brace
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace === -1) return null;
  text = text.slice(0, lastBrace + 1);

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    // Null bytes / control chars occasionally leak from models — sanitize once.
    try {
      // eslint-disable-next-line no-control-regex
      obj = JSON.parse(text.replace(new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g'), ''));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  // pages — coerce into [{transcript}] and pad/trim to the expected count so a
  // model that merges pages doesn't break downstream indexing.
  let pages = Array.isArray(obj.pages) ? obj.pages : [];
  pages = pages
    .map((p) => ({ transcript: typeof p?.transcript === 'string' ? p.transcript.trim() : '' }))
    .slice(0, Math.max(expectedPageCount, 1));
  while (pages.length < expectedPageCount) pages.push({ transcript: '' });

  // dishPhoto — validate shape; anything off → null (never throw)
  let dishPhoto = null;
  const dp = obj.dishPhoto;
  if (dp && typeof dp === 'object' && Array.isArray(dp.box) && dp.box.length === 4) {
    const box = dp.box.map(Number);
    const page = Number(dp.page);
    const inRange = box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000);
    const ordered = box[0] < box[2] && box[1] < box[3];
    if (inRange && ordered && Number.isFinite(page) && page >= 1 && page <= expectedPageCount) {
      dishPhoto = { page, box };
    }
  }

  const contentType = ['recipe', 'menu', 'dish-photo', 'other'].includes(obj.contentType)
    ? obj.contentType
    : 'recipe';

  return { pages, dishPhoto, contentType };
}

/**
 * joinPageTranscripts — merge per-page transcripts into one caption for the
 * structuring engine, skipping empty pages. Returns '' when nothing readable.
 */
export function joinPageTranscripts(pages) {
  if (!Array.isArray(pages)) return '';
  return pages
    .map((p) => (typeof p?.transcript === 'string' ? p.transcript.trim() : ''))
    .filter(Boolean)
    .join(PAGE_SEPARATOR);
}

/**
 * computeCropRect — convert a normalized 0–1000 [ymin, xmin, ymax, xmax] box
 * into pixel source rect for canvas cropping, applying the sanity gates.
 * Returns { sx, sy, sw, sh } or null when the box fails a gate.
 */
export function computeCropRect(box, imgWidth, imgHeight) {
  if (!Array.isArray(box) || box.length !== 4 || !imgWidth || !imgHeight) return null;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return null;
  if (!(ymin < ymax && xmin < xmax)) return null;

  const sx = Math.max(0, Math.round((xmin / 1000) * imgWidth));
  const sy = Math.max(0, Math.round((ymin / 1000) * imgHeight));
  const sw = Math.min(imgWidth - sx, Math.round(((xmax - xmin) / 1000) * imgWidth));
  const sh = Math.min(imgHeight - sy, Math.round(((ymax - ymin) / 1000) * imgHeight));
  if (sw <= 0 || sh <= 0) return null;

  const areaRatio = (sw * sh) / (imgWidth * imgHeight);
  const aspect = sw / sh;
  if (areaRatio < CROP_MIN_AREA_RATIO) return null;
  if (aspect < CROP_MIN_ASPECT || aspect > CROP_MAX_ASPECT) return null;

  return { sx, sy, sw, sh };
}

/** cleanOcrText — scrub common Tesseract artifacts (ported from AddEditMeal). */
export function cleanOcrText(text) {
  return String(text || '')
    .replace(/\bl\b(?=\s*cup)/gi, '1')
    .replace(/\|/g, 'l')
    .replace(/  +/g, ' ')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 2) return false;
      const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
      return alphaCount > trimmed.length * 0.3;
    })
    .join('\n');
}

// ── Canvas helpers ──────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

/** Downscale a data URL for upload. Falls back to the original on failure. */
async function prepPageForUpload(dataUrl) {
  try {
    const compressed = await compressImageUrl(dataUrl, {
      maxWidth: UPLOAD_MAX_EDGE,
      maxHeight: UPLOAD_MAX_EDGE,
      quality: UPLOAD_QUALITY,
      format: 'image/jpeg',
    });
    return compressed || dataUrl;
  } catch {
    return dataUrl;
  }
}

/**
 * cropDishPhotoFromPage — crop the detected food photo out of the ORIGINAL
 * (full-resolution) page and return a card-sized JPEG data URL, or null when
 * the box fails the sanity gates or canvas work fails.
 */
export async function cropDishPhotoFromPage(pageDataUrl, box) {
  try {
    const img = await loadImage(pageDataUrl);
    const rect = computeCropRect(box, img.naturalWidth, img.naturalHeight);
    if (!rect) return null;

    const scale = Math.min(1, DISH_PHOTO_MAX_EDGE / Math.max(rect.sw, rect.sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.sw * scale));
    canvas.height = Math.max(1, Math.round(rect.sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('[PhotoImport] dish-photo crop failed:', err);
    return null;
  }
}

/**
 * cropRegionFromPage — manual-crop variant used by DishPhotoCropper. Takes a
 * normalized 0–1 rect { x, y, w, h } and applies NO sanity gates (the human
 * is the sanity gate).
 *
 * Optional `transforms` object:
 *   rotation   — 0 | 90 | 180 | 270 (CW degrees, applied to source BEFORE crop)
 *   flipH      — boolean (horizontal mirror)
 *   flipV      — boolean (vertical mirror)
 *   brightness — -100…100 (0 = no change)
 *   contrast   — -100…100 (0 = no change)
 */
export async function cropRegionFromPage(pageDataUrl, rect01, transforms) {
  try {
    const img = await loadImage(pageDataUrl);
    const rot = (transforms?.rotation || 0) % 360;
    const swapped = rot === 90 || rot === 270;
    // After rotation the logical image dimensions may swap.
    const srcW = swapped ? img.naturalHeight : img.naturalWidth;
    const srcH = swapped ? img.naturalWidth  : img.naturalHeight;

    const sx = Math.max(0, Math.round(rect01.x * srcW));
    const sy = Math.max(0, Math.round(rect01.y * srcH));
    const sw = Math.min(srcW - sx, Math.round(rect01.w * srcW));
    const sh = Math.min(srcH - sy, Math.round(rect01.h * srcH));
    if (sw <= 2 || sh <= 2) return null;

    const scale = Math.min(1, DISH_PHOTO_MAX_EDGE / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    // Step 1: draw source with rotation + flip onto a full-size scratch canvas.
    const scratch = document.createElement('canvas');
    scratch.width  = srcW;
    scratch.height = srcH;
    const sctx = scratch.getContext('2d');
    sctx.save();
    // Move origin to centre, rotate, flip, then draw.
    sctx.translate(srcW / 2, srcH / 2);
    if (rot) sctx.rotate((rot * Math.PI) / 180);
    if (transforms?.flipH) sctx.scale(-1, 1);
    if (transforms?.flipV) sctx.scale(1, -1);
    // After rotation the image's natural w/h are swapped relative to the canvas.
    sctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    sctx.restore();

    // Step 2: crop region from scratch → output canvas.
    const canvas = document.createElement('canvas');
    canvas.width  = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(scratch, sx, sy, sw, sh, 0, 0, outW, outH);

    // Step 3: brightness / contrast via pixel manipulation.
    const bri = transforms?.brightness || 0;
    const con = transforms?.contrast   || 0;
    if (bri !== 0 || con !== 0) {
      const imageData = ctx.getImageData(0, 0, outW, outH);
      const d = imageData.data;
      const factor = (259 * (con + 255)) / (255 * (259 - con));
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let v = d[i + c] + bri;
          v = factor * (v - 128) + 128;
          d[i + c] = Math.max(0, Math.min(255, Math.round(v)));
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('[PhotoImport] manual crop failed:', err);
    return null;
  }
}

/** Grayscale + contrast preprocessing for Tesseract (ported from AddEditMeal). */
async function preprocessForOCR(dataUrl) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const TARGET_WIDTH = 2500;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > TARGET_WIDTH || w < 800) {
    const scale = TARGET_WIDTH / w;
    w = TARGET_WIDTH;
    h = Math.round(h * scale);
  }
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * 1.5 + 128));
      data[i] = adjusted;
      data[i + 1] = adjusted;
      data[i + 2] = adjusted;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch {
    /* tainted canvas or huge image — OCR the unprocessed draw instead */
  }
  return canvas;
}

// ── Vision prompt ───────────────────────────────────────────────────────────

function buildVisionPrompt(pageCount) {
  return `You are given ${pageCount} page image${pageCount === 1 ? '' : 's'} of recipe content (cookbook page, recipe card, menu board, handwritten note, bar/cocktail card, or website screenshot). Pages are in reading order.

For EACH page, transcribe ALL text as faithfully as possible:
- Preserve line breaks, section headers (like "Ingredients:", "For the sauce:"), bullet points, numbered steps, quantities, and measurements exactly as written.
- If handwritten, read every word you can; mark unreadable words as [?].
- If a page shows only a plated dish with no text, transcribe nothing for it.
- If the content is a menu board, transcribe each item name and description.

Cocktail/bar cards need extra care — they use conventions that are easy to misread or drop:
- Fraction glyphs are common in measurements (¾ oz, 1¼ oz, ½ oz); transcribe the exact glyph or its plain-text equivalent, never round it off.
- Ratio shorthand (e.g. "2:1:1", "3:2:1") describes proportions of the ingredients listed nearby, in order — transcribe it verbatim on its own line near those ingredients rather than dropping it.
- Bar abbreviations to preserve exactly: oz, dash, splash, bs/barspoon, top/float, rinse, neat, up, rocks.
- Many cards list ingredients as "Name — amount" (name first, amount right-aligned) rather than "amount name" — transcribe each ingredient line in whatever order it actually appears, don't silently reorder to amount-first.
- Glassware (coupe, rocks/old-fashioned, highball, martini, copper mug) and garnish (twist, cherry, mint sprig, salt/sugar rim) are often set apart from the main ingredient list — a small icon, a line at the bottom, or a separate column. Transcribe these as their own line(s) even if visually separated, don't fold them into ingredients or drop them.
- Method terms (shake, stir, build, muddle, strain, double-strain, dry shake) are directions, not ingredients, even when they appear as a single word near the glass icon.

Also detect whether any page contains a PHOTOGRAPH of the finished dish or drink (not an illustration, not the text). If yes, report which page and its bounding box.

Return ONLY this JSON — no markdown, no explanation:
{
  "pages": [{ "transcript": "full text of page 1" }${pageCount > 1 ? ', … one object per page in order' : ''}],
  "dishPhoto": { "page": <1-based page number>, "box": [ymin, xmin, ymax, xmax] } or null if no dish photograph,
  "contentType": "recipe" | "menu" | "dish-photo" | "other"
}
Bounding box coordinates are integers normalized to 0-1000 relative to that page's dimensions.
Use contentType "dish-photo" only when the image is JUST a photo of food/drink with no recipe text.`;
}

// ── 429 / rate-limit handling ───────────────────────────────────────────────
// Shared by both online vision tiers (spec Component 3): on a non-OK response
// we read the body (truncated) and attach status/detail/retryAfterMs to the
// thrown error so the caller can report the REAL reason instead of a generic
// failure. A 429 specifically gets exactly one backoff-then-retry, bounded so
// the whole tier (original attempt + wait + retry) still fits inside the
// existing VISION_TIMEOUT_MS budget rather than doubling it.
const RETRY_WAIT_CAP_MS = 3000;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(_abortError()); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(_abortError()); }, { once: true });
  });
}

function _abortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/** Extract a retry delay in ms from a Retry-After header or Gemini's
 * RetryInfo `retryDelay` (e.g. "19s") in the response body. Returns null when
 * neither is present/parseable — callers fall back to a fixed cap. */
function parseRetryAfterMs(res, bodyText) {
  const header = res.headers?.get?.('Retry-After');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  if (bodyText) {
    const m = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
  }
  return null;
}

/**
 * fetchVisionTier — POST with one backoff-retry on 429. Both fetch attempts
 * share a single deadline (one withTimeout signal) so a retry can't push the
 * tier past its normal VISION_TIMEOUT_MS budget.
 */
async function fetchVisionTier(url, init, signal) {
  const requestSignal = withTimeout(signal, VISION_TIMEOUT_MS);
  let res = await fetch(url, { ...init, signal: requestSignal });

  if (res.status === 429) {
    const bodyText = await res.text().catch(() => '');
    const retryAfterMs = parseRetryAfterMs(res, bodyText);
    await sleep(Math.min(retryAfterMs ?? RETRY_WAIT_CAP_MS, RETRY_WAIT_CAP_MS), requestSignal);
    res = await fetch(url, { ...init, signal: requestSignal });
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Vision HTTP ${res.status}`);
    err.status = res.status;
    err.detail = bodyText.slice(0, 300);
    err.retryAfterMs = parseRetryAfterMs(res, bodyText);
    throw err;
  }
  return res;
}

// ── Adding a new online vision tier ─────────────────────────────────────────
// Every tier is a function `(uploadPages, { signal }) => Promise<contract>`
// that: (1) builds a provider-specific request from `uploadPages` (data URLs)
// + `buildVisionPrompt()`, (2) calls its own server route on /api/vision via
// `?provider=<name>` FIRST so the API key stays server-side, catching a proxy
// failure and falling back to a direct call with a client-side VITE_ key only
// when one is configured (see transcribeWithGemini/transcribeWithMistral for
// the pattern), (3) parses the response into the shared contract with
// `parseVisionContract(text, uploadPages.length)`, and (4) returns
// `{ ...contract, engine: '<name>' }`. Register it in `transcribePagesOnline`
// below (add a gate/attempt block) and add its endpoint+key branch to
// `resolveProviderRequest` in api/vision.js. Ollama (local, no proxy needed —
// call http://localhost:11434 directly) and OpenAI vision (proxy the same way
// as Mistral, Authorization: Bearer) are the likely next additions.

// ── Tier 1: Gemini (all pages, one call) ───────────────────────────────────

async function transcribeWithGemini(uploadPages, { signal } = {}) {
  const parts = uploadPages.map((dataUrl) => ({
    inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] || '' },
  }));
  parts.push({ text: buildVisionPrompt(uploadPages.length) });
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  });
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

  // Server proxy first — keeps the Gemini key out of the client bundle
  // (docs/superpowers/specs/2026-07-07-photo-import-csp-fix-design.md,
  // "Out of scope" §1). api/vision.js forwards status/body/Retry-After
  // untouched, so fetchVisionTier's 429 handling behaves the same either way.
  let res;
  try {
    res = await fetchVisionTier(`/api/vision?model=${GEMINI_VISION_MODEL()}`, init, signal);
  } catch (proxyErr) {
    if (proxyErr.name === 'AbortError') throw proxyErr;
    const key = GEMINI_KEY();
    if (!key) throw proxyErr; // no client fallback available — surface the proxy's reason
    console.warn('[PhotoImport] /api/vision proxy failed, falling back to client key:', proxyErr.message);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL()}:generateContent?key=${key}`;
    res = await fetchVisionTier(endpoint, init, signal);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const contract = parseVisionContract(text, uploadPages.length);
  if (!contract) throw new Error('Gemini vision returned an unparseable contract');
  return { ...contract, engine: 'gemini' };
}

// ── Tier 2: Mistral Pixtral (same contract) ─────────────────────────────────

async function transcribeWithMistral(uploadPages, { signal } = {}) {
  const content = uploadPages.map((dataUrl) => ({ type: 'image_url', image_url: dataUrl }));
  content.push({ type: 'text', text: buildVisionPrompt(uploadPages.length) });
  const body = JSON.stringify({
    model: MISTRAL_MODEL(),
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content }],
  });
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

  // Server proxy first — keeps the Mistral key out of the client bundle, same
  // as transcribeWithGemini's /api/vision path (this used to be a client-only
  // VITE_MISTRAL_API_KEY call, which shipped the key in the client bundle).
  let res;
  try {
    res = await fetchVisionTier('/api/vision?provider=mistral', init, signal);
  } catch (proxyErr) {
    if (proxyErr.name === 'AbortError') throw proxyErr;
    const key = MISTRAL_KEY();
    if (!key) {
      // No client-side key configured — without one there's no direct-call
      // fallback available, so whatever the proxy just said IS the entire
      // Mistral attempt. The client key is what signals "Mistral is actually
      // set up in this environment"; if it's absent, ANY proxy failure here
      // (a real outage, a missing server key, whatever shape the error takes)
      // must not be allowed to eclipse Gemini's tier-1 error — that's the
      // more meaningful signal when Mistral was never really in play.
      // (Previously this only recognized a specific 503/"no-server-key"
      // shape, which missed plain 500s and let a coincidental Mistral failure
      // mask a genuine Gemini error — see photoImportEngine.test.js "does not
      // fall back when no client key is configured".)
      proxyErr.notConfigured = true;
      throw proxyErr;
    }
    console.warn('[PhotoImport] /api/vision (mistral) proxy failed, falling back to client key:', proxyErr.message);
    const mistralInit = { ...init, headers: { ...init.headers, Authorization: `Bearer ${key}` } };
    res = await fetchVisionTier('https://api.mistral.ai/v1/chat/completions', mistralInit, signal);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  const contract = parseVisionContract(text, uploadPages.length);
  if (!contract) throw new Error('Mistral vision returned an unparseable contract');
  return { ...contract, engine: 'mistral' };
}

// ── Tier 3: Tesseract.js (on-device, always available) ─────────────────────

async function transcribeWithTesseract(pages, { onProgress } = {}) {
  const { default: Tesseract } = await import('tesseract.js');
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.('transcribe', `Reading page ${i + 1} of ${pages.length} on-device…`);
    try {
      const canvas = await preprocessForOCR(pages[i].dataUrl);
      const result = await Tesseract.recognize(canvas, 'eng', {
        // Self-hosted under public/tesseract/ (see docs/superpowers/specs/
        // 2026-07-07-photo-import-csp-fix-design.md Component 2). The CSP's
        // script-src 'self' / worker-src 'self' blob: block loading
        // worker.min.js from jsdelivr, so this must never load from a CDN —
        // that also makes on-device OCR work fully offline.
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/',
        langPath: '/tesseract/',
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onProgress?.(
              'transcribe',
              `Reading page ${i + 1} of ${pages.length}… ${Math.round((m.progress || 0) * 100)}%`,
            );
          }
        },
      });
      out.push({ transcript: cleanOcrText(result?.data?.text || '') });
    } catch (err) {
      console.warn(`[PhotoImport] Tesseract failed on page ${i + 1}:`, err);
      out.push({ transcript: '' });
    }
  }
  return { pages: out, dishPhoto: null, contentType: 'recipe', engine: 'tesseract' };
}

// ── Timeout helper — AbortSignal.any with a safe fallback ───────────────────

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal; // very old runtimes: honor the caller's signal, skip timeout
}

// ── Tiered transcription (online tiers only) ───────────────────────────────

/**
 * transcribePagesOnline — Tier 1 → Tier 2. Throws when both fail.
 * Exposed for the offline re-extract queue (db.js photo-upgrade branch).
 */
export async function transcribePagesOnline(uploadPages, { signal, onProgress } = {}) {
  let tier1Error = null;
  let tier2Error = null;
  // No more GEMINI_KEY() gate: transcribeWithGemini tries the /api/vision
  // server proxy first, which works even when no client key is configured
  // (the whole point of the proxy — see "Out of scope" §1 in
  // 2026-07-07-photo-import-csp-fix-design.md, now implemented).
  {
    onProgress?.('transcribe', `Reading ${uploadPages.length > 1 ? `${uploadPages.length} pages` : 'your photo'} with Gemini…`);
    try {
      return await transcribeWithGemini(uploadPages, { signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      tier1Error = err;
      tier1Error.engine = 'gemini';
      console.warn('[PhotoImport] Gemini tier failed:', err.message);
    }
  }
  // No more MISTRAL_KEY() gate: transcribeWithMistral tries the /api/vision
  // server proxy first too, which works even when no client key is configured
  // (mirrors the Gemini tier — see api/vision.js).
  {
    onProgress?.('transcribe', 'Gemini unavailable — trying Mistral…');
    try {
      return await transcribeWithMistral(uploadPages, { signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // Previously only console.warn'd and dropped — the caller had no way to
      // know Mistral's specific failure reason when it was the last tier
      // tried. Capture it the same way as tier 1 (spec Component 3).
      tier2Error = err;
      tier2Error.engine = 'mistral';
      console.warn('[PhotoImport] Mistral tier failed:', err.message);
    }
  }
  // Prefer the LAST tier's failure reason — it's the more recent/relevant one
  // — UNLESS Mistral was simply never configured (notConfigured): that's not
  // a real failure and shouldn't eclipse Gemini's actual error reason.
  const finalError = (tier2Error && !tier2Error.notConfigured ? tier2Error : null) || tier1Error || tier2Error || new Error('No online vision tier available');
  if (!finalError.engine) finalError.engine = 'vision';
  throw finalError;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * importRecipeFromPages — the one entry point for photo/document import.
 *
 * @param {Array<{dataUrl: string, source?: string}>} pages  in reading order
 * @param {object} opts
 * @param {'meal'|'drink'} [opts.type]
 * @param {(stage: string, message: string) => void} [opts.onProgress]
 *        stages: 'prep' | 'transcribe' | 'structure' | 'photo'
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} structured recipe (captionToRecipe shape) plus:
 *        sourceCaption, _visionEngine, _extractionSource, _ocrDraft,
 *        _dishPhotoBox, _scanPageCount, imageUrl/image, _imageStatus,
 *        _visionError (present only when cloud tiers failed before OCR ran)
 * @throws {PhotoImportError}
 */
export async function importRecipeFromPages(pages, { type = 'meal', onProgress, signal } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new PhotoImportError('no-pages', 'No pages to import.');
  }
  pages = pages.slice(0, MAX_PAGES);

  // Stage 1 — preprocess
  onProgress?.('prep', pages.length > 1 ? `Preparing ${pages.length} pages…` : 'Preparing your photo…');
  const uploadPages = [];
  for (const p of pages) {
    if (signal?.aborted) throw new PhotoImportError('aborted', 'Import cancelled.');
    uploadPages.push(await prepPageForUpload(p.dataUrl));
  }

  // Stage 2 — transcribe (tiered)
  let contract = null;
  // Set only when ALL online tiers failed — carries the real reason (spec
  // Component 3) so we can (a) tell a genuine 429 apart from truly unreadable
  // content below, and (b) attach it to a successful Tesseract-draft result
  // so the review UI can say why cloud reading didn't happen.
  let visionError = null;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (online) {
    try {
      contract = await transcribePagesOnline(uploadPages, { signal, onProgress });
    } catch (err) {
      if (err.name === 'AbortError') throw new PhotoImportError('aborted', 'Import cancelled.');
      console.warn('[PhotoImport] All online tiers failed — falling back to on-device OCR.');
      visionError = { engine: err.engine || 'vision', status: err.status ?? null, detail: err.detail || err.message || '' };
    }
  }
  if (!contract) {
    contract = await transcribeWithTesseract(pages, { onProgress });
  }
  if (signal?.aborted) throw new PhotoImportError('aborted', 'Import cancelled.');

  const transcript = joinPageTranscripts(contract.pages);
  const isDishPhotoOnly = contract.contentType === 'dish-photo';
  if (transcript.length < MIN_TRANSCRIPT_CHARS && !isDishPhotoOnly) {
    if (visionError?.status === 429) {
      throw new PhotoImportError(
        'rate-limited',
        'Recipe photo reading is busy right now — try again in a moment, or paste the text instead.',
      );
    }
    throw new PhotoImportError(
      'nothing-readable',
      "We couldn't read a recipe in " +
        (pages.length > 1 ? 'those pages' : 'that photo') +
        '. Try a brighter shot, fill the frame, or paste the text instead.',
    );
  }

  // Stage 3 — structure through the shared engine
  onProgress?.('structure', 'Organizing the recipe…');
  let recipe = null;
  const captionInput = isDishPhotoOnly && transcript.length < MIN_TRANSCRIPT_CHARS
    ? 'A photo of a finished dish with no visible recipe text.'
    : transcript;
  try {
    recipe = await captionToRecipe(captionInput, { type });
  } catch (err) {
    console.warn('[PhotoImport] captionToRecipe failed:', err);
  }

  // Offline / engine-down heuristic fallback so a Tesseract draft still lands
  // in review instead of dying (offline sovereignty).
  if (!recipe || (!recipe.name && !recipe.title && !(recipe.ingredients || []).length)) {
    const parsed = parseCaption(transcript);
    if (parsed && (parsed.ingredients?.length || parsed.directions?.length)) {
      recipe = {
        name: parsed.title && parsed.title !== 'Imported Recipe' ? parsed.title : '',
        title: parsed.title && parsed.title !== 'Imported Recipe' ? parsed.title : '',
        ingredients: parsed.ingredients || [],
        directions: parsed.directions || [],
        notes: '',
        type,
        confidence: 0.3,
        _structuredVia: 'heuristic',
      };
    }
  }
  if (!recipe || (!(recipe.ingredients || []).length && !(recipe.directions || []).length && !recipe.title && !recipe.name)) {
    throw new PhotoImportError(
      'structure-failed',
      'We read the text but couldn’t shape it into a recipe. Try the Text tab and paste it in.',
    );
  }

  // Stage 4 — dish photo
  let imageUrl = '';
  if (contract.dishPhoto) {
    onProgress?.('photo', 'Grabbing the dish photo…');
    const pageIdx = contract.dishPhoto.page - 1;
    if (pages[pageIdx]) {
      imageUrl = (await cropDishPhotoFromPage(pages[pageIdx].dataUrl, contract.dishPhoto.box)) || '';
    }
  }
  if (!imageUrl && isDishPhotoOnly) {
    // The page IS the dish photo.
    imageUrl = (await prepPageForUpload(pages[0].dataUrl)) || pages[0].dataUrl;
  }
  if (!imageUrl) {
    // Fall back to a compact copy of page 1 so the card is never imageless.
    imageUrl = uploadPages[0] || pages[0].dataUrl;
  }

  // Metadata for review UI, I-5 self-healing, and the offline upgrade queue.
  recipe.imageUrl = imageUrl;
  recipe.image = imageUrl;
  recipe._imageStatus = 'data-url';
  recipe.sourceCaption = transcript;
  recipe._visionEngine = contract.engine;
  recipe._extractionSource = 'photo';
  recipe._ocrDraft = contract.engine === 'tesseract';
  recipe._dishPhotoBox = contract.dishPhoto || null;
  recipe._scanPageCount = pages.length;
  if (visionError) {
    // Cloud tiers failed but Tesseract still produced a readable draft — carry
    // the real reason so the review UI can say why (Component 3, spec
    // 2026-07-07-photo-import-csp-fix-design.md), instead of silently
    // degrading to on-device OCR with no explanation.
    recipe._visionError = visionError;
  }
  if (recipe._ocrDraft) {
    // Honest badge: on-device OCR drafts always warrant review.
    recipe.confidence = Math.min(typeof recipe.confidence === 'number' ? recipe.confidence : 0.45, 0.45);
    recipe.needsReview = true;
  }
  return recipe;
}
