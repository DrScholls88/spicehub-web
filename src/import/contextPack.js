// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT PACK — the seam between acquisition and structuring.
//
// Every acquisition module (website, instagram, reddit, video) emits exactly
// this shape. The structuring layer (structure/gemini.js) consumes it and
// nothing else. Spec: docs/superpowers/specs/2026-07-02-import-engine-unification-design.md §5.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ContextPack
 * @property {string}  sourceUrl
 * @property {'instagram'|'website'|'reddit'|'video'|'text'} sourceType
 * @property {string}  title        best-known title hint
 * @property {string|null} caption  cleaned social caption
 * @property {string|null} transcript ASR / subtitle text
 * @property {string|null} markdown  Readability-isolated page content
 * @property {object|null} jsonLd    raw Schema.org Recipe node when found
 * @property {object|null} candidate parsed recipe candidate from structured data
 * @property {Array<{url:string,dataUrl?:string,kind:'hero'|'carousel'|'frame'}>} images
 * @property {Array<{field:string,via:string,confidence?:number}>} provenance
 * @property {string}  acquiredVia  winning tier, e.g. 'json-ld', 'apify', 'embed'
 * @property {number}  confidence   overall acquisition confidence 0–1
 */

/** Build a normalized ContextPack with safe defaults. */
export function createContextPack(fields = {}) {
  return {
    sourceUrl: fields.sourceUrl || '',
    sourceType: fields.sourceType || 'text',
    title: fields.title || '',
    caption: fields.caption || null,
    transcript: fields.transcript || null,
    markdown: fields.markdown || null,
    jsonLd: fields.jsonLd || null,
    candidate: fields.candidate || null,
    images: Array.isArray(fields.images) ? fields.images : [],
    provenance: Array.isArray(fields.provenance) ? fields.provenance : [],
    acquiredVia: fields.acquiredVia || 'none',
    confidence: typeof fields.confidence === 'number' ? fields.confidence : 0,
  };
}

/** Append a provenance entry (field origin + optional 0–1 confidence). */
export function addProvenance(pack, field, via, confidence) {
  pack.provenance.push(
    typeof confidence === 'number' ? { field, via, confidence } : { field, via },
  );
  return pack;
}

/**
 * A candidate is COMPLETE when structured data alone yields a full recipe:
 * title + ingredients + directions all present. Complete candidates skip the
 * model on the fast path and unlock verifier mode when the model IS called.
 */
export function packHasCompleteCandidate(pack) {
  const c = pack?.candidate;
  return !!(
    c &&
    (c.name || c.title) &&
    Array.isArray(c.ingredients) && c.ingredients.length >= 2 &&
    Array.isArray(c.directions) && c.directions.length >= 1
  );
}

// ── Prompt budgets (chars). JSON-LD is never tail-trimmed — it is the most
// reliable signal. Markdown absorbs the remainder and trims from the tail
// (comments/related-posts noise lives at the bottom of pages).
export const PACK_BUDGET = {
  total: 50000,
  caption: 6000,
  transcript: 14000,
  jsonLd: 12000,
};

/**
 * Render the pack into provenance-labeled prompt sections.
 * Only sections that exist are included. Returns { text, sections } where
 * sections lists which labels were emitted (for tests + logging).
 */
export function buildPackSections(pack) {
  const parts = [];
  const sections = [];
  let used = 0;

  const push = (label, body, cap) => {
    if (!body) return;
    const trimmed = String(body).slice(0, cap);
    parts.push(`${label}:\n${trimmed}`);
    sections.push(label);
    used += trimmed.length + label.length + 2;
  };

  push('CAPTION', pack.caption, PACK_BUDGET.caption);
  push('TRANSCRIPT', pack.transcript, PACK_BUDGET.transcript);

  if (pack.jsonLd) {
    let json;
    try {
      json = JSON.stringify(pack.jsonLd, null, 1);
    } catch {
      json = null;
    }
    // JSON-LD gets its full budget; if a pathological blob exceeds it we still
    // send the head — truncated JSON is fine as *context* (never re-parsed).
    push('STRUCTURED DATA FOUND (Schema.org JSON-LD)', json, PACK_BUDGET.jsonLd);
  }

  const remainder = Math.max(4000, PACK_BUDGET.total - used);
  push('PAGE CONTENT (markdown)', pack.markdown, remainder);

  return { text: parts.join('\n\n---\n\n'), sections };
}
