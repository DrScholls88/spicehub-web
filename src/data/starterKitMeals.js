// =============================================================================
// StarterKitMeals.js — reviewed SpiceHub seed pack for new users
// -----------------------------------------------------------------------------
// This file is the deployable seed source. Keep entries in the same shape the
// Import Engine saves after review, not the old Paprika export format.
//
// Admin workflow:
// 1. Re-run a starter recipe through the Import Engine.
// 2. Review/fix it in the app.
// 3. Export/copy the saved meal record from SpiceHubDB.meals.
// 4. Replace that entry in STARTER_KIT_MEALS after removing local-only fields
//    like id, status, jobId, sourceHash, createdAt, updatedAt.
//
// The initial entries below are mechanically upgraded from the previous Paprika
// starter pack so existing first-run behavior stays intact while the pack is
// converted recipe-by-recipe to reviewed Import Engine output.
// =============================================================================

import { SEED_MEALS as LEGACY_PAPRIKA_MEALS } from '../paprika_import_data.js';
import { upgradeRecipeIngredients } from '../recipeSchema';
import { buildStructuredFields } from '../recipeParser';

const BREAKFAST_KEYWORDS = ['oatmeal', 'pancake', 'french toast', 'egg bake', 'breakfast'];
const DESSERT_KEYWORDS = ['cookie', 'sweets', 'dessert'];

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

function inferCategory(raw) {
  const cat = (raw.category || '').toLowerCase();
  const name = (raw.name || '').toLowerCase();
  if (cat.includes('breakfast') || BREAKFAST_KEYWORDS.some(k => name.includes(k))) return 'Breakfasts';
  if (cat.includes('sweet') || cat.includes('dessert') || DESSERT_KEYWORDS.some(k => name.includes(k))) return 'Desserts';
  if (cat.includes('tailgate')) return 'Tailgate';
  return raw.category || 'Dinners';
}

function normalizeNotes(notes) {
  if (Array.isArray(notes)) {
    return notes
      .map(note => {
        if (typeof note === 'string') return { title: '', text: note };
        return {
          title: note?.title || '',
          text: note?.text || '',
        };
      })
      .filter(note => note.title || note.text);
  }
  return notes ? [{ title: '', text: String(notes) }] : [];
}

function stripLocalOnlyFields(raw) {
  const clean = { ...raw };
  for (const field of LOCAL_ONLY_FIELDS) delete clean[field];
  return clean;
}

function legacyPaprikaToReviewedSeed(raw) {
  try {
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
    const directions = Array.isArray(raw.directions) ? raw.directions : [];
    const upgraded = upgradeRecipeIngredients({ name: raw.name, ingredients, directions });
    const structuredFields = buildStructuredFields(ingredients, directions);

    return {
      ...upgraded,
      ...structuredFields,
      name: (raw.name || '').trim() || 'Untitled Recipe',
      directionsStructured: directions
        .filter(Boolean)
        .map(text => ({ text, ingredientRefs: [] })),
      notes: normalizeNotes(raw.notes),
      _notesFlat: raw.notes || '',
      sourceUrl: raw.link || raw.sourceUrl || '',
      imageUrl: raw.imageUrl || '',
      isFavorite: !!raw.isFavorite,
      rating: typeof raw.rating === 'number' ? raw.rating : 0,
      category: inferCategory(raw),
      cuisine: '',
      course: '',
      dishType: '',
      dietaryTags: [],
      servings: '',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      description: '',
      recipeYield: '',
      nutrition: null,
      confidence: null,
      needsReview: false,
      _type: 'meal',
      inRotation: true,
    };
  } catch (error) {
    console.warn('[SpiceHub] Starter Kit skipped malformed legacy seed:', raw?.name, error);
    return null;
  }
}

export const STARTER_KIT_MEALS = LEGACY_PAPRIKA_MEALS
  .map(legacyPaprikaToReviewedSeed)
  .filter(Boolean);

function prepareStarterMeal(raw, now) {
  try {
    const clean = stripLocalOnlyFields(raw);
    const ingredients = Array.isArray(clean.ingredients) ? clean.ingredients : [];
    const directions = Array.isArray(clean.directions) ? clean.directions : [];
    const fallbackStructured = buildStructuredFields(ingredients, directions);

    const meal = {
      ...fallbackStructured,
      ...clean,
      name: (clean.name || '').trim() || 'Untitled Recipe',
      ingredients,
      directions,
      ingredientsStructured: Array.isArray(clean.ingredientsStructured) && clean.ingredientsStructured.length
        ? clean.ingredientsStructured
        : fallbackStructured.ingredientsStructured,
      directionsStructured: Array.isArray(clean.directionsStructured)
        ? clean.directionsStructured
        : directions.filter(Boolean).map(text => ({ text, ingredientRefs: [] })),
      ingredients_text: clean.ingredients_text || fallbackStructured.ingredients_text || ingredients.join(' '),
      notes: normalizeNotes(clean.notes),
      sourceUrl: clean.sourceUrl || clean.link || '',
      _notesFlat: clean._notesFlat || normalizeNotes(clean.notes).map(note => note.text).filter(Boolean).join('\n\n'),
      imageUrl: clean.imageUrl || '',
      isFavorite: !!clean.isFavorite,
      rating: typeof clean.rating === 'number' ? clean.rating : 0,
      category: clean.category || inferCategory(clean),
      cuisine: clean.cuisine || '',
      course: clean.course || '',
      dishType: clean.dishType || '',
      dietaryTags: Array.isArray(clean.dietaryTags) ? clean.dietaryTags : [],
      servings: clean.servings || '',
      prepTime: clean.prepTime || '',
      cookTime: clean.cookTime || '',
      totalTime: clean.totalTime || '',
      description: clean.description || '',
      recipeYield: clean.recipeYield || '',
      nutrition: clean.nutrition ?? null,
      confidence: clean.confidence ?? null,
      needsReview: clean.needsReview ?? false,
      _type: 'meal',
      inRotation: clean.inRotation ?? true,
      starterKit: true,
      importedAt: now,
    };

    for (const field of LOCAL_ONLY_FIELDS) {
      if (field !== 'starterKit' && field !== 'importedAt') delete meal[field];
    }
    delete meal.link;

    return meal;
  } catch (error) {
    console.warn('[SpiceHub] Starter Kit skipped malformed reviewed seed:', raw?.name, error);
    return null;
  }
}

export function buildStarterKitMeals(seedMeals = STARTER_KIT_MEALS, now = new Date().toISOString()) {
  return seedMeals.map(meal => prepareStarterMeal(meal, now)).filter(Boolean);
}
