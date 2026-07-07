import { describe, expect, it } from 'vitest';
import { STARTER_KIT_MEALS, buildStarterKitMeals } from '../data/starterKitMeals.js';

describe('StarterKitMeals seed pack', () => {
  it('exports reviewed meal-shaped seed data instead of legacy Paprika rows', () => {
    expect(STARTER_KIT_MEALS.length).toBeGreaterThan(0);

    for (const meal of STARTER_KIT_MEALS) {
      expect(meal.name).toEqual(expect.any(String));
      expect(Array.isArray(meal.ingredients)).toBe(true);
      expect(Array.isArray(meal.directions)).toBe(true);
      expect(Array.isArray(meal.notes)).toBe(true);
      expect(meal.sourceUrl).toBeDefined();
      expect(meal.link).toBeUndefined();
      expect(meal.id).toBeUndefined();
      expect(meal.jobId).toBeUndefined();
    }
  });

  it('preserves high-quality import-engine fields while stamping starter metadata', () => {
    const reviewedMeal = {
      name: 'Reviewed Seed Meal',
      ingredients: ['1 cup rice'],
      directions: ['Cook the rice.'],
      ingredientsStructured: [
        {
          raw: '1 cup rice',
          quantity: '1',
          unit: 'cup',
          item: 'rice',
          kind: 'ingredient',
          confidence: { score: 0.95, label: 'high' },
        },
      ],
      directionsStructured: [{ text: 'Cook the rice.', ingredientRefs: ['rice'] }],
      ingredients_text: '1 cup rice',
      sourceUrl: 'https://example.com/reviewed',
      notes: [{ title: 'Admin', text: 'Reviewed through Import Engine.' }],
      confidence: { score: 0.92, label: 'high' },
      _structuredVia: 'gemini:test',
      needsReview: false,
      status: 'saved',
      jobId: 'local-only-job',
      id: 123,
    };

    const [seeded] = buildStarterKitMeals([reviewedMeal], '2026-07-07T12:00:00.000Z');

    expect(seeded).toMatchObject({
      name: 'Reviewed Seed Meal',
      starterKit: true,
      inRotation: true,
      importedAt: '2026-07-07T12:00:00.000Z',
      ingredientsStructured: reviewedMeal.ingredientsStructured,
      directionsStructured: reviewedMeal.directionsStructured,
      confidence: reviewedMeal.confidence,
      _structuredVia: 'gemini:test',
    });
    expect(seeded.id).toBeUndefined();
    expect(seeded.jobId).toBeUndefined();
    expect(seeded.status).toBeUndefined();
  });
});
