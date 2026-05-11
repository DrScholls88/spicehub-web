export function validateRecipePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'recipe payload required' };
  if (!String(payload.name || '').trim()) return { ok: false, error: 'name is required' };
  if (!Array.isArray(payload.ingredients)) return { ok: false, error: 'ingredients must be an array' };
  if (!Array.isArray(payload.directions)) return { ok: false, error: 'directions must be an array' };

  return {
    ok: true,
    value: {
      ...payload,
      imageUrl: payload.imageUrl || '',
      link: payload.link || '',
      yield: payload.yield || '',
      prepTime: payload.prepTime || '',
      cookTime: payload.cookTime || '',
    },
  };
}
