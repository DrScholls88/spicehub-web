// pantryDomain.js — P4: the shared "back of house" between the Bar and the
// Kitchen Pantry. One master inventory store (Dexie `barInventory`) serves both
// rooms; this module derives per-ingredient domain flags (can_drink / can_eat /
// can_both), kitchen categories, staple defaults, storage tips, freshness, and
// the shared semantic quantity enum.
//
// Design rules (see gemini-analysis-action-plan-2026-07.md):
//  - Enum values are STRINGS on purpose — Dexie-migration label-safe.
//  - Everything here is pure & synchronous except getInventory (Dexie read),
//    so flag derivation and domain filtering are unit-testable without IndexedDB.

import { canonicalizeIngredient, categorizeBottle } from './barMatch';
import { getBarInventoryRecords } from '../db';

// ── Shared semantic quantity enum (P3) ───────────────────────────────────────
export const QTY_LEVELS = ['EMPTY', 'LOW', 'MEDIUM', 'FULL'];
export const QTY_FILL = { EMPTY: 0, LOW: 1, MEDIUM: 2, FULL: 3 };
export const QTY_LABEL = {
  EMPTY: 'Run dry',
  LOW: 'Runnin\' low',
  MEDIUM: 'Half stocked',
  FULL: 'Full up',
};

// ── Crossover ingredients — work behind the bar AND in the kitchen ──────────
// Canonical (lowercase) names; matched after canonicalizeIngredient().
const BOTH_KEYWORDS = [
  'lemon', 'lime', 'orange', 'grapefruit', 'pineapple', 'strawberry',
  'strawberries', 'raspberry', 'raspberries', 'blackberry', 'blueberries',
  'cherry', 'cherries', 'apple', 'peach', 'mango', 'watermelon', 'banana',
  'mint', 'basil', 'rosemary', 'thyme', 'ginger', 'cinnamon', 'nutmeg',
  'vanilla', 'clove', 'cardamom',
  'sugar', 'brown sugar', 'honey', 'maple syrup', 'agave',
  'salt', 'egg', 'eggs', 'egg white', 'cream', 'heavy cream', 'milk',
  'coconut milk', 'coconut cream', 'butter', 'coffee', 'espresso', 'tea',
  'chocolate', 'cocoa', 'cucumber', 'celery', 'tomato', 'tomato juice',
  'jalapeno', 'jalapeño', 'cayenne', 'black pepper', 'olive', 'olives',
];

// ── Kitchen category keyword table ───────────────────────────────────────────
// First match wins. Whole-word matching against the canonicalized name.
const KITCHEN_CATEGORIES = [
  // Named legumes checked BEFORE 'produce' (which owns the bare 'beans' /
  // 'green beans' keywords for fresh/frozen veg) so "black beans" or
  // "chickpeas" get their own shelf-stable storage tip instead of being
  // swept into produce's fridge/crisper guidance. Deliberately no bare
  // 'beans' keyword here — that stays produce's for the ambiguous case.
  { category: 'legumes',   emoji: '🫘', keywords: ['black beans', 'kidney beans', 'pinto beans', 'navy beans', 'garbanzo beans', 'chickpeas', 'lentils', 'split peas'] },
  { category: 'protein',   emoji: '🥩', keywords: ['chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'ham', 'lamb', 'fish', 'salmon', 'tuna', 'shrimp', 'crab', 'tofu', 'tempeh', 'seitan', 'ground'] },
  { category: 'produce',   emoji: '🥬', keywords: ['spinach', 'lettuce', 'kale', 'arugula', 'broccoli', 'brussels sprouts', 'carrot', 'carrots', 'onion', 'onions', 'garlic', 'potato', 'potatoes', 'sweet potato', 'sweet potatoes', 'pepper', 'peppers', 'zucchini', 'squash', 'mushroom', 'mushrooms', 'avocado', 'corn', 'edamame', 'peas', 'beans', 'green beans', 'cabbage', 'cauliflower', 'cucumber', 'tomato', 'tomatoes', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berries', 'cilantro', 'parsley', 'basil', 'mint', 'ginger', 'scallion', 'scallions', 'celery', 'jalapeno', 'jalapeño'] },
  { category: 'dairy',     emoji: '🧀', keywords: ['milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'yogurt', 'butter', 'cream', 'sour cream', 'cream cheese', 'egg', 'eggs'] },
  { category: 'grains',    emoji: '🌾', keywords: ['rice', 'pasta', 'spaghetti', 'noodles', 'bread', 'tortilla', 'tortillas', 'flour', 'oats', 'oatmeal', 'quinoa', 'couscous', 'barley', 'cereal', 'breadcrumbs', 'panko'] },
  { category: 'spices',    emoji: '🧂', keywords: ['salt', 'black pepper', 'paprika', 'cumin', 'oregano', 'chili powder', 'cinnamon', 'nutmeg', 'curry', 'turmeric', 'cayenne', 'bay', 'thyme', 'rosemary', 'seasoning', 'italian seasoning', 'garlic powder', 'onion powder', 'red pepper flakes', 'clove', 'cardamom'] },
  { category: 'baking',    emoji: '🧁', keywords: ['sugar', 'brown sugar', 'baking soda', 'baking powder', 'yeast', 'vanilla', 'vanilla extract', 'cocoa', 'chocolate', 'chocolate chips', 'honey', 'maple syrup', 'agave', 'agave nectar', 'cornstarch', 'powdered sugar'] },
  { category: 'oils',      emoji: '🫒', keywords: ['olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'coconut oil', 'vinegar', 'balsamic', 'apple cider vinegar', 'rice vinegar', 'cooking spray'] },
  { category: 'condiments', emoji: '🥫', keywords: ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'soy sauce', 'tamari', 'hot sauce', 'sriracha', 'worcestershire', 'bbq sauce', 'salsa', 'ranch', 'tomato paste', 'tomato sauce', 'broth', 'stock', 'chicken broth', 'beef broth', 'vegetable broth', 'peanut butter', 'almond butter', 'jam', 'jelly', 'fish sauce', 'oyster sauce', 'hoisin', 'tahini', 'pesto', 'hummus', 'nutritional yeast'] },
];

// ── Permanent staples — default to In Stock unless explicitly marked EMPTY ──
// Expanded 2026-07-12 with a heavy vegetarian/vegan lean (legumes, plant
// proteins, dairy-free swaps) alongside the original core 24 — see
// STAPLE_GROUPS below for how these are shelved.
export const KITCHEN_STAPLES = [
  'salt', 'black pepper', 'olive oil', 'vegetable oil', 'flour', 'sugar',
  'butter', 'garlic', 'onions', 'rice', 'pasta', 'soy sauce', 'ketchup',
  'mustard', 'mayonnaise', 'baking soda', 'baking powder', 'vanilla extract',
  'honey', 'vinegar', 'chicken broth', 'hot sauce', 'brown sugar', 'eggs',
  // Grains & essentials
  'quinoa', 'oats', 'breadcrumbs', 'cornstarch',
  // Baking & sweets
  'maple syrup', 'agave nectar', 'cocoa powder', 'powdered sugar', 'yeast',
  // Sauces & broths
  'tamari', 'sriracha', 'bbq sauce', 'salsa', 'coconut milk', 'vegetable broth',
  // Plant-based proteins & legumes
  'black beans', 'kidney beans', 'chickpeas', 'lentils', 'peanut butter',
  'tahini', 'nutritional yeast',
];
const STAPLE_SET = new Set(KITCHEN_STAPLES.map(s => canonicalizeIngredient(s)));

// ── Staple sub-groups — "The Dry Pantry Vault" ───────────────────────────────
// Purely presentational grouping for the Pantry UI (staggered mini-shelves
// instead of one flat wall of identical tiles). Every KITCHEN_STAPLES item
// appears in exactly one group — see pantryDomain.test.js for the invariant
// that keeps this in sync if the staples list changes.
export const STAPLE_GROUPS = [
  {
    label: 'Essentials Base',
    items: ['salt', 'black pepper', 'garlic', 'onions', 'rice', 'pasta', 'flour', 'eggs', 'quinoa', 'oats', 'breadcrumbs', 'cornstarch'],
  },
  {
    label: 'Baking & Sweets',
    items: ['sugar', 'brown sugar', 'baking soda', 'baking powder', 'vanilla extract', 'honey', 'maple syrup', 'agave nectar', 'cocoa powder', 'powdered sugar', 'yeast'],
  },
  {
    label: 'Oils & Fats',
    items: ['olive oil', 'vegetable oil', 'butter'],
  },
  {
    label: 'Sauces & Broths',
    items: ['soy sauce', 'ketchup', 'mustard', 'mayonnaise', 'vinegar', 'chicken broth', 'hot sauce', 'tamari', 'sriracha', 'bbq sauce', 'salsa', 'coconut milk', 'vegetable broth'],
  },
  {
    label: 'Plant-Based Proteins',
    items: ['black beans', 'kidney beans', 'chickpeas', 'lentils', 'peanut butter', 'tahini', 'nutritional yeast'],
  },
];

// ── Storage tips per kitchen category (the "gourmet ledger" line) ────────────
export const STORAGE_TIPS = {
  protein:   'Fridge 1–2 days raw, or freeze flat in a zip bag for up to 3 months.',
  produce:   'Most produce keeps best in the crisper drawer — herbs like a glass of water.',
  dairy:     'Keep on an interior fridge shelf, not the door — the door runs warm.',
  grains:    'Airtight jar, cool and dark. Dry grains keep 6+ months.',
  spices:    'Away from the stove — heat and light fade flavor fast. Whole beats ground.',
  baking:    'Airtight and dry. Brown sugar stays soft with a slice of bread in the jar.',
  oils:      'Dark cupboard, tight cap. Oils hate light, heat, and air.',
  condiments: 'Refrigerate after opening; wipe the threads so the cap seals clean.',
  legumes:   'Dry: airtight jar, cool and dark, keeps a year+. Canned: pantry until opened, then fridge.',
};

// ── Freshness (perishables) ───────────────────────────────────────────────────
// fresh < 3 days · aging 3–6 days · old > 6 days
export function freshnessOf(addedAt) {
  if (!addedAt) return null;
  const t = new Date(addedAt).getTime();
  if (Number.isNaN(t)) return null;
  const days = (Date.now() - t) / 86400000;
  if (days < 3) return 'fresh';
  if (days <= 6) return 'aging';
  return 'old';
}

// ── Kitchen categorization ────────────────────────────────────────────────────
export function categorizeKitchen(name) {
  const canon = canonicalizeIngredient(name);
  if (!canon) return null;
  const words = new Set(canon.split(' '));
  for (const { category, emoji, keywords } of KITCHEN_CATEGORIES) {
    for (const kw of keywords) {
      if (kw.includes(' ')) {
        if (canon.includes(kw)) return { category, emoji };
      } else if (words.has(kw)) {
        return { category, emoji };
      }
    }
  }
  return null;
}

export function isStaple(name) {
  return STAPLE_SET.has(canonicalizeIngredient(name));
}

// ── Domain flags — can_drink / can_eat / can_both ────────────────────────────
function matchesBoth(canon) {
  const words = new Set(canon.split(' '));
  for (const kw of BOTH_KEYWORDS) {
    if (kw.includes(' ')) {
      if (canon.includes(kw)) return true;
    } else if (words.has(kw)) {
      return true;
    }
  }
  return false;
}

export function getDomainFlags(name) {
  const canon = canonicalizeIngredient(name);
  if (!canon) return { canDrink: false, canEat: false, canBoth: false };

  if (matchesBoth(canon)) return { canDrink: true, canEat: true, canBoth: true };

  const barCat = categorizeBottle(canon);       // non-null → the bar knows it
  const kitchenCat = categorizeKitchen(canon);  // non-null → the kitchen knows it

  if (barCat && kitchenCat) return { canDrink: true, canEat: true, canBoth: true };
  if (barCat) return { canDrink: true, canEat: false, canBoth: false };
  if (kitchenCat) return { canDrink: false, canEat: true, canBoth: false };
  // Unknown to both taxonomies: assume edible (users add foods far more often
  // than novel spirits; the bar catalog is closed, the kitchen is open-ended).
  return { canDrink: false, canEat: true, canBoth: false };
}

// ── Domain filtering — pure, unit-testable ────────────────────────────────────
export function filterRecordsByDomain(records, domain = 'all') {
  const list = Array.isArray(records) ? records : [];
  if (domain === 'all') return list;
  return list.filter((r) => {
    // A record with no usable ingredient string (malformed row, missing
    // field) is a different situation from getDomainFlags('') being called
    // directly with an explicitly blank name — that function's own contract
    // is to return all-false for junk input. Here, an inventory row that
    // exists but we can't identify still has to land SOMEWHERE, and per the
    // "open kitchen, closed bar" philosophy used everywhere else in this
    // file, an unidentifiable row defaults to the kitchen, never the bar.
    const hasName = typeof r?.ingredient === 'string' && r.ingredient.trim().length > 0;
    const f = hasName ? getDomainFlags(r.ingredient) : { canDrink: false, canEat: true, canBoth: false };
    return domain === 'bar'
      ? (f.canDrink || f.canBoth)
      : (f.canEat || f.canBoth);
  });
}

// ── Unified inventory accessor ────────────────────────────────────────────────
// domain: 'all' | 'bar' | 'kitchen'
export async function getInventory({ domain = 'all' } = {}) {
  const records = await getBarInventoryRecords();
  return filterRecordsByDomain(records, domain);
}
