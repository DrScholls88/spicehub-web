// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — pack-flow integrity.
// The acquired ContextPack must survive through to structurePack without
// being drained into locals and rebuilt. This test catches the 13-local
// destructuring that drops provenance, image metadata, and acquiredVia.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Known pack that acquireInstagramPack will "return" ────────────────────────
const FAKE_IG_PACK = {
  sourceUrl: 'https://www.instagram.com/reel/DCorpusPackflow1/',
  sourceType: 'instagram',
  title: 'Noodle Ninja',
  author: 'noodle.ninja.eats',
  caption: [
    'CRISPY CHILI GARLIC NOODLES',
    '',
    'Ingredients:',
    '- 8 oz rice noodles',
    '- 4 cloves garlic, minced',
    '- 2 tbsp soy sauce',
    '- 1 tbsp chili crisp',
    '- 1 tbsp sesame oil',
    '- 2 green onions, sliced',
    '',
    'Directions:',
    '1. Cook noodles per package directions, drain',
    '2. Heat sesame oil, fry garlic until golden',
    '3. Toss noodles with garlic, soy sauce, chili crisp',
    '4. Garnish with green onions and serve hot',
  ].join('\n'),
  transcript: null,
  markdown: null,
  jsonLd: null,
  candidate: null,
  images: [
    { url: 'https://scontent.cdninstagram.com/v/t51/hero.jpg', kind: 'hero' },
    { url: 'https://scontent.cdninstagram.com/v/t51/slide2.jpg', kind: 'carousel' },
  ],
  provenance: [
    { field: 'caption', via: 'apify', confidence: 0.85 },
    { field: 'images', via: 'apify' },
    { field: 'title', via: 'apify' },
  ],
  acquiredVia: 'apify',
  confidence: 0.85,
  latestComments: [],
  ownerUsername: 'noodle.ninja.eats',
  profileBioUrl: '',
  isVideo: true,
};

// ── Mock acquireInstagramPack — return our known pack ─────────────────────────
vi.mock('../../src/import/acquire/instagram.js', () => ({
  acquireInstagramPack: vi.fn(async () => ({ ...FAKE_IG_PACK })),
  instagramShortcode: (url) => url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[2] || null,
}));

// ── Mock structurePack — capture calls + return a valid recipe ────────────────
const structurePack = vi.fn(async (_pack, { type } = {}) => ({
  isRecipe: true,
  name: 'Crispy Chili Garlic Noodles',
  title: 'Crispy Chili Garlic Noodles',
  type: type || 'meal',
  ingredients: ['8 oz rice noodles', '4 cloves garlic', '2 tbsp soy sauce', '1 tbsp chili crisp'],
  directions: ['Cook noodles', 'Fry garlic', 'Toss with sauce', 'Serve hot'],
  imageUrl: '',
}));
vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, structurePack, serverStructurePack: structurePack };
});

// ── Mock transcription so video paths don't hit real APIs ────────────────────
vi.mock('../../src/lib/transcriptionService.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    transcribeFromUrl: vi.fn(async () => ({ transcript: '', extractedVia: 'mock' })),
    getPreferredWhisperModel: () => 'whisper-1',
  };
});

// ── Stub fetch globally ──────────────────────────────────────────────────────
const mockFetch = vi.fn(async () => ({
  ok: false, status: 503, json: async () => ({}), text: async () => '',
}));
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  structurePack.mockClear();
  mockFetch.mockClear();
});
afterEach(() => vi.restoreAllMocks());

// ── The test ─────────────────────────────────────────────────────────────────

describe('pack-flow integrity: acquired pack survives to structurePack', () => {

  it('carries the acquired pack provenance through to structurePack', async () => {
    const { importFromInstagram } = await import('../../src/recipeParser.js');

    await importFromInstagram(
      'https://www.instagram.com/reel/DCorpusPackflow1/',
      () => {},
      { type: 'meal' },
    );

    // structurePack must have been called (either directly or via captionToRecipe)
    expect(structurePack).toHaveBeenCalled();

    const sent = structurePack.mock.calls.at(-1)[0];
    // The pack that reached structurePack must carry the ORIGINAL provenance
    // from acquireInstagramPack — not an empty array from a rebuilt pack.
    expect(sent.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'caption', via: 'apify' }),
      ]),
    );
    expect(sent.sourceUrl).toBe(FAKE_IG_PACK.sourceUrl);
  });

  it('preserves acquiredVia on the pack sent to structurePack', async () => {
    const { importFromInstagram } = await import('../../src/recipeParser.js');

    await importFromInstagram(
      'https://www.instagram.com/reel/DCorpusPackflow1/',
      () => {},
      { type: 'meal' },
    );

    expect(structurePack).toHaveBeenCalled();
    const sent = structurePack.mock.calls.at(-1)[0];
    // acquiredVia must be the original 'apify', not rebuilt as 'caption' or 'text'
    expect(sent.acquiredVia).toBe('apify');
  });

  it('preserves image metadata on the pack sent to structurePack', async () => {
    const { importFromInstagram } = await import('../../src/recipeParser.js');

    await importFromInstagram(
      'https://www.instagram.com/reel/DCorpusPackflow1/',
      () => {},
      { type: 'meal' },
    );

    expect(structurePack).toHaveBeenCalled();
    const sent = structurePack.mock.calls.at(-1)[0];
    // The pack must carry the original images array with kind metadata,
    // not a single imageUrl string rebuilt from locals.
    expect(Array.isArray(sent.images)).toBe(true);
    expect(sent.images.length).toBeGreaterThanOrEqual(1);
    expect(sent.images[0]).toHaveProperty('kind');
  });
});
