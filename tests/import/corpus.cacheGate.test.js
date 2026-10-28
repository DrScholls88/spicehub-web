// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — the import cache only keeps what the gate lets through
// ─────────────────────────────────────────────────────────────────────────────
// Every Instagram-path cache write goes through cacheIfNotEmpty. A bait caption
// ("full recipe on my blog") with a thin result, or a one-ingredient result,
// must never be cached: a cached miss is re-served for 7 days on every retry.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setCachedImport = vi.fn(async () => {});
vi.mock('../../src/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  setCachedImport: (...args) => setCachedImport(...args),
}));

const { cacheIfNotEmpty } = await import('../../src/recipeParser.js');

const good = {
  name: 'Garlic butter chicken',
  ingredients: ['2 chicken breasts', '3 cloves garlic', '2 tbsp butter'],
  directions: ['Sear the chicken.', 'Add garlic and butter.'],
};

describe('cacheIfNotEmpty', () => {
  beforeEach(() => setCachedImport.mockClear());

  it('caches a real recipe', async () => {
    await cacheIfNotEmpty('https://instagram.com/p/a', good, 'meal', 'Garlic butter chicken recipe');
    expect(setCachedImport).toHaveBeenCalledTimes(1);
  });

  it('does not cache a one-ingredient result', async () => {
    await cacheIfNotEmpty('https://instagram.com/p/b', { ...good, ingredients: ['chicken'] }, 'meal', '');
    expect(setCachedImport).not.toHaveBeenCalled();
  });

  it('does not cache a thin result from a bait caption', async () => {
    await cacheIfNotEmpty(
      'https://instagram.com/p/c',
      { ...good, ingredients: ['chicken', 'garlic'] },
      'meal',
      'So good!! Full recipe on my blog, link in bio',
    );
    expect(setCachedImport).not.toHaveBeenCalled();
  });

  it('caches a two-ingredient drink', async () => {
    await cacheIfNotEmpty(
      'https://instagram.com/p/d',
      { name: 'Gin and tonic', ingredients: ['2 oz gin', '4 oz tonic'], directions: ['Build over ice.'] },
      'drink',
      'Gin and tonic: 2 oz gin, 4 oz tonic',
    );
    expect(setCachedImport).toHaveBeenCalledTimes(1);
  });
});
