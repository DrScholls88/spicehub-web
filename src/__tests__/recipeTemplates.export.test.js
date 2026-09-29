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
  });
});
