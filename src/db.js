import Dexie from 'dexie';
import { buildStructuredFields } from './recipeParser';
import { upgradeRecipeIngredients } from './recipeSchema';

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

// v10: Structured fields — ingredients_text indexed for full-text search
db.version(10).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
}).upgrade(tx => {
  // Backfill existing meals that don't yet have structured fields
  return tx.table('meals').toCollection().modify(meal => {
    if (!meal.ingredients_text && Array.isArray(meal.ingredients)) {
      const built = buildStructuredFields(meal.ingredients, meal.directions || []);
      Object.assign(meal, built);
    }
  });
});

// v11: Bar inventory — persistent "My Bar Inventory" for quest system & fridge mode
db.version(11).stores({
  barInventory: 'ingredient',
});

// v12: Unified Import Engine — Draft Persistence
db.version(12).stores({
  importDrafts: 'url, timestamp',
});

// v13: Batch Import — multi-share queue (P12)
db.version(13).stores({
  batchQueue: '++id, status, createdAt',
});

// v14: Spec A — structured ingredients as source of truth. Backfill
// `ingredientsStructured` on every existing meal + drink from their flat
// ingredients[] + _ingredientMeta[]. Idempotent, offline, no network. New
// imports already populate the field via thinFromStructured; consumers also
// upgrade on the fly, so this backfill is belt-and-suspenders for old records.
db.version(14).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
  drinks: '++id, name',
}).upgrade(tx => {
  const backfill = (meal) => {
    if (Array.isArray(meal.ingredientsStructured) && meal.ingredientsStructured.length) return;
    try {
      const upgraded = upgradeRecipeIngredients(meal);
      if (Array.isArray(upgraded.ingredientsStructured)) {
        meal.ingredientsStructured = upgraded.ingredientsStructured;
      }
    } catch (e) {
      // Defensive: a single bad record must never abort the whole upgrade.
      console.warn('[SpiceHub DB] v14 ingredient backfill skipped a record:', e);
    }
  };
  const meals = tx.table('meals').toCollection().modify(backfill);
  const drinks = tx.table('drinks').toCollection().modify(backfill);
  return Promise.all([meals, drinks]);
});

// v15: Spec D — learned ingredient aliases (user corrections from ImportReview).
// Keyed by the normalized raw imported name; augments the static INGREDIENT_ALIASES.
db.version(15).stores({
  ingredientAliases: 'raw, updatedAt',
});

// v16: Unified Schema Upgrade — first-class Food & Unit entities + nutrition +
// structured directions with ingredient references. New tables seeded on first
// open by ingredientEntities.seedEntities(). Backfill adds directionsStructured
// and nutrition:null to existing meals/drinks. Lazy upgrade on read means old
// records without these fields are transparently handled by CookMode/MealDetail.
db.version(16).stores({
  meals: '++id, name, status, sourceHash, jobId, ingredients_text',
  drinks: '++id, name',
  // First-class ingredient entities
  ingredientFoods: '++id, name',
  ingredientUnits: '++id, name',
}).upgrade(tx => {
  const backfillDirections = (record) => {
    // Add directionsStructured from flat directions if missing
    if (!Array.isArray(record.directionsStructured)) {
      record.directionsStructured = Array.isArray(record.directions)
        ? record.directions.map(d => ({
            text: typeof d === 'string' ? d : (d && d.text) || '',
            ingredientRefs: (d && Array.isArray(d.ingredientRefs)) ? d.ingredientRefs : [],
          })).filter(d => d.text)
        : [];
    }
    // Add nutrition:null placeholder if missing
    if (record.nutrition === undefined) {
      record.nutrition = null;
    }
  };
  const meals = tx.table('meals').toCollection().modify(backfillDirections);
  const drinks = tx.table('drinks').toCollection().modify(backfillDirections);
  return Promise.all([meals, drinks]);
});

export default db;

// ── Learned alias helpers (Spec D) ────────────────────────────────────────────
export async function getLearnedAliases() {
  try {
    return await db.ingredientAliases.toArray();
  } catch (e) {
    console.warn('[SpiceHub DB] getLearnedAliases failed:', e);
    return [];
  }
}

export async function saveLearnedAlias(entry) {
  if (!entry || !entry.raw || !entry.canonical) return;
  const raw = String(entry.raw).trim().toLowerCase();
  if (!raw) return;
  try {
    const existing = await db.ingredientAliases.get(raw);
    await db.ingredientAliases.put({
      raw,
      canonical: entry.canonical,
      aisle: entry.aisle || 'unknown',
      category: entry.category || '',
      count: (existing?.count || 0) + 1,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[SpiceHub DB] saveLearnedAlias failed:', e);
  }
}

export async function saveLearnedAliases(list = []) {
  // Batched version of saveLearnedAlias: previously this looped and did one
  // `get` + one `put` per entry (2N IndexedDB round trips). Now it's a single
  // bulkGet + single bulkPut regardless of list size. Duplicate `raw` values
  // within the same list are merged locally so counts still increment
  // correctly for each occurrence (matching the old sequential behavior).
  const entries = (Array.isArray(list) ? list : [])
    .map((entry) => {
      if (!entry || !entry.raw || !entry.canonical) return null;
      const raw = String(entry.raw).trim().toLowerCase();
      if (!raw) return null;
      return { raw, canonical: entry.canonical, aisle: entry.aisle || 'unknown', category: entry.category || '' };
    })
    .filter(Boolean);
  if (!entries.length) return;

  try {
    const uniqueRaws = [...new Set(entries.map((e) => e.raw))];
    const existingRows = await db.ingredientAliases.bulkGet(uniqueRaws);
    const baseCounts = new Map(uniqueRaws.map((raw, i) => [raw, existingRows[i]?.count || 0]));

    const now = Date.now();
    const byRaw = new Map();
    for (const entry of entries) {
      const prevCount = byRaw.has(entry.raw) ? byRaw.get(entry.raw).count : baseCounts.get(entry.raw);
      byRaw.set(entry.raw, {
        raw: entry.raw,
        canonical: entry.canonical,
        aisle: entry.aisle,
        category: entry.category,
        count: prevCount + 1,
        updatedAt: now,
      });
    }
    await db.ingredientAliases.bulkPut([...byRaw.values()]);
  } catch (e) {
    console.warn('[SpiceHub DB] saveLearnedAliases failed:', e);
  }
}

// ── Bar Inventory helpers ─────────────────────────────────────────────────────
export async function getBarInventory() {
  try {
    const items = await db.barInventory.toArray();
    return items.map(i => i.ingredient);
  } catch (e) {
    console.warn('[SpiceHub DB] getBarInventory failed:', e);
    return [];
  }
}

export async function addToBarInventory(ingredient) {
  const key = ingredient.toLowerCase().trim();
  if (!key) return;
  try {
    await db.barInventory.put({ ingredient: key, addedAt: new Date().toISOString() });
  } catch (e) {
    console.warn('[SpiceHub DB] addToBarInventory failed:', e);
  }
}

export async function removeFromBarInventory(ingredient) {
  const key = ingredient.toLowerCase().trim();
  try {
    await db.barInventory.delete(key);
  } catch (e) {
    console.warn('[SpiceHub DB] removeFromBarInventory failed:', e);
  }
}

export async function clearBarInventory() {
  try { await db.barInventory.clear(); } catch (e) { console.warn('[SpiceHub DB] clearBarInventory failed:', e); }
}

export async function isInBarInventory(ingredient) {
  const key = ingredient.toLowerCase().trim();
  try {
    const item = await db.barInventory.get(key);
    return !!item;
  } catch { return false; }
}

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

export async function queueRecipeImport(url, recipeData, opts = {}) {
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
      visualConfidence: opts.visualConfidence ?? null,
      needsGemini: opts.needsGemini ?? false,
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

/**
 * queuePhotoUpgrade — after an OFFLINE photo import saved an on-device OCR
 * draft, queue the compressed scan pages so processImportQueue can re-run the
 * online vision tiers (Gemini → Mistral) on reconnect and merge the better
 * extraction into the saved recipe. Pages are purged once the upgrade lands.
 *
 * @param {object} recipeData  the draft recipe as saved (needs .name)
 * @param {string[]} scanPageDataUrls  compressed page data URLs, in order
 * @param {'meal'|'drink'} itemType
 */
export async function queuePhotoUpgrade(recipeData, scanPageDataUrls, itemType = 'meal') {
  if (!recipeData?.name || !Array.isArray(scanPageDataUrls) || scanPageDataUrls.length === 0) {
    return { queueId: null };
  }
  const id = await db.importQueue.add({
    url: `photo-scan:${Date.now()}`,
    mode: 'photo-upgrade',
    recipeData,
    scanPages: scanPageDataUrls,
    itemType,
    targetName: recipeData.name,
    status: 'pending',
    error: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  });
  return { queueId: id };
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
        // ── Photo-upgrade entries: re-run the online vision tiers on the
        //    stored scan pages and merge the improvement into the saved
        //    recipe. Never adds a new meal (the draft was already saved).
        if (item.mode === 'photo-upgrade') {
          try {
            // Dynamic import avoids a db.js ↔ recipeParser.js cycle.
            const { importRecipeFromPages } = await import('./lib/photoImportEngine.js');
            const pages = (item.scanPages || []).map((dataUrl, i) => ({ id: `q-${item.id}-${i}`, dataUrl }));
            const improved = await importRecipeFromPages(pages, { type: item.itemType || 'meal' });

            if (improved && !improved._ocrDraft) {
              const target = await db.meals.where('name').equalsIgnoreCase(item.targetName).first();
              if (target) {
                await db.meals.update(target.id, {
                  ...mergeRecipeData(target, {
                    ...improved,
                    name: improved.name || improved.title || target.name,
                  }),
                  // Vision found the real dish photo — it beats the page scan
                  // (mergeRecipeData would otherwise keep the existing image).
                  imageUrl: improved.imageUrl || target.imageUrl,
                  sourceCaption: improved.sourceCaption || target.sourceCaption,
                  confidence: improved.confidence ?? target.confidence,
                  needsReview: false,
                  _ocrDraft: false,
                  _structuredVia: improved._structuredVia || target._structuredVia,
                  _visionEngine: improved._visionEngine || target._visionEngine,
                });
              }
              // Purge the heavy page payload on success (storage hygiene).
              await db.importQueue.update(item.id, { status: 'done', error: null, scanPages: null });
              succeeded++;
            } else {
              // Still offline / online tiers still down — leave pending.
              throw new Error('Vision tiers unavailable — will retry');
            }
          } catch (err) {
            failed++;
            const newAttempt = (item.attemptCount || 0) + 1;
            const willRetry = newAttempt < 5; // more patience than URL imports
            await db.importQueue.update(item.id, {
              status: willRetry ? 'pending' : 'failed',
              error: err.message,
              attemptCount: newAttempt,
              ...(willRetry ? {} : { scanPages: null }), // don't hoard pages forever
            });
          }
          continue;
        }

        // Attempt Gemini re-processing if the offline visual parse had low confidence
        let recipeToSave = item.recipeData;

        if (item.needsGemini && item.url) {
          try {
            // Re-submit URL to the server's deep waterfall (Python scraper + Gemini)
            const API_BASE = typeof window !== 'undefined' ? '' : '';
            const resp = await fetch(`${API_BASE}/api/v2/import/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: item.url }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const { recipe } = await resp.json();
              if (recipe && recipe.name && !recipe._error) {
                recipeToSave = recipe;
                console.log(`[SpiceHub DB] Gemini re-processing improved recipe: ${recipe.name}`);
              }
            }
          } catch (geminiErr) {
            console.warn('[SpiceHub DB] Gemini re-processing failed, using cached recipe:', geminiErr.message);
            // Falls through to use item.recipeData
          }
        }

        // Validate recipe before processing
        const validation = validateRecipe(recipeToSave);
        if (!validation.valid) {
          throw new Error(`Invalid recipe: ${validation.errors.join(', ')}`);
        }

        // Check if recipe still doesn't exist
        const existing = await db.meals.where('name').equalsIgnoreCase(recipeToSave.name).first();
        if (existing) {
          // Check if it's a true duplicate or just same name
          const isSameSource = existing.link && recipeToSave.link &&
            existing.link === recipeToSave.link;

          if (isSameSource) {
            // Same recipe from same URL — merge (keep richer data)
            const merged = mergeRecipeData(existing, recipeToSave);
            await db.meals.update(existing.id, merged);
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          } else {
            // Different recipe, same name — rename and add
            const uniqueName = `${recipeToSave.name} (imported ${new Date().toLocaleDateString()})`;
            await db.meals.add({ ...recipeToSave, name: uniqueName, createdAt: recipeToSave.createdAt || recipeToSave.created || new Date().toISOString() });
            await db.importQueue.update(item.id, { status: 'done', error: null });
            succeeded++;
          }
          continue;
        }

        // Add to meals
        await db.meals.add({ ...recipeToSave, createdAt: recipeToSave.createdAt || recipeToSave.created || new Date().toISOString() });
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

// ── Batch Import Queue helpers ────────────────────────────────────────────
export async function addBatchQueueItems(urls) {
  const now = Date.now();
  const ids = [];
  for (const url of urls) {
    const id = await db.batchQueue.add({
      url,
      status: 'pending',
      itemType: 'meal',
      itemTypeUserOverride: false,
      recipe: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    ids.push(id);
  }
  return ids;
}

export async function getBatchQueueItems() {
  return db.batchQueue.orderBy('createdAt').toArray();
}

export async function getNextPendingBatchItem() {
  return db.batchQueue.where('status').equals('pending').first();
}

export async function updateBatchQueueItem(id, changes) {
  await db.batchQueue.update(id, { ...changes, updatedAt: Date.now() });
}

export async function setBatchItemType(id, itemType) {
  await db.batchQueue.update(id, {
    itemType,
    itemTypeUserOverride: true,
    updatedAt: Date.now(),
  });
}

export async function deleteBatchQueueItem(id) {
  await db.batchQueue.delete(id);
}

export async function clearFinishedBatchItems() {
  await db.batchQueue.where('status').equals('saved').delete();
}

export async function recoverStuckBatchItems() {
  const stuck = await db.batchQueue.where('status').equals('extracting').toArray();
  for (const item of stuck) {
    await db.batchQueue.update(item.id, { status: 'pending', updatedAt: Date.now() });
  }
  return stuck.length;
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
  // Single indexed-scan write instead of one update() per id (N+1 writes).
  if (!Array.isArray(mealIds) || mealIds.length === 0) return;
  await db.meals.where('id').anyOf(mealIds).modify({ inRotation });
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

// ── Generic import cache helpers (aliases over instagramCache for unified use) ──
// Used by importFromInstagram and importFromTikTok in recipeParser.js.
export const getCachedImport   = getCachedInstagramRecipe;
export const setCachedImport   = cacheInstagramRecipe;

export async function importSeedMeals(seedMeals) {
  try {
    const existing = await db.meals.toArray();
    const existingNames = new Set(existing.map(m => m.name.toLowerCase().trim()));
    const toAdd = [];
    let skipped = 0;

    for (const meal of seedMeals) {
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

    return { imported: toAdd.length, skipped, total: seedMeals.length };
  } catch (error) {
    console.error('[SpiceHub DB] importSeedMeals failed:', error);
    throw new Error('Failed to import seed meals. Your data is safe — try again.');
  }
}

// Bulk-removes the "Starter Kit" pre-seeded recipes (see data/StarterKitMeals.js).
// Only touches meals explicitly tagged starterKit:true — never a user's own
// imports or manually-added recipes. Returns the number removed.
export async function removeStarterKitMeals() {
  try {
    const ids = await db.meals.filter(m => m.starterKit === true).primaryKeys();
    if (ids.length > 0) {
      await db.meals.bulkDelete(ids);
    }
    return ids.length;
  } catch (error) {
    console.error('[SpiceHub DB] removeStarterKitMeals failed:', error);
    throw new Error('Failed to remove starter kit recipes. Your data is safe — try again.');
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
