// ─────────────────────────────────────────────────────────────────────────────
// ZERO-JUNK CONTRACT — single source of truth.
//
// Three consumers, one list:
//   1. Acquisition-time cleaning  (cleanSocialCaption → stripJunkLines)
//   2. Post-structuring enforcement (enforceDeterministicRules → isJunkLine)
//   3. The golden corpus assertions (tests/import/helpers.js imports JUNK_PATTERNS)
//
// Dependency-free on purpose: imported by client code, serverless functions,
// and tests alike. Never add imports here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that must NEVER appear in a final recipe's title, ingredients,
 * directions, or notes. Anchored to avoid false positives ("bake @ 350",
 * "1/2 cup" etc.). This is the corpus assertion list — the superset.
 */
export const JUNK_PATTERNS = [
  { name: 'hashtag',            re: /#[a-z][a-z0-9_]{2,}/i },
  { name: 'mention',            re: /@[a-z][a-z0-9_.]{2,}/i },
  { name: 'link in bio',        re: /link in (my )?bio/i },
  { name: 'follow bait',        re: /follow (me|us|@|for more)/i },
  { name: 'save bait',          re: /save this (post|recipe|reel|one)/i },
  { name: 'promo code',         re: /use (my )?code\b/i },
  { name: 'dm bait',            re: /\bdm (me|you)\b/i },
  { name: 'comment bait',       re: /comment ["'“”]?\w+["'“”]? (below|to get)/i },
  { name: 'notification bait',  re: /turn on (post )?notifications/i },
  { name: 'sponsor tag',        re: /\b(sponsored|#ad|paid partnership)\b/i },
  { name: 'ebook promo',        re: /\b(my )?(ebook|e-book|meal plan) (is )?(out|available|link)/i },
  { name: 'view counts',        re: /\b\d[\d,.]* (views|likes|followers)\b/i },
];

/**
 * STRONG line-level junk markers: any line containing one of these is social
 * chrome, not recipe content — UNLESS the line also carries a recipe signal
 * (quantity+unit or a cooking action), in which case we keep it and let the
 * model / enforcer sort it out. Subset of JUNK_PATTERNS chosen for zero
 * false-positive risk on real recipe prose.
 */
export const STRONG_LINE_JUNK = [
  /link in (my )?bio/i,
  /\b(use|discount|promo) (my )?code\b/i,
  /\bpaid partnership\b/i,
  /\b(this post is )?sponsored\b/i,
  /#ad\b/i,
  /\bdm (me|you)\b/i,
  /\bgiveaway\b/i,
  /turn on (post )?notifications/i,
  /comment ["'“”]?\w+["'“”]? (below|to get|and i)/i,
  /\b(my )?(ebook|e-book|meal plan) (is )?(out|available)\b/i,
  /follow (me|us|for more)/i,
  /save this (post|recipe|reel|one)/i,
  /\baffiliate (link|code)\b/i,
  /\bshop my\b/i,
  /full recipe (on|at|in) (the |my )?(blog|bio|website|link)/i,
];

/**
 * Bait phrases that mean "the recipe is NOT in this caption" — used by
 * isCaptionWeak as an override so a stray food word can't rescue a bait post.
 */
export const BAIT_ONLY_RE = /\b(full recipe (on|at|in) (the |my )?(blog|bio|website|link)|link in (my )?bio|recipe in (my )?bio)\b/i;

// Recipe signal: a quantity with a unit-ish word, compact metric ("250g"),
// or a unicode fraction. One per line is enough to protect the line.
const QTY_RE = /(\b\d+(?:[.,/]\d+)?\s*(?:g|kg|ml|l|cl|oz|lb|lbs|cup|cups|tbsp|tsp|tablespoons?|teaspoons?|cans?|cloves?|slices?|sticks?|heads?|bunch(?:es)?|pinch(?:es)?|dash(?:es)?|splash)\b)|[½⅓⅔¼¾⅛]|(\b\d+(?:g|kg|ml|l)\b)/i;
const ACTION_RE = /\b(preheat|bake|roast|simmer|boil|saute|sauté|sear|fry|grill|broil|whisk|stir|mix|combine|fold|knead|marinate|shake|strain|muddle|blend|chop|dice|mince|drizzle|garnish|toss|season|serve)\b/i;

/** True when a line contains a real recipe signal worth preserving. */
export function lineHasRecipeSignal(line = '') {
  return QTY_RE.test(line) || ACTION_RE.test(line);
}

/** True when a line is strong social junk with no protecting recipe signal. */
export function isJunkLine(line = '') {
  const s = String(line || '');
  if (!s.trim()) return false;
  if (!STRONG_LINE_JUNK.some((re) => re.test(s))) return false;
  return !lineHasRecipeSignal(s);
}

/** Remove whole junk lines from a multi-line caption/text block. */
export function stripJunkLines(text = '') {
  if (!text) return '';
  return String(text)
    .split('\n')
    .filter((line) => !isJunkLine(line))
    .join('\n');
}

/** First junk match across the assertion superset, or null. */
export function findJunk(text = '') {
  if (!text) return null;
  for (const p of JUNK_PATTERNS) {
    const m = p.re.exec(String(text));
    if (m) return { pattern: p.name, match: m[0] };
  }
  return null;
}

/** Count lines that look like quantified ingredients (weakness heuristics). */
export function countQuantityLines(text = '') {
  if (!text) return 0;
  let n = 0;
  for (const line of String(text).split('\n')) {
    if (QTY_RE.test(line)) n++;
  }
  return n;
}
