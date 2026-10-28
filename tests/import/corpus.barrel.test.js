// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — the engine barrel stays in sync with what it re-exports
// ─────────────────────────────────────────────────────────────────────────────
// App code must import through src/import/index.js (eslint enforces it), but the
// rest of the corpus imports the monolith directly. This case covers the gap:
// every barrel name that the monolith also exports must be the SAME binding,
// and the engine entry points must exist, so a rename or a dropped re-export
// fails here instead of at runtime in the import sheet.
import { describe, it, expect } from 'vitest';
import * as barrel from '../../src/import/index.js';
import * as monolith from '../../src/recipeParser.js';

describe('engine barrel', () => {
  it('exposes the entry points app code uses', () => {
    for (const name of [
      'importRequest', 'restructure', 'gateRecipe', 'importRecipeFromUrl',
      'importRecipeFromPages', 'detectImportType', 'scoreExtractionConfidence',
      'extractMultipleUrls', 'getSocialPlatform', 'captionToRecipe',
    ]) {
      expect(typeof barrel[name], name).toBe('function');
    }
  });

  it('re-exports monolith functions as the same binding', () => {
    const shared = Object.keys(barrel).filter((k) => k in monolith);
    expect(shared.length).toBeGreaterThan(10);
    const drifted = shared.filter((k) => barrel[k] !== monolith[k]);
    expect(drifted).toEqual([]);
  });
});
