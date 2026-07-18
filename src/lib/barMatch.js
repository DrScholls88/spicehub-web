// barMatch.js — deterministic, offline, zero-cost drink/inventory matcher.
//
// Replaces the naive `includes()` scoring that produced false positives
// (e.g. "ice" matching "juice"). Matching works on canonical tokens plus
// three curated resources:
//   - barCategories.json : spirit/mixer categories + interchangeability
//   - barAliases.json    : exact-equivalent synonym groups
//   - barDerived.json    : ingredients you can make from other shelf items
//
// Public API:
//   categorizeBottle(name)            -> category | null
//   canonicalizeIngredient(name)      -> canonical token string
//   matchDrink(drink, inventoryNames) -> { matched, missing, derivable, score, tier }
//   pickSurprise(scored, opts)        -> a scored entry (or null)

import categoriesData from '../data/bar/barCategories.json';
import aliasesData from '../data/bar/barAliases.json';
import derivedData from '../data/bar/barDerived.json';
import substitutesData from '../data/bar/barSubstitutes.json';

const CATEGORIES = (categoriesData && categoriesData.categories) || {};
const ALIAS_GROUPS = (aliasesData && aliasesData.groups) || [];
const DERIVED = (derivedData && derivedData.derived) || [];
const SUBSTITUTE_GROUPS = (substitutesData && substitutesData.substitutes) || [];

// Measurement / filler words stripped during canonicalization so that
// "2 oz fresh lime juice" and "lime juice" collapse to the same token.
const MEASURE_WORDS = new Set([
  'oz', 'ounce', 'ounces', 'ml', 'cl', 'l', 'cup', 'cups', 'tsp', 'teaspoon',
  'teaspoons', 'tbsp', 'tablespoon', 'tablespoons', 'dash', 'dashes', 'splash',
  'splashes', 'part', 'parts', 'shot', 'shots', 'pinch', 'drop', 'drops',
  'cube', 'cubes', 'slice', 'slices', 'wedge', 'wedges', 'sprig', 'sprigs',
  'piece', 'pieces', 'scoop', 'scoops', 'bottle', 'can', 'glass',
]);

// Descriptors that don't change the ingredient identity for matching purposes.
const FILLER_WORDS = new Set([
  'fresh', 'freshly', 'chilled', 'cold', 'hot', 'warm', 'good', 'quality',
  'premium', 'optional', 'to', 'taste', 'of', 'a', 'an', 'the', 'some',
  'squeezed', 'juiced', 'crushed', 'chopped', 'ground', 'whole', 'large',
  'small', 'medium', 'ripe', 'about', 'approximately', 'plus', 'more', 'for',
  'garnish', 'preferably', 'or', 'and',
]);

// ── Alias map: every synonym -> canonical (first entry of its group) ───────────
const ALIAS_TO_CANONICAL = (() => {
  const map = new Map();
  for (const group of ALIAS_GROUPS) {
    if (!Array.isArray(group) || group.length === 0) continue;
    const canonical = normalizeRaw(group[0]);
    for (const member of group) {
      map.set(normalizeRaw(member), canonical);
    }
  }
  return map;
})();

// ── Category lookup: member keyword (normalized) -> category name ──────────────
// Longer member keywords are checked first so "london dry gin" resolves before "gin".
const CATEGORY_MEMBERS = (() => {
  const entries = [];
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    const members = (def && def.members) || [];
    for (const m of members) {
      entries.push({ keyword: normalizeRaw(m), category: cat });
    }
  }
  entries.sort((a, b) => b.keyword.length - a.keyword.length);
  return entries;
})();

const INTERCHANGEABLE = new Set(
  Object.entries(CATEGORIES)
    .filter(([, def]) => def && def.interchangeable)
    .map(([cat]) => cat)
);

// ── Global substitute map: ingredient → Set of substitutes ───────────────────
// Built from barSubstitutes.json. For each member of a group, map it to all
// OTHER members of the same group. These are "close enough" swaps (not exact
// aliases — those are handled by ALIAS_TO_CANONICAL).
const SUBSTITUTE_MAP = (() => {
  const map = new Map();
  for (const group of SUBSTITUTE_GROUPS) {
    const members = (group && Array.isArray(group.members)) ? group.members : [];
    if (members.length < 2) continue;
    for (const member of members) {
      const canon = member.toLowerCase().trim();
      if (!map.has(canon)) map.set(canon, new Set());
      for (const other of members) {
        const otherCanon = other.toLowerCase().trim();
        if (otherCanon !== canon) map.get(canon).add(otherCanon);
      }
    }
  }
  return map;
})();

// ── Normalization helpers ─────────────────────────────────────────────────────

// Light normalize: lowercase, strip punctuation/parentheticals, collapse spaces.
function normalizeRaw(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // drop parentheticals
    .replace(/[^a-z0-9\s'’-]/g, ' ')   // punctuation -> space (keep apostrophes/hyphens)
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonicalize an ingredient string down to its identity token(s):
// strip leading quantities/fractions, measurement words and filler words,
// then apply the alias map.
export function canonicalizeIngredient(name) {
  const base = normalizeRaw(name)
    .replace(/\b\d+([./]\d+)?\b/g, ' ')  // whole numbers and fractions like 1/2
    .replace(/[½¼¾⅓⅔⅛]/g, ' ')          // unicode fractions
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = base
    .split(' ')
    .filter(w => w && !MEASURE_WORDS.has(w) && !FILLER_WORDS.has(w));

  const core = tokens.join(' ').trim();
  if (!core) return base; // fall back to base rather than empty
  return ALIAS_TO_CANONICAL.get(core) || core;
}

// Determine the category of a bottle/ingredient name, or null.
export function categorizeBottle(name) {
  const norm = normalizeRaw(name);
  if (!norm) return null;
  const words = new Set(norm.split(' '));
  for (const { keyword, category } of CATEGORY_MEMBERS) {
    if (keyword.includes(' ')) {
      // multiword keyword: require the whole phrase to appear
      if (norm.includes(keyword)) return category;
    } else if (words.has(keyword)) {
      // single-word keyword: require a whole-word match (avoids "ice"⊂"juice")
      return category;
    }
  }
  return null;
}

// Does a single drink ingredient (canonical) match anything on the shelf?
// Shelf is pre-canonicalized into { tokens:Set, categories:Set }.
function ingredientSatisfied(ingCanon, shelf) {
  if (!ingCanon) return false;

  // 1. direct / alias equality
  if (shelf.tokens.has(ingCanon)) return true;

  // 2. whole-word containment either direction (e.g. "lime juice" vs "lime")
  const ingWords = ingCanon.split(' ');
  for (const token of shelf.tokens) {
    if (token === ingCanon) return true;
    const tokWords = token.split(' ');
    // shelf token is a whole-word subset of the ingredient (or vice versa)
    if (tokWords.every(w => ingWords.includes(w))) return true;
    if (ingWords.every(w => tokWords.includes(w))) return true;
  }

  // 3. global substitute match (from barSubstitutes.json)
  const subs = SUBSTITUTE_MAP.get(ingCanon);
  if (subs) {
    for (const sub of subs) {
      if (shelf.tokens.has(sub)) return true;
      // Also check alias-resolved form of substitute
      const subAlias = ALIAS_TO_CANONICAL.get(sub);
      if (subAlias && shelf.tokens.has(subAlias)) return true;
    }
  }

  // 4. category-level match (interchangeable categories only)
  const ingCat = categorizeBottle(ingCanon);
  if (ingCat && INTERCHANGEABLE.has(ingCat) && shelf.categories.has(ingCat)) {
    return true;
  }
  return false;
}

// Is a missing ingredient derivable from other shelf items?
function isDerivable(ingCanon, shelf) {
  for (const rule of DERIVED) {
    if (canonicalizeIngredient(rule.result) !== ingCanon) continue;
    const from = (rule.from || []).map(canonicalizeIngredient);
    if (from.length && from.every(c => ingredientSatisfied(c, shelf))) {
      return { result: rule.result, from: rule.from, hint: rule.hint || '' };
    }
  }
  return null;
}

function buildShelf(inventoryNames) {
  const tokens = new Set();
  const categories = new Set();
  for (const raw of inventoryNames || []) {
    const canon = canonicalizeIngredient(raw);
    if (canon) tokens.add(canon);
    const cat = categorizeBottle(raw);
    if (cat) categories.add(cat);
  }
  return { tokens, categories };
}

// Score a single drink against the shelf.
export function matchDrink(drink, inventoryNames) {
  const ingredients = Array.isArray(drink?.ingredients) ? drink.ingredients : [];
  const total = ingredients.length;
  const result = {
    matched: [],
    missing: [],
    derivable: [],
    score: 0,
    tier: 'reach',
    matchedCount: 0,
    total,
  };
  if (total === 0) return result;

  const shelf = buildShelf(inventoryNames);

  // Build per-recipe substitute lookup from ingredientsStructured if available.
  // Maps canonical food name → array of substitute food names.
  const perRecipeSubs = new Map();
  if (Array.isArray(drink?.ingredientsStructured)) {
    for (const si of drink.ingredientsStructured) {
      if (si?.food && Array.isArray(si.substitutes) && si.substitutes.length) {
        const key = canonicalizeIngredient(si.food);
        perRecipeSubs.set(key, si.substitutes.map(s => canonicalizeIngredient(s.food)));
      }
    }
  }

  for (const ing of ingredients) {
    const canon = canonicalizeIngredient(ing);
    if (ingredientSatisfied(canon, shelf)) {
      result.matched.push(ing);
    } else {
      // Check per-recipe substitutes before falling to derivable/missing.
      const recipeSubs = perRecipeSubs.get(canon);
      let subMatch = false;
      if (recipeSubs) {
        for (const sub of recipeSubs) {
          if (ingredientSatisfied(sub, shelf)) {
            result.matched.push(ing);
            subMatch = true;
            break;
          }
        }
      }
      if (!subMatch) {
        const d = isDerivable(canon, shelf);
        if (d) {
          result.derivable.push({ ingredient: ing, ...d });
        } else {
          result.missing.push(ing);
        }
      }
    }
  }

  result.matchedCount = result.matched.length;
  const hardMissing = result.missing.length;
  // Derivables count as half credit toward the score, full credit toward "ready".
  result.score = (result.matched.length + 0.5 * result.derivable.length) / total;
  if (hardMissing === 0) result.tier = 'ready';
  else if (hardMissing === 1) result.tier = 'almost';
  else result.tier = 'reach';

  return result;
}

// Pick a random drink from scored results, preferring makeable tiers.
// `scored` is an array of { drink, match } (match = matchDrink output).
export function pickSurprise(scored, opts = {}) {
  const tiers = opts.tiers || ['ready', 'almost'];
  const pool = (scored || []).filter(s => tiers.includes(s.match?.tier));
  const source = pool.length ? pool : (scored || []);
  if (!source.length) return null;
  return source[Math.floor(Math.random() * source.length)];
}

export default { categorizeBottle, canonicalizeIngredient, matchDrink, pickSurprise };
