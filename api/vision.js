// ─────────────────────────────────────────────────────────────────────────────
// /api/vision — server-side Gemini VISION passthrough (photo/document import,
// dish-photo hero validation). Keeps GOOGLE_GENERATIVE_AI_API_KEY out of the
// client bundle. See docs/superpowers/specs/2026-07-07-photo-import-csp-fix-
// design.md, "Out of scope" §1 (this closes that gap).
//
// Deliberately a THIN passthrough, not a request/response reshape: the client
// (src/lib/photoImportEngine.js transcribeWithGemini, src/import/images.js
// visionValidateDishPhoto) already builds the exact Gemini `contents`/
// `generationConfig` body and parses the exact Gemini response shape. Forcing
// this endpoint through the same JSON-contract machinery as api/structure.js
// would mean re-deriving a vision contract server-side for zero benefit.
//
// Status/body/Retry-After are forwarded UNCHANGED (not collapsed into a
// generic ok/fail envelope like api/structure.js does) so the client's
// existing fetchVisionTier() 429-retry handling (spec Component 3) keeps
// working identically whether it's calling this proxy or Gemini directly.
// ─────────────────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 45000; // matches photoImportEngine's VISION_TIMEOUT_MS
const DEFAULT_MODEL = 'gemini-2.0-flash-lite';

// ── Rate limiting (best-effort in-memory; resets on cold start) ──────────────
// Own bucket, not shared with api/structure.js — different endpoint, own quota.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 60; // higher than structure.js: a single import can spend a
                      // Gemini vision call plus a dish-photo hero-vision call.
const rateBuckets = new Map();

export function checkRateLimit(ip, now = Date.now()) {
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'post-only' });

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GOOGLE_AI_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, reason: 'no-server-key' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ ok: false, reason: 'rate-limited' });

  const model = typeof req.query?.model === 'string' && req.query.model.trim() ? req.query.model.trim() : DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reason: err?.name === 'TimeoutError' ? 'gemini-timeout' : 'proxy-fetch-failed',
      detail: err?.message || String(err),
    });
  }

  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) res.setHeader('Retry-After', retryAfter);
  res.setHeader('Content-Type', 'application/json');
  const bodyText = await upstream.text();
  return res.status(upstream.status).send(bodyText);
}
