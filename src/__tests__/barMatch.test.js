import { describe, it, expect } from 'vitest';
import {
  categorizeBottle,
  canonicalizeIngredient,
  matchDrink,
  pickSurprise,
} from '../lib/barMatch.js';

describe('canonicalizeIngredient', () => {
  it('strips measures, quantities and filler words', () => {
    expect(canonicalizeIngredient('2 oz fresh lime juice')).toBe('lime juice');
    expect(canonicalizeIngredient('1/2 cup simple syrup')).toBe('simple syrup');
    expect(canonicalizeIngredient('a dash of Angostura bitters')).toBe('angostura bitters');
  });

  it('applies alias groups to a canonical form', () => {
    expect(canonicalizeIngredient('club soda')).toBe('soda water');
    expect(canonicalizeIngredient('whisky')).toBe('whiskey');
    expect(canonicalizeIngredient('caster sugar')).toBe('superfine sugar');
  });
});

describe('categorizeBottle', () => {
  it('maps members to their category', () => {
    expect(categorizeBottle('Bulleit Bourbon')).toBe('whiskey');
    expect(categorizeBottle('London Dry Gin')).toBe('gin');
    expect(categorizeBottle('Cointreau')).toBe('orange liqueur');
  });

  it('does not false-match substrings (ice is not juice)', () => {
    expect(categorizeBottle('ice')).toBeNull();
  });

  it('returns null for unknown items', () => {
    expect(categorizeBottle('dragonfruit')).toBeNull();
  });
});

describe('matchDrink — tiers', () => {
  const margarita = {
    id: 1,
    name: 'Margarita',
    ingredients: ['2 oz tequila', '1 oz triple sec', '1 oz lime juice'],
  };

  it('marks a fully-stocked drink as ready', () => {
    const m = matchDrink(margarita, ['tequila', 'cointreau', 'fresh lime juice']);
    expect(m.tier).toBe('ready');
    expect(m.missing).toHaveLength(0);
    expect(m.score).toBe(1);
  });

  it('marks a one-short drink as almost', () => {
    const m = matchDrink(margarita, ['tequila', 'triple sec']);
    expect(m.tier).toBe('almost');
    expect(m.missing).toHaveLength(1);
  });

  it('marks a two-plus-short drink as reach', () => {
    const m = matchDrink(margarita, ['tequila']);
    expect(m.tier).toBe('reach');
    expect(m.missing.length).toBeGreaterThanOrEqual(2);
  });

  it('does not match ice against juice', () => {
    const m = matchDrink({ ingredients: ['lime juice'] }, ['ice']);
    expect(m.matched).toHaveLength(0);
    expect(m.missing).toHaveLength(1);
  });
});

describe('matchDrink — category interchange', () => {
  it('satisfies a bourbon call with rye on the shelf (whiskey interchangeable)', () => {
    const oldFashioned = { ingredients: ['bourbon', 'sugar', 'angostura bitters'] };
    const m = matchDrink(oldFashioned, ['rye', 'sugar', 'angostura bitters']);
    expect(m.tier).toBe('ready');
  });
});

describe('matchDrink — derivable ingredients', () => {
  it('flags simple syrup as derivable from sugar + water', () => {
    const daiquiri = { ingredients: ['white rum', 'lime juice', 'simple syrup'] };
    const m = matchDrink(daiquiri, ['rum', 'lime juice', 'sugar', 'water']);
    expect(m.derivable.map(d => d.result)).toContain('simple syrup');
    expect(m.missing).toHaveLength(0);
    expect(m.tier).toBe('ready');
  });

  it('does not flag derivable when a component is missing', () => {
    const daiquiri = { ingredients: ['white rum', 'lime juice', 'simple syrup'] };
    const m = matchDrink(daiquiri, ['rum', 'lime juice', 'sugar']); // no water
    expect(m.derivable).toHaveLength(0);
    expect(m.missing).toContain('simple syrup');
  });
});

describe('matchDrink — defensive', () => {
  it('handles a drink with no ingredients', () => {
    const m = matchDrink({ ingredients: [] }, ['gin']);
    expect(m.total).toBe(0);
    expect(m.score).toBe(0);
    expect(m.tier).toBe('reach');
  });

  it('handles a malformed drink object', () => {
    const m = matchDrink(null, ['gin']);
    expect(m.total).toBe(0);
  });
});

describe('pickSurprise', () => {
  it('prefers ready/almost tiers', () => {
    const scored = [
      { drink: { id: 1 }, match: { tier: 'reach' } },
      { drink: { id: 2 }, match: { tier: 'ready' } },
    ];
    const pick = pickSurprise(scored);
    expect(pick.match.tier).toBe('ready');
  });

  it('returns null for an empty pool', () => {
    expect(pickSurprise([])).toBeNull();
  });
});
