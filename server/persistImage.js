// server/persistImage.js
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/**
 * Download an image URL and return a data: URI (for offline storage).
 * Falls back to the original URL if download fails or image is too large.
 * @param {string} url - Image URL to persist
 * @param {string} [sourceOrigin] - Origin of the recipe page (used as Referer to avoid hotlink blocks)
 */
export async function persistImage(url, sourceOrigin = '') {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;

  // Use the recipe site's own origin as Referer so hotlink protection passes.
  // Fall back to a neutral same-origin referer if origin not supplied.
  let referer = sourceOrigin;
  if (!referer) {
    try { referer = new URL(url).origin + '/'; } catch { referer = ''; }
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const headers = { 'User-Agent': UA };
    if (referer) headers['Referer'] = referer;
    const resp = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return url;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return url;

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return url;

    const b64 = Buffer.from(buf).toString('base64');
    return `data:${ct.split(';')[0]};base64,${b64}`;
  } catch {
    return url; // graceful: client can still try to render the remote URL
  }
}
