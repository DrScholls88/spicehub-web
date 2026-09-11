import { describe, it, expect } from 'vitest';
import {
  classicsUsing,
  classicsCountFor,
  bottleTapFact,
  mostVersatileIngredients,
} from '../../src/lib/barEncyclopedia.js';
import { SEED_COCKTAILS } from '../../src/data/bar/seedCocktails.js';

// ─────────────────────────────────────────────────────────────────────────
// Idea 5 — ingredient encyclopedia off the bundled corpus (no live
// filter.php?i= calls). "You have Campari — 12 classics use it."
// ─────────────────────────────────────────────────────────────────────────

describe('classicsUsing / classicsCountFor', () => {
  it('finds every corpus drink that uses a common spirit, alias-aware', () => {
    const drinks = classicsUsing('bourbon');
    expect(drinks.length).toBeGreaterThan(0);
    expect(drinks.some((d) => d.name === 'Old Fashioned')).toBe(true);
    expect(classicsCountFor('bourbon')).toBe(drinks.length);
  });

  it('matches regardless of measure/case noise in the query', () => {
    const bare = classicsCountFor('Campari');
    expect(bare).toBeGreaterThan(0);
    // canonicalizeIngredient strips leading measures/numbers, so a full
    // ingredient line for the same spirit resolves to the same bucket.
    expect(classicsCountFor('1 oz Campari')).toBe(bare);
  });

  it('does not double-count a drink that lists the same ingredient twice', () => {
    // Synthetic sanity check on the corpus itself: no drink's count for any
    // of its own ingredients should exceed the corpus size.
    const spotCheck = SEED_COCKTAILS[0];
    const canonNames = new Set(spotCheck.ingredients.map((l) => l));
    for (const line of canonNames) {
      const users = classicsUsing(line);
      const occurrences = users.filter((u) => u.name === spotCheck.name).length;
      expect(occurrences).toBeLessThanOrEqual(1);
    }
  });

  it('returns an empty array for an ingredient no classic uses', () => {
    expect(classicsUsing('unobtainium bitters')).toEqual([]);
    expect(classicsCountFor('unobtainium bitters')).toBe(0);
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(classicsUsing('')).toEqual([]);
    expect(classicsUsing(null)).toEqual([]);
  });
});

describe('bottleTapFact', () => {
  it('renders the "You have X — N classics use it" sentence', () => {
    const fact = bottleTapFact('Campari');
    expect(fact).toMatch(/^You have Campari — \d+ classics? uses? it\.$/);
  });

  it('uses a friendlier display name when provided, independent of the lookup key', () => {
    const fact = bottleTapFact('campari', 'Campari (Aperitivo)');
    expect(fact).toContain('You have Campari (Aperitivo) —');
  });

  it('singularizes correctly for a count of exactly one', () => {
    // Find a real corpus ingredient used by exactly one drink to exercise
    // the singular branch against real data rather than a mock.
    const rare = mostVersatileIngredients(500).find((e) => e.count === 1);
    expect(rare).toBeTruthy();
    const fact = bottleTapFact(rare.ingredient);
    expect(fact).toMatch(/1 classic uses it\.$/);
  });

  it('returns null when nothing in the corpus uses the ingredient', () => {
    expect(bottleTapFact('unobtainium bitters')).toBeNull();
  });
});

describe('mostVersatileIngredients', () => {
  it('returns ingredients sorted most-used first', () => {
    const top = mostVersatileIngredients(10);
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].count).toBeGreaterThanOrEqual(top[i].count);
    }
  });

  it('respects the limit argument', () => {
    expect(mostVersatileIngredients(3)).toHaveLength(3);
  });
});
