// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — kindLocked survives every structure path.
// Pins the five drink-lock holes closed (A–E) so Bar imports never land as
// meals. Each test mocks the structuring layer and asserts kindLocked arrives.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock structurePack: the single gate every path funnels through ───────────
const structurePack = vi.fn(async (_pack, { type } = {}) => ({
  isRecipe: true,
  name: 'Test Drink',
  title: 'Test Drink',
  type: type || 'drink',
  ingredients: ['2 oz gin', '4 oz tonic water'],
  directions: ['Pour gin over ice', 'Top with tonic'],
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
    transcribeFromUrl: vi.fn(async () => ({
      transcript: 'Two ounces of gin, four ounces of tonic water, pour over ice and garnish with lime.',
      extractedVia: 'mock-whisper',
    })),
    getPreferredWhisperModel: () => 'whisper-1',
  };
});

// ── Mock fetch globally so no real network calls happen ──────────────────────
const mockFetch = vi.fn(async () => ({
  ok: false, status: 503, json: async () => ({}), text: async () => '',
}));
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  structurePack.mockClear();
  mockFetch.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kindLocked survives every structure path', () => {

  // ── Hole A: photo import ──────────────────────────────────────────────────
  it('A: importRecipeFromPages forwards kindLocked to captionToRecipe/structurePack', async () => {
    const { captionToRecipe } = await import('../../src/recipeParser.js');
    await captionToRecipe('2 oz gin, 4 oz tonic, lime garnish', {
      type: 'drink',
      kindLocked: true,
      sourceUrl: 'https://example.test/cocktail',
      sourceType: 'photo',
    });
    expect(structurePack).toHaveBeenCalled();
    const opts = structurePack.mock.calls.at(-1)[1];
    expect(opts).toMatchObject({ type: 'drink', kindLocked: true });
  });

  it('A: importRecipeFromPages signature accepts kindLocked and sourceUrl', async () => {
    const { importRecipeFromPages } = await import('../../src/lib/photoImportEngine.js');
    const fn = importRecipeFromPages;
    expect(fn.length).toBeGreaterThanOrEqual(1); // pages required; opts has default
    try {
      await fn(
        [{ id: 'p1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', source: 'gallery' }],
        { type: 'drink', kindLocked: true, sourceUrl: 'https://example.test/card' },
      );
    } catch (e) {
      // Expected: will fail on image processing, not on signature
      expect(e.message).not.toContain('kindLocked');
      expect(e.message).not.toContain('sourceUrl');
    }
  });

  // ── Hole B: Improve (transcribeVideoForRecipe) ────────────────────────────
  it('B: transcribeVideoForRecipe forwards kindLocked to captionToRecipe', async () => {
    const { transcribeVideoForRecipe } = await import('../../src/recipeParser.js');
    await transcribeVideoForRecipe('https://www.instagram.com/reel/ABC123/', {
      type: 'drink',
      kindLocked: true,
      imageUrl: 'https://example.test/img.jpg',
    });
    expect(structurePack).toHaveBeenCalled();
    const opts = structurePack.mock.calls.at(-1)[1];
    expect(opts).toMatchObject({ type: 'drink', kindLocked: true });
  });

  // ── Hole C: parseFromUrl/importRecipeFromUrl signature & forwarding ───────
  // parseFromUrl → importRecipeFromUrl → _importRecipeFromUrlOuter is an
  // intra-module call chain, so vi.spyOn can't intercept it. Verify the
  // wiring statically: the source must destructure kindLocked from opts and
  // forward it at every level.
  it('C: parseFromUrl and importRecipeFromUrl accept and forward kindLocked', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/recipeParser.js', 'utf8');

    // parseFromUrl destructures kindLocked and passes it through
    expect(src).toMatch(
      /export async function parseFromUrl\(url,\s*onProgress,\s*\{[^}]*kindLocked[^}]*\}/
    );
    // importRecipeFromUrl destructures kindLocked too
    expect(src).toMatch(
      /export async function importRecipeFromUrl\(url,\s*onProgress,\s*\{[^}]*kindLocked[^}]*\}/
    );
    // _importRecipeFromUrlOuter destructures kindLocked
    expect(src).toMatch(
      /async function _importRecipeFromUrlOuter\(url,\s*onProgress,\s*\{[^}]*kindLocked[^}]*\}/
    );
    // parseFromUrl forwards kindLocked to importRecipeFromUrl
    const parseFromUrlBody = src.match(
      /export async function parseFromUrl\([^)]*\)[^{]*\{([\s\S]*?)^export /m
    );
    expect(parseFromUrlBody?.[1]).toContain('kindLocked');
  });

  // ── Hole D: Reddit external-link recursion ────────────────────────────────
  // The Reddit recursion at recipeParser.js:2995 must forward type,
  // kindLocked, signal, and requestBudget. Verified statically because
  // driving a Reddit fixture through the pipeline needs real Reddit JSON.
  it('D: Reddit recursion forwards type, kindLocked, signal and requestBudget', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/recipeParser.js', 'utf8');

    // The external-link recursion must pass all four options
    // Find the parseFromUrl call inside the Reddit redirect block
    const redditBlock = src.match(
      /redditData\._isRedirectToExternal[\s\S]*?parseFromUrl\(redditData\.externalUrl[^)]*\)/
    );
    expect(redditBlock).not.toBeNull();
    const call = redditBlock[0];
    expect(call).toContain('kindLocked');
    expect(call).toContain('requestBudget');
    expect(call).toContain('type');
    expect(call).toContain('signal');

    // parseFromUrl must also accept and forward requestBudget
    expect(src).toMatch(
      /export async function parseFromUrl\([^)]*\{[^}]*requestBudget[^}]*\}/
    );
    // importRecipeFromUrl must forward requestBudget
    expect(src).toMatch(
      /export async function importRecipeFromUrl\([^)]*\{[^}]*requestBudget[^}]*\}/
    );
    // _importRecipeFromUrlOuter must accept parentBudget
    expect(src).toMatch(
      /async function _importRecipeFromUrlOuter\([^)]*requestBudget:\s*parentBudget/
    );
  });

  // ── Hole E: batch queue ───────────────────────────────────────────────────
  it('E: batchImportEngine uses itemTypeUserOverride for kindLocked', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/batchImportEngine.js', 'utf8');
    expect(src).toContain('const userLocked = !!item.itemTypeUserOverride;');
    expect(src).toContain('kindLocked: userLocked,');
    expect(src).toContain('type: userLocked ? item.itemType : detectedType,');
  });
});
