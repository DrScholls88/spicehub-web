// =============================================================================
// starterKitMeals.js — SpiceHub "Starter Kit" pre-seeded recipes
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// Gemini UX audit (2026-07-06, see gemini-analysis-action-items.md #4) flagged
// the 0-meals empty state as a trust-breaker: a brand-new install shows a blank
// library, and the Spin CTA has nothing to work with. This wires up
// `SEED_MEALS` from paprika_import_data.js — 32 of Brian's own real
// Instagram/Paprika-saved recipes — which was already imported into App.jsx
// but never actually used anywhere (dead code, same pattern as the unwired
// redditDiscovery.js scraper found in the same audit pass). Using real,
// already-curated recipes instead of inventing generic filler content.
//
// DESIGN NOTES
// - SEED_MEALS is the LEGACY flat shape (`ingredients: string[]`,
//   `directions: string[]`, `notes: string`, `link`, `category`, `imageUrl`,
//   `isFavorite`, `rating`, `cookCount`) — a straight Paprika-app export, not
//   run through the LLM extraction pipeline. This module upgrades each record
//   to the current schema (ingredientsStructured, directionsStructured,
//   ingredients_text search index, notes as [{title,text}], sourceUrl) using
//   the SAME upgrade helpers the v14/v16 Dexie migrations use for old
//   records, so these behave identically to any other meal in the library.
// - Many imageUrl values are tokenized Instagram/Facebook CDN links (scontent.
//   cdninstagram.com, fbcdn.net) that expire and will 403 (see memory: "IG
//   Image 403 Fix"). That's fine — MealLibrary's CardImage/SafeMediaImage
//   already renders a placeholder icon on any missing/broken image; nothing
//   special needed here, and no network call happens at seed time either way
//   (Offline Sovereignty — no fetch, just storing the URL string).
// - A few source records have empty `ingredients` or `directions` arrays
//   (e.g. "Egg Bake", "Pot Sticker Stir Fry") — that's the real state of
//   Brian's saved data, not a bug to silently fix here. They still seed fine;
//   MealLibrary already renders "0 ing / 0 steps" as a normal (not broken)
//   state.
// - Every recipe is tagged `starterKit: true` and `inRotation: true` so it's
//   immediately spin-eligible (weekPlanner.js rotation-only scorer) and can be
//   bulk-removed later via db.removeStarterKitMeals() + the Settings sheet.
// - Category (Dinners/Breakfasts/etc, for MealLibrary's CATEGORY_COLORS) is
//   inferred from the source `category`/name since Paprika's category field
//   ("Pasta", "Casseroles", "Tailgate", "Sweets"...) doesn't map 1:1 to
//   SpiceHub's fixed category set.
// =============================================================================

import { SEED_MEALS } from '../paprika_import_data';
import { upgradeRecipeIngredients } from '../recipeSchema';
import { buildStructuredFields } from '../recipeParser';

const BREAKFAST_KEYWORDS = ['oatmeal', 'pancake', 'french toast', 'egg bake', 'breakfast'];
const DESSERT_KEYWORDS = ['cookie', 'sweets', 'dessert'];

/** Map a Paprika-export record's loose category/name into SpiceHub's fixed
 * Library categories (Dinners/Breakfasts/Lunches/Desserts/Sides/Tailgate/Snacks). */
function inferCategory(raw) {
  const cat = (raw.category || '').toLowerCase();
  const name = (raw.name || '').toLowerCase();
  if (cat.includes('breakfast') || BREAKFAST_KEYWORDS.some(k => name.includes(k))) return 'Breakfasts';
  if (cat.includes('sweet') || cat.includes('dessert') || DESSERT_KEYWORDS.some(k => name.includes(k))) return 'Desserts';
  if (cat.includes('tailgate')) return 'Tailgate';
  return 'Dinners';
}

/** Upgrade one legacy SEED_MEALS record to the current meal schema. Returns
 * null (and logs) if a single record is malformed — one bad record must never
 * abort seeding the rest, matching the defensive pattern already used in the
 * db.js v14 Dexie migration. */
function upgradeOne(raw, now) {
  try {
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
    const directions = Array.isArray(raw.directions) ? raw.directions : [];
    const upgraded = upgradeRecipeIngredients({ name: raw.name, ingredients, directions });
    const structuredFields = buildStructuredFields(ingredients, directions);
    const directionsStructured = directions
      .filter(Boolean)
      .map(text => ({ text, ingredientRefs: [] }));

    return {
      ...upgraded,
      ...structuredFields,
      name: (raw.name || '').trim() || 'Untitled Recipe',
      directionsStructured,
      notes: raw.notes ? [{ title: '', text: raw.notes }] : [],
      _notesFlat: raw.notes || '',
      sourceUrl: raw.link || '',
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
      starterKit: true,
      importedAt: now,
    };
  } catch (error) {
    console.warn('[SpiceHub] Starter Kit — skipped a malformed seed record:', raw?.name, error);
    return null;
  }
}

/**
 * Build the final, ready-to-persist meal objects for the Starter Kit.
 * Pure function — safe to call repeatedly. Dedup against existing meals
 * happens in db.importSeedMeals() by name, so calling this twice never
 * creates duplicates.
 */
export function buildStarterKitMeals() {
  const now = new Date().toISOString();
  return SEED_MEALS.map(raw => upgradeOne(raw, now)).filter(Boolean);
}
