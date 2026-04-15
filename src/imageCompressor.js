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
    img.src = URL.createObjectURL(blob);
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
