// landingHelpers.js — pure helpers, constants, and animation variants shared
// by LandingPage.jsx (and any future landing-page widgets). Extracted from
// LandingPage.jsx as part of the monolith decomposition; no behavioral
// changes vs. the original inline definitions.

// ── Date helpers ──────────────────────────────────────────────────────────────
export function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Small, tolerant duration parser for the ticker's "Tonight: N min prep time"
// line — doesn't need to be exhaustive (weekPlanner.js's parseTotalMinutes
// already handles the authoritative case), just good enough for a status line.
export function mealTickerMinutes(meal) {
  const raw = meal?.totalTime || meal?.prepTime || meal?.cookTime;
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/);
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/);
  let total = 0;
  if (hrMatch) total += parseFloat(hrMatch[1]) * 60;
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  return bare ? Math.round(parseFloat(bare[1])) : null;
}

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Animation variants ────────────────────────────────────────────────────────
export const dayCardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.94 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 320, damping: 26 },
  },
};
export const diceVariants = {
  rest:  { rotate: 0 },
  hover: { rotate: [0, -22, 20, -10, 6, 0], transition: { duration: 0.55, ease: 'easeInOut' } },
};

export const TILE_COLORS = {
  planWeek: '#e65100',
  spinWeek: '#c62828',
  myMeals: '#2e7d32',
  bar: '#7b1fa2',
  grocery: '#1565c0',
  pantry: '#8a6d3b',
  fridge: '#00838f',
  stats: '#e65100',
};

// Primary tiles span full width with distinct treatment
export const PRIMARY_TILES = new Set(['planWeek', 'fridge']);

// ── Seasonal helpers ──────────────────────────────────────────────────────────
export function getSeasonInfo() {
  const m = new Date().getMonth(); // 0-indexed
  if (m >= 2 && m <= 4) return {
    name: 'Spring', emoji: '🌸',
    headline: 'Perfect for Spring',
    keywords: ['spring', 'pea', 'asparagus', 'radish', 'artichoke', 'strawberry', 'lemon', 'salad', 'light', 'fresh', 'herb'],
  };
  if (m >= 5 && m <= 7) return {
    name: 'Summer', emoji: '☀️',
    headline: 'Summer Favorites',
    keywords: ['summer', 'grill', 'grilled', 'bbq', 'barbecue', 'corn', 'tomato', 'zucchini', 'peach', 'watermelon', 'taco', 'burger', 'fresh', 'light', 'salad'],
  };
  if (m >= 8 && m <= 10) return {
    name: 'Fall', emoji: '🍂',
    headline: 'Cozy Fall Recipes',
    keywords: ['fall', 'pumpkin', 'squash', 'apple', 'sweet potato', 'butternut', 'soup', 'stew', 'roast', 'harvest', 'cider', 'maple'],
  };
  return {
    name: 'Winter', emoji: '❄️',
    headline: 'Warm Winter Comfort',
    keywords: ['winter', 'soup', 'stew', 'chili', 'braise', 'roast', 'hearty', 'comfort', 'pot roast', 'casserole', 'curry', 'warm', 'slow cooker'],
  };
}

export function getSeasonalMeals(meals, season) {
  const kws = season.keywords;
  const scored = meals.map(m => {
    const haystack = [
      m.name || '',
      m.category || '',
      m.cuisine || '',
      m.dishType || '',
      ...(m.tags || []),
      ...(m.ingredients || []).slice(0, 8),
    ].join(' ').toLowerCase();
    const hits = kws.filter(k => haystack.includes(k)).length;
    return { meal: m, hits };
  })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 5).map(x => x.meal);
}

// ── Time-of-day helper ────────────────────────────────────────────────────────
// Returns a CSS class hook so callers can theme by daypart (e.g. warmer
// gradients in the morning, dimmer surfaces at night) without duplicating the
// hour-bucketing logic at each call site.
export function getTimeOfDayClass() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'sh-morning';
  if (h >= 12 && h < 17) return 'sh-afternoon';
  if (h >= 17 && h < 21) return 'sh-evening';
  return 'sh-night';
}

// ── Haptics ────────────────────────────────────────────────────────────────────
// Best-effort tactile feedback wrapper. navigator.vibrate is unsupported on
// iOS Safari/PWA and can throw in some embedded webviews — always no-op safe.
export function haptic(ms = 15) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    /* best-effort — vibration is a nicety, never worth surfacing an error */
  }
}
