// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — gateRecipe: pass / salvage / empty
//
// The gate runs AFTER structurePack, checking the recipe + pack for quality.
// Drink-aware: 2-ingredient cocktails pass. Bait captions → empty.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { gateRecipe } from '../../src/import/gate.js';

describe('gateRecipe', () => {
  // ── pass ──────────────────────────────────────────────────────────────────

  it('passes a well-formed meal (3+ ingredients, directions, good name)', () => {
    const recipe = {
      name: 'Chicken Tikka Masala',
      ingredients: ['2 lbs chicken', '1 cup yogurt', '2 tbsp garam masala'],
      directions: ['Marinate chicken', 'Cook in sauce'],
    };
    const { verdict, reasons } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('pass');
    expect(reasons).toEqual([]);
  });

  it('passes a 2-ingredient drink — the cocktail bug fix', () => {
    const recipe = {
      name: 'Gin and Tonic',
      ingredients: ['2 oz gin', '4 oz tonic water'],
      directions: ['Pour gin over ice', 'Top with tonic'],
    };
    const { verdict } = gateRecipe(recipe, { kind: 'drink' });
    expect(verdict).toBe('pass');
  });

  // ── empty ─────────────────────────────────────────────────────────────────

  it('returns empty for a null recipe', () => {
    const { verdict, reasons } = gateRecipe(null, { kind: 'meal' });
    expect(verdict).toBe('empty');
    expect(reasons).toContain('no-recipe');
  });

  it('returns empty for a recipe with zero ingredients', () => {
    const recipe = { name: 'Nothing', ingredients: [], directions: ['Do stuff'] };
    const { verdict } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('empty');
  });

  it('returns empty for a bait caption with thin extraction', () => {
    const recipe = {
      name: 'Amazing Recipe',
      ingredients: ['chicken', 'spices'],
      directions: [],
    };
    const pack = { kind: 'meal', caption: 'Full recipe on the blog! Link in bio' };
    const { verdict, reasons } = gateRecipe(recipe, pack);
    expect(verdict).toBe('empty');
    expect(reasons).toContain('bait-caption');
  });

  // ── salvage ───────────────────────────────────────────────────────────────

  it('returns salvage for ingredients but no directions', () => {
    const recipe = {
      name: 'Quick Pasta',
      ingredients: ['1 lb pasta', '2 cups sauce', '1 cup cheese'],
      directions: [],
    };
    const { verdict, reasons } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('salvage');
    expect(reasons).toContain('no-directions');
  });

  it('returns salvage for a 2-ingredient meal — not pass', () => {
    const recipe = {
      name: 'Toast',
      ingredients: ['bread', 'butter'],
      directions: ['Toast bread', 'Spread butter'],
    };
    const { verdict, reasons } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('salvage');
    expect(reasons).toContain('ingredients:2');
  });

  it('returns salvage for a drink with no method', () => {
    const recipe = {
      name: 'Old Fashioned',
      ingredients: ['2 oz bourbon', '1 sugar cube', '2 dashes bitters'],
      directions: [],
    };
    const { verdict, reasons } = gateRecipe(recipe, { kind: 'drink' });
    expect(verdict).toBe('salvage');
    expect(reasons).toContain('no-directions');
  });

  it('returns salvage for a generic name', () => {
    const recipe = {
      name: 'Recipe',
      ingredients: ['flour', 'sugar', 'eggs'],
      directions: ['Mix together'],
    };
    const { verdict, reasons } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('salvage');
    expect(reasons).toContain('generic-name');
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it('defaults to meal rules when pack has no kind', () => {
    const recipe = {
      name: 'Simple Dip',
      ingredients: ['sour cream', 'onion soup mix'],
      directions: ['Stir together'],
    };
    const { verdict } = gateRecipe(recipe, {});
    expect(verdict).toBe('salvage'); // 2-ingredient meal → salvage
  });

  it('handles string ingredients (newline-delimited)', () => {
    const recipe = {
      name: 'Soup',
      ingredients: 'carrots\nonions\nbroth',
      directions: 'Simmer everything',
    };
    const { verdict } = gateRecipe(recipe, { kind: 'meal' });
    expect(verdict).toBe('pass');
  });
});
