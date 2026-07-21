// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: PINTEREST — thin Pinterest-specific acquirer.
// Uses the generic /api/extract but forces sourceType + cleans Pinterest CDN images.
// ─────────────────────────────────────────────────────────────────────────────
import { acquireWebsitePack } from './website.js';
import { createContextPack } from '../contextPack.js';

/**
 * acquirePinterestPack
 * Tries the server extract first (best schema.org/Recipe support on pins),
 * then falls back to normal website behavior.
 */
export async function acquirePinterestPack(url, opts = {}) {
  const pack = await acquireWebsitePack(url, opts);
  if (!pack) return null;

  // Force correct sourceType for downstream reconciliation + UI
  pack.sourceType = 'pinterest';

  // Pinterest images are often served through their CDN with extra params.
  // Keep only the cleanest image URLs (strip size params if present).
  if (pack.images?.length) {
    pack.images = pack.images.map(img => ({
      ...img,
      url: img.url.split('?')[0], // remove query params that Pinterest adds
    }));
  }

  // Add provenance so the pack knows it came through the Pinterest path
  if (!pack.acquiredVia) pack.acquiredVia = 'pinterest-extract';

  return pack;
}
