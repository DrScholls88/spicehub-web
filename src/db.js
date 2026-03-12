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

export default db;

// Helper functions for store memory persistence
export async function getStoreMemory() {
  const records = await db.storeMemory.toArray();
  const memory = {};
  for (const rec of records) {
    memory[rec.ingredient] = rec.store;
  }
  return memory;
}

export async function saveStoreMemory(ingredient, store) {
  await db.storeMemory.put({ ingredient, store });
}

export async function clearStoreMemory() {
  await db.storeMemory.clear();
}

// Cooking log helpers
export async function logCook(mealId, mealName) {
  await db.cookingLog.add({ mealId, mealName, cookedAt: new Date().toISOString() });
  // Also increment cookCount and set lastCooked on the meal
  const meal = await db.meals.get(mealId);
  if (meal) {
    await db.meals.update(mealId, {
      cookCount: (meal.cookCount || 0) + 1,
      lastCooked: new Date().toISOString(),
    });
  }
}

export async function getCookingLog() {
  return db.cookingLog.toArray();
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
  const count = await db.meals.count();
  if (count === 0) {
    await db.meals.bulkAdd(SEED_MEALS);
  }
}

/**
 * Import meals from Paprika recipe export.
 * Deduplicates by name (case-insensitive).
 * Returns { imported, skipped, total }.
 */
export async function importPaprikaMeals(paprikaMeals) {
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
}

export const SEED_DRINKS = [
  {
    name: 'Classic Margarita',
    ingredients: ['2 oz Tequila (blanco)', '1 oz Cointreau or triple sec', '3/4 oz Fresh lime juice', 'Kosher salt (for rim)', 'Lime wheel (for garnish)', 'Ice'],
    directions: ['Rub a lime wedge around the rim of a rocks glass, then dip in salt.', 'Fill glass with ice.', 'Combine tequila, Cointreau, and lime juice in a shaker with ice.', 'Shake well for 15 seconds.', 'Strain into the prepared glass over fresh ice.', 'Garnish with a lime wheel.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400',
  },
  {
    name: 'Old Fashioned',
    ingredients: ['2 oz Bourbon or Rye whiskey', '1 sugar cube (or 1 tsp simple syrup)', '2 dashes Angostura bitters', 'Orange peel (for garnish)', 'Maraschino cherry (optional)', 'Ice'],
    directions: ['Place sugar cube in a rocks glass and saturate with bitters. Add a splash of water.', 'Muddle until the sugar is dissolved.', 'Add whiskey and stir to combine.', 'Add a large ice cube.', 'Express an orange peel over the glass and drop it in.', 'Optional: add a cherry garnish.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400',
  },
  {
    name: 'Moscow Mule',
    ingredients: ['2 oz Vodka', '4 oz Ginger beer', '1/2 oz Fresh lime juice', 'Lime wedge (for garnish)', 'Fresh mint (optional)', 'Ice'],
    directions: ['Fill a copper mug (or highball glass) with ice.', 'Pour vodka and lime juice over ice.', 'Top with ginger beer and gently stir.', 'Garnish with a lime wedge and fresh mint if desired.'],
    link: '',
    imageUrl: 'https://images.unsplash.com/photo-1607446045875-c4a6f74f9e64?w=400',
  },
];
