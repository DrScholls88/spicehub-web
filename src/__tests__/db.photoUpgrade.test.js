// Offline photo-upgrade queue: when connectivity returns, processImportQueue
// re-runs the online vision tiers and merges the better extraction into the
// saved draft. Drinks live in db.drinks, so a Bar draft must be looked up
// there. Before 2026-10-28 it only searched db.meals and never upgraded.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const importRecipeFromPages = vi.fn();
vi.mock('../lib/photoImportEngine.js', () => ({ importRecipeFromPages: (...a) => importRecipeFromPages(...a) }));

const { default: db, queuePhotoUpgrade, processImportQueue } = await import('../db.js');

const improved = (name) => ({
  name,
  ingredients: ['1 oz gin', '1 oz Campari', '1 oz sweet vermouth'],
  directions: ['Stir with ice and strain.'],
  confidence: 0.9,
  _ocrDraft: false,
});

describe('processImportQueue — photo-upgrade', () => {
  beforeEach(async () => {
    await Promise.all([db.importQueue.clear(), db.meals.clear(), db.drinks.clear()]);
    importRecipeFromPages.mockReset();
  });

  it('upgrades a drink draft in db.drinks, kind-locked, and leaves db.meals alone', async () => {
    const id = await db.drinks.add({ name: 'Negroni', ingredients: ['gin'], directions: [], _ocrDraft: true, needsReview: true });
    await queuePhotoUpgrade({ name: 'Negroni' }, ['data:image/jpeg;base64,AAAA'], 'drink');
    importRecipeFromPages.mockResolvedValue(improved('Negroni'));

    await processImportQueue();

    expect(importRecipeFromPages).toHaveBeenCalledWith(expect.any(Array), { type: 'drink', kindLocked: true });
    const drink = await db.drinks.get(id);
    expect(drink._ocrDraft).toBe(false);
    expect(drink.needsReview).toBe(false);
    expect(drink.ingredients).toHaveLength(3);
    expect(await db.meals.count()).toBe(0);
    const [q] = await db.importQueue.toArray();
    expect(q.status).toBe('done');
    expect(q.scanPages).toBeNull();
  });

  it('still upgrades a meal draft in db.meals', async () => {
    const id = await db.meals.add({ name: 'Pasta', ingredients: ['pasta'], directions: [], _ocrDraft: true, needsReview: true });
    await queuePhotoUpgrade({ name: 'Pasta' }, ['data:image/jpeg;base64,AAAA'], 'meal');
    importRecipeFromPages.mockResolvedValue({ ...improved('Pasta'), ingredients: ['200 g pasta', '2 tbsp olive oil'] });

    await processImportQueue();

    const meal = await db.meals.get(id);
    expect(meal._ocrDraft).toBe(false);
    expect(meal.ingredients).toHaveLength(2);
    expect(await db.drinks.count()).toBe(0);
  });
});
