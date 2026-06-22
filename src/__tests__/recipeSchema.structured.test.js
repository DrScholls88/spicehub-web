import { describe, it, expect } from 'vitest';
import {
  EXEMPLARS,
  flattenIngredientGroups,
  ingredientMetaFromGroups,
  thinFromStructured,
  structuredFromGroups,
  flatIngredientsFromStructured,
  metaFromStructured,
  parseIngredientLine,
  upgradeFlatIngredient,
  upgradeRecipeIngredients,
  deriveDisplay,
} from '../recipeSchema.js';

// Spec A — the structured ingredient array is the new source of truth, and the
// legacy `ingredients: string[]` + `_ingredientMeta` fields are DERIVED from it.
// These tests pin two things:
//   1. Field preservation — structuredFromGroups keeps qty/unit/name/prep/etc.
//   2. Byte-identical derivation — the derived legacy fields exactly match the
//      old flattenIngredientGroups / ingredientMetaFromGroups output, proving
//      nothing downstream changes.

const mealGroups = EXEMPLARS.meal[0].output.ingredientGroups;
const drinkGroups = EXEMPLARS.drink[0].output.ingredientGroups;

describe('structuredFromGroups — field preservation', () => {
  it('keeps every field for the meal exemplar', () => {
    const items = structuredFromGroups(mealGroups);
    // 3 sauce + 3 ungrouped = 6 rows
    expect(items).toHaveLength(6);
    const cream = items[0];
    expect(cream).toMatchObject({
      quantity: '1',
      unit: 'cup',
      name: 'heavy cream',
      prep: '',
      category: 'Dairy',
      section: 'sauce',
      original_text: '1 cup heavy cream',
    });
    expect(typeof cream.ref).toBe('string');
    expect(cream.ref.length).toBeGreaterThan(0);
  });

  it('keeps drink fields incl. canonical units', () => {
    const items = structuredFromGroups(drinkGroups);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ quantity: '2', unit: 'oz', name: 'rye whiskey', section: '' });
    expect(items[2]).toMatchObject({ quantity: '2', unit: 'dash', name: 'Angostura bitters' });
  });
});

describe('byte-identical derivation (no downstream change)', () => {
  it('flat ingredients match flattenIngredientGroups — meal', () => {
    const items = structuredFromGroups(mealGroups);
    expect(flatIngredientsFromStructured(items)).toEqual(flattenIngredientGroups(mealGroups));
  });

  it('flat ingredients match flattenIngredientGroups — drink', () => {
    const items = structuredFromGroups(drinkGroups);
    expect(flatIngredientsFromStructured(items)).toEqual(flattenIngredientGroups(drinkGroups));
  });

  it('_ingredientMeta matches ingredientMetaFromGroups — meal', () => {
    const items = structuredFromGroups(mealGroups);
    expect(metaFromStructured(items)).toEqual(ingredientMetaFromGroups(mealGroups));
  });

  it('_ingredientMeta matches ingredientMetaFromGroups — drink', () => {
    const items = structuredFromGroups(drinkGroups);
    expect(metaFromStructured(items)).toEqual(ingredientMetaFromGroups(drinkGroups));
  });
});

describe('thinFromStructured wires structured + legacy together', () => {
  it('populates ingredientsStructured and derives legacy fields identically', () => {
    const out = thinFromStructured(EXEMPLARS.meal[0].output);
    expect(out.ingredients).toEqual(flattenIngredientGroups(mealGroups));
    expect(out._ingredientMeta).toEqual(ingredientMetaFromGroups(mealGroups));
    // structured row count equals derived flat row count (1:1, no drift)
    expect(out.ingredientsStructured).toHaveLength(out.ingredients.length);
  });
});

describe('parseIngredientLine — legacy string upgrade', () => {
  it('splits "2 cups flour"', () => {
    expect(parseIngredientLine('2 cups flour')).toEqual({
      quantity: '2', unit: 'cup', name: 'flour', prep: '',
    });
  });

  it('splits "3 cloves garlic, minced"', () => {
    expect(parseIngredientLine('3 cloves garlic, minced')).toEqual({
      quantity: '3', unit: 'clove', name: 'garlic', prep: 'minced',
    });
  });

  it('keeps a bare food token as the name (no false unit strip)', () => {
    expect(parseIngredientLine('1 lemon, juiced')).toEqual({
      quantity: '1', unit: '', name: 'lemon', prep: 'juiced',
    });
  });

  it('handles a no-quantity line', () => {
    expect(parseIngredientLine('salt to taste')).toEqual({
      quantity: '', unit: '', name: 'salt to taste', prep: '',
    });
  });
});

describe('upgradeFlatIngredient — section + category', () => {
  it('strips a known section suffix and parses the core', () => {
    const item = upgradeFlatIngredient('2 cups flour (sauce)', '');
    expect(item).toMatchObject({
      quantity: '2', unit: 'cup', name: 'flour', section: 'sauce', category: 'Pantry',
      original_text: '2 cups flour',
    });
  });

  it('does NOT strip an organic parenthetical as a section', () => {
    const item = upgradeFlatIngredient('1 onion (about 1 cup)', '');
    expect(item.section).toBe('');
    // the paren stays part of the upgraded core/original_text
    expect(item.original_text).toBe('1 onion (about 1 cup)');
  });

  it('prefers a supplied valid grocery category', () => {
    const item = upgradeFlatIngredient('2 cups flour', 'Bakery');
    expect(item.category).toBe('Bakery');
  });
});

describe('deriveDisplay', () => {
  it('round-trips a structured item to a display line', () => {
    expect(deriveDisplay({ quantity: '2', unit: 'cup', name: 'flour', prep: 'sifted' }))
      .toBe('2 cup flour, sifted');
  });
});

describe('upgradeRecipeIngredients — idempotent lazy upgrade', () => {
  it('builds structured from flat strings + meta on first pass', () => {
    const recipe = {
      ingredients: ['1 cup flour', '2 cloves garlic, minced'],
      _ingredientMeta: [
        { text: '1 cup flour', category: 'Pantry' },
        { text: '2 cloves garlic, minced', category: 'Produce' },
      ],
    };
    const up = upgradeRecipeIngredients(recipe);
    expect(up.ingredientsStructured).toHaveLength(2);
    expect(up.ingredientsStructured[0]).toMatchObject({ quantity: '1', unit: 'cup', name: 'flour', category: 'Pantry' });
    expect(up.ingredientsStructured[1]).toMatchObject({ name: 'garlic', prep: 'minced', category: 'Produce' });
  });

  it('returns the recipe unchanged on a second pass (idempotent)', () => {
    const recipe = { ingredients: ['1 cup flour'], _ingredientMeta: [] };
    const a = upgradeRecipeIngredients(recipe);
    const b = upgradeRecipeIngredients(a);
    expect(b).toBe(a);
    expect(b.ingredientsStructured).toBe(a.ingredientsStructured);
  });

  it('aggregation-ready: structured rows expose summable quantity/unit/name', () => {
    const recipe = { ingredients: ['1 cup flour', '1 cup flour'], _ingredientMeta: [] };
    const up = upgradeRecipeIngredients(recipe);
    const amounts = up.ingredientsStructured.map(i => ({ q: i.quantity, u: i.unit, n: i.name }));
    expect(amounts).toEqual([
      { q: '1', u: 'cup', n: 'flour' },
      { q: '1', u: 'cup', n: 'flour' },
    ]);
  });
});
