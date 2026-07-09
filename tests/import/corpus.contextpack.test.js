// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — ContextPack + structure/gemini.js prompt assembly.
// Network is stubbed; pins section labels, budgets, verifier-mode selection,
// reconciliation rules, escalation, and the junk contract end to end.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createContextPack,
  addProvenance,
  packHasCompleteCandidate,
  buildPackSections,
  packFromCaption,
  PACK_BUDGET,
} from '../../src/import/contextPack.js';
import {
  buildPackContents,
  structurePack,
  sanitizeModelJson,
  RECONCILIATION_RULES,
  VERIFIER_RULES,
  IG_RECONCILIATION,
  PACK_RESPONSE_SCHEMA,
} from '../../src/import/structure/gemini.js';
import { packFromExtractResponse } from '../../src/import/acquire/website.js';
import { loadJsonFixture, assertZeroJunk } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const COMPLETE_CANDIDATE = {
  name: 'One-Pan Lemon Herb Chicken Orzo',
  ingredients: ['6 bone-in chicken thighs', '1 1/2 cups dried orzo', '3 cups chicken broth'],
  directions: ['Sear the chicken.', 'Simmer with orzo 15 minutes.'],
};

describe('contextPack — shape and provenance', () => {
  it('createContextPack fills safe defaults', () => {
    const p = createContextPack({ sourceUrl: 'https://x.example.com', sourceType: 'website' });
    expect(p.images).toEqual([]);
    expect(p.provenance).toEqual([]);
    expect(p.confidence).toBe(0);
    expect(p.caption).toBeNull();
  });

  it('addProvenance records optional confidence', () => {
    const p = createContextPack({});
    addProvenance(p, 'candidate', 'json-ld', 0.95);
    addProvenance(p, 'markdown', 'server-extract');
    expect(p.provenance).toEqual([
      { field: 'candidate', via: 'json-ld', confidence: 0.95 },
      { field: 'markdown', via: 'server-extract' },
    ]);
  });

  it('packHasCompleteCandidate: complete vs partial', () => {
    expect(packHasCompleteCandidate(createContextPack({ candidate: COMPLETE_CANDIDATE }))).toBe(true);
    expect(packHasCompleteCandidate(createContextPack({ candidate: { name: 'X', ingredients: ['1 egg'], directions: [] } }))).toBe(false);
    expect(packHasCompleteCandidate(createContextPack({}))).toBe(false);
  });
});

describe('contextPack — section building and budgets', () => {
  it('emits only sections that exist, with provenance labels', () => {
    const p = createContextPack({ caption: 'INGREDIENTS:\n1 cup flour', markdown: '## Recipe\n- 1 cup flour' });
    const { text, sections } = buildPackSections(p);
    expect(sections).toEqual(['CAPTION', 'PAGE CONTENT (markdown)']);
    expect(text).toMatch(/^CAPTION:\n/);
    expect(text).toMatch(/PAGE CONTENT \(markdown\):\n/);
    expect(text).not.toMatch(/TRANSCRIPT|STRUCTURED DATA/);
  });

  it('markdown trims from the tail; JSON-LD is included whole within budget', () => {
    const longMarkdown = 'RECIPE HEAD MARKER\n' + 'filler line about cooking technique\n'.repeat(3000);
    const p = createContextPack({
      markdown: longMarkdown,
      jsonLd: { '@type': 'Recipe', name: 'Budget Test', recipeIngredient: ['1 cup flour'] },
    });
    const { text } = buildPackSections(p);
    expect(text.length).toBeLessThanOrEqual(PACK_BUDGET.total + 2000); // labels/separators margin
    expect(text).toMatch(/RECIPE HEAD MARKER/);        // head survives
    expect(text).toMatch(/"name": "Budget Test"/);     // JSON-LD never dropped
  });
});

describe('contextPack — packFromCaption (caption/IG unification)', () => {
  it('builds a pack from caption + transcript with a hero image and sourceType', () => {
    const p = packFromCaption({
      caption: 'INGREDIENTS:\n2 oz gin',
      transcript: 'add two ounces of gin and stir with ice',
      title: 'Martini',
      sourceUrl: 'https://instagram.com/reel/x',
      imageUrl: 'https://img.example.com/hero.jpg',
      sourceType: 'instagram',
    });
    expect(p.sourceType).toBe('instagram');
    expect(p.caption).toMatch(/2 oz gin/);
    expect(p.transcript).toMatch(/two ounces of gin/);
    expect(p.images[0]).toEqual({ url: 'https://img.example.com/hero.jpg', kind: 'hero' });
    expect(p.acquiredVia).toBe('caption');
  });

  it('blank caption/transcript normalize to null; default sourceType is text', () => {
    const p = packFromCaption({ caption: '   ', transcript: '' });
    expect(p.caption).toBeNull();
    expect(p.transcript).toBeNull();
    expect(p.sourceType).toBe('text');
  });

  it('caption + transcript both emit labeled sections (the IG merge)', () => {
    const p = packFromCaption({ caption: '2 oz gin', transcript: 'stir with ice', sourceType: 'instagram' });
    const { sections } = buildPackSections(p);
    expect(sections).toContain('CAPTION');
    expect(sections).toContain('TRANSCRIPT');
  });
});

describe('structure/gemini — IG reconciliation addendum', () => {
  async function captureSystemParts(sourceType) {
    let captured = null;
    vi.stubGlobal('fetch', vi.fn(async (_endpoint, init) => {
      captured = JSON.parse(init.body).systemInstruction.parts.map((p) => p.text);
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ isRecipe: true, title: 'X', confidence: 0.9 }) }] } }],
        }),
      };
    }));
    const pack = createContextPack({ sourceType, caption: '2 oz gin\nstir with ice' });
    await structurePack(pack, { type: 'drink', clientKey: 'test-key' });
    return captured;
  }

  it('appends IG_RECONCILIATION only for instagram packs', async () => {
    const igParts = await captureSystemParts('instagram');
    expect(igParts.some((t) => t === IG_RECONCILIATION)).toBe(true);
    const textParts = await captureSystemParts('text');
    expect(textParts.some((t) => t === IG_RECONCILIATION)).toBe(false);
  });

  it('IG_RECONCILIATION carries the approved language', () => {
    expect(IG_RECONCILIATION).toMatch(/CAPTION is authoritative/);
    expect(IG_RECONCILIATION).toMatch(/Do not double-count/);
  });
});

describe('structure/gemini — prompt assembly', () => {
  it('verify mode when the candidate is complete; extract otherwise', () => {
    const complete = createContextPack({ candidate: COMPLETE_CANDIDATE, markdown: 'notes text' });
    const partial = createContextPack({ markdown: '- 1 cup flour\n- Mix and bake' });
    expect(buildPackContents(complete).mode).toBe('verify');
    expect(buildPackContents(partial).mode).toBe('extract');
  });

  it('drink detection routes few-shots by kind', () => {
    const p = createContextPack({ caption: '2 oz mezcal\n0.75 oz lime juice\nShake with ice and strain into a coupe' });
    expect(buildPackContents(p).kind).toBe('drink');
  });

  it('title hint is prepended when present', () => {
    const p = createContextPack({ title: 'Birria Tacos', caption: '3 lbs chuck roast' });
    const { contents } = buildPackContents(p);
    const userText = contents[contents.length - 1].parts[0].text;
    expect(userText).toMatch(/^Name hint: "Birria Tacos"/);
  });

  it('reconciliation and verifier rules carry the approved language', () => {
    expect(RECONCILIATION_RULES).toMatch(/PREFER it/);
    expect(RECONCILIATION_RULES).toMatch(/missing a field or clearly contradicts/);
    expect(VERIFIER_RULES).toMatch(/Do NOT/);
    expect(PACK_RESPONSE_SCHEMA.properties.provenance).toBeTruthy();
    expect(PACK_RESPONSE_SCHEMA.required).not.toContain('provenance');
  });

  it('sanitizeModelJson strips fences and control chars', () => {
    expect(sanitizeModelJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    const dirty = '{"a":"b' + String.fromCharCode(1) + 'c"}';
    expect(JSON.parse(sanitizeModelJson(dirty)).a).toBe('bc');
  });
});

describe('structure/gemini — structurePack with stubbed network', () => {
  const recorded = loadJsonFixture('gemini', 'sectioned-groups-notes.json').structured;

  function stubGemini(responder) {
    vi.stubGlobal('fetch', vi.fn(async (endpoint, init) => responder(endpoint, init)));
  }

  it('returns structured output and tags mode', async () => {
    stubGemini(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(recorded) }] } }] }),
    }));
    const pack = createContextPack({ sourceUrl: 'https://x.example.com', markdown: '- 3 lbs chuck roast\n- 4 dried guajillo chiles' });
    const out = await structurePack(pack, { type: 'meal', clientKey: 'test-key' });
    expect(out.isRecipe).toBe(true);
    expect(out.title).toBe('Birria Tacos');
    expect(out._structureMode).toBe('extract');
  });

  it('escalates once on low confidence and keeps the better result', async () => {
    const low = { ...recorded, confidence: 0.4, title: 'Birria (fast model)' };
    const high = { ...recorded, confidence: 0.9, title: 'Birria Tacos' };
    let calls = 0;
    stubGemini(async () => {
      calls += 1;
      const body = calls === 1 ? low : high;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }) };
    });
    const pack = createContextPack({ markdown: '- 3 lbs chuck roast' });
    const out = await structurePack(pack, { type: 'meal', clientKey: 'test-key' });
    expect(calls).toBe(2);
    expect(out.title).toBe('Birria Tacos');
    expect(out._escalated).toBe(true);
  });

  it('returns null on HTTP error (caller falls back)', async () => {
    stubGemini(async () => ({ ok: false, status: 429 }));
    const pack = createContextPack({ markdown: '- 1 cup flour' });
    expect(await structurePack(pack, { clientKey: 'test-key' })).toBeNull();
  });

  it('returns null without a key (offline / client-only mode)', async () => {
    const pack = createContextPack({ markdown: '- 1 cup flour' });
    expect(await structurePack(pack, { clientKey: '' })).toBeNull();
  });
});

describe('acquire/website — response normalization', () => {
  it('json-ld response → complete pack with provenance + hero image', () => {
    const pack = packFromExtractResponse(
      {
        ok: true,
        sourceType: 'website',
        acquiredVia: 'json-ld',
        candidate: { ...COMPLETE_CANDIDATE, imageUrl: 'https://img.example.com/a.jpg' },
        jsonLd: { '@type': 'Recipe' },
        markdown: 'page text',
        meta: { title: 'Page Title' },
        images: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'],
      },
      'https://blog.example.com/orzo/',
    );
    expect(packHasCompleteCandidate(pack)).toBe(true);
    expect(pack.confidence).toBe(0.95);
    expect(pack.images[0]).toEqual({ url: 'https://img.example.com/a.jpg', kind: 'hero' });
    expect(pack.images[1].kind).toBe('carousel');
    expect(pack.provenance.some((p) => p.field === 'candidate' && p.via === 'json-ld')).toBe(true);
  });

  it('empty/failed responses → null', () => {
    expect(packFromExtractResponse({ ok: false, reason: 'fetch-failed' }, 'https://x.example.com')).toBeNull();
    expect(packFromExtractResponse({ ok: true, acquiredVia: 'none', meta: {} }, 'https://x.example.com')).toBeNull();
    expect(packFromExtractResponse(null, 'https://x.example.com')).toBeNull();
  });

  it('markdown-only response → medium-confidence pack', () => {
    const pack = packFromExtractResponse(
      { ok: true, acquiredVia: 'og-meta', markdown: 'lots of page prose about a stew', meta: { title: 'Stew Diary' }, images: [] },
      'https://x.example.com',
    );
    expect(pack.confidence).toBe(0.5);
    expect(pack.candidate).toBeNull();
    expect(pack.title).toBe('Stew Diary');
  });
});

describe('zero-junk contract holds through the enforcer for pack output', () => {
  it('recorded junk-in-notes fixture comes out clean end to end', async () => {
    const { enforceDeterministicRules } = await import('../../src/recipeParser.js');
    const { thinFromStructured } = await import('../../src/recipeSchema.js');
    const fx = loadJsonFixture('gemini', 'junk-leaked-notes.json');
    const out = enforceDeterministicRules({ ...thinFromStructured(fx.structured), _structuredVia: 'corpus' });
    expect((out.notes || []).length).toBe(0); // the junk note is scrubbed
    assertZeroJunk(out, 'pack junk-notes');
  });
});
