// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: INSTAGRAM — parallel cheap race → ContextPack.
//
// Order of free tiers (spec §4 refinement D — Apify stays primary, the server
// /api/extract embed/?__a=1 path is its FALLBACK):
//   race( Apify ∥ oEmbed ∥ ig-json )  →  server /api/extract  →  null
//
// Emits a ContextPack with a RAW caption (recipeParser owns cleanSocialCaption
// — this module never imports recipeParser) plus carousel image candidates.
// Fetchers are injectable for the golden corpus.
// ─────────────────────────────────────────────────────────────────────────────
import {
  fetchInstagramViaApify,
  fetchInstagramOEmbed,
  fetchInstagramJson,
  fetchInstagramJsonDetails,
} from '../../api.js';
import { createContextPack, addProvenance } from '../contextPack.js';
import { extractEndpoint } from './website.js';
import { logImportTelemetry, domainForTelemetry } from '../../db.js';
import { validateApifyPayload } from '../../lib/importGuards.js';
import {
  MIN_CAPTION_LENGTH,
  MAX_CAROUSEL_IMAGES,
  CLIENT_EXTRACT_MS,
  ACQUIRE_WALL_CLOCK_MS,
} from '../../lib/importConfig.js';

export function instagramShortcode(url = '') {
  const m = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[2] : null;
}

const defaultFetchers = {
  apify: fetchInstagramViaApify,
  oembed: fetchInstagramOEmbed,
  igJson: fetchInstagramJson,
  igJsonDetails: fetchInstagramJsonDetails,
  serverExtract: async (url, { signal } = {}) => {
    const res = await fetch(extractEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: signal || AbortSignal.timeout(CLIENT_EXTRACT_MS),
    });
    if (!res.ok) return null;
    return res.json();
  },
};

/**
 * Race the free caption sources; the first one with a real caption wins.
 * Returns { src, caption, images:[urls], title } or throws (Promise.any).
 *
 * A shared AbortController cancels losing fetchers the moment a winner
 * resolves — prevents wasted rate-limit hits and (for Apify) paid runs
 * that nobody reads.
 */
function buildRace(url, f) {
  const shortcode = instagramShortcode(url);
  const raceCtrl = new AbortController();
  const { signal } = raceCtrl;

  const attempts = [
    (async () => {
      const d = await f.apify(url, { signal });
      // Validate Apify payload shape before trusting any fields
      const v = validateApifyPayload(d);
      if (!v.ok) throw new Error(`apify-${v.reason}`);
      if (!d?.caption || d.caption.length <= MIN_CAPTION_LENGTH) throw new Error('apify-weak');
      const images = [d.displayUrl, ...(Array.isArray(d.images) ? d.images : [])].filter(Boolean);
      const creator = d.ownerFullName || d.ownerUsername || '';
      return {
        src: 'apify', caption: d.caption, images, title: creator, author: creator,
        latestComments: Array.isArray(d.latestComments) ? d.latestComments : [],
        ownerUsername: d.ownerUsername || '',
        // Best-effort — see the defensive-extraction comment in
        // api/proxy.js's instagram-apify mode (harden-ideas-audit-2026-08-06.md §2).
        profileBioUrl: d.profileBioUrl || '',
        isVideo: !!d.isVideo || !!d.videoUrl,
      };
    })(),
    (async () => {
      const oe = await f.oembed(url, { signal });
      if (!oe?.html) throw new Error('oembed-empty');
      const m = oe.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (!m) throw new Error('oembed-no-cap');
      const raw = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim();
      if (raw.length <= MIN_CAPTION_LENGTH) throw new Error('oembed-weak');
      return { src: 'oembed', caption: raw, images: oe.thumbnail_url ? [oe.thumbnail_url] : [], title: oe.author_name || '', author: oe.author_name || '' };
    })(),
    ...(shortcode
      ? [(async () => {
          // 2026-08-14: igJsonDetails and igJson both hit the identical
          // /api/proxy?mode=instagram-json endpoint through the same
          // parseInstagramMediaJson() parser, so a falsy det.caption means
          // the endpoint genuinely had no caption — refetching via igJson
          // here used to duplicate the paid/rate-limited proxy call for a
          // result that was guaranteed to come back empty again.
          const det = await f.igJsonDetails(shortcode, { signal });
          const cap = det?.caption;
          if (!cap || cap.length <= MIN_CAPTION_LENGTH) throw new Error('json-weak');
          return { src: 'ig-json', caption: cap, images: det?.imageUrl ? [det.imageUrl] : [], title: det?.title || '' };
        })()]
      : []),
  ];

  // .finally() aborts on both success (cancel losers) and failure (cleanup).
  // On failure all promises have already settled so the abort is a no-op.
  return Promise.any(attempts).finally(() => raceCtrl.abort());
}

/**
 * acquireInstagramPack(url) → ContextPack | null.
 * Never throws; null means "all free sources failed" (caller proceeds to
 * embed page / browser assist exactly as before).
 */
export async function acquireInstagramPack(url, { fetchers = {}, signal } = {}) {
  const f = { ...defaultFetchers, ...fetchers };
  const t0 = Date.now();
  const domain = domainForTelemetry(url);

  // ── Hard wall-clock budget ────────────────────────────────────────────────
  // Cap the entire acquire phase (race + server-extract fallback) at 15 s so
  // a bad Apify run + retries can never burn 60-90 s of user-visible wait.
  // The budget signal is linked to any caller-supplied signal so either side
  // can cancel the whole thing.
  const budgetCtrl = new AbortController();
  const budgetTimer = setTimeout(() => budgetCtrl.abort(), ACQUIRE_WALL_CLOCK_MS);
  // Bridge caller signal → budget controller
  if (signal) {
    if (signal.aborted) { clearTimeout(budgetTimer); return null; }
    signal.addEventListener('abort', () => budgetCtrl.abort(), { once: true });
  }
  const budgetSignal = budgetCtrl.signal;

  let winner = null;
  try {
    winner = await buildRace(url, f);
  } catch (err) {
    if (budgetSignal.aborted && !signal?.aborted) {
      logImportTelemetry({
        stage: 'acquire', ok: false, reason: 'acquire-timeout',
        detail: `wall-clock budget (${ACQUIRE_WALL_CLOCK_MS}ms) expired during race`,
        domain, url, ms: Date.now() - t0,
      });
      clearTimeout(budgetTimer);
      return null;
    }
    // Promise.any throws AggregateError when ALL racers fail — log each
    // individual reason so future breakages are a 30-second diagnosis
    // instead of a multi-hour mystery.
    const reasons = err?.errors
      ? err.errors.map(e => e.message || String(e))
      : [err?.message || 'unknown'];
    logImportTelemetry({
      stage: 'acquire', ok: false, reason: 'race-lost',
      detail: reasons.join(' | '), domain, url, ms: Date.now() - t0,
    });
  }

  if (!winner && !budgetSignal.aborted) {
    try {
      const body = await f.serverExtract(url, { signal: budgetSignal });
      if (body?.ok && body.caption && body.caption.length > MIN_CAPTION_LENGTH) {
        winner = {
          src: body.acquiredVia || 'server-extract',
          caption: body.caption,
          images: Array.isArray(body.images) ? body.images : [],
          title: body.meta?.title || '',
        };
      }
    } catch (err) {
      if (budgetSignal.aborted && !signal?.aborted) {
        logImportTelemetry({
          stage: 'acquire', ok: false, reason: 'acquire-timeout',
          detail: `wall-clock budget (${ACQUIRE_WALL_CLOCK_MS}ms) expired during server-extract`,
          domain, url, ms: Date.now() - t0,
        });
        clearTimeout(budgetTimer);
        return null;
      }
      logImportTelemetry({
        stage: 'acquire', ok: false, reason: 'server-extract-failed',
        detail: err?.message || String(err), domain, url, ms: Date.now() - t0,
      });
    }
  }

  clearTimeout(budgetTimer);

  if (!winner) {
    logImportTelemetry({
      stage: 'acquire', ok: false,
      reason: budgetSignal.aborted ? 'acquire-timeout' : 'all-sources-failed',
      domain, url, ms: Date.now() - t0,
    });
    return null;
  }
  logImportTelemetry({
    stage: 'acquire', ok: true, domain, url, ms: Date.now() - t0, extractionSource: winner.src,
  });

  const pack = createContextPack({
    sourceUrl: url,
    sourceType: 'instagram',
    title: winner.title || '',
    author: winner.author || '',
    caption: winner.caption, // RAW — recipeParser cleans it
    images: winner.images
      .filter(Boolean)
      .slice(0, MAX_CAROUSEL_IMAGES)
      .map((u, i) => ({ url: u, kind: i === 0 ? 'hero' : 'carousel' })),
    acquiredVia: winner.src,
    confidence: winner.src === 'apify' ? 0.85 : winner.src === 'ig-json' ? 0.75 : 0.65,
  });
  addProvenance(pack, 'caption', winner.src, pack.confidence);
  if (pack.images.length) addProvenance(pack, 'images', winner.src);
  if (winner.title) addProvenance(pack, 'title', winner.src);
  // Blog link follower discovery surface: comments + profile bio URL
  pack.latestComments = winner.latestComments || [];
  pack.ownerUsername = winner.ownerUsername || '';
  pack.profileBioUrl = winner.profileBioUrl || '';
  pack.isVideo = !!winner.isVideo;
  return pack;
}
