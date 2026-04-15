/**
 * SpiceHub — Reddit Discovery Scraper (Zero-Auth)
 *
 * Strategy: Reddit's `.json` endpoint trick.
 * Any reddit.com URL + `?raw_json=1` (or + `.json`) returns full structured JSON
 * without authentication. Unauthenticated rate limit is ~60 req/min per IP.
 *
 * Tier hierarchy:
 *   1. Specific post URL → .json endpoint → extract recipe from selftext / title
 *   2. Subreddit discovery → /r/{sub}/new.json → surface recipe links for import
 *
 * Zero-cost: No Reddit API key, no OAuth, no Apify, no Firecrawl.
 *
 * CORS note: Reddit allows browser-to-reddit.com requests from any origin on
 * `.json` endpoints. Direct fetch works in modern browsers. CORS proxy used as
 * fallback for environments that block it (e.g. restrictive CSP on some proxies).
 */

import { fetchHtmlViaProxy } from '../api.js';

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
 * Fetch Reddit JSON with direct browser fetch first, CORS proxy fallback.
 * Adds required `raw_json=1` param so Unicode isn't HTML-entity-encoded.
 */
async function fetchRedditJson(redditJsonUrl, timeoutMs = 12000) {
  const url = new URL(redditJsonUrl);
  url.searchParams.set('raw_json', '1');
  const fullUrl = url.toString();

  // Attempt 1: direct browser fetch (Reddit allows cross-origin on .json endpoints)
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
    console.log(`[reddit] Direct fetch failed (${e.message}) — trying CORS proxy`);
  }

  // Attempt 2: CORS proxy fallback (returns text, we parse as JSON)
  try {
    const proxied = await fetchHtmlViaProxy(fullUrl, timeoutMs);
    if (proxied && proxied.trim().startsWith('[') || proxied?.trim().startsWith('{')) {
      return JSON.parse(proxied);
    }
  } catch (e) {
    console.log(`[reddit] CORS proxy JSON parse failed: ${e.message}`);
  }

  return null;
}

// ─── Post extraction ──────────────────────────────────────────────────────────

/**
 * Given a specific Reddit post URL, extract recipe content via the .json endpoint.
 *
 * The .json response structure for a comments page is:
 *   [ listing(post), listing(comments) ]
 *   listing.data.children[0].data = { title, selftext, url, thumbnail, ... }
 *
 * Returns a partial recipe object { name, rawText, imageUrl, link, _extractedVia }
 * or null on failure.
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

  const { title = '', selftext = '', url: postUrl, thumbnail, preview } = post;

  // Reconstruct full Reddit URL (handles old.reddit.com links etc.)
  const canonicalUrl = postUrl?.includes('reddit.com')
    ? postUrl
    : `https://www.reddit.com${new URL(url).pathname}`;

  // Extract best image
  let imageUrl = '';
  // Preview images from Reddit's own CDN (highest quality available)
  if (preview?.images?.[0]?.source?.url) {
    imageUrl = preview.images[0].source.url.replace(/&amp;/g, '&');
  } else if (thumbnail && thumbnail !== 'self' && thumbnail !== 'default' && thumbnail.startsWith('http')) {
    imageUrl = thumbnail;
  }

  // The selftext is the body of the post — it contains the recipe in Markdown already
  // Reddit already stores post bodies as Markdown, so no Turndown needed.
  const rawText = [title, selftext].filter(Boolean).join('\n\n');

  if (!rawText || rawText.trim().length < 20) {
    console.log('[reddit] Post has no usable text content');
    return null;
  }

  console.log(`[reddit] Extracted post — title: "${title}", selftext: ${selftext.length} chars`);

  return {
    name: title || 'Reddit Recipe',
    rawText,
    imageUrl,
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
 * @param {string} subreddit - Subreddit name without /r/ prefix (default: 'recipes')
 * @param {string} sort - 'new' | 'hot' | 'top' (default: 'new')
 * @param {number} limit - Number of posts to return (max 100, default: 25)
 * @returns {Array<{ title, url, selftext, thumbnail, author, score, subreddit }>}
 */
export async function discoverRedditRecipes(subreddit = 'recipes', sort = 'new', limit = 25) {
  const jsonUrl = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${Math.min(limit, 100)}`;
  console.log(`[reddit] Discovering posts from r/${subreddit} (${sort}, limit ${limit})`);

  const data = await fetchRedditJson(jsonUrl);
  if (!data || !data.data?.children) return [];

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

  console.log(`[reddit] Found ${posts.length} posts from r/${subreddit}`);
  return posts;
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
    link: postData.link || url,
    _extractedVia: 'reddit-json',
    _isMarkdown: true,
  };
}
