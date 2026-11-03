// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — engine link imports run the deterministic cleanup, and every
// line it moved or dropped can be undone from Review
// ─────────────────────────────────────────────────────────────────────────────
// structure/gemini.js returns raw RECIPE_SCHEMA objects and says "callers own
// thinFromStructured + finalizeAIRecipe". From 2026-09-06 the engine's
// structure() only did the first, so link imports skipped misplaced-line
// reclassification, the zero-junk filter, per-field confidence and the
// cleanup audit Review shows. These cases pin the fix and the Undo helper.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/import/acquire/website.js', async (importOriginal) => ({
  ...(await importOriginal()),
  acquireWebsitePack: async () => ({
    sourceUrl: 'https://example.com/brownies', sourceType: 'website', title: 'Brownies', author: '',
    caption: null, transcript: null, markdown: '# Brownies\n2 cups flour...', jsonLd: null, candidate: null,
    images: [], provenance: [], acquiredVia: 'readability', confidence: 0.6,
  }),
}));

vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  structurePack: async () => ({
    isRecipe: true, kind: 'meal', title: 'Sheet Pan Brownies', confidence: 0.9,
    ingredientGroups: [{ section: '', items: [
      { quantity: '2', unit: 'cups', name: 'flour' },
      { quantity: '1', unit: 'cup', name: 'sugar' },
      { quantity: '', unit: '', name: 'Preheat the oven to 350F and grease the pan' },
    ] }],
    directions: [
      'Mix the flour and sugar together well.',
      '3 eggs',
      'Bake for 25 minutes until set.',
      'Follow me for more recipes!',
    ],
  }),
}));

const { importRequest } = await import('../../src/import/engine.js');
const { enforceDeterministicRules } = await import('../../src/recipeParser.js');
const { undoCleanup } = await import('../../src/import/clean/undoCleanup.js');
const { gateRecipe } = await import('../../src/import/gate.js');

describe('engine link imports are finalized', () => {
  it('moves misplaced lines, strips junk, records the audit and per-field confidence', async () => {
    const { recipe } = await importRequest({ url: 'https://example.com/brownies', kind: 'meal' });
    expect(recipe.ingredients).toContain('3 eggs');
    expect(recipe.directions.some((d) => /^Preheat the oven/.test(d))).toBe(true);
    expect(recipe.directions.join('\n')).not.toMatch(/Follow me/);
    expect(recipe._postProcessAudit.movedCount).toBe(2);
    expect(recipe.ingredientsStructured.some((i) => i.confidenceFields)).toBe(true);
    expect(recipe._extractedVia).toMatch(/^gemini-pack:/);
    expect(recipe._contextPack).toBeTruthy();
    expect(recipe.link).toBe('https://example.com/brownies');
  });
});

describe('cleanup audit entries carry their original position', () => {
  it('records the index in the list the line came from', () => {
    const out = enforceDeterministicRules({
      ingredients: ['2 cups flour', 'Preheat the oven to 350F and grease the pan', '1 cup sugar'],
      directions: ['Mix well and pour into the pan.', '3 eggs', 'Bake 25 minutes.'],
    });
    const fromIng = out._postProcessAudit.moved.find((m) => m.from === 'ingredients');
    const fromDir = out._postProcessAudit.moved.find((m) => m.from === 'directions');
    expect(fromIng.index).toBe(1);
    expect(fromDir.index).toBe(1);
  });
});

describe('undoCleanup', () => {
  const base = () => enforceDeterministicRules({
    ingredients: ['2 cups flour', 'Preheat the oven to 350F and grease the pan', '1 cup sugar'],
    directions: ['Mix well and pour into the pan.', '3 eggs', 'Bake 25 minutes.'],
  });

  it('puts a moved line back where it was and drops the audit entry', () => {
    const r = base();
    const entry = r._postProcessAudit.moved.find((m) => m.from === 'ingredients');
    const u = undoCleanup(r, entry);
    // '3 eggs' was also moved in from the steps; only the undone line changes.
    expect(u.ingredients).toEqual(['2 cups flour', 'Preheat the oven to 350F and grease the pan', '1 cup sugar', '3 eggs']);
    expect(u.directions.some((d) => /^Preheat/.test(d))).toBe(false);
    expect(u._postProcessAudit.moved).toHaveLength(r._postProcessAudit.moved.length - 1);
    expect(u._postProcessAudit.movedCount).toBe(r._postProcessAudit.movedCount - 1);
    expect(r.ingredients).not.toContain('Preheat the oven to 350F and grease the pan'); // input untouched
  });

  it('restores a dropped line', () => {
    const r = enforceDeterministicRules({
      ingredients: ['2 cups flour', 'Calories: 240 kcal', '1 cup sugar'],
      directions: ['Mix and bake 25 minutes.'],
    });
    const entry = r._postProcessAudit.filtered[0];
    expect(entry).toBeTruthy();
    const u = undoCleanup(r, entry);
    expect(u.ingredients).toContain(entry.line);
    expect(u._postProcessAudit.filteredCount).toBe(r._postProcessAudit.filteredCount - 1);
  });

  it('still works after the user edited the lists (appends, never throws)', () => {
    const r = base();
    const entry = r._postProcessAudit.moved.find((m) => m.from === 'directions');
    const edited = { ...r, ingredients: ['only one'], directions: [] };
    const u = undoCleanup(edited, entry);
    expect(u.directions).toEqual(['3 eggs']);
  });
});

describe('gate — finalized default title', () => {
  it('treats "Imported Recipe" as a generic name', () => {
    const g = gateRecipe({ name: 'Imported Recipe', ingredients: ['a', 'b', 'c'], directions: ['x'] }, {});
    expect(g.reasons).toContain('generic-name');
  });
});
