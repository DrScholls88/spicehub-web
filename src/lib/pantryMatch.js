// pantryMatch.js — cross-reference pantry inventory against recipe ingredients.
// Adapts BarLibrary.jsx's proven matchScore/tier pattern (Ready to Cook /
// Almost There) for meals, and treats staples ("Always Assumed Stocked", per
// pantryDomain.js's isStaple) the same way BarLibrary already treats the bar's
// own always-on-hand items — a staple never counts as a missing ingredient.

import { normalizeIngredient } from '../utils/ingredientNormalizer.js';
import { isStaple } from './pantryDomain.js';

// Missing-count tiers — mirrors BarLibrary.jsx's `almostReady` convention
// (missing > 0 && missing <= 2) rather than a blanket coverage percentage, so
// a 10-ingredient meal missing 2 fresh items reads the same as a 3-ingredient
// meal missing 2.
const ALMOST_MAX_MISSING = 2;

/**
 * Build a normalized lookup set from pantry/bar inventory records.
 * @param {Array} inventory - Records from db.barInventory (via getInventory()).
 * @returns {Set<string>} canonicalized ingredient names
 */
function buildPantrySet(inventory) {
  const pantrySet = new Set();
  for (const item of inventory || []) {
    const raw = item?.ingredient || item?.name || '';
    if (!raw) continue;
    const result = normalizeIngredient(raw);
    const canon = result?.canonical || raw.toLowerCase().trim();
    if (canon) pantrySet.add(canon);
  }
  return pantrySet;
}

/**
 * Score one meal against a pantry set. Staples are always treated as matched
 * (isStaple short-circuits before the pantry lookup) — a recipe should only
 * ever be flagged as "missing" a fresh ingredient or a specific non-staple.
 *
 * @returns {{meal, matched, total, missing: string[], coverage: number} | null}
 *   null when the meal has no usable ingredient list.
 */
export function matchMealAgainstPantry(meal, pantrySet) {
  const ingredients = meal?.ingredientsStructured;
  if (!ingredients?.length) return null;

  const total = ingredients.length;
  let matched = 0;
  const missing = [];

  for (const ing of ingredients) {
    const name = ing?.name || ing?.ingredient || '';
    if (!name) { matched++; continue; } // skip empty entries

    if (isStaple(name)) { matched++; continue; }

    const result = normalizeIngredient(name);
    const canon = result?.canonical || name.toLowerCase().trim();

    if (pantrySet.has(canon)) matched++;
    else missing.push(name);
  }

  const coverage = total > 0 ? matched / total : 0;
  return { meal, matched, total, missing, coverage };
}

/**
 * Classify a scored meal into a match tier.
 * @param {{missing: string[]}} scored
 * @returns {'ready'|'almost'|null}
 */
export function getMatchTier(scored) {
  if (!scored) return null;
  const missingCount = scored.missing.length;
  if (missingCount === 0) return 'ready';
  if (missingCount <= ALMOST_MAX_MISSING) return 'almost';
  return null;
}

/**
 * Find meals the user can cook (or almost cook) based on current pantry
 * inventory, bucketed for a "Cook Tonight" style carousel.
 *
 * @param {Array} fridgeInventory - Records from db.barInventory (kitchen domain).
 * @param {Array} meals - All meals with ingredientsStructured.
 * @param {Object} [opts]
 * @param {number} [opts.limit=3] - Max results to return per bucket.
 * @returns {{ready: Array, almost: Array}}
 */
export function findPantryMatches(fridgeInventory, meals, { limit = 3 } = {}) {
  if (!fridgeInventory?.length || !meals?.length) return { ready: [], almost: [] };

  const pantrySet = buildPantrySet(fridgeInventory);
  if (pantrySet.size === 0) return { ready: [], almost: [] };

  const ready = [];
  const almost = [];

  for (const meal of meals) {
    const scored = matchMealAgainstPantry(meal, pantrySet);
    if (!scored) continue;
    const tier = getMatchTier(scored);
    if (tier === 'ready') ready.push(scored);
    else if (tier === 'almost') almost.push(scored);
  }

  ready.sort((a, b) => b.coverage - a.coverage);
  almost.sort((a, b) => (a.missing.length - b.missing.length) || (b.coverage - a.coverage));

  return { ready: ready.slice(0, limit), almost: almost.slice(0, limit) };
}

/**
 * Build a per-meal match-status index for badging an entire library view
 * (e.g. MealLibrary cards) — unlike findPantryMatches, this covers every
 * meal, not just a top-N slice, keyed by the same id-or-name convention the
 * carousel already uses.
 *
 * @param {Array} fridgeInventory - Records from db.barInventory (kitchen domain).
 * @param {Array} meals - All meals with ingredientsStructured.
 * @returns {Map<string, {tier: 'ready'|'almost', matched: number, total: number, missing: string[]}>}
 */
export function buildPantryMatchIndex(fridgeInventory, meals) {
  const index = new Map();
  if (!fridgeInventory?.length || !meals?.length) return index;

  const pantrySet = buildPantrySet(fridgeInventory);
  if (pantrySet.size === 0) return index;

  for (const meal of meals) {
    const scored = matchMealAgainstPantry(meal, pantrySet);
    if (!scored) continue;
    const tier = getMatchTier(scored);
    if (!tier) continue;
    const key = meal.id || meal.name;
    if (!key) continue;
    index.set(key, { tier, matched: scored.matched, total: scored.total, missing: scored.missing });
  }

  return index;
}
