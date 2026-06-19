import { describe, it, expect } from 'vitest';
import { enforceDeterministicRules } from '../recipeParser.js';

// The deterministic post-processor is the model-agnostic safety net that runs
// after EVERY extraction engine (Grok, Gemini schema/legacy, server). These
// tests pin its behaviour so a future change can't silently regress import
// quality — the exact failure mode that motivated this layer.

describe('enforceDeterministicRules — reclassification', () => {
  it('moves a cooking-verb line out of ingredients into directions', () => {
    const out = enforceDeterministicRules({
      ingredients: ['2 cups flour', 'Toss with oil and spices', '1 onion, diced'],
      directions: ['Mix dry ingredients'],
    });
    expect(out.ingredients).toContain('2 cups flour');
    expect(out.ingredients).toContain('1 onion, diced');
    expect(out.ingredients).not.toContain('Toss with oil and spices');
    expect(out.directions).toContain('Toss with oil and spices');
    expect(out._postProcessAudit.movedCount).toBe(1);
    expect(out._postProcessAudit.moved[0].reason).toBe('action-verb');
  });

  it('moves a real numbered step out of ingredients', () => {
    const out = enforceDeterministicRules({
      ingredients: ['1. Preheat oven to 400F', '3 eggs'],
      directions: [],
    });
    expect(out.directions).toContain('1. Preheat oven to 400F');
    expect(out.ingredients).toEqual(['3 eggs']);
    expect(out._postProcessAudit.movedCount).toBe(1);
  });

  // REGRESSION GUARD: STEP_NUM_RE (/^\d+[.):\s-]/) also matches a digit+space,
  // so a naive numbered-step check would wrongly move quantity-first
  // ingredients ("2 cups flour", "3 eggs") into directions. These must STAY.
  it('never moves quantity-first ingredients (digit + space) to directions', () => {
    const out = enforceDeterministicRules({
      ingredients: ['2 cups flour', '3 large eggs', '1 tbsp olive oil', '4 cloves garlic'],
      directions: [],
    });
    expect(out.ingredients).toHaveLength(4);
    expect(out.directions).toHaveLength(0);
    expect(out._postProcessAudit.movedCount).toBe(0);
  });

  it('rescues a pure quantity+food line stranded in directions', () => {
    const out = enforceDeterministicRules({
      ingredients: [],
      directions: ['3 eggs', 'Whisk until combined'],
    });
    expect(out.ingredients).toContain('3 eggs');
    expect(out.directions).toContain('Whisk until combined');
    expect(out.directions).not.toContain('3 eggs');
    expect(out._postProcessAudit.moved.some((m) => m.reason === 'pure-quantity-food')).toBe(true);
  });

  it('filters trash header lines out of ingredients', () => {
    const out = enforceDeterministicRules({
      ingredients: ['Ingredients:', '1 cup cream'],
      directions: [],
    });
    expect(out.ingredients).toContain('1 cup cream');
    expect(out.ingredients).not.toContain('Ingredients:');
    expect(out._postProcessAudit.filteredCount).toBeGreaterThanOrEqual(1);
  });

  it('dedupes repeated ingredient lines (case-insensitive)', () => {
    const out = enforceDeterministicRules({
      ingredients: ['1 cup sugar', '1 Cup Sugar', '2 eggs'],
      directions: [],
    });
    expect(out.ingredients).toHaveLength(2);
  });
});

describe('enforceDeterministicRules — title, confidence, flags', () => {
  it('replaces a conversational-hook title with one derived from ingredients', () => {
    const original = "let's take it back to my favorite pasta";
    const out = enforceDeterministicRules({
      name: original,
      ingredients: ['2 cups flour', '1 cup sugar'],
      directions: [],
    });
    expect(out._postProcessAudit.titleCleaned).toBe(true);
    expect(out.title).not.toBe(original);
    expect(out.title.toLowerCase()).not.toContain('favorite');
    expect(out.title.length).toBeLessThan(original.length);
  });

  it('leaves a clean recipe untouched and preserves confidence', () => {
    const out = enforceDeterministicRules({
      title: 'Tomato Soup',
      ingredients: ['2 cups tomatoes', '1 onion'],
      directions: ['Simmer for 20 minutes'],
      confidence: 0.9,
    });
    expect(out._postProcessAudit.movedCount).toBe(0);
    expect(out._postProcessAudit.filteredCount).toBe(0);
    expect(out.confidence).toBe(0.9);
    expect(out.ingredients).toHaveLength(2);
    expect(out.directions).toHaveLength(1);
  });

  it('applies a small confidence penalty when it corrects lines', () => {
    const out = enforceDeterministicRules({
      title: 'Pancakes',
      ingredients: ['2 cups flour', 'Mix everything together'],
      directions: [],
      confidence: 0.9,
    });
    expect(out._postProcessAudit.movedCount).toBe(1);
    expect(out.confidence).toBeCloseTo(0.85, 5); // 0.9 - 0.05*1
  });

  it('flags needsReview when more than two corrections are made', () => {
    const out = enforceDeterministicRules({
      title: 'Messy Import',
      ingredients: ['Mix the eggs', 'Stir the flour', 'Combine everything', '2 cups flour'],
      directions: [],
    });
    expect(out._postProcessAudit.movedCount).toBe(3);
    expect(out.needsReview).toBe(true);
  });
});

describe('enforceDeterministicRules — safety', () => {
  it('handles an empty object without throwing', () => {
    const out = enforceDeterministicRules({});
    expect(out.ingredients).toEqual([]);
    expect(out.directions).toEqual([]);
    expect(out._postProcessAudit).toBeTruthy();
  });

  it('tolerates non-array / null fields', () => {
    const out = enforceDeterministicRules({ ingredients: null, directions: 'not an array', confidence: null });
    expect(out.ingredients).toEqual([]);
    expect(out.directions).toEqual([]);
    expect(out.confidence).toBeNull();
  });

  it('always attaches a well-formed _postProcessAudit', () => {
    const out = enforceDeterministicRules({ ingredients: ['1 cup milk'], directions: [] });
    const a = out._postProcessAudit;
    expect(typeof a.movedCount).toBe('number');
    expect(typeof a.filteredCount).toBe('number');
    expect(Array.isArray(a.moved)).toBe(true);
    expect(Array.isArray(a.filtered)).toBe(true);
    expect(typeof a.titleCleaned).toBe('boolean');
  });
});
