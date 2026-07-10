import { describe, expect, it } from 'vitest';
import {
  STARTER_KIT_MEALS,
  buildStarterKitMeals,
  isStarterMealComplete,
  prepareStarterMeal,
} from '../data/starterKitMeals.js';

describe('StarterKitMeals seed pack', () => {
  it('exports a curated cookable pack (8–12 meals)', () => {
    expect(STARTER_KIT_MEALS.length).toBeGreaterThanOrEqual(8);
    expect(STARTER_KIT_MEALS.length).toBeLessThanOrEqual(12);
  });

  it('every meal meets the quality bar', () => {
    for (const meal of STARTER_KIT_MEALS) {
      expect(isStarterMealComplete(meal)).toBe(true);
      expect(meal.name).toEqual(expect.any(String));
      expect(meal.name.length).toBeGreaterThan(2);
      expect(Array.isArray(meal.ingredients)).toBe(true);
      expect(meal.ingredients.length).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(meal.directions)).toBe(true);
      expect(meal.directions.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(meal.notes)).toBe(true);
      expect(meal.sourceUrl).toMatch(/^https?:\/\//);
      expect(meal.imageUrl).toMatch(/^https?:\/\//);
      expect(meal.imageUrl).not.toMatch(/cdninstagram|fbcdn|scontent/i);
      expect(meal.link).toBeUndefined();
      expect(meal.id).toBeUndefined();
      expect(meal.jobId).toBeUndefined();
      expect(meal.category).toBeTruthy();
      expect(Array.isArray(meal.dietaryTags)).toBe(true);
    }
  });

  it('has no multi-recipe dump titles', () => {
    for (const meal of STARTER_KIT_MEALS) {
      expect(meal.name).not.toMatch(/dinner ideas|meal prep ideas|healthy ideas/i);
      expect(meal.ingredients.length).toBeLessThan(50);
    }
  });

  it('covers dinner spin pool and breakfast variety', () => {
    const cats = STARTER_KIT_MEALS.map((m) => m.category);
    const dinners = cats.filter((c) => /dinner|pasta|casserole/i.test(c) || c === 'Dinners' || c === 'Pasta').length;
    const breakfasts = cats.filter((c) => /breakfast/i.test(c)).length;
    expect(dinners).toBeGreaterThanOrEqual(5);
    expect(breakfasts).toBeGreaterThanOrEqual(1);
  });

  it('preserves high-quality import-engine fields while stamping starter metadata', () => {
    const reviewedMeal = {
      name: 'Reviewed Seed Meal',
      ingredients: ['1 cup rice', '2 cups water', '1 tsp salt', '1 tbsp oil'],
      directions: ['Rinse rice.', 'Boil water.', 'Simmer until tender.'],
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
      directionsStructured: [{ text: 'Rinse rice.', ingredientRefs: ['rice'] }],
      ingredients_text: '1 cup rice',
      sourceUrl: 'https://example.com/reviewed',
      imageUrl: 'https://example.com/rice.jpg',
      notes: [{ title: 'Admin', text: 'Reviewed through Import Engine.' }],
      confidence: 0.92,
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
      confidence: 0.92,
      _structuredVia: 'gemini:test',
    });
    expect(seeded.id).toBeUndefined();
    expect(seeded.jobId).toBeUndefined();
    expect(seeded.status).toBeUndefined();
  });

  it('buildStarterKitMeals stamps starterKit on every complete meal', () => {
    const built = buildStarterKitMeals();
    expect(built.length).toBe(STARTER_KIT_MEALS.length);
    for (const meal of built) {
      expect(meal.starterKit).toBe(true);
      expect(meal.importedAt).toEqual(expect.any(String));
      expect(isStarterMealComplete(meal)).toBe(true);
    }
  });

  it('prepareStarterMeal drops incomplete rows from the pack filter', () => {
    const incomplete = prepareStarterMeal({
      name: 'Broken',
      ingredients: ['salt'],
      directions: ['mix'],
    });
    expect(isStarterMealComplete(incomplete)).toBe(false);
    expect(buildStarterKitMeals([incomplete])).toHaveLength(0);
  });
});
