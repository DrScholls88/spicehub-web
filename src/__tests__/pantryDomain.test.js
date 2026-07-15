// pantryDomain.test.js — P4 shared pantry backend: domain flags, filtering,
// staples, kitchen categorization, freshness, and the semantic quantity enum.
import { describe, it, expect } from 'vitest';
import {
  QTY_LEVELS,
  QTY_FILL,
  QTY_LABEL,
  getDomainFlags,
  filterRecordsByDomain,
  isStaple,
  categorizeKitchen,
  freshnessOf,
  KITCHEN_STAPLES,
  STORAGE_TIPS,
  STAPLE_GROUPS,
} from '../lib/pantryDomain';

describe('semantic quantity enum', () => {
  it('is the four string levels in fill order', () => {
    expect(QTY_LEVELS).toEqual(['EMPTY', 'LOW', 'MEDIUM', 'FULL']);
    QTY_LEVELS.forEach(l => expect(typeof l).toBe('string'));
  });

  it('fill values map 0..3 in order and every level has a label', () => {
    expect(QTY_LEVELS.map(l => QTY_FILL[l])).toEqual([0, 1, 2, 3]);
    QTY_LEVELS.forEach(l => expect(typeof QTY_LABEL[l]).toBe('string'));
  });
});

describe('getDomainFlags', () => {
  it('flags pure bar items as drink-only', () => {
    for (const name of ['gin', 'bourbon', 'vodka', 'angostura bitters', 'dry vermouth']) {
      const f = getDomainFlags(name);
      expect(f.canDrink, name).toBe(true);
      expect(f.canBoth, name).toBe(false);
    }
  });

  it('flags pure kitchen items as eat-only', () => {
    for (const name of ['chicken breast', 'ground beef', 'spinach', 'pasta', 'cheddar cheese']) {
      const f = getDomainFlags(name);
      expect(f.canEat, name).toBe(true);
      expect(f.canDrink, name).toBe(false);
      expect(f.canBoth, name).toBe(false);
    }
  });

  it('flags crossover items as both', () => {
    for (const name of ['lemon', 'fresh lime', 'mint', 'sugar', 'honey', 'eggs', 'heavy cream', 'ginger']) {
      const f = getDomainFlags(name);
      expect(f.canBoth, name).toBe(true);
      expect(f.canDrink, name).toBe(true);
      expect(f.canEat, name).toBe(true);
    }
  });

  it('assumes unknown ingredients are edible (open kitchen, closed bar)', () => {
    const f = getDomainFlags('dragonfruit spread');
    expect(f.canEat).toBe(true);
    expect(f.canDrink).toBe(false);
  });

  it('handles junk input without throwing', () => {
    expect(getDomainFlags('')).toEqual({ canDrink: false, canEat: false, canBoth: false });
    expect(getDomainFlags(null).canBoth).toBe(false);
  });
});

describe('filterRecordsByDomain', () => {
  const records = [
    { ingredient: 'gin' },            // bar only
    { ingredient: 'chicken breast' }, // kitchen only
    { ingredient: 'lemon' },          // both
    { ingredient: 'sugar' },          // both
  ];

  it('returns everything for domain=all', () => {
    expect(filterRecordsByDomain(records, 'all')).toHaveLength(4);
  });

  it('bar domain keeps drinkables + crossovers, drops kitchen-only', () => {
    const names = filterRecordsByDomain(records, 'bar').map(r => r.ingredient);
    expect(names).toContain('gin');
    expect(names).toContain('lemon');
    expect(names).toContain('sugar');
    expect(names).not.toContain('chicken breast');
  });

  it('kitchen domain keeps edibles + crossovers, drops bar-only', () => {
    const names = filterRecordsByDomain(records, 'kitchen').map(r => r.ingredient);
    expect(names).toContain('chicken breast');
    expect(names).toContain('lemon');
    expect(names).toContain('sugar');
    expect(names).not.toContain('gin');
  });

  it('tolerates malformed input', () => {
    expect(filterRecordsByDomain(null, 'bar')).toEqual([]);
    expect(filterRecordsByDomain([{}], 'kitchen')).toHaveLength(1); // unknown → edible
  });
});

describe('staples & kitchen categories', () => {
  it('recognizes core staples (with canonicalization)', () => {
    expect(isStaple('salt')).toBe(true);
    expect(isStaple('Olive Oil')).toBe(true);
    expect(isStaple('2 cups flour')).toBe(true);
    expect(isStaple('saffron threads')).toBe(false);
  });

  it('every declared staple resolves as a staple', () => {
    for (const s of KITCHEN_STAPLES) expect(isStaple(s), s).toBe(true);
  });

  it('categorizes kitchen items and every category has a storage tip', () => {
    expect(categorizeKitchen('chicken thighs')?.category).toBe('protein');
    expect(categorizeKitchen('baby spinach')?.category).toBe('produce');
    expect(categorizeKitchen('parmesan')?.category).toBe('dairy');
    expect(categorizeKitchen('jasmine rice')?.category).toBe('grains');
    expect(categorizeKitchen('smoked paprika')?.category).toBe('spices');
    expect(categorizeKitchen('olive oil')?.category).toBe('oils');
    expect(categorizeKitchen('canned black beans')?.category).toBe('legumes');
    expect(categorizeKitchen('chickpeas')?.category).toBe('legumes');
    // Ambiguous/generic "beans" and fresh "green beans" stay produce —
    // only the named legumes above get the shelf-stable legumes bucket.
    expect(categorizeKitchen('green beans')?.category).toBe('produce');
    for (const { category } of [
      { category: 'protein' }, { category: 'produce' }, { category: 'dairy' },
      { category: 'grains' }, { category: 'spices' }, { category: 'baking' },
      { category: 'oils' }, { category: 'condiments' }, { category: 'legumes' },
    ]) {
      expect(typeof STORAGE_TIPS[category]).toBe('string');
    }
  });
});

describe('STAPLE_GROUPS — "Dry Pantry Vault" sub-categories', () => {
  it('covers every KITCHEN_STAPLES item exactly once', () => {
    const grouped = STAPLE_GROUPS.flatMap(g => g.items);
    // No dupes across (or within) groups...
    expect(new Set(grouped).size).toBe(grouped.length);
    // ...and the set matches KITCHEN_STAPLES exactly (nothing missing, nothing extra).
    expect(new Set(grouped)).toEqual(new Set(KITCHEN_STAPLES));
  });

  it('every group has a label and a non-empty items array', () => {
    for (const g of STAPLE_GROUPS) {
      expect(typeof g.label).toBe('string');
      expect(g.label.length).toBeGreaterThan(0);
      expect(Array.isArray(g.items)).toBe(true);
      expect(g.items.length).toBeGreaterThan(0);
    }
  });
});

describe('freshnessOf', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  it('buckets fresh / aging / old', () => {
    expect(freshnessOf(daysAgo(1))).toBe('fresh');
    expect(freshnessOf(daysAgo(4))).toBe('aging');
    expect(freshnessOf(daysAgo(9))).toBe('old');
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(freshnessOf(undefined)).toBeNull();
    expect(freshnessOf('not-a-date')).toBeNull();
  });
});
