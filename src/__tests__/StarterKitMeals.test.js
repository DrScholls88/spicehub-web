import { describe, expect, it } from 'vitest';
import {
  STARTER_KIT_MEALS,
  buildStarterKitMeals,
  isStarterDinner,
  isStarterMealComplete,
  prepareStarterMeal,
} from '../data/starterKitMeals.js';
import { STARTER_KIT_RAW } from '../data/starterKitData.js';

const seed = (over = {}) => ({
  name: 'Gate Fixture',
  ingredients: ['1 lb chicken', '1 onion', '2 cloves garlic', '1 tbsp oil'],
  directions: ['Sear the chicken.', 'Add the rest and simmer.'],
  imageUrl: 'https://example.com/dish.jpg',
  category: 'Dinners',
  ...over,
});

describe('StarterKitMeals seed pack', () => {
  // LAUNCH GATE (spec 2026-09-28 A2): Part A does not ship to testers until the
  // curated pack is 14+ dinners and the gates skip nothing. Red until the pack
  // is re-curated; that is the point.
  it('LAUNCH GATE: 14+ starter dinners, none skipped by the gates', () => {
    expect(STARTER_KIT_MEALS.map((m) => m.name)).toEqual(STARTER_KIT_RAW.map((m) => m.name));
    expect(STARTER_KIT_MEALS.length).toBeGreaterThanOrEqual(14);
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
      // notes / dietaryTags are optional in starterKitData.js; prepareStarterMeal defaults them.
      if (meal.notes !== undefined) expect(Array.isArray(meal.notes)).toBe(true);
      expect(meal.sourceUrl).toMatch(/^https?:\/\//);
      expect(meal.imageUrl).toMatch(/^https?:\/\//);
      expect(meal.imageUrl).not.toMatch(/cdninstagram|fbcdn|scontent/i);
      expect(meal.link).toBeUndefined();
      expect(meal.id).toBeUndefined();
      expect(meal.jobId).toBeUndefined();
      expect(meal.category).toBeTruthy();
      if (meal.dietaryTags !== undefined) expect(Array.isArray(meal.dietaryTags)).toBe(true);
    }
  });

  it('has no multi-recipe dump titles', () => {
    for (const meal of STARTER_KIT_MEALS) {
      expect(meal.name).not.toMatch(/dinner ideas|meal prep ideas|healthy ideas/i);
      expect(meal.ingredients.length).toBeLessThan(50);
    }
  });

  it('dinner gate: only Dinners (after alias normalizing) with a photo pass', () => {
    expect(isStarterDinner(seed())).toBe(true);
    expect(isStarterDinner(seed({ category: 'Main course' }))).toBe(true);
    expect(isStarterDinner(seed({ category: '' }))).toBe(true);
    expect(isStarterDinner(seed({ category: 'Breakfasts' }))).toBe(false);
    expect(isStarterDinner(seed({ category: 'Tailgate' }))).toBe(false);
    expect(isStarterDinner(seed({ category: 'Pasta' }))).toBe(false);
    expect(isStarterDinner(seed({ imageUrl: '' }))).toBe(false);
  });

  it('buildStarterKitMeals drops non-dinners and photo-less rows, lands dinners in The Rotation', () => {
    const built = buildStarterKitMeals([
      seed({ name: 'Keeps' }),
      seed({ name: 'Pancakes', category: 'Breakfasts' }),
      seed({ name: 'No Photo', imageUrl: '' }),
    ]);
    expect(built.map((m) => m.name)).toEqual(['Keeps']);
    expect(built[0].inRotation).toBe(true);
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
