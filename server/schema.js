// server/schema.js
export function validateRecipePayload(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'payload must be an object' };

  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (!Array.isArray(input.ingredients)) return { ok: false, error: 'ingredients must be an array' };
  if (!Array.isArray(input.directions)) return { ok: false, error: 'directions must be an array' };

  const str = (v) => (typeof v === 'string' ? v : '');

  return {
    ok: true,
    value: {
      name: input.name.trim(),
      ingredients: input.ingredients.map(String),
      directions: input.directions.map(String),
      imageUrl: str(input.imageUrl),
      link: str(input.link),
      yield: str(input.yield),
      prepTime: str(input.prepTime),
      cookTime: str(input.cookTime),
    },
  };
}
