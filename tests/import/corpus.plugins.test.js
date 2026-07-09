// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — server-side WordPress recipe-plugin extraction (cheerio).
// Pins WPRM / Tasty parsing and the extractFromHtml promotion path. Offline.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { extractPluginCandidate } from '../../src/import/pluginExtractors.js';
import { extractFromHtml } from '../../api/extract.js';

const WPRM_HTML = `
<html><body>
<div class="wprm-recipe" data-wprm-recipe>
  <h2 class="wprm-recipe-name">Test Skillet Chicken</h2>
  <ul>
    <li class="wprm-recipe-ingredient">2 chicken breasts</li>
    <li class="wprm-recipe-ingredient">1 cup rice</li>
    <li class="wprm-recipe-ingredient">2 cups broth</li>
  </ul>
  <ul>
    <li class="wprm-recipe-instruction">Sear the chicken.</li>
    <li class="wprm-recipe-instruction">Add rice and broth; simmer 15 min.</li>
  </ul>
  <div class="wprm-recipe-image"><img src="https://img.example.com/hero.jpg" /></div>
</div>
</body></html>`;

const TASTY_HTML = `
<html><body>
<div class="tasty-recipes" data-tasty-recipe>
  <h1 itemprop="name" class="tasty-recipes-title">Tasty Pancakes</h1>
  <div class="tasty-recipes-ingredients"><ul>
    <li class="tasty-recipe-ingredient">1 cup flour</li>
    <li class="tasty-recipe-ingredient">1 egg</li>
  </ul></div>
  <div class="tasty-recipes-instructions"><ol>
    <li>Whisk the batter together.</li>
    <li>Cook on a hot griddle.</li>
  </ol></div>
</div>
</body></html>`;

describe('server plugin extractors (cheerio)', () => {
  it('extracts a WPRM card', () => {
    const c = extractPluginCandidate(WPRM_HTML);
    expect(c).toBeTruthy();
    expect(c._pluginType).toBe('wprm');
    expect(c.name).toBe('Test Skillet Chicken');
    expect(c.ingredients).toHaveLength(3);
    expect(c.directions).toHaveLength(2);
    expect(c.imageUrl).toBe('https://img.example.com/hero.jpg');
  });

  it('extracts a Tasty Recipes card', () => {
    const c = extractPluginCandidate(TASTY_HTML);
    expect(c._pluginType).toBe('tasty');
    expect(c.ingredients).toContain('1 cup flour');
    expect(c.directions.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null when no plugin card is present', () => {
    expect(extractPluginCandidate('<html><body><p>no recipe here</p></body></html>')).toBeNull();
    expect(extractPluginCandidate('')).toBeNull();
    expect(extractPluginCandidate(null)).toBeNull();
  });

  it('extractFromHtml promotes a plugin card when structured data is absent', () => {
    const out = extractFromHtml(WPRM_HTML, 'https://blog.example.com/chicken/');
    expect(out.acquiredVia).toBe('plugin:wprm');
    expect(out.candidate.ingredients).toHaveLength(3);
    expect(out.candidate.name).toBe('Test Skillet Chicken');
  });
});
