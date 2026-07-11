import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseVisionContract,
  joinPageTranscripts,
  computeCropRect,
  cleanOcrText,
  PAGE_SEPARATOR,
  PhotoImportError,
  transcribePagesOnline,
} from '../lib/photoImportEngine.js';

// ── parseVisionContract ─────────────────────────────────────────────────────

describe('parseVisionContract', () => {
  const valid = {
    pages: [{ transcript: 'Chicken Alfredo\n2 cups cream' }],
    dishPhoto: { page: 1, box: [100, 100, 600, 800] },
    contentType: 'recipe',
  };

  it('parses clean JSON', () => {
    const out = parseVisionContract(JSON.stringify(valid), 1);
    expect(out).not.toBeNull();
    expect(out.pages[0].transcript).toContain('Chicken Alfredo');
    expect(out.dishPhoto).toEqual({ page: 1, box: [100, 100, 600, 800] });
    expect(out.contentType).toBe('recipe');
  });

  it('parses fenced markdown JSON', () => {
    const out = parseVisionContract('Here you go:\n```json\n' + JSON.stringify(valid) + '\n```\nDone!', 1);
    expect(out).not.toBeNull();
    expect(out.pages[0].transcript).toContain('cream');
  });

  it('parses JSON with leading/trailing prose', () => {
    const out = parseVisionContract('Sure! ' + JSON.stringify(valid) + ' — hope that helps', 1);
    expect(out).not.toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseVisionContract('not json at all', 1)).toBeNull();
    expect(parseVisionContract('', 1)).toBeNull();
    expect(parseVisionContract(null, 1)).toBeNull();
    expect(parseVisionContract('{"pages": [', 1)).toBeNull();
  });

  it('pads missing pages to the expected count', () => {
    const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'only one' }] }), 3);
    expect(out.pages).toHaveLength(3);
    expect(out.pages[1].transcript).toBe('');
  });

  it('trims extra pages beyond the expected count', () => {
    const out = parseVisionContract(
      JSON.stringify({ pages: [{ transcript: 'a' }, { transcript: 'b' }, { transcript: 'c' }] }),
      2,
    );
    expect(out.pages).toHaveLength(2);
  });

  it('rejects malformed dishPhoto boxes without failing the whole contract', () => {
    const cases = [
      { page: 1, box: [600, 100, 100, 800] },      // ymin > ymax
      { page: 1, box: [100, 100, 600] },           // 3 coords
      { page: 9, box: [100, 100, 600, 800] },      // page out of range
      { page: 1, box: [100, 100, 600, 1400] },     // coord > 1000
      { page: 'x', box: [100, 100, 600, 800] },    // NaN page
    ];
    for (const dishPhoto of cases) {
      const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'ok text here' }], dishPhoto }), 1);
      expect(out).not.toBeNull();
      expect(out.dishPhoto).toBeNull();
    }
  });

  it('defaults unknown contentType to recipe', () => {
    const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'x' }], contentType: 'banana' }), 1);
    expect(out.contentType).toBe('recipe');
  });
});

// ── joinPageTranscripts ─────────────────────────────────────────────────────

describe('joinPageTranscripts', () => {
  it('joins pages in order with the separator', () => {
    const joined = joinPageTranscripts([{ transcript: 'front' }, { transcript: 'back' }]);
    expect(joined).toBe(`front${PAGE_SEPARATOR}back`);
  });

  it('skips empty pages', () => {
    const joined = joinPageTranscripts([{ transcript: 'a' }, { transcript: '' }, { transcript: 'c' }]);
    expect(joined).toBe(`a${PAGE_SEPARATOR}c`);
  });

  it('handles junk input', () => {
    expect(joinPageTranscripts(null)).toBe('');
    expect(joinPageTranscripts([])).toBe('');
    expect(joinPageTranscripts([{ transcript: null }, {}])).toBe('');
  });
});

// ── computeCropRect ─────────────────────────────────────────────────────────

describe('computeCropRect', () => {
  const W = 2000;
  const H = 3000;

  it('converts a valid centered box to pixel coords', () => {
    // 0-1000 box covering x 100–900, y 100–500 → 80% × 40% = 32% area
    const rect = computeCropRect([100, 100, 500, 900], W, H);
    expect(rect).toEqual({ sx: 200, sy: 300, sw: 1600, sh: 1200 });
  });

  it('rejects boxes below the minimum area gate (15%)', () => {
    // 10% × 10% = 1% of page
    expect(computeCropRect([0, 0, 100, 100], W, H)).toBeNull();
  });

  it('rejects extreme aspect ratios', () => {
    // Full width, thin slice → aspect way over 2.5
    expect(computeCropRect([0, 0, 150, 1000], W, W)).toBeNull();
  });

  it('accepts a full-page box', () => {
    const rect = computeCropRect([0, 0, 1000, 1000], W, H);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: W, sh: H });
  });

  it('rejects inverted/invalid boxes and bad dims', () => {
    expect(computeCropRect([500, 500, 100, 900], W, H)).toBeNull();
    expect(computeCropRect([0, 0, 1000, 1000], 0, H)).toBeNull();
    expect(computeCropRect(null, W, H)).toBeNull();
    expect(computeCropRect(['a', 0, 1000, 1000], W, H)).toBeNull();
  });
});

// ── cleanOcrText ────────────────────────────────────────────────────────────

describe('cleanOcrText', () => {
  it('fixes the classic l→1 cup artifact and pipe noise', () => {
    const out = cleanOcrText('l cup flour\nsa|t and pepper');
    expect(out).toContain('1 cup flour');
    expect(out).toContain('salt and pepper');
  });

  it('drops symbol-noise lines but keeps real text', () => {
    const out = cleanOcrText('Chicken Parmesan\n@#$%^&*!!\n2 cups sauce');
    expect(out).toContain('Chicken Parmesan');
    expect(out).toContain('2 cups sauce');
    expect(out).not.toContain('@#$%');
  });
});

// ── PhotoImportError ────────────────────────────────────────────────────────

describe('PhotoImportError', () => {
  it('carries a machine-readable code', () => {
    const err = new PhotoImportError('nothing-readable', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('nothing-readable');
    expect(err.name).toBe('PhotoImportError');
  });
});

// ── transcribePagesOnline — 429 handling (spec Component 3,
//    2026-07-07-photo-import-csp-fix-design.md) + /api/vision proxy
//    ("Out of scope" §1 of that spec, implemented via implementation_plan.md)
// ─────────────────────────────────────────────────────────────────────────
// Retry-After is stubbed to '0' throughout so the real one-retry backoff
// (capped at 3s) resolves near-instantly instead of slowing the suite.
// Gemini now has NO key gate (transcribePagesOnline always attempts it) and
// goes through /api/vision first; VITE_GOOGLE_AI_KEY is only relevant as the
// client-side fallback when the proxy itself is unreachable/failing.

describe('transcribePagesOnline — /api/vision proxy + 429 / rate-limit handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const validContract = { pages: [{ transcript: 'Chicken Soup ingredients here' }], dishPhoto: null, contentType: 'recipe' };
  const geminiOkBody = { candidates: [{ content: { parts: [{ text: JSON.stringify(validContract) }] } }] };
  const mistralOkBody = { choices: [{ message: { content: JSON.stringify(validContract) } }] };

  const res429 = (headers = {}, bodyText = '') => ({
    ok: false,
    status: 429,
    headers: { get: (k) => headers[k] ?? null },
    text: async () => bodyText,
  });
  const resOk = (json) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => json });
  const resErr = (status, bodyText = 'server exploded') => ({
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => bodyText,
  });
  const isProxy = (url) => String(url).startsWith('/api/vision');
  const isMistralProxy = (url) => isProxy(url) && String(url).includes('provider=mistral');
  const isGeminiProxy = (url) => isProxy(url) && !String(url).includes('provider=mistral');
  const isMistral = (url) => String(url).includes('api.mistral.ai');
  const isDirectGemini = (url) => String(url).includes('generativelanguage');

  it('uses the /api/vision proxy for Gemini with no client key configured at all', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    let sawProxyCall = false;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) { sawProxyCall = true; return resOk(geminiOkBody); }
      throw new Error(`unexpected fetch to ${url}`);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(sawProxyCall).toBe(true);
    expect(out.engine).toBe('gemini');
    expect(out.pages[0].transcript).toContain('Chicken Soup');
  });

  it('retries once on a proxy 429 (honoring Retry-After), then succeeds', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1 ? res429({ 'Retry-After': '0' }) : resOk(geminiOkBody);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(calls).toBe(2);
    expect(out.engine).toBe('gemini');
  });

  it('parses Gemini RetryInfo retryDelay from the body when no Retry-After header is sent', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1
        ? res429({}, '{"error":{"details":[{"retryDelay":"0s"}]}}')
        : resOk(geminiOkBody);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(calls).toBe(2);
    expect(out.engine).toBe('gemini');
  });

  it('falls back to the direct client-key call when the proxy is unreachable', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', 'k');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    let directCallSeen = false;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) throw new Error('network down');
      if (isDirectGemini(url)) { directCallSeen = true; return resOk(geminiOkBody); }
      throw new Error(`unexpected fetch to ${url}`);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(directCallSeen).toBe(true);
    expect(out.engine).toBe('gemini');
  });

  it('does not fall back when no client key is configured — surfaces the proxy failure directly', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return resErr(500, 'proxy exploded');
      throw new Error(`unexpected fetch to ${url}`);
    }));

    await expect(transcribePagesOnline(['data:image/jpeg;base64,x'])).rejects.toMatchObject({
      status: 500,
      engine: 'gemini',
      detail: expect.stringContaining('proxy exploded'),
    });
  });

  it('falls through to Mistral once the Gemini proxy exhausts its retry', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', ''); // no client fallback — proxy failure goes straight to tier 2
    vi.stubEnv('VITE_MISTRAL_API_KEY', 'm');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return res429({ 'Retry-After': '0' });
      if (isMistral(url)) return resOk(mistralOkBody);
      throw new Error(`unexpected fetch to ${url}`);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(out.engine).toBe('mistral');
  });

  it('propagates the last-tried tier failure reason (regression: Mistral error was previously dropped)', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', 'm');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isProxy(url)) return resErr(500, 'gemini exploded');
      if (isMistral(url)) return resErr(503, 'mistral exploded');
      throw new Error(`unexpected fetch to ${url}`);
    }));

    await expect(transcribePagesOnline(['data:image/jpeg;base64,x'])).rejects.toMatchObject({
      status: 503,
      engine: 'mistral',
      detail: expect.stringContaining('mistral exploded'),
    });
  });

  it('surfaces status 429 all the way out when every online tier is rate-limited', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', 'm');
    vi.stubGlobal('fetch', vi.fn(async () => res429({ 'Retry-After': '0' })));

    await expect(transcribePagesOnline(['data:image/jpeg;base64,x'])).rejects.toMatchObject({
      status: 429,
      engine: 'mistral', // last tier tried
    });
  });

  // ── Mistral /api/vision proxy (security hardening — key no longer ships in
  //    the client bundle; mirrors the Gemini proxy coverage above) ──────────

  it('Mistral works via the /api/vision proxy alone, with no client key configured', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    let sawMistralProxyCall = false;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isMistralProxy(url)) { sawMistralProxyCall = true; return resOk(mistralOkBody); }
      if (isGeminiProxy(url)) return resErr(500, 'gemini exploded');
      throw new Error(`unexpected fetch to ${url}`);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(sawMistralProxyCall).toBe(true);
    expect(out.engine).toBe('mistral');
  });

  it('falls back to Mistral\'s direct client-key call when only the Mistral proxy is unreachable', async () => {
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', 'm');
    let directMistralSeen = false;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isGeminiProxy(url)) return resErr(500, 'gemini exploded');
      if (isMistralProxy(url)) throw new Error('network down');
      if (isMistral(url)) { directMistralSeen = true; return resOk(mistralOkBody); }
      throw new Error(`unexpected fetch to ${url}`);
    }));

    const out = await transcribePagesOnline(['data:image/jpeg;base64,x']);
    expect(directMistralSeen).toBe(true);
    expect(out.engine).toBe('mistral');
  });

  it('does not let an unconfigured Mistral tier eclipse a real Gemini failure reason', async () => {
    // Regression guard: Mistral tier 2 is now ALWAYS attempted (no more
    // MISTRAL_KEY() gate), so an unconfigured Mistral must not paper over
    // Gemini's actual error with a generic "no-server-key" 503.
    vi.stubEnv('VITE_GOOGLE_AI_KEY', '');
    vi.stubEnv('VITE_MISTRAL_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (isMistralProxy(url)) return resErr(503, '{"ok":false,"reason":"no-server-key"}');
      if (isGeminiProxy(url)) return resErr(500, 'gemini real failure');
      throw new Error(`unexpected fetch to ${url}`);
    }));

    await expect(transcribePagesOnline(['data:image/jpeg;base64,x'])).rejects.toMatchObject({
      status: 500,
      engine: 'gemini',
      detail: expect.stringContaining('gemini real failure'),
    });
  });
});
