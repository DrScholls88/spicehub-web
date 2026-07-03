// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: WEBSITE — thin client for /api/extract (Vercel serverless).
//
// One job: turn a URL into a ContextPack via the server, or return null so the
// caller falls back to the legacy client-side tiers (CORS proxy → parseHtml).
// Never throws. No imports from recipeParser (keeps the module graph acyclic).
// ─────────────────────────────────────────────────────────────────────────────
import { createContextPack, addProvenance } from '../contextPack.js';

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
 * Acquire a website (or IG-fallback) ContextPack from the server.
 * @returns {Promise<ContextPack|null>} null on ANY failure — callers fall back.
 */
export async function acquireWebsitePack(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
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
      console.log(`[SpiceHub] /api/extract HTTP ${res.status} — falling back to client tiers`);
      return null;
    }
    const body = await res.json();
    const pack = packFromExtractResponse(body, url);
    if (pack) {
      console.log(`[SpiceHub] /api/extract OK via ${pack.acquiredVia} (${body.elapsedMs}ms)`);
    }
    return pack;
  } catch (err) {
    console.log('[SpiceHub] /api/extract unreachable:', err?.message || err);
    return null;
  }
}
