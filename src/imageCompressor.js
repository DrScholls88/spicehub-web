/**
 * Image compression utilities for SpiceHub PWA.
 * Reduces image size before storing in IndexedDB to save storage quota.
 */

/**
 * Compress an image URL to a base64 data URL at reduced quality.
 * Used when caching recipe images locally for offline access.
 * @param {string} imageUrl - URL of the image to compress
 * @param {object} options - { maxWidth: 400, maxHeight: 400, quality: 0.7, format: 'image/webp' }
 * @returns {Promise<string|null>} base64 data URL or null on failure
 */
export async function compressImageUrl(imageUrl, options = {}) {
  const { maxWidth = 400, maxHeight = 400, quality = 0.7, format = 'image/webp' } = options;

  // data:/blob: URLs are already directly usable as an <img src> — no network
  // request is needed to decode them. This isn't just an optimization: the
  // app's CSP (connect-src 'self' https: wss:) does not list `data:`, so
  // fetch()ing a data: URL is blocked outright. The photo-import pipeline
  // hands this function a data: URL for every camera/gallery photo, so this
  // path is required for that pipeline to work at all, not just faster.
  if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
    try {
      return await compressFromImageSrc(imageUrl, { maxWidth, maxHeight, quality, format });
    } catch (error) {
      console.warn('[ImageCompressor] Failed to decode/compress:', error);
      return null;
    }
  }

  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    if (!response.ok) return null;

    const blob = await response.blob();
    return compressBlob(blob, { maxWidth, maxHeight, quality, format });
  } catch (error) {
    console.warn('[ImageCompressor] Failed to fetch/compress:', imageUrl, error);
    return null;
  }
}

/**
 * Compress a Blob to a smaller base64 data URL using canvas.
 */
export async function compressBlob(blob, options = {}) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await compressFromImageSrc(objectUrl, options);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * compressFromImageSrc — shared canvas-resize core. `src` must already be
 * directly usable as an <img> src (data:, blob:, or object URL) — this makes
 * no network request itself, so it's CSP-legal under connect-src regardless
 * of how strict that directive is (img-src is what governs it, and that
 * already allows data: blob:).
 */
async function compressFromImageSrc(src, options = {}) {
  const { maxWidth = 400, maxHeight = 400, quality = 0.7, format = 'image/webp' } = options;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Calculate scaled dimensions
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Try webp first, fallback to jpeg
      let dataUrl = canvas.toDataURL(format, quality);
      if (dataUrl.length < 50) { // webp not supported
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(dataUrl);
    };
    img.onerror = () => resolve(null);
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

/**
 * Estimate the byte size of a base64 data URL.
 */
export function estimateBase64Size(dataUrl) {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round(base64.length * 0.75);
}

// Skip recompressing images that are already small — avoids pointless canvas
// work on every import for images that are already a couple KB.
const COMPRESS_THRESHOLD_BYTES = 150 * 1024; // ~150KB

/**
 * compressRecipeImage — compress a recipe's imageUrl in place if it's a large
 * `data:` URL, otherwise return the recipe unchanged.
 *
 * This wires compressImageUrl/compressBlob (previously implemented but never
 * called anywhere) into the import save path. Before this, recipe photos were
 * persisted to IndexedDB at whatever resolution the import pipeline fetched
 * them at (server/persistImage.js only rejects images ≥3MB, it doesn't
 * resize) — a single 2-3MB source photo became a ~2.7-4MB base64 string
 * stored per recipe. This resizes to 400x400 WebP@0.7 before the recipe is
 * ever written to Dexie.
 *
 * Only handles `data:` URLs (what the import pipeline hands back by the time
 * a recipe reaches the save path — see server/persistImage.js and
 * api/proxy.js's `image-data-url` mode) so this never triggers a fresh
 * network fetch of a remote/hotlinked image (which would often fail on CORS
 * anyway). Never throws — falls back to the original recipe on any failure.
 *
 * @param {object} recipe
 * @returns {Promise<object>} a new recipe object (not mutated) with imageUrl
 *   replaced by the compressed version, or the original recipe if compression
 *   isn't applicable or didn't help.
 */
export async function compressRecipeImage(recipe) {
  if (!recipe || typeof recipe.imageUrl !== 'string' || !recipe.imageUrl.startsWith('data:')) {
    return recipe;
  }
  if (estimateBase64Size(recipe.imageUrl) <= COMPRESS_THRESHOLD_BYTES) {
    return recipe;
  }
  try {
    const compressed = await compressImageUrl(recipe.imageUrl);
    if (compressed && estimateBase64Size(compressed) < estimateBase64Size(recipe.imageUrl)) {
      return { ...recipe, imageUrl: compressed };
    }
  } catch (err) {
    console.warn('[compressRecipeImage] Skipping compression for', recipe.name, err);
  }
  return recipe;
}
