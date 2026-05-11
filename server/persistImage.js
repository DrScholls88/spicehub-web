export async function persistImage(url) {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:')) return url;

  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return url;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 2 * 1024 * 1024) return url;
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return url;
  }
}
