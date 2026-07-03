// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS MAP — one place that turns raw engine progress strings into the
// three-stage import timeline (spec §10):
//
//     Fetching  →  Understanding  →  Polishing
//
// Also derives the tier chip ("via Apify", "via JSON-LD") from the messages
// the acquisition tiers emit. Pure module: no React, no network — pinned by
// tests/import/corpus.progress.test.js so UI copy changes can't silently
// break the timeline.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGES = ['Fetching', 'Understanding', 'Polishing'];
export const STAGE = { FETCHING: 0, UNDERSTANDING: 1, POLISHING: 2 };

// Order matters: first match wins. Later-stage patterns are listed first so
// e.g. "Structuring page content with AI" hits POLISHING before the generic
// "page" fetch pattern.
const STAGE_RULES = [
  // ── Fetching probes that would otherwise false-positive later rules ──
  { stage: STAGE.FETCHING, re: /^checking (the )?video|video subtitles/i },
  // ── Polishing: the model is structuring / finalizing ──
  // ("structuring", never bare "structur" — "structured data endpoints" is an
  //  Understanding-phase probe and must not skip the timeline ahead.)
  { stage: STAGE.POLISHING, re: /structuring|recipe structured|gemini|✨|organiz|polish|reconcil|finaliz/i },
  { stage: STAGE.POLISHING, re: /\bai\b.*(extract|structur|content)|(extract|structur).*\bai\b/i },
  // ── Understanding: we have material and are reading/parsing it ──
  { stage: STAGE.UNDERSTANDING, re: /caption (found|captured)|: caption \(/i },
  { stage: STAGE.UNDERSTANDING, re: /transcrib|transcript|subtitle|audio|whisper|asr/i },
  { stage: STAGE.UNDERSTANDING, re: /json.?ld|schema|structured data|recipe data|markdown|parsing|reading|endpoints/i },
  { stage: STAGE.UNDERSTANDING, re: /browser.?assist|browser-assisted|extraction found/i },
  // ── Fetching: acquiring bytes from somewhere ──
  { stage: STAGE.FETCHING, re: /fetch|connect|request|loading|checking|trying|^extracting\b|extracting via|via spicehub|server|proxy|embed|oembed|instagram|reel|quick extraction|multiple extraction|video/i },
];

// Tier chips — the acquisition method that is doing/did the work.
const CHIP_RULES = [
  { chip: 'Apify',        re: /^apify:|via apify|\bapify\b/i },
  { chip: 'JSON-LD',      re: /json.?ld|structured data found/i },
  { chip: 'Embed',        re: /^oembed:|^embed|instagram embed|embed extraction|trying embed/i },
  { chip: 'IG data',      re: /^ig-json:|ig-json/i },
  { chip: 'Video audio',  re: /transcrib|whisper|subtitle|audio/i },
  { chip: 'SpiceHub server', re: /via spicehub server|server-side|server extraction|ig-embed/i },
  { chip: 'Reddit',       re: /reddit/i },
  { chip: 'Gemini',       re: /gemini|✨|structuring|ai extraction/i },
];

/**
 * Map one raw progress message to timeline state.
 * @returns {{ stage: number|null, chip: string|null }}
 *   stage null = message doesn't move the timeline (keep current stage)
 */
export function mapProgress(rawMsg = '') {
  const msg = String(rawMsg || '');
  if (!msg.trim()) return { stage: null, chip: null };

  let stage = null;
  for (const rule of STAGE_RULES) {
    if (rule.re.test(msg)) { stage = rule.stage; break; }
  }
  let chip = null;
  for (const rule of CHIP_RULES) {
    if (rule.re.test(msg)) { chip = rule.chip; break; }
  }
  return { stage, chip };
}

/**
 * Reducer used by the ImportSheet: stages only move FORWARD during one import
 * (a late "fetching…" retry message must not rewind a timeline already in
 * Understanding — regressing feels broken even when technically true).
 */
export function advanceTimeline(current, rawMsg) {
  const { stage, chip } = mapProgress(rawMsg);
  return {
    stage: stage === null ? current.stage : Math.max(current.stage, stage),
    chip: chip || current.chip,
  };
}

/** Friendly chip for a FINISHED import, from recipe._extractedVia/_structuredVia. */
export function chipFromVia(via = '') {
  const v = String(via || '').toLowerCase();
  if (!v) return null;
  if (v.includes('extract:json-ld')) return 'JSON-LD';
  if (v.includes('extract:microdata')) return 'Microdata';
  if (v.includes('extract:')) return 'SpiceHub server';
  if (v.includes('apify')) return 'Apify';
  if (v.includes('gemini-pack')) return 'Gemini';
  if (v.includes('yt-dlp')) return 'Video audio';
  if (v.includes('json-ld')) return 'JSON-LD';
  if (v.includes('caption')) return 'Caption';
  if (v.includes('reddit')) return 'Reddit';
  if (v.includes('gemini')) return 'Gemini';
  if (v.includes('deterministic')) return 'On-device';
  return null;
}

export const INITIAL_TIMELINE = Object.freeze({ stage: 0, chip: null });
