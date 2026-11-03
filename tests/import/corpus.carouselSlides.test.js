// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — recipe text printed on Instagram carousel slides
// ─────────────────────────────────────────────────────────────────────────────
// Many recipe carousels put the ingredients on the slides and leave a two-line
// caption. The engine now reads the slides with the cloud vision tiers when
// the caption has fewer than two quantity lines, and sends the text to Gemini
// as its own labelled section. A caption that already holds the recipe must
// NOT trigger the slide pass (it costs a vision call).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let acquiredPack = null;
vi.mock('../../src/import/acquire/instagram.js', () => ({
  acquireInstagramPack: async () => structuredClone(acquiredPack),
  instagramShortcode: () => 'abc',
}));
vi.mock('../../src/import/acquire/instagramFollowers.js', () => ({
  tryInstagramFollowerEnrichment: async () => null,
}));

const structurePack = vi.fn();
vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  structurePack: (...a) => structurePack(...a),
}));

const downloadImageAsDataUrl = vi.fn(async (u) => `data:image/jpeg;base64,${Buffer.from(u).toString('base64')}`);
vi.mock('../../src/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadImageAsDataUrl: (...a) => downloadImageAsDataUrl(...a),
}));

const transcribePagesOnline = vi.fn();
vi.mock('../../src/lib/photoImportEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transcribePagesOnline: (...a) => transcribePagesOnline(...a),
}));

const { importRequest } = await import('../../src/import/engine.js');
const { buildPackSections } = await import('../../src/import/contextPack.js');
const { packFromRequestBody } = await import('../../api/structure.js');

const SLIDES = [
  { url: 'https://scontent.cdninstagram.com/v/slide1.jpg?x=1', kind: 'hero' },
  { url: 'https://scontent.cdninstagram.com/v/slide2.jpg', kind: 'carousel' },
  { url: 'https://scontent.cdninstagram.com/v/slide3.jpg', kind: 'carousel' },
];
const igPack = (caption, images = SLIDES) => ({
  sourceUrl: 'https://www.instagram.com/p/abc/', sourceType: 'instagram', title: '', author: 'chef',
  caption, transcript: null, markdown: null, jsonLd: null, candidate: null,
  images, provenance: [], acquiredVia: 'apify', confidence: 0.6,
});
const SLIDE_TEXT = 'Ingredients\n2 cups flour\n1 cup sugar\n2 eggs';

const run = () => importRequest({ url: 'https://www.instagram.com/p/abc/', kind: 'meal' });

describe('carousel slide text', () => {
  beforeEach(() => {
    structurePack.mockReset().mockResolvedValue({ isRecipe: false });
    transcribePagesOnline.mockReset().mockResolvedValue({
      pages: [{ transcript: 'Lemon cake' }, { transcript: SLIDE_TEXT }, { transcript: 'Bake 30 min at 350F' }],
      contentType: 'recipe',
      engine: 'gemini',
    });
    downloadImageAsDataUrl.mockClear();
  });

  it('reads the slides when the caption has no measured ingredients', async () => {
    acquiredPack = igPack('The lemon cake everyone asks for 🍋 save this!');
    await run();
    expect(transcribePagesOnline).toHaveBeenCalledTimes(1);
    expect(transcribePagesOnline.mock.calls[0][0]).toHaveLength(3);
    const sent = structurePack.mock.calls[0][0];
    expect(sent.slideText).toContain('2 cups flour');
    expect(sent.provenance.some((p) => p.field === 'slideText')).toBe(true);
  });

  it('skips the slide pass when the caption already has the recipe', async () => {
    acquiredPack = igPack('Lemon cake\n2 cups flour\n1 cup sugar\n2 eggs\nBake 30 minutes.');
    await run();
    expect(transcribePagesOnline).not.toHaveBeenCalled();
    expect(structurePack.mock.calls[0][0].slideText ?? null).toBeNull();
  });

  it('skips single-image posts', async () => {
    acquiredPack = igPack('The lemon cake everyone asks for', [SLIDES[0]]);
    await run();
    expect(transcribePagesOnline).not.toHaveBeenCalled();
  });

  it('carries on without slides when vision fails', async () => {
    acquiredPack = igPack('The lemon cake everyone asks for');
    transcribePagesOnline.mockRejectedValue(new Error('429'));
    await run();
    expect(structurePack).toHaveBeenCalledTimes(1);
    expect(structurePack.mock.calls[0][0].slideText ?? null).toBeNull();
  });

  it('ignores slides that are only dish photos', async () => {
    acquiredPack = igPack('The lemon cake everyone asks for');
    transcribePagesOnline.mockResolvedValue({ pages: [{ transcript: '' }], contentType: 'dish-photo', engine: 'gemini' });
    await run();
    expect(structurePack.mock.calls[0][0].slideText ?? null).toBeNull();
  });
});

describe('slide text in the prompt', () => {
  it('emits a labelled section after the caption', () => {
    const { sections, text } = buildPackSections({ caption: 'Lemon cake', slideText: SLIDE_TEXT });
    expect(sections).toEqual(['CAPTION', 'TEXT ON THE CAROUSEL SLIDES']);
    expect(text).toContain('2 cups flour');
  });

  it('survives the /api/structure request round-trip', () => {
    const pack = packFromRequestBody({ pack: { caption: 'Lemon cake', slideText: SLIDE_TEXT } });
    expect(pack.slideText).toBe(SLIDE_TEXT);
  });
});
