import { describe, it, expect } from 'vitest';
import { enforceDeterministicRules } from '../recipeParser.js';

// Regression: nutrition macro panels and ingredient/serving headers that the
// model (or heuristic) emits as STEPS were never stripped — directions had no
// trash sweep. They should now be removed from both lists.

describe('enforceDeterministicRules — direction trash + nutrition', () => {
  it('strips a nutrition panel and an ingredients header out of the steps', () => {
    const out = enforceDeterministicRules({
      ingredients: ['2 chicken thighs', 'fajita seasoning'],
      directions: [
        '394 Calories | 43g Protein | 27g Carbs |',
        'Ingredients (Makes 10 Servings / Wraps)',
        'Cube the chicken thighs and season with fajita seasoning.',
        'Line a large sheet pan with baking paper.',
      ],
    });
    expect(out.directions).not.toContain('394 Calories | 43g Protein | 27g Carbs |');
    expect(out.directions.some((d) => /Makes 10 Servings/.test(d))).toBe(false);
    expect(out.directions).toContain('Cube the chicken thighs and season with fajita seasoning.');
    expect(out.directions).toContain('Line a large sheet pan with baking paper.');
  });

  it('strips a nutrition line out of ingredients too', () => {
    const out = enforceDeterministicRules({
      ingredients: ['250 Calories, 12g Fat, 30g Carbs', '1 cup flour'],
      directions: ['Mix well.'],
    });
    expect(out.ingredients).not.toContain('250 Calories, 12g Fat, 30g Carbs');
    expect(out.ingredients).toContain('1 cup flour');
  });

  it('does NOT strip a real gram-weight ingredient', () => {
    const out = enforceDeterministicRules({
      ingredients: ['200g sugar', '100g protein powder'],
      directions: ['Combine.'],
    });
    expect(out.ingredients).toContain('200g sugar');
    expect(out.ingredients).toContain('100g protein powder');
  });
});
