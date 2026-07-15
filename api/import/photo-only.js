// ─────────────────────────────────────────────────────────────────────────────
// /api/import/photo-only — re-fetch just the hero image for an existing recipe
//
// Backs the "Find Photo" / "Find Better Photo" button in MealLibrary and
// BarLibrary (2026-07-14). Both UIs have called this endpoint since the photo
// re-import feature was first added, but the route never existed as a Vercel
// serverless function — every tap silently 404'd, was swallowed by a
// `.catch(() => ({}))`, and surfaced as "No better photo found" regardless of
// the real cause. This implements it for real, reusing extract.js's HTML
// parsing (JSON-LD / microdata / og:image) and Instagram embed fallback
// instead of duplicating that logic.
// ─────────────────────────────────────────────────────────────────────────────
import {
  extractFromHtml,
  extractInstagramFallback,
  fetchWithTimeout,
  BROWSER_HEADERS,
  checkRateLimit,
} from '../extract.js';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = (req.method === 'POST' ? req.body?.url : req.query?.url) || '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, reason: 'invalid-url' });
  }

  // SSRF guard — same policy as /api/extract.
  try {
    const host = new URL(url).hostname;
    if (
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      !host.includes('.')
    ) {
      return res.status(400).json({ ok: false, reason: 'blocked-host' });
    }
  } catch {
    return res.status(400).json({ ok: false, reason: 'invalid-url' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, reason: 'rate-limited' });
  }

  try {
    if (/instagram\.com\//i.test(url)) {
      const ig = await extractInstagramFallback(url);
      const imageUrl = ig?.images?.[0] || '';
      if (!imageUrl) return res.status(200).json({ ok: false, reason: ig?.reason || 'no-image' });
      return res.status(200).json({ ok: true, imageUrl });
    }

    const html = await fetchWithTimeout(url, BROWSER_HEADERS);
    const result = extractFromHtml(html, url);
    const imageUrl = result?.candidate?.imageUrl || result?.meta?.image || result?.images?.[0] || '';
    if (!imageUrl) return res.status(200).json({ ok: false, reason: 'no-image' });
    return res.status(200).json({ ok: true, imageUrl });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reason: err?.name === 'TimeoutError' ? 'upstream-timeout' : 'fetch-failed',
      detail: err?.message || String(err),
    });
  }
}
