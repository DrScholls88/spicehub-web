// ─────────────────────────────────────────────────────────────────────────────
// IMPORT IMAGES — carousel persistence + hero selection with a vision gate.
//
// Spec §7 + refinement C:
//   • Persist up to 6 carousel images as data URLs so nothing ever 403s later.
//   • Before accepting a frame/thumbnail as the hero, run FREE heuristics
//     first (profile pics, logos, sprites); only when heuristics are
//     inconclusive AND the caller asks for it, spend one Gemini vision call to
//     reject text-cards/logos and prefer plated-dish shots.
//
// No imports from recipeParser (acyclic). Persistence is injected (persistFn)
// so this module stays testable without the network.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_CAROUSEL = 6;
const VISION_TIMEOUT_MS = 9000;
const VISION_MODEL = 'gemini-2.0-flash-lite';

// ── Free heuristics ───────────────────────────────────────────────────────────
const REJECT_URL_RE = /(profile_pic|profile_images|\/pp\/|avatar|favicon|sprite|logo[-_.]|[-_.]logo|badge|icon[-_.]|[-_.]icon|placeholder|blank\.|spacer\.|1x1\.|pixel\.)/i;
const ACCEPT_URL_RE = /(scontent|cdninstagram|fbcdn|wp-content\/uploads|\/media\/|images\/recipe|food|dish|hero)/i;

/**
 * Zero-cost screening of an image URL.
 * @returns {'accept'|'reject'|'unsure'}
 */
export function gateImageHeuristics(url = '') {
  const u = String(url || '');
  if (!u || u.length < 8) return 'reject';
  if (u.startsWith('data:image/')) return 'accept'; // already persisted bytes
  if (REJECT_URL_RE.test(u)) return 'reject';
  // Tiny thumbnails advertised in the URL (IG size suffixes like /s150x150/)
  if (/\/[sp]\d{2,3}x\d{2,3}\//.test(u)) return 'reject';
  if (ACCEPT_URL_RE.test(u)) return 'accept';
  return 'unsure';
}

/**
 * One Gemini vision call: "is this a photo of food / a plated dish?"
 * Returns true (dish), false (text card / logo / profile / not food),
 * or null when the check itself failed (caller should accept optimistically —
 * a wrongly rejected photo hurts more than a mediocre one).
 */
export async function visionValidateDishPhoto(imageDataUrl, { clientKey: keyOverride } = {}) {
  const clientKey =
    keyOverride ||
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null);
  if (!clientKey || !imageDataUrl?.startsWith('data:image/')) return null;
  const base64 = imageDataUrl.split(',')[1];
  if (!base64) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${clientKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              {
                text:
                  'Answer with exactly one word. Is this image primarily a photo of food, ' +
                  'a drink, or a plated dish (YES), or is it primarily text, a recipe card ' +
                  'screenshot, a logo, a watermark, or a person/profile picture (NO)?',
              },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 4 },
        }),
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || '';
    if (answer.startsWith('YES')) return true;
    if (answer.startsWith('NO')) return false;
    return null;
  } catch {
    return null;
  }
}

/** Normalize a candidate (string url or {url,dataUrl,kind}) to an object. */
function toCandidate(c) {
  if (!c) return null;
  if (typeof c === 'string') return { url: c, dataUrl: '', kind: 'carousel' };
  return { url: c.url || '', dataUrl: c.dataUrl || '', kind: c.kind || 'carousel' };
}

/**
 * Persist up to MAX_CAROUSEL candidates as data URLs via the injected
 * persistFn(url) → dataUrl|url. Heuristic rejects are dropped; persistence
 * failures keep the original URL (SafeMediaImage's proxy tiers handle it).
 * @returns {Promise<Array<{url:string,dataUrl:string,kind:string}>>}
 */
export async function persistCarousel(candidates = [], persistFn, { max = MAX_CAROUSEL } = {}) {
  const seen = new Set();
  const kept = [];
  for (const raw of candidates) {
    const c = toCandidate(raw);
    if (!c || !c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    if (gateImageHeuristics(c.dataUrl || c.url) === 'reject') continue;
    kept.push(c);
    if (kept.length >= max) break;
  }

  const persisted = await Promise.all(
    kept.map(async (c) => {
      if (c.dataUrl) return c;
      if (typeof persistFn !== 'function') return c;
      try {
        const out = await persistFn(c.url);
        return { ...c, dataUrl: typeof out === 'string' && out.startsWith('data:') ? out : '' };
      } catch {
        return c;
      }
    }),
  );
  return persisted;
}

/**
 * Choose the hero image from candidates.
 * Heuristics run free on every candidate; the vision gate runs on AT MOST ONE
 * image (the front-runner) and only when `useVision` is set (video-only reels,
 * og-fallback frames). Order of preference: heuristic-accept → unsure.
 * @returns {Promise<{url:string,dataUrl:string,gated:'heuristic'|'vision'|'optimistic'}|null>}
 */
export async function selectHeroImage(candidates = [], { persistFn, clientKey, useVision = false } = {}) {
  const pool = candidates.map(toCandidate).filter((c) => c && c.url);
  if (pool.length === 0) return null;

  const accepted = pool.filter((c) => gateImageHeuristics(c.dataUrl || c.url) === 'accept');
  const unsure = pool.filter((c) => gateImageHeuristics(c.dataUrl || c.url) === 'unsure');
  const ranked = [...accepted, ...unsure];
  if (ranked.length === 0) return null;

  const front = ranked[0];

  // Persist the front-runner first — the vision gate needs bytes, and the
  // caller needs a durable hero anyway.
  let dataUrl = front.dataUrl;
  if (!dataUrl && typeof persistFn === 'function') {
    try {
      const out = await persistFn(front.url);
      if (typeof out === 'string' && out.startsWith('data:')) dataUrl = out;
    } catch { /* keep url-only */ }
  }

  if (!useVision || !dataUrl) {
    return { url: front.url, dataUrl: dataUrl || '', gated: 'heuristic' };
  }

  const verdict = await visionValidateDishPhoto(dataUrl, { clientKey });
  if (verdict === false) {
    // Rejected: try the next-ranked candidate WITHOUT another vision spend.
    for (const alt of ranked.slice(1)) {
      if (gateImageHeuristics(alt.dataUrl || alt.url) !== 'reject') {
        let altData = alt.dataUrl;
        if (!altData && typeof persistFn === 'function') {
          try {
            const out = await persistFn(alt.url);
            if (typeof out === 'string' && out.startsWith('data:')) altData = out;
          } catch { /* keep url-only */ }
        }
        return { url: alt.url, dataUrl: altData || '', gated: 'vision' };
      }
    }
    return null; // every option looked like text/logo — better no image than junk
  }

  return { url: front.url, dataUrl, gated: verdict === true ? 'vision' : 'optimistic' };
}
