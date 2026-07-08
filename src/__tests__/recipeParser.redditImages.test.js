import { describe, it, expect, vi, afterEach } from 'vitest';
import { importRecipeFromUrl } from '../recipeParser.js';

// Coverage for the 2026-07-08 "photos" fix: a Reddit import used to save the
// raw preview.redd.it/i.redd.it URL straight into the recipe, so the photo
// only ever rendered while online — unlike Instagram imports, which persist
// their photo(s) to data: URLs at import time (see importFromInstagram).
// persistRedditImages() in recipeParser.js now gives Reddit imports the same
// treatment, reusing the existing downloadImageAsDataUrl/persistCarousel
// helpers. These are integration-level tests (through the public
// importRecipeFromUrl entry point) because persistRedditImages itself isn't
// exported — it's an internal step of the Reddit import branch.

afterEach(() => vi.unstubAllGlobals());

const GALLERY_POST = {
  title: "Grandma's Chili",
  selftext:
    'Ingredients:\n- 1 lb beef\n- 1 can beans\n\nDirections:\n1. Brown the beef.\n2. Simmer for an hour.',
  url: 'https://www.reddit.com/r/recipes/comments/abc123/grandmas_chili/',
  is_gallery: true,
  gallery_data: { items: [{ media_id: 'a1' }, { media_id: 'a2' }] },
  media_metadata: {
    a1: { status: 'valid', s: { u: 'https://preview.redd.it/a1.jpg?s=sig1' } },
    a2: { status: 'valid', s: { u: 'https://preview.redd.it/a2.jpg?s=sig2' } },
  },
};

const listingJsonFor = (postData) => [
  { data: { children: [{ data: postData }] } },
  { data: { children: [] } },
];

/** Stubs fetch for: the Reddit .json listing, plus an image proxy that always
 * succeeds (simulating direct image fetches being blocked/hotlink-protected,
 * same as Instagram's CDN — the proxy cascade is the reliable path). */
function stubRedditAndImageProxy(postData) {
  let proxyCalls = 0;
  const fetchSpy = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('reddit.com') && u.includes('.json')) {
      return { ok: true, status: 200, json: async () => listingJsonFor(postData) };
    }
    if (u.includes('/api/proxy?mode=image-data-url')) {
      proxyCalls += 1;
      return { ok: true, status: 200, json: async () => ({ dataUrl: `data:image/jpeg;base64,IMG${proxyCalls}` }) };
    }
    // Direct image fetch — simulate the same kind of block Instagram CDN URLs
    // hit, forcing the proxy path (this is deliberately pessimistic: it
    // proves the fallback works, not just the happy path).
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

describe('Reddit import — photo persistence', () => {
  it('persists the hero photo to a data: URL instead of leaving a raw preview.redd.it link', async () => {
    stubRedditAndImageProxy(GALLERY_POST);

    const result = await importRecipeFromUrl(
      'https://www.reddit.com/r/recipes/comments/abc123/grandmas_chili/',
      () => {},
      { type: 'meal' },
    );

    expect(result.ingredients.length).toBeGreaterThan(0);
    expect(result.directions.length).toBeGreaterThan(0);
    expect(result.imageUrl).toMatch(/^data:image\//);
    expect(result._imageStatus).toBe('data-url');
  });

  it('persists every gallery photo into _carouselImages so the review screen can offer a cover picker', async () => {
    stubRedditAndImageProxy(GALLERY_POST);

    const result = await importRecipeFromUrl(
      'https://www.reddit.com/r/recipes/comments/abc123/grandmas_chili/',
      () => {},
      { type: 'meal' },
    );

    expect(Array.isArray(result._carouselImages)).toBe(true);
    expect(result._carouselImages.length).toBe(2);
    for (const img of result._carouselImages) {
      expect(img.dataUrl).toMatch(/^data:image\//);
    }
  });

  it('keeps the remote imageUrl (does not throw) when photo persistence fails entirely', async () => {
    const postData = {
      title: 'Weeknight Pasta',
      selftext: 'Ingredients:\n- pasta\n- sauce\n\nDirections:\n1. Boil pasta.\n2. Add sauce.',
      url: 'https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/',
      preview: { images: [{ source: { url: 'https://preview.redd.it/single.jpg?s=sig' } }] },
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('reddit.com') && u.includes('.json')) {
        return { ok: true, status: 200, json: async () => listingJsonFor(postData) };
      }
      // Every image-fetch path (direct + proxy) fails.
      throw new TypeError('Failed to fetch');
    }));

    const result = await importRecipeFromUrl(
      'https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/',
      () => {},
      { type: 'meal' },
    );

    expect(result.ingredients.length).toBeGreaterThan(0);
    expect(result.imageUrl).toBe('https://preview.redd.it/single.jpg?s=sig');
    expect(result._imageStatus).toBe('remote');
  });

  it('does not create a carousel for a single-photo post', async () => {
    const postData = {
      title: 'Weeknight Pasta',
      selftext: 'Ingredients:\n- pasta\n- sauce\n\nDirections:\n1. Boil pasta.\n2. Add sauce.',
      url: 'https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/',
      preview: { images: [{ source: { url: 'https://preview.redd.it/single.jpg?s=sig' } }] },
    };
    stubRedditAndImageProxy(postData);

    const result = await importRecipeFromUrl(
      'https://www.reddit.com/r/recipes/comments/def456/weeknight_pasta/',
      () => {},
      { type: 'meal' },
    );

    expect(result._carouselImages.length).toBe(1);
  });
});
