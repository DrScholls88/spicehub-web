// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — photo imports through the engine keep their photo metadata
// ─────────────────────────────────────────────────────────────────────────────
// Since 2026-09-06 photo imports run through engine.importRequest. Nothing
// copied the photo fields onto the recipe, so _ocrDraft (the offline upgrade
// queue's trigger), _visionEngine ("read on your device") and _scanPages (the
// saved page gallery) were all lost, and an offline photo with no
// /api/structure landed on Miss instead of Review. Also pins the per-page OCR
// confidence and the 'photo-unreadable' gate reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let acquired = null;
vi.mock('../../src/lib/photoImportEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  importRecipeFromPages: async () => structuredClone(acquired),
}));

const structurePack = vi.fn();
vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  structurePack: (...a) => structurePack(...a),
}));

const { importRequest } = await import('../../src/import/engine.js');
const { gateRecipe, OCR_HARD_TO_READ } = await import('../../src/import/gate.js');
const { ocrPageFromTesseract, summarizeOcrConfidence } = await vi.importActual('../../src/lib/photoImportEngine.js');

const OCR_TEXT = 'Garlic Butter Pasta\n\nIngredients\n200 g spaghetti\n3 cloves garlic\n2 tbsp butter\n\nInstructions\nBoil the pasta until al dente.\nMelt the butter with the garlic and toss.';
const pages = [{ id: 'p1', dataUrl: 'data:image/jpeg;base64,AAA' }, { id: 'p2', dataUrl: 'data:image/jpeg;base64,BBB' }];
const tesseractDraft = (ocrConfidence) => ({
  transcript: OCR_TEXT,
  uploadPages: ['data:image/jpeg;base64,up1', 'data:image/jpeg;base64,up2'],
  _visionEngine: 'tesseract',
  _ocrDraft: true,
  ocrConfidence,
  contentType: 'recipe',
});

describe('OCR confidence helpers', () => {
  it('reads Tesseract mean confidence per page', () => {
    expect(ocrPageFromTesseract({ data: { text: '2 cups flour', confidence: 71.6 } })).toEqual({ transcript: '2 cups flour', confidence: 72 });
    expect(ocrPageFromTesseract({ data: { text: 'x' } }).confidence).toBeNull();
  });

  it('names the worst page, and is null for cloud pages with no score', () => {
    expect(summarizeOcrConfidence([{ confidence: 88 }, { confidence: 41 }, { confidence: 90 }]))
      .toEqual({ min: 41, worstPage: 2, perPage: [88, 41, 90] });
    expect(summarizeOcrConfidence([{ transcript: 'a' }, { transcript: 'b' }])).toBeNull();
  });
});

describe('gate — photo-unreadable', () => {
  const full = { name: 'Pasta', ingredients: ['200 g spaghetti', '3 cloves garlic', '2 tbsp butter'], directions: ['Boil.'] };

  it('downgrades a pass to salvage when a page was hard to read', () => {
    const g = gateRecipe(full, { _ocrConfidence: { min: OCR_HARD_TO_READ - 1, worstPage: 2 } });
    expect(g.verdict).toBe('salvage');
    expect(g.reasons).toContain('photo-unreadable');
  });

  it('keeps empty as empty but names the cause', () => {
    const g = gateRecipe(null, { _ocrConfidence: { min: 12, worstPage: 1 } });
    expect(g.verdict).toBe('empty');
    expect(g.reasons).toContain('photo-unreadable');
  });

  it('leaves legible photos and non-photo packs alone', () => {
    expect(gateRecipe(full, { _ocrConfidence: { min: 90, worstPage: 1 } })).toEqual({ verdict: 'pass', reasons: [] });
    expect(gateRecipe(full, {})).toEqual({ verdict: 'pass', reasons: [] });
  });
});

describe('engine photo path', () => {
  beforeEach(() => structurePack.mockReset());

  it('offline: an on-device draft reaches Review with its photo metadata', async () => {
    acquired = tesseractDraft({ min: 42, worstPage: 2, perPage: [88, 42] });
    structurePack.mockResolvedValue(null); // /api/structure unreachable

    const { recipe, gate, reasons } = await importRequest({ pages, kind: 'meal' });

    expect(recipe).not.toBeNull();
    expect(recipe.ingredients.join('\n')).toMatch(/spaghetti/);
    expect(recipe._ocrDraft).toBe(true);
    expect(recipe._visionEngine).toBe('tesseract');
    expect(recipe._extractionSource).toBe('photo');
    expect(recipe._scanPages).toHaveLength(2);
    expect(recipe._ocrConfidence.worstPage).toBe(2);
    expect(recipe.needsReview).toBe(true);
    expect(recipe.confidence).toBeLessThanOrEqual(0.45);
    expect(recipe.sourceCaption).toBe(OCR_TEXT);
    expect(gate).not.toBe('empty');
    expect(reasons).toContain('photo-unreadable');
  });

  it('online: a cloud read is stamped too, without a draft flag or a score', async () => {
    acquired = { ...tesseractDraft(null), _visionEngine: 'gemini', _ocrDraft: false };
    delete acquired.ocrConfidence;
    structurePack.mockResolvedValue({
      isRecipe: true, name: 'Garlic Butter Pasta', title: 'Garlic Butter Pasta', type: 'meal',
      ingredients: ['200 g spaghetti', '3 cloves garlic', '2 tbsp butter'],
      directions: ['Boil the pasta.', 'Toss with garlic butter.'], confidence: 0.9,
    });

    const { recipe, reasons } = await importRequest({ pages, kind: 'meal' });

    expect(recipe._visionEngine).toBe('gemini');
    expect(recipe._ocrDraft).toBe(false);
    expect(recipe._scanPages).toHaveLength(2);
    expect(recipe._ocrConfidence).toBeUndefined();
    expect(reasons).not.toContain('photo-unreadable');
  });
});
