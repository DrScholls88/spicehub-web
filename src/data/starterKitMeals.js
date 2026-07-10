// =============================================================================
// starterKitMeals.js — curated intro pack for new users
// -----------------------------------------------------------------------------
// Deployable seed source. Entries are reviewed, cookable recipes (not bulk
// export dumps). Shape matches what the Import Engine saves after review.
//
// Admin workflow (upgrade a recipe later):
// 1. Re-run the recipe URL through the Import Engine.
// 2. Review/fix it in ImportReview and save.
// 3. Copy the saved meal from SpiceHubDB.meals (DevTools / export).
// 4. Replace that entry in starterKitData.js after stripping local-only fields:
//    id, status, jobId, sourceHash, createdAt, updatedAt, starterKit, importedAt.
//
// Quality bar for every meal:
//   ≥4 ingredients, ≥2 directions, stable image URL, clear single dish.
// =============================================================================

import { STARTER_KIT_RAW } from './starterKitData.js';
import { upgradeRecipeIngredients } from '../recipeSchema';

const MIN_INGREDIENTS = 4;
const MIN_DIRECTIONS = 2;

const LOCAL_ONLY_FIELDS = [
  'id',
  'status',
  'jobId',
  'sourceHash',
  'createdAt',
  'updatedAt',
  'importedAt',
  'starterKit',
];

function normalizeNotes(notes) {
  if (Array.isArray(notes)) {
    return notes
      .map((note) => {
        if (typeof note === 'string') return { title: '', text: note };
        return {
          title: note?.title || '',
          text: note?.text || '',
        };
      })
      .filter((note) => note.title || note.text);
  }
  return notes ? [{ title: '', text: String(notes) }] : [];
}

function stripLocalOnlyFields(raw) {
  const clean = { ...raw };
  for (const field of LOCAL_ONLY_FIELDS) delete clean[field];
  return clean;
}

/** True when a seed meal is complete enough to impress a new user. */
export function isStarterMealComplete(meal) {
  if (!meal?.name || !String(meal.name).trim()) return false;
  const ings = Array.isArray(meal.ingredients) ? meal.ingredients.filter(Boolean) : [];
  const dirs = Array.isArray(meal.directions) ? meal.directions.filter(Boolean) : [];
  return ings.length >= MIN_INGREDIENTS && dirs.length >= MIN_DIRECTIONS;
}

/**
 * Normalize one reviewed seed row into the shape Dexie expects.
 * Never stamps starterKit/importedAt — buildStarterKitMeals owns that.
 */
export function prepareStarterMeal(raw, now = new Date().toISOString()) {
  try {
    const clean = stripLocalOnlyFields(raw);
    const ingredients = Array.isArray(clean.ingredients) ? clean.ingredients.filter(Boolean) : [];
    const directions = Array.isArray(clean.directions) ? clean.directions.filter(Boolean) : [];

    let ingredientsStructured = Array.isArray(clean.ingredientsStructured) && clean.ingredientsStructured.length
      ? clean.ingredientsStructured
      : null;
    if (!ingredientsStructured) {
      try {
        const upgraded = upgradeRecipeIngredients({ name: clean.name, ingredients, directions });
        ingredientsStructured = upgraded.ingredientsStructured || [];
      } catch {
        ingredientsStructured = [];
      }
    }

    const directionsStructured = Array.isArray(clean.directionsStructured) && clean.directionsStructured.length
      ? clean.directionsStructured
      : directions.map((text) => ({ text, ingredientRefs: [] }));

    const notes = normalizeNotes(clean.notes);

    const meal = {
      name: (clean.name || '').trim() || 'Untitled Recipe',
      ingredients,
      directions,
      ingredientsStructured,
      directionsStructured,
      ingredients_text: clean.ingredients_text || ingredients.join(' '),
      notes,
      _notesFlat: clean._notesFlat || notes.map((n) => n.text).filter(Boolean).join('\n\n'),
      sourceUrl: clean.sourceUrl || '',
      imageUrl: clean.imageUrl || '',
      isFavorite: !!clean.isFavorite,
      rating: typeof clean.rating === 'number' ? clean.rating : 0,
      category: clean.category || 'Dinners',
      cuisine: clean.cuisine || '',
      course: clean.course || '',
      dishType: clean.dishType || '',
      dietaryTags: Array.isArray(clean.dietaryTags) ? clean.dietaryTags : [],
      servings: clean.servings || '',
      prepTime: clean.prepTime || '',
      cookTime: clean.cookTime || '',
      totalTime: clean.totalTime || '',
      description: clean.description || '',
      recipeYield: clean.recipeYield || clean.servings || '',
      nutrition: clean.nutrition ?? null,
      confidence: typeof clean.confidence === 'number' ? clean.confidence : null,
      needsReview: clean.needsReview ?? false,
      _type: 'meal',
      inRotation: clean.inRotation ?? true,
      starterKit: true,
      importedAt: now,
      ...(clean._structuredVia ? { _structuredVia: clean._structuredVia } : {}),
      ...(clean.engineVersion ? { engineVersion: clean.engineVersion } : {}),
    };

    for (const field of LOCAL_ONLY_FIELDS) {
      if (field !== 'starterKit' && field !== 'importedAt') delete meal[field];
    }
    delete meal.link;

    return meal;
  } catch (error) {
    console.warn('[SpiceHub] Starter Kit skipped malformed seed:', raw?.name, error);
    return null;
  }
}

/** Static pack (completeness-filtered). Does not stamp starterKit. */
export const STARTER_KIT_MEALS = STARTER_KIT_RAW.filter(isStarterMealComplete);

/**
 * Build meals ready for importSeedMeals / first-run seed.
 * @param {object[]} [seedMeals=STARTER_KIT_MEALS]
 * @param {string} [now]
 */
export function buildStarterKitMeals(seedMeals = STARTER_KIT_MEALS, now = new Date().toISOString()) {
  return seedMeals
    .map((meal) => prepareStarterMeal(meal, now))
    .filter(Boolean)
    .filter(isStarterMealComplete);
}

export const STARTER_KIT_SEED_FLAG = 'spicehub-starter-kit-seeded';
