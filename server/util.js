export function isInstagramUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

export function asStringArray(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/\r?\n/);
  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.text || item.name || '';
      return '';
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

export function firstImageUrl(recipe = {}) {
  const candidates = [
    recipe.image,
    recipe.imageUrl,
    recipe.images,
  ].flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);

  return candidates.find((url) => typeof url === 'string' && url.startsWith('data:image'))
    || candidates.find((url) => typeof url === 'string')
    || '';
}
