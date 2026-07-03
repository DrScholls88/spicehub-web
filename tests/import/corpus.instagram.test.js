// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — acquire/instagram.js (injected fetchers, no network) and
// src/import/images.js (carousel persistence + hero gate, stubbed vision).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireInstagramPack, instagramShortcode } from '../../src/import/acquire/instagram.js';
import {
  gateImageHeuristics,
  persistCarousel,
  selectHeroImage,
  visionValidateDishPhoto,
  MAX_CAROUSEL,
} from '../../src/import/images.js';
import { loadFixture } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const IG_URL = 'https://www.instagram.com/reel/DCorpusReel1/';
const CAPTION = loadFixture('captions', 'ig-clean-structured.txt');

const failing = async () => { throw new Error('down'); };
const never = () => new Promise(() => {}); // pending forever — Promise.any must not hang on winners

function fetchers(overrides = {}) {
  return {
    apify: failing,
    oembed: failing,
    igJson: failing,
    igJsonDetails: failing,
    serverExtract: async () => null,
    ...overrides,
  };
}

describe('acquire/instagram — the race', () => {
  it('apify win: caption + carousel images + provenance', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({
        apify: async () => ({
          caption: CAPTION,
          displayUrl: 'https://scontent.cdninstagram.com/v/t51/hero.jpg',
          images: [
            'https://scontent.cdninstagram.com/v/t51/slide2.jpg',
            'https://scontent.cdninstagram.com/v/t51/slide3.jpg',
          ],
          ownerFullName: 'Noodle Ninja',
        }),
        oembed: never,
        igJsonDetails: never,
      }),
    });
    expect(pack).toBeTruthy();
    expect(pack.sourceType).toBe('instagram');
    expect(pack.acquiredVia).toBe('apify');
    expect(pack.caption).toMatch(/CRISPY CHILI GARLIC NOODLES/);
    expect(pack.images.length).toBe(3);
    expect(pack.images[0].kind).toBe('hero');
    expect(pack.images[1].kind).toBe('carousel');
    expect(pack.title).toBe('Noodle Ninja');
    expect(pack.provenance.some((p) => p.field === 'caption' && p.via === 'apify')).toBe(true);
  });

  it('oembed win when apify fails', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({
        oembed: async () => ({
          html: `<blockquote><p>${CAPTION.split('\n').join(' ')}</p></blockquote>`,
          author_name: 'noodle.ninja.eats',
        }),
      }),
    });
    expect(pack.acquiredVia).toBe('oembed');
    expect(pack.caption).toMatch(/rice noodles/i);
  });

  it('ig-json win via shortcode details', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({
        igJsonDetails: async (sc) => {
          expect(sc).toBe('DCorpusReel1');
          return { caption: CAPTION, imageUrl: 'https://scontent.cdninstagram.com/x.jpg', title: 'Reel Title' };
        },
      }),
    });
    expect(pack.acquiredVia).toBe('ig-json');
    expect(pack.images[0].url).toMatch(/x\.jpg/);
  });

  it('server /api/extract is the FALLBACK when the race fails', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({
        serverExtract: async () => ({
          ok: true,
          acquiredVia: 'ig-embed',
          caption: CAPTION,
          images: ['https://scontent.cdninstagram.com/embed-hero.jpg'],
          meta: { title: '' },
        }),
      }),
    });
    expect(pack.acquiredVia).toBe('ig-embed');
    expect(pack.caption).toMatch(/chili crisp/i);
  });

  it('weak captions lose the race; total miss returns null', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({
        apify: async () => ({ caption: 'yum!', displayUrl: '' }), // ≤30 chars → weak
      }),
    });
    expect(pack).toBeNull();
  });

  it('never throws when everything is down', async () => {
    const pack = await acquireInstagramPack(IG_URL, {
      fetchers: fetchers({ serverExtract: failing }),
    });
    expect(pack).toBeNull();
  });

  it('instagramShortcode parses p/reel/reels/tv', () => {
    expect(instagramShortcode('https://instagram.com/reels/AbC_123/')).toBe('AbC_123');
    expect(instagramShortcode('https://instagram.com/tv/XyZ/')).toBe('XyZ');
    expect(instagramShortcode('https://instagram.com/explore/')).toBeNull();
  });
});

describe('images — heuristic gate', () => {
  it('rejects profile pics, logos, sprites, tiny thumbs', () => {
    expect(gateImageHeuristics('https://scontent.cdninstagram.com/v/profile_pic/me.jpg')).toBe('reject');
    expect(gateImageHeuristics('https://site.example.com/assets/logo-dark.png')).toBe('reject');
    expect(gateImageHeuristics('https://site.example.com/img/sprite.png')).toBe('reject');
    expect(gateImageHeuristics('https://scontent.cdninstagram.com/v/s150x150/thumb.jpg')).toBe('reject');
    expect(gateImageHeuristics('')).toBe('reject');
  });

  it('accepts CDN food shots and data URLs', () => {
    expect(gateImageHeuristics('https://scontent.cdninstagram.com/v/t51/dish.jpg')).toBe('accept');
    expect(gateImageHeuristics('https://blog.example.com/wp-content/uploads/2026/06/tacos.jpg')).toBe('accept');
    expect(gateImageHeuristics('data:image/jpeg;base64,AAAA')).toBe('accept');
  });

  it('unknown hosts are unsure (vision-gate candidates)', () => {
    expect(gateImageHeuristics('https://mystery.example.com/x/y.jpg')).toBe('unsure');
  });
});

describe('images — persistCarousel', () => {
  const persistOk = async (url) => `data:image/jpeg;base64,${Buffer.from(url).toString('base64').slice(0, 12)}`;

  it('persists up to MAX_CAROUSEL, drops rejects and dupes', async () => {
    const urls = [
      'https://scontent.cdninstagram.com/1.jpg',
      'https://scontent.cdninstagram.com/1.jpg', // dupe
      'https://scontent.cdninstagram.com/profile_pic/skip.jpg', // reject
      'https://scontent.cdninstagram.com/2.jpg',
      'https://scontent.cdninstagram.com/3.jpg',
      'https://scontent.cdninstagram.com/4.jpg',
      'https://scontent.cdninstagram.com/5.jpg',
      'https://scontent.cdninstagram.com/6.jpg',
      'https://scontent.cdninstagram.com/7.jpg', // over cap
    ];
    const out = await persistCarousel(urls, persistOk);
    expect(out.length).toBe(MAX_CAROUSEL);
    expect(out.every((c) => c.dataUrl.startsWith('data:image/'))).toBe(true);
    expect(out.some((c) => c.url.includes('profile_pic'))).toBe(false);
  });

  it('keeps the URL when persistence fails (proxy tiers handle display)', async () => {
    const out = await persistCarousel(['https://scontent.cdninstagram.com/a.jpg'], async () => { throw new Error('403'); });
    expect(out.length).toBe(1);
    expect(out[0].url).toMatch(/a\.jpg/);
    expect(out[0].dataUrl).toBe('');
  });
});

describe('images — selectHeroImage + vision gate', () => {
  const DATA_URL = 'data:image/jpeg;base64,QUJD';
  const persistOk = async () => DATA_URL;

  function stubVision(answer) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: answer }] } }] }),
    })));
  }

  it('no vision: returns the heuristic front-runner persisted', async () => {
    const hero = await selectHeroImage(
      ['https://mystery.example.com/frame.jpg', 'https://scontent.cdninstagram.com/dish.jpg'],
      { persistFn: persistOk, useVision: false },
    );
    // CDN accept outranks unsure mystery host.
    expect(hero.url).toMatch(/dish\.jpg/);
    expect(hero.dataUrl).toBe(DATA_URL);
    expect(hero.gated).toBe('heuristic');
  });

  it('vision YES keeps the front-runner', async () => {
    stubVision('YES');
    const hero = await selectHeroImage(['https://scontent.cdninstagram.com/dish.jpg'], {
      persistFn: persistOk, useVision: true, clientKey: 'k',
    });
    expect(hero.gated).toBe('vision');
    expect(hero.url).toMatch(/dish\.jpg/);
  });

  it('vision NO falls to the next candidate without a second vision spend', async () => {
    stubVision('NO');
    const hero = await selectHeroImage(
      ['https://scontent.cdninstagram.com/textcard.jpg', 'https://scontent.cdninstagram.com/dish2.jpg'],
      { persistFn: persistOk, useVision: true, clientKey: 'k' },
    );
    expect(hero.url).toMatch(/dish2\.jpg/);
    expect(hero.gated).toBe('vision');
  });

  it('vision check failure is optimistic (keeps the image)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const hero = await selectHeroImage(['https://scontent.cdninstagram.com/dish.jpg'], {
      persistFn: persistOk, useVision: true, clientKey: 'k',
    });
    expect(hero).toBeTruthy();
    expect(hero.gated).toBe('optimistic');
  });

  it('visionValidateDishPhoto returns null without key or bytes', async () => {
    expect(await visionValidateDishPhoto('', { clientKey: 'k' })).toBeNull();
    expect(await visionValidateDishPhoto(DATA_URL, { clientKey: '' })).toBeNull();
  });

  it('empty candidate list returns null', async () => {
    expect(await selectHeroImage([], { persistFn: persistOk })).toBeNull();
  });
});
