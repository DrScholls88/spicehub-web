// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — engine-agnostic OCR legibility score
// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: real Tesseract and litert-ocr output for Brian's 8 recipe photos
// (tests/import/fixtures/photos/ocr, made by scripts/ocr-bench.mjs with
// OCR_DUMP set). Engine confidence is not trusted: litert scores 90 on a
// half-misread cursive page. These pin which reads the text heuristic flags.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scoreLegibility, loadOcrLexicon } from '../../src/import/legibility.js';
import { OCR_HARD_TO_READ } from '../../src/import/gate.js';

const read = (name) => readFileSync(`tests/import/fixtures/photos/ocr/${name}.txt`, 'utf8');
const lexicon = await loadOcrLexicon();
const score = (name) => scoreLegibility(read(name), lexicon).score;

// Recall in brackets is ingredient-line recall from scripts/ocr-bench.mjs.
const HARD = [
  'tesseract__handwritten-notebook-low-light', // 11%
  'tesseract__handwritten-cursive', //            0%
  'tesseract__cookbook-two-page-spread', //       30%
  'tesseract__handwritten-card-cropped', //       0%
  'litert-ocr__handwritten-cursive', //           50%, engine conf 90
  'litert-ocr__handwritten-card-cropped', //      "114 eep sugar", "vanella"
];
const CLEAN = [
  'tesseract__instagram-screenshot-pair', 'tesseract__instagram-screenshot-small',
  'tesseract__textbook-annotated', 'tesseract__vintage-two-column',
  'litert-ocr__instagram-screenshot-pair', 'litert-ocr__instagram-screenshot-small',
  'litert-ocr__textbook-annotated', 'litert-ocr__vintage-two-column',
  'litert-ocr__cookbook-two-page-spread', 'litert-ocr__handwritten-notebook-low-light',
];

describe('scoreLegibility on real OCR output', () => {
  it.each(HARD)('flags %s as hard to read', (name) => {
    expect(score(name)).toBeLessThan(OCR_HARD_TO_READ);
  });
  it.each(CLEAN)('passes %s', (name) => {
    expect(score(name)).toBeGreaterThanOrEqual(OCR_HARD_TO_READ);
  });
});

describe('scoreLegibility edge cases', () => {
  it('scores empty or near-empty text 0', () => {
    expect(scoreLegibility('', lexicon).score).toBe(0);
    expect(scoreLegibility('§ = |', lexicon).score).toBe(0);
  });
  it('a clean typed recipe scores high', () => {
    expect(scoreLegibility('2 cups flour\n1 cup sugar\n2 eggs\nMix and bake for 20 minutes.', lexicon).score)
      .toBeGreaterThanOrEqual(80);
  });
});
