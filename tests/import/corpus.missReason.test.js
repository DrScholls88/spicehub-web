// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — honest Miss messaging for links that never reach a recipe
// ─────────────────────────────────────────────────────────────────────────────
// Verified live 2026-11-02: allrecipes and Serious Eats answer recipe apps with
// a 402 licensing wall (even from a home IP), Budget Bytes with a Cloudflare
// 403. The engine used to collapse all of that into "acquisition failed" and
// the sheet said "We couldn't read a recipe from this." Now /api/extract
// classifies the wall, acquire/website.js maps it to a reason, the engine
// returns it, and importCopy.missMessage says what happened and what to do.
import { describe, it, expect, vi, afterEach } from 'vitest';

const { extractMissReason, acquireWebsitePack } = await import('../../src/import/acquire/website.js');
const { importRequest } = await import('../../src/import/engine.js');
const { missMessage } = await import('../../src/importCopy.js');
const { pageWallReason } = await import('../../src/lib/importGuards.js');

const ALLRECIPES = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';
const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

afterEach(() => vi.unstubAllGlobals());

describe('extractMissReason (from /api/extract failures)', () => {
  it.each([
    [502, { reason: 'fetch-failed', detail: 'upstream 402', status: 402, wall: 'publisher-block' }, 'site-publisher-block'],
    [502, { reason: 'fetch-failed', detail: 'upstream 402' }, 'site-publisher-block'], // older server, no wall field
    [502, { reason: 'fetch-failed', detail: 'upstream 403', status: 403, wall: 'bot-challenge' }, 'site-bot-challenge'],
    [502, { reason: 'fetch-failed', detail: 'upstream 403' }, 'site-bot-challenge'],
    [502, { reason: 'fetch-failed', detail: 'upstream 200 bot-challenge', status: 200, wall: 'bot-challenge' }, 'site-bot-challenge'],
    [502, { reason: 'fetch-failed', detail: 'upstream 404' }, 'site-page-not-found'],
    [502, { reason: 'upstream-timeout', detail: 'The operation was aborted due to timeout' }, 'site-timeout'],
    [429, { ok: false, reason: 'rate-limited' }, 'rate-limited'],
    [400, { ok: false, reason: 'blocked-host' }, 'invalid-url'],
    [500, null, 'site-unreachable'],
  ])('%i %j → %s', (status, body, want) => {
    expect(extractMissReason(status, body)).toBe(want);
  });
});

describe('acquireWebsitePack reports why it missed', () => {
  it('passes the wall reason to onMiss', async () => {
    vi.stubGlobal('fetch', reply(502, { ok: false, reason: 'fetch-failed', detail: 'upstream 402', status: 402, wall: 'publisher-block' }));
    const onMiss = vi.fn();
    expect(await acquireWebsitePack(ALLRECIPES, { onMiss })).toBeNull();
    expect(onMiss).toHaveBeenCalledWith('site-publisher-block');
  });

  it('a page with no recipe signal is its own reason', async () => {
    vi.stubGlobal('fetch', reply(200, { ok: true, sourceType: 'website' }));
    const onMiss = vi.fn();
    expect(await acquireWebsitePack(ALLRECIPES, { onMiss })).toBeNull();
    expect(onMiss).toHaveBeenCalledWith('no-recipe-on-page');
  });

  it('never reaching the server is "unreachable", and a caller abort reports nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const onMiss = vi.fn();
    await acquireWebsitePack(ALLRECIPES, { onMiss });
    expect(onMiss).toHaveBeenCalledWith('site-unreachable');

    const ctrl = new AbortController();
    ctrl.abort();
    const silent = vi.fn();
    await acquireWebsitePack(ALLRECIPES, { signal: ctrl.signal, onMiss: silent });
    expect(silent).not.toHaveBeenCalled();
  });
});

describe('engine → sheet copy', () => {
  it('the engine returns the miss reason instead of "acquisition failed"', async () => {
    vi.stubGlobal('fetch', reply(502, { ok: false, reason: 'fetch-failed', detail: 'upstream 402', status: 402, wall: 'publisher-block' }));
    const result = await importRequest({ url: ALLRECIPES, kind: 'meal' });
    expect(result.gate).toBe('empty');
    expect(result.reasons).toEqual(['site-publisher-block']);
  });

  it('names the site and offers paste + screenshot for a wall', () => {
    const msg = missMessage(['site-publisher-block'], ALLRECIPES);
    expect(msg.text).toMatch(/^allrecipes\.com blocks recipe apps\./);
    expect(msg.actions).toEqual(['paste', 'screenshot']);
  });

  it('offers nothing to do for a rate limit, and stays out of non-fetch misses', () => {
    expect(missMessage(['rate-limited'], ALLRECIPES).actions).toEqual([]);
    expect(missMessage(['no-ingredients'], ALLRECIPES)).toBeNull();
    expect(missMessage(['site-bot-challenge'], 'not a url').text).toMatch(/^This site asked/);
  });
});

describe('pageWallReason (shared by api/extract.js and server/index.js)', () => {
  const realPage = '<html><head><title>Lemon cake</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>'
    + '<body><div id="cf-chl-widget-abc"></div>' + '<p>2 cups flour, 1 cup sugar, 2 eggs. Bake 30 minutes at 350F.</p>'.repeat(20) + '</body></html>';

  it('does not flag a real recipe page that embeds Turnstile on its comment form', () => {
    expect(pageWallReason(realPage, 200)).toBe('');
  });

  it('flags the Cloudflare challenge shell, at 403 or 200', () => {
    const shell = '<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script>Enable JavaScript and cookies to continue</body></html>';
    expect(pageWallReason(shell, 403)).toBe('bot-challenge');
    expect(pageWallReason(shell, 200)).toBe('bot-challenge');
  });

  it('a 402 is a publisher wall whatever the body says', () => {
    expect(pageWallReason('', 402)).toBe('publisher-block');
  });

  it('ignores challenge-like text deep inside a large real page', () => {
    expect(pageWallReason('x'.repeat(200_000) + 'Enable JavaScript and cookies to continue', 200)).toBe('');
  });
});
