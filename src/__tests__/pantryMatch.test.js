// pantryMatch.test.js — tiered meal matching against pantry inventory.
// Verifies the BarLibrary-style ready/almost tiering and the staple exemption
// (a staple never counts as a missing ingredient — see pantryDomain.isStaple).
import { describe, it, expect } from 'vitest';
import { findPantryMatches, buildPantryMatchIndex, matchMealAgainstPantry, getMatchTier } from '../lib/pantryMatch';
import { normalizeIngredient } from '../utils/ingredientNormalizer.js';

// Fixture pantry: two non-staple items on hand (chicken, spinach). Salt/olive
// oil/garlic are staples (see pantryDomain.KITCHEN_STAPLES) and deliberately
// NOT in this list — they should still count as matched.
const fridgeInventory = [
  { ingredient: 'chicken breast' },
  { ingredient: 'spinach' },
];

function meal(id, name, ingredientNames) {
  return {
    id,
    name,
    ingredientsStructured: ingredientNames.map(n => ({ name: n })),
  };
}

const readyMeal = meal('m1', 'Garlic Chicken', ['chicken breast', 'garlic', 'salt']);
const almostMeal = meal('m2', 'Spinach Salad', ['spinach', 'feta cheese', 'salt']);
const farMeal = meal('m3', 'Beef Wellington', ['beef tenderloin', 'puff pastry', 'mushrooms', 'foie gras']);
const meals = [readyMeal, almostMeal, farMeal];

// matchMealAgainstPantry looks up the pantry set using the same
// normalizeIngredient().canonical key buildPantrySet() would have used to
// populate it — build fixtures the same way, rather than the raw name, so
// the test reflects real call sites instead of the normalizer's internals.
function canonOf(name) {
  const r = normalizeIngredient(name);
  return r?.canonical || name.toLowerCase().trim();
}

describe('matchMealAgainstPantry', () => {
  it('treats staples as always matched, never missing', () => {
    const pantrySet = new Set([canonOf('chicken breast')]);
    const scored = matchMealAgainstPantry(readyMeal, pantrySet);
    // garlic + salt are staples -> matched without being in pantrySet
    expect(scored.matched).toBe(3);
    expect(scored.missing).toEqual([]);
  });

  it('lists non-staple, non-pantry ingredients as missing', () => {
    const pantrySet = new Set([canonOf('spinach')]);
    const scored = matchMealAgainstPantry(almostMeal, pantrySet);
    expect(scored.missing).toEqual(['feta cheese']);
  });

  it('returns null for a meal with no structured ingredients', () => {
    expect(matchMealAgainstPantry({ id: 'x', ingredientsStructured: [] }, new Set())).toBeNull();
    expect(matchMealAgainstPantry({ id: 'x' }, new Set())).toBeNull();
  });
});

describe('getMatchTier', () => {
  it('is "ready" at 0 missing, "almost" at 1-2, null above that', () => {
    expect(getMatchTier({ missing: [] })).toBe('ready');
    expect(getMatchTier({ missing: ['a'] })).toBe('almost');
    expect(getMatchTier({ missing: ['a', 'b'] })).toBe('almost');
    expect(getMatchTier({ missing: ['a', 'b', 'c'] })).toBeNull();
  });
});

describe('findPantryMatches', () => {
  it('buckets meals into ready/almost and excludes far misses', () => {
    const { ready, almost } = findPantryMatches(fridgeInventory, meals);
    expect(ready.map(r => r.meal.id)).toEqual(['m1']);
    expect(almost.map(r => r.meal.id)).toEqual(['m2']);
    expect(ready.some(r => r.meal.id === 'm3')).toBe(false);
    expect(almost.some(r => r.meal.id === 'm3')).toBe(false);
  });

  it('returns empty buckets with no inventory or no meals', () => {
    expect(findPantryMatches([], meals)).toEqual({ ready: [], almost: [] });
    expect(findPantryMatches(fridgeInventory, [])).toEqual({ ready: [], almost: [] });
  });
});

describe('buildPantryMatchIndex', () => {
  it('indexes every ready/almost meal by id, and omits far misses', () => {
    const index = buildPantryMatchIndex(fridgeInventory, meals);
    expect(index.get('m1')).toMatchObject({ tier: 'ready', matched: 3, total: 3 });
    expect(index.get('m2')).toMatchObject({ tier: 'almost', missing: ['feta cheese'] });
    expect(index.has('m3')).toBe(false);
  });
});
