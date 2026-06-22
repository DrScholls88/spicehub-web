import { describe, it, expect } from 'vitest';
import { crossCheckStructured, reconcileStructuredWithFlat } from '../recipeSchema.js';

// Spec C — the pure comparison + reconciliation layer. crossCheckStructured
// enforces the FLAG + FILL-GAPS-ONLY policy; reconcileStructuredWithFlat keeps
// ingredientsStructured aligned with the (possibly reclassified) flat list.

describe('crossCheckStructured — flag + fill gaps only', () => {
  it('fills an empty AI unit from a confident deterministic parse', () => {
    const ai = [{ name: 'flour', quantity: '2', unit: '' }];
    const det = [{ name: 'flour', quantity: '2', unit: 'cup' }];
    const { items, audit } = crossCheckStructured(ai, det);
    expect(items[0].unit).toBe('cup');
    expect(items[0]._xcheck.filled).toContain('unit');
    expect(audit.filled).toBe(1);
    expect(audit.disagreements).toBe(0);
  });

  it('fills an empty AI quantity from deterministic', () => {
    const ai = [{ name: 'garlic', quantity: '', unit: 'clove' }];
    const det = [{ name: 'garlic', quantity: '3', unit: 'clove' }];
    const { items, audit } = crossCheckStructured(ai, det);
    expect(items[0].quantity).toBe('3');
    expect(audit.filled).toBe(1);
  });

  it('records a real disagreement WITHOUT overriding a populated AI value', () => {
    const ai = [{ name: 'flour', quantity: '2', unit: 'cup' }];
    const det = [{ name: 'flour', quantity: '3', unit: 'cup' }];
    const { items, audit } = crossCheckStructured(ai, det);
    expect(items[0].quantity).toBe('2'); // unchanged
    expect(items[0]._xcheck.disagree).toContain('quantity');
    expect(audit.disagreements).toBe(1);
    expect(audit.filled).toBe(0);
  });

  it('never overrides a populated AI unit even when deterministic differs', () => {
    const ai = [{ name: 'sugar', quantity: '1', unit: 'tbsp' }];
    const det = [{ name: 'sugar', quantity: '1', unit: 'cup' }];
    const { items } = crossCheckStructured(ai, det);
    expect(items[0].unit).toBe('tbsp');
    expect(items[0]._xcheck.disagree).toContain('unit');
  });

  it('leaves items without a deterministic match untouched', () => {
    const ai = [{ name: 'saffron', quantity: '', unit: '' }];
    const det = [{ name: 'flour', quantity: '2', unit: 'cup' }];
    const { items, audit } = crossCheckStructured(ai, det);
    expect(items[0]).toEqual({ name: 'saffron', quantity: '', unit: '' });
    expect(audit.compared).toBe(0);
  });

  it('returns AI items unchanged when either side is empty', () => {
    const ai = [{ name: 'flour', quantity: '2', unit: 'cup' }];
    expect(crossCheckStructured(ai, []).items).toBe(ai);
    expect(crossCheckStructured([], [{ name: 'x' }]).items).toEqual([]);
  });
});

describe('reconcileStructuredWithFlat', () => {
  const flourItem = { ref: 'r1', quantity: '2', unit: 'cup', name: 'flour', prep: '', category: 'Pantry', section: '', original_text: '2 cup flour', display: '2 cup flour' };
  const sugarItem = { ref: 'r2', quantity: '1', unit: 'cup', name: 'sugar', prep: '', category: 'Pantry', section: '', original_text: '1 cup sugar', display: '1 cup sugar' };

  it('keeps the original Item for an unchanged line (same ref)', () => {
    const out = reconcileStructuredWithFlat([flourItem], ['2 cup flour'], []);
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe('r1');
  });

  it('upgrades a moved-in line that has no structured counterpart', () => {
    const out = reconcileStructuredWithFlat([], ['1 cup sugar'], [{ text: '1 cup sugar', category: 'Pantry' }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('sugar');
    expect(out[0].category).toBe('Pantry');
    expect(out[0].ref).toMatch(/^ing_/);
  });

  it('drops a structured item whose line was removed from the flat list', () => {
    const out = reconcileStructuredWithFlat([flourItem, sugarItem], ['2 cup flour'], []);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('flour');
  });

  it('preserves section suffixes when matching', () => {
    const sauced = { ...flourItem, section: 'sauce', original_text: '2 cup flour' };
    const out = reconcileStructuredWithFlat([sauced], ['2 cup flour (sauce)'], []);
    expect(out[0].ref).toBe('r1');
  });
});
