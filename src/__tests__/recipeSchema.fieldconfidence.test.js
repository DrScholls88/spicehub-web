import { describe, it, expect } from 'vitest';
import { fieldConfidence, annotateFieldConfidence } from '../recipeSchema.js';

// Spec B — per-field confidence derived from the Spec C cross-check signal
// (_xcheck) plus light presence heuristics.

describe('fieldConfidence', () => {
  it('scores a clean, complete item as fully confident', () => {
    expect(fieldConfidence({ quantity: '2', unit: 'cup', name: 'flour' }))
      .toEqual({ quantity: 1, unit: 1, name: 1, overall: 1 });
  });

  it('drops a cross-check DISAGREE field to 0.4', () => {
    const cf = fieldConfidence({ quantity: '2', unit: 'cup', name: 'flour', _xcheck: { disagree: ['unit'], filled: [] } });
    expect(cf.unit).toBe(0.4);
    expect(cf.overall).toBe(0.4);
  });

  it('marks a cross-check FILLED field as 0.7', () => {
    const cf = fieldConfidence({ quantity: '', unit: 'cup', name: 'flour', _xcheck: { disagree: [], filled: ['quantity'] } });
    expect(cf.quantity).toBe(0.7);
    expect(cf.overall).toBe(0.7);
  });

  it('flags a unit-without-quantity via presence heuristic (0.5)', () => {
    const cf = fieldConfidence({ quantity: '', unit: 'cup', name: 'flour' });
    expect(cf.quantity).toBe(0.5);
  });

  it('flags a verb-leading name as a probable leaked direction (0.5)', () => {
    const cf = fieldConfidence({ quantity: '2', unit: '', name: 'Preheat the oven to 400' });
    expect(cf.name).toBe(0.5);
    expect(cf.overall).toBe(0.5);
  });

  it('scores an empty name as 0', () => {
    expect(fieldConfidence({ quantity: '', unit: '', name: '' }).name).toBe(0);
  });

  it('does NOT presence-flag a legitimately unitless item', () => {
    // "salt to taste" — no qty, no unit; quantity heuristic only fires when a
    // unit is present, so this stays confident.
    const cf = fieldConfidence({ quantity: '', unit: '', name: 'salt', prep: 'to taste' });
    expect(cf.quantity).toBe(1);
    expect(cf.unit).toBe(1);
  });
});

describe('annotateFieldConfidence', () => {
  it('attaches confidenceFields without mutating the input', () => {
    const input = [{ name: 'flour', quantity: '2', unit: 'cup' }];
    const out = annotateFieldConfidence(input);
    expect(out[0].confidenceFields).toEqual({ quantity: 1, unit: 1, name: 1, overall: 1 });
    expect(input[0].confidenceFields).toBeUndefined();
  });

  it('tolerates nulls and non-arrays', () => {
    expect(annotateFieldConfidence([null])).toEqual([null]);
    expect(annotateFieldConfidence(undefined)).toEqual([]);
  });
});
