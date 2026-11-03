// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: WEBSITE — thin client for /api/extract (Vercel serverless).
//
// One job: turn a URL into a ContextPack via the server, or return null. On a
// null, the optional onMiss(reason) says why (publisher wall, bot challenge,
// timeout...) so the Miss screen can be honest. The legacy parser
// (recipeParser.js) still falls back to its client-side tiers; the engine
// does not. Never throws. No imports from recipeParser (keeps the graph acyclic).
// ─────────────────────────────────────────────────────────────────────────────
import { createContextPack, addProvenance } from '../contextPack.js';
import { capHtml } from '../../lib/importGuards.js';

const DEFAULT_TIMEOUT_MS = 15000;

/** Resolve the extract endpoint: env override → same-origin default. */
export function extractEndpoint() {
  const envUrl =
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_EXTRACT_ENDPOINT : null;
  if (envUrl) return envUrl;
  return '/api/extract';
}

/**
 * Normalize a raw /api/extract response body into a ContextPack.
 * Exported for tests.
 */
export function packFromExtractResponse(body, url) {
  if (!body || body.ok !== true) return null;

  const pack = createContextPack({
    sourceUrl: url,
    sourceType: body.sourceType === 'instagram' ? 'instagram' : 'website',
    title: body.candidate?.name || body.meta?.title || '',
    caption: body.caption || null,
    markdown: body.markdown || null,
    jsonLd: body.jsonLd || null,
    candidate: body.candidate || null,
    images: (body.images || [])
      .filter(Boolean)
      .slice(0, 6)
      .map((u, i) => ({ url: u, kind: i === 0 ? 'hero' : 'carousel' })),
    acquiredVia: body.acquiredVia || 'server-extract',
    confidence:
      body.acquiredVia === 'json-ld' ? 0.95
      : body.acquiredVia === 'microdata' ? 0.85
      : body.acquiredVia === 'ig-embed' || body.acquiredVia === 'ig-json' ? 0.7
      : body.markdown ? 0.5
      : 0.2,
  });

  if (body.candidate) addProvenance(pack, 'candidate', body.acquiredVia, pack.confidence);
  if (body.markdown) addProvenance(pack, 'markdown', 'server-extract');
  if (body.caption) addProvenance(pack, 'caption', body.acquiredVia);
  if (body.meta?.title) addProvenance(pack, 'title', 'og-meta');
  if (pack.images.length) addProvenance(pack, 'images', body.acquiredVia);

  // A pack with no usable signal is a miss, not a pack.
  if (!pack.candidate && !pack.markdown && !pack.caption) return null;
  return pack;
}

/**
 * Why /api/extract could not give us a page, from its HTTP status and body.
 * Exported for tests.
 * @returns {'site-publisher-block'|'site-bot-challenge'|'site-page-not-found'|'site-timeout'|'rate-limited'|'invalid-url'|'site-unreachable'}
 */
export function extractMissReason(httpStatus, body) {
  if (body?.wall === 'publisher-block') return 'site-publisher-block';
  if (body?.wall === 'bot-challenge') return 'site-bot-challenge';
  if (httpStatus === 429 || body?.reason === 'rate-limited') return 'rate-limited';
  if (httpStatus === 400) return 'invalid-url';
  if (body?.reason === 'upstream-timeout') return 'site-timeout';
  const upstream = Number(body?.status) || Number(/upstream (\d{3})/.exec(body?.detail || '')?.[1]) || 0;
  if (upstream === 402 || upstream === 451) return 'site-publisher-block';
  if (upstream === 403 || upstream === 429 || upstream === 503) return 'site-bot-challenge';
  if (upstream === 404 || upstream === 410) return 'site-page-not-found';
  return 'site-unreachable';
}

/**
 * Build a pack from page HTML the person loaded themselves in the native
 * in-app browser (lib/inAppRecipeBrowser.js). Same extractor as a successful
 * /api/extract, so the pack is identical; the extractor is plain string
 * parsing and is loaded only when this runs.
 * @returns {Promise<ContextPack|null>}
 */
export async function packFromPageHtml(html, url) {
  const { extractFromHtml } = await import('../../../api/extract.js');
  const pack = packFromExtractResponse({ ok: true, sourceType: 'website', ...extractFromHtml(capHtml(html), url) }, url);
  if (pack) addProvenance(pack, 'page', 'in-app-browser');
  return pack;
}

/**
 * Acquire a website (or IG-fallback) ContextPack from the server.
 * @param {{ signal?: AbortSignal, timeoutMs?: number, onMiss?: (reason: string) => void }} [opts]
 * @returns {Promise<ContextPack|null>} null on ANY failure; onMiss says why.
 */
export async function acquireWebsitePack(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, onMiss = () => {} } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) { onMiss('invalid-url'); return null; }
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined =
      signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;

    const res = await fetch(extractEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: combined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const reason = extractMissReason(res.status, body);
      console.log(`[SpiceHub] /api/extract HTTP ${res.status} (${reason})`);
      onMiss(reason);
      return null;
    }
    const body = await res.json();
    const pack = packFromExtractResponse(body, url);
    if (pack) {
      console.log(`[SpiceHub] /api/extract OK via ${pack.acquiredVia} (${body.elapsedMs}ms)`);
    } else {
      onMiss('no-recipe-on-page');
    }
    return pack;
  } catch (err) {
    console.log('[SpiceHub] /api/extract unreachable:', err?.message || err);
    // Our own timeout fired → the site was slow; anything else (offline,
    // Vercel down) means we never reached it. A caller abort reports nothing.
    if (!signal?.aborted) onMiss(err?.name === 'TimeoutError' ? 'site-timeout' : 'site-unreachable');
    return null;
  }
}
