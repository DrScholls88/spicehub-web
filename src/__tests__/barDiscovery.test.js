import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  fetchBarDiscoveryFeed,
  filterBarPosts,
  clearBarDiscoveryCache,
  DISCOVER_CATEGORIES,
} from '../scrapers/barDiscovery.js';

// Coverage for the Bar Discovery client module (sibling to blogDiscovery.js,
// added alongside DiscoverDrinks.jsx / api/discover.js's ?kind=drinks path).
// Focuses on the two things that are easy to get subtly wrong when forking
// a working module: (1) the fetch call must actually ask the API for the
// drinks source registry, not silently fall back to the meal one, and
// (2) category/source/search filtering must behave identically to the
// meal-side implementation it was copied from.

const resOk = (body) => ({ ok: true, status: 200, json: async () => body });
const resErr = (status) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => clearBarDiscoveryCache());
afterEach(() => { vi.unstubAllGlobals(); clearBarDiscoveryCache(); });

describe('fetchBarDiscoveryFeed', () => {
  it('requests kind=drinks from /api/discover', async () => {
    const fetchSpy = vi.fn(async () => resOk({ posts: [], sources: {} }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchBarDiscoveryFeed({});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('/api/discover?');
    expect(url).toContain('kind=drinks');
  });

  it('caches by filter mode independently of blogDiscovery (no cross-cache bleed)', async () => {
    const fetchSpy = vi.fn(async () => resOk({ posts: [{ title: 'Negroni', link: 'a' }], sources: {} }));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await fetchBarDiscoveryFeed({ filter: 'strict' });
    const second = await fetchBarDiscoveryFeed({ filter: 'strict' });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call served from cache
    expect(second.posts).toEqual(first.posts);

    await fetchBarDiscoveryFeed({ filter: 'relaxed' });
    expect(fetchSpy).toHaveBeenCalledTimes(2); // different filter mode, separate cache slot
  });

  it('force:true bypasses the cache', async () => {
    const fetchSpy = vi.fn(async () => resOk({ posts: [], sources: {} }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchBarDiscoveryFeed({});
    await fetchBarDiscoveryFeed({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when the API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resErr(500)));
    await expect(fetchBarDiscoveryFeed({})).rejects.toThrow('500');
  });
});

describe('filterBarPosts', () => {
  const posts = [
    { title: 'The Perfect Negroni', link: 'https://a.example/negroni', source: 'punchdrink', sourceName: 'PUNCH', categories: ['Gin', 'Classics'], snippet: 'A bitter, boozy classic.' },
    { title: '5 Brunch Mimosas to Try', link: 'https://b.example/mimosas', source: 'vinepair', sourceName: 'VinePair', categories: ['Brunch'], snippet: 'Sparkling wine cocktails for the morning.' },
    { title: 'Best Zero-Proof Spritz', link: 'https://c.example/mocktail', source: 'imbibemagazine', sourceName: 'Imbibe Magazine', categories: ['Mocktail'], snippet: 'A non-alcoholic take on the classic spritz.' },
  ];

  it('filters by source key', () => {
    const out = filterBarPosts(posts, { sourceKey: 'vinepair' });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain('Mimosas');
  });

  it('"all" source key is a no-op', () => {
    expect(filterBarPosts(posts, { sourceKey: 'all' })).toHaveLength(3);
  });

  it('filters by category keywords (gin)', () => {
    const out = filterBarPosts(posts, { categoryId: 'gin' });
    expect(out.map(p => p.link)).toEqual(['https://a.example/negroni']);
  });

  it('filters by category keywords (mocktail)', () => {
    const out = filterBarPosts(posts, { categoryId: 'mocktail' });
    expect(out.map(p => p.link)).toEqual(['https://c.example/mocktail']);
  });

  it('filters by search text against title/source/categories', () => {
    const out = filterBarPosts(posts, { search: 'brunch' });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('vinepair');
  });

  it('ignores search text under 2 characters', () => {
    expect(filterBarPosts(posts, { search: 'a' })).toHaveLength(3);
  });

  it('combines source + category + search filters', () => {
    const out = filterBarPosts(posts, { sourceKey: 'punchdrink', categoryId: 'gin', search: 'negroni' });
    expect(out).toHaveLength(1);
  });
});

describe('DISCOVER_CATEGORIES', () => {
  it('always starts with an "all" category', () => {
    expect(DISCOVER_CATEGORIES[0].id).toBe('all');
  });

  it('every non-"all" category has keywords', () => {
    for (const cat of DISCOVER_CATEGORIES) {
      if (cat.id === 'all') continue;
      expect(Array.isArray(cat.keywords)).toBe(true);
      expect(cat.keywords.length).toBeGreaterThan(0);
    }
  });

  it('category ids are unique', () => {
    const ids = DISCOVER_CATEGORIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
