/**
 * SpiceHub — Blog Discovery Client
 *
 * Replaces the Reddit-based discovery feed with a multi-source recipe blog
 * aggregator. Calls /api/discover (server-side RSS aggregator) and provides
 * client-side filtering by source, category, and search text.
 *
 * Architecture: the server fetches/parses RSS feeds and returns unified JSON.
 * This module handles caching, filtering, and the source/category registry
 * that drives the Discovery UI's filter chips.
 */

// ─── Source & Category Definitions ───────────────────────────────────────────

/**
 * Categories for the UI filter chips. Each maps to keywords found in
 * RSS <category> tags from recipe blogs.
 */
export const DISCOVER_CATEGORIES = [
  { id: 'all',        label: 'All',              emoji: '✨' },
  { id: 'weeknight',  label: 'Quick & Easy',     emoji: '⚡', keywords: ['quick', 'easy', 'weeknight', '30 minute', 'under 30', 'simple', 'one pot', 'sheet pan', 'one-pot', 'fast'] },
  { id: 'comfort',    label: 'Comfort Food',     emoji: '🍲', keywords: ['comfort', 'soup', 'stew', 'casserole', 'pasta', 'mac and cheese', 'chili', 'slow cooker', 'crockpot'] },
  { id: 'healthy',    label: 'Healthy',          emoji: '🥗', keywords: ['healthy', 'salad', 'light', 'low calorie', 'nutritious', 'whole30', 'clean eating', 'grain bowl'] },
  { id: 'vegetarian', label: 'Vegetarian',       emoji: '🥕', keywords: ['vegetarian', 'veggie', 'meatless', 'plant-based', 'plant based'] },
  { id: 'vegan',      label: 'Vegan',            emoji: '🌱', keywords: ['vegan', 'dairy free', 'dairy-free', 'plant-based'] },
  { id: 'mealprep',   label: 'Meal Prep',        emoji: '📦', keywords: ['meal prep', 'batch cook', 'freezer', 'make ahead', 'make-ahead', 'leftover'] },
  { id: 'baking',     label: 'Baking',           emoji: '🧁', keywords: ['baking', 'cake', 'cookie', 'bread', 'muffin', 'pie', 'pastry', 'brownie', 'dessert', 'sweet'] },
  { id: 'seasonal',   label: 'Seasonal',         emoji: '🌻', keywords: getSeasonalKeywords() },
];

/** Return seasonal keywords based on current month (Northern Hemisphere). */
function getSeasonalKeywords() {
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 2 && month <= 4) return ['spring', 'asparagus', 'pea', 'strawberry', 'rhubarb', 'artichoke', 'radish'];
  if (month >= 5 && month <= 7) return ['summer', 'grill', 'grilled', 'bbq', 'corn', 'tomato', 'peach', 'watermelon', 'zucchini', 'berry', 'popsicle', 'no-bake', 'refreshing', 'cold'];
  if (month >= 8 && month <= 10) return ['fall', 'autumn', 'pumpkin', 'apple', 'squash', 'cider', 'harvest', 'thanksgiving', 'sweet potato', 'cranberry'];
  return ['winter', 'holiday', 'christmas', 'cozy', 'warm', 'hearty', 'roast', 'braise', 'cinnamon', 'ginger', 'hot chocolate'];
}

// ─── Client-side cache ───────────────────────────────────────────────────────

let _cache = null; // { posts, sources, fetchedAt, expiresAt }
const CACHE_DURATION_MS = 25 * 60 * 1000; // 25min (server caches 30min)

function getCached() {
  if (_cache && Date.now() < _cache.expiresAt) return _cache;
  return null;
}

function setCache(data) {
  _cache = {
    ...data,
    expiresAt: Date.now() + CACHE_DURATION_MS,
  };
}

// ─── Fetch & Filter ──────────────────────────────────────────────────────────

/**
 * Fetch recipe posts from the discovery API.
 * Returns { posts, sources, errors? }.
 *
 * @param {{ force?: boolean, sources?: string[] }} options
 */
export async function fetchDiscoveryFeed({ force = false, sources } = {}) {
  if (!force) {
    const cached = getCached();
    if (cached) return cached;
  }

  const params = new URLSearchParams();
  if (sources?.length) params.set('sources', sources.join(','));
  params.set('limit', '15');

  const url = `/api/discover?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Accept: 'application/json' },
    ...(force ? { cache: 'no-cache' } : {}),
  });

  if (!resp.ok) {
    throw new Error(`Discovery API returned ${resp.status}`);
  }

  const data = await resp.json();
  setCache(data);
  return data;
}

/**
 * Filter posts by category, source, and search text.
 * All filtering is client-side against the cached feed.
 *
 * @param {Array} posts - From fetchDiscoveryFeed
 * @param {{ categoryId?: string, sourceKey?: string, search?: string }} filters
 * @returns {Array} Filtered posts
 */
export function filterPosts(posts, { categoryId, sourceKey, search } = {}) {
  let filtered = posts;

  // Source filter
  if (sourceKey && sourceKey !== 'all') {
    filtered = filtered.filter(p => p.source === sourceKey);
  }

  // Category filter — match against post categories + title
  if (categoryId && categoryId !== 'all') {
    const cat = DISCOVER_CATEGORIES.find(c => c.id === categoryId);
    if (cat?.keywords) {
      const kws = cat.keywords.map(k => k.toLowerCase());
      filtered = filtered.filter(p => {
        const haystack = [
          p.title,
          ...(p.categories || []),
          p.snippet || '',
        ].join(' ').toLowerCase();
        return kws.some(kw => haystack.includes(kw));
      });
    }
  }

  // Search text filter
  if (search && search.trim().length >= 2) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(p => {
      const haystack = [p.title, p.sourceName, ...(p.categories || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  return filtered;
}

/**
 * Clear the client cache (e.g. on manual refresh).
 */
export function clearDiscoveryCache() {
  _cache = null;
}
