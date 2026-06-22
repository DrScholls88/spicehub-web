import { describe, it, expect } from 'vitest';
import { structureDeterministic } from '../recipeParser.js';

// Spec C — the deterministic, no-API structuring path. Uses parseCaption +
// parse-ingredient to produce the same Spec-A structured shape an LLM would.
// (Runs under vitest where parse-ingredient resolves.)

describe('structureDeterministic', () => {
  it('returns null on empty input', () => {
    expect(structureDeterministic('')).toBeNull();
    expect(structureDeterministic('   ')).toBeNull();
  });

  it('structures a clear meal caption into Spec-A ingredients', () => {
    const cap = [
      'Creamy Garlic Pasta',
      'Ingredients:',
      '2 cups flour',
      '3 cloves garlic, minced',
      '1 cup heavy cream',
      'Directions:',
      'Boil the pasta until al dente.',
      'Stir in the cream and garlic.',
    ].join('\n');
    const r = structureDeterministic(cap, { type: 'meal' });
    expect(r).toBeTruthy();
    expect(r._structuredVia).toBe('deterministic');
    expect(Array.isArray(r.ingredientsStructured)).toBe(true);
    expect(r.ingredientsStructured.length).toBeGreaterThanOrEqual(3);
    const flour = r.ingredientsStructured.find(i => /flour/i.test(i.name));
    expect(flour).toBeTruthy();
    expect(flour.quantity).toBe('2');
    expect(flour.unit).toBe('cup');
    expect(r.directions.length).toBeGreaterThanOrEqual(2);
  });

  it('detects a drink from cocktail signals', () => {
    const cap = [
      'Classic Margarita',
      'Ingredients:',
      '2 oz tequila',
      '1 oz lime juice',
      '0.75 oz triple sec',
      'Directions:',
      'Shake with ice and strain into a glass.',
    ].join('\n');
    const r = structureDeterministic(cap);
    expect(r).toBeTruthy();
    expect(r._type).toBe('drink');
  });

  it('leaves servings/time/cuisine blank (no offline guessing)', () => {
    const cap = 'Snack\nIngredients:\n1 cup nuts\nDirections:\nMix.';
    const r = structureDeterministic(cap, { type: 'meal' });
    expect(r.servings).toBe('');
    expect(r.cuisine).toBe('');
  });
});
