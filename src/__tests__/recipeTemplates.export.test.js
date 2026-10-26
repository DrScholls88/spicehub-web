import { describe, expect, it } from 'vitest';
import { renderRecipeExport } from '../utils/exportRenderer.js';
import { renderTemplate } from '../recipeTemplates.js';

const recipe = {
  name: 'Vegetable Stir Fry',
  ingredients: ['2 cups broccoli', '1 red bell pepper'],
  directions: ['Heat the oil.', 'Stir-fry the vegetables.'],
  sourceUrl: 'https://example.com/stir-fry',
};

describe('recipe export templates', () => {
  it('{{.}} renders the current list item, not the whole context', () => {
    expect(renderTemplate('{{#xs}}[{{.}}]{{/xs}}', { xs: ['a', 'b'] })).toBe('[a][b]');
  });

  it.each(['text', 'markdown', 'print', 'indexCard', 'html'])('%s export lists real ingredients and steps', (format) => {
    const out = renderRecipeExport(recipe, { format });
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('2 cups broccoli');
    expect(out).toContain('Stir-fry the vegetables.');
    expect(out).not.toMatch(/\{\{[#^/]?[\w.]+\}\}/); // no template tags leak into output
  });

  it('text formats keep & and apostrophes raw; HTML formats escape them', () => {
    const r = { ...recipe, name: "Trader Joe's Parm", sourceUrl: 'https://example.com/r?a=1&b=2' };
    for (const format of ['text', 'markdown']) {
      const out = renderRecipeExport(r, { format });
      expect(out).toContain("Trader Joe's Parm");
      expect(out).toContain('a=1&b=2');
      expect(out).not.toMatch(/&amp;|&#39;/);
    }
    expect(renderRecipeExport(r, { format: 'print' })).toContain('Trader Joe&#39;s Parm');
  });

  it('print export shows category tags only when there are some', () => {
    expect(renderRecipeExport({ ...recipe, categories: ['Dinners'] }, { format: 'print' })).toContain('recipe-category-tag');
    expect(renderRecipeExport(recipe, { format: 'print' })).not.toContain('<div class="recipe-categories">');
  });
});
