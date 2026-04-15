// server/persistImage.js
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const REFERER = 'https://www.instagram.com/';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export async function persistImage(url) {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Referer': REFERER },
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
