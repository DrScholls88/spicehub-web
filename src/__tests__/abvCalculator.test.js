import { describe, it, expect } from 'vitest';
import {
  calculateAbv,
  calculateVolumeMl,
  calculateCalories,
  calculateAlcoholUnits,
  getStrengthTier,
} from '../lib/abvCalculator.js';

// ── calculateAbv ──────────────────────────────────────────────────────

describe('calculateAbv', () => {
  it('computes Old Fashioned ABV in the 27-32% range (stirred, 17% dilution)', () => {
    // 2 oz bourbon @ 40%, 0.25 oz simple syrup @ 0%, 1 dash bitters @ 45%
    const ingredients = [
      { amount: 2, strength: 40 },
      { amount: 0.25, strength: 0 },
      { amount: 0.03, strength: 45 }, // ~1 dash in oz
    ];
    const abv = calculateAbv(ingredients, 17);
    expect(abv).toBeGreaterThanOrEqual(27);
    expect(abv).toBeLessThanOrEqual(32);
  });

  it('computes Margarita ABV in the 18-25% range (shaken, 25% dilution)', () => {
    // 2 oz tequila @ 40%, 1 oz lime juice @ 0%, 0.75 oz triple sec @ 30%
    const ingredients = [
      { amount: 2, strength: 40 },
      { amount: 1, strength: 0 },
      { amount: 0.75, strength: 30 },
    ];
    const abv = calculateAbv(ingredients, 25);
    expect(abv).toBeGreaterThanOrEqual(18);
    expect(abv).toBeLessThanOrEqual(25);
  });

  it('returns 0 for a virgin drink (all strengths are 0)', () => {
    const ingredients = [
      { amount: 4, strength: 0 },
      { amount: 2, strength: 0 },
    ];
    expect(calculateAbv(ingredients, 0)).toBe(0);
  });

  it('returns 0 for an empty ingredients array', () => {
    expect(calculateAbv([], 25)).toBe(0);
  });

  it('returns 0 for null/undefined ingredients', () => {
    expect(calculateAbv(null, 10)).toBe(0);
    expect(calculateAbv(undefined, 10)).toBe(0);
  });

  it('handles null dilution by treating it as 0', () => {
    const ingredients = [{ amount: 2, strength: 40 }];
    // No dilution: pure 40% spirit
    expect(calculateAbv(ingredients, null)).toBe(40);
  });

  it('rounds to 2 decimal places', () => {
    const ingredients = [
      { amount: 1.5, strength: 40 },
      { amount: 0.75, strength: 20 },
    ];
    const abv = calculateAbv(ingredients, 10);
    const decimals = String(abv).split('.')[1];
    expect(!decimals || decimals.length <= 2).toBe(true);
  });
});

// ── calculateVolumeMl ─────────────────────────────────────────────────

describe('calculateVolumeMl', () => {
  it('converts oz to ml correctly', () => {
    const result = calculateVolumeMl([{ amount: 1, unit: 'oz' }]);
    expect(result).toBeCloseTo(29.5735, 2);
  });

  it('converts cl to ml correctly', () => {
    const result = calculateVolumeMl([{ amount: 3, unit: 'cl' }]);
    expect(result).toBeCloseTo(30, 2);
  });

  it('converts dash to ml correctly', () => {
    const result = calculateVolumeMl([{ amount: 2, unit: 'dash' }]);
    expect(result).toBeCloseTo(1.8, 2);
  });

  it('converts barspoon to ml correctly', () => {
    const result = calculateVolumeMl([{ amount: 1, unit: 'barspoon' }]);
    expect(result).toBeCloseTo(5, 2);
  });

  it('converts shot to ml correctly', () => {
    const result = calculateVolumeMl([{ amount: 1, unit: 'shot' }]);
    expect(result).toBeCloseTo(44.36, 2);
  });

  it('sums multiple ingredients of different units', () => {
    // 2 oz + 1 oz + 0.75 oz = 3.75 oz = ~110.9 ml
    const result = calculateVolumeMl([
      { amount: 2, unit: 'oz' },
      { amount: 1, unit: 'oz' },
      { amount: 0.75, unit: 'oz' },
    ]);
    expect(result).toBeCloseTo(3.75 * 29.5735, 1);
  });

  it('returns 0 for unknown units', () => {
    expect(calculateVolumeMl([{ amount: 5, unit: 'sprigs' }])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(calculateVolumeMl([])).toBe(0);
  });

  it('returns 0 for null input', () => {
    expect(calculateVolumeMl(null)).toBe(0);
  });

  it('handles ml as a passthrough unit', () => {
    const result = calculateVolumeMl([{ amount: 60, unit: 'ml' }]);
    expect(result).toBe(60);
  });

  it('is case-insensitive for unit names', () => {
    const result = calculateVolumeMl([{ amount: 1, unit: 'OZ' }]);
    expect(result).toBeCloseTo(29.5735, 2);
  });
});

// ── calculateCalories ─────────────────────────────────────────────────

describe('calculateCalories', () => {
  it('computes calories for a known volume and ABV', () => {
    // 100 ml at 40% ABV = 100 * 0.4 * 7 = 280
    expect(calculateCalories(100, 40)).toBe(280);
  });

  it('floors the result to an integer', () => {
    // 90 ml at 13% ABV = 90 * 0.13 * 7 = 81.9 → 81
    expect(calculateCalories(90, 13)).toBe(81);
  });

  it('returns 0 for virgin drinks', () => {
    expect(calculateCalories(200, 0)).toBe(0);
  });

  it('returns 0 for zero volume', () => {
    expect(calculateCalories(0, 40)).toBe(0);
  });

  it('returns 0 for null inputs', () => {
    expect(calculateCalories(null, null)).toBe(0);
  });
});

// ── calculateAlcoholUnits ─────────────────────────────────────────────

describe('calculateAlcoholUnits', () => {
  it('computes UK units for a standard pint of beer', () => {
    // 568 ml at 4% = (568 * 4) / 1000 = 2.272 → 2.27
    expect(calculateAlcoholUnits(568, 4)).toBe(2.27);
  });

  it('returns 0 for non-alcoholic drinks', () => {
    expect(calculateAlcoholUnits(300, 0)).toBe(0);
  });

  it('returns 0 for null inputs', () => {
    expect(calculateAlcoholUnits(null, 40)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // 250 ml at 5.5% = 1.375 → 1.38
    expect(calculateAlcoholUnits(250, 5.5)).toBe(1.38);
  });
});

// ── getStrengthTier ───────────────────────────────────────────────────

describe('getStrengthTier', () => {
  it('returns "virgin" for 0% ABV', () => {
    expect(getStrengthTier(0)).toBe('virgin');
  });

  it('returns "light" for 1-10% ABV', () => {
    expect(getStrengthTier(1)).toBe('light');
    expect(getStrengthTier(5)).toBe('light');
    expect(getStrengthTier(10)).toBe('light');
  });

  it('returns "medium" for 10-20% ABV (exclusive lower bound)', () => {
    expect(getStrengthTier(10.01)).toBe('medium');
    expect(getStrengthTier(15)).toBe('medium');
    expect(getStrengthTier(20)).toBe('medium');
  });

  it('returns "strong" for 20-30% ABV (exclusive lower bound)', () => {
    expect(getStrengthTier(20.01)).toBe('strong');
    expect(getStrengthTier(25)).toBe('strong');
    expect(getStrengthTier(30)).toBe('strong');
  });

  it('returns "very strong" for above 30% ABV', () => {
    expect(getStrengthTier(30.01)).toBe('very strong');
    expect(getStrengthTier(40)).toBe('very strong');
    expect(getStrengthTier(96)).toBe('very strong');
  });

  it('returns "unknown" for null input', () => {
    expect(getStrengthTier(null)).toBe('unknown');
  });

  it('returns "unknown" for undefined input', () => {
    expect(getStrengthTier(undefined)).toBe('unknown');
  });

  it('returns "unknown" for NaN input', () => {
    expect(getStrengthTier(NaN)).toBe('unknown');
  });
});
