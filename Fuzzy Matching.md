Fuzzy Matching for Ingredients in SpiceHub
Senior Product Developer Analysis & Implementation Proposal
Why Fuzzy Matching Matters Here
Your current ingredient system is already strong:

INGREDIENT_ALIASES + resolveIngredientAlias() for exact canonicalization (e.g., “green onion” → “scallion”)
categorizeIngredient() keyword fallback (ordered regex priority)
ingredientItemToString() + flattenIngredientGroups() for display
Post-import processing via the new deterministic rules

Gaps fuzzy matching closes:

LLM variations from Gemini/Grok imports (“all purpose flour”, “AP flour”, “all-purpose flour”)
Typos / OCR from image imports or user edits in AddEditMeal.jsx
Grocery list deduplication & aggregation across recipes
FridgeMode / BarFridgeMode inventory matching (“do I have this?”)
Better needsReview signals during import review
Future features: smart search in MealLibrary, “recipes with similar ingredients”, substitution suggestions

Priority Use Cases (ranked by impact):

Import normalization (highest ROI) — clean ingredient names right after LLM + deterministic post-processor.
GroceryList merging — group “2 cups flour” + “200g all-purpose flour” intelligently.
User editing flows — suggest canonical form when user types in AddEditMeal or fridge inventory.
Categorization robustness — fuzzy boost for categorizeIngredient.

Recommended Architecture (Keep It Simple & Offline-First)
Tiered Approach (progressive enhancement):

Exact alias first (existing resolveIngredientAlias)
Lightweight fuzzy on top (new — zero new dependencies)
Optional future: fuse.js indexed search when you have a larger master ingredient list (for FridgeMode search, etc.)

Since fast-levenshtein is only a dev dep, we’ll use a tiny pure-JS implementation (~25 lines) for now. It’s fast enough for typical recipe sizes (5–20 ingredients).
Proposed Implementation
Add to recipeSchema.js (after the existing alias section):
JavaScript// -----------------------------------------------------------------------------
// 13. FUZZY INGREDIENT MATCHING (NEW — lightweight, zero-dep)
// -----------------------------------------------------------------------------
// Goal: Normalize messy imported names to canonical forms with confidence.
// Used in post-processing, grocery dedup, and edit suggestions.

const LEVENSHTEIN_MAX = 3; // max edit distance to consider a match

/** Simple normalized Levenshtein distance (0 = identical). */
function levenshtein(a = '', b = '') {
  a = String(a).toLowerCase().trim();
  b = String(b).toLowerCase().trim();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

/** Token-based similarity (good for word-order differences like "flour all purpose"). */
function tokenSimilarity(a = '', b = '') {
  const ta = String(a).toLowerCase().split(/\s+/).filter(Boolean);
  const tb = String(b).toLowerCase().split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return 0;

  const setA = new Set(ta);
  const setB = new Set(tb);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size; // Jaccard
}

/**
 * Normalize a raw ingredient name (strip quantity/unit/prep for matching).
 * Reuses existing patterns from recipeParser.
 */
export function normalizeForMatching(name = '') {
  let s = String(name).toLowerCase().trim();
  // Remove leading quantity + unit (reuse your NUM_UNIT_RE logic if exposed)
  s = s.replace(/^[\d½¼¾⅓⅔⅛⅜⅝⅞./\s]+(cups?|tbsp|tsp|oz|lb|g|kg|ml|cl|dash|pinch|bunch|clove|can|jar|package|stick|slice|head|stalk)?\s*/i, '');
  // Remove common prep suffixes
  s = s.replace(/\s*[,;]?\s*(chopped|diced|minced|sliced|grated|shredded|peeled|fresh|dried|frozen|to taste|optional|for garnish).*$/i, '');
  s = s.replace(/[\(\[].*?[\)\]]/g, ''); // remove parentheticals
  return s.trim();
}

/**
 * Fuzzy resolve ingredient name → { canonical, aisle, score, method }
 * method: 'exact' | 'alias' | 'fuzzy-levenshtein' | 'fuzzy-token'
 */
export function fuzzyResolveIngredient(rawName = '', threshold = 0.82) {
  const original = String(rawName).trim();
  if (!original) return null;

  const normalized = normalizeForMatching(original);
  if (!normalized) return null;

  // 1. Exact alias hit (fast path)
  const exact = resolveIngredientAlias(normalized) || resolveIngredientAlias(original);
  if (exact) {
    return { ...exact, score: 1.0, method: 'exact' };
  }

  // 2. Fuzzy match against alias keys
  let bestMatch = null;
  let bestScore = 0;
  let bestMethod = '';

  for (const [aliasKey, aliasValue] of Object.entries(INGREDIENT_ALIASES)) {
    const aliasNorm = normalizeForMatching(aliasKey);

    // Levenshtein distance
    const dist = levenshtein(normalized, aliasNorm);
    const maxLen = Math.max(normalized.length, aliasNorm.length);
    const levScore = maxLen > 0 ? 1 - (dist / maxLen) : 0;

    // Token similarity (handles word reordering)
    const tokScore = tokenSimilarity(normalized, aliasNorm);

    const score = Math.max(levScore, tokScore);

    if (score > bestScore && score >= threshold && dist <= LEVENSHTEIN_MAX) {
      bestScore = score;
      bestMatch = aliasValue;
      bestMethod = levScore > tokScore ? 'fuzzy-levenshtein' : 'fuzzy-token';
    }
  }

  if (bestMatch) {
    return {
      ...bestMatch,
      score: Math.round(bestScore * 100) / 100,
      method: bestMethod,
    };
  }

  // 3. Fallback: return normalized form with no canonical match
  return {
    canonical: normalized,
    aisle: 'unknown',
    score: 0,
    method: 'none',
  };
}
Integration Points (High Impact, Low Effort)
1. In the new deterministic post-processor (enforceDeterministicRules or right after LLM parsing)
After flattening ingredients, run:
JavaScriptingredients = ingredients.map(line => {
  const match = fuzzyResolveIngredient(line);
  if (match && match.score > 0.85 && match.method !== 'none') {
    // Replace with canonical form while preserving quantity/prep
    const qtyPrep = line.replace(normalizeForMatching(line), '').trim();
    return qtyPrep ? `${qtyPrep} ${match.canonical}`.trim() : match.canonical;
  }
  return line;
});
This directly improves import quality and reduces needsReview triggers.
2. GroceryList aggregation (GroceryList.jsx)
When merging items from multiple meals, group by fuzzyResolveIngredient(item).canonical.
3. AddEditMeal / Fridge inventory suggestions
On input change, show top fuzzy matches as autocomplete chips.
4. Enhance categorizeIngredient
JavaScriptexport function categorizeIngredient(name = '') {
  const fuzzy = fuzzyResolveIngredient(name);
  if (fuzzy && fuzzy.aisle && fuzzy.aisle !== 'unknown') {
    // map aisle to category...
  }
  // fall back to existing keyword logic
}
Trade-offs & Recommendations

Approach,Bundle Impact,Accuracy,Complexity,Recommendation
Expand INGREDIENT_ALIASES,None,High (exact),Low,Do this first — quick wins
Lightweight fuzzy (above),~1-2 KB,Good,Low,Implement now
Fuse.js (indexed),~6-8 KB gz,Excellent,Medium,Add later for FridgeMode search / large lists
Server-side (Python rapidfuzz),None (client),Best,Higher,Only if you need very high precision on imports

ApproachBundle ImpactAccuracyComplexityRecommendationExpand INGREDIENT_ALIASESNoneHigh (exact)LowDo this first — quick winsLightweight fuzzy (above)~1-2 KBGoodLowImplement nowFuse.js (indexed)~6-8 KB gzExcellentMediumAdd later for FridgeMode search / large listsServer-side (Python rapidfuzz)None (client)BestHigherOnly if you need very high precision on imports
Start Here:

Add the fuzzy functions to recipeSchema.js.
Wire into the post-processor (biggest quality lift for imports).
Expand INGREDIENT_ALIASES with common LLM variations you see in practice.
Expose fuzzyResolveIngredient in the import review UI (show “Normalized to: scallion (92% match)”).

This pairs beautifully with the deterministic post-processing we built earlier — LLM proposes messy text → deterministic rules clean structure → fuzzy normalizes names.