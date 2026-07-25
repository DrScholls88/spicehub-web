// pantryMatch.js — cross-reference pantry inventory against recipe ingredients.
// Adapts the barMatch.js pattern for meals: normalize ingredient names, compute
// coverage %, surface meals you can cook with what you have on hand.

import { normalizeIngredient } from '../utils/ingredientNormalizer.js';

const MATCH_THRESHOLD = 0.6; // 60% ingredient coverage required

/**
 * Find meals the user can cook based on their current pantry inventory.
 *
 * @param {Array} fridgeInventory - Items from Dexie fridgeInventory table
 * @param {Array} meals - All meals with ingredientsStructured
 * @param {Object} [opts]
 * @param {number} [opts.limit=3] - Max results to return
 * @returns {Array<{meal, coverage, matched, total, missing}>}
 */
export function findPantryMatches(fridgeInventory, meals, { limit = 3 } = {}) {
  if (!fridgeInventory?.length || !meals?.length) return [];

  // Build normalized set of what's in the pantry
  const pantrySet = new Set();
  for (const item of fridgeInventory) {
    const raw = item?.ingredient || item?.name || '';
    if (!raw) continue;
    const result = normalizeIngredient(raw);
    const canon = result?.canonical || raw.toLowerCase().trim();
    if (canon) pantrySet.add(canon);
  }

  if (pantrySet.size === 0) return [];

  const scored = [];

  for (const meal of meals) {
    const ingredients = meal.ingredientsStructured;
    if (!ingredients?.length) continue;

    const total = ingredients.length;
    let matched = 0;
    const missing = [];

    for (const ing of ingredients) {
      const name = ing?.name || ing?.ingredient || '';
      if (!name) { matched++; continue; } // skip empty entries

      const result = normalizeIngredient(name);
      const canon = result?.canonical || name.toLowerCase().trim();

      if (pantrySet.has(canon)) {
        matched++;
      } else {
        missing.push(name);
      }
    }

    const coverage = total > 0 ? matched / total : 0;
    if (coverage >= MATCH_THRESHOLD) {
      scored.push({ meal, coverage, matched, total, missing: missing.slice(0, 3) });
    }
  }

  scored.sort((a, b) => b.coverage - a.coverage);
  return scored.slice(0, limit);
}
