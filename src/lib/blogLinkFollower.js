/**
 * SpiceHub — Blog / Recipe Link Follower for Weak Instagram Captions
 *
 * Phase 0.5 in the import pipeline — after Apify returns a weak caption,
 * scan it for blog/recipe URLs. If found, fetch the page via the existing
 * CORS proxy and extract the recipe using JSON-LD or heuristic selectors.
 */

import { fetchHtmlViaProxy } from '../api.js';

// ─── CONFIG ──────────────────────────────────────────────

/** Minimum caption length to consider "strong enough" */
const WEAK_CAPTION_THRESHOLD = 120;

/** Minimum number of recipe-like words to consider caption usable */
const MIN_RECIPE_WORDS = 3;

/** Words that indicate a caption actually contains recipe content */
const RECIPE_SIGNAL_WORDS = [
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'teaspoon',
  'ounce', 'oz', 'pound', 'lb', 'gram', 'kg',
  'preheat', 'bake', 'sauté', 'simmer', 'boil', 'fry',
  'dice', 'chop', 'mince', 'slice', 'stir', 'whisk',
  'ingredients', 'directions', 'instructions', 'method',
  'recipe', 'serves', 'servings', 'prep time', 'cook time',
  'degrees', '°f', '°c', 'oven',
];

/** Known recipe blog domains — prioritize these links */
const RECIPE_DOMAINS = [
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
];

/** Domains to skip — not recipe content */
const SKIP_DOMAINS = [
  'linktr.ee', 'linkin.bio', 'beacons.ai', 'campsite.bio',
  'hoo.be', 'tap.bio', 'milkshake.app', 'stan.store',
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'youtube.com', 'youtu.be', 'spotify.com',
  'amazon.com', 'amzn.to', 'bit.ly',
];


// ─── CAPTION QUALITY ASSESSMENT ──────────────────────────

/**
 * Determine if an Instagram caption is "weak" — not enough recipe content.
 * @param {string} caption
 * @returns {{ isWeak: boolean, reason: string }}
 */
export function assessCaptionQuality(caption) {
  if (!caption || typeof caption !== 'string') {
    return { isWeak: true, reason: 'empty_caption' };
  }

  const clean = caption.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();

  if (clean.length < WEAK_CAPTION_THRESHOLD) {
    return { isWeak: true, reason: 'too_short' };
  }

  const lower = clean.toLowerCase();
  const matchCount = RECIPE_SIGNAL_WORDS.filter(w => lower.includes(w)).length;

  if (matchCount < MIN_RECIPE_WORDS) {
    return { isWeak: true, reason: 'no_recipe_signals' };
  }

  return { isWeak: false, reason: 'adequate' };
}


// ─── URL EXTRACTION ──────────────────────────────────────

/**
 * Extract all URLs from an Instagram caption, sorted by recipe-site priority.
 * @param {string} caption
 * @returns {string[]}
 */
export function extractLinksFromCaption(caption) {
  if (!caption) return [];

  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const rawUrls = [...new Set(caption.match(urlRegex) || [])];

  // Catch bare domain mentions ("full recipe at mysite.com/recipes/whatever")
  const bareRegex = /(?:^|\s)((?:www\.)?[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/[^\s]*)?)/gi;
  const bareMatches = [...caption.matchAll(bareRegex)]
    .map(m => `https://${m[1].replace(/^www\./, '')}`)
    .filter(u => {
      try { new URL(u); return true; } catch { return false; }
    });

  const allUrls = [...new Set([...rawUrls, ...bareMatches])];

  // Filter out social / non-recipe domains
  const filtered = allUrls.filter(url => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return !SKIP_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch { return false; }
  });

  // Sort: known recipe domains first
  return filtered.sort((a, b) => {
    const hostA = new URL(a).hostname.replace(/^www\./, '');
    const hostB = new URL(b).hostname.replace(/^www\./, '');
    const scoreA = RECIPE_DOMAINS.some(d => hostA === d || hostA.endsWith('.' + d)) ? 0 : 1;
    const scoreB = RECIPE_DOMAINS.some(d => hostB === d || hostB.endsWith('.' + d)) ? 0 : 1;
    return scoreA - scoreB;
  });
}


// ─── BLOG RECIPE EXTRACTION ─────────────────────────────

/**
 * Fetch a blog URL via the existing CORS proxy and extract structured recipe data.
 *
 * Strategy (in order):
 *   1. JSON-LD schema.org/Recipe
 *   2. Heuristic HTML selectors (WPRM, Tasty, EasyRecipe patterns)
 *
 * @param {string} url
 * @returns {Promise<Object|null>}
 */
export async function extractRecipeFromBlog(url) {
  console.log(`[BlogLinkFollower] Fetching: ${url}`);

  try {
    const html = await fetchHtmlViaProxy(url, 12000);

    if (!html || typeof html !== 'string') {
      console.log('[BlogLinkFollower] Empty or non-string response');
      return null;
    }

    // Detect login walls / paywalls
    if (html.includes('subscribe to continue') ||
        html.includes('sign in to read') ||
        html.includes('paywall')) {
      console.log('[BlogLinkFollower] Paywall detected, skipping');
      return null;
    }

    // Strategy 1: JSON-LD
    const jsonLdRecipe = extractJsonLd(html);
    if (jsonLdRecipe) {
      console.log('[BlogLinkFollower] Found JSON-LD recipe');
      return normalizeRecipe(jsonLdRecipe, url);
    }

    // Strategy 2: Heuristic selectors
    const heuristicRecipe = extractHeuristic(html);
    if (heuristicRecipe) {
      console.log('[BlogLinkFollower] Found recipe via heuristic selectors');
      return normalizeRecipe(heuristicRecipe, url);
    }

    console.log('[BlogLinkFollower] No recipe structure found on page');
    return null;

  } catch (err) {
    console.log(`[BlogLinkFollower] Fetch failed: ${err.message}`);
    return null;
  }
}


// ─── JSON-LD EXTRACTION ─────────────────────────────────

function extractJsonLd(html) {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      let data = JSON.parse(match[1].trim());

      // Handle @graph wrapper (WPRM, Yoast, etc.)
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        data = data['@graph'];
      }

      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        const type = item['@type'];
        const isRecipe = type === 'Recipe' ||
          (Array.isArray(type) && type.includes('Recipe'));

        if (isRecipe) {
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
          };
        }
      }
    } catch {
      // Malformed JSON-LD — try next script block
      continue;
    }
  }
  return null;
}


// ─── HEURISTIC EXTRACTION ───────────────────────────────

function extractHeuristic(html) {
  const namePatterns = [
    /<h[12][^>]*class="[^"]*wprm-recipe-name[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*recipe-title[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*class="[^"]*tasty-recipes-title[^"]*"[^>]*>(.*?)<\/h[12]>/i,
    /<h[12][^>]*itemprop="name"[^>]*>(.*?)<\/h[12]>/i,
  ];

  const ingredientPatterns = [
    /<li[^>]*class="[^"]*wprm-recipe-ingredient[^"]*"[^>]*>(.*?)<\/li>/gi,
    /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>(.*?)<\/li>/gi,
    /<li[^>]*itemprop="recipeIngredient"[^>]*>(.*?)<\/li>/gi,
  ];

  const directionPatterns = [
    /<li[^>]*class="[^"]*wprm-recipe-instruction[^"]*"[^>]*>(.*?)<\/li>/gi,
    /<li[^>]*class="[^"]*instruction[^"]*"[^>]*>(.*?)<\/li>/gi,
    /<li[^>]*itemprop="recipeInstructions"[^>]*>(.*?)<\/li>/gi,
    /<div[^>]*class="[^"]*step-body[^"]*"[^>]*>(.*?)<\/div>/gi,
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

  // Need at least a name + some ingredients to count
  if (!name || ingredients.length < 2) return null;

  return { name, ingredients, directions };
}


// ─── NORMALIZATION HELPERS ──────────────────────────────

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
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
      const sectionSteps = (step.itemListElement || []).map(s =>
        typeof s === 'string' ? s : (s.text || '')
      );
      return sectionSteps;
    }
    return [step.text || step.description || ''];
  }).map(s => s.trim()).filter(Boolean);
}

function extractImage(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return img[0]?.url || img[0] || null;
  return img.url || null;
}

function normalizeRecipe(raw, sourceUrl) {
  return {
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
    _source: 'blog_link_follower',
  };
}


// ─── MAIN ORCHESTRATOR ──────────────────────────────────

/**
 * Phase 0.5 — Blog Link Follower
 *
 * Call AFTER Apify returns a caption, BEFORE sending a weak caption to Gemini.
 * If the caption is strong enough for Gemini, returns null immediately.
 * If weak, scans for blog links and attempts extraction.
 *
 * @param {string} caption - The Instagram caption from Apify
 * @param {string|null} imageUrl - Persisted image URL if any
 * @returns {Promise<Object|null>} Structured recipe, or null (fall through to Gemini)
 */
export async function tryBlogLinkExtraction(caption, imageUrl) {
  // Step 1: Is the caption weak?
  const quality = assessCaptionQuality(caption);

  if (!quality.isWeak) {
    console.log(`[BlogLinkFollower] Caption is strong (${quality.reason}), skipping link follow`);
    return null;
  }

  console.log(`[BlogLinkFollower] Caption is weak (${quality.reason}), scanning for links…`);

  // Step 2: Extract links from caption
  const links = extractLinksFromCaption(caption);

  if (links.length === 0) {
    console.log('[BlogLinkFollower] No usable links found in caption');
    return null;
  }

  console.log(`[BlogLinkFollower] Found ${links.length} link(s): ${links.join(', ')}`);

  // Step 3: Try each link (priority-sorted, max 3 attempts)
  for (const url of links.slice(0, 3)) {
    const recipe = await extractRecipeFromBlog(url);

    if (recipe) {
      // Attach the original IG image if the blog didn't have one
      if (!recipe.image && imageUrl) {
        recipe.image = imageUrl;
      }
      console.log(`[BlogLinkFollower] Extracted "${recipe.name}" from ${url}`);
      return recipe;
    }
  }

  console.log('[BlogLinkFollower] No recipe found at any linked URL');
  return null;
}
