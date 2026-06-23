import { describe, it, expect, beforeEach } from 'vitest';
import {
  learnableAliasFrom,
  resolveIngredientAlias,
  fuzzyResolveIngredient,
  setLearnedAliases,
  addLearnedAlias,
  getLearnedAliasMap,
} from '../recipeSchema.js';

// Spec D — learned (user-taught) aliases. LEARNED_ALIASES is module-level state,
// so reset it before each test.
beforeEach(() => setLearnedAliases({}));

describe('learnableAliasFrom', () => {
  it('learns when the food NAME changes', () => {
    const a = learnableAliasFrom('scallion greens', 'scallion');
    expect(a).toMatchObject({ raw: 'scallion greens', canonical: 'scallion' });
    expect(a.aisle).toBe('produce'); // categorizeIngredient('scallion') -> Produce
  });

  it('does NOT learn on a quantity-only edit', () => {
    expect(learnableAliasFrom('2 cups flour', '3 cups flour')).toBeNull();
  });

  it('does NOT learn when the name is unchanged', () => {
    expect(learnableAliasFrom('flour', 'flour')).toBeNull();
  });

  it('does NOT learn an empty / non-alphabetic correction', () => {
    expect(learnableAliasFrom('flour', '   ')).toBeNull();
    expect(learnableAliasFrom('flour', '123')).toBeNull();
  });
});

describe('learned aliases participate in resolution', () => {
  it('resolves a brand-new learned alias', () => {
    setLearnedAliases({ maggi: { canonical: 'seasoning sauce', aisle: 'pantry' } });
    expect(resolveIngredientAlias('maggi')).toEqual({ canonical: 'seasoning sauce', aisle: 'pantry' });
  });

  it('a learned alias OVERRIDES the static dictionary on key collision', () => {
    // static: 'cilantro' -> canonical 'cilantro'
    setLearnedAliases({ cilantro: { canonical: 'CUSTOM-HERB', aisle: 'produce' } });
    expect(resolveIngredientAlias('cilantro').canonical).toBe('CUSTOM-HERB');
  });

  it('addLearnedAlias updates the live map', () => {
    addLearnedAlias('ssamjang', 'fermented bean paste', 'pantry');
    expect(getLearnedAliasMap().ssamjang).toEqual({ canonical: 'fermented bean paste', aisle: 'pantry' });
    expect(resolveIngredientAlias('ssamjang').canonical).toBe('fermented bean paste');
  });

  it('fuzzyResolveIngredient picks up learned entries (exact)', () => {
    setLearnedAliases({ gochujang: { canonical: 'gochujang paste', aisle: 'pantry' } });
    const r = fuzzyResolveIngredient('gochujang');
    expect(r.canonical).toBe('gochujang paste');
    expect(r.method).toBe('exact');
  });

  it('learnableAliasFrom output round-trips through addLearnedAlias + resolve', () => {
    const a = learnableAliasFrom('big green onions', 'scallion');
    addLearnedAlias(a.raw, a.canonical, a.aisle);
    expect(resolveIngredientAlias(a.raw).canonical).toBe('scallion');
  });
});
