import { describe, it, expect, beforeEach } from 'vitest';
import {
  foodName, memoryKeyFor, resolveStore, isSkipped, cleanListText,
  loadDeptStores, saveDeptStores, deptOf,
} from '../lib/groceryStores';

// The suite runs in vitest's 'node' environment (see setup.js) — no DOM
// storage, so give the localStorage-backed helpers a tiny in-memory stand-in.
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
}

describe('groceryStores', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });

  it('store memory key is the food name the builder looks up, not the display line', () => {
    // buildGroceryList stores the display line as `name` and the food as `food`,
    // then looks memory up by the food name (fuzzyStoreMemoryLookup step 1).
    const built = { name: '3 cloves garlic, minced', food: 'garlic' };
    expect(memoryKeyFor(built)).toBe('garlic');
    expect(memoryKeyFor({ name: '1/2 cup heavy cream (sauce)', food: 'heavy cream' })).toBe('heavy cream');
    // Section suffix / prep notes never leak into the key.
    expect(memoryKeyFor({ name: 'x', food: 'Roma Tomatoes (sauce)' })).toBe('roma tomatoes');
  });

  it('derives a clean food name from a raw line when no food field exists', () => {
    for (const [line, want] of [
      ['2 tbsp olive oil', 'olive oil'],
      ['1 can black beans, drained', 'black beans'],
      ['2 limes, juiced', 'limes'],
      ['3 cloves garlic, minced', 'garlic'],
    ]) {
      const got = foodName({ name: line });
      expect(got.toLowerCase()).toContain(want);
      expect(got).not.toMatch(/\d|,|\(/);
    }
  });

  it('a per-item store beats the department default; unknown ids are ignored', () => {
    const rules = { Produce: 'hyvee', Pantry: 'target' };
    expect(resolveStore({ name: 'basil', category: 'Produce' }, rules)).toBe('hyvee');
    expect(resolveStore({ name: 'basil', category: 'Produce', store: 'traderjoes' }, rules)).toBe('traderjoes');
    expect(resolveStore({ name: 'basil', category: 'Produce', store: '__pantry__' }, rules)).toBe('hyvee');
    expect(resolveStore({ name: 'ice', category: 'Frozen' }, rules)).toBe('');
  });

  it('department falls back to categorizeIngredient on the food name', () => {
    expect(deptOf({ name: '2 cups diced roma tomatoes' })).toBe('Produce');
  });

  it('skip hides an item only when every meal needing it is skipped', () => {
    expect(isSkipped({ meals: ['Tacos'], skipMeals: ['Tacos'] })).toBe(true);
    expect(isSkipped({ meals: ['Tacos', 'Chili'], skipMeals: ['Tacos'] })).toBe(false);
    expect(isSkipped({ meals: [], skipMeals: ['Tacos'] })).toBe(false);
    expect(isSkipped({ name: 'Run Dry item' })).toBe(false);
  });

  it('clean list text is one plain item per line', () => {
    expect(cleanListText([{ food: 'roma tomatoes', count: 1 }, { food: 'black beans', count: 2 }, { food: '' }]))
      .toBe('Roma tomatoes\nBlack beans (2)');
  });

  it('department store rules round-trip and drop unknown stores', () => {
    saveDeptStores({ Produce: 'hyvee', Dairy: 'nope' });
    expect(loadDeptStores()).toEqual({ Produce: 'hyvee' });
  });
});
