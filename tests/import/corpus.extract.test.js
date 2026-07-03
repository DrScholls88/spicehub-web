// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — /api/extract server-side parsing (pure helpers, no network).
// Dogfoods the same HTML fixtures used for the client tiers, so the server and
// client extraction paths are pinned against identical real-world structures.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  extractFromHtml,
  extractJsonLdRecipes,
  jsonLdToCandidate,
  extractMicrodataCandidate,
  isolateMainContent,
  humanizeDuration,
  extractInstagramShortcode,
  parseEmbedCaption,
  checkRateLimit,
} from '../../api/extract.js';
import { loadFixture, buildLongPageHtml, assertZeroJunk } from './helpers.js';

describe('api/extract — JSON-LD extraction', () => {
  it('jsonld-standard: full candidate with humanized times and image', () => {
    const html = loadFixture('html', 'jsonld-standard.html');
    const r = extractFromHtml(html, 'https://thecopperwhisk.example.com/lemon-herb-chicken-orzo/');
    expect(r.acquiredVia).toBe('json-ld');
    expect(r.candidate.name).toMatch(/lemon herb chicken orzo/i);
    expect(r.candidate.ingredients.length).toBe(11);
    expect(r.candidate.directions.length).toBe(6);
    expect(r.candidate.imageUrl).toMatch(/lemon-orzo-hero/);
    expect(r.candidate.totalTime).toBe('35 min');
    expect(r.candidate.recipeYield).toMatch(/4 servings/);
    assertZeroJunk({ title: r.candidate.name, ingredients: r.candidate.ingredients, directions: r.candidate.directions }, 'extract jsonld-standard');
  });

  it('jsonld-graph: finds the Recipe inside @graph', () => {
    const html = loadFixture('html', 'jsonld-graph.html');
    const r = extractFromHtml(html, 'https://emberandrind.example.com/gochujang-corn-ribs/');
    expect(r.acquiredVia).toBe('json-ld');
    expect(r.candidate.name).toMatch(/gochujang butter corn ribs/i);
    expect(r.candidate.ingredients.length).toBe(9);
    expect(r.candidate.directions.length).toBe(5);
  });

  it('wprm: empty JSON-LD stub is NOT accepted as a candidate', () => {
    const html = loadFixture('html', 'wprm.html');
    const r = extractFromHtml(html, 'https://saltfatacidmeat.example.com/smash-burger-tacos/');
    // The stub has no content — server must not return it as a candidate;
    // markdown still carries the WPRM markup content for the AI tier.
    expect(r.candidate).toBeNull();
    expect(r.jsonLd).toBeTruthy();             // kept as context
    expect(r.markdown).toMatch(/ground beef/i); // content survives isolation
    expect(r.markdown).toMatch(/special sauce/i);
  });

  it('longpage: JSON-LD found regardless of page size; comments dropped from markdown', () => {
    const html = buildLongPageHtml();
    const r = extractFromHtml(html, 'https://thecopperwhisk.example.com/lemon-herb-chicken-orzo/');
    expect(r.acquiredVia).toBe('json-ld');
    expect(r.candidate.ingredients.length).toBe(11);
    expect(r.markdown).not.toMatch(/reader\d|Reply Share Report/);
  });
});

describe('api/extract — microdata extraction', () => {
  it('microdata: candidate from itemprop markup', () => {
    const html = loadFixture('html', 'microdata.html');
    const r = extractFromHtml(html, 'https://afamilytable.example.com/nanas-sunday-gravy/');
    expect(r.acquiredVia).toBe('microdata');
    expect(r.candidate.name).toMatch(/sunday gravy/i);
    expect(r.candidate.ingredients.length).toBe(11);
    expect(r.candidate.directions.length).toBeGreaterThanOrEqual(1);
    expect(r.candidate.imageUrl).toMatch(/sunday-gravy/);
  });

  it('extractMicrodataCandidate returns null when no Recipe itemtype exists', () => {
    expect(extractMicrodataCandidate(loadFixture('html', 'schemaless-blog.html'))).toBeNull();
  });
});

describe('api/extract — content isolation & fallbacks', () => {
  it('schemaless-blog: og-meta only, no fabricated candidate, prose preserved', () => {
    const html = loadFixture('html', 'schemaless-blog.html');
    const r = extractFromHtml(html, 'https://smallkitchen.example.com/vol-47/');
    expect(r.candidate).toBeNull();
    expect(r.acquiredVia).toBe('og-meta');
    expect(r.meta.title).toMatch(/what i cooked this week/i);
    expect(r.markdown).toMatch(/fridge risotto/i);
  });

  it('js-shell: nothing extractable, markdown near-empty', () => {
    const html = loadFixture('html', 'js-shell.html');
    const r = extractFromHtml(html, 'https://spa-recipes.example.com/r/12345');
    expect(r.candidate).toBeNull();
    expect((r.markdown || '').length).toBeLessThan(200);
  });

  it('isolateMainContent strips nav/footer chrome from a full page', () => {
    const md = isolateMainContent(loadFixture('html', 'jsonld-standard.html'));
    expect(md).not.toMatch(/Shop My Kitchen/);
    expect(md).not.toMatch(/© 2026 The Copper Whisk/);
    expect(md).toMatch(/If February had a flavor/);
  });
});

describe('api/extract — small helpers', () => {
  it('humanizeDuration converts ISO-8601 and passes through text', () => {
    expect(humanizeDuration('PT35M')).toBe('35 min');
    expect(humanizeDuration('PT1H35M')).toBe('1 hr 35 min');
    expect(humanizeDuration('P1DT2H')).toBe('1 day 2 hr');
    expect(humanizeDuration('45 minutes')).toBe('45 minutes');
    expect(humanizeDuration('')).toBe('');
  });

  it('extractInstagramShortcode handles p/reel/tv URLs', () => {
    expect(extractInstagramShortcode('https://www.instagram.com/reel/DAbCd12eFgH/?igsh=x')).toBe('DAbCd12eFgH');
    expect(extractInstagramShortcode('https://www.instagram.com/p/C9xYz/')).toBe('C9xYz');
    expect(extractInstagramShortcode('https://www.instagram.com/someuser/')).toBeNull();
  });

  it('parseEmbedCaption reads the embed Caption div', () => {
    const html = '<div class="Caption"><a href="/u/">user</a> Creamy garlic pasta<br>1 lb spaghetti<br>4 cloves garlic, sliced thin</div>';
    const cap = parseEmbedCaption(html);
    expect(cap).toMatch(/Creamy garlic pasta/);
    expect(cap).toMatch(/4 cloves garlic/);
  });

  it('checkRateLimit allows a burst then blocks', () => {
    const now = Date.now();
    const ip = 'corpus-test-ip-' + Math.random();
    for (let i = 0; i < 40; i++) expect(checkRateLimit(ip, now)).toBe(true);
    expect(checkRateLimit(ip, now)).toBe(false);
  });

  it('jsonLdToCandidate survives HowToSection nesting and string instructions', () => {
    const c = jsonLdToCandidate({
      name: 'Nested Steps',
      recipeIngredient: ['1 cup rice'],
      recipeInstructions: [
        { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Rinse the rice.' }] },
        'Simmer covered 15 minutes.',
      ],
    });
    expect(c.directions).toEqual(['Rinse the rice.', 'Simmer covered 15 minutes.']);
  });

  it('extractJsonLdRecipes tolerates trailing commas', () => {
    const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Lenient","recipeIngredient":["1 egg",],}</script>';
    const nodes = extractJsonLdRecipes(html);
    expect(nodes.length).toBe(1);
    expect(nodes[0].name).toBe('Lenient');
  });
});
