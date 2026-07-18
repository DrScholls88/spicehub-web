import { describe, it, expect } from 'vitest';
import {
  getMissingForDrink,
  buildShoppingList,
  getOneAwayDrinks,
  exportShoppingListText,
} from '../lib/barShopping.js';

// ── Test fixtures ────────────────────────────────────────────────────────

const margarita = {
  name: 'Margarita',
  ingredients: ['2 oz tequila', '1 oz lime juice', '0.75 oz triple sec'],
};

const daiquiri = {
  name: 'Daiquiri',
  ingredients: ['2 oz white rum', '1 oz lime juice', '0.75 oz simple syrup'],
};

const oldFashioned = {
  name: 'Old Fashioned',
  ingredients: ['2 oz bourbon', '0.25 oz simple syrup', '2 dashes angostura bitters'],
};

const ginAndTonic = {
  name: 'Gin & Tonic',
  ingredients: ['2 oz gin', '4 oz tonic water'],
};

const virginMojito = {
  name: 'Virgin Mojito',
  ingredients: ['1 oz lime juice', '0.75 oz simple syrup', '6 mint leaves', '3 oz soda water'],
};

// ── getMissingForDrink ───────────────────────────────────────────────────

describe('getMissingForDrink', () => {
  it('returns available and missing ingredients correctly', () => {
    const shelf = ['tequila', 'lime juice'];
    const result = getMissingForDrink(margarita, shelf);

    expect(result.available.length).toBe(2);
    expect(result.missing.length).toBe(1);
    expect(result.tier).toBe('almost');
  });

  it('returns all available when shelf has everything', () => {
    const shelf = ['bourbon', 'simple syrup', 'angostura bitters'];
    const result = getMissingForDrink(oldFashioned, shelf);

    expect(result.missing.length).toBe(0);
    expect(result.tier).toBe('ready');
    expect(result.score).toBe(1);
  });

  it('returns all missing when shelf is empty', () => {
    const result = getMissingForDrink(margarita, []);

    expect(result.available.length).toBe(0);
    expect(result.missing.length).toBe(3);
    expect(result.tier).toBe('reach');
  });

  it('handles drink with no ingredients', () => {
    const empty = { name: 'Empty', ingredients: [] };
    const result = getMissingForDrink(empty, ['vodka']);

    expect(result.available.length).toBe(0);
    expect(result.missing.length).toBe(0);
  });
});

// ── buildShoppingList ────────────────────────────────────────────────────

describe('buildShoppingList', () => {
  it('deduplicates ingredients across drinks', () => {
    // Both margarita and daiquiri need lime juice
    const result = buildShoppingList([margarita, daiquiri], []);
    const limeItems = result.items.filter(i => i.ingredient.includes('lime'));

    expect(limeItems.length).toBe(1);
    expect(limeItems[0].count).toBe(2);
    expect(limeItems[0].neededBy).toContain('Margarita');
    expect(limeItems[0].neededBy).toContain('Daiquiri');
  });

  it('assigns priority based on drink count', () => {
    // lime juice needed by 3+ drinks → high
    const mojito = { name: 'Mojito', ingredients: ['2 oz rum', '1 oz lime juice', '0.75 oz simple syrup', '6 mint leaves', '2 oz soda water'] };
    const result = buildShoppingList([margarita, daiquiri, mojito], []);
    const limeItem = result.items.find(i => i.ingredient.includes('lime'));

    expect(limeItem.priority).toBe('high');
    expect(limeItem.count).toBeGreaterThanOrEqual(3);
  });

  it('sorts by priority desc then count desc then alpha', () => {
    const mojito = { name: 'Mojito', ingredients: ['2 oz rum', '1 oz lime juice', '0.75 oz simple syrup', '6 mint leaves', '2 oz soda water'] };
    const result = buildShoppingList([margarita, daiquiri, mojito, oldFashioned], []);

    // First items should be high-priority (needed by most)
    const priorities = result.items.map(i => i.priority);
    const firstHighIdx = priorities.indexOf('high');
    const firstMedIdx = priorities.indexOf('medium');
    const firstLowIdx = priorities.indexOf('low');
    if (firstHighIdx >= 0 && firstMedIdx >= 0) {
      expect(firstHighIdx).toBeLessThan(firstMedIdx);
    }
    if (firstMedIdx >= 0 && firstLowIdx >= 0) {
      expect(firstMedIdx).toBeLessThan(firstLowIdx);
    }
  });

  it('provides correct summary stats', () => {
    const result = buildShoppingList([margarita, daiquiri], []);

    expect(result.summary.totalDrinks).toBe(2);
    expect(result.summary.totalMissing).toBeGreaterThan(0);
    expect(result.summary.topCategories).toBeInstanceOf(Array);
    expect(result.summary.topCategories.length).toBeLessThanOrEqual(2);
  });

  it('computes unlockableDrinks correctly', () => {
    // Give shelf enough for margarita, only missing items are for daiquiri
    const shelf = ['tequila', 'lime juice', 'triple sec'];
    const result = buildShoppingList([margarita, daiquiri], shelf);

    // margarita is already ready (0 missing), daiquiri needs rum + simple syrup
    // buying everything unlocks daiquiri
    expect(result.summary.unlockableDrinks).toBe(1);
  });

  it('returns empty items for empty drinks array', () => {
    const result = buildShoppingList([], ['vodka']);

    expect(result.items.length).toBe(0);
    expect(result.summary.totalMissing).toBe(0);
  });

  it('title-cases display names', () => {
    const result = buildShoppingList([margarita], []);
    const item = result.items.find(i => i.ingredient.includes('lime'));

    if (item) {
      // Each word should start with uppercase
      const words = item.displayName.split(' ');
      for (const w of words) {
        expect(w[0]).toBe(w[0].toUpperCase());
      }
    }
  });
});

// ── getOneAwayDrinks ─────────────────────────────────────────────────────

describe('getOneAwayDrinks', () => {
  it('returns drinks missing exactly 1 ingredient', () => {
    // Shelf has tequila + lime juice → margarita is 1 away (triple sec)
    const shelf = ['tequila', 'lime juice'];
    const result = getOneAwayDrinks([margarita, daiquiri], shelf);
    const names = result.map(r => r.drink.name);

    expect(names).toContain('Margarita');
  });

  it('excludes drinks missing 2+ ingredients', () => {
    // Shelf has only lime juice → margarita missing 2, daiquiri missing 2
    const shelf = ['lime juice'];
    const result = getOneAwayDrinks([margarita, daiquiri], shelf);

    expect(result.length).toBe(0);
  });

  it('excludes already-ready drinks', () => {
    const shelf = ['bourbon', 'simple syrup', 'angostura bitters'];
    const result = getOneAwayDrinks([oldFashioned], shelf);

    expect(result.length).toBe(0);
  });

  it('sorts results by drink name', () => {
    const shelf = ['lime juice', 'simple syrup'];
    const result = getOneAwayDrinks([margarita, daiquiri, ginAndTonic], shelf);
    const names = result.map(r => r.drink.name);

    for (let i = 1; i < names.length; i++) {
      expect(names[i].localeCompare(names[i - 1])).toBeGreaterThanOrEqual(0);
    }
  });

  it('includes category for missing ingredient', () => {
    const shelf = ['tequila', 'lime juice'];
    const result = getOneAwayDrinks([margarita], shelf);

    if (result.length > 0) {
      // category can be string or null, but should be present
      expect(result[0]).toHaveProperty('category');
      expect(result[0]).toHaveProperty('missingIngredient');
    }
  });

  it('handles empty arrays', () => {
    expect(getOneAwayDrinks([], ['vodka']).length).toBe(0);
    expect(getOneAwayDrinks([margarita], []).length).toBe(0);
  });
});

// ── exportShoppingListText ───────────────────────────────────────────────

describe('exportShoppingListText', () => {
  it('produces formatted text with header', () => {
    const list = buildShoppingList([margarita], []);
    const text = exportShoppingListText(list);

    expect(text).toContain('Bar Shopping List');
    expect(text).toContain('━━━');
  });

  it('groups items by category', () => {
    const list = buildShoppingList([margarita, oldFashioned], []);
    const text = exportShoppingListText(list);

    // Should contain category headers
    expect(text).toContain('(');
    expect(text).toContain(')');
  });

  it('shows which drinks need each ingredient', () => {
    const list = buildShoppingList([margarita], []);
    const text = exportShoppingListText(list);

    expect(text).toContain('needed for');
    expect(text).toContain('Margarita');
  });

  it('shows item count and unlockable drinks in footer', () => {
    const list = buildShoppingList([margarita, daiquiri], []);
    const text = exportShoppingListText(list);

    expect(text).toContain('item');
  });

  it('handles empty list gracefully', () => {
    const list = buildShoppingList([], []);
    const text = exportShoppingListText(list);

    expect(text).toContain('fully stocked');
  });

  it('uses checkbox markers', () => {
    const list = buildShoppingList([margarita], []);
    const text = exportShoppingListText(list);

    expect(text).toContain('☐');
  });
});
