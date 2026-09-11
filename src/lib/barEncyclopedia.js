/**
 * barEncyclopedia.js — "how many classics use this?" ingredient reference,
 * derived entirely from the bundled SEED_COCKTAILS corpus (idea 5: no live
 * filter.php?i= calls — the corpus is already bundled for offline use, per
 * "Offline Sovereignty").
 *
 * Powers the BarFridge/BarShelf bottle-tap fact: "You have Campari — 12
 * classics use it." This is a UNIVERSAL reference count against the curated
 * classics corpus, independent of the user's own drinks library — see
 * barMatch.matchDrink (and BarFridgeMode's "Unlocks N recipes") for the
 * personalized "recipes you can actually make" feature, which this
 * complements rather than replaces.
 *
 * Pure data/logic module — no React/JSX, so it does not touch design.md's
 * UI/component gate. Wiring the bottle-tap card itself into
 * BarFridgeMode.jsx/BarShelf.jsx is left as a follow-up UI change.
 *
 * @module lib/barEncyclopedia
 */

import { SEED_COCKTAILS } from '../data/bar/seedCocktails.js';
import { canonicalizeIngredient } from './barMatch.js';

let _index = null;

function buildIndex() {
  const index = new Map(); // canonical ingredient -> [{ name, glass, abv }]
  for (const drink of SEED_COCKTAILS) {
    const lines = Array.isArray(drink.ingredients) ? drink.ingredients : [];
    const seenInThisDrink = new Set(); // don't double-count a repeated ingredient within one drink
    for (const line of lines) {
      const canon = canonicalizeIngredient(line);
      if (!canon || seenInThisDrink.has(canon)) continue;
      seenInThisDrink.add(canon);
      if (!index.has(canon)) index.set(canon, []);
      index.get(canon).push({ name: drink.name, glass: drink.glass || '', abv: drink.abv ?? null });
    }
  }
  return index;
}

function index() {
  if (!_index) _index = buildIndex();
  return _index;
}

/**
 * Classic cocktails from the bundled corpus that use a given ingredient —
 * alias/canonicalization-aware, so "Campari" and a raw line like "1 oz
 * Campari" resolve to the same bucket.
 *
 * @param {string} ingredientName
 * @returns {Array<{name: string, glass: string, abv: number|null}>}
 */
export function classicsUsing(ingredientName) {
  const canon = canonicalizeIngredient(ingredientName);
  if (!canon) return [];
  return index().get(canon) || [];
}

/**
 * How many classics use a given ingredient — the count half of the
 * "You have Campari — 12 classics use it" bottle-tap fact.
 *
 * @param {string} ingredientName
 * @returns {number}
 */
export function classicsCountFor(ingredientName) {
  return classicsUsing(ingredientName).length;
}

/**
 * Friendly one-line fact for a bottle-tap card. Returns null when the
 * corpus has no classics using this ingredient (nothing worth saying).
 *
 * @param {string} ingredientName
 * @param {string} [displayName] — label to show instead of the raw ingredient
 * @returns {string|null}
 */
export function bottleTapFact(ingredientName, displayName) {
  const count = classicsCountFor(ingredientName);
  if (!count) return null;
  const label = displayName || ingredientName;
  return `You have ${label} — ${count} classic${count === 1 ? '' : 's'} use${count === 1 ? 's' : ''} it.`;
}

/**
 * Every ingredient the corpus indexes, most-used first. Useful for an
 * "essential bottles" ranking (which single bottle unlocks the most
 * classics) independent of any one user's shelf.
 *
 * @param {number} [limit]
 * @returns {Array<{ingredient: string, count: number}>}
 */
export function mostVersatileIngredients(limit = 20) {
  return [...index().entries()]
    .map(([ingredient, drinks]) => ({ ingredient, count: drinks.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
