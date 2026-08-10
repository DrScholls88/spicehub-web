/**
 * SpiceHub — shared HTML → Recipe extraction engine.
 *
 * 2026-08-09: this used to be two independent, hand-rolled implementations —
 * one inside recipeParser.js (the direct "paste a blog URL" import path) and
 * one inside blogLinkFollower.js (the "Instagram caption has a weak/partial
 * caption + a blog link" path). Same job (JSON-LD → microdata → CSS-heuristic
 * cascade over a recipe blog page), two separate regex sets that could drift
 * and produce different-quality results for the exact same page depending on
 * which path found it. This module is the single source of truth for both.
 *
 * Deliberately has NO dependency on recipeParser.js (acyclic graph —
 * recipeParser.js imports FROM here, not the other way around; blogLinkFollower.js
 * is itself imported by recipeParser.js, so a reverse import would create a
 * cycle). recipeParser.js's parseCaption()-based meta-tag fallback (Strategy 4)
 * stays local to recipeParser.js for this reason — it's a general text
 * classifier, not HTML-specific, and out of scope for this module.
 */

// ─── HTML / text helpers ─────────────────────────────────────────────────────

export function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeHtml(m[1]);
  }
  return null;
}

// 2026-08-09: kept local/unexported here — this is the elaborate social-caption
// title scrubber (strips "@user on Instagram:", engagement stats, etc.).
// recipeParser.js has its own copy for its meta-tag/parseCaption fallback tier;
// deliberately NOT reconciled into one shared export because JSON-LD/microdata/
// CSS-sourced titles (what this module's callers actually use it for) come
// from recipe-plugin markup, not social captions, and don't need this level
// of scrubbing — a plain decode+trim is enough, this is just a nice-to-have
// belt-and-suspenders pass for the CSS-heuristic title fallback below.
function cleanTitle(title) {
  if (!title) return 'Imported Recipe';
  title = title
    .replace(/^[\w.\s]+on\s+(Instagram|TikTok|Facebook)\s*:\s*/i, '')
    .replace(/\s*[|\-–—•]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube|Reels?|Allrecipes|AllRecipes|Food Network|Tasty|Delish|Serious Eats|Bon Appétit|Epicurious|Simply Recipes|The Pioneer Woman|Yummly|Skinnytaste|Love and Lemons|Half Baked Harvest|Cookie and Kate|Minimalist Baker|Budget Bytes).*$/i, '')
    .replace(/\s*[|]\s*[A-Z][A-Za-z0-9 &]{1,24}$/, '')
    .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
    .replace(/^[^|]*[•ⓋⒶ-ⓩ][^|]*\|\s*/u, '')
    .replace(/^@[\w.]+[:\s]+/i, '')
    .replace(/\s*\(@[\w.]+\).*$/, '')
    .replace(/#\w[\w.]*/g, '')
    .replace(/^(Reel|Video|Post)\s+by\s+[\w.]+\s*[-–—:.]?\s*/i, '')
    .replace(/\d+[kKmM]?\s*(likes?|comments?|shares?|views?|saves?)\s*[,.]?\s*/gi, '')
    .replace(/\s*Part\s*\d+!?\s*$/i, '')
    .replace(/\s*Ready in Just \d+ Minutes!?\s*/i, '')
    .replace(/\s*Welcome\s*$/i, '')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  title = title.replace(/[!]+$/, '').trim();

  if (title.length > 120) {
    const parts = title.split(/\s*[|\-–—]\s*/);
    if (parts[0].length > 3 && parts[0].length <= 120) {
      title = parts[0].trim();
    } else {
      title = title.substring(0, 115).replace(/\s\S+$/, '').trim();
    }
  }

  if (!title || title.length < 2) return 'Imported Recipe';

  if (title === title.toUpperCase() && title.length > 5) {
    title = title.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
  }
  if (title === title.toLowerCase() && title.length < 80) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

// ─── Image selection: pick the best/largest from candidates ─────────────────
// JSON-LD `image` can be: a string, an array of strings, an ImageObject,
// an array of ImageObjects, or nested combinations.
export function selectBestImage(imageField) {
  if (!imageField) return '';

  const candidates = [];
  function collect(val) {
    if (!val) return;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && (trimmed.startsWith('http') || trimmed.startsWith('//'))) {
        candidates.push(trimmed);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) collect(item);
      return;
    }
    if (typeof val === 'object') {
      if (val.url) collect(val.url);
      else if (val.contentUrl) collect(val.contentUrl);
      else if (val['@id']) collect(val['@id']);
      if (val.thumbnail?.url) collect(val.thumbnail.url);
    }
  }

  collect(imageField);
  if (candidates.length === 0) return '';
  if (candidates.length === 1) return candidates[0];

  function scoreUrl(url) {
    let score = 0;
    const sizeMatch = url.match(/(\d{3,4})x(\d{3,4})/);
    if (sizeMatch) {
      const w = parseInt(sizeMatch[1]), h = parseInt(sizeMatch[2]);
      score = w * h;
      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio > 3) score *= 0.3;
    }
    if (/\b(full|large|original|hero|featured|1080|1200|1440)\b/i.test(url)) score += 500000;
    if (/\b(thumb|small|tiny|icon|avatar|emoji|s150|s320|150x150|320x320|profile_pic)\b/i.test(url)) score -= 1000000;
    score -= url.length * 0.5;
    return score;
  }

  candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return candidates[0];
}

/**
 * Aggressive image fallback chain shared by every extraction strategy below.
 * Order: caller-provided → og:image → twitter:image → schema itemprop="image"
 *        → video poster → largest recipe-context <img>.
 */
export function pickImage(html, ...preferred) {
  for (const p of preferred) {
    if (p && typeof p === 'string' && p.trim()) return p.trim();
  }
  const og = extractMeta(html, 'og:image') || extractMeta(html, 'og:image:secure_url');
  if (og) return og;
  const tw = extractMeta(html, 'twitter:image') || extractMeta(html, 'twitter:image:src');
  if (tw) return tw;
  const itempropM = /<(?:meta|link)[^>]+itemprop\s*=\s*["']image["'][^>]+(?:content|href)\s*=\s*["']([^"']+)["']/i.exec(html);
  if (itempropM) return itempropM[1];
  const posterM = /<video[^>]*poster\s*=\s*["']([^"']+)["']/i.exec(html);
  if (posterM) return posterM[1];
  const imgRe = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const src = m[1];
    if (!src || src.startsWith('data:') || /\.(svg|gif)(\?|$)/i.test(src)) continue;
    if (/(recipe|food|dish|hero|wp-post-image|featured)/i.test(tag)) return src;
  }
  return '';
}

// ─── Instruction parsing ─────────────────────────────────────────────────────

/**
 * Iterative instruction sanitization:
 * Strip HTML, decode entities, collapse whitespace — loop until stable.
 */
export function sanitizeInstruction(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text.trim();
  let prev = '';
  for (let i = 0; i < 5 && clean !== prev; i++) {
    prev = clean;
    clean = decodeHtml(clean.replace(/<[^>]+>/g, ' ').replace(/\xa0/g, ' ').replace(/ +/g, ' ')).trim();
  }
  return clean;
}

// Handles the many formats recipe sites use for instructions:
//   - Array of strings
//   - Array of { text: "..." } objects (HowToStep)
//   - Array of { "@type": "HowToSection", itemListElement: [...] }
//   - A single string (newline-separated or JSON-encoded)
//   - Dict-indexed objects { "0": { text: "..." }, "1": { text: "..." } }
export function parseInstructionsFlexible(inst) {
  if (!inst) return [];

  if (typeof inst === 'string') {
    const trimmed = inst.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try { return parseInstructionsFlexible(JSON.parse(trimmed)); }
      catch { /* fall through to split */ }
    }
    return trimmed.split(/[\n\r]+/).map(s => sanitizeInstruction(s)).filter(Boolean);
  }

  if (inst && typeof inst === 'object' && !Array.isArray(inst)) {
    const keys = Object.keys(inst);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      return parseInstructionsFlexible(keys.sort((a, b) => +a - +b).map(k => inst[k]));
    }
    const txt = inst.text || inst.name || '';
    return txt ? [sanitizeInstruction(txt.toString())] : [];
  }

  if (!Array.isArray(inst)) return [];

  const directions = [];
  for (const step of inst) {
    if (typeof step === 'string') {
      const clean = sanitizeInstruction(step);
      if (clean) directions.push(clean);
    } else if (step && typeof step === 'object') {
      const t = [].concat(step['@type'] || step.type || []).join(' ').toLowerCase();
      if (t.includes('howtosection') && Array.isArray(step.itemListElement)) {
        for (const sub of step.itemListElement) {
          const txt = (sub.text || sub.name || '').toString().trim();
          if (txt) directions.push(sanitizeInstruction(txt));
        }
      } else {
        const txt = (step.text || step.name || '').toString().trim();
        if (txt) directions.push(sanitizeInstruction(txt));
      }
    }
  }
  return directions.filter(Boolean);
}

// ─── JSON-LD extraction ──────────────────────────────────────────────────────

/**
 * @returns {Array<object>} every Recipe node found across all <script
 *   type="application/ld+json"> blocks on the page, in document order.
 */
export function findJsonLdRecipes(html) {
  const results = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      // eslint-disable-next-line no-control-regex -- intentional: strips
      // stray control bytes some sites embed in JSON-LD blocks, which would
      // otherwise throw a silent JSON.parse failure.
      const data = JSON.parse(m[1].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim());
      const recipe = extractRecipeFromJsonLd(Array.isArray(data) ? data : [data]);
      if (recipe) results.push(recipe);
    } catch { /* skip malformed JSON */ }
  }
  return results;
}

function extractRecipeFromJsonLd(items) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const type = [].concat(item['@type'] || []).join(' ').toLowerCase();
    if (type.includes('recipe')) return parseRecipeNode(item);
    if (item['@graph']) {
      const r = extractRecipeFromJsonLd([].concat(item['@graph']));
      if (r) return r;
    }
    // mainEntity wrapper (some themes nest Recipe inside Article/WebPage)
    if (item.mainEntity) {
      const me = item.mainEntity;
      const meType = [].concat(me?.['@type'] || []).join(' ').toLowerCase();
      if (meType.includes('recipe')) return parseRecipeNode(me);
    }
    // Arrays inside item
    for (const val of Object.values(item)) {
      if (Array.isArray(val)) {
        const r = extractRecipeFromJsonLd(val);
        if (r) return r;
      }
    }
  }
  return null;
}

function parseRecipeNode(node) {
  const name = decodeHtml((node.name || '').toString().trim());
  if (!name) return null;

  let ingredients = [];
  if (Array.isArray(node.recipeIngredient)) {
    ingredients = node.recipeIngredient
      .map(e => decodeHtml(e.toString().trim()))
      .filter(Boolean);
  }

  // Directions — Comprehensive parsing: handles HowToStep, HowToSection,
  // plain strings, JSON strings, dict-indexed steps, newline-separated blocks.
  const directions = parseInstructionsFlexible(node.recipeInstructions);

  // Image — pick the best/largest from multiple candidates
  const imageUrl = selectBestImage(node.image);

  // 2026-08-09: prepTime/cookTime/totalTime/servings/description/category/
  // cuisine — previously only extracted by blogLinkFollower's local jsonLdToRaw,
  // silently dropped here. Adding them is a strict superset: every existing
  // caller of this function only reads name/ingredients/directions/imageUrl
  // today, so this can't regress anything, and it's what makes this function
  // a true drop-in replacement for blogLinkFollower's version.
  const servings = node.recipeYield
    ? (Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield)
    : '';
  const category = node.recipeCategory
    ? (Array.isArray(node.recipeCategory) ? node.recipeCategory.join(', ') : node.recipeCategory)
    : '';
  const cuisine = node.recipeCuisine
    ? (Array.isArray(node.recipeCuisine) ? node.recipeCuisine.join(', ') : node.recipeCuisine)
    : '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl,
    prepTime: node.prepTime || '',
    cookTime: node.cookTime || '',
    totalTime: node.totalTime || '',
    servings: servings ? servings.toString() : '',
    description: node.description ? decodeHtml(node.description.toString().trim()) : '',
    category,
    cuisine,
  };
}

// ─── Microdata extraction (itemprop/itemtype) ────────────────────────────────

export function extractMicrodataFromHtml(html) {
  if (!html.includes('schema.org/Recipe')) return null;

  const nameRe = /<[^>]*itemprop\s*=\s*["']name["'][^>]*>([^<]+)/i;
  const nameM = nameRe.exec(html);
  const name = nameM ? decodeHtml(nameM[1].trim()) : '';
  if (!name) return null;

  const ingredients = [];
  const ingRe = /<[^>]*itemprop\s*=\s*["']recipeIngredient["'][^>]*>([\s\S]*?)<\/(?:li|span|div|p)>/gi;
  let m;
  while ((m = ingRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 2) ingredients.push(text);
  }

  const directions = [];
  const instRe = /<[^>]*itemprop\s*=\s*["']recipeInstructions["'][^>]*>([\s\S]*?)<\/(?:li|div|ol|section)>/gi;
  while ((m = instRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 5) directions.push(text);
  }

  if (ingredients.length === 0 && directions.length === 0) return null;

  // Single-value itemprops (2026-08-09: parity with blogLinkFollower's
  // extractMicrodata, which this replaces — prepTime/cookTime/totalTime/
  // servings/description were previously only captured on that path).
  const getItemprop = (prop) => {
    const re = new RegExp(`itemprop=["']${prop}["'][^>]*>([^<]*)`, 'i');
    const pm = re.exec(html);
    return pm ? stripTags(decodeHtml(pm[1])) : '';
  };

  const imageUrl = extractMeta(html, 'og:image') || '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl,
    prepTime: getItemprop('prepTime'),
    cookTime: getItemprop('cookTime'),
    totalTime: getItemprop('totalTime'),
    servings: getItemprop('recipeYield'),
    description: getItemprop('description'),
  };
}

// ─── Heuristic CSS class extraction (WPRM, Tasty, Feast, Mediavine Create, etc.) ──

export function extractRecipeByCSS(html) {
  const ingPatterns = [
    // WP Recipe Maker (most popular)
    /class\s*=\s*["'][^"']*wprm-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    // Tasty Recipes
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    // Mediavine Create (mv-create-*)
    /class\s*=\s*["'][^"']*mv-create-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    /class\s*=\s*["'][^"']*mv-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*mv-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Feast Plugin (used by many food blogs)
    /class\s*=\s*["'][^"']*recipe-card-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*ingredients__ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // AdThrive / Raptive
    /class\s*=\s*["'][^"']*at-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*adthrive-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Generic recipe ingredient patterns
    /class\s*=\s*["'][^"']*recipe__ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*ingredient-item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*recipe-ingred_txt[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
    /class\s*=\s*["'][^"']*structured-ingredients__list-item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*ingredient-list__item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*recipe-ingredients__item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // NYT Cooking, Serious Eats
    /class\s*=\s*["'][^"']*o-Ingredient__a-Name[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
    /class\s*=\s*["'][^"']*ingredient__quantity[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
    // Broad fallbacks
    /class\s*=\s*["'][^"']*recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*ingredient-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
    // schema.org recipeIngredient inside any tag
    /itemprop\s*=\s*["']recipeIngredient["'][^>]*>([^<]{3,200})/gi,
  ];

  const ingredients = [];
  for (const re of ingPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = stripTags(decodeHtml(m[1]));
      if (text && text.length > 2 && text.length < 200) ingredients.push(text);
    }
    if (ingredients.length > 0) break;
  }

  const dirPatterns = [
    // WP Recipe Maker
    /class\s*=\s*["'][^"']*wprm-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    // Tasty Recipes
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    // Mediavine Create (mv-create-*)
    /class\s*=\s*["'][^"']*mv-create-instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    /class\s*=\s*["'][^"']*mv-create-step[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    /class\s*=\s*["'][^"']*mv-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*mv-instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Feast Plugin
    /class\s*=\s*["'][^"']*recipe-card-step[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    /class\s*=\s*["'][^"']*instructions__instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // AdThrive / Raptive
    /class\s*=\s*["'][^"']*at-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*adthrive-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Generic patterns
    /class\s*=\s*["'][^"']*recipe__step[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*step-item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*recipe-directions__item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*structured-project__step[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    /class\s*=\s*["'][^"']*recipe-step__text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    // NYT Cooking, Serious Eats
    /class\s*=\s*["'][^"']*o-Method__m-Step[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Gutenberg blocks
    /class\s*=\s*["'][^"']*wp-block-list-item[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi,
    // Broad fallbacks
    /class\s*=\s*["'][^"']*recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*step-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
    // schema.org recipeInstructions inside <li>
    /itemprop\s*=\s*["'](?:recipeInstructions|step)["'][^>]*>([\s\S]*?)<\/(?:li|div|section)>/gi,
  ];

  const directions = [];
  for (const re of dirPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = stripTags(decodeHtml(m[1]));
      if (text && text.length > 5) directions.push(text);
    }
    if (directions.length > 0) break;
  }

  if (ingredients.length === 0 && directions.length === 0) return null;

  let name = '';
  const titlePatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-name[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*tasty-recipes-title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*mv-create-title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*recipe-card-title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*recipe[_-]?name[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*recipe[_-]?title[^"']*["'][^>]*>([^<]+)/i,
  ];
  for (const re of titlePatterns) {
    const m = re.exec(html);
    if (m) { name = decodeHtml(m[1].trim()); break; }
  }
  if (!name) name = extractMeta(html, 'og:title') || 'Imported Recipe';
  name = cleanTitle(name);

  return {
    name,
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl: extractMeta(html, 'og:image') || '',
  };
}

// ─── Top-level structured cascade (JSON-LD → microdata → CSS heuristic) ─────
// Deliberately does NOT include recipeParser.js's Strategy 4 (meta tags +
// parseCaption text classification) — that depends on parseCaption, a large
// general-purpose text engine that lives in recipeParser.js and would create
// a circular import if pulled in here. Callers that want that final fallback
// (recipeParser.js's parseHtml) layer it on top of this function themselves.
export function parseHtmlStructured(html, sourceUrl) {
  const [jsonLdRecipe] = findJsonLdRecipes(html);
  if (jsonLdRecipe) {
    const hasContent = jsonLdRecipe.ingredients?.length > 0 || jsonLdRecipe.directions?.length > 0;
    if (hasContent) {
      return { ...jsonLdRecipe, link: sourceUrl, imageUrl: pickImage(html, jsonLdRecipe.imageUrl) };
    }
    // Has a name but no content — continue to microdata/CSS for the actual
    // recipe data. Merged back in below if those find content.
  }

  const microdataRecipe = extractMicrodataFromHtml(html);
  if (microdataRecipe) {
    const name = (jsonLdRecipe?.name && !microdataRecipe.name) ? jsonLdRecipe.name : microdataRecipe.name;
    const imageUrl = pickImage(html, microdataRecipe.imageUrl, jsonLdRecipe?.imageUrl);
    return { ...microdataRecipe, name, imageUrl, link: sourceUrl };
  }

  const heuristicRecipe = extractRecipeByCSS(html);
  if (heuristicRecipe) {
    const name = heuristicRecipe.name || jsonLdRecipe?.name || '';
    const imageUrl = pickImage(html, heuristicRecipe.imageUrl, jsonLdRecipe?.imageUrl);
    return { ...heuristicRecipe, name, imageUrl, link: sourceUrl };
  }

  return null;
}
