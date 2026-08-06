/**
 * SpiceHub — Blog / Recipe Link Follower (Hypercharged)
 *
 * Phase 0.5B in the import pipeline. Dual-source architecture:
 *   Instagram = discovery surface + video/PiP + carousel
 *   Blog      = structured recipe of record
 *
 * Triggers on WEAK or INCOMPLETE captions that contain recipe blog links.
 * Extraction cascade: JSON-LD → microdata → WPRM/Tasty heuristics → generic.
 * Handles short-link unwrap, link-in-bio expansion, partial merge handoff.
 */

import { fetchHtmlViaProxy } from '../api.js';
import { recordLearnedDomain, getLearnedDomains, logImportTelemetry, domainForTelemetry } from '../db.js';

// ─── CONFIG ──────────────────────────────────────────────

const WEAK_CAPTION_THRESHOLD = 120;
const MIN_RECIPE_WORDS = 3;

const RECIPE_SIGNAL_WORDS = [
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'teaspoon',
  'ounce', 'oz', 'pound', 'lb', 'gram', 'kg',
  'preheat', 'bake', 'saute', 'simmer', 'boil', 'fry',
  'dice', 'chop', 'mince', 'slice', 'stir', 'whisk',
  'ingredients', 'directions', 'instructions', 'method',
  'recipe', 'serves', 'servings', 'prep time', 'cook time',
  'degrees', 'oven',
];

/** Phrases that mean "the real recipe is NOT here, it is on the blog" */
const INCOMPLETE_PHRASES = [
  'full recipe', 'recipe on the blog', 'recipe on my blog',
  'print the recipe', 'get the recipe', 'printable recipe',
  'details on the blog', 'recipe at', 'recipe link',
  'find the recipe', 'grab the recipe', 'click the link',
  'link in bio', 'link in my bio', 'recipe in bio',
];

/** Known recipe blog domains — high priority */
const RECIPE_DOMAINS = new Set([
  'allrecipes.com', 'foodnetwork.com', 'simplyrecipes.com',
  'budgetbytes.com', 'halfbakedharvest.com', 'pinchofyum.com',
  'cookieandkate.com', 'minimalistbaker.com', 'damndelicious.net',
  'skinnytaste.com', 'tasty.co', 'delish.com', 'epicurious.com',
  'bonappetit.com', 'seriouseats.com', 'thekitchn.com',
  'food52.com', 'loveandlemons.com', 'smittenkitchen.com',
  'recipetineats.com', 'iamafoodblog.com', 'rainbowplantlife.com',
  'eatingbirdfood.com', 'ohsheglows.com', 'theppk.com',
  'noracooks.com', 'sweetpeasandsaffron.com', 'therecipecritic.com',
  'gimmesomeoven.com', 'downshiftology.com', 'wellplated.com',
  'sallysbakingaddiction.com', 'cafedelites.com', 'natashaskitchen.com',
  'joyfoodsunshine.com', 'thecookierookie.com', 'acouplecooks.com',
  'howsweeteats.com', 'ambitious-kitchen.com', 'twopeasandtheirpod.com',
  'hostthetoast.com', 'themodernproper.com', 'dinneratthezoo.com',
  'spendwithpennies.com', 'barefeetinthekitchen.com', 'diethood.com',
]);

/** Domains to always skip — social/commerce/unrelated */
const SKIP_DOMAINS = new Set([
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'youtube.com', 'youtu.be', 'spotify.com',
  'amazon.com', 'amzn.to', 'apple.com',
]);

/** Short-link domains — unwrap to discover destination */
const SHORT_LINK_DOMAINS = new Set([
  'bit.ly', 'tinyurl.com', 'ow.ly', 't.co', 'is.gd',
  'goo.gl', 'rb.gy', 'short.io', 'cutt.ly', 'rebrand.ly',
]);

/** Link-in-bio hubs — expand to find outbound recipe links */
const LINK_IN_BIO_DOMAINS = new Set([
  'linktr.ee', 'linkin.bio', 'beacons.ai', 'campsite.bio',
  'hoo.be', 'tap.bio', 'milkshake.app', 'stan.store',
  'bio.link', 'linkpop.com', 'snipfeed.co',
]);

/** Path segments that strongly hint at recipe content */
const RECIPE_PATH_RE = /\/(recipe|recipes|blog|cooking|food|bake|baking)\b/i;


// ─── CAPTION QUALITY ASSESSMENT ──────────────────────────

/**
 * Three-tier caption classification:
 *   strong     — full recipe content, no need to follow links
 *   incomplete — has some signals but bait phrases / external links suggest
 *                the real recipe lives on a blog
 *   weak       — too short, no recipe signals, or empty
 *
 * @param {string} caption
 * @returns {{ class: 'strong'|'incomplete'|'weak', reason: string }}
 */
export function assessCaptionQuality(caption) {
  if (!caption || typeof caption !== 'string') {
    return { class: 'weak', reason: 'empty_caption' };
  }

  const clean = caption.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();

  if (clean.length < 50) {
    return { class: 'weak', reason: 'too_short' };
  }

  const lower = clean.toLowerCase();
  const signalCount = RECIPE_SIGNAL_WORDS.filter(w => lower.includes(w)).length;
  const hasIncompletePhrase = INCOMPLETE_PHRASES.some(p => lower.includes(p));
  const hasUrl = /https?:\/\/|www\./i.test(caption);

  // Weak: not enough recipe signals
  if (signalCount < MIN_RECIPE_WORDS && clean.length < WEAK_CAPTION_THRESHOLD) {
    return { class: 'weak', reason: 'no_recipe_signals' };
  }

  // Incomplete: has some content but bait phrases point to blog
  if (hasIncompletePhrase) {
    return { class: 'incomplete', reason: 'bait_phrases_present' };
  }

  // Incomplete: has signals but also a URL (likely blog with full recipe)
  if (signalCount >= 1 && signalCount < 5 && hasUrl) {
    return { class: 'incomplete', reason: 'partial_signals_with_url' };
  }

  // Weak: long text but zero recipe signals (lifestyle/promo caption)
  if (signalCount < MIN_RECIPE_WORDS) {
    return { class: 'weak', reason: 'no_recipe_signals' };
  }

  return { class: 'strong', reason: 'adequate' };
}


// ─── LINK DISCOVERY & SCORING ───────────────────────────

/**
 * @typedef {Object} DiscoveredLink
 * @property {string} url
 * @property {number} priority  0=best, higher=lower priority
 * @property {'direct'|'short'|'bio_hub'|'comment'} source
 */

/**
 * Extract, classify, and priority-rank all URLs from caption + comments.
 *
 * @param {string} caption
 * @param {Object} [opts]
 * @param {string[]} [opts.comments]      First N comments to scan
 * @param {string}   [opts.profileBioUrl] Bio URL from Apify profile data
 * @returns {{ links: DiscoveredLink[], hasLinkInBio: boolean }}
 */
export function discoverLinks(caption, { comments = [], profileBioUrl = '', learnedDomains = null } = {}) {
  const results = [];
  let hasLinkInBio = false;

  // Extract URLs from caption
  const captionUrls = extractUrls(caption);
  for (const url of captionUrls) {
    const info = classifyUrl(url);
    if (info.skip) continue;
    if (info.isBioHub) { hasLinkInBio = true; results.push({ url, priority: 10, source: 'bio_hub' }); continue; }
    if (info.isShortLink) { results.push({ url, priority: 5, source: 'short' }); continue; }
    results.push({ url, priority: scoreUrl(url, learnedDomains), source: 'direct' });
  }

  // Scan first 3 comments for pinned recipe links
  for (const comment of comments.slice(0, 3)) {
    if (!comment) continue;
    const commentText = typeof comment === 'string' ? comment : (comment.text || comment.body || '');
    for (const url of extractUrls(commentText)) {
      const info = classifyUrl(url);
      if (info.skip || info.isBioHub) continue;
      if (info.isShortLink) { results.push({ url, priority: 6, source: 'short' }); continue; }
      results.push({ url, priority: scoreUrl(url, learnedDomains) + 1, source: 'comment' });
    }
  }

  // Bio URL from Apify/profile data
  if (profileBioUrl) {
    const info = classifyUrl(profileBioUrl);
    if (info.isBioHub) {
      hasLinkInBio = true;
      results.push({ url: profileBioUrl, priority: 10, source: 'bio_hub' });
    } else if (!info.skip) {
      results.push({ url: profileBioUrl, priority: scoreUrl(profileBioUrl, learnedDomains) + 2, source: 'direct' });
    }
  }

  // Dedupe by URL
  const seen = new Set();
  const deduped = results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Sort by priority (lower = better)
  deduped.sort((a, b) => a.priority - b.priority);

  return { links: deduped, hasLinkInBio };
}

/** Extract all URLs (including bare domains) from text */
function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const rawUrls = [...new Set(text.match(urlRegex) || [])];

  const bareRegex = /(?:^|\s)((?:www\.)?[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/[^\s]*)?)/gi;
  const bareMatches = [...text.matchAll(bareRegex)]
    .map(m => `https://${m[1].replace(/^www\./, '')}`)
    .filter(u => { try { new URL(u); return true; } catch { return false; } });

  return [...new Set([...rawUrls, ...bareMatches])];
}

/** Classify a URL: skip, short-link, bio-hub, or direct */
function classifyUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const matchesDomain = (set) => set.has(host) || [...set].some(d => host.endsWith('.' + d));
    if (matchesDomain(SKIP_DOMAINS)) return { skip: true };
    if (matchesDomain(SHORT_LINK_DOMAINS)) return { isShortLink: true };
    if (matchesDomain(LINK_IN_BIO_DOMAINS)) return { isBioHub: true };
    return {};
  } catch { return { skip: true }; }
}

/**
 * Priority score for a URL. Lower = higher priority.
 *   0 = known recipe domain + /recipe path
 *   1 = known recipe domain, any path
 *   2 = unknown domain + recipe-ish path
 *   3 = unknown domain, unknown path
 *
 * @param {string} url
 * @param {Set<string>} [learnedDomains] Domains learned from past successful extractions
 */
function scoreUrl(url, learnedDomains) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const matchDomain = (set) => set.has(host) || [...set].some(d => host.endsWith('.' + d));
    const isKnown = matchDomain(RECIPE_DOMAINS) || (learnedDomains?.size && matchDomain(learnedDomains));
    const hasRecipePath = RECIPE_PATH_RE.test(parsed.pathname);
    if (isKnown && hasRecipePath) return 0;
    if (isKnown) return 1;
    if (hasRecipePath) return 2;
    return 3;
  } catch { return 9; }
}


// ─── SHORT-LINK UNWRAPPING ──────────────────────────────

/**
 * Fetch a short link and extract the canonical/og:url destination.
 * Returns the resolved URL (for re-ranking) + the already-fetched HTML
 * (so we don't double-fetch if it's a recipe page).
 *
 * @param {string} shortUrl
 * @returns {Promise<{ resolvedUrl: string, html: string }|null>}
 */
async function unwrapShortLink(shortUrl) {
  try {
    const html = await fetchHtmlViaProxy(shortUrl, 5000);
    if (!html) return null;

    // Try canonical URL
    const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);

    const resolvedUrl = canonMatch?.[1] || shortUrl;
    return { resolvedUrl, html };
  } catch {
    return null;
  }
}


// ─── LINK-IN-BIO EXPANSION ─────────────────────────────

/**
 * Fetch a link-in-bio hub page and extract outbound links that
 * look like recipe content.
 *
 * @param {string} bioUrl
 * @returns {Promise<string[]>} Recipe-candidate URLs
 */
async function expandLinkInBio(bioUrl) {
  try {
    const html = await fetchHtmlViaProxy(bioUrl, 6000);
    if (!html) return [];

    // Extract all href links from the hub page
    const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    const allLinks = [...new Set([...html.matchAll(hrefRegex)].map(m => m[1]))];

    // Filter: keep only recipe-domain links or links with recipe-ish paths
    return allLinks.filter(url => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        // Skip social/self links
        if (SKIP_DOMAINS.has(host) || LINK_IN_BIO_DOMAINS.has(host)) return false;
        // Keep known recipe domains
        if (RECIPE_DOMAINS.has(host) || [...RECIPE_DOMAINS].some(d => host.endsWith('.' + d))) return true;
        // Keep unknown domains with recipe-ish paths
        return RECIPE_PATH_RE.test(new URL(url).pathname);
      } catch { return false; }
    });
  } catch {
    return [];
  }
}


// ─── BLOG RECIPE EXTRACTION (DEEP CASCADE) ──────────────

/**
 * Fetch a blog URL and extract structured recipe data.
 *
 * Cascade (in order):
 *   1. JSON-LD schema.org/Recipe (with mainEntity, @graph, @type arrays)
 *   2. Microdata (itemprop-based)
 *   3. WPRM REST API (data-recipe-id detection)
 *   4. Heuristic HTML selectors (WPRM, Tasty, EasyRecipe, mv-create)
 *
 * Returns null when nothing found; partial results include _isPartial flag
 * and _articleText for hybrid Gemini merge.
 *
 * @param {string} url
 * @param {string} [prefetchedHtml]  HTML already fetched (from short-link unwrap)
 * @returns {Promise<Object|null>}
 */
export async function extractRecipeFromBlog(url, prefetchedHtml = null) {
  console.log(`[BlogLinkFollower] Fetching: ${url}`);

  try {
    const html = prefetchedHtml || await fetchHtmlViaProxy(url, 12000);

    if (!html || typeof html !== 'string' || html.length < 200) {
      console.log('[BlogLinkFollower] Empty or trivial response');
      return null;
    }

    // Detect paywall / challenge pages
    const lowerHtml = html.substring(0, 3000).toLowerCase();
    if (lowerHtml.includes('subscribe to continue') ||
        lowerHtml.includes('sign in to read') ||
        lowerHtml.includes('cf-challenge') ||
        lowerHtml.includes('just a moment...') ||
        lowerHtml.includes('paywall')) {
      console.log('[BlogLinkFollower] Paywall / challenge detected, skipping');
      return null;
    }

    // Extract domain for telemetry
    let discoveredDomain = '';
    try { discoveredDomain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ok */ }

    // Strategy 1: JSON-LD (enhanced)
    const jsonLdRecipe = extractJsonLd(html);
    if (jsonLdRecipe) {
      console.log('[BlogLinkFollower] Found JSON-LD recipe');
      const r = normalizeRecipe(jsonLdRecipe, url, discoveredDomain);
      r._extractionMethod = 'jsonld';
      return r;
    }

    // Strategy 2: Microdata
    const microdataRecipe = extractMicrodata(html);
    if (microdataRecipe) {
      console.log('[BlogLinkFollower] Found microdata recipe');
      const r = normalizeRecipe(microdataRecipe, url, discoveredDomain);
      r._extractionMethod = 'microdata';
      return r;
    }

    // Strategy 3: WPRM REST API (if recipe ID detected)
    const wprmRecipe = await tryWprmApi(html, url);
    if (wprmRecipe) {
      console.log('[BlogLinkFollower] Found WPRM API recipe');
      const r = normalizeRecipe(wprmRecipe, url, discoveredDomain);
      r._extractionMethod = 'wprm';
      return r;
    }

    // Strategy 4: Heuristic selectors
    const heuristicRecipe = extractHeuristic(html);
    if (heuristicRecipe) {
      console.log('[BlogLinkFollower] Found recipe via heuristic selectors');
      const result = normalizeRecipe(heuristicRecipe, url, discoveredDomain);
      // Mark partial if no directions
      if (!result.directions.length) {
        result._isPartial = true;
        result._articleText = extractArticleText(html);
        result._extractionMethod = 'heuristic_partial';
      } else {
        result._extractionMethod = 'heuristic';
      }
      return result;
    }

    // Strategy 5: Article text extraction only (for hybrid Gemini)
    const articleText = extractArticleText(html);
    if (articleText && articleText.length > 300) {
      console.log('[BlogLinkFollower] No structured recipe — returning article text for Gemini');
      return {
        name: extractPageTitle(html) || '',
        ingredients: [],
        directions: [],
        link: url,
        image: extractOgImage(html),
        _source: 'blog_link_follower',
        _isPartial: true,
        _articleText: articleText,
        _discoveredDomain: discoveredDomain,
        _extractionMethod: 'article_text',
      };
    }

    console.log('[BlogLinkFollower] No recipe structure found on page');
    return null;

  } catch (err) {
    console.log(`[BlogLinkFollower] Fetch failed: ${err.message}`);
    return null;
  }
}


// ─── JSON-LD EXTRACTION (ENHANCED) ──────────────────────

function extractJsonLd(html) {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      let data = JSON.parse(match[1].trim());

      // Handle @graph wrapper (WPRM, Yoast, Rank Math)
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        data = data['@graph'];
      }

      // Handle mainEntity wrapper (some themes nest Recipe inside Article)
      if (data.mainEntity) {
        const me = data.mainEntity;
        const meType = me['@type'];
        if (meType === 'Recipe' || (Array.isArray(meType) && meType.includes('Recipe'))) {
          return jsonLdToRaw(me);
        }
      }

      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Check mainEntity on each item too (Article with mainEntity: Recipe)
        if (item.mainEntity) {
          const me = item.mainEntity;
          const meType = me['@type'];
          if (meType === 'Recipe' || (Array.isArray(meType) && meType.includes('Recipe'))) {
            return jsonLdToRaw(me);
          }
        }

        const type = item['@type'];
        // Handle @type arrays like ["Recipe", "Article"]
        const isRecipe = type === 'Recipe' ||
          (Array.isArray(type) && type.includes('Recipe'));

        if (isRecipe) {
          return jsonLdToRaw(item);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Convert a JSON-LD Recipe node to our raw format */
function jsonLdToRaw(item) {
  return {
    name: item.name || '',
    ingredients: normalizeIngredients(item.recipeIngredient || []),
    directions: normalizeDirections(item.recipeInstructions || []),
    prepTime: item.prepTime || '',
    cookTime: item.cookTime || '',
    totalTime: item.totalTime || '',
    servings: item.recipeYield
      ? (Array.isArray(item.recipeYield) ? item.recipeYield[0] : item.recipeYield)
      : '',
    image: extractImage(item.image),
    description: item.description || '',
    category: item.recipeCategory || '',
    cuisine: item.recipeCuisine || '',
  };
}


// ─── MICRODATA EXTRACTION ───────────────────────────────

function extractMicrodata(html) {
  // Look for itemtype="schema.org/Recipe" blocks
  const recipeBlockRe = /<[^>]+itemtype=["']https?:\/\/schema\.org\/Recipe["'][^>]*>([\s\S]*?)(?=<[^>]+itemtype=["']|$)/i;
  const blockMatch = html.match(recipeBlockRe);
  if (!blockMatch) return null;

  const block = blockMatch[0];

  const getItemprop = (prop) => {
    const re = new RegExp(`itemprop=["']${prop}["'][^>]*>([^<]*)`, 'i');
    const m = block.match(re);
    return m ? stripTags(m[1]) : '';
  };

  const getAllItemprop = (prop) => {
    const re = new RegExp(`itemprop=["']${prop}["'][^>]*>([^<]*)`, 'gi');
    return [...block.matchAll(re)].map(m => stripTags(m[1]).trim()).filter(Boolean);
  };

  const name = getItemprop('name');
  const ingredients = getAllItemprop('recipeIngredient').length
    ? getAllItemprop('recipeIngredient')
    : getAllItemprop('ingredients');

  if (!name || ingredients.length < 2) return null;

  const directions = getAllItemprop('recipeInstructions');

  return {
    name,
    ingredients,
    directions: directions.length ? directions : [],
    prepTime: getItemprop('prepTime'),
    cookTime: getItemprop('cookTime'),
    totalTime: getItemprop('totalTime'),
    servings: getItemprop('recipeYield'),
    description: getItemprop('description'),
    image: null,
  };
}


// ─── WPRM REST API ──────────────────────────────────────

async function tryWprmApi(html, pageUrl) {
  // Detect WPRM recipe ID
  const idMatch = html.match(/data-recipe-id=["'](\d+)["']/i)
    || html.match(/wprm_recipes[/\\](\d+)/i);
  if (!idMatch) return null;

  const recipeId = idMatch[1];
  try {
    const origin = new URL(pageUrl).origin;
    const apiUrl = `${origin}/wp-json/wp/v2/wprm_recipes/${recipeId}`;
    const jsonText = await fetchHtmlViaProxy(apiUrl, 6000);
    if (!jsonText) return null;

    const data = JSON.parse(jsonText);
    const recipe = data.recipe || data;

    if (!recipe.name && !recipe.title?.rendered) return null;

    return {
      name: recipe.name || stripTags(recipe.title?.rendered || ''),
      ingredients: (recipe.ingredients_flat || []).map(i =>
        [i.amount, i.unit, i.name, i.notes].filter(Boolean).join(' ').trim()
      ),
      directions: (recipe.instructions_flat || []).map(s =>
        stripTags(s.text || '')
      ).filter(Boolean),
      prepTime: recipe.prep_time ? `PT${recipe.prep_time}M` : '',
      cookTime: recipe.cook_time ? `PT${recipe.cook_time}M` : '',
      totalTime: recipe.total_time ? `PT${recipe.total_time}M` : '',
      servings: recipe.servings || '',
      image: recipe.image_url || null,
      description: stripTags(recipe.summary || ''),
    };
  } catch {
    return null;
  }
}


// ─── HEURISTIC EXTRACTION (ENHANCED) ────────────────────

function extractHeuristic(html) {
  const namePatterns = [
    /<h[12][^>]*class="[^"]*wprm-recipe-name[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*tasty-recipes-title[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*recipe-title[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*mv-create-title[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*easyrecipe[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*itemprop="name"[^>]*>(.*?)<\/h[12]>/i,
    // jump-to-recipe target headings
    /<h[12][^>]*id="[^"]*recipe[^"]*"[^>]*>(.*?)<\/h[12]>/i,
  ];

  const ingredientPatterns = [
    /<li[^>]*class="[^"]*wprm-recipe-ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*tasty-recipe[^"]*ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*mv-create-ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*itemprop="recipeIngredient"[^>]*>([\s\S]*?)<\/li>/gi,
  ];

  const directionPatterns = [
    /<li[^>]*class="[^"]*wprm-recipe-instruction[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*tasty-recipe[^"]*instruction[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*mv-create-instruction[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*class="[^"]*instruction[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    /<li[^>]*itemprop="recipeInstructions"[^>]*>([\s\S]*?)<\/li>/gi,
    /<div[^>]*class="[^"]*step-body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*direction[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];

  let name = '';
  for (const pat of namePatterns) {
    const m = html.match(pat);
    if (m) { name = stripTags(m[1]); break; }
  }

  let ingredients = [];
  for (const pat of ingredientPatterns) {
    const matches = [...html.matchAll(pat)];
    if (matches.length > 0) {
      ingredients = matches.map(m => stripTags(m[1]).trim()).filter(Boolean);
      break;
    }
  }

  let directions = [];
  for (const pat of directionPatterns) {
    const matches = [...html.matchAll(pat)];
    if (matches.length > 0) {
      directions = matches.map(m => stripTags(m[1]).trim()).filter(Boolean);
      break;
    }
  }

  if (!name || ingredients.length < 2) return null;
  return { name, ingredients, directions };
}


// ─── ARTICLE TEXT EXTRACTION ────────────────────────────

/** Extract the main article text from a blog page for hybrid Gemini */
function extractArticleText(html) {
  // Try to find the main content area
  const contentPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|\s*<div[^>]*class="[^"]*(?:post|comment|sidebar))/i,
    /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let contentHtml = '';
  for (const pat of contentPatterns) {
    const m = html.match(pat);
    if (m && m[1].length > 300) { contentHtml = m[1]; break; }
  }

  if (!contentHtml) {
    // Fallback: strip nav/header/footer/sidebar and use body
    contentHtml = html
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');
  }

  return contentHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 8000);
}

function extractPageTitle(html) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i)
    || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return m ? stripTags(m[1]) : '';
}

function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}


// ─── NORMALIZATION HELPERS ──────────────────────────────

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalizeIngredients(list) {
  if (!Array.isArray(list)) return [];
  return list.map(i => typeof i === 'string' ? i.trim() : (i.text || i.name || '')).filter(Boolean);
}

function normalizeDirections(list) {
  if (!Array.isArray(list)) {
    if (typeof list === 'string') return [list];
    return [];
  }
  return list.flatMap(step => {
    if (typeof step === 'string') return [step.trim()];
    if (step['@type'] === 'HowToSection') {
      return (step.itemListElement || []).map(s =>
        typeof s === 'string' ? s : (s.text || '')
      );
    }
    if (step['@type'] === 'HowToStep') {
      return [step.text || step.description || ''];
    }
    return [step.text || step.description || ''];
  }).map(s => s.trim()).filter(Boolean);
}

function extractImage(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return img[0]?.url || (typeof img[0] === 'string' ? img[0] : null);
  return img.url || null;
}

function normalizeRecipe(raw, sourceUrl, discoveredDomain = '') {
  const result = {
    name: raw.name || 'Untitled Recipe',
    ingredients: raw.ingredients || [],
    directions: raw.directions || [],
    link: sourceUrl,
    image: raw.image || null,
    prepTime: raw.prepTime || '',
    cookTime: raw.cookTime || '',
    totalTime: raw.totalTime || '',
    servings: raw.servings || '',
    description: raw.description || '',
    category: raw.category || '',
    cuisine: raw.cuisine || '',
    _source: 'blog_link_follower',
    _isPartial: false,
    _discoveredDomain: discoveredDomain,
  };

  // Mark partial if no directions
  if (!result.directions.length && result.ingredients.length >= 2) {
    result._isPartial = true;
  }

  return result;
}


// ─── MAIN ORCHESTRATOR ──────────────────────────────────

/**
 * Phase 0.5B — Blog Link Follower (Hypercharged)
 *
 * Triggers on WEAK or INCOMPLETE captions. Discovers links (caption,
 * comments, profile bio), unwraps short links, expands link-in-bio hubs,
 * then extracts structured recipe data from blog pages.
 *
 * Returns a dual-source result preserving the Instagram identity
 * (videoUrl, sourceUrl) alongside blog recipe data.
 *
 * @param {string}      caption       Instagram caption
 * @param {string|null}  imageUrl     Persisted IG image URL
 * @param {Object}       [opts]
 * @param {string}       [opts.instagramUrl]   Original IG URL (for videoUrl/PiP)
 * @param {string[]}     [opts.comments]       First N comments
 * @param {string}       [opts.profileBioUrl]  Bio URL from Apify
 * @param {string[]}     [opts.carouselImages] IG carousel URLs
 * @returns {Promise<Object|null>}
 */
export async function tryBlogLinkExtraction(caption, imageUrl, {
  instagramUrl = '',
  comments = [],
  profileBioUrl = '',
  carouselImages = [],
} = {}) {
  const t0 = Date.now();
  const BUDGET_MS = 14000; // 14s wall-time cap so Gemini Phase 3 still runs
  const budgetExpired = () => Date.now() - t0 > BUDGET_MS;

  // Step 1: Classify caption
  const quality = assessCaptionQuality(caption);

  if (quality.class === 'strong') {
    console.log(`[BlogLinkFollower] Caption is strong (${quality.reason}), skipping`);
    return null;
  }

  console.log(`[BlogLinkFollower] Caption is ${quality.class} (${quality.reason}), scanning for links...`);

  // Load learned domains for priority boosting (non-blocking; empty set on error)
  let learnedDomains = null;
  try { learnedDomains = await getLearnedDomains(); } catch { /* ignore */ }

  // Step 2: Discover and rank links
  const { links, hasLinkInBio } = discoverLinks(caption, { comments, profileBioUrl, learnedDomains });

  if (links.length === 0 && !hasLinkInBio) {
    console.log('[BlogLinkFollower] No usable links found');
    return null;
  }

  console.log(`[BlogLinkFollower] Found ${links.length} link(s), comments=${comments.length}, bioHub=${hasLinkInBio}`);

  // Determine if this is a reel/video (for videoUrl preservation)
  const isVideo = instagramUrl && /\/(reel|tv)\//i.test(instagramUrl);

  // Step 3: Process links in priority order (max 4 attempts total, 14s budget)
  let attempts = 0;
  const MAX_ATTEMPTS = 4;
  let strategyWon = 'none';
  let winnerUrl = '';

  for (const { url, source } of links) {
    if (attempts >= MAX_ATTEMPTS || budgetExpired()) break;

    // Handle short links: unwrap first, then try the destination
    if (source === 'short') {
      attempts++;
      console.log(`[BlogLinkFollower] Unwrapping short link: ${url}`);
      const unwrapped = await unwrapShortLink(url);
      if (unwrapped && !budgetExpired()) {
        const destInfo = classifyUrl(unwrapped.resolvedUrl);
        if (destInfo.skip) continue;
        if (destInfo.isBioHub) {
          const bioLinks = await expandLinkInBio(unwrapped.resolvedUrl);
          for (const bioLink of bioLinks.slice(0, 2)) {
            if (attempts >= MAX_ATTEMPTS || budgetExpired()) break;
            attempts++;
            const recipe = await extractRecipeFromBlog(bioLink);
            if (recipe) {
              strategyWon = recipe._isPartial ? 'short>bio>partial' : (recipe._source === 'blog_link_follower' ? 'short>bio>structured' : 'short>bio');
              winnerUrl = bioLink;
              logResult(quality, links.length, strategyWon, winnerUrl, t0, recipe._extractionMethod, instagramUrl);
              return enrichResult(recipe, imageUrl, instagramUrl, isVideo, carouselImages);
            }
          }
          continue;
        }
        const recipe = await extractRecipeFromBlog(unwrapped.resolvedUrl, unwrapped.html);
        if (recipe) {
          strategyWon = 'short>direct';
          winnerUrl = unwrapped.resolvedUrl;
          logResult(quality, links.length, strategyWon, winnerUrl, t0, recipe._extractionMethod);
          return enrichResult(recipe, imageUrl, instagramUrl, isVideo, carouselImages);
        }
      }
      continue;
    }

    // Handle link-in-bio hubs
    if (source === 'bio_hub') {
      attempts++;
      console.log(`[BlogLinkFollower] Expanding link-in-bio: ${url}`);
      const bioLinks = await expandLinkInBio(url);
      console.log(`[BlogLinkFollower] Found ${bioLinks.length} recipe link(s) in bio hub`);
      for (const bioLink of bioLinks.slice(0, 2)) {
        if (attempts >= MAX_ATTEMPTS || budgetExpired()) break;
        attempts++;
        const recipe = await extractRecipeFromBlog(bioLink);
        if (recipe) {
          strategyWon = 'bio_hub';
          winnerUrl = bioLink;
          logResult(quality, links.length, strategyWon, winnerUrl, t0, recipe._extractionMethod);
          return enrichResult(recipe, imageUrl, instagramUrl, isVideo, carouselImages);
        }
      }
      continue;
    }

    // Direct links
    attempts++;
    const recipe = await extractRecipeFromBlog(url);
    if (recipe) {
      strategyWon = 'direct';
      winnerUrl = url;
      logResult(quality, links.length, strategyWon, winnerUrl, t0, recipe._extractionMethod);
      return enrichResult(recipe, imageUrl, instagramUrl, isVideo, carouselImages);
    }
  }

  logResult(quality, links.length, 'none', '', t0, null, instagramUrl);
  return null;
}

/**
 * Structured telemetry log — P3-13 enhanced failure taxonomy, plus (harden-
 * ideas-audit-2026-08-06.md §1) a persisted 'blog' stage row so this isn't
 * just a console breadcrumb anymore. `winnerUrl` (the blog page actually
 * extracted from) is used for the telemetry domain when present, since
 * that's the more actionable signal; `instagramUrl` is kept as the `url`
 * field so this row correlates with the same import's 'acquire' stage row.
 */
function logResult(quality, linksFound, strategyWon, winnerUrl, t0, extractionMethod, instagramUrl) {
  const ms = Date.now() - t0;
  console.log(`[BlogLinkFollower] Result: class=${quality.class} reason=${quality.reason} links=${linksFound} strategy=${strategyWon} method=${extractionMethod || 'none'} url=${winnerUrl || '-'} ms=${ms}`);
  logImportTelemetry({
    stage: 'blog',
    ok: strategyWon !== 'none',
    reason: strategyWon === 'none' ? `${quality.class}:${quality.reason}` : strategyWon,
    domain: domainForTelemetry(winnerUrl || instagramUrl || ''),
    extractionSource: extractionMethod || '',
    ms,
    url: instagramUrl || winnerUrl || '',
  });
}


// ─── RESULT ENRICHMENT ──────────────────────────────────

/**
 * Enrich a blog extraction result with dual-source identity:
 * - Blog = recipe of record (name, ingredients, directions, times)
 * - Instagram = discovery surface + video/PiP + carousel
 */
function enrichResult(recipe, igImageUrl, instagramUrl, isVideo, carouselImages) {
  // Prefer blog hero for card image, but fall back to IG
  if (!recipe.image && igImageUrl) {
    recipe.image = igImageUrl;
  }

  // PiP preservation: videoUrl always points to IG when input was a reel/video
  recipe.videoUrl = isVideo ? instagramUrl : '';

  // Dual-source metadata
  recipe._sources = {
    primary: 'blog',
    blogUrl: recipe.link,
    instagramUrl: instagramUrl || '',
    videoUrl: isVideo ? instagramUrl : '',
  };

  // Carry IG carousel for gallery
  if (carouselImages?.length) {
    recipe._igCarouselImages = carouselImages;
  }

  // P3-12: Record this domain for future priority boosting (fire-and-forget)
  if (recipe._discoveredDomain) {
    recordLearnedDomain(recipe._discoveredDomain).catch(() => {});
  }

  console.log(`[BlogLinkFollower] Extracted "${recipe.name}" from ${recipe.link}`);
  return recipe;
}
