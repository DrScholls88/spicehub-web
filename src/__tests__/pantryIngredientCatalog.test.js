import { describe, it, expect } from 'vitest';
import { INGREDIENT_CATALOG, ALL_CATALOG_ITEMS } from '../data/pantry/ingredientCatalog';
import { spriteSpec } from '../lib/barSprites.jsx';
import { isStaple, KITCHEN_STAPLES } from '../lib/pantryDomain';

// Mirrors src/__tests__/ingredientCatalog.test.js (the Bar's catalog test),
// same shared sprite engine and same "vast, well-formed, no dupes" bar —
// plus one Pantry-specific invariant: nothing in this browse catalog may
// collide with a KITCHEN_STAPLES name, since staples already have a
// permanent home in the Staples Vault and isStaple() hides them from the
// Fresh grid (see feedback_pantry_tile_declutter_2026_07_12 /
// project_pantry_veg_vegan_expansion_2026_07_12 memory for why that split
// matters).
const VALID_KINDS = new Set([
  'bottle', 'can', 'citrus', 'herb', 'garnish', 'glass', 'ice', 'egg', 'sugar',
  'produce', 'protein', 'dairy', 'drygood', 'jar', 'shaker',
]);

describe('pantry ingredient catalog', () => {
  it('is a massive, well-formed catalog', () => {
    expect(INGREDIENT_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(ALL_CATALOG_ITEMS.length).toBeGreaterThanOrEqual(300);
    for (const section of INGREDIENT_CATALOG) {
      expect(typeof section.key).toBe('string');
      expect(typeof section.label).toBe('string');
      expect(typeof section.emoji).toBe('string');
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

  it('never duplicates a KITCHEN_STAPLES name', () => {
    // A staple "added" from this browse sheet would silently vanish from
    // the Fresh grid (isStaple() filters it out) — confusing, so the
    // catalog must stay disjoint from the Staples Vault by construction.
    const collisions = ALL_CATALOG_ITEMS.filter((name) => isStaple(name));
    expect(collisions).toEqual([]);
    // Sanity check the invariant is actually exercising real staples, not
    // a vacuously-true empty list.
    expect(KITCHEN_STAPLES.length).toBeGreaterThan(0);
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
    // A wall of near-duplicate produce icons would collapse to a handful
    // of combos; expect wide variety given 400+ distinct items.
    expect(combos.size).toBeGreaterThan(40);
  });

  it('leans vegetarian/vegan the way the rest of Pantry does', () => {
    // Not a hard gate on every item (meat/seafood belongs in a full pantry
    // catalog), just a floor check that plant-based coverage is real and
    // not an afterthought — matches the KITCHEN_STAPLES/FRESH_QUICK_ADDS
    // vegetarian/vegan expansion already shipped for the rest of Pantry.
    const plantSection = INGREDIENT_CATALOG.find((s) => s.key === 'plant_protein');
    expect(plantSection).toBeTruthy();
    expect(plantSection.items.length).toBeGreaterThanOrEqual(15);
  });
});
