import { describe, it, expect } from 'vitest';
import {
  parseVisionContract,
  joinPageTranscripts,
  computeCropRect,
  cleanOcrText,
  PAGE_SEPARATOR,
  PhotoImportError,
} from '../lib/photoImportEngine.js';

// ── parseVisionContract ─────────────────────────────────────────────────────

describe('parseVisionContract', () => {
  const valid = {
    pages: [{ transcript: 'Chicken Alfredo\n2 cups cream' }],
    dishPhoto: { page: 1, box: [100, 100, 600, 800] },
    contentType: 'recipe',
  };

  it('parses clean JSON', () => {
    const out = parseVisionContract(JSON.stringify(valid), 1);
    expect(out).not.toBeNull();
    expect(out.pages[0].transcript).toContain('Chicken Alfredo');
    expect(out.dishPhoto).toEqual({ page: 1, box: [100, 100, 600, 800] });
    expect(out.contentType).toBe('recipe');
  });

  it('parses fenced markdown JSON', () => {
    const out = parseVisionContract('Here you go:\n```json\n' + JSON.stringify(valid) + '\n```\nDone!', 1);
    expect(out).not.toBeNull();
    expect(out.pages[0].transcript).toContain('cream');
  });

  it('parses JSON with leading/trailing prose', () => {
    const out = parseVisionContract('Sure! ' + JSON.stringify(valid) + ' — hope that helps', 1);
    expect(out).not.toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseVisionContract('not json at all', 1)).toBeNull();
    expect(parseVisionContract('', 1)).toBeNull();
    expect(parseVisionContract(null, 1)).toBeNull();
    expect(parseVisionContract('{"pages": [', 1)).toBeNull();
  });

  it('pads missing pages to the expected count', () => {
    const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'only one' }] }), 3);
    expect(out.pages).toHaveLength(3);
    expect(out.pages[1].transcript).toBe('');
  });

  it('trims extra pages beyond the expected count', () => {
    const out = parseVisionContract(
      JSON.stringify({ pages: [{ transcript: 'a' }, { transcript: 'b' }, { transcript: 'c' }] }),
      2,
    );
    expect(out.pages).toHaveLength(2);
  });

  it('rejects malformed dishPhoto boxes without failing the whole contract', () => {
    const cases = [
      { page: 1, box: [600, 100, 100, 800] },      // ymin > ymax
      { page: 1, box: [100, 100, 600] },           // 3 coords
      { page: 9, box: [100, 100, 600, 800] },      // page out of range
      { page: 1, box: [100, 100, 600, 1400] },     // coord > 1000
      { page: 'x', box: [100, 100, 600, 800] },    // NaN page
    ];
    for (const dishPhoto of cases) {
      const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'ok text here' }], dishPhoto }), 1);
      expect(out).not.toBeNull();
      expect(out.dishPhoto).toBeNull();
    }
  });

  it('defaults unknown contentType to recipe', () => {
    const out = parseVisionContract(JSON.stringify({ pages: [{ transcript: 'x' }], contentType: 'banana' }), 1);
    expect(out.contentType).toBe('recipe');
  });
});

// ── joinPageTranscripts ─────────────────────────────────────────────────────

describe('joinPageTranscripts', () => {
  it('joins pages in order with the separator', () => {
    const joined = joinPageTranscripts([{ transcript: 'front' }, { transcript: 'back' }]);
    expect(joined).toBe(`front${PAGE_SEPARATOR}back`);
  });

  it('skips empty pages', () => {
    const joined = joinPageTranscripts([{ transcript: 'a' }, { transcript: '' }, { transcript: 'c' }]);
    expect(joined).toBe(`a${PAGE_SEPARATOR}c`);
  });

  it('handles junk input', () => {
    expect(joinPageTranscripts(null)).toBe('');
    expect(joinPageTranscripts([])).toBe('');
    expect(joinPageTranscripts([{ transcript: null }, {}])).toBe('');
  });
});

// ── computeCropRect ─────────────────────────────────────────────────────────

describe('computeCropRect', () => {
  const W = 2000;
  const H = 3000;

  it('converts a valid centered box to pixel coords', () => {
    // 0-1000 box covering x 100–900, y 100–500 → 80% × 40% = 32% area
    const rect = computeCropRect([100, 100, 500, 900], W, H);
    expect(rect).toEqual({ sx: 200, sy: 300, sw: 1600, sh: 1200 });
  });

  it('rejects boxes below the minimum area gate (15%)', () => {
    // 10% × 10% = 1% of page
    expect(computeCropRect([0, 0, 100, 100], W, H)).toBeNull();
  });

  it('rejects extreme aspect ratios', () => {
    // Full width, thin slice → aspect way over 2.5
    expect(computeCropRect([0, 0, 150, 1000], W, W)).toBeNull();
  });

  it('accepts a full-page box', () => {
    const rect = computeCropRect([0, 0, 1000, 1000], W, H);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: W, sh: H });
  });

  it('rejects inverted/invalid boxes and bad dims', () => {
    expect(computeCropRect([500, 500, 100, 900], W, H)).toBeNull();
    expect(computeCropRect([0, 0, 1000, 1000], 0, H)).toBeNull();
    expect(computeCropRect(null, W, H)).toBeNull();
    expect(computeCropRect(['a', 0, 1000, 1000], W, H)).toBeNull();
  });
});

// ── cleanOcrText ────────────────────────────────────────────────────────────

describe('cleanOcrText', () => {
  it('fixes the classic l→1 cup artifact and pipe noise', () => {
    const out = cleanOcrText('l cup flour\nsa|t and pepper');
    expect(out).toContain('1 cup flour');
    expect(out).toContain('salt and pepper');
  });

  it('drops symbol-noise lines but keeps real text', () => {
    const out = cleanOcrText('Chicken Parmesan\n@#$%^&*!!\n2 cups sauce');
    expect(out).toContain('Chicken Parmesan');
    expect(out).toContain('2 cups sauce');
    expect(out).not.toContain('@#$%');
  });
});

// ── PhotoImportError ────────────────────────────────────────────────────────

describe('PhotoImportError', () => {
  it('carries a machine-readable code', () => {
    const err = new PhotoImportError('nothing-readable', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('nothing-readable');
    expect(err.name).toBe('PhotoImportError');
  });
});
