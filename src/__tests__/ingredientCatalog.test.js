import { describe, it, expect } from 'vitest';
import { INGREDIENT_CATALOG, ALL_CATALOG_ITEMS } from '../data/bar/ingredientCatalog';
import { spriteSpec } from '../lib/barSprites.jsx';

const VALID_KINDS = new Set(['bottle', 'can', 'citrus', 'herb', 'garnish', 'glass', 'ice', 'egg', 'sugar']);

describe('ingredient catalog', () => {
  it('is a vast, well-formed catalog', () => {
    expect(INGREDIENT_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(ALL_CATALOG_ITEMS.length).toBeGreaterThanOrEqual(150);
    for (const section of INGREDIENT_CATALOG) {
      expect(typeof section.key).toBe('string');
      expect(typeof section.label).toBe('string');
      expect(Array.isArray(section.items)).toBe(true);
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate item names (case-insensitive)', () => {
    const seen = new Set();
    const dupes = [];
    for (const name of ALL_CATALOG_ITEMS) {
      const k = name.toLowerCase();
      if (seen.has(k)) dupes.push(name);
      seen.add(k);
    }
    expect(dupes).toEqual([]);
  });

  it('every catalog item resolves to a valid sprite kind', () => {
    for (const name of ALL_CATALOG_ITEMS) {
      const spec = spriteSpec(name);
      expect(VALID_KINDS.has(spec.kind)).toBe(true);
      expect(spec.palette).toBeTruthy();
    }
  });

  it('produces good sprite variety across the catalog', () => {
    const combos = new Set(ALL_CATALOG_ITEMS.map((n) => {
      const s = spriteSpec(n);
      return `${s.kind}:${s.shape}:${s.palette.body}`;
    }));
    // A wall of identical bottles would collapse to a few combos; expect many.
    expect(combos.size).toBeGreaterThan(20);
  });
});
