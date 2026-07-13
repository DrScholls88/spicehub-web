/**
 * SpiceHub — Reddit Discovery Scraper
 *
 * Strategy: Reddit's `.json` endpoint shape (same path structure whether
 * fetched anonymously from www.reddit.com or authenticated from
 * oauth.reddit.com) — `?raw_json=1` keeps Unicode from being HTML-entity-
 * encoded either way.
 *
 * Tier hierarchy:
 *   1. Specific post URL → .json endpoint → extract recipe from selftext / title
 *   2. Subreddit discovery → /r/{sub}/new.json → surface recipe links for import
 *
 * AUTH HISTORY (read before changing fetchRedditJson):
 *   - Originally zero-auth: anonymous fetches to www.reddit.com/*.json.
 *   - 2026-07-07: fixed a CORS/proxy-cascade bug (fetchJsonViaProxy below),
 *     but prod logs (2026-07-08) kept showing 403s AT THE PROXY LEVEL — Reddit
 *     is blocking anonymous/unauthenticated requests from cloud/datacenter IP
 *     ranges (including Vercel's), which no header tuning can fix.
 *   - 2026-07-08: added api/reddit.js — a server-side OAuth2 app-only
 *     (client_credentials) proxy. This is Reddit's officially sanctioned path
 *     for automated read access and is now the PRIMARY server attempt in
 *     fetchRedditJson below. Requires the site owner to register a Reddit
 *     "script" app and set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET on Vercel
 *     (see api/reddit.js's header comment) — until that's done, api/reddit.js
 *     returns 503 and this file falls back to the old anonymous proxy
 *     cascade, which may still 403.
 *
 * CORS note: the direct browser fetch attempt below is kept as a fast
 * opportunistic first try (it fails near-instantly on a CORS block, so it
 * doesn't eat the timeout budget) — CORS is a browser-only restriction, so
 * server-to-server requests (api/reddit.js, or the old proxy cascade) aren't
 * subject to it at all regardless of what Reddit's CORS headers say.
 *
 * Deliberately NOT reusing the generic fetchHtmlViaProxy() from api.js for
 * the anonymous fallback: that helper is tuned for scraping HTML pages
 * (bot-wall regexes, a >1000-char gate, a `!text.includes('"error"')`
 * heuristic that can false-positive on legitimate JSON containing that
 * substring) and stacks its OWN internal-proxy-then-7-public-proxies cascade
 * on top of whatever the caller already tried — for Reddit that produced up
 * to ~60s of worst-case latency across nested timeout budgets. fetchJsonViaProxy()
 * below is a small, JSON-specific, tightly time-bounded cascade instead.
 */

import { fetchJsonViaProxy } from '../api.js';

// ─── Detectors ────────────────────────────────────────────────────────────────

/**
 * Returns true if the URL is a reddit.com URL.
 */
export function isRedditUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'reddit.com' || host === 'old.reddit.com' || host === 'redd.it';
  } catch {
    return false;
  }
}

/**
 * Returns true if the URL points to a specific reddit post/comments page.
 * e.g. https://www.reddit.com/r/recipes/comments/abc123/chicken_tikka/
 */
export function isRedditPostUrl(url) {
  try {
    const u = new URL(url);
    // Handle redd.it short links: https://redd.it/abc123
    if (u.hostname === 'redd.it') return true;
    // Standard comments URL
    return /\/r\/\w+\/comments\//.test(u.pathname);
  } catch {
    return false;
  }
}

// ─── Core fetch helper ────────────────────────────────────────────────────────

/**
 * Attempt a fetch through our OAuth2-authenticated Reddit proxy (api/reddit.js).
 * Returns the parsed JSON on success, or null on ANY failure (not configured,
 * bad credentials, network error, non-2xx, invalid JSON) so the caller can
 * fall through to the next tier without needing to distinguish why.
 */
async function fetchViaRedditOAuth(url, timeoutMs) {
  const path = url.pathname + url.search; // e.g. /r/recipes/new.json?raw_json=1&limit=25
  const proxyUrl = `/api/reddit?path=${encodeURIComponent(path)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(proxyUrl, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!resp.ok) {
      console.log(`[reddit] OAuth proxy returned ${resp.status} — trying anonymous cascade`);
      return null;
    }
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    clearTimeout(timer);
    console.log(`[reddit] OAuth proxy failed (${e.message}) — trying anonymous cascade`);
    return null;
  }
}

/**
 * Fetch Reddit JSON: direct browser fetch first, then our OAuth-authenticated
 * proxy (the reliable path — see the AUTH HISTORY note atop this file), then
 * the old anonymous proxy cascade as a last resort for before OAuth is
 * configured. Adds required `raw_json=1` param so Unicode isn't
 * HTML-entity-encoded.
 *
 * timeoutMs is a PER-ATTEMPT budget, not a total — each tier gets its own
 * attempt(s) at this same per-attempt timeout. Kept short (default 6s)
 * because a CORS block or a proxy timing out should fail fast, not eat the
 * whole budget a "Discover" browsing UI can reasonably keep someone waiting on.
 */
export async function fetchRedditJson(redditJsonUrl, timeoutMs = 6000) {
  const url = new URL(redditJsonUrl);
  url.searchParams.set('raw_json', '1');
  const fullUrl = url.toString();

  // Attempt 1: direct browser fetch. Kept as a fast opportunistic try — when
  // Reddit doesn't grant CORS for this origin the browser rejects as soon as
  // response headers arrive, not after the full timeout, so this is cheap
  // even when it fails. See the CORS note atop this file.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(fullUrl, {
      signal: ctrl.signal,
      headers: {
        // Reddit's API guidelines require a descriptive User-Agent
        'User-Agent': 'SpiceHub/1.0 (recipe-import; client-side PWA)',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const json = await resp.json();
      return json;
    }
  } catch (e) {
    console.log(`[reddit] Direct fetch failed (${e.message}) — trying OAuth proxy`);
  }

  // Attempt 2: our OAuth2-authenticated proxy — the sanctioned, reliable
  // path (see AUTH HISTORY above). Falls through to attempt 3 on ANY failure,
  // including "not configured yet" (503).
  const oauthResult = await fetchViaRedditOAuth(url, timeoutMs);
  if (oauthResult) return oauthResult;

  // Attempt 3: last-resort anonymous proxy cascade. CORS is a browser-only
  // restriction — a server (our /api/proxy Vercel fn, or a public proxy)
  // fetching Reddit isn't subject to it at all — but Reddit may still block
  // this tier by IP regardless of CORS/headers (that's why attempt 2 exists).
  return fetchJsonViaProxy(fullUrl, timeoutMs);
}

// ─── Post extraction ──────────────────────────────────────────────────────────

/**
 * Reddit gallery posts (is_gallery: true) carry their photos in
 * gallery_data.items (ordered media IDs) + media_metadata (per-ID size
 * variants) instead of the single `preview.images[0]` a normal post has.
 * Returns an ordered array of full-resolution image URLs (may be empty).
 */
function extractGalleryImages(post) {
  if (!post?.gallery_data?.items?.length || !post?.media_metadata) return [];
  const urls = [];
  for (const item of post.gallery_data.items) {
    const meta = post.media_metadata[item.media_id];
    if (!meta || meta.status !== 'valid') continue;
    // s = source (highest res); p = ordered preview sizes, smallest→largest.
    const src = meta.s?.u || meta.s?.gif || meta.p?.[meta.p.length - 1]?.u;
    if (src) urls.push(String(src).replace(/&amp;/g, '&'));
  }
  return urls;
}

/**
 * Given a specific Reddit post URL, extract recipe content via the .json endpoint.
 *
 * The .json response structure for a comments page is:
 *   [ listing(post), listing(comments) ]
 *   listing.data.children[0].data = { title, selftext, url, thumbnail, ... }
 *
 * Returns a partial recipe object
 *   { name, rawText, imageUrl, images, link, _extractedVia }
 * or null on failure. `images` is the full ordered list of candidate photo
 * URLs (gallery posts can have several; normal posts have 0 or 1) so the
 * caller can offer a cover picker instead of only ever seeing one photo.
 *
 * NOTE: This returns rawText (not structured ingredients/directions) intentionally.
 * The caller (recipeParser.parseFromUrl) should pass rawText to structureWithAI or
 * parseCaption for structuring. This keeps concerns separated.
 */
export async function extractRedditPost(url) {
  console.log(`[reddit] Extracting post: ${url}`);

  // Normalize to .json URL
  let jsonUrl;
  try {
    const u = new URL(url);
    // redd.it short links don't support .json directly — use reddit.com form
    if (u.hostname === 'redd.it') {
      // redd.it/abc123 → www.reddit.com/comments/abc123.json
      const id = u.pathname.replace(/^\//, '');
      jsonUrl = `https://www.reddit.com/comments/${id}.json`;
    } else {
      // Remove trailing slash, add .json
      const cleanPath = u.pathname.replace(/\/$/, '');
      jsonUrl = `https://www.reddit.com${cleanPath}.json`;
    }
  } catch {
    return null;
  }

  const data = await fetchRedditJson(jsonUrl);
  if (!data || !Array.isArray(data) || data.length < 1) return null;

  // The first element is the post listing
  const postListing = data[0];
  const post = postListing?.data?.children?.[0]?.data;
  if (!post) return null;

  const { title = '', selftext = '', url: postUrl, crosspost_parent_list: crosspostParents } = post;

  // Crossposts often carry no body/media of their own — the real recipe
  // content (selftext + photos) lives on the original post being shared.
  // Fall back to it when the visible post has nothing of its own to extract.
  const hasOwnContent = !!(selftext || post.is_gallery || post.preview);
  const mediaSource = (!hasOwnContent && crosspostParents?.[0]) ? crosspostParents[0] : post;
  const effectiveSelftext = mediaSource.selftext || selftext;
  const { thumbnail, preview } = mediaSource;

  // Reconstruct full Reddit URL (handles old.reddit.com links etc.)
  const canonicalUrl = postUrl?.includes('reddit.com')
    ? postUrl
    : `https://www.reddit.com${new URL(url).pathname}`;

  // Extract image(s). Gallery posts (is_gallery) can have several photos —
  // e.g. an ingredients shot + the plated dish — surfaced as `images` below
  // so the review screen can offer a cover picker instead of guessing one.
  const galleryImages = mediaSource.is_gallery ? extractGalleryImages(mediaSource) : [];
  let imageUrl = '';
  if (galleryImages.length > 0) {
    imageUrl = galleryImages[0];
  } else if (preview?.images?.[0]?.source?.url) {
    // Preview images from Reddit's own CDN (highest quality available)
    imageUrl = preview.images[0].source.url.replace(/&amp;/g, '&');
  } else if (thumbnail && thumbnail !== 'self' && thumbnail !== 'default' && thumbnail.startsWith('http')) {
    imageUrl = thumbnail;
  }
  const images = galleryImages.length > 0 ? galleryImages : (imageUrl ? [imageUrl] : []);

  // The selftext is the body of the post — it contains the recipe in Markdown already
  // Reddit already stores post bodies as Markdown, so no Turndown needed.
  const rawText = [title, effectiveSelftext].filter(Boolean).join('\n\n');

  if (!rawText || rawText.trim().length < 20) {
    console.log('[reddit] Post has no usable text content');
    return null;
  }

  console.log(`[reddit] Extracted post — title: "${title}", selftext: ${selftext.length} chars`);

  return {
    name: title || 'Reddit Recipe',
    rawText,
    imageUrl,
    images,
    link: canonicalUrl || url,
    _extractedVia: 'reddit-json',
    _isMarkdown: true, // Reddit selftext is already Markdown
  };
}

// ─── Subreddit discovery ──────────────────────────────────────────────────────

/**
 * Discover recent recipe posts from a subreddit via the .json endpoint.
 *
 * Good recipe subreddits: recipes, EatCheapAndHealthy, Cooking, MealPrepSunday,
 *   AskCulinary, veganrecipes, ketorecipes, vegetarian
 *
 * Pagination: Reddit's listing endpoints use a cursor (`after`), not page
 * numbers — each response includes the fullname of the last item (e.g.
 * "t3_abc123") to pass back as `after` on the next call to continue where
 * you left off. There's no "page 2" URL; passing the previous response's
 * `after` value is the only supported way to advance. See
 * https://www.reddit.com/dev/api#listings for the underlying shape.
 *
 * @param {string} subreddit - Subreddit name without /r/ prefix (default: 'recipes')
 * @param {string} sort - 'new' | 'hot' | 'top' (default: 'new')
 * @param {number} limit - Number of posts to return (max 100, default: 25)
 * @param {string|null} after - Cursor from a previous call's returned `after`
 *   (null/omitted for the first page)
 * @returns {{ posts: Array<{ title, url, selftext, thumbnail, author, score, subreddit }>, after: string|null }}
 *   `after` is null when Reddit reports no further pages (or the request failed) —
 *   callers should stop offering "load more" once it's null.
 */
export async function discoverRedditRecipes(subreddit = 'recipes', sort = 'new', limit = 25, after = null) {
  const params = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (after) params.set('after', after);
  const jsonUrl = `https://www.reddit.com/r/${subreddit}/${sort}.json?${params.toString()}`;
  console.log(`[reddit] Discovering posts from r/${subreddit} (${sort}, limit ${limit}${after ? `, after ${after}` : ''})`);

  const data = await fetchRedditJson(jsonUrl);
  if (!data || !data.data?.children) return { posts: [], after: null };

  const posts = data.data.children
    .map(child => child.data)
    .filter(post => {
      // Filter out:
      // - Stickied/pinned announcements
      // - Link posts to external recipe sites (we want text posts with actual recipes)
      // - Posts with no selftext
      // - Very low-effort posts
      if (post.stickied) return false;
      if (post.score < -5) return false; // Very downvoted
      return true;
    })
    .map(post => ({
      title: post.title || '',
      url: `https://www.reddit.com${post.permalink}`,
      selftext: post.selftext || '',
      thumbnail: (post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default')
        ? post.thumbnail : '',
      imageUrl: post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || '',
      author: post.author || '',
      score: post.score || 0,
      subreddit: post.subreddit || subreddit,
      isTextPost: post.is_self === true,
      externalUrl: !post.is_self ? post.url : null,
      flair: post.link_flair_text || '',
    }));

  // data.data.after is Reddit's own cursor for the next page; it's already
  // null/undefined when a subreddit is exhausted, which is exactly the
  // "no more pages" signal callers need — normalize undefined to null so
  // consumers only ever have to check one falsy value.
  const nextAfter = data.data.after || null;
  console.log(`[reddit] Found ${posts.length} posts from r/${subreddit}${nextAfter ? ' (more available)' : ' (end of listing)'}`);
  return { posts, after: nextAfter };
}


// ─── Full extraction pipeline ─────────────────────────────────────────────────

/**
 * Main entry: given a Reddit post URL, fully extract and structure the recipe.
 *
 * Pipeline:
 *   1. Fetch post via .json endpoint (zero-auth)
 *   2. If post has selftext → it's already Markdown → parse directly
 *   3. If post links to external recipe site → return the external URL for the
 *      main parseFromUrl pipeline to handle (caller responsibility)
 *   4. Structure raw Markdown text via parseCaption (handles most Reddit recipe formats)
 *
 * @param {string} url - Reddit post URL
 * @param {function} [onProgress] - Optional progress callback
 * @returns {object|null} Partial recipe object or null
 */
export async function tryRedditJson(url, onProgress) {
  if (!isRedditPostUrl(url)) {
    console.log('[reddit] Not a post URL — skipping post extraction');
    return null;
  }

  if (onProgress) onProgress('Fetching Reddit post via JSON API...');

  const postData = await extractRedditPost(url);
  if (!postData) return null;

  // If the post links to an external URL (image gallery or external recipe blog),
  // we can't extract from Reddit itself — signal the caller to try the external URL.
  if (postData.link && !postData.link.includes('reddit.com') && postData.rawText.trim().length < 50) {
    console.log(`[reddit] Post is a link post — external URL: ${postData.link}`);
    // Return a special signal object so the caller knows to try the external URL
    return {
      _isRedirectToExternal: true,
      externalUrl: postData.link,
      name: postData.name,
      imageUrl: postData.imageUrl,
      link: url,
    };
  }

  // Raw text from Reddit is already Markdown — pass directly to our parser
  // (no Turndown needed; Reddit stores selftext as Markdown natively)
  if (onProgress) onProgress('Parsing Reddit recipe content...');

  return {
    rawText: postData.rawText,
    name: postData.name,
    imageUrl: postData.imageUrl,
    images: postData.images,
    link: postData.link || url,
    _extractedVia: 'reddit-json',
    _isMarkdown: true,
  };
}
