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

// Seed data
export const SEED_MEALS = [
  {
    name: 'Classic Beef Stroganoff',
    ingredients: ['500g Beef Sirloin, sliced','2 tbsp Olive Oil','1 Onion, chopped','2 cloves Garlic, minced','250g Mushrooms, sliced','1 tbsp Flour','1 cup Beef Broth','1 tbsp Dijon Mustard','1/2 cup Sour Cream','Parsley for garnish'],
    directions: ['Sear beef in hot oil until browned, then remove.','Saute onions and garlic until soft.','Add mushrooms and cook for 5 minutes.','Stir in flour and cook for 1 minute.','Add broth and mustard, simmer until thickened.','Stir in sour cream and beef. Heat through but do not boil.','Serve over noodles or rice.'],
    link: 'https://example.com/stroganoff',
    imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400',
  },
  {
    name: 'Chicken Parmesan',
    ingredients: ['2 Chicken Breasts','1 cup Breadcrumbs','1/2 cup Parmesan Cheese','1 Egg, beaten','1 cup Marinara Sauce','1 cup Mozzarella Cheese','Spaghetti (for serving)','Basil leaves'],
    directions: ['Pound chicken to even thickness.','Dip in egg, then coat in breadcrumb/parmesan mix.','Fry in oil until golden brown.','Top with sauce and mozzarella.','Bake at 400F (200C) for 15 mins until cheese melts.','Serve over pasta with basil.'],
    link: 'https://example.com/parmesan',
    imageUrl: 'https://images.unsplash.com/photo-1632778149955-e80f8ceca2e8?w=400',
  },
  {
    name: 'Vegetable Stir Fry',
    ingredients: ['1 block Tofu or 300g Chicken','2 cups Mixed Veggies (Broccoli, Peppers, Carrots)','2 tbsp Soy Sauce','1 tbsp Sesame Oil','1 tbsp Ginger, grated','2 cloves Garlic','1 tbsp Cornstarch','Rice for serving'],
    directions: ['Cook protein in oil until done, remove.','Stir fry vegetables for 3-5 minutes.','Mix soy sauce, ginger, garlic, and cornstarch with splash of water.','Add sauce and protein back to pan.','Toss until sauce thickens.','Serve over rice.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400',
  },
  {
    name: 'Shrimp Tacos',
    ingredients: ['400g Shrimp, peeled','1 tbsp Taco Seasoning','8 Corn Tortillas','1 cup Cabbage Slaw','1 Avocado, sliced','1 Lime','Cilantro','Salsa'],
    directions: ['Toss shrimp in taco seasoning.','Sear shrimp in a pan for 2-3 mins per side.','Warm tortillas.','Assemble tacos with slaw, shrimp, avocado, and salsa.','Squeeze lime juice on top.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=400',
  },
  {
    name: 'Lentil Soup',
    ingredients: ['1 cup Dried Lentils','1 Onion, diced','2 Carrots, diced','2 Celery stalks, diced','4 cups Vegetable Broth','1 tsp Cumin','1 tsp Thyme','1 can Diced Tomatoes'],
    directions: ['Saute onion, carrots, and celery in oil.','Add spices and cook for 1 minute.','Add lentils, broth, and tomatoes.','Simmer for 25-30 minutes until lentils are soft.','Season with salt and pepper.','Serve with crusty bread.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400',
  },
  {
    name: 'Honey Garlic Salmon',
    ingredients: ['2 Salmon Fillets','1/4 cup Honey','2 cloves Garlic, minced','2 tbsp Soy Sauce','1 tbsp Lemon Juice','Asparagus','Rice'],
    directions: ['Whisk honey, garlic, soy sauce, and lemon juice.','Sear salmon skin-side down for 4 mins.','Flip and pour sauce over salmon.','Cook 3-4 mins until sauce glazes and salmon is cooked.','Serve with steamed asparagus and rice.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400',
  },
  {
    name: 'Beef and Broccoli',
    ingredients: ['500g Flank Steak, sliced','1 head Broccoli, florets','1/4 cup Soy Sauce','1 tbsp Brown Sugar','1 tsp Ginger','2 cloves Garlic','Sesame Seeds'],
    directions: ['Steam broccoli for 2 minutes.','Sear beef in hot wok.','Add sauce ingredients (mixed).','Toss in broccoli and coat.','Garnish with sesame seeds.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400',
  },
  {
    name: 'Greek Salad with Chicken',
    ingredients: ['2 Chicken Breasts, grilled','1 Cucumber, diced','2 Tomatoes, diced','1/2 Red Onion, sliced','1/2 cup Feta Cheese','1/4 cup Olives','Lettuce','Greek Dressing'],
    directions: ['Grill seasoned chicken and slice.','Chop all vegetables.','Toss lettuce and veg with dressing.','Top with chicken, feta, and olives.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400',
  },
  {
    name: 'Mushroom Risotto',
    ingredients: ['1.5 cups Arborio Rice','300g Mushrooms','1 Onion','1/2 cup White Wine','4 cups Chicken/Veg Broth, warm','1/2 cup Parmesan','2 tbsp Butter'],
    directions: ['Saute mushrooms and remove.','Saute onion, add rice and toast.','Deglaze with wine.','Add broth one ladle at a time, stirring constantly.','When rice is creamy (20 mins), stir in cheese, butter, and mushrooms.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400',
  },
  {
    name: 'Pancakes and Bacon',
    ingredients: ['2 cups Flour','2 tsp Baking Powder','2 Eggs','1.5 cups Milk','Maple Syrup','8 slices Bacon','Butter'],
    directions: ['Fry bacon until crispy.','Mix dry ingredients. Whisk wet ingredients.','Combine batter (do not overmix).','Cook pancakes on griddle.','Serve with butter and syrup.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400',
  },
];

export async function seedIfEmpty() {
  try {
    const count = await db.meals.count();
    if (count === 0) {
      await db.meals.bulkAdd(SEED_MEALS);
    }
  } catch (error) {
    console.error('[SpiceHub DB] seedIfEmpty failed:', error);
    throw new Error('Failed to seed initial meals. Try refreshing the app.');
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

export const SEED_DRINKS = [
  // Classic cocktails
  {
    name: 'Classic Margarita',
    category: 'Cocktail',
    ingredients: ['2 oz Tequila (blanco)', '1 oz Cointreau or triple sec', '3/4 oz Fresh lime juice', 'Kosher salt (for rim)', 'Lime wheel (for garnish)', 'Ice'],
    directions: ['Rub a lime wedge around the rim of a rocks glass, then dip in salt.', 'Fill glass with ice.', 'Combine tequila, Cointreau, and lime juice in a shaker with ice.', 'Shake well for 15 seconds.', 'Strain into the prepared glass over fresh ice.', 'Garnish with a lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400',
  },
  {
    name: 'Old Fashioned',
    category: 'Cocktail',
    ingredients: ['2 oz Bourbon or Rye whiskey', '1 sugar cube (or 1 tsp simple syrup)', '2 dashes Angostura bitters', 'Orange peel (for garnish)', 'Maraschino cherry (optional)', 'Ice'],
    directions: ['Place sugar cube in a rocks glass and saturate with bitters. Add a splash of water.', 'Muddle until the sugar is dissolved.', 'Add whiskey and stir to combine.', 'Add a large ice cube.', 'Express an orange peel over the glass and drop it in.', 'Optional: add a cherry garnish.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400',
  },
  {
    name: 'Moscow Mule',
    category: 'Cocktail',
    ingredients: ['2 oz Vodka', '4 oz Ginger beer', '1/2 oz Fresh lime juice', 'Lime wedge (for garnish)', 'Fresh mint (optional)', 'Ice'],
    directions: ['Fill a copper mug (or highball glass) with ice.', 'Pour vodka and lime juice over ice.', 'Top with ginger beer and gently stir.', 'Garnish with a lime wedge and fresh mint if desired.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1607446045875-c4a6f74f9e64?w=400',
  },
  // More classic cocktails
  {
    name: 'Daiquiri',
    category: 'Cocktail',
    ingredients: ['2 oz Light Rum', '3/4 oz Fresh lime juice', '1/2 oz Simple syrup', 'Lime wheel (for garnish)', 'Ice'],
    directions: ['Fill a cocktail shaker with ice.', 'Add rum, lime juice, and simple syrup.', 'Shake vigorously for 15 seconds.', 'Strain into a chilled coupe glass.', 'Garnish with a lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400',
  },
  {
    name: 'Martini',
    category: 'Cocktail',
    ingredients: ['2.5 oz Gin (or Vodka)', '1/2 oz Dry vermouth', 'Dash of orange bitters', 'Olives or lemon twist (for garnish)', 'Ice'],
    directions: ['Fill a mixing glass with ice.', 'Pour gin and dry vermouth over ice.', 'Add a dash of bitters.', 'Stir for 30 seconds until well-chilled.', 'Strain into a chilled martini glass.', 'Garnish with olives or a lemon twist.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1608889335941-33d1cff32c0a?w=400',
  },
  {
    name: 'Manhattan',
    category: 'Cocktail',
    ingredients: ['2 oz Rye whiskey', '1 oz Sweet vermouth', '2 dashes Angostura bitters', 'Maraschino cherry (for garnish)', 'Ice'],
    directions: ['Fill a mixing glass with ice.', 'Add rye, sweet vermouth, and bitters.', 'Stir for 30 seconds.', 'Strain into a chilled coupe glass.', 'Garnish with a cherry.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1599959619048-7e0a1f3c2bdf?w=400',
  },
  {
    name: 'Cosmopolitan',
    category: 'Cocktail',
    ingredients: ['1.5 oz Vodka', '1 oz Cranberry juice', '1/2 oz Cointreau', '1/2 oz Fresh lime juice', 'Lime twist (for garnish)', 'Ice'],
    directions: ['Fill a cocktail shaker with ice.', 'Add vodka, cranberry juice, Cointreau, and lime juice.', 'Shake for 15 seconds.', 'Strain into a chilled martini glass.', 'Garnish with a lime twist.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1614707267537-b85faf00021b?w=400',
  },
  {
    name: 'Mojito',
    category: 'Cocktail',
    ingredients: ['2 oz White rum', '1 oz Fresh lime juice', '3/4 oz Simple syrup', '8-10 Fresh mint leaves', '4 oz Soda water', 'Mint sprig and lime wheel (for garnish)', 'Ice'],
    directions: ['Place mint leaves and simple syrup in a highball glass.', 'Gently muddle to release mint oils (do not shred leaves).', 'Fill glass with ice.', 'Pour in rum and lime juice.', 'Top with soda water and stir gently.', 'Garnish with a mint sprig and lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1612528443702-f6741f70a049?w=400',
  },
  {
    name: 'Margarita (Frozen)',
    category: 'Cocktail',
    ingredients: ['2 oz Tequila', '1 oz Cointreau', '1 oz Fresh lime juice', '1 cup Crushed ice', 'Kosher salt (for rim)', 'Lime wheel (for garnish)'],
    directions: ['Rim a margarita glass with salt using a lime wedge.', 'Add all ingredients to a blender.', 'Blend until smooth and slushy.', 'Pour into the prepared glass.', 'Garnish with a lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400',
  },
  {
    name: 'Pina Colada',
    category: 'Cocktail',
    ingredients: ['3 oz Light rum', '3 oz Coconut cream', '3 oz Pineapple juice', 'Pineapple wedge (for garnish)', 'Maraschino cherry (for garnish)', '1 cup Crushed ice'],
    directions: ['Add rum, coconut cream, pineapple juice, and crushed ice to a blender.', 'Blend until smooth.', 'Pour into a chilled highball glass.', 'Garnish with a pineapple wedge and cherry.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1604432556933-4efce902b127?w=400',
  },
  {
    name: 'Screwdriver',
    category: 'Cocktail',
    ingredients: ['2 oz Vodka', '4 oz Fresh orange juice', 'Orange wheel (for garnish)', 'Ice'],
    directions: ['Fill a highball glass with ice.', 'Pour vodka into the glass.', 'Top with fresh orange juice.', 'Stir gently.', 'Garnish with an orange wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1608270861620-7c80a0bc14d6?w=400',
  },
  // Popular modern cocktails
  {
    name: 'Aperol Spritz',
    category: 'Cocktail',
    ingredients: ['3 oz Prosecco', '2 oz Aperol', '1 oz Soda water', 'Orange slice (for garnish)', 'Ice'],
    directions: ['Fill a wine glass with ice.', 'Pour Aperol into the glass.', 'Top with Prosecco.', 'Add soda water.', 'Stir gently and garnish with an orange slice.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1608270861620-7c80a0bc14d6?w=400',
  },
  {
    name: 'Paloma',
    category: 'Cocktail',
    ingredients: ['2 oz Tequila (blanco)', '1 oz Fresh lime juice', '3/4 oz Fresh grapefruit juice', '1/2 oz Simple syrup', 'Pinch of salt', 'Grapefruit slice (for garnish)', 'Ice'],
    directions: ['Fill a highball glass with ice.', 'Pour tequila, lime juice, grapefruit juice, and simple syrup.', 'Add a pinch of salt.', 'Stir well.', 'Garnish with a grapefruit slice.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514432543241-edd65efc1d47?w=400',
  },
  {
    name: 'Sazerac',
    category: 'Cocktail',
    ingredients: ['2 oz Rye whiskey', '1 dash Peychaud\'s bitters', '1 dash Angostura bitters', '1/2 tsp Absinthe (for rinse)', '1 sugar cube', 'Lemon peel (for garnish)', 'Ice'],
    directions: ['Rinse a rocks glass with absinthe and discard excess.', 'Place sugar cube in the glass and saturate with bitters.', 'Add a splash of water and muddle.', 'Add rye whiskey and ice.', 'Stir well.', 'Express lemon peel over the drink and drop in as garnish.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400',
  },
  {
    name: 'Negroni',
    category: 'Cocktail',
    ingredients: ['1 oz Gin', '1 oz Campari', '1 oz Sweet vermouth', 'Orange peel (for garnish)', 'Ice'],
    directions: ['Fill a rocks glass with ice.', 'Pour equal parts gin, Campari, and sweet vermouth.', 'Stir well.', 'Express an orange peel over the drink and add as garnish.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514432643241-edd65efc1d47?w=400',
  },
  {
    name: 'Sidecar',
    category: 'Cocktail',
    ingredients: ['2 oz Cognac', '1 oz Cointreau', '3/4 oz Fresh lemon juice', 'Lemon wheel or sugar rim (for garnish)', 'Ice'],
    directions: ['Fill a cocktail shaker with ice.', 'Add Cognac, Cointreau, and lemon juice.', 'Shake for 15 seconds.', 'Strain into a chilled coupe glass.', 'Garnish with a lemon wheel or sugar rim.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1606312519331-379a88e0df60?w=400',
  },
  {
    name: 'Whiskey Sour',
    category: 'Cocktail',
    ingredients: ['2 oz Whiskey', '3/4 oz Fresh lemon juice', '1/2 oz Simple syrup', '1 Egg white (optional)', 'Angostura bitters (for dash)', 'Cherry and orange slice (for garnish)', 'Ice'],
    directions: ['Fill a cocktail shaker with ice.', 'Add whiskey, lemon juice, and simple syrup.', 'Optional: add egg white for silky texture.', 'Shake vigorously for 15 seconds.', 'Strain into a rocks glass over fresh ice.', 'Dash bitters on top and garnish with cherry and orange.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1608270861620-7c80a0bc14d6?w=400',
  },
  // Non-alcoholic options
  {
    name: 'Virgin Mojito',
    category: 'Mocktail',
    ingredients: ['1 oz Fresh lime juice', '3/4 oz Simple syrup', '8-10 Fresh mint leaves', '4 oz Soda water', 'Mint sprig and lime wheel (for garnish)', 'Ice'],
    directions: ['Place mint leaves and simple syrup in a highball glass.', 'Gently muddle to release mint oils.', 'Fill glass with ice.', 'Pour in lime juice.', 'Top with soda water and stir gently.', 'Garnish with a mint sprig and lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1559329007-40790c9c8dd0?w=400',
  },
  {
    name: 'Virgin Margarita',
    category: 'Mocktail',
    ingredients: ['1 oz Fresh lime juice', '1 oz Orange juice', '1/2 oz Lime cordial', '1/2 oz Simple syrup', 'Kosher salt (for rim)', 'Lime wheel (for garnish)', 'Ice'],
    directions: ['Rim a rocks glass with salt using a lime wedge.', 'Fill glass with ice.', 'Combine lime juice, orange juice, lime cordial, and simple syrup in a shaker with ice.', 'Shake well for 15 seconds.', 'Strain into the prepared glass.', 'Garnish with a lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400',
  },
  {
    name: 'Shirley Temple',
    category: 'Mocktail',
    ingredients: ['4 oz Ginger ale', '2 oz Orange juice', '1 oz Grenadine', 'Maraschino cherry and orange slice (for garnish)', 'Ice'],
    directions: ['Fill a highball glass with ice.', 'Pour orange juice and ginger ale.', 'Float grenadine on top by pouring slowly over the back of a spoon.', 'Stir gently.', 'Garnish with a cherry and orange slice.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1591017403286-c55161c77336?w=400',
  },
  // Shots
  {
    name: 'Tequila Shot',
    category: 'Shots',
    ingredients: ['1.5 oz Tequila', 'Lime wedge', 'Salt'],
    directions: ['Pour tequila into a shot glass.', 'Lick the back of your hand and sprinkle salt on it.', 'Lick the salt, shoot the tequila, then bite the lime wedge.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514432543241-edd65efc1d47?w=400',
  },
  {
    name: 'Jäger Bomb',
    category: 'Shots',
    ingredients: ['1 oz Jägermeister', '5 oz Red Bull or energy drink'],
    directions: ['Pour Jägermeister into a shot glass.', 'Pour energy drink into a separate glass.', 'Drop the shot glass into the energy drink.', 'Drink quickly.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514432543241-edd65efc1d47?w=400',
  },
];

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
