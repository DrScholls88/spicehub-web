// barShopping.js — "What do I need?" shopping list generator for bar ingredients.
//
// Computes the delta between a user's bar shelf and the ingredients required
// by one or more drink recipes. Produces a deduplicated, categorized shopping
// list ready for display or export.
//
// Depends on: barMatch.js (canonicalizeIngredient, categorizeBottle, matchDrink)
// Consumed by: BarShelf.jsx, BarFridgeMode.jsx, BarLibrary.jsx

import {
  canonicalizeIngredient,
  categorizeBottle,
  matchDrink,
} from './barMatch.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Title-case a string: "lime juice" → "Lime Juice" */
function titleCase(str) {
  if (!str) return '';
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Assign priority bucket based on how many drinks need an ingredient. */
function priorityFromCount(count) {
  if (count >= 3) return 'high';
  if (count === 2) return 'medium';
  return 'low';
}

/** Sort priority values (high > medium > low). */
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap matchDrink with shopping-context semantics.
 * Renames `matched` → `available` for clarity in a "what do I need?" context.
 *
 * @param {object} drink          – drink object with `ingredients: string[]`
 * @param {string[]} inventoryNames – user's bar shelf ingredient names
 * @returns {{ available: string[], missing: string[], derivable: object[], score: number, tier: string }}
 */
export function getMissingForDrink(drink, inventoryNames) {
  const result = matchDrink(drink, inventoryNames);
  return {
    available: result.matched,
    missing: result.missing,
    derivable: result.derivable,
    score: result.score,
    tier: result.tier,
  };
}

/**
 * Build a deduplicated, categorized shopping list from multiple drinks.
 *
 * @param {object[]} drinks        – array of drink objects with `name` and `ingredients`
 * @param {string[]} inventoryNames – user's bar shelf ingredient names
 * @returns {{ items: object[], summary: object }}
 */
export function buildShoppingList(drinks, inventoryNames) {
  const inv = inventoryNames || [];
  const drinkList = Array.isArray(drinks) ? drinks : [];

  // Map canonical ingredient → aggregation record
  const itemMap = new Map();
  // Track which drinks become fully makeable if all missing items are purchased
  const drinkMatchResults = [];

  for (const drink of drinkList) {
    const result = matchDrink(drink, inv);
    drinkMatchResults.push({ drink, result });

    for (const rawMissing of result.missing) {
      const canon = canonicalizeIngredient(rawMissing);
      if (!canon) continue;

      if (itemMap.has(canon)) {
        const entry = itemMap.get(canon);
        const drinkName = drink.name || 'Untitled';
        if (!entry.neededBy.includes(drinkName)) {
          entry.neededBy.push(drinkName);
        }
      } else {
        const category = categorizeBottle(canon) || 'uncategorized';
        itemMap.set(canon, {
          ingredient: canon,
          displayName: titleCase(canon),
          category,
          neededBy: [drink.name || 'Untitled'],
        });
      }
    }
  }

  // Build the items array with count + priority
  const items = [];
  for (const entry of itemMap.values()) {
    items.push({
      ingredient: entry.ingredient,
      displayName: entry.displayName,
      category: entry.category,
      neededBy: entry.neededBy,
      count: entry.neededBy.length,
      priority: priorityFromCount(entry.neededBy.length),
    });
  }

  // Sort: priority desc (high first), then count desc, then alphabetical
  items.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    if (b.count !== a.count) return b.count - a.count;
    return a.ingredient.localeCompare(b.ingredient);
  });

  // Compute unlockable drinks: drinks where ALL missing ingredients are in
  // our shopping list (i.e., buying everything would make them makeable).
  // A drink with zero missing ingredients is already "ready", not "unlockable".
  const shoppingCanons = new Set(itemMap.keys());
  let unlockableDrinks = 0;
  for (const { result } of drinkMatchResults) {
    if (result.missing.length === 0) continue; // already ready
    const allCovered = result.missing.every(
      raw => shoppingCanons.has(canonicalizeIngredient(raw))
    );
    if (allCovered) unlockableDrinks++;
  }

  // Top categories: the 2 categories with the most missing items
  const catCounts = new Map();
  for (const item of items) {
    catCounts.set(item.category, (catCounts.get(item.category) || 0) + 1);
  }
  const topCategories = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => cat);

  return {
    items,
    summary: {
      totalMissing: items.length,
      totalDrinks: drinkList.length,
      unlockableDrinks,
      topCategories,
    },
  };
}

/**
 * Find drinks that are exactly 1 ingredient away from being makeable.
 * These represent the highest-value single purchases.
 *
 * @param {object[]} drinks        – array of drink objects
 * @param {string[]} inventoryNames – user's bar shelf ingredient names
 * @returns {{ drink: object, missingIngredient: string, category: string|null }[]}
 */
export function getOneAwayDrinks(drinks, inventoryNames) {
  const inv = inventoryNames || [];
  const drinkList = Array.isArray(drinks) ? drinks : [];
  const results = [];

  for (const drink of drinkList) {
    const match = matchDrink(drink, inv);
    if (match.tier === 'almost' && match.missing.length === 1) {
      const rawMissing = match.missing[0];
      const canon = canonicalizeIngredient(rawMissing);
      results.push({
        drink,
        missingIngredient: rawMissing,
        category: categorizeBottle(canon) || null,
      });
    }
  }

  // Sort by drink name
  results.sort((a, b) =>
    (a.drink.name || '').localeCompare(b.drink.name || '')
  );

  return results;
}

/**
 * Convert a shopping list (from buildShoppingList) to a shareable plain text string.
 *
 * @param {{ items: object[], summary: object }} shoppingList
 * @returns {string}
 */
export function exportShoppingListText(shoppingList) {
  const { items, summary } = shoppingList || {};
  if (!items || items.length === 0) {
    return '\u{1F6D2} Bar Shopping List\n━━━━━━━━━━━━━━━━━━\n\nNothing to buy — your bar is fully stocked!\n';
  }

  // Group items by category
  const grouped = new Map();
  for (const item of items) {
    const cat = item.category || 'uncategorized';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(item);
  }

  // Sort categories alphabetically, but push 'uncategorized' to the end
  const sortedCats = [...grouped.keys()].sort((a, b) => {
    if (a === 'uncategorized') return 1;
    if (b === 'uncategorized') return -1;
    return a.localeCompare(b);
  });

  const lines = [];
  lines.push('\u{1F6D2} Bar Shopping List');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');

  for (const cat of sortedCats) {
    const catItems = grouped.get(cat);
    // Sort items alphabetically within category
    catItems.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const catLabel = titleCase(cat);
    lines.push(`${catLabel} (${catItems.length})`);
    for (const item of catItems) {
      const neededStr = item.neededBy.join(', ');
      lines.push(`  ☐ ${item.displayName} — needed for ${neededStr}`);
    }
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━');
  const unlockStr =
    summary && summary.unlockableDrinks
      ? ` · unlocks ${summary.unlockableDrinks} drink${summary.unlockableDrinks === 1 ? '' : 's'}`
      : '';
  lines.push(`${items.length} item${items.length === 1 ? '' : 's'}${unlockStr}`);

  return lines.join('\n');
}

export default {
  getMissingForDrink,
  buildShoppingList,
  getOneAwayDrinks,
  exportShoppingListText,
};
