// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — shared helpers
// ─────────────────────────────────────────────────────────────────────────────
// The zero-junk contract lives HERE and only here. When the import engine
// refactor lands (src/import/), acquisition-time cleaning and the Gemini
// system instruction must import/mirror this exact list. Tests, cleaning,
// and prompting all agree on what "junk" means.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(__dirname, 'fixtures');

export function loadFixture(...segments) {
  return readFileSync(join(FIXTURES, ...segments), 'utf8');
}

export function loadJsonFixture(...segments) {
  return JSON.parse(loadFixture(...segments));
}

// ── Zero-junk contract ───────────────────────────────────────────────────────
// SINGLE SOURCE: src/import/junk.js. The engine's acquisition-time cleaning,
// the post-structuring enforcer, and these test assertions all share one list.
export { JUNK_PATTERNS, findJunk } from '../../src/import/junk.js';
import { findJunk } from '../../src/import/junk.js';

/** Assert a final recipe object contains zero junk across all text surfaces. */
export function assertZeroJunk(recipe, label = '') {
  const surfaces = [
    ['title', recipe.title ?? recipe.name ?? ''],
    ...(recipe.ingredients || []).map((i, n) => [`ingredients[${n}]`, i]),
    ...(recipe.directions  || []).map((d, n) => [`directions[${n}]`, d]),
  ];
  const notes = recipe.notes;
  if (typeof notes === 'string') surfaces.push(['notes', notes]);
  else if (Array.isArray(notes)) notes.forEach((nt, n) => surfaces.push([`notes[${n}]`, typeof nt === 'string' ? nt : `${nt?.title || ''} ${nt?.text || ''}`]));

  for (const [where, text] of surfaces) {
    const junk = findJunk(text);
    expect(junk, `${label} ${where} contains junk (${junk?.pattern}): "${junk?.match}" in "${String(text).slice(0, 120)}"`).toBeNull();
  }
}

// ── Structural sanity helpers (shared with existing regression corpus) ──────
const STARTS_WITH_VERB = /^(mix|stir|add|combine|pour|heat|cook|bake|preheat|whisk|blend|fold|season|serve|place|simmer|boil|toss|drizzle|sprinkle|garnish|melt|beat|knead|spread|layer|brush|sear|steam|roast|fry)\b/i;
const BARE_HEADER = /^(ingredients?|directions?|instructions?|method|steps?|preparation|notes?)\s*:?\s*$/i;

export function assertCleanIngredients(ingredients, label = '') {
  for (const ing of ingredients) {
    expect(ing, `${label} ingredient starts with cooking verb: "${ing}"`).not.toMatch(STARTS_WITH_VERB);
    expect(ing, `${label} ingredient is a bare header: "${ing}"`).not.toMatch(BARE_HEADER);
    expect(ing.trim().length, `${label} empty ingredient`).toBeGreaterThan(0);
  }
}

export function assertCleanTitle(title, label = '') {
  expect(typeof title, `${label} title missing`).toBe('string');
  expect(title.length, `${label} title too long: "${title}"`).toBeLessThanOrEqual(80);
  expect(findJunk(title), `${label} junk in title: "${title}"`).toBeNull();
}

/**
 * Build the >8K "long page" fixture at runtime: a valid JSON-LD recipe buried
 * under kilobytes of nav/comment noise. Guards the truncation regression —
 * extraction must still find the recipe regardless of page length.
 */
export function buildLongPageHtml() {
  const base = loadFixture('html', 'jsonld-standard.html');
  const comment = (i) =>
    `<div class="comment" id="comment-${i}"><div class="comment-author">reader${i}</div>` +
    `<p>This looks amazing! I made it last ${['Tuesday', 'weekend', 'night', 'month'][i % 4]} and ` +
    `swapped the ${['butter for ghee', 'thyme for rosemary', 'cream for coconut milk', 'chicken for tofu'][i % 4]}. ` +
    `Family devoured it. Rating: ${3 + (i % 3)} stars. Reply Share Report</p></div>\n`;
  let commentBlock = '<section id="comments"><h2>247 Comments</h2>\n';
  for (let i = 0; i < 90; i++) commentBlock += comment(i);
  commentBlock += '</section>';
  // Inject before </body>; noise alone exceeds the old 8K truncation limit.
  return base.replace('</body>', `${commentBlock}\n</body>`);
}
