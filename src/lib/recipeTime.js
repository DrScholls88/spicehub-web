// ── Recipe time parsing / formatting ────────────────────────────────────────
// Extracted from MealLibrary.jsx so MealDetail (and anything else that wants to
// surface a recipe's time) reads the exact same numbers the Library's
// "Quick Weeknight" category and Filters(n) → Time facet are built on, rather
// than growing a second, subtly-different copy of the parser.

/** Total minutes at or under which a recipe counts as a "Quick Weeknight" meal. */
export const QUICK_WEEKNIGHT_MAX_MIN = 30;

/**
 * Parse a freeform time string ("15 min", "1 hr 30 min", "PT30M", "45") to minutes.
 * Returns null when nothing parseable is present — callers should treat null as
 * "unknown", never as zero.
 */
export function parseTimeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  // ISO 8601 duration, e.g. PT1H30M
  const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (iso) {
    const h = parseInt(iso[1] || '0', 10);
    const m = parseInt(iso[2] || '0', 10);
    return h * 60 + m;
  }
  let total = 0;
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/i);
  if (hrMatch) total += parseFloat(hrMatch[1]) * 60;
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/i);
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);
  // Bare number — assume minutes
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(parseFloat(bare[1]));
  return null;
}

/**
 * A meal's total time in minutes: prefers an explicit totalTime, otherwise
 * prep + cook. Returns null when no time data exists — meals with no time
 * data don't match time filters, since we'd rather under-promise than
 * mislabel an unknown as quick.
 */
export function getTotalMinutes(meal) {
  if (!meal) return null;
  const total = parseTimeToMinutes(meal.totalTime);
  if (total != null) return total;
  const prep = parseTimeToMinutes(meal.prepTime) || 0;
  const cook = parseTimeToMinutes(meal.cookTime) || 0;
  if (prep || cook) return prep + cook;
  return null;
}

/**
 * Human-readable duration for display chips: 25 → "25 min", 90 → "1 hr 30 min",
 * 120 → "2 hr". Returns '' for null/0 so callers can render conditionally.
 */
export function formatMinutes(mins) {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}
