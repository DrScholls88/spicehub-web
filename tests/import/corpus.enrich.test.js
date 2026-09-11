import { describe, it, expect, beforeEach } from 'vitest';
import { findCorpusMatch, enrichDrinkFromCorpus } from '../../src/import/enrich.js';

// ─────────────────────────────────────────────────────────────────────────
// Idea 1 — "enrich thin imports". Corpus-assisted backfill for user-locked
// drink imports: fills blank glass/method/garnish/abv and appends genuinely
// missing measured ingredients from SEED_COCKTAILS, never overwriting
// anything the extraction already got right, and never running unless the
// caller has locked kind:'drink'.
// ─────────────────────────────────────────────────────────────────────────

function thinDrink(overrides = {}) {
  return {
    title: 'Old Fashioned',
    ingredients: ['2 oz bourbon', '2 dashes Angostura bitters'],
    ingredientsStructured: [
      { ref: 'r1', quantity: '2', unit: 'oz', name: 'bourbon', prep: '', category: 'liquor', section: '', original_text: '2 oz bourbon', display: '2 oz bourbon' },
      { ref: 'r2', quantity: '2', unit: 'dash', name: 'Angostura bitters', prep: '', category: 'liquor', section: '', original_text: '2 dashes Angostura bitters', display: '2 dashes Angostura bitters' },
    ],
    directions: ['Stir with ice.', 'Strain into a rocks glass.'],
    glass: '',
    garnish: '',
    method: '',
    abv: null,
    _type: 'drink',
    ...overrides,
  };
}

describe('findCorpusMatch', () => {
  it('matches an exact (case/whitespace-insensitive) drink name', () => {
    const match = findCorpusMatch('old fashioned');
    expect(match).toBeTruthy();
    expect(match.name).toBe('Old Fashioned');
  });

  it('matches when the imported title wraps the canonical name in flourish', () => {
    const match = findCorpusMatch('The Best Old Fashioned You Will Ever Make');
    expect(match).toBeTruthy();
    expect(match.name).toBe('Old Fashioned');
  });

  it('does NOT match in the reverse direction (bare "Martini" vs "Dirty Martini")', () => {
    // Corpus has "Dirty Martini" and "French Martini" but no plain "Martini" —
    // a bare query must not spuriously latch onto either.
    expect(findCorpusMatch('Martini')).toBeNull();
  });

  it('returns null for a name with no corpus match', () => {
    expect(findCorpusMatch('Xyzzy Plugh Frotz')).toBeNull();
  });

  it('returns null for empty/too-short input', () => {
    expect(findCorpusMatch('')).toBeNull();
    expect(findCorpusMatch('ab')).toBeNull();
  });
});

describe('enrichDrinkFromCorpus', () => {
  it('fills blank glass/method/garnish/abv from the matched corpus entry', () => {
    const recipe = thinDrink();
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });

    expect(recipe.glass).toBe('rocks');
    expect(recipe.method).toBe('stir');
    expect(recipe.garnish).toBe('Orange peel, cherry');
    expect(recipe.abv).toBe(27);
  });

  it('never overwrites a field the extraction already populated', () => {
    const recipe = thinDrink({ glass: 'coupe', method: 'shake', garnish: 'Lime twist', abv: 15 });
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });

    expect(recipe.glass).toBe('coupe');
    expect(recipe.method).toBe('shake');
    expect(recipe.garnish).toBe('Lime twist');
    expect(recipe.abv).toBe(15);
  });

  it('appends a genuinely missing measured ingredient without duplicating extracted ones', () => {
    // Extraction caught bourbon + bitters but dropped the simple syrup line.
    const recipe = thinDrink();
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });

    expect(recipe.ingredients).toHaveLength(3);
    expect(recipe.ingredients.join('\n')).toMatch(/simple syrup/i);
    // Originals stay untouched and are not re-added.
    expect(recipe.ingredients.filter((l) => /bourbon/i.test(l))).toHaveLength(1);
    expect(recipe.ingredients.filter((l) => /angostura/i.test(l))).toHaveLength(1);

    // The structured sidecar grows in lockstep with the flat array.
    expect(recipe.ingredientsStructured).toHaveLength(3);
    expect(recipe.ingredientsStructured.at(-1).name.toLowerCase()).toContain('simple syrup');
  });

  it('adds nothing when the extraction already has every corpus ingredient', () => {
    const recipe = thinDrink({
      ingredients: ['2 oz bourbon', '0.25 oz simple syrup', '2 dashes Angostura bitters'],
    });
    const before = [...recipe.ingredients];
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });
    expect(recipe.ingredients).toEqual(before);
  });

  it('does nothing when the extraction has zero ingredients (gate.js handles that case)', () => {
    const recipe = thinDrink({ ingredients: [], ingredientsStructured: [] });
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.glass).toBe('rocks'); // field backfill is independent of ingredient backfill
  });

  it('is a no-op when the drink name has no corpus match', () => {
    const recipe = thinDrink({ title: 'Xyzzy Plugh Frotz' });
    const before = JSON.parse(JSON.stringify(recipe));
    enrichDrinkFromCorpus(recipe, { kind: 'drink', kindLocked: true });
    expect(recipe).toEqual(before);
  });

  it('is a no-op unless kind is drink AND kindLocked is true', () => {
    const notLocked = thinDrink();
    enrichDrinkFromCorpus(notLocked, { kind: 'drink', kindLocked: false });
    expect(notLocked.glass).toBe('');

    const notDrinkKind = thinDrink();
    enrichDrinkFromCorpus(notDrinkKind, { kind: 'meal', kindLocked: true });
    expect(notDrinkKind.glass).toBe('');

    const neither = thinDrink();
    enrichDrinkFromCorpus(neither, {});
    expect(neither.glass).toBe('');
  });

  it('handles a null recipe gracefully', () => {
    expect(enrichDrinkFromCorpus(null, { kind: 'drink', kindLocked: true })).toBeNull();
  });
});
