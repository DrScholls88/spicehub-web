import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJsonViaProxy } from '../api.js';
import { fetchRedditJson, extractRedditPost } from '../scrapers/redditDiscovery.js';

// Regression coverage for the 2026-07-07 Reddit Discovery outage: prod logs
// showed a direct-fetch CORS block, a 403 from /api/proxy, then an
// api.allorigins.win AbortError, feeding into "No recipes found." Root
// causes fixed: (1) fetchRedditJson previously reused fetchHtmlViaProxy,
// an HTML-scraping helper (bot-wall regexes, >1000-char gate, a
// `!includes('"error"')` heuristic that can misfire on JSON) that ALSO
// chained its own internal-proxy + 7-public-proxy cascade, producing up to
// ~60s of worst-case nested timeouts; (2) no consistent JSON Accept header
// was sent to Reddit through the proxy. fetchJsonViaProxy() is the small,
// JSON-specific, tightly time-bounded replacement.

afterEach(() => vi.unstubAllGlobals());

const resOk = (body) => ({ ok: true, status: 200, text: async () => body });
const resErr = (status) => ({ ok: false, status, text: async () => '' });

describe('fetchJsonViaProxy', () => {
  it('succeeds on the first attempt (internal /api/proxy) without trying others', async () => {
    const fetchSpy = vi.fn(async () => resOk(JSON.stringify({ hello: 'world' })));
    vi.stubGlobal('fetch', fetchSpy);

    const out = await fetchJsonViaProxy('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ hello: 'world' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/proxy?url=');
  });

  it('falls through to the next attempt when one returns non-ok', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1 ? resErr(403) : resOk(JSON.stringify({ ok: true }));
    }));

    const out = await fetchJsonViaProxy('https://www.reddit.com/r/recipes/new.json');
    expect(calls).toBe(2);
    expect(out).toEqual({ ok: true });
  });

  it('falls through when a response is not valid JSON', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1 ? resOk('<html>not json</html>') : resOk(JSON.stringify({ ok: true }));
    }));

    const out = await fetchJsonViaProxy('https://www.reddit.com/r/recipes/new.json');
    expect(calls).toBe(2);
    expect(out).toEqual({ ok: true });
  });

  it('returns null when every attempt fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resErr(403)));
    const out = await fetchJsonViaProxy('https://www.reddit.com/r/recipes/new.json');
    expect(out).toBeNull();
  });

  it('never makes more than 3 attempts total', async () => {
    const fetchSpy = vi.fn(async () => resErr(500));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchJsonViaProxy('https://www.reddit.com/r/recipes/new.json');
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('fetchRedditJson', () => {
  const isProxy = (url) => String(url).includes('/api/proxy') || String(url).includes('codetabs') || String(url).includes('allorigins');

  it('returns the direct-fetch result without touching the proxy cascade when it succeeds', async () => {
    const fetchSpy = vi.fn(async (url) => {
      if (isProxy(url)) throw new Error('should not reach the proxy cascade');
      return { ok: true, status: 200, json: async () => ({ direct: true }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ direct: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the proxy cascade when the direct fetch is CORS-blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return resOk(JSON.stringify({ viaProxy: true }));
      throw new TypeError('Failed to fetch'); // how a CORS block surfaces to fetch()
    }));

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ viaProxy: true });
  });

  it('falls back to the proxy cascade when the direct fetch returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return resOk(JSON.stringify({ viaProxy: true }));
      return { ok: false, status: 403, json: async () => ({}) };
    }));

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ viaProxy: true });
  });

  it('returns null when direct fetch AND every proxy attempt fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return resErr(403);
      throw new TypeError('Failed to fetch');
    }));

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toBeNull();
  });

  it('adds raw_json=1 to the fetched URL', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (!isProxy(url)) capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    await fetchRedditJson('https://www.reddit.com/r/recipes/new.json?limit=25');
    expect(capturedUrl).toContain('raw_json=1');
    expect(capturedUrl).toContain('limit=25');
  });
});

// Coverage for the 2026-07-08 "still 403ing" fix: prod logs showed the
// 2026-07-07 proxy-cascade fix wasn't enough — Reddit blocks anonymous/
// unauthenticated requests from cloud IP ranges regardless of headers. A new
// OAuth2-authenticated tier (api/reddit.js, client_credentials app-only grant)
// now sits between the direct-fetch attempt and the old anonymous cascade.
describe('fetchRedditJson — OAuth proxy tier', () => {
  const isOAuth = (url) => String(url).includes('/api/reddit');
  const isOldCascade = (url) => String(url).includes('/api/proxy') || String(url).includes('codetabs') || String(url).includes('allorigins');

  it('uses the OAuth proxy when direct fetch fails, without touching the old anonymous cascade', async () => {
    const fetchSpy = vi.fn(async (url) => {
      if (isOAuth(url)) return resOk(JSON.stringify({ viaOAuth: true }));
      if (isOldCascade(url)) throw new Error('should not reach the old cascade');
      throw new TypeError('Failed to fetch'); // direct fetch CORS-blocked
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ viaOAuth: true });
    expect(fetchSpy.mock.calls.some(([url]) => isOldCascade(url))).toBe(false);
  });

  it('falls through to the old anonymous cascade when the OAuth proxy is not configured (503)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isOAuth(url)) return resErr(503);
      if (isOldCascade(url)) return resOk(JSON.stringify({ viaOldCascade: true }));
      throw new TypeError('Failed to fetch');
    }));

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ viaOldCascade: true });
  });

  it('falls through to the old anonymous cascade when the OAuth proxy throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isOAuth(url)) throw new Error('network error');
      if (isOldCascade(url)) return resOk(JSON.stringify({ viaOldCascade: true }));
      throw new TypeError('Failed to fetch');
    }));

    const out = await fetchRedditJson('https://www.reddit.com/r/recipes/new.json');
    expect(out).toEqual({ viaOldCascade: true });
  });

  it('sends the Reddit path (not a full URL) as the OAuth proxy path param', async () => {
    let capturedOAuthUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isOAuth(url)) { capturedOAuthUrl = String(url); return resOk(JSON.stringify({ ok: true })); }
      throw new TypeError('Failed to fetch');
    }));

    await fetchRedditJson('https://www.reddit.com/r/recipes/comments/abc123/title.json?limit=25');
    expect(capturedOAuthUrl).toContain('/api/reddit?path=');
    const encodedPath = capturedOAuthUrl.split('path=')[1];
    const decodedPath = decodeURIComponent(encodedPath);
    expect(decodedPath).toBe('/r/recipes/comments/abc123/title.json?limit=25&raw_json=1');
    // Never leaks the reddit.com host into the path param — api/reddit.js
    // rejects anything containing "://" to stay a closed (not open) proxy.
    expect(decodedPath).not.toContain('://');
  });
});

// Coverage for the 2026-07-08 "photos" gap: extractRedditPost previously only
// ever captured ONE image (preview.images[0] or thumbnail), silently dropping
// gallery posts (multi-photo recipe posts are common — an ingredients shot +
// the plated dish) and crossposts (whose selftext/media live on the original
// post, not the crosspost wrapper). Both are now surfaced via the `images`
// array so the caller can persist/offer a cover picker instead of guessing.
describe('extractRedditPost — photos', () => {
  const listingJson = (postData) => [
    { data: { children: [{ data: postData }] } },
    { data: { children: [] } },
  ];

  const stubPost = (postData) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => listingJson(postData),
    })));
  };

  it('collects every photo from a gallery post, unescaping preview URLs and skipping failed items', async () => {
    stubPost({
      title: "Grandma's Chili",
      selftext: 'Ingredients:\n- 1 lb beef\n- 1 can beans\n\nDirections:\n1. Brown the beef.\n2. Simmer 1 hour.',
      url: 'https://www.reddit.com/r/recipes/comments/abc123/grandmas_chili/',
      is_gallery: true,
      gallery_data: { items: [{ media_id: 'a1' }, { media_id: 'a2' }, { media_id: 'bad' }] },
      media_metadata: {
        a1: { status: 'valid', s: { u: 'https://preview.redd.it/a1.jpg?width=100&amp;s=sig1' } },
        a2: { status: 'valid', s: { u: 'https://preview.redd.it/a2.jpg?width=100&amp;s=sig2' } },
        bad: { status: 'failed' },
      },
      thumbnail: 'https://b.thumbs.redditmedia.com/xyz.jpg',
    });

    const result = await extractRedditPost('https://www.reddit.com/r/recipes/comments/abc123/grandmas_chili/');
    expect(result.images).toEqual([
      'https://preview.redd.it/a1.jpg?width=100&s=sig1',
      'https://preview.redd.it/a2.jpg?width=100&s=sig2',
    ]);
    expect(result.imageUrl).toBe('https://preview.redd.it/a1.jpg?width=100&s=sig1');
  });

  it('returns a single-item images array for a normal (non-gallery) preview post', async () => {
    stubPost({
      title: 'Weeknight Pasta',
      selftext: 'Ingredients:\n- pasta\n- sauce\n\nDirections:\n1. Boil pasta.\n2. Add sauce.',
      url: 'https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/',
      preview: { images: [{ source: { url: 'https://preview.redd.it/single.jpg?s=sig' } }] },
    });

    const result = await extractRedditPost('https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/');
    expect(result.images).toEqual(['https://preview.redd.it/single.jpg?s=sig']);
    expect(result.imageUrl).toBe('https://preview.redd.it/single.jpg?s=sig');
  });

  it('falls back to the crosspost parent for selftext and photos when the wrapper post has neither', async () => {
    stubPost({
      title: 'Found this great chili recipe',
      selftext: '', // crosspost wrapper carries no body of its own
      url: 'https://www.reddit.com/r/food/comments/ghi789/found_this/',
      crosspost_parent_list: [{
        selftext: 'Ingredients:\n- 1 lb beef\n- 1 can beans\n\nDirections:\n1. Brown it.\n2. Simmer.',
        preview: { images: [{ source: { url: 'https://preview.redd.it/parent.jpg?s=sig' } }] },
      }],
    });

    const result = await extractRedditPost('https://www.reddit.com/r/food/comments/ghi789/found_this/');
    expect(result.rawText).toContain('Brown it');
    expect(result.images).toEqual(['https://preview.redd.it/parent.jpg?s=sig']);
  });

  it('returns an empty images array (not undefined) for a text-only post with no photos', async () => {
    stubPost({
      title: 'Simple Rice',
      selftext: 'Ingredients:\n- 1 cup rice\n- 2 cups water\n\nDirections:\n1. Combine.\n2. Simmer 18 minutes.',
      url: 'https://www.reddit.com/r/recipes/comments/jkl012/simple_rice/',
    });

    const result = await extractRedditPost('https://www.reddit.com/r/recipes/comments/jkl012/simple_rice/');
    expect(result.images).toEqual([]);
    expect(result.imageUrl).toBe('');
  });
});
