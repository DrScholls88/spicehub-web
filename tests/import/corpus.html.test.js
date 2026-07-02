// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — website HTML extraction (parseHtml)
// ─────────────────────────────────────────────────────────────────────────────
// Pins the no-network tiers: JSON-LD → microdata → plugin CSS → meta fallback.
// Every case is a sanitized replica of a real-world page structure.
import { describe, it, expect } from 'vitest';
import { parseHtml } from '../../src/recipeParser.js';
import { loadFixture, buildLongPageHtml, assertZeroJunk, assertCleanIngredients } from './helpers.js';

const CASES = [
  {
    id: 'jsonld-standard',
    url: 'https://thecopperwhisk.example.com/lemon-herb-chicken-orzo/',
    expect: { titleMatch: /lemon herb chicken orzo/i, minIngredients: 10, minDirections: 5, hasImage: true },
  },
  {
    id: 'jsonld-graph',
    url: 'https://emberandrind.example.com/gochujang-corn-ribs/',
    expect: { titleMatch: /gochujang butter corn ribs/i, minIngredients: 8, minDirections: 4, hasImage: true },
  },
  {
    id: 'wprm',
    url: 'https://saltfatacidmeat.example.com/smash-burger-tacos/',
    // JSON-LD is an EMPTY stub here — extraction must fall through to WPRM CSS.
    expect: { titleMatch: /smash burger tacos/i, minIngredients: 9, minDirections: 4 },
  },
  {
    id: 'tasty',
    url: 'https://crumbtheory.example.com/whipped-feta-flatbreads/',
    expect: { titleMatch: /whipped feta flatbreads/i, minIngredients: 8, minDirections: 4 },
  },
  {
    id: 'microdata',
    url: 'https://afamilytable.example.com/nanas-sunday-gravy/',
    expect: { titleMatch: /sunday gravy/i, minIngredients: 10, minDirections: 1, hasImage: true },
  },
];

describe('golden corpus — HTML fixtures → parseHtml', () => {
  for (const c of CASES) {
    it(`${c.id}: extracts a clean recipe`, () => {
      const html = loadFixture('html', `${c.id}.html`);
      const recipe = parseHtml(html, c.url);

      expect(recipe, `${c.id}: parseHtml returned null`).toBeTruthy();
      expect(recipe.name || recipe.title || '').toMatch(c.expect.titleMatch);
      expect(recipe.ingredients?.length ?? 0, `${c.id}: too few ingredients`).toBeGreaterThanOrEqual(c.expect.minIngredients);
      expect(recipe.directions?.length ?? 0, `${c.id}: too few directions`).toBeGreaterThanOrEqual(c.expect.minDirections);
      if (c.expect.hasImage) expect(recipe.imageUrl, `${c.id}: no image captured`).toBeTruthy();

      assertCleanIngredients(recipe.ingredients || [], c.id);
      assertZeroJunk({ ...recipe, title: recipe.name || recipe.title }, c.id);
    });
  }

  it('schemaless-blog: never fabricates a recipe from prose', () => {
    const html = loadFixture('html', 'schemaless-blog.html');
    const recipe = parseHtml(html, 'https://smallkitchen.example.com/vol-47/');
    // Meta-only fallback (title, no content) or null are both correct.
    // Fabricated ingredients/directions are the failure mode.
    if (recipe) {
      expect(recipe.ingredients?.length ?? 0, 'fabricated ingredients from prose').toBe(0);
      expect(recipe.directions?.length ?? 0, 'fabricated directions from prose').toBe(0);
    }
  });

  it('js-shell: returns null for client-rendered empty shells', () => {
    const html = loadFixture('html', 'js-shell.html');
    const recipe = parseHtml(html, 'https://spa-recipes.example.com/r/12345');
    if (recipe) {
      // If anything is returned it must be contentless (no fabrication).
      expect(recipe.ingredients?.length ?? 0).toBe(0);
      expect(recipe.directions?.length ?? 0).toBe(0);
    }
  });

  it('longpage: finds the recipe on a page far beyond the old 8K truncation limit', () => {
    const html = buildLongPageHtml();
    expect(html.length, 'long-page fixture must exceed 8K chars').toBeGreaterThan(12000);

    const recipe = parseHtml(html, 'https://thecopperwhisk.example.com/lemon-herb-chicken-orzo/');
    expect(recipe, 'long page: parseHtml returned null').toBeTruthy();
    expect(recipe.name || '').toMatch(/lemon herb chicken orzo/i);
    expect(recipe.ingredients?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(recipe.directions?.length ?? 0).toBeGreaterThanOrEqual(5);

    // Comment noise must not leak into the recipe.
    const all = [...(recipe.ingredients || []), ...(recipe.directions || [])].join(' ');
    expect(all).not.toMatch(/reader\d|Reply Share Report|swapped the/i);
  });
});
