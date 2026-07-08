import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJsonViaProxy } from '../api.js';
import { fetchRedditJson } from '../scrapers/redditDiscovery.js';

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
