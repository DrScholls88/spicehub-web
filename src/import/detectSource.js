/**
 * detectSource.js — detect the import source type from user input.
 *
 * Pure, synchronous, no network. Determines which acquire fork the engine
 * should dispatch to.
 *
 * DISTINCT from detectImportType (recipeParser.js:5596) which detects
 * the recipe KIND (meal vs drink). This detects the SOURCE (where the
 * recipe content comes from).
 *
 * @module import/detectSource
 */

import { detectSourcePlatform } from '../recipeSchema.js';

// ── URL extraction ───────────────────────────────────────────────────────────

// Finds the first http(s) URL in a string. Excludes trailing punctuation
// that is likely sentence-level, not part of the URL.
const URL_RX = /https?:\/\/[^\s<>"'\])]+/i;

/**
 * Extract the first URL from a text string.
 * @param {string} text
 * @returns {string|null}
 */
function extractUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(URL_RX);
  return m ? m[0] : null;
}

// ── Reddit detection (not covered by detectSourcePlatform) ───────────────────

const REDDIT_RX = /(?:^|\/\/)(?:www\.|old\.|new\.)?reddit\.com|\/\/redd\.it/i;
const PINTEREST_SHORT_RX = /(?:^|\/\/)pin\.it\//i;

// ── Platform → source mapping ────────────────────────────────────────────────

const PLATFORM_TO_SOURCE = {
  instagram: 'instagram',
  pinterest: 'pinterest',
  youtube:   'youtube',
  tiktok:    'tiktok',
  facebook:  'social',
  x:         'social',
  web:       'website',
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the import source type from user input.
 *
 * @param {{ url?: string, text?: string, pages?: any[] }} input
 * @returns {'instagram'|'pinterest'|'reddit'|'youtube'|'tiktok'|'social'|'website'|'text'|'photo'}
 */
export function detectSource(input) {
  if (!input || typeof input !== 'object') return 'text';

  // Photo pages take priority
  if (Array.isArray(input.pages) && input.pages.length > 0) return 'photo';

  // Try explicit URL first, then extract from text
  const url = (input.url && typeof input.url === 'string' && input.url.trim())
    || extractUrl(input.text);
  if (!url) return 'text';

  // Reddit (not in detectSourcePlatform)
  if (REDDIT_RX.test(url)) return 'reddit';

  // Pinterest short links (pin.it → not caught by detectSourcePlatform)
  if (PINTEREST_SHORT_RX.test(url)) return 'pinterest';

  // Use the existing platform detector + map
  const platform = detectSourcePlatform(url);
  return PLATFORM_TO_SOURCE[platform] || 'website';
}

/** Re-export extractUrl for engine use (text-with-URL → URL routing). */
export { extractUrl };
