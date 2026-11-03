/**
 * engine.js — the thin import spine.
 *
 * detect → acquire → structure → gate → return
 *
 * This file is pure flow control. No platform-specific logic, no AI prompts,
 * no DOM scraping. Each concern lives in the module it was extracted to:
 *
 *   acquire/instagram.js         — IG pack acquisition (Apify, oEmbed, ig-json)
 *   acquire/instagramFollowers.js — grounded blog/comment recipe follow-up
 *   acquire/website.js           — server-side /api/extract
 *   acquire/pinterest.js         — Pinterest oEmbed + pin scrape
 *   acquire/videoAudio.js        — yt-dlp / ASR transcript extraction
 *   structure/gemini.js          — Gemini structuring + reconciliation
 *   contextPack.js               — ContextPack shape, provenance helpers
 *   images.js                    — image persistence + hero selection
 *
 * Hard cap: 400 lines. If this file grows past that, acquire logic has
 * leaked in — move it back out to a fork.
 *
 * @module import/engine
 */

import { detectSourcePlatform, thinFromStructured } from '../recipeSchema.js';
import { acquireInstagramPack } from './acquire/instagram.js';
import { acquireWebsitePack, packFromPageHtml } from './acquire/website.js';
import { acquirePinterestPack } from './acquire/pinterest.js';
import { structurePack } from './structure/gemini.js';
import { packHasCompleteCandidate } from './contextPack.js';
import { detectSource, extractUrl } from './detectSource.js';
import { captionToRecipe, transcribeVideoForRecipe, structureDeterministic, finalizeAIRecipe } from '../recipeParser.js';
import { acquireVideoAudio } from './acquire/videoAudio.js';
import { detectVideoSource } from '../lib/videoSource.js';
import { acquirePhotoPack, stampPhotoMeta } from './acquire/photo.js';
import { acquireRedditPack } from './acquire/reddit.js';
import { acquireBlogPack } from './acquire/blog.js';
import { isRedditUrl } from '../scrapers/redditDiscovery.js';
import { gateRecipe } from './gate.js';
import { enrichDrinkFromCorpus } from './enrich.js';
import { tryInstagramFollowerEnrichment } from './acquire/instagramFollowers.js';
import { readCarouselSlides } from './acquire/instagramSlides.js';
import { readVideoFrames } from './acquire/videoFrames.js';
import { acquireVideoFilePack, videoPackText } from './acquire/videoFile.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ImportRequest
 * @property {string}  [url]          — URL to import from
 * @property {string}  [text]         — raw text (paste / OCR / transcript)
 * @property {Array}   [pages]        — multi-page PDF pages (future)
 * @property {File}    [videoFile]    — uploaded video (saved Reel / screen recording)
 * @property {string}  [pageHtml]     — page the person loaded in the native in-app browser
 * @property {'meal'|'drink'} kind    — recipe kind
 * @property {boolean} kindLocked     — lock kind (no auto-detect)
 * @property {AbortSignal} [signal]   — abort signal
 * @property {(msg: string) => void} [onProgress] — progress callback
 * @property {'share'|'discover'|'batch'|'sheet'|'form'|'transcribe'} [via] — entry point
 * @property {string} [whisperModel] — Whisper model for ASR transcription
 */

/**
 * @typedef {object} ImportResult
 * @property {object|null} recipe  — structured recipe, or null on failure
 * @property {object}      pack    — the ContextPack that was acquired
 * @property {'pass'|'salvage'|'empty'} gate — verdict (Task 7 adds gateRecipe)
 * @property {string[]}    reasons — human-readable gate reasons
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Noop progress callback. */
const noop = () => {};

/**
 * Detect which acquire fork to use for a URL.
 * Returns a platform key that maps to an acquire function.
 *
 * @param {string} url
 * @returns {'instagram'|'pinterest'|'website'}
 */
function detectAcquireFork(url) {
  // Reddit before platform — detectSourcePlatform returns 'web' for reddit.
  if (isRedditUrl(url)) return 'reddit';
  const platform = detectSourcePlatform(url);
  switch (platform) {
    case 'instagram': return 'instagram';
    case 'pinterest': return 'pinterest';
    // youtube, tiktok, facebook, x, web — all go through the website path
    // (acquireWebsitePack handles /api/extract which supports all of these)
    default: return 'website';
  }
}

// ── Acquire dispatch ─────────────────────────────────────────────────────────

/**
 * Acquire a ContextPack from the appropriate platform fork.
 *
 * @param {'instagram'|'pinterest'|'website'} fork
 * @param {string} url
 * @param {{ signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object|null>} ContextPack or null on failure
 */
async function acquire(fork, url, { signal, onProgress = noop, onMiss } = {}) {
  try {
    switch (fork) {
      case 'instagram': {
        onProgress('Extracting from Instagram…');
        return await acquireInstagramPack(url, { signal });
      }
      case 'pinterest': {
        onProgress('Extracting from Pinterest…');
        return await acquirePinterestPack(url, { signal, onMiss });
      }
      case 'website': {
        onProgress('Extracting via SpiceHub server…');
        return await acquireWebsitePack(url, { signal, onMiss });
      }
      case 'reddit': {
        onProgress('Extracting from Reddit…');
        return await acquireRedditPack(url, { signal, onProgress });
      }
      default:
        return null;
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err; // re-throw aborts
    onProgress('Extraction failed — continuing with what we have…');
    return null;
  }
}

// ── Structure ────────────────────────────────────────────────────────────────

/**
 * Structure a ContextPack into a recipe via the Gemini pack path.
 *
 * If the pack already has a complete candidate (Schema.org structured data),
 * returns it directly without an AI call.
 *
 * @param {object} pack — ContextPack
 * @param {{ kind: string, kindLocked: boolean, signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object|null>} structured recipe or null
 */
async function structure(pack, { kind = 'meal', kindLocked = false, signal, onProgress = noop } = {}) {
  if (!pack) return null;

  // Fast path: complete structured-data candidate (zero AI cost)
  if (packHasCompleteCandidate(pack)) {
    const c = pack.candidate;
    return {
      ...c,
      name: c.name || pack.title,
      imageUrl: c.imageUrl || pack.images?.[0]?.url || '',
      confidence: pack.confidence,
      _contextPack: pack,
      _extractedVia: 'extract:' + pack.acquiredVia,
    };
  }

  // AI structuring via Gemini. A captionless Reel can still carry its recipe
  // in slide/frame text or a transcript, so any labelled section counts.
  if (!pack.caption && !pack.markdown && !pack.transcript && !pack.slideText && !pack.frameText) return null;

  try {
    onProgress('Structuring recipe with AI…');
    const structured = await structurePack(pack, {
      type: kind,
      kindLocked,
      sourceType: pack.sourceType,
    });
    if (structured?.isRecipe) {
      // thinFromStructured flattens the raw RECIPE_SCHEMA shape
      // (ingredientGroups + directions:[{text,ingredientRefs}]) into the flat
      // ingredients/directions string[] the UI (normalizeRecipeForReview,
      // scoreExtractionConfidence in ImportSheet.jsx/recipeParser.js) expects.
      // Skipping this was the cause of "TypeError: g.trim is not a function"
      // — scoreExtractionConfidence's dirs.filter(d => d.trim()...) choked on
      // raw {text,ingredientRefs} direction objects that were never
      // flattened to strings. recipeParser.js's legacy paths always ran
      // thinFromStructured on this exact structurePack() output; this
      // engine.js path — the one ImportSheet.jsx actually calls — never did.
      // 2026-09-09.
      // structure/gemini.js leaves finalizeAIRecipe to its callers. It holds
      // the misplaced-line cleanup (and its _postProcessAudit), the zero-junk
      // filter, per-field confidence and the soft quality gate; skipping it
      // (2026-09-06 → 2026-10-29) left every engine link import uncleaned.
      const thin = finalizeAIRecipe(thinFromStructured(structured), {
        hintTitle: pack.title || '',
        sourceUrl: pack.sourceUrl || '',
        author: pack.author || '',
        via: 'gemini-pack:' + (pack.acquiredVia || pack.sourceType || 'unknown'),
        expectLink: !['photo', 'text', 'video'].includes(pack.sourceType),
      });
      return {
        ...thin,
        isRecipe: structured.isRecipe,
        _structureMode: structured._structureMode,
        imageUrl: thin.imageUrl || pack.images?.[0]?.url || '',
        _extractedVia: 'gemini-pack:' + (pack.acquiredVia || pack.sourceType || 'unknown'),
        _contextPack: {
          ...pack,
          provenance: [
            ...(pack.provenance || []),
            ...(Array.isArray(structured.provenance)
              ? structured.provenance.map(p => ({ ...p, via: 'model:' + p.via }))
              : []),
          ],
        },
      };
    }
    return null;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Delegate to gateRecipe; translate { verdict, reasons } → { gate, reasons }.
 * @param {object|null} recipe
 * @param {object} pack
 * @returns {{ gate: 'pass'|'salvage'|'empty', reasons: string[] }}
 */
function gate(recipe, pack) {
  if (recipe && pack?.kind === 'drink' && pack?.kindLocked) enrichDrinkFromCorpus(recipe, pack);
  const { verdict, reasons } = gateRecipe(recipe, pack);
  return { gate: verdict, reasons };
}

// ── Legacy wrappers (strangler-fig seams — removed as forks land) ─────────

/**
 * Text import via captionToRecipe (legacy file).
 * Task 6+ replaces with a proper text acquire fork.
 */
async function importFromText(request) {
  const { text, kind = 'meal', kindLocked = false, onProgress = noop } = request;
  onProgress('Sorting ingredients from instructions…');
  try {
    const recipe = await captionToRecipe(text, { type: kind, kindLocked });
    const pack = { caption: text, acquiredVia: 'caption', sourceType: 'text', kind, kindLocked };
    const { gate: verdict, reasons } = gate(recipe, pack);
    return { recipe, pack, gate: verdict, reasons };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { recipe: null, pack: { caption: text }, gate: 'empty', reasons: [err.message] };
  }
}



/**
 * Manual transcription import via transcribeVideoForRecipe (legacy).
 */
async function importFromTranscribe(url, request) {
  const { kind = 'meal', kindLocked = false, signal, onProgress = noop, whisperModel } = request;
  onProgress('Transcribing video audio…');
  try {
    const recipe = await transcribeVideoForRecipe(url, {
      onProgress: (_tier, msg) => onProgress(msg),
      signal, type: kind, kindLocked, model: whisperModel,
    });
    const pack = { caption: recipe?._transcript || '', acquiredVia: 'transcript', sourceType: 'video', kind, kindLocked };
    const { gate: verdict, reasons } = gate(recipe, pack);
    return { recipe, pack, gate: verdict, reasons };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { recipe: null, pack: null, gate: 'empty', reasons: [err.message || 'transcription failed'] };
  }
}

/**
 * Video transcription fallback — called when URL import yields a weak result
 * and the URL points to a video platform. Tries ASR → captionToRecipe.
 */
async function tryVideoFallback(url, existingPack, opts) {
  const { kind, kindLocked, signal, onProgress = noop } = opts;
  try {
    onProgress('No caption found — transcribing video audio…');
    const asr = await acquireVideoAudio({ sourceUrl: url }, { signal, budgetMs: 40_000 });
    if (!asr?.transcript || signal?.aborted) return null;

    onProgress('Structuring transcript…');
    const recipe = await captionToRecipe(asr.transcript, {
      sourceUrl: url, type: kind, kindLocked,
      imageUrl: existingPack?.images?.[0]?.url || '',
    });
    if (!recipe || signal?.aborted) return null;

    recipe._transcriptSource = asr.via;
    recipe._structuredVia = (recipe._structuredVia || 'unknown') + '+transcript';
    recipe.link = recipe.link || url;

    const pack = { ...existingPack, caption: asr.transcript, acquiredVia: 'transcript', kind, kindLocked };
    const { gate: verdict, reasons } = gate(recipe, pack);
    return { recipe, pack, gate: verdict, reasons };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Import a recipe from a URL or raw text.
 *
 * The full pipeline: detect → acquire → structure → gate → return.
 * The acquired ContextPack is threaded through to structurePack without
 * being unpacked into loose locals — provenance and image metadata survive.
 *
 * @param {ImportRequest} request
 * @returns {Promise<ImportResult>}
 */
export async function importRequest(request) {
  const {
    url, text, pages,
    kind = 'meal',
    kindLocked = false,
    signal,
    onProgress = noop,
    via,
  } = request || {};

  const source = detectSource(request);

  // ── Photo path (acquire → structure → gate) ──
  if (source === 'photo') {
    const photoPack = await acquirePhotoPack(pages, { kind, kindLocked, signal, onProgress });
    if (!photoPack) return { recipe: null, pack: null, gate: 'empty', reasons: ['photo acquisition failed'] };
    let photoRecipe = await structure(photoPack, { kind, kindLocked, signal, onProgress });
    // Offline (or /api/structure down): shape the OCR text on-device so a
    // Tesseract draft still reaches Review and the upgrade queue.
    if (!photoRecipe) photoRecipe = structureDeterministic(photoPack.caption, { type: kind, kindLocked });
    stampPhotoMeta(photoRecipe, photoPack);
    photoPack.kind = kind; photoPack.kindLocked = kindLocked;
    const { gate: photoVerdict, reasons: photoReasons } = gate(photoRecipe, photoPack);
    return { recipe: photoRecipe, pack: photoPack, gate: photoVerdict, reasons: photoReasons };
  }

  // ── Video file path (saved Reel / screen recording, works offline) ──
  if (source === 'video') {
    const { pack: videoPack, reason } = await acquireVideoFilePack(request.videoFile, { signal, onProgress, model: request.whisperModel });
    if (!videoPack) return { recipe: null, pack: null, gate: 'empty', reasons: [reason] };
    let videoRecipe = await structure(videoPack, { kind, kindLocked, signal, onProgress });
    // Offline (or /api/structure down): shape the words on-device, as for photos.
    if (!videoRecipe) videoRecipe = structureDeterministic(videoPackText(videoPack), { type: kind, kindLocked, imageUrl: videoPack.images[0]?.url || '' });
    videoPack.kind = kind; videoPack.kindLocked = kindLocked;
    const { gate: videoVerdict, reasons: videoReasons } = gate(videoRecipe, videoPack);
    return { recipe: videoRecipe, pack: videoPack, gate: videoVerdict, reasons: videoReasons };
  }

  // ── Text path (no URL found in input) ──
  if (source === 'text') {
    if (!text) return { recipe: null, pack: null, gate: 'empty', reasons: ['no text provided'] };
    return importFromText(request);
  }

  // ── URL-based paths (instagram, pinterest, website, youtube, etc.) ──
  const resolvedUrl = (url && typeof url === 'string' && url.trim()) || extractUrl(text);
  if (!resolvedUrl) {
    return { recipe: null, pack: null, gate: 'empty', reasons: ['no URL resolved'] };
  }

  // Manual transcription retry
  if (via === 'transcribe') {
    return importFromTranscribe(resolvedUrl, request);
  }

  // Standard: detect → acquire → structure → gate
  const fork = detectAcquireFork(resolvedUrl);

  let missReason = '';
  // A page the person read in the native in-app browser needs no fetch.
  const pack = request.pageHtml
    ? await packFromPageHtml(request.pageHtml, resolvedUrl)
    : await acquire(fork, resolvedUrl, { signal, onProgress, onMiss: (r) => { missReason = r; } });
  if (!pack && request.pageHtml) missReason = 'no-recipe-on-page';
  if (!pack) {
    return { recipe: null, pack: null, gate: 'empty', reasons: [missReason || 'acquisition failed'] };
  }

  // Instagram-only: grounded blog/comment followers before a weak/bait
  // caption reaches Gemini (see acquire/instagramFollowers.js for why).
  if (fork === 'instagram') {
    const followerRecipe = await tryInstagramFollowerEnrichment(pack, resolvedUrl, { signal, onProgress });
    if (followerRecipe) {
      pack.kind = kind; pack.kindLocked = kindLocked;
      const { gate: followerVerdict, reasons: followerReasons } = gate(followerRecipe, pack);
      if (followerVerdict === 'pass') {
        return { recipe: followerRecipe, pack, gate: followerVerdict, reasons: followerReasons };
      }
      // Didn't clear the gate on its own (e.g. thin ingredients) — fall
      // through to normal Gemini structuring on the (possibly enriched) pack
      // instead of returning a shaky result.
    }
    // Thin caption on a carousel → read the recipe printed on the slides.
    await readCarouselSlides(pack, { signal, onProgress });
  }
  // Thin caption on a short video → read the recipe shown on screen.
  await readVideoFrames(pack, { url: resolvedUrl, signal, onProgress });

  const recipe = await structure(pack, { kind, kindLocked, signal, onProgress });
  // Neither structure() branch (schema.org fast path, Gemini pack path) stamps
  // the source link, so every website import used to save with no link at all
  // (Discover Recipes/Drinks included). Stamp it here, before the gate, so the
  // saved item carries its origin.
  if (recipe && !recipe.link) recipe.link = resolvedUrl;
  pack.kind = kind; pack.kindLocked = kindLocked;
  const { gate: verdict, reasons } = gate(recipe, pack);

  // Video fallback: video URL + weak/empty result → try ASR transcription.
  if (verdict !== 'pass' && !signal?.aborted && detectVideoSource(resolvedUrl)) {
    const fallback = await tryVideoFallback(resolvedUrl, pack, { kind, kindLocked, signal, onProgress });
    if (fallback) return fallback;
  }

  return { recipe, pack, gate: verdict, reasons };
}

/**
 * Re-structure an existing pack — for Improve, DomAimSheet apply.
 * Never re-acquires. Useful when the user edits a caption or when a different
 * structuring strategy is needed for the same source material.
 *
 * @param {object} pack — an existing ContextPack
 * @param {{ kind?: string, kindLocked?: boolean, signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<ImportResult>}
 */
export async function restructure(pack, { kind = 'meal', kindLocked = false, signal, onProgress = noop } = {}) {
  if (!pack) {
    return { recipe: null, pack: null, gate: 'empty', reasons: ['no pack provided'] };
  }

  const recipe = await structure(pack, { kind, kindLocked, signal, onProgress });
  pack.kind = kind; pack.kindLocked = kindLocked;
  const { gate: verdict, reasons } = gate(recipe, pack);

  return { recipe, pack, gate: verdict, reasons };
}

/**
 * Detect the acquire fork for a URL without running the pipeline.
 * Useful for UI affordances (showing platform icons, choosing progress labels).
 *
 * @param {string} url
 * @returns {'instagram'|'pinterest'|'website'}
 */
export { detectAcquireFork };
