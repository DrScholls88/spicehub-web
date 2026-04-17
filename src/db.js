import Dexie from 'dexie';

const db = new Dexie('SpiceHubDB');

db.version(1).stores({
  meals: '++id, name',
  weekPlan: 'dayIndex',
  groceryItems: '++id, name, storeId, isChecked',
});

// v2: added The Bar (drinks library)
db.version(2).stores({
  drinks: '++id, name',
});

// v3: Added storeMemory for persisting ingredient->store mappings
db.version(3).stores({
  storeMemory: 'ingredient',
});

// v4: Added cookingLog for tracking when meals are cooked (streaks, stats)
db.version(4).stores({
  cookingLog: '++id, mealId, cookedAt',
});

// v5: Added importQueue for offline recipe imports with background sync
db.version(5).stores({
  importQueue: '++id, status, createdAt',
});

// v6: Added storageMetadata for tracking storage usage and quotas
db.version(6).stores({
  storageMetadata: 'key',
});

// v7: Added weekHistory for past week plans
db.version(7).stores({
  weekHistory: '++id, weekStart',
});

// v8: Instagram import cache (offline-first, avoids re-fetching same URL)
db.version(8).stores({
  instagramCache: 'url, cachedAt',
});

// v9: Unified Import Engine — Ghost Recipe status + sourceHash + jobId on meals
db.version(9).stores({
  meals: '++id, name, status, sourceHash, jobId',
});

export default db;

// ── Week plan persistence ─────────────────────────────────────────────────────
export async function saveWeekPlan(weekPlan) {
  try {
    const entries = weekPlan.map((meal, i) => ({
      dayIndex: i,
      meal: meal || null,
    }));
    await db.transaction('rw', db.weekPlan, async () => {
      await db.weekPlan.clear();
      await db.weekPlan.bulkPut(entries);
    });
  } catch (error) {
    console.error('[SpiceHub DB] saveWeekPlan failed:', error);
    throw new Error('Failed to save week plan. Your data is safe — try refreshing.');
  }
}

export async function loadWeekPlan() {
  try {
    const entries = await db.weekPlan.toArray();
    if (entries.length === 0) return null; // No saved plan
    const plan = Array(7).fill(null);
    for (const entry of entries) {
      if (entry.dayIndex >= 0 && entry.dayIndex < 7) {
        plan[entry.dayIndex] = entry.meal;
      }
    }
    // Only return if there's at least one non-null entry
    return plan.some(Boolean) ? plan : null;
  } catch (error) {
    console.error('[SpiceHub DB] loadWeekPlan failed:', error);
    throw new Error('Failed to load week plan. Your data is safe — try refreshing.');
  }
}

// ── Grocery list persistence ──────────────────────────────────────────────────
export async function saveGroceryList(items) {
  try {
    await db.transaction('rw', db.groceryItems, async () => {
      await db.groceryItems.clear();
      if (items.length > 0) {
        await db.groceryItems.bulkAdd(items.map(item => ({
          name: item.name,
          checked: item.checked || false,
          store: item.store || '',
        })));
      }
    });
  } catch (error) {
    console.error('[SpiceHub DB] saveGroceryList failed:', error);
    throw new Error('Failed to save grocery list. Your data is safe — try refreshing.');
  }
}

export async function loadGroceryList() {
  try {
    const items = await db.groceryItems.toArray();
    return items.length > 0 ? items : null;
  } catch (error) {
    console.error('[SpiceHub DB] loadGroceryList failed:', error);
    throw new Error('Failed to load grocery list. Your data is safe — try refreshing.');
  }
}

// Helper functions for store memory persistence
export async function getStoreMemory() {
  try {
    const records = await db.storeMemory.toArray();
    const memory = {};
    for (const rec of records) {
      memory[rec.ingredient] = rec.store;
    }
    return memory;
  } catch (error) {
    console.error('[SpiceHub DB] getStoreMemory failed:', error);
    throw new Error('Failed to load store memory. Returning empty memory.');
  }
}

export async function saveStoreMemory(ingredient, store) {
  try {
    await db.storeMemory.put({ ingredient, store });
  } catch (error) {
    console.error('[SpiceHub DB] saveStoreMemory failed:', error);
    throw new Error('Failed to save store memory. Your data is safe — try again.');
  }
}

export async function clearStoreMemory() {
  await db.storeMemory.clear();
}

// Cooking log helpers
export async function logCook(mealId, mealName) {
  try {
    await db.cookingLog.add({ mealId, mealName, cookedAt: new Date().toISOString() });
    // Also increment cookCount and set lastCooked on the meal
    const meal = await db.meals.get(mealId);
    if (meal) {
      await db.meals.update(mealId, {
        cookCount: (meal.cookCount || 0) + 1,
        lastCooked: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[SpiceHub DB] logCook failed:', error);
    throw new Error('Failed to log cook. Your data is safe — try again.');
  }
}

export async function getCookingLog() {
  return db.cookingLog.toArray();
}

// Mixing log helpers (for drinks)
export async function logMix(drinkId, drinkName) {
  try {
    await db.cookingLog.add({ mealId: drinkId, mealName: drinkName, cookedAt: new Date().toISOString(), type: 'mix' });
    // Increment mixCount on the drink
    const drink = await db.drinks.get(drinkId);
    if (drink) {
      await db.drinks.update(drinkId, {
        cookCount: (drink.cookCount || 0) + 1,
        lastCooked: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[SpiceHub DB] logMix failed:', error);
    throw new Error('Failed to log mix. Your data is safe — try again.');
  }
}

// ── Offline recipe import queue ───────────────────────────────────────────
function validateRecipe(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('Recipe must have a non-empty name');
  }
  if (!Array.isArray(data.ingredients)) {
    errors.push('Ingredients must be an array');
  }
  if (!Array.isArray(data.directions)) {
    errors.push('Directions must be an array');
  }
  return { valid: errors.length === 0, errors };
}

export async function queueRecipeImport(url, recipeData) {
  try {
    // Validate recipe data
    const validation = validateRecipe(recipeData);
    if (!validation.valid) {
      throw new Error(`Invalid recipe: ${validation.errors.join(', ')}`);
    }

    // Check if recipe with same name already exists
    const existing = await db.meals.where('name').equalsIgnoreCase(recipeData.name).first();
    if (existing) {
      return { queueId: null, isDuplicate: true, existingId: existing.id };
    }

    // Check if already in queue
    const inQueue = await db.importQueue.where('url').equals(url).toArray();
    const alreadyQueued = inQueue.find(q =>
      q.recipeData?.name?.toLowerCase() === recipeData.name.toLowerCase()
    );
    if (alreadyQueued) {
      return { queueId: alreadyQueued.id, isDuplicate: true, alreadyInQueue: true };
    }

    // Add to queue
    const id = await db.importQueue.add({
      url,
      recipeData,
      status: 'pending',
      error: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
    });

    return { queueId: id, isDuplicate: false };
  } catch (error) {
    console.error('[SpiceHub DB] queueRecipeImport failed:', error);
    throw new Error(`Failed to queue recipe: ${error.message}`);
  }
}

export async function getQueuedRecipes() {
  return db.importQueue.where('status').anyOf(['pending', 'failed']).toArray();
}

function mergeRecipeData(existing, incoming) {
  return {
    ...existing,
    // Prefer the version with more ingredients
    ingredients: (incoming.ingredients?.length || 0) > (existing.ingredients?.length || 0)
      ? incoming.ingredients : existing.ingredients,
    // Prefer the version with more directions
    directions: (incoming.directions?.length || 0) > (existing.directions?.length || 0)
      ? incoming.directions : existing.directions,
    // Fill in missing fields from incoming
    imageUrl: existing.imageUrl || incoming.imageUrl,
    link: existing.link || incoming.link,
    updatedAt: new Date().toISOString(),
  };
}

export async function processImportQueue() {
  try {
    const queued = await getQueuedRecipes();
    let succeeded = 0;
    let failed = 0;

    for (const item of queued) {
      try {
        // Validate recipe before processing
        const validation = validateRecipe(item.recipeData);
        if (!validation.valid) {
          throw new Error(`Invalid recipe: ${validation.errors.join(', ')}`);
        }

        // Check if recipe still doesn't exist
        const existing = await db.meals.where('name').equalsIgnoreCase(item.recipeData.name).first();
        if (existing) {
          // Check if it's a true duplicate or just same name
          const isSameSource = existing.link && item.recipeData.link &&
            existing.link === item.recipeData.link;

          if (isSameSource) {
            // Same recipe from same URL — merge (keep richer data)
            const merged = mergeRecipeData(existing, item.recipeData);
            await db.meals.update(existing.id, merged);
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          } else {
            // Different recipe, same name — rename and add
            const uniqueName = `${item.recipeData.name} (imported ${new Date().toLocaleDateString()})`;
            await db.meals.add({ ...item.recipeData, name: uniqueName });
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          }
          continue;
        }

        // Add to meals
        await db.meals.add(item.recipeData);
        await db.importQueue.update(item.id, { status: 'done', error: null });
        succeeded++;
      } catch (err) {
        failed++;
        const newAttempt = (item.attemptCount || 0) + 1;
        const willRetry = newAttempt < 3;
        await db.importQueue.update(item.id, {
          status: willRetry ? 'pending' : 'failed',
          error: err.message,
          attemptCount: newAttempt,
        });
      }
    }

    return { processed: queued.length, succeeded, failed };
  } catch (error) {
    console.error('[SpiceHub DB] processImportQueue failed:', error);
    throw new Error('Failed to process import queue. Try again later.');
  }
}

export async function retryFailedImports() {
  const failed = await db.importQueue.where('status').equals('failed').toArray();
  for (const item of failed) {
    await db.importQueue.update(item.id, {
      status: 'pending',
      error: null,
      attemptCount: 0,
    });
  }
  return failed.length;
}

export async function clearQueueItem(id) {
  await db.importQueue.delete(id);
}

export async function clearCompletedImports() {
  await db.importQueue.where('status').equals('done').delete();
}

// ── Rotation helpers ─────────────────────────────────────────────────────────
export async function toggleRotation(mealId, inRotation) {
  await db.meals.update(mealId, { inRotation });
}

export async function getRotationMeals() {
  const all = await db.meals.toArray();
  return all.filter(m => m.inRotation);
}

export async function bulkSetRotation(mealIds, inRotation) {
  await db.transaction('rw', db.meals, async () => {
    for (const id of mealIds) {
      await db.meals.update(id, { inRotation });
    }
  });
}

// ── Week History helpers ─────────────────────────────────────────────────────
export async function saveWeekToHistory(weekStart, weekPlan) {
  // weekStart is ISO string of the Monday of that week
  // Only save if there are actual meals
  if (!weekPlan.some(Boolean)) return;

  // Check if we already have this week
  const existing = await db.weekHistory.where('weekStart').equals(weekStart).first();
  if (existing) {
    await db.weekHistory.update(existing.id, { meals: weekPlan, savedAt: new Date().toISOString() });
  } else {
    await db.weekHistory.add({ weekStart, meals: weekPlan, savedAt: new Date().toISOString() });
  }
}

export async function getWeekHistory(limit = 12) {
  const all = await db.weekHistory.orderBy('weekStart').reverse().toArray();
  return all.slice(0, limit);
}

export async function deleteWeekFromHistory(id) {
  await db.weekHistory.delete(id);
}

// ── Instagram import cache ────────────────────────────────────────────────────
const INSTAGRAM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getCachedInstagramRecipe(url) {
  try {
    const entry = await db.instagramCache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > INSTAGRAM_CACHE_TTL_MS) {
      await db.instagramCache.delete(url);
      return null;
    }
    return entry.recipe;
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache get failed:', e);
    return null;
  }
}

export async function cacheInstagramRecipe(url, recipe) {
  try {
    await db.instagramCache.put({ url, recipe, cachedAt: Date.now() });
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache put failed:', e);
  }
}

export async function clearInstagramCache() {
  try {
    await db.instagramCache.clear();
  } catch (e) {
    console.warn('[SpiceHub DB] instagramCache clear failed:', e);
  }
}

export async function importPaprikaMeals(paprikaMeals) {
  try {
    const existing = await db.meals.toArray();
    const existingNames = new Set(existing.map(m => m.name.toLowerCase().trim()));
    const toAdd = [];
    let skipped = 0;

    for (const meal of paprikaMeals) {
      if (existingNames.has(meal.name.toLowerCase().trim())) {
        skipped++;
        continue;
      }
      existingNames.add(meal.name.toLowerCase().trim());
      toAdd.push(meal);
    }

    if (toAdd.length > 0) {
      await db.meals.bulkAdd(toAdd);
    }

    return { imported: toAdd.length, skipped, total: paprikaMeals.length };
  } catch (error) {
    console.error('[SpiceHub DB] importPaprikaMeals failed:', error);
    throw new Error('Failed to import Paprika meals. Your data is safe — try again.');
  }
}

export async function safeGetMeal(id) {
  try {
    return await db.meals.get(id);
  } catch {
    return null;
  }
}



export async function getTableStats() {
  const stats = {
    meals: 0,
    drinks: 0,
    weekPlan: 0,
    groceryItems: 0,
    storeMemory: 0,
    cookingLog: 0,
    importQueue: 0,
    storageMetadata: 0,
  };

  const tables = Object.keys(stats);
  for (const tableName of tables) {
    if (!db[tableName]) continue;
    try {
      const items = await db[tableName].toArray();
      const jsonStr = JSON.stringify(items);
      stats[tableName] = new Blob([jsonStr]).size;
    } catch (error) {
      console.warn(`Failed to calculate size for ${tableName}:`, error);
    }
  }

  return stats;
}
