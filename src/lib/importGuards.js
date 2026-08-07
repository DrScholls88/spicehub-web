/**
 * SpiceHub — Import Pipeline Guards (harden-ideas-audit-2026-08-06.md)
 *
 * Shared safety utilities for the import pipeline:
 *   - SSRF protection (block private/reserved IPs)
 *   - HTML size cap (prevent memory spikes)
 *   - Apify payload validation (reject garbage early)
 *   - Schema quality gate (minimum recipe before accept)
 *   - In-flight import dedup (one promise per URL)
 *   - Gemini input budget (cap text before LLM)
 */

// ── SSRF Protection ─────────────────────────────────────────────────────────
// Block private, loopback, link-local, and cloud metadata IPs before any fetch.

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '[::1]', '0.0.0.0',
  'metadata.google.internal',         // GCP metadata
  'metadata.google.com',
]);

// Reserved IP ranges (CIDR-style prefix check)
const PRIVATE_PREFIXES = [
  '10.',            // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',  // 172.16.0.0/12
  '192.168.',       // 192.168.0.0/16
  '169.254.',       // link-local
  'fd',             // IPv6 ULA
  'fe80:',          // IPv6 link-local
];

/**
 * Returns true if URL targets a private/reserved/metadata address.
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isSsrfTarget(urlStr) {
  try {
    const parsed = new URL(urlStr);

    // Only allow http(s) schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    const host = parsed.hostname.toLowerCase();

    // Direct blocklist
    if (BLOCKED_HOSTS.has(host)) return true;

    // AWS/GCP/Azure metadata endpoints
    if (host === '169.254.169.254') return true;
    if (host === '100.100.100.200') return true;  // Alibaba

    // Prefix check for private ranges
    if (PRIVATE_PREFIXES.some(p => host.startsWith(p))) return true;

    // Reject IPs that are all-numeric (like 0x7f000001 or octal 0177.0.0.1)
    // by checking if hostname is an IP and re-checking
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      const parts = host.split('.').map(Number);
      if (parts.some(p => p > 255)) return true;
      if (parts[0] === 0 || parts[0] === 127) return true;
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
    }

    return false;
  } catch {
    return true; // unparseable URL → block
  }
}


// ── HTML Size Cap ───────────────────────────────────────────────────────────

/** Max HTML bytes before truncation (2 MB). */
export const HTML_SIZE_CAP = 2 * 1024 * 1024;

/**
 * Truncate HTML string to HTML_SIZE_CAP characters to prevent memory spikes.
 * @param {string} html
 * @returns {string}
 */
export function capHtml(html) {
  if (!html || typeof html !== 'string') return html || '';
  return html.length > HTML_SIZE_CAP ? html.slice(0, HTML_SIZE_CAP) : html;
}


// ── Apify Payload Validation ────────────────────────────────────────────────

/**
 * Validate that an Apify response has at least some usable data.
 * Returns { ok, reason } — ok=false means treat as soft fail → fallback.
 * @param {object} data  Raw response from Apify API
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateApifyPayload(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'empty-response' };
  }
  const hasCaption = typeof data.caption === 'string' && data.caption.trim().length > 10;
  const hasImage = !!(data.displayUrl || (Array.isArray(data.images) && data.images.length > 0));
  const hasVideo = !!data.videoUrl;

  if (!hasCaption && !hasImage && !hasVideo) {
    return { ok: false, reason: 'no-content' };
  }
  return { ok: true, reason: '' };
}


// ── Schema Quality Gate ─────────────────────────────────────────────────────
// Minimum bar for a recipe to be accepted (not just structurally parsed).

const GENERIC_NAMES = /^(recipe|imported|untitled|home|blog|post|page|instagram|reel)$/i;

/**
 * Check whether a structured recipe passes the minimum quality bar.
 * @param {object} recipe  { name, ingredients, directions, ... }
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function schemaQualityGate(recipe) {
  const reasons = [];

  if (!recipe) {
    return { pass: false, reasons: ['null-recipe'] };
  }

  // Name must be non-generic
  const name = (recipe.name || '').trim();
  if (!name || GENERIC_NAMES.test(name)) {
    reasons.push('generic-name');
  }

  // ≥2 ingredients
  const ings = typeof recipe.ingredients === 'string'
    ? recipe.ingredients.split('\n').filter(Boolean)
    : Array.isArray(recipe.ingredients) ? recipe.ingredients.filter(Boolean) : [];
  if (ings.length < 2) {
    reasons.push(`ingredients:${ings.length}`);
  }

  // ≥1 direction (or user can confirm thin recipe downstream)
  const dirs = typeof recipe.directions === 'string'
    ? recipe.directions.split('\n').filter(Boolean)
    : Array.isArray(recipe.directions) ? recipe.directions.filter(Boolean) : [];
  if (dirs.length < 1) {
    reasons.push('no-directions');
  }

  // sourceUrl should be set
  if (!recipe.sourceUrl && !recipe.link) {
    reasons.push('no-source-url');
  }

  // If input was a reel/video, videoUrl should be preserved
  if (recipe._isReel && !recipe.videoUrl) {
    reasons.push('reel-missing-videoUrl');
  }

  // Pass if at most one soft failure (no-directions alone is tolerable)
  const hardFails = reasons.filter(r => r !== 'no-directions');
  return { pass: hardFails.length === 0, reasons };
}


// ── In-Flight Import Dedup ──────────────────────────────────────────────────
// Prevent concurrent imports of the same URL from creating duplicates.

const _inFlight = new Map();

/**
 * Wrap an async import function so concurrent calls with the same URL
 * share a single in-flight promise.
 * @param {string} url
 * @param {() => Promise<any>} fn  The actual import work
 * @returns {Promise<any>}
 */
export function deduplicateImport(url, fn) {
  const key = normalizeImportUrl(url);
  if (_inFlight.has(key)) {
    console.log(`[importGuards] Dedup hit — sharing in-flight import for ${key}`);
    return _inFlight.get(key);
  }
  const promise = fn().finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

/** Normalize IG URL for dedup key (strip query params, trailing slash). */
function normalizeImportUrl(url) {
  try {
    const u = new URL(url);
    // Keep only path (no query, no hash, no trailing slash)
    return `${u.hostname}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}


// ── Gemini Input Budget ─────────────────────────────────────────────────────

/** Max chars of caption/article text to send to Gemini. */
export const GEMINI_INPUT_CAP = 8000;

/**
 * Truncate text to GEMINI_INPUT_CAP, preferring to break at a sentence boundary.
 * @param {string} text
 * @returns {string}
 */
export function capGeminiInput(text) {
  if (!text || text.length <= GEMINI_INPUT_CAP) return text || '';
  // Try to break at last sentence boundary before cap
  const sliced = text.slice(0, GEMINI_INPUT_CAP);
  const lastPeriod = sliced.lastIndexOf('. ');
  const lastNewline = sliced.lastIndexOf('\n');
  const breakPoint = Math.max(lastPeriod, lastNewline);
  return breakPoint > GEMINI_INPUT_CAP * 0.7
    ? sliced.slice(0, breakPoint + 1)
    : sliced;
}
