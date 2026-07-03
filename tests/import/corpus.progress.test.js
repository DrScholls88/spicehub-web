// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — progressMap: raw engine messages → three-stage timeline.
// Every message the pipeline emits must land on the right stage; UI copy
// changes that break the timeline fail HERE, not in the field.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  mapProgress,
  advanceTimeline,
  chipFromVia,
  STAGES,
  STAGE,
  INITIAL_TIMELINE,
} from '../../src/import/progressMap.js';

describe('progressMap — stage classification', () => {
  const CASES = [
    // Real strings emitted by the pipeline today → expected stage
    ['Getting your recipe…',                          null],           // no signal, keep current
    ['Extracting via SpiceHub server...',             STAGE.FETCHING],
    ['Extracting recipe from page...',                STAGE.FETCHING],
    ['Trying Instagram embed extraction...',          STAGE.FETCHING],
    ['Trying multiple extraction methods…',           STAGE.FETCHING],
    ['Fetching Reddit post via JSON API...',          STAGE.FETCHING],
    ['Checking video subtitles...',                   STAGE.FETCHING],
    ['Quick extraction failed — trying embed…',       STAGE.FETCHING],
    ['apify: caption (843 chars)',                    STAGE.UNDERSTANDING],
    ['Caption found ✔',                               STAGE.UNDERSTANDING],
    ['Checking for structured data endpoints...',     STAGE.UNDERSTANDING],
    ['Trying AI extraction with Markdown conversion...', STAGE.POLISHING],
    ['Structuring page content with AI...',           STAGE.POLISHING],
    ['✨ Structuring recipe with Gemini…',            STAGE.POLISHING],
    ['Transcript: 1240 chars — structuring recipe…',  STAGE.POLISHING],
    ['No caption found — transcribing video audio…',  STAGE.UNDERSTANDING],
    ['Recipe structured successfully!',               STAGE.POLISHING],
  ];

  for (const [msg, expected] of CASES) {
    it(`"${msg}" → ${expected === null ? 'no move' : STAGES[expected]}`, () => {
      expect(mapProgress(msg).stage).toBe(expected);
    });
  }
});

describe('progressMap — tier chips', () => {
  it('derives chips from acquisition messages', () => {
    expect(mapProgress('apify: caption (843 chars)').chip).toBe('Apify');
    expect(mapProgress('ig-json: caption (400 chars)').chip).toBe('IG data');
    expect(mapProgress('Checking video subtitles...').chip).toBe('Video audio');
    expect(mapProgress('✨ Structuring recipe with Gemini…').chip).toBe('Gemini');
    expect(mapProgress('Fetching Reddit post via JSON API...').chip).toBe('Reddit');
  });

  it('chipFromVia maps final _extractedVia values', () => {
    expect(chipFromVia('extract:json-ld')).toBe('JSON-LD');
    expect(chipFromVia('extract:microdata')).toBe('Microdata');
    expect(chipFromVia('extract:og-meta')).toBe('SpiceHub server');
    expect(chipFromVia('gemini-pack:extract')).toBe('Gemini');
    expect(chipFromVia('yt-dlp+ai')).toBe('Video audio');
    expect(chipFromVia('caption-ai')).toBe('Caption');
    expect(chipFromVia('')).toBeNull();
  });
});

describe('progressMap — advanceTimeline (forward-only)', () => {
  it('advances through a realistic message sequence', () => {
    let t = INITIAL_TIMELINE;
    t = advanceTimeline(t, 'Extracting via SpiceHub server...');
    expect(t.stage).toBe(STAGE.FETCHING);
    t = advanceTimeline(t, 'apify: caption (600 chars)');
    expect(t.stage).toBe(STAGE.UNDERSTANDING);
    expect(t.chip).toBe('Apify');
    t = advanceTimeline(t, '✨ Structuring recipe with Gemini…');
    expect(t.stage).toBe(STAGE.POLISHING);
    // Chip upgrades to the latest tier doing work:
    expect(t.chip).toBe('Gemini');
  });

  it('NEVER rewinds: a late fetch retry cannot drag the timeline backwards', () => {
    let t = { stage: STAGE.POLISHING, chip: 'Gemini' };
    t = advanceTimeline(t, 'Trying direct extraction...');
    expect(t.stage).toBe(STAGE.POLISHING);
  });

  it('unknown messages keep both stage and chip', () => {
    const t = advanceTimeline({ stage: 1, chip: 'Apify' }, 'zzz nonsense zzz');
    expect(t).toEqual({ stage: 1, chip: 'Apify' });
  });
});
