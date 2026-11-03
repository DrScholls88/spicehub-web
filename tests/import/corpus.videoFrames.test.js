// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — recipe text shown ON SCREEN in a short video
// ─────────────────────────────────────────────────────────────────────────────
// Music-only Reels often carry the recipe in text overlays, with a one-line
// caption and no speech. The engine now asks the resource server's /api/frames
// for sampled stills, reads them with the cloud vision tiers, and sends the
// de-duplicated text to Gemini as its own labelled section. A caption that
// already holds the recipe, a photo post, or a long YouTube video must NOT
// trigger it (each pass costs a server download plus a vision call).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let acquiredPack = null;
vi.mock('../../src/import/acquire/instagram.js', () => ({
  acquireInstagramPack: async () => structuredClone(acquiredPack),
  instagramShortcode: () => 'abc',
}));
vi.mock('../../src/import/acquire/instagramFollowers.js', () => ({
  tryInstagramFollowerEnrichment: async () => null,
}));
// The Whisper fallback runs after a failed gate; keep it out of these tests.
vi.mock('../../src/import/acquire/videoAudio.js', () => ({
  acquireVideoAudio: async () => ({ transcript: null, attempted: true, via: null }),
}));

const structurePack = vi.fn();
vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  structurePack: (...a) => structurePack(...a),
}));

const transcribePagesOnline = vi.fn();
vi.mock('../../src/lib/photoImportEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transcribePagesOnline: (...a) => transcribePagesOnline(...a),
}));

const { importRequest } = await import('../../src/import/engine.js');
const { buildPackSections } = await import('../../src/import/contextPack.js');
const { packFromRequestBody } = await import('../../api/structure.js');
const { shouldReadFrames, dedupeFrameLines } = await import('../../src/import/acquire/videoFrames.js');

const REEL = 'https://www.instagram.com/reel/abc/';
const FRAME = 'data:image/jpeg;base64,/9j/AAAA';
const reelPack = (caption, extra = {}) => ({
  sourceUrl: REEL, sourceType: 'instagram', title: '', author: 'chef',
  caption, transcript: null, markdown: null, jsonLd: null, candidate: null,
  images: [{ url: 'https://scontent.cdninstagram.com/v/thumb.jpg', kind: 'hero' }],
  provenance: [], acquiredVia: 'apify', confidence: 0.6, isVideo: true, ...extra,
});

// The same overlay is on screen across frames, so vision reads it repeatedly.
const FRAME_PAGES = [
  { transcript: 'Garlic butter pasta' },
  { transcript: 'Garlic butter pasta\n200 g spaghetti' },
  { transcript: '200 g spaghetti\n3 cloves garlic\n2 tbsp butter' },
  { transcript: 'Toss with parmesan and serve' },
];

let fetchMock;
const run = (url = REEL) => importRequest({ url, kind: 'meal' });

describe('video on-screen text', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SERVER_URL', 'https://resource.test');
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, frames: [FRAME, FRAME, FRAME, FRAME, 'not-a-data-url'] }) }));
    vi.stubGlobal('fetch', fetchMock);
    structurePack.mockReset().mockResolvedValue({ isRecipe: false });
    transcribePagesOnline.mockReset().mockResolvedValue({ pages: FRAME_PAGES, contentType: 'recipe', engine: 'gemini' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads the frames when a Reel caption has no measured ingredients', async () => {
    acquiredPack = reelPack('The pasta that broke the internet 🍝 #dinner');
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://resource.test/api/frames');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: REEL });
    // Non-data-URL junk from the server never reaches the vision tiers.
    expect(transcribePagesOnline.mock.calls[0][0]).toHaveLength(4);
    const sent = structurePack.mock.calls[0][0];
    expect(sent.frameText).toBe('Garlic butter pasta\n200 g spaghetti\n3 cloves garlic\n2 tbsp butter\nToss with parmesan and serve');
    expect(sent.provenance.some((p) => p.field === 'frameText' && p.via === 'vision-frames:gemini')).toBe(true);
  });

  it('skips the frame pass when the caption already has the recipe', async () => {
    acquiredPack = reelPack('Garlic pasta\n200 g spaghetti\n3 cloves garlic\n2 tbsp butter');
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(structurePack.mock.calls[0][0].frameText ?? null).toBeNull();
  });

  it('skips Instagram photo posts', async () => {
    acquiredPack = reelPack('The pasta that broke the internet', { sourceUrl: 'https://www.instagram.com/p/abc/', isVideo: false });
    await run('https://www.instagram.com/p/abc/');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries on without frame text when the server fails', async () => {
    acquiredPack = reelPack('The pasta that broke the internet');
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ ok: false, error: 'spawn yt-dlp ENOENT' }) });
    await run();
    expect(transcribePagesOnline).not.toHaveBeenCalled();
    expect(structurePack).toHaveBeenCalledTimes(1);
    expect(structurePack.mock.calls[0][0].frameText ?? null).toBeNull();
  });

  it('ignores frames that are only food footage', async () => {
    acquiredPack = reelPack('The pasta that broke the internet');
    transcribePagesOnline.mockResolvedValue({ pages: [{ transcript: '' }], contentType: 'dish-photo', engine: 'gemini' });
    await run();
    expect(structurePack.mock.calls[0][0].frameText ?? null).toBeNull();
  });
});

describe('which videos qualify', () => {
  it('short-form hosts only', () => {
    const thin = { caption: 'so good', transcript: null };
    expect(shouldReadFrames(thin, 'https://www.tiktok.com/@chef/video/123')).toBe(true);
    expect(shouldReadFrames(thin, 'https://www.youtube.com/shorts/abc123')).toBe(true);
    expect(shouldReadFrames(thin, 'https://www.youtube.com/watch?v=abc123')).toBe(false);
    expect(shouldReadFrames(thin, 'https://www.allrecipes.com/recipe/1/pasta')).toBe(false);
  });

  it('a transcript that holds the recipe is enough', () => {
    const spoken = { caption: 'so good', transcript: 'you need 200 g spaghetti and 2 tbsp butter' };
    expect(shouldReadFrames(spoken, 'https://www.tiktok.com/@chef/video/123')).toBe(false);
  });

  it('de-dupes repeated overlay lines and drops page breaks', () => {
    expect(dedupeFrameLines('2 eggs\n\n--- page break ---\n\n2 Eggs.\n1 cup milk')).toBe('2 eggs\n1 cup milk');
  });
});

describe('frame text in the prompt', () => {
  it('emits a labelled section after the caption', () => {
    const { sections, text } = buildPackSections({ caption: 'Pasta', frameText: '200 g spaghetti' });
    expect(sections).toEqual(['CAPTION', 'TEXT SHOWN ON SCREEN IN THE VIDEO']);
    expect(text).toContain('200 g spaghetti');
  });

  it('survives the /api/structure request round-trip', () => {
    const pack = packFromRequestBody({ pack: { caption: 'Pasta', frameText: '200 g spaghetti' } });
    expect(pack.frameText).toBe('200 g spaghetti');
  });
});
