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

const MIN_CAPTION = 30;

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
      signal: signal || AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return res.json();
  },
};

/**
 * Race the free caption sources; the first one with a real caption wins.
 * Returns { src, caption, images:[urls], title } or throws (Promise.any).
 */
function buildRace(url, f) {
  const shortcode = instagramShortcode(url);
  const attempts = [
    (async () => {
      const d = await f.apify(url);
      if (!d?.caption || d.caption.length <= MIN_CAPTION) throw new Error('apify-weak');
      const images = [d.displayUrl, ...(Array.isArray(d.images) ? d.images : [])].filter(Boolean);
      return { src: 'apify', caption: d.caption, images, title: d.ownerFullName || d.ownerUsername || '' };
    })(),
    (async () => {
      const oe = await f.oembed(url);
      if (!oe?.html) throw new Error('oembed-empty');
      const m = oe.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (!m) throw new Error('oembed-no-cap');
      const raw = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim();
      if (raw.length <= MIN_CAPTION) throw new Error('oembed-weak');
      return { src: 'oembed', caption: raw, images: oe.thumbnail_url ? [oe.thumbnail_url] : [], title: oe.author_name || '' };
    })(),
    ...(shortcode
      ? [(async () => {
          const det = await f.igJsonDetails(shortcode);
          const cap = det?.caption || (await f.igJson(shortcode));
          if (!cap || cap.length <= MIN_CAPTION) throw new Error('json-weak');
          return { src: 'ig-json', caption: cap, images: det?.imageUrl ? [det.imageUrl] : [], title: det?.title || '' };
        })()]
      : []),
  ];
  return Promise.any(attempts);
}

/**
 * acquireInstagramPack(url) → ContextPack | null.
 * Never throws; null means "all free sources failed" (caller proceeds to
 * embed page / browser assist exactly as before).
 */
export async function acquireInstagramPack(url, { fetchers = {}, signal } = {}) {
  const f = { ...defaultFetchers, ...fetchers };

  let winner = null;
  try {
    winner = await buildRace(url, f);
  } catch { /* race lost — try server fallback */ }

  if (!winner) {
    try {
      const body = await f.serverExtract(url, { signal });
      if (body?.ok && body.caption && body.caption.length > MIN_CAPTION) {
        winner = {
          src: body.acquiredVia || 'server-extract',
          caption: body.caption,
          images: Array.isArray(body.images) ? body.images : [],
          title: body.meta?.title || '',
        };
      }
    } catch { /* server unreachable */ }
  }

  if (!winner) return null;

  const pack = createContextPack({
    sourceUrl: url,
    sourceType: 'instagram',
    title: winner.title || '',
    caption: winner.caption, // RAW — recipeParser cleans it
    images: winner.images
      .filter(Boolean)
      .slice(0, 6)
      .map((u, i) => ({ url: u, kind: i === 0 ? 'hero' : 'carousel' })),
    acquiredVia: winner.src,
    confidence: winner.src === 'apify' ? 0.85 : winner.src === 'ig-json' ? 0.75 : 0.65,
  });
  addProvenance(pack, 'caption', winner.src, pack.confidence);
  if (pack.images.length) addProvenance(pack, 'images', winner.src);
  if (winner.title) addProvenance(pack, 'title', winner.src);
  return pack;
}
