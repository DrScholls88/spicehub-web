// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — /api/structure server passthrough + step-5 engine unification.
// Verifies: one prompt brain (server imports the exact client constants),
// request-body normalization, rate limit, serverStructurePack client, and that
// the removed engines (Grok / legacy prose prompt) stay removed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFromRequestBody, checkRateLimit } from '../../api/structure.js';
import { serverStructurePack, structureEndpoint } from '../../src/import/structure/gemini.js';
import { createContextPack } from '../../src/import/contextPack.js';
import { loadJsonFixture } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');

afterEach(() => vi.unstubAllGlobals());

describe('api/structure — request normalization', () => {
  it('accepts a full pack body', () => {
    const pack = packFromRequestBody({ pack: { sourceUrl: 'https://x.example.com', caption: 'text', sourceType: 'instagram' } });
    expect(pack.sourceType).toBe('instagram');
    expect(pack.caption).toBe('text');
  });

  it('wraps rawText into a text pack (legacy caption clients)', () => {
    const pack = packFromRequestBody({ rawText: '2 cups flour\nMix and bake at 350F.', title: 'Cake', sourceUrl: 'https://y.example.com' });
    expect(pack.sourceType).toBe('text');
    expect(pack.title).toBe('Cake');
    expect(pack.acquiredVia).toBe('raw-text');
  });

  it('rejects empty bodies', () => {
    expect(packFromRequestBody({})).toBeNull();
    expect(packFromRequestBody({ rawText: 'too short' })).toBeNull();
  });

  it('rate limit allows a burst then blocks', () => {
    const now = Date.now();
    const ip = 'structure-test-' + Math.random();
    for (let i = 0; i < 30; i++) expect(checkRateLimit(ip, now)).toBe(true);
    expect(checkRateLimit(ip, now)).toBe(false);
  });
});

describe('serverStructurePack — client side of the passthrough', () => {
  const recorded = loadJsonFixture('gemini', 'drink-oz-units.json').structured;

  it('POSTs the pack and unwraps structured output', async () => {
    let captured = null;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ ok: true, structured: recorded, mode: 'extract' }) };
    }));
    const pack = createContextPack({ sourceUrl: 'https://ig.example.com/r/1', caption: '2 oz mezcal…' });
    const out = await serverStructurePack(pack, { type: 'drink' });
    expect(captured.url).toBe(structureEndpoint());
    expect(captured.body.type).toBe('drink');
    expect(captured.body.pack.sourceUrl).toBe('https://ig.example.com/r/1');
    expect(out.title).toBe('Smoked Paloma Negra');
  });

  it('returns null on HTTP error / non-recipe / network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    expect(await serverStructurePack(createContextPack({ caption: 'x'.repeat(30) }))).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, structured: null }) })));
    expect(await serverStructurePack(createContextPack({ caption: 'x'.repeat(30) }))).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await serverStructurePack(createContextPack({ caption: 'x'.repeat(30) }))).toBeNull();
  });
});

describe('step 5 — one brain, no alternate engines', () => {
  const parserSource = readFileSync(join(SRC, 'recipeParser.js'), 'utf8');

  it('the Grok call branch is gone from structureWithAI', () => {
    expect(parserSource).not.toMatch(/provider === 'grok'/);
    expect(parserSource).not.toMatch(/await structureWithGrokClient\(rawText/);
  });

  it('the legacy prose-prompt fallback call is gone', () => {
    expect(parserSource).not.toMatch(/return _structureWithAIClientLegacy\(/);
    expect(parserSource).not.toMatch(/falling back to legacy prompt/);
  });

  it('the server passthrough is the declared fallback instead', () => {
    expect(parserSource).toMatch(/serverStructurePack\(miniPack/);
  });

  it('server and client share the identical prompt constants (one brain)', async () => {
    const server = await import('../../api/structure.js');
    const client = await import('../../src/import/structure/gemini.js');
    // Same module instance re-exported — not a copy that can drift.
    expect(typeof server.packFromRequestBody).toBe('function');
    expect(client.RECONCILIATION_RULES).toMatch(/PREFER it/);
    // api/structure.js imports RECONCILIATION_RULES/PACK_RESPONSE_SCHEMA from
    // the client module — verified by source inspection:
    const serverSource = readFileSync(join(__dirname, '..', '..', 'api', 'structure.js'), 'utf8');
    expect(serverSource).toMatch(/from '\.\.\/src\/import\/structure\/gemini\.js'/);
    expect(serverSource).toMatch(/from '\.\.\/src\/recipeSchema\.js'/);
  });
});
