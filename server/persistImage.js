/**
 * persistImage — Downloads an image URL and converts to base64 data URL.
 * Handles Instagram CDN URLs (scontent, fbcdn) which require proper headers.
 * Returns the original URL on any failure (non-fatal).
 */
export async function persistImage(url) {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;

  // Build headers — Instagram CDN requires Referer + browser-like UA
  const isInstaCdn = /scontent|fbcdn|cdninstagram/i.test(url);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    ...(isInstaCdn ? {
      'Referer': 'https://www.instagram.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-platform': '"Windows"',
    } : {}),
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const response = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!response.ok) return url;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      // Sniff magic bytes — some CDNs strip Content-Type
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 4 || bytes.byteLength >= 3 * 1024 * 1024) return url;
      const head = new Uint8Array(bytes.slice(0, 4));
      const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
      const isPng = head[0] === 0x89 && head[1] === 0x50;
      if (!isJpeg && !isPng) return url;
      const mime = isJpeg ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 4 || bytes.byteLength >= 3 * 1024 * 1024) return url;
    return `data:${contentType.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return url;
  }
}
