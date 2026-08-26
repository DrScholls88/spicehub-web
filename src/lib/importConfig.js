// ─────────────────────────────────────────────────────────────────────────────
// Import pipeline — centralized constants.
//
// One file to grep, one file to update when Meta sunsets an API version,
// Apify renames an actor, or Chrome ships a new major.
//
// Consumed by:  api/proxy.js  ·  api/extract.js  ·  src/api.js  ·
//               src/import/acquire/instagram.js
// ─────────────────────────────────────────────────────────────────────────────

// ─── External API versions ─────────────────────────────────────────────────
// Meta deprecates Graph API versions on a rolling 2-year cycle.
// Check https://developers.facebook.com/docs/graph-api/changelog for sunsets.
export const GRAPH_API_VERSION = 'v25.0';
export const APIFY_ACTOR_ID = 'apify~instagram-post-scraper';

// ─── Browser identity ──────────────────────────────────────────────────────
// Update quarterly.  Stale UA strings are the #1 signal bot-walls key on.
// Bump CHROME_VERSION and the rest follows (Safari/Firefox are independent
// release trains but keeping them roughly contemporary is what matters).
export const CHROME_VERSION = '136';

export const USER_AGENTS = [
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0`,
  `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Mobile Safari/537.36`,
];

// Compact header sent on Instagram requests (sec-ch-ua).
// Must stay in sync with CHROME_VERSION above.
export const SEC_CH_UA = `"Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}", "Not-A.Brand";v="99"`;

// ─── Timeouts ──────────────────────────────────────────────────────────────
// Server-side (api/proxy.js — Edge Runtime, Vercel hard-kills at 25 s)
export const SERVER_APIFY_TIMEOUT_S = 18;    // Apify actor `timeout=` param (seconds)
export const SERVER_APIFY_FETCH_MS = 20000;  // AbortSignal backstop for the HTTP call itself
export const SERVER_OEMBED_MS = 8000;
export const SERVER_IG_JSON_MS = 8000;
export const SERVER_IMAGE_MS = 6000;
export const SERVER_TIKTOK_MS = 6000;
export const SERVER_HTML_PROXY_MS = 10000;

// Wall-clock budget for entire Instagram acquire phase (race + server-extract).
// Prevents a bad Apify run + retries + embed waterfall from burning 60-90 s.
// Must be < Vercel Edge 25 s and < any caller's own UI timeout.
export const ACQUIRE_WALL_CLOCK_MS = 15000;

// Client-side (src/api.js)
export const CLIENT_APIFY_MS = 25000;           // no point exceeding Edge 25 s limit
export const CLIENT_OEMBED_MS = 10000;
export const CLIENT_IG_JSON_MS = 10000;
export const CLIENT_IG_JSON_DETAILS_MS = 12000;
export const CLIENT_EXTRACT_MS = 15000;         // /api/extract fallback

// Server-side (api/extract.js — Node runtime)
export const EXTRACT_FETCH_TIMEOUT_MS = 12000;

// ─── Caption thresholds ────────────────────────────────────────────────────
// Minimum caption length to consider a source "good enough" to use.
export const MIN_CAPTION_LENGTH = 30;

// ─── Payload size limits ───────────────────────────────────────────────────
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CAROUSEL_IMAGES = 6;
export const MAX_LATEST_COMMENTS = 5;
export const MAX_HTML_CHARS = 2_000_000;   // proxy.js generic passthrough
export const MAX_HTML_BYTES = 2_500_000;   // extract.js server fetch
