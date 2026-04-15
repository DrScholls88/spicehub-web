import { describe, it, expect } from 'vitest';
import { validateRecipePayload } from '../schema.js';

describe('validateRecipePayload', () => {
  const valid = {
    name: 'Test', ingredients: ['a'], directions: ['b'],
    imageUrl: '', link: 'https://x', yield: '', prepTime: '', cookTime: '',
  };

  it('accepts a complete valid payload', () => {
    expect(validateRecipePayload(valid)).toEqual({ ok: true, value: valid });
  });

  it('rejects missing name', () => {
    const r = validateRecipePayload({ ...valid, name: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/);
  });

  it('rejects non-array ingredients', () => {
    const r = validateRecipePayload({ ...valid, ingredients: 'not an array' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ingredients/);
  });

  it('coerces missing optional fields to empty strings', () => {
    const r = validateRecipePayload({ name: 'x', ingredients: [], directions: [] });
    expect(r.ok).toBe(true);
    expect(r.value.link).toBe('');
    expect(r.value.yield).toBe('');
    expect(r.value.imageUrl).toBe('');
  });
});
