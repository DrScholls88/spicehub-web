// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — acquire forks return ContextPacks, not structured recipes.
//
// Each fork (blog, photo, reddit) acquires raw material into a ContextPack.
// None of them call captionToRecipe or structurePack — the engine structures.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContextPack } from '../../src/import/contextPack.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock photoImportEngine — acquireOnly returns raw OCR data
const mockImportRecipeFromPages = vi.fn();
vi.mock('../../src/lib/photoImportEngine.js', () => ({
  importRecipeFromPages: mockImportRecipeFromPages,
  PhotoImportError: class extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  },
}));

// Mock website acquire
const mockAcquireWebsitePack = vi.fn();
vi.mock('../../src/import/acquire/website.js', () => ({
  acquireWebsitePack: mockAcquireWebsitePack,
  extractEndpoint: () => '/api/extract',
  packFromExtractResponse: vi.fn(),
}));

// Mock reddit discovery
const mockExtractRedditPost = vi.fn();
vi.mock('../../src/scrapers/redditDiscovery.js', () => ({
  extractRedditPost: mockExtractRedditPost,
  isRedditPostUrl: (url) => /\/r\/\w+\/comments\//.test(url) || /redd\.it\//.test(url),
  isRedditUrl: (url) => /reddit\.com|redd\.it/i.test(url),
}));

// Mock fetchHtmlViaProxy (must also stub other api.js exports used transitively)
const mockFetchHtml = vi.fn();
vi.mock('../../src/api.js', () => ({
  fetchHtmlViaProxy: mockFetchHtml,
  fetchJsonViaProxy: vi.fn(),
  fetchInstagramViaApify: vi.fn(),
  fetchInstagramOEmbed: vi.fn(),
  fetchInstagramJson: vi.fn(),
  fetchInstagramJsonDetails: vi.fn(),
  extractInstagramEmbed: vi.fn(),
  normalizeInstagramUrl: (u) => u,
  cleanUrl: (u) => u,
  proxyImageUrl: (u) => u,
  isInstagramUrl: () => false,
  isInstagramCdnUrl: () => false,
  fetchWithRetry: vi.fn(),
  downloadImageAsDataUrl: vi.fn(),
}));

// Mock capHtml (pass through, capped)
vi.mock('../../src/lib/importGuards.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, capHtml: (html) => (html || '').slice(0, 2 * 1024 * 1024) };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── acquire/photo ──────────────────────────────────────────────────────────

describe('acquire/photo', () => {
  it('returns a ContextPack with caption, scanPages, and acquiredVia', async () => {
    const pages = [{ id: 'p1', dataUrl: 'data:image/png;base64,abc' }];
    mockImportRecipeFromPages.mockResolvedValue({
      transcript: 'Chicken Tikka Masala\n2 lbs chicken breast\n1 cup yogurt',
      uploadPages: ['data:image/png;base64,compressed'],
      _visionEngine: 'gemini',
      _ocrDraft: false,
      dishPhoto: { page: 1, box: [100, 100, 900, 900] },
      contentType: 'recipe',
      isDishPhotoOnly: false,
      visionError: null,
      _scanPageCount: 1,
    });

    const { acquirePhotoPack } = await import('../../src/import/acquire/photo.js');
    const pack = await acquirePhotoPack(pages, { kind: 'meal' });

    // Must have been called with acquireOnly: true
    expect(mockImportRecipeFromPages).toHaveBeenCalledWith(
      pages,
      expect.objectContaining({ acquireOnly: true }),
    );

    // Returns a ContextPack shape
    expect(pack).toBeTruthy();
    expect(pack.sourceType).toBe('photo');
    expect(pack.caption).toContain('Chicken Tikka');
    expect(pack.scanPages).toEqual(pages);
    expect(pack.onScreenText).toContain('Chicken Tikka');
    expect(pack.acquiredVia).toContain('photo:');
    // Must NOT contain structured recipe fields — the fork acquires only
    expect(pack.candidate).toBeNull();
  });

  it('returns null when OCR produces no transcript', async () => {
    mockImportRecipeFromPages.mockResolvedValue({ transcript: '' });
    const { acquirePhotoPack } = await import('../../src/import/acquire/photo.js');
    const pack = await acquirePhotoPack([{ id: 'p1', dataUrl: 'data:image/png;base64,x' }]);
    expect(pack).toBeNull();
  });

  it('does not import captionToRecipe or structurePack', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/import/acquire/photo.js', 'utf8');
    expect(src).not.toContain('captionToRecipe');
    expect(src).not.toContain('structurePack');
  });
});

// ── acquire/blog ───────────────────────────────────────────────────────────

describe('acquire/blog', () => {
  it('returns a ContextPack with html attached', async () => {
    mockAcquireWebsitePack.mockResolvedValue(createContextPack({
      sourceUrl: 'https://example-recipe.com/chicken',
      sourceType: 'website',
      title: 'Best Chicken Recipe',
      markdown: '# Best Chicken Recipe\nIngredients: 2 lbs chicken...',
      acquiredVia: 'server-extract',
      confidence: 0.5,
    }));
    mockFetchHtml.mockResolvedValue('<html><body><h1>Best Chicken Recipe</h1><p>Ingredients: 2 lbs chicken breast, 1 cup yogurt, 2 tbsp garam masala, 1 tsp turmeric, salt and pepper to taste. Preheat oven to 400F. AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</p></body></html>');

    const { acquireBlogPack } = await import('../../src/import/acquire/blog.js');
    const pack = await acquireBlogPack('https://example-recipe.com/chicken', {});

    expect(pack).toBeTruthy();
    expect(pack.sourceType).toBe('website');
    expect(pack.html).toContain('Best Chicken Recipe');
    expect(pack.markdown).toContain('Best Chicken');
    expect(pack.acquiredVia).toBe('server-extract');
  });

  it('still returns a pack when html fetch fails', async () => {
    mockAcquireWebsitePack.mockResolvedValue(createContextPack({
      sourceUrl: 'https://example.com/recipe',
      sourceType: 'website',
      title: 'A Recipe',
      markdown: 'Some content',
      acquiredVia: 'server-extract',
      confidence: 0.5,
    }));
    mockFetchHtml.mockRejectedValue(new Error('Network error'));

    const { acquireBlogPack } = await import('../../src/import/acquire/blog.js');
    const pack = await acquireBlogPack('https://example.com/recipe', {});

    expect(pack).toBeTruthy();
    expect(pack.html).toBeUndefined();
    expect(pack.markdown).toContain('Some content');
  });

  it('does not import captionToRecipe or structurePack', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/import/acquire/blog.js', 'utf8');
    expect(src).not.toContain('captionToRecipe');
    expect(src).not.toContain('structurePack');
  });
});

// ── acquire/reddit ─────────────────────────────────────────────────────────

describe('acquire/reddit', () => {
  it('returns a ContextPack for a text post', async () => {
    mockExtractRedditPost.mockResolvedValue({
      name: 'Amazing Pasta Recipe',
      rawText: 'Amazing Pasta Recipe\n\nIngredients:\n- 1 lb pasta\n- 2 tbsp olive oil\n\nDirections:\n1. Boil water...',
      imageUrl: 'https://i.redd.it/hero.jpg',
      images: ['https://i.redd.it/hero.jpg'],
      link: 'https://www.reddit.com/r/recipes/comments/abc123/amazing_pasta_recipe/',
      _extractedVia: 'reddit-json',
      _isMarkdown: true,
    });

    const { acquireRedditPack } = await import('../../src/import/acquire/reddit.js');
    const pack = await acquireRedditPack(
      'https://www.reddit.com/r/recipes/comments/abc123/amazing_pasta_recipe/',
      {},
    );

    expect(pack).toBeTruthy();
    expect(pack.sourceType).toBe('reddit');
    expect(pack.markdown).toContain('Amazing Pasta');
    expect(pack.images).toHaveLength(1);
    expect(pack.images[0].kind).toBe('hero');
    expect(pack.acquiredVia).toBe('reddit-json');
    expect(pack.title).toBe('Amazing Pasta Recipe');
  });

  it('nests into blog acquire for link-posts', async () => {
    mockExtractRedditPost.mockResolvedValue({
      name: 'Check out this recipe',
      rawText: 'Check out this recipe',
      imageUrl: 'https://i.redd.it/thumb.jpg',
      images: ['https://i.redd.it/thumb.jpg'],
      link: 'https://example-recipe-blog.com/pasta',
      _extractedVia: 'reddit-json',
    });
    mockAcquireWebsitePack.mockResolvedValue(createContextPack({
      sourceUrl: 'https://example-recipe-blog.com/pasta',
      sourceType: 'website',
      title: 'Pasta Recipe',
      markdown: '# Pasta Recipe\nIngredients...',
      acquiredVia: 'server-extract',
      confidence: 0.5,
    }));
    mockFetchHtml.mockResolvedValue('<html><body>Pasta Recipe</body></html>');

    const { acquireRedditPack } = await import('../../src/import/acquire/reddit.js');
    const pack = await acquireRedditPack(
      'https://www.reddit.com/r/recipes/comments/abc123/check_out/',
      {},
    );

    expect(pack).toBeTruthy();
    // Source URL preserved as the reddit post
    expect(pack.sourceUrl).toBe('https://www.reddit.com/r/recipes/comments/abc123/check_out/');
    // Blog content acquired via nested acquireBlogPack
    expect(mockAcquireWebsitePack).toHaveBeenCalledWith(
      'https://example-recipe-blog.com/pasta',
      expect.anything(),
    );
    expect(pack.title).toBe('Pasta Recipe');
  });

  it('falls back to text post when blog acquire fails for link-post', async () => {
    mockExtractRedditPost.mockResolvedValue({
      name: 'Check this recipe',
      rawText: 'Check this recipe',
      imageUrl: '',
      images: [],
      link: 'https://dead-blog.com/recipe',
      _extractedVia: 'reddit-json',
    });
    mockAcquireWebsitePack.mockResolvedValue(null);

    const { acquireRedditPack } = await import('../../src/import/acquire/reddit.js');
    const pack = await acquireRedditPack(
      'https://www.reddit.com/r/recipes/comments/abc123/check/',
      {},
    );

    // Falls back to text — gets the reddit text even though it's short
    expect(pack).toBeTruthy();
    expect(pack.sourceType).toBe('reddit');
    expect(pack.markdown).toBe('Check this recipe');
  });

  it('does not import captionToRecipe or structurePack', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/import/acquire/reddit.js', 'utf8');
    expect(src).not.toContain('captionToRecipe');
    expect(src).not.toContain('structurePack');
  });
});

// ── engine.js detectAcquireFork ────────────────────────────────────────────

describe('engine detectAcquireFork', () => {
  it('routes reddit URLs to the reddit fork', async () => {
    const { detectAcquireFork } = await import('../../src/import/engine.js');
    expect(detectAcquireFork('https://www.reddit.com/r/recipes/comments/abc123/test/')).toBe('reddit');
    expect(detectAcquireFork('https://old.reddit.com/r/Cooking/comments/xyz/')).toBe('reddit');
    expect(detectAcquireFork('https://redd.it/abc123')).toBe('reddit');
  });

  it('still routes non-reddit URLs correctly', async () => {
    const { detectAcquireFork } = await import('../../src/import/engine.js');
    expect(detectAcquireFork('https://www.instagram.com/reel/abc/')).toBe('instagram');
    expect(detectAcquireFork('https://www.pinterest.com/pin/123/')).toBe('pinterest');
    expect(detectAcquireFork('https://example.com/recipe')).toBe('website');
  });
});
