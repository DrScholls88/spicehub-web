// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: PHOTO — OCR pages into a ContextPack without structuring.
//
// Wraps importRecipeFromPages with acquireOnly: true so the engine's
// structure step handles AI structuring. The fork returns onScreenText,
// images, and scanPages — ImportReview uses scanPages for cover-recrop.
// ─────────────────────────────────────────────────────────────────────────────
import { importRecipeFromPages, PhotoImportError } from '../../lib/photoImportEngine.js';
import { createContextPack, addProvenance } from '../contextPack.js';

/**
 * Acquire a ContextPack from photo/PDF pages via OCR.
 *
 * @param {Array<{id:string, dataUrl:string}>} pages
 * @param {{ kind?: string, kindLocked?: boolean, signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object|null>} ContextPack or null on failure
 */
export async function acquirePhotoPack(pages, { kind = 'meal', kindLocked = false, signal, onProgress = () => {} } = {}) {
  try {
    const result = await importRecipeFromPages(pages, {
      type: kind,
      kindLocked,
      signal,
      acquireOnly: true,
      onProgress: (_stage, msg) => onProgress(msg),
    });

    if (!result || !result.transcript) return null;

    const pack = createContextPack({
      sourceType: 'photo',
      caption: result.transcript,
      images: result.uploadPages
        ? result.uploadPages.map((u, i) => ({ url: u, dataUrl: u, kind: i === 0 ? 'hero' : 'carousel' }))
        : [],
      acquiredVia: 'photo:' + (result._visionEngine || 'unknown'),
      confidence: result._ocrDraft ? 0.4 : 0.7,
    });

    // Carry scanPages so ImportReview can offer cover-recrop.
    pack.scanPages = pages;
    // The raw OCR text — named explicitly for downstream consumers.
    pack.onScreenText = result.transcript;

    addProvenance(pack, 'caption', pack.acquiredVia);
    if (pack.images.length) addProvenance(pack, 'images', pack.acquiredVia);

    // Carry vision metadata for review UI badges.
    if (result._ocrDraft) pack._ocrDraft = true;
    if (result.visionError) pack._visionError = result.visionError;
    if (result.dishPhoto) pack._dishPhoto = result.dishPhoto;

    return pack;
  } catch (err) {
    if (err instanceof PhotoImportError && err.code === 'aborted') throw err;
    if (err?.name === 'AbortError') throw err;
    // PhotoImportError and others → null so the engine gates as empty.
    return null;
  }
}
