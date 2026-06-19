import { describe, it, expect } from 'vitest';
import { enforceDeterministicRules, parseCaption } from '../recipeParser.js';
import { thinFromStructured } from '../recipeSchema.js';

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN-CORPUS REGRESSION HARNESS
// ─────────────────────────────────────────────────────────────────────────────
// Offline (no network/LLM) regression net over the deterministic stages of the
// pipeline. Two surfaces are covered:
//   1. Recorded RECIPE_SCHEMA model outputs → thinFromStructured → enforce.
//      (Simulates what Grok/Gemini return; pins the flatten + post-process path.)
//   2. Raw social captions → parseCaption (the no-LLM heuristic fallback).
// Add new tricky real-world cases here over time — this is what turns "it feels
// better now" into "it can't silently get worse again".

// Local invariant helpers (COOKING_VERBS_RE is module-private in recipeParser,
// so we re-declare a conservative subset here for assertions).
const STARTS_WITH_VERB = /^(mix|stir|add|combine|pour|heat|cook|bake|preheat|whisk|blend|fold|season|serve|place|simmer|boil|toss|drizzle|sprinkle|garnish|melt|beat|knead|spread|layer|brush|sear|steam|roast|fry|chop|dice)\b/i;
const BARE_HEADER = /^(ingredients?|directions?|instructions?|method|steps?|preparation)\s*:?\s*$/i;

function assertCleanIngredients(ingredients) {
  for (const ing of ingredients) {
    expect(ing, `ingredient should not start with a cooking verb: "${ing}"`).not.toMatch(STARTS_WITH_VERB);
    expect(ing, `ingredient should not be a bare header: "${ing}"`).not.toMatch(BARE_HEADER);
    expect(ing.trim().length, `ingredient should be non-empty: "${ing}"`).toBeGreaterThan(0);
  }
}

function assertCleanTitle(title) {
  expect(typeof title).toBe('string');
  expect(title.length).toBeLessThanOrEqual(60);
  expect(title).not.toMatch(/#\w/);   // no hashtags
  expect(title).not.toMatch(/@\w/);   // no @handles
}

// ── Fixtures: recorded model (RECIPE_SCHEMA) outputs ─────────────────────────
const SCHEMA_CORPUS = [
  {
    name: 'clean meal (Tuscan chicken)',
    structured: {
      isRecipe: true,
      kind: 'meal',
      title: 'Creamy Tuscan Chicken',
      ingredientGroups: [
        { section: '', items: [
          { quantity: '2', unit: '', name: 'chicken breasts', prep: 'sliced' },
          { quantity: '1', unit: 'cup', name: 'heavy cream' },
          { quantity: '1', unit: 'cup', name: 'spinach' },
          { quantity: '3', unit: 'cloves', name: 'garlic', prep: 'minced' },
        ] },
      ],
      directions: ['Sear the chicken until golden.', 'Add garlic and cream; simmer 5 minutes.', 'Stir in spinach until wilted.'],
      confidence: 0.95,
    },
    expect: { minIngredients: 4, minDirections: 3, maxMoved: 0 },
  },
  {
    name: 'model leaked an action line into ingredients',
    structured: {
      isRecipe: true,
      kind: 'meal',
      title: 'Sheet Pan Gnocchi',
      ingredientGroups: [
        { section: '', items: [
          { quantity: '1', unit: 'lb', name: 'gnocchi' },
          { quantity: '1', unit: 'pint', name: 'cherry tomatoes' },
          // Stray instruction the model wrongly emitted as an ingredient:
          { quantity: '', unit: '', name: 'Toss everything with olive oil and roast' },
        ] },
      ],
      directions: ['Preheat oven to 425F.'],
      confidence: 0.8,
    },
    // The stray line should be pulled into directions by the enforcer.
    expect: { minIngredients: 2, minDirections: 2, minMoved: 1, mustNotBeIngredient: 'Toss everything with olive oil and roast' },
  },
  {
    name: 'cocktail (drink kind) preserves glass/garnish',
    structured: {
      isRecipe: true,
      kind: 'drink',
      title: 'Manhattan',
      glass: 'coupe',
      garnish: 'brandied cherry',
      ingredientGroups: [
        { section: '', items: [
          { quantity: '2', unit: 'oz', name: 'rye whiskey' },
          { quantity: '1', unit: 'oz', name: 'sweet vermouth' },
          { quantity: '2', unit: 'dash', name: 'Angostura bitters' },
        ] },
      ],
      directions: ['Stir with ice and strain into a chilled coupe.'],
      confidence: 0.92,
    },
    expect: { minIngredients: 3, minDirections: 1, maxMoved: 0, drink: true },
  },
];

describe('regression corpus — schema output → thinFromStructured → enforce', () => {
  for (const fx of SCHEMA_CORPUS) {
    it(fx.name, () => {
      const thin = thinFromStructured(fx.structured);
      const out = enforceDeterministicRules({ ...thin, _structuredVia: 'corpus' });

      assertCleanTitle(out.title);
      assertCleanIngredients(out.ingredients);

      expect(out.ingredients.length).toBeGreaterThanOrEqual(fx.expect.minIngredients);
      expect(out.directions.length).toBeGreaterThanOrEqual(fx.expect.minDirections);

      if (typeof fx.expect.maxMoved === 'number') {
        expect(out._postProcessAudit.movedCount).toBeLessThanOrEqual(fx.expect.maxMoved);
      }
      if (typeof fx.expect.minMoved === 'number') {
        expect(out._postProcessAudit.movedCount).toBeGreaterThanOrEqual(fx.expect.minMoved);
      }
      if (fx.expect.mustNotBeIngredient) {
        expect(out.ingredients).not.toContain(fx.expect.mustNotBeIngredient);
        expect(out.directions).toContain(fx.expect.mustNotBeIngredient);
      }
      if (fx.expect.drink) {
        expect(out.glass || thin.glass).toBeTruthy();
        expect(out.garnish || thin.garnish).toBeTruthy();
      }
    });
  }
});

// ── Fixtures: raw social captions → parseCaption (heuristic, no LLM) ─────────
const CAPTION_CORPUS = [
  {
    name: 'IG-style caption with labelled sections',
    text: [
      'The BEST garlic butter shrimp 🍤 #shrimp #dinner',
      '',
      'Ingredients:',
      '1 lb shrimp, peeled',
      '4 cloves garlic, minced',
      '3 tbsp butter',
      '',
      'Instructions:',
      'Melt butter in a pan.',
      'Add garlic and cook 30 seconds.',
      'Add shrimp and cook until pink.',
    ].join('\n'),
    expect: { hasIngredients: true, hasDirections: true },
  },
];

describe('regression corpus — raw caption → parseCaption (offline heuristic)', () => {
  for (const fx of CAPTION_CORPUS) {
    it(fx.name, () => {
      const parsed = parseCaption(fx.text);
      expect(parsed).toBeTruthy();
      if (fx.expect.hasIngredients) {
        expect(parsed.ingredients.length).toBeGreaterThan(0);
        assertCleanIngredients(parsed.ingredients);
      }
      if (fx.expect.hasDirections) {
        expect(parsed.directions.length).toBeGreaterThan(0);
      }
      if (parsed.title) assertCleanTitle(parsed.title);
    });
  }

  it('returns a safe shape for empty / non-recipe text', () => {
    const parsed = parseCaption('just vibes, no recipe here');
    // parseCaption may return an object with empty arrays or null — both are safe.
    if (parsed) {
      expect(Array.isArray(parsed.ingredients)).toBe(true);
      expect(Array.isArray(parsed.directions)).toBe(true);
    } else {
      expect(parsed).toBeNull();
    }
  });
});
