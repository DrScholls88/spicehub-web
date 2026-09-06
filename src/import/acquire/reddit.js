// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: REDDIT — text post → ContextPack, link post → nested blog acquire.
//
// Wraps redditDiscovery. For link-posts (short selftext + external URL), nests
// into acquireBlogPack — one pack out, per the brief. This supersedes the
// hole-D recursion through parseFromUrl: the recursion becomes a nested
// acquire returning one pack instead of a self-call.
// ─────────────────────────────────────────────────────────────────────────────
import { isRedditPostUrl, extractRedditPost } from '../../scrapers/redditDiscovery.js';
import { acquireBlogPack } from './blog.js';
import { createContextPack, addProvenance } from '../contextPack.js';

/** Short-text threshold — below this a link-post body is considered empty. */
const LINK_POST_TEXT_CAP = 50;

/**
 * Acquire a ContextPack from a Reddit post URL.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object|null>} ContextPack or null on failure
 */
export async function acquireRedditPack(url, { signal, onProgress = () => {} } = {}) {
  if (!isRedditPostUrl(url)) return null;

  onProgress('Fetching Reddit post…');
  const postData = await extractRedditPost(url);
  if (!postData) return null;

  // ── Link post: external URL with minimal selftext → nest into blog ──
  const isLinkPost =
    postData.link &&
    !postData.link.includes('reddit.com') &&
    (postData.rawText || '').trim().length < LINK_POST_TEXT_CAP;

  if (isLinkPost) {
    onProgress('Following Reddit link post…');
    const blogPack = await acquireBlogPack(postData.link, { signal, onProgress });
    if (blogPack) {
      // Enrich with Reddit metadata — the source is the Reddit post, not the blog.
      blogPack.sourceUrl = url;
      blogPack.title = blogPack.title || postData.name;
      if (postData.imageUrl && !blogPack.images.length) {
        blogPack.images.push({ url: postData.imageUrl, kind: 'hero' });
      }
      addProvenance(blogPack, 'source', 'reddit-link-post');
      return blogPack;
    }
    // Blog fetch failed — fall through to use whatever reddit text we have.
  }

  // ── Text post or link-post fallback ──
  const images = (postData.images || []).map((imgUrl, i) => ({
    url: imgUrl,
    kind: i === 0 ? 'hero' : 'carousel',
  }));

  const pack = createContextPack({
    sourceUrl: url,
    sourceType: 'reddit',
    title: postData.name || '',
    caption: null,
    markdown: postData.rawText || null,
    images,
    acquiredVia: postData._extractedVia || 'reddit-json',
    confidence: 0.6,
  });

  addProvenance(pack, 'markdown', 'reddit-json');
  if (images.length) addProvenance(pack, 'images', 'reddit');
  if (postData.name) addProvenance(pack, 'title', 'reddit');

  // Carry the canonical link for downstream attribution.
  pack.link = postData.link || url;

  return pack;
}
