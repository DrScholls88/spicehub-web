// server/util.js
export function isInstagramUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

export function firstImageUrl(recipe) {
  const candidates = [];
  const push = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === 'string') candidates.push(v);
    else if (typeof v === 'object' && v.url) candidates.push(v.url);
  };
  push(recipe?.image);
  push(recipe?.imageUrl);
  push(recipe?.images);
  // Prefer data URLs (e.g. video frames) over remote URLs
  const dataUrl = candidates.find((c) => typeof c === 'string' && c.startsWith('data:'));
  if (dataUrl) return dataUrl;
  return candidates.find((c) => typeof c === 'string' && c.startsWith('http')) || '';
}

export function asStringArray(v) {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') return (x.text || x.name || '').trim();
      return '';
    })
    .filter(Boolean);
}
