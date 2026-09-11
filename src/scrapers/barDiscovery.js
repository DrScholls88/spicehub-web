/**
 * SpiceHub — Bar Discovery Client
 *
 * Sibling to blogDiscovery.js: same server aggregator (/api/discover), same
 * caching/filtering shape, but points at ?kind=drinks so the edge function
 * fetches the cocktail/spirits blog registry (SOURCES_DRINKS) instead of the
 * recipe blog one. Kept as a separate module (rather than a generic
 * blogDiscovery({ kind })) so the Bar and Meal discovery surfaces can evolve
 * independently -- e.g. drink-specific categories below -- without either
 * one risking a regression in the other.
 */

// ─── Category Definitions ────────────────────────────────────────────────────
// Same idea as DISCOVER_CATEGORIES in blogDiscovery.js: loose keyword sets
// matched against post title + RSS <category> tags + snippet.

export const DISCOVER_CATEGORIES = [
  { id: 'all',       label: 'All',          emoji: '✨' },
  { id: 'whiskey',   label: 'Whiskey',      emoji: '🥃', keywords: ['whiskey', 'whisky', 'bourbon', 'rye', 'scotch', 'old fashioned', 'manhattan'] },
  { id: 'gin',       label: 'Gin',          emoji: '🌿', keywords: ['gin', 'martini', 'negroni', 'gimlet', 'tom collins', 'french 75'] },
  { id: 'agave',     label: 'Tequila & Mezcal', emoji: '🌵', keywords: ['tequila', 'mezcal', 'margarita', 'paloma', 'agave'] },
  { id: 'rum',       label: 'Rum & Tiki',   emoji: '🏝️', keywords: ['rum', 'tiki', 'daiquiri', 'mai tai', 'painkiller', 'zombie'] },
  { id: 'vodka',     label: 'Vodka',        emoji: '❄️', keywords: ['vodka', 'moscow mule', 'cosmopolitan', 'espresso martini'] },
  { id: 'brunch',    label: 'Brunch',       emoji: '🥂', keywords: ['brunch', 'mimosa', 'bloody mary', 'bellini', 'sangria'] },
  { id: 'batch',     label: 'Batch & Punch', emoji: '🍶', keywords: ['batch', 'pitcher', 'punch', 'party', 'crowd'] },
  { id: 'mocktail',  label: 'Zero-Proof',   emoji: '🍋', keywords: ['mocktail', 'zero-proof', 'zero proof', 'non-alcoholic', 'nonalcoholic', 'alcohol-free'] },
  { id: 'classics',  label: 'Classics',     emoji: '🏛️', keywords: ['classic', 'vintage', 'prohibition', 'speakeasy', 'iba'] },
];

// ─── Client-side cache ───────────────────────────────────────────────────────
// Separate from blogDiscovery's cache object entirely -- toggling the Meal
// Discovery filter must never evict a warm Bar Discovery fetch and vice versa.

const _cacheByFilter = { strict: null, relaxed: null };
const CACHE_DURATION_MS = 25 * 60 * 1000; // 25min (server caches 30min)

function getCached(filterMode = 'strict') {
  const c = _cacheByFilter[filterMode];
  if (c && Date.now() < c.expiresAt) return c;
  return null;
}

function setCache(data, filterMode = 'strict') {
  _cacheByFilter[filterMode] = {
    ...data,
    expiresAt: Date.now() + CACHE_DURATION_MS,
  };
}

// ─── Fetch & Filter ──────────────────────────────────────────────────────────

/**
 * Fetch cocktail posts from the discovery API.
 * Returns { posts, sources, errors? }.
 *
 * @param {{ force?: boolean, sources?: string[], filter?: 'strict'|'relaxed' }} options
 */
export async function fetchBarDiscoveryFeed({ force = false, sources, filter = 'strict' } = {}) {
  const filterMode = filter === 'relaxed' ? 'relaxed' : 'strict';

  if (!force) {
    const cached = getCached(filterMode);
    if (cached) return cached;
  }

  const params = new URLSearchParams();
  params.set('kind', 'drinks');
  if (sources?.length) params.set('sources', sources.join(','));
  params.set('limit', '15');
  params.set('filter', filterMode);

  const url = `/api/discover?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Accept: 'application/json' },
    ...(force ? { cache: 'no-cache' } : {}),
  });

  if (!resp.ok) {
    throw new Error(`Discovery API returned ${resp.status}`);
  }

  const data = await resp.json();
  setCache(data, filterMode);
  return data;
}

/**
 * Filter posts by category, source, and search text.
 * All filtering is client-side against the cached feed. Identical logic to
 * blogDiscovery.filterPosts -- duplicated rather than imported so this
 * module has no dependency on the meal-side file at all.
 *
 * @param {Array} posts - From fetchBarDiscoveryFeed
 * @param {{ categoryId?: string, sourceKey?: string, search?: string }} filters
 * @returns {Array} Filtered posts
 */
export function filterBarPosts(posts, { categoryId, sourceKey, search } = {}) {
  let filtered = posts;

  if (sourceKey && sourceKey !== 'all') {
    filtered = filtered.filter(p => p.source === sourceKey);
  }

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
export function clearBarDiscoveryCache() {
  _cacheByFilter.strict = null;
  _cacheByFilter.relaxed = null;
}
