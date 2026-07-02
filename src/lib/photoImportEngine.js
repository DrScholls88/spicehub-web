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
   *                         'structure-failed'
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
 */
export async function cropRegionFromPage(pageDataUrl, rect01) {
  try {
    const img = await loadImage(pageDataUrl);
    const sx = Math.max(0, Math.round(rect01.x * img.naturalWidth));
    const sy = Math.max(0, Math.round(rect01.y * img.naturalHeight));
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect01.w * img.naturalWidth));
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect01.h * img.naturalHeight));
    if (sw <= 2 || sh <= 2) return null;

    const scale = Math.min(1, DISH_PHOTO_MAX_EDGE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
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
  return `You are given ${pageCount} page image${pageCount === 1 ? '' : 's'} of recipe content (cookbook page, recipe card, menu board, handwritten note, or website screenshot). Pages are in reading order.

For EACH page, transcribe ALL text as faithfully as possible:
- Preserve line breaks, section headers (like "Ingredients:", "For the sauce:"), bullet points, numbered steps, quantities, and measurements exactly as written.
- If handwritten, read every word you can; mark unreadable words as [?].
- If a page shows only a plated dish with no text, transcribe nothing for it.
- If the content is a menu board, transcribe each item name and description.

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

// ── Tier 1: Gemini (all pages, one call) ───────────────────────────────────

async function transcribeWithGemini(uploadPages, { signal } = {}) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('Gemini key missing');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL()}:generateContent?key=${key}`;
  const parts = uploadPages.map((dataUrl) => ({
    inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] || '' },
  }));
  parts.push({ text: buildVisionPrompt(uploadPages.length) });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
    signal: withTimeout(signal, VISION_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Gemini vision HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const contract = parseVisionContract(text, uploadPages.length);
  if (!contract) throw new Error('Gemini vision returned an unparseable contract');
  return { ...contract, engine: 'gemini' };
}

// ── Tier 2: Mistral Pixtral (same contract) ─────────────────────────────────

async function transcribeWithMistral(uploadPages, { signal } = {}) {
  const key = MISTRAL_KEY();
  if (!key) throw new Error('Mistral key missing');

  const content = uploadPages.map((dataUrl) => ({ type: 'image_url', image_url: dataUrl }));
  content.push({ type: 'text', text: buildVisionPrompt(uploadPages.length) });

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL(),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
    signal: withTimeout(signal, VISION_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Mistral vision HTTP ${res.status}`);
    err.status = res.status;
    throw err;
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
  if (GEMINI_KEY()) {
    onProgress?.('transcribe', `Reading ${uploadPages.length > 1 ? `${uploadPages.length} pages` : 'your photo'} with Gemini…`);
    try {
      return await transcribeWithGemini(uploadPages, { signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      tier1Error = err;
      console.warn('[PhotoImport] Gemini tier failed:', err.message);
    }
  }
  if (MISTRAL_KEY()) {
    onProgress?.('transcribe', 'Gemini unavailable — trying Mistral…');
    try {
      return await transcribeWithMistral(uploadPages, { signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('[PhotoImport] Mistral tier failed:', err.message);
    }
  }
  throw tier1Error || new Error('No online vision tier available');
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
 *        _dishPhotoBox, _scanPageCount, imageUrl/image, _imageStatus
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
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (online) {
    try {
      contract = await transcribePagesOnline(uploadPages, { signal, onProgress });
    } catch (err) {
      if (err.name === 'AbortError') throw new PhotoImportError('aborted', 'Import cancelled.');
      console.warn('[PhotoImport] All online tiers failed — falling back to on-device OCR.');
    }
  }
  if (!contract) {
    contract = await transcribeWithTesseract(pages, { onProgress });
  }
  if (signal?.aborted) throw new PhotoImportError('aborted', 'Import cancelled.');

  const transcript = joinPageTranscripts(contract.pages);
  const isDishPhotoOnly = contract.contentType === 'dish-photo';
  if (transcript.length < MIN_TRANSCRIPT_CHARS && !isDishPhotoOnly) {
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
  if (recipe._ocrDraft) {
    // Honest badge: on-device OCR drafts always warrant review.
    recipe.confidence = Math.min(typeof recipe.confidence === 'number' ? recipe.confidence : 0.45, 0.45);
    recipe.needsReview = true;
  }
  return recipe;
}
