// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — recorded RECIPE_SCHEMA model outputs → thinFromStructured →
// enforceDeterministicRules. Pins the flatten + post-process path with the
// model mocked by recordings (deterministic in CI).
//
// Fixtures marked "knownGap": true document CURRENT missing behavior with
// it.fails — they go green the moment the engine fixes the gap, forcing the
// recording's promotion to a normal test. This is intentional.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { enforceDeterministicRules } from '../../src/recipeParser.js';
import { thinFromStructured } from '../../src/recipeSchema.js';
import { FIXTURES, loadJsonFixture, assertZeroJunk, assertCleanTitle, assertCleanIngredients } from './helpers.js';

const files = readdirSync(join(FIXTURES, 'gemini')).filter(f => f.endsWith('.json'));

function runFixture(fx) {
  const thin = thinFromStructured(fx.structured);
  const out = enforceDeterministicRules({ ...thin, _structuredVia: 'corpus' });

  assertCleanTitle(out.title, fx.name);
  assertCleanIngredients(out.ingredients, fx.name);

  const e = fx.expect;
  if (e.titleContains) expect(out.title).toContain(e.titleContains);
  if (e.minIngredients) expect(out.ingredients.length, 'ingredient count').toBeGreaterThanOrEqual(e.minIngredients);
  if (e.minDirections) expect(out.directions.length, 'direction count').toBeGreaterThanOrEqual(e.minDirections);
  if (typeof e.maxMoved === 'number') expect(out._postProcessAudit.movedCount).toBeLessThanOrEqual(e.maxMoved);
  if (typeof e.minMoved === 'number') expect(out._postProcessAudit.movedCount).toBeGreaterThanOrEqual(e.minMoved);
  if (e.mustNotBeDirection) {
    expect(out.directions).not.toContain(e.mustNotBeDirection);
    expect(out.ingredients.some(i => i.includes(e.mustNotBeDirection.replace(/^1 /, '')) || i === e.mustNotBeDirection)).toBe(true);
  }
  if (e.ingredientMustMatch) expect(out.ingredients.join('\n')).toMatch(new RegExp(e.ingredientMustMatch, 'i'));
  if (e.minNotes) expect((out.notes || []).length, 'notes count').toBeGreaterThanOrEqual(e.minNotes);
  if (typeof e.confidenceBelow === 'number') expect(out.confidence).toBeLessThan(e.confidenceBelow);
  if (e.needsReview) expect(out.needsReview).toBe(true);
  if (e.drink) {
    expect(out._type).toBe('drink');
    if (e.glass) expect(out.glass).toBe(e.glass);
    if (e.garnish) expect(out.garnish).toBe(e.garnish);
  }
  if (e.zeroJunkEverywhere) assertZeroJunk(out, fx.name);

  // Universal invariants for every recording:
  expect(out.ingredients.length).toBeGreaterThan(0);
  expect(out.directions.length).toBeGreaterThan(0);
}

describe('golden corpus — recorded model outputs → thin → enforce', () => {
  for (const file of files) {
    const fx = loadJsonFixture('gemini', file);
    if (fx.knownGap) {
      // KNOWN-GAP: pinned as failing. When the engine gains this behavior the
      // test flips to passing, vitest reports it, and the fixture graduates.
      it.fails(`[KNOWN-GAP] ${fx.name}`, () => runFixture(fx));
    } else {
      it(fx.name, () => runFixture(fx));
    }
  }
});
