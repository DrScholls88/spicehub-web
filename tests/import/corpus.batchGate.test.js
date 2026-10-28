// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — the batch queue uses the same gate as the import sheet
// ─────────────────────────────────────────────────────────────────────────────
// A title-only or bait extraction must land as `failed`, not as a `ready` row
// the user opens to find empty; and a result with no model confidence gets the
// structural heuristic score, not a made-up 50%.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let queue = [];
const updates = [];
vi.mock('../../src/db', () => ({
  default: {},
  recoverStuckBatchItems: async () => {},
  getNextPendingBatchItem: async () => queue.shift() || null,
  updateBatchQueueItem: async (id, patch) => { updates.push({ id, ...patch }); },
  getBatchQueueItems: async () => [],
}));

let nextResult = null;
vi.mock('../../src/import/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  importRecipeFromUrl: async () => nextResult,
  detectImportType: () => 'meal',
}));

globalThis.window = globalThis.window || new EventTarget();
const { runBatchImportEngine } = await import('../../src/batchImportEngine.js');

const run = async (result) => {
  queue = [{ id: 1, url: 'https://example.com/r', itemType: 'meal' }];
  nextResult = result;
  updates.length = 0;
  await runBatchImportEngine();
  return updates.at(-1);
};

describe('batch queue gating', () => {
  beforeEach(() => { updates.length = 0; });

  it('a title-only extraction is a failed row', async () => {
    const last = await run({ title: 'Best pasta ever', ingredients: [], directions: [] });
    expect(last.status).toBe('failed');
  });

  it('a real recipe is ready, scored by the heuristic when the model gave no confidence', async () => {
    const last = await run({
      title: 'Garlic butter chicken',
      ingredients: ['2 chicken breasts', '3 cloves garlic', '2 tbsp butter'],
      directions: ['Sear the chicken.', 'Add garlic and butter.'],
    });
    expect(last.status).toBe('ready');
    expect(last.recipe.confidence).not.toBe(0.5);
    expect(last.recipe.confidence).toBeGreaterThan(0);
    expect(last.recipe.confidence).toBeLessThanOrEqual(1);
  });

  it('keeps the model confidence when present', async () => {
    const last = await run({
      title: 'Garlic butter chicken', confidence: 0.91,
      ingredients: ['2 chicken breasts', '3 cloves garlic'], directions: ['Sear.'],
    });
    expect(last.recipe.confidence).toBe(0.91);
  });
});
