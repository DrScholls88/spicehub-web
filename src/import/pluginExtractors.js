// ─────────────────────────────────────────────────────────────────────────────
// SERVER PLUGIN EXTRACTORS — WPRM / Tasty Recipes / EasyRecipe / Mediavine Create.
//
// The browser path (recipeParser.detectRecipePlugins) reads these plugin cards
// with DOMParser. This module gives /api/extract the same reach server-side via
// cheerio, so common food-blog plugins yield a complete candidate WITHOUT a
// Gemini call. Pure + synchronous; returns a flat candidate or null.
//
// IMPORTANT: only server code (api/extract.js) and tests import this — never the
// client bundle — so cheerio stays out of the browser build.
// ─────────────────────────────────────────────────────────────────────────────
import * as cheerio from 'cheerio';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function collect($, $ctx, selector) {
  const out = [];
  $ctx.find(selector).each((_i, el) => {
    const t = clean($(el).text());
    if (t) out.push(t);
  });
  return out;
}

function pickImage($ctx, selectors) {
  for (const sel of selectors) {
    const el = $ctx.find(sel).first();
    if (el.length) {
      const src =
        el.attr('src') ||
        el.attr('data-src') ||
        el.attr('data-lazy-src') ||
        el.attr('content') ||
        '';
      if (src) return src;
    }
  }
  return '';
}

function extractWPRM($, $c) {
  return {
    title: clean($c.find('.wprm-recipe-name, h2.wprm-recipe-name, [itemprop="name"]').first().text()),
    ingredients: collect($, $c, '.wprm-recipe-ingredient, li[itemprop="recipeIngredient"]'),
    directions: collect($, $c, '.wprm-recipe-instruction, li[itemprop="recipeInstructions"]'),
    imageUrl: pickImage($c, ['img[itemprop="image"]', '.wprm-recipe-image img']),
  };
}

function extractTasty($, $c) {
  return {
    title: clean($c.find('h1[itemprop="name"], .tasty-recipes-title').first().text()),
    ingredients: collect($, $c, '[itemprop="recipeIngredient"], .tasty-recipe-ingredient, .tasty-recipes-ingredients li'),
    directions: collect($, $c, '.tasty-recipes-instructions li, [itemprop="recipeInstructions"] li, [itemprop="recipeInstructions"]'),
    imageUrl: pickImage($c, ['img[itemprop="image"]', '.tasty-recipes-image img']),
  };
}

function extractEasyRecipe($, $c) {
  return {
    title: clean($c.find('[itemprop="name"]').first().text()),
    ingredients: collect($, $c, '[itemprop="recipeIngredient"], .ingredient'),
    directions: collect($, $c, '[itemprop="recipeInstructions"], .recipe-instructions li, .instructions li'),
    imageUrl: pickImage($c, ['[itemprop="image"]', 'img']),
  };
}

function extractMvCreate($, $c) {
  return {
    title: clean($c.find('.mv-create-title, [itemprop="name"]').first().text()),
    ingredients: collect($, $c, '.mv-create-ingredients li, .mv-recipe-ingredient, [itemprop="recipeIngredient"]'),
    directions: collect($, $c, '.mv-create-instructions li, .mv-create-step, [itemprop="recipeInstructions"] li'),
    imageUrl: pickImage($c, ['img[itemprop="image"]', '.mv-create-image img', 'img']),
  };
}

const PLUGINS = [
  { type: 'wprm', selector: '.wprm-recipe, [data-wprm-recipe]', fn: extractWPRM },
  { type: 'tasty', selector: '.tasty-recipes, [data-tasty-recipe]', fn: extractTasty },
  { type: 'mv-create', selector: '.mv-create-card, .mv-recipe-card', fn: extractMvCreate },
  { type: 'easyrecipe', selector: '.EasyRecipeType, .easyrecipe', fn: extractEasyRecipe },
];

/**
 * Extract a recipe candidate from common WordPress recipe-plugin markup.
 * Returns { name, title, ingredients[], directions[], imageUrl, _pluginType }
 * when a plugin card yields ingredients or directions, else null. Never throws.
 */
export function extractPluginCandidate(html) {
  if (!html || typeof html !== 'string') return null;
  let $;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }
  for (const { type, selector, fn } of PLUGINS) {
    const $c = $(selector).first();
    if (!$c.length) continue;
    let r;
    try {
      r = fn($, $c);
    } catch {
      continue;
    }
    if (r && (r.ingredients.length > 0 || r.directions.length > 0)) {
      return { ...r, name: r.title, _pluginType: type };
    }
  }
  return null;
}

export default { extractPluginCandidate };
