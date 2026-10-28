// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — static Discover catalog (sitemap-only drink sites).
// Pins scripts/build-discover-catalog.mjs's pure helpers and api/discover.js's
// catalog merge. No network: fetch is stubbed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SITES, parseSitemapLocs, pickClassics, spreadSample, ingredientName, postFromHtml,
} from '../../scripts/build-discover-catalog.mjs';
import handler, { loadCatalog } from '../../api/discover.js';
import { loadFixture } from './helpers.js';

const D = SITES.drinks.diffords;
const K = SITES.drinks.kindred;

describe('catalog builder — sitemap helpers', () => {
  it('parseSitemapLocs reads urlset <loc>s with or without whitespace/extra tags', () => {
    const xml = `<urlset><url><loc>https://a.example/x</loc><priority>0.8</priority></url>
      <url>
        <loc>https://a.example/y?z=1&amp;w=2</loc>
        <lastmod>2020-01-01</lastmod>
      </url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(['https://a.example/x', 'https://a.example/y?z=1&w=2']);
  });

  it('slugOf only accepts recipe pages for each site', () => {
    expect(D.slugOf('https://www.diffordsguide.com/cocktails/recipe/1392/negroni-cocktail')).toBe('negroni-cocktail');
    expect(D.slugOf('https://www.diffordsguide.com/cocktails/directory/styles/frozen')).toBeNull();
    expect(K.slugOf('https://kindredcocktails.com/cocktail/old-fashioned')).toBe('old-fashioned');
    expect(K.slugOf('https://kindredcocktails.com/review/all-the-gin-joints')).toBeNull();
  });

  it('pickClassics takes the canonical page and SKIPS names with only riffs', () => {
    const urls = [
      'https://www.diffordsguide.com/cocktails/recipe/28918/negroni-flip',
      'https://www.diffordsguide.com/cocktails/recipe/1392/negroni-cocktail',
      'https://www.diffordsguide.com/cocktails/recipe/4782/old-fashioned',
      'https://www.diffordsguide.com/cocktails/recipe/1428/old-fashioned-cocktail-muddled-fruit-version',
      'https://www.diffordsguide.com/cocktails/recipe/1267/martini-thyme',
    ];
    const picks = pickClassics(urls, D.slugOf, ['negroni', 'old-fashioned', 'martini']);
    expect(picks.map((p) => p.url)).toEqual([
      'https://www.diffordsguide.com/cocktails/recipe/1392/negroni-cocktail',
      'https://www.diffordsguide.com/cocktails/recipe/4782/old-fashioned',
    ]);
  });

  it('spreadSample is deterministic, bounded, and excludes picked URLs', () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://kindredcocktails.com/cocktail/drink-${String(i).padStart(3, '0')}`);
    const a = spreadSample(urls, 10, K.slugOf, new Set([urls[0]]));
    expect(a).toEqual(spreadSample([...urls].reverse(), 10, K.slugOf, new Set([urls[0]])));
    expect(a).toHaveLength(10);
    expect(a).not.toContain(urls[0]);
    expect(spreadSample(urls, 0, K.slugOf)).toEqual([]);
  });

  it('ingredientName strips quantity, unit and parentheticals', () => {
    expect(ingredientName('3 oz Bourbon (or rye)')).toBe('Bourbon');
    expect(ingredientName('1/2 oz Simple syrup')).toBe('Simple syrup');
    expect(ingredientName('3 ds Bitters, Angostura')).toBe('Bitters');
    expect(ingredientName('1 twst Lemon peel (as garnish)')).toBe('Lemon peel');
    expect(ingredientName('')).toBe('');
  });
});

describe('catalog builder — postFromHtml', () => {
  const site = { name: 'Lantern Row', emoji: '🥂' };

  it('RDFa page → card with ingredient NAMES only (no quantities, no method text)', () => {
    const p = postFromHtml(loadFixture('html', 'rdfa.html'), 'https://lanternrow.example.com/cocktail/smoked-maple-sour', 'lantern', site);
    expect(p.title).toBe('Smoked Maple Sour');
    expect(p.snippet).toMatch(/^Bourbon, Lemon juice, Maple syrup/);
    expect(p.snippet).not.toMatch(/\d|shaker|strain/i);
    expect(p.imageUrl).toBe('');
    expect(p).toMatchObject({ source: 'lantern', sourceName: 'Lantern Row', postType: 'recipe', pubDate: null });
  });

  it('JSON-LD page → card with hot-linked image and attribution suffix stripped', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Recipe', name: "Daiquiri (Difford's recipe)",
      image: 'https://cdn.example.com/daiquiri.webp',
      recipeIngredient: ['60 ml Light white rum', '25 ml Lime juice', '10 ml Sugar syrup'],
      recipeInstructions: ['Shake with ice.', 'Strain into a coupe.'],
    })}</script></head><body></body></html>`;
    const p = postFromHtml(html, 'https://x.example/daiquiri', 'diffords', site);
    expect(p.title).toBe('Daiquiri');
    expect(p.imageUrl).toBe('https://cdn.example.com/daiquiri.webp');
    expect(p.snippet).toBe('Light white rum, Lime juice, Sugar syrup');
  });

  it('page with no parseable recipe → null (never a hollow card)', () => {
    expect(postFromHtml(loadFixture('html', 'schemaless-blog.html'), 'https://x.example/', 'k', site)).toBeNull();
  });
});

describe('api/discover — static catalog merge', () => {
  const CATALOG = {
    sources: { diffords: { name: "Difford's Guide", emoji: '📚', tags: ['classic'] } },
    posts: [
      { title: 'Negroni Cocktail', link: 'https://www.diffordsguide.com/cocktails/recipe/1392/negroni-cocktail', imageUrl: '', snippet: 'Gin', pubDate: null, postType: 'recipe', categories: [], source: 'diffords', sourceName: "Difford's Guide", sourceEmoji: '📚' },
      { title: 'Evil', link: 'javascript:alert(1)', source: 'diffords' },
      { title: 'Orphan', link: 'https://x.example/o', source: 'not-a-source' },
    ],
  };
  const RSS = `<rss><channel><item><title>Rye Old Fashioned Tips</title><link>https://punchdrink.com/a</link><description>d</description></item></channel></rss>`;

  function stubFetch({ catalog = CATALOG, catalogAsHtml = false } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/discover/')) {
        return catalogAsHtml
          ? new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
          : new Response(JSON.stringify(catalog), { status: 200 });
      }
      return new Response(RSS, { status: 200 });
    }));
  }
  afterEach(() => vi.unstubAllGlobals());
  const call = (qs) => handler({ method: 'GET', url: `https://spicehub.test/api/discover?${qs}` });

  it('drinks feed includes catalog posts + sources, interleaved with RSS, bad entries dropped', async () => {
    stubFetch();
    const body = await (await call('kind=drinks')).json();
    expect(body.sources.diffords.name).toBe("Difford's Guide");
    expect(body.sources.punchdrink).toBeTruthy();
    const links = body.posts.map((p) => p.link);
    expect(links).toContain('https://www.diffordsguide.com/cocktails/recipe/1392/negroni-cocktail');
    expect(links).not.toContain('javascript:alert(1)');
    expect(body.posts.some((p) => p.source === 'not-a-source')).toBe(false);
    expect(new Set(body.posts.slice(0, 2).map((p) => p.source)).size).toBe(2);
  });

  it('?sources= can request a catalog-only source without a 400', async () => {
    stubFetch();
    const resp = await call('kind=drinks&sources=diffords');
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.posts.map((p) => p.source)).toEqual(['diffords']);
  });

  it('missing/HTML-rewritten catalog (meals today) degrades to RSS only', async () => {
    stubFetch({ catalogAsHtml: true });
    const resp = await call('kind=meals&sources=budgetbytes');
    expect(resp.status).toBe(200);
    expect((await resp.json()).posts[0].link).toBe('https://punchdrink.com/a');
    expect(await loadCatalog('https://spicehub.test/api/discover', 'meals')).toEqual({ sources: {}, posts: [] });
  });

  it('unknown source still 400s', async () => {
    stubFetch();
    expect((await call('kind=drinks&sources=nope')).status).toBe(400);
  });
});
