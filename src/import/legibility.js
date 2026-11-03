// ─────────────────────────────────────────────────────────────────────────────
// LEGIBILITY — engine-agnostic "was this page actually readable?" score.
//
// OCR engines' own confidence is not a reliable legibility signal: litert-ocr
// reports 90+ on a half-misread cursive page (scripts/ocr-bench.mjs,
// 2026-10-29). This scores the recognised TEXT instead, so any on-device
// engine can share it:
//   knownRatio      share of words (3+ letters) found in the kitchen lexicon
//   junkRatio       share of non-space chars outside letters/digits/recipe punctuation
//   garbageLines    share of lines with neither a known word nor a number
// score = 100 · knownRatio · (1 − min(1, 4·junkRatio)) · (1 − ½·garbageLines)
//
// Calibrated on tests/import/fixtures/photos (8 photos × Tesseract + litert):
// every read with recall ≤ 54% scored < 60, every clean read ≥ 66.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED = /[A-Za-z0-9\s.,:;'"()/%&+\-–—°½¼¾⅓⅔⅛⅜⅝⅞!?#*•·]/;

let lexiconPromise = null;
/** Lazy-load the generated word list (src/data/ocrLexicon.js, ~48 KB) once. */
export function loadOcrLexicon() {
  if (!lexiconPromise) {
    lexiconPromise = import('../data/ocrLexicon.js').then((m) => new Set(String(m.default).split(' ')));
  }
  return lexiconPromise;
}

/**
 * @param {string} text — recognised page text
 * @param {Set<string>} lexicon — from loadOcrLexicon()
 * @returns {{ score: number, knownRatio: number, junkRatio: number, garbageLineRatio: number, words: number }}
 */
export function scoreLegibility(text, lexicon) {
  const t = String(text || '');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const toks = t.toLowerCase().match(/[a-z]{3,}/g) || [];
  if (toks.length < 3) return { score: 0, knownRatio: 0, junkRatio: 1, garbageLineRatio: 1, words: toks.length };

  const known = (w) => lexicon.has(w)
    || (w.endsWith('s') && lexicon.has(w.slice(0, -1)))
    || (w.endsWith('es') && lexicon.has(w.slice(0, -2)));
  const knownRatio = toks.filter(known).length / toks.length;

  const chars = t.replace(/\s/g, '');
  const junkRatio = chars.length ? [...chars].filter((c) => !ALLOWED.test(c)).length / chars.length : 1;

  const garbage = lines.filter((l) => !/\d/.test(l) && !(l.toLowerCase().match(/[a-z]{3,}/g) || []).some(known)).length;
  const garbageLineRatio = lines.length ? garbage / lines.length : 1;

  const score = Math.round(100 * knownRatio * (1 - Math.min(1, junkRatio * 4)) * (1 - 0.5 * garbageLineRatio));
  return { score, knownRatio, junkRatio, garbageLineRatio, words: toks.length };
}
