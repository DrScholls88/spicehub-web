/**
 * enrich.js — fill gaps in thin drink imports from the bundled cocktail corpus.
 *
 * When an import is explicitly locked to kind:'drink' (kindLocked: true), a
 * name match against SEED_COCKTAILS lets us backfill fields the extraction
 * left blank — glass, method, garnish, abv, and genuinely-missing measured
 * ingredients — without ever overwriting anything the extraction already got
 * right. This is corpus-assisted backfill, not re-extraction: every write is
 * gated on the target field being blank first.
 *
 * Runs entirely offline (no network, no LLM call) against the SEED_COCKTAILS
 * corpus already bundled with the app, so it holds under "Offline
 * Sovereignty". Only runs on a user-locked kind:'drink' — an auto-detected
 * kind is left alone so a false-positive meal recipe never gets cocktail
 * fields grafted onto it.
 *
 * @module import/enrich
 */

import { SEED_COCKTAILS } from '../data/bar/seedCocktails.js';
import { canonicalizeIngredient } from '../lib/barMatch.js';
import { parseIngredientLine, structuredItemFromRaw } from '../recipeSchema.js';

let _byName = null;

function normalizeDrinkName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function corpusIndex() {
  if (_byName) return _byName;
  _byName = new Map();
  for (const drink of SEED_COCKTAILS) {
    const key = normalizeDrinkName(drink.name);
    if (key && !_byName.has(key)) _byName.set(key, drink);
  }
  return _byName;
}

/**
 * Find a corpus entry matching a drink name — exact normalized match first,
 * then a conservative one-directional substring match: the imported title
 * containing a canonical corpus name (e.g. "The Best Old Fashioned" contains
 * "old fashioned"), never the reverse, so a bare "Martini" can't spuriously
 * match "Dirty Martini" or "French Martini". The longest matching corpus key
 * wins when more than one qualifies.
 *
 * @param {string} name
 * @returns {object|null} a SEED_COCKTAILS entry, or null
 */
export function findCorpusMatch(name) {
  const key = normalizeDrinkName(name);
  if (!key || key.length < 3) return null;

  const index = corpusIndex();
  const exact = index.get(key);
  if (exact) return exact;

  let best = null;
  let bestKeyLen = 0;
  for (const [corpusKey, drink] of index) {
    if (corpusKey.length < 4) continue; // guard against trivial substrings
    if (key.includes(corpusKey) && corpusKey.length > bestKeyLen) {
      best = drink;
      bestKeyLen = corpusKey.length;
    }
  }
  return best;
}

const BLANK = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Backfill blank fields on a drink recipe from a matched corpus entry.
 * Mutates and returns `recipe`. Never overwrites a populated field, and only
 * runs when the caller has locked the import to kind:'drink'.
 *
 * @param {object} recipe — the structured recipe (mutated in place)
 * @param {{ kind?: string, kindLocked?: boolean }} opts
 * @returns {object} recipe
 */
export function enrichDrinkFromCorpus(recipe, opts = {}) {
  if (!recipe || opts.kind !== 'drink' || !opts.kindLocked) return recipe;

  const match = findCorpusMatch(recipe.title);
  if (!match) return recipe;

  if (BLANK(recipe.glass) && match.glass) recipe.glass = match.glass;
  if (BLANK(recipe.method) && match.method) recipe.method = match.method;
  if (BLANK(recipe.garnish) && match.garnish) recipe.garnish = match.garnish;
  if (BLANK(recipe.abv) && typeof match.abv === 'number') recipe.abv = match.abv;

  const existing = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  // Nothing extracted at all isn't ours to paper over — gate.js already
  // decides pass/salvage/empty on ingredient count; we only top up a
  // genuinely thin (but non-empty) extraction.
  if (!existing.length) return recipe;

  const haveCanonical = new Set(existing.map(canonicalizeIngredient).filter(Boolean));
  const corpusLines = Array.isArray(match.ingredients) ? match.ingredients : [];
  const missingLines = corpusLines.filter((line) => {
    const canon = canonicalizeIngredient(line);
    return canon && !haveCanonical.has(canon);
  });
  if (!missingLines.length) return recipe;

  // Reuse the same parse/build primitives recipeSchema.js uses for every
  // other ingredient line, so appended items are byte-shape-identical to
  // extracted ones (same ref/category/display/original_text fields).
  const newStructured = missingLines.map((line) =>
    structuredItemFromRaw(parseIngredientLine(line), '', 'drink')
  );

  recipe.ingredients = [...existing, ...newStructured.map((it) => it.original_text)];
  if (Array.isArray(recipe.ingredientsStructured)) {
    recipe.ingredientsStructured = [...recipe.ingredientsStructured, ...newStructured];
  }

  return recipe;
}
