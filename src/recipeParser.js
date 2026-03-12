/**
 * SpiceHub Recipe Parser
 * Strategy (mirrors Paprika 3):
 *   1. ALL URLs      → server-side extraction first (server.js /api/extract-url)
 *      • Social media URLs → headless Chrome (real browser, renders JS like Paprika's WebView)
 *      • Recipe blogs      → fast HTTP fetch + JSON-LD / OG meta parsing
 *   2. CORS PROXY    → fallback if server unreachable (limited for social media)
 *   3. CAPTION TEXT  → 4-pass heuristic parser (used internally on extracted captions)
 */

// ─── Social media detection ───────────────────────────────────────────────────
const SOCIAL_DOMAINS = [
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'facebook.com', 'www.facebook.com', 'fb.watch',
  'pinterest.com', 'www.pinterest.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'twitter.com', 'x.com',
];

export function isSocialMediaUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_DOMAINS.some(d => d.replace(/^www\./, '') === host);
  } catch { return false; }
}

export function getSocialPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('facebook') || host === 'fb.watch') return 'Facebook';
    if (host.includes('pinterest')) return 'Pinterest';
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
    if (host.includes('twitter') || host === 'x.com') return 'X / Twitter';
    return 'Social Media';
  } catch { return 'Social Media'; }
}

// ─── Ingredient / Direction heuristics ────────────────────────────────────────
const UNITS_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|medium|large|small|whole|half|to taste|chopped|diced|minced|sliced|crushed|grated|shredded|fresh|dried|frozen)\b/i;
const BULLET_RE = /^[-•*▪▸►◦‣⁃✓✔]\s*/;
const FRACTION_RE = /^[½¼¾⅓⅔⅛⅜⅝⅞\d]/;
const NUM_UNIT_RE = /^[\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s]*\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?)/i;
const STEP_NUM_RE = /^\d+[.):\s-]/;
const COOKING_VERBS_RE = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|stir-fry|deep.fry|pan.fry|air.fry)\b/i;

// Common food words that indicate an ingredient line even without a unit
const FOOD_RE = /\b(chicken|beef|pork|salmon|shrimp|tofu|rice|pasta|noodles|bread|flour|sugar|butter|oil|olive oil|garlic|onion|onions|tomato|tomatoes|pepper|peppers|salt|cheese|cream|milk|eggs?|lemon|lime|vinegar|soy sauce|honey|ginger|cilantro|parsley|basil|oregano|cumin|paprika|cinnamon|avocado|potato|potatoes|broccoli|spinach|mushrooms?|carrots?|celery|corn|beans?|chickpeas?|lentils?|coconut|vanilla|chocolate|bacon|sausage|ham|turkey|lettuce|cucumber|zucchini|bell pepper|jalape[nñ]o|mayo|mayonnaise|mustard|ketchup|sriracha|sesame|peanut|almond|walnut|cashew|oats?|yogurt|sour cream|cream cheese|mozzarella|parmesan|cheddar|feta|ricotta|tortilla|pita|naan|wonton|dumpling)\b/i;

function looksLikeIngredient(line) {
  if (BULLET_RE.test(line)) return true;
  if (NUM_UNIT_RE.test(line)) return true;
  if (line.length < 100 && UNITS_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 80 && UNITS_RE.test(line)) return true;
  // Short lines with food words are likely ingredients
  if (line.length < 60 && FOOD_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 40 && FOOD_RE.test(line)) return true;
  return false;
}

function looksLikeDirection(line) {
  if (STEP_NUM_RE.test(line)) return true;
  if (COOKING_VERBS_RE.test(line)) return true;
  return false;
}

const INGREDIENTS_HEADERS = [
  'ingredients', 'you will need', "you'll need", 'what you need',
  "what you'll need", 'shopping list', 'what you\'ll need',
  'for the', 'for this recipe', 'recipe ingredients',
];
const DIRECTIONS_HEADERS = [
  'directions', 'instructions', 'method', 'steps', 'preparation',
  'how to make', 'how to prepare', 'to make', 'to prepare',
  'the process', 'process', 'let\'s make', "let's make",
  'how to cook', 'cooking instructions', 'recipe instructions',
  'procedure', 'directions:', 'instructions:',
];

function isIngredientsHeader(lower) {
  return INGREDIENTS_HEADERS.some(h => lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}
function isDirectionsHeader(lower) {
  return DIRECTIONS_HEADERS.some(h => lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}

// ─── Caption Parser (Paprika-style 4-pass) ────────────────────────────────────
export function parseCaption(text) {
  const ingredients = [];
  const directions = [];
  let title = null;

  if (!text || !text.trim()) return { title, ingredients, directions };

  // PASS 1: Clean text
  text = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')        // zero-width / soft-hyphen
    .replace(/\u2019/g, "'").replace(/\u2018/g, "'")      // smart quotes
    .replace(/\u201C/g, '"').replace(/\u201D/g, '"')
    .replace(/\u2026/g, '...').replace(/\u2013/g, '-').replace(/\u2014/g, '-')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = text.split('\n');
  let inIngredients = false;
  let inDirections = false;
  let foundSections = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    const lower = line.toLowerCase().replace(/[*_~`]/g, '').trim();

    // PASS 2: Detect explicit section headers
    if (isIngredientsHeader(lower)) {
      foundSections = true;
      inIngredients = true;
      inDirections = false;
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0 && colonIdx < line.length - 1) {
        line = line.substring(colonIdx + 1).trim();
        if (!line) continue;
      } else {
        continue;
      }
    } else if (isDirectionsHeader(lower)) {
      foundSections = true;
      inIngredients = false;
      inDirections = true;
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0 && colonIdx < line.length - 1) {
        line = line.substring(colonIdx + 1).trim();
        if (!line) continue;
      } else {
        continue;
      }
    }

    // Strip hashtags and @mentions (keep the rest of the line)
    let cleanLine = line.replace(/#\w[\w.]*/g, '').replace(/@\w+/g, '').trim();
    if (!cleanLine) continue;

    // Extract title from the first meaningful line before any section
    if (title === null && !inIngredients && !inDirections && !foundSections) {
      const isBulletOrNum = BULLET_RE.test(cleanLine) || STEP_NUM_RE.test(cleanLine);
      if (!isBulletOrNum && cleanLine.length > 3 && !looksLikeIngredient(cleanLine)) {
        let titleCandidate = cleanLine;

        // Remove emoji from title candidates
        titleCandidate = titleCandidate.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}]/gu, '').trim();

        // Long lines — try to extract just the recipe name part
        if (titleCandidate.length >= 80) {
          // Try pipe delimiter first
          const pipeParts = titleCandidate.split(/\s*[|\-–—]\s*/);
          if (pipeParts[0].length > 3 && pipeParts[0].length < 80) {
            titleCandidate = pipeParts[0].trim();
          } else {
            // Try first sentence
            const sentenceEnd = titleCandidate.search(/[.!?]\s/);
            if (sentenceEnd > 3 && sentenceEnd < 100) {
              titleCandidate = titleCandidate.substring(0, sentenceEnd).trim();
            } else {
              titleCandidate = titleCandidate.substring(0, 80).replace(/\s\S+$/, '').trim();
            }
          }
        }

        if (titleCandidate.length > 2) {
          title = cleanTitle(titleCandidate);
          continue;
        }
      }
    }

    // PASS 3: Heuristic fallback classification
    if (!foundSections) {
      const looksIng = looksLikeIngredient(cleanLine);
      const looksDir = looksLikeDirection(cleanLine);
      if (looksIng && !looksDir) { inIngredients = true; inDirections = false; }
      else if (looksDir && !looksIng) { inIngredients = false; inDirections = true; }
    }

    // Clean prefix markers
    let cleaned = cleanLine
      .replace(/^[-•*▪▸►◦‣⁃✓✔]\s*/, '')
      .replace(/^\d+[.):\s-]\s*/, '')
      .trim();
    if (!cleaned) continue;

    // PASS 4: Route to correct list
    if (inIngredients) {
      if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
    } else if (inDirections) {
      directions.push(cleaned);
    } else {
      // Final fallback
      if (looksLikeIngredient(cleanLine) && !looksLikeDirection(cleanLine)) {
        if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
      } else if (looksLikeDirection(cleanLine)) {
        directions.push(cleaned);
      }
    }
  }

  return { title, ingredients, directions };
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractMeta(html, property) {
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

function cleanTitle(title) {
  if (!title) return 'Imported Recipe';
  title = title
    // Remove "Username on Instagram: ..." prefix
    .replace(/^[\w.\s]+on\s+(Instagram|TikTok|Facebook)\s*:\s*/i, '')
    // Remove "... | Instagram" / "... - TikTok" suffix
    .replace(/\s*[|\-–—•]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube|Reels?).*$/i, '')
    .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
    // Remove handles and hashtags
    .replace(/\s*\(@[\w.]+\).*$/, '')
    .replace(/#\w[\w.]*/g, '')
    // Remove "Reel by username" etc.
    .replace(/^(Reel|Video|Post)\s+by\s+[\w.]+\s*[-–—:.]?\s*/i, '')
    // Remove social media engagement stats
    .replace(/\d+[kKmM]?\s*(likes?|comments?|shares?|views?|saves?)\s*[,.]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If title is too long, try to find a natural break point
  if (title.length > 120) {
    // Try splitting on common delimiters
    const parts = title.split(/\s*[|\-–—]\s*/);
    if (parts[0].length > 3 && parts[0].length <= 120) {
      title = parts[0].trim();
    } else {
      // Truncate to word boundary
      title = title.substring(0, 115).replace(/\s\S+$/, '').trim();
    }
  }

  // If title ended up empty after cleaning, use fallback
  if (!title || title.length < 2) return 'Imported Recipe';

  // Capitalize first letter if it's all lowercase
  if (title === title.toLowerCase() && title.length < 80) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

// ─── JSON-LD extraction ───────────────────────────────────────────────────────
function findJsonLdRecipes(html) {
  const results = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
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

  // Ingredients
  let ingredients = [];
  if (Array.isArray(node.recipeIngredient)) {
    ingredients = node.recipeIngredient
      .map(e => decodeHtml(e.toString().trim()))
      .filter(Boolean);
  }

  // Directions — handle HowToStep, HowToSection, plain strings
  let directions = [];
  const inst = node.recipeInstructions;
  if (Array.isArray(inst)) {
    for (const step of inst) {
      if (typeof step === 'string') {
        directions.push(decodeHtml(step.trim()));
      } else if (step && typeof step === 'object') {
        const t = [].concat(step['@type'] || []).join(' ').toLowerCase();
        if (t.includes('howtosection') && Array.isArray(step.itemListElement)) {
          for (const sub of step.itemListElement) {
            const txt = (sub.text || sub.name || '').toString().trim();
            if (txt) directions.push(decodeHtml(txt));
          }
        } else {
          const txt = (step.text || step.name || '').toString().trim();
          if (txt) directions.push(decodeHtml(txt));
        }
      }
    }
  } else if (typeof inst === 'string') {
    directions = inst.split(/[\n\r]+/).map(s => decodeHtml(s.trim())).filter(Boolean);
  }

  // Image
  let imageUrl = '';
  const img = node.image;
  if (typeof img === 'string') imageUrl = img;
  else if (Array.isArray(img) && img.length > 0)
    imageUrl = typeof img[0] === 'string' ? img[0] : (img[0]?.url || '');
  else if (img && typeof img === 'object') imageUrl = img.url || img['@id'] || '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
  };
}

// ─── Strip social media OG description prefix ────────────────────────────────
// Instagram OG descriptions start with "123 likes, 45 comments - username on Month Day, Year:"
// TikTok starts with "username (@handle). ... | ... likes. ..."
function stripSocialMetaPrefix(text) {
  if (!text) return text;
  // Instagram: "123 likes, 45 comments - username on Month Day, Year:"
  text = text.replace(/^[\d,.]+[kKmM]?\s+likes?,?\s*[\d,.]+[kKmM]?\s+comments?\s*[-–—]\s*[^:]+:\s*/i, '');
  // Instagram alt: "username shared a post on Instagram: "..."
  text = text.replace(/^[\w.]+\s+shared\s+a\s+(post|reel)\s+on\s+Instagram\s*:\s*/i, '');
  // TikTok: "username (@handle). description | 123 Likes..."
  text = text.replace(/^[\w.]+\s*\(@[\w.]+\)\.\s*/i, '');
  // Remove trailing " | 123 Likes. 45 Comments. ..."
  text = text.replace(/\s*\|\s*[\d,.]+[kKmM]?\s+Likes\..*$/i, '');
  return text.trim();
}

// ─── CORS proxy fallback (used when server is unavailable) ────────────────────
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

async function fetchHtmlViaProxy(url, timeoutMs = 12000) {
  for (const makeProxy of PROXIES) {
    const proxyUrl = makeProxy(url);
    try {
      const resp = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text.includes('Log in') && text.includes('instagram') && text.length < 20000) {
        return null; // Instagram login wall
      }
      return text;
    } catch { /* try next proxy */ }
  }
  return null;
}

// ─── Convert server extraction response → recipe format ──────────────────────
function handleServerExtraction(data, sourceUrl) {
  if (!data || !data.ok) return null;

  if (data.type === 'jsonld' && data.recipe?.name) {
    const node = data.recipe;
    const name = (node.name || '').toString().trim() || 'Imported Recipe';

    const ingredients = Array.isArray(node.recipeIngredient)
      ? node.recipeIngredient.map(s => s.toString().trim()).filter(Boolean)
      : [];

    const directions = [];
    const inst = node.recipeInstructions;
    if (Array.isArray(inst)) {
      for (const step of inst) {
        if (typeof step === 'string') {
          directions.push(step.trim());
        } else if (step && typeof step === 'object') {
          const types = [].concat(step['@type'] || []).join(' ').toLowerCase();
          if (types.includes('howtosection') && Array.isArray(step.itemListElement)) {
            for (const sub of step.itemListElement) {
              const t = (sub.text || sub.name || '').toString().trim();
              if (t) directions.push(t);
            }
          } else {
            const t = (step.text || step.name || '').toString().trim();
            if (t) directions.push(t);
          }
        }
      }
    } else if (typeof inst === 'string') {
      directions.push(...inst.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean));
    }

    let imageUrl = '';
    const img = node.image;
    if (typeof img === 'string') imageUrl = img;
    else if (Array.isArray(img) && img.length) imageUrl = typeof img[0] === 'string' ? img[0] : img[0]?.url || '';
    else if (img && typeof img === 'object') imageUrl = img.url || '';

    return {
      name,
      ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
      directions: directions.length ? directions : ['See recipe for directions'],
      imageUrl: data.imageUrl || imageUrl,
      link: data.sourceUrl || sourceUrl,
    };
  }

  if (data.type === 'caption' && (data.caption || data.title)) {
    const caption = stripSocialMetaPrefix(data.caption || '');
    const parsed = parseCaption(caption);
    let title = data.title || parsed.title || 'Imported Recipe';
    title = cleanTitle(title);

    return {
      name: title,
      ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
      directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
      imageUrl: data.imageUrl || '',
      link: data.sourceUrl || sourceUrl,
    };
  }

  // Server got the page but found nothing useful — try with OG data if available
  if (data.title) {
    const title = cleanTitle(data.title);
    const desc = stripSocialMetaPrefix(data.caption || data.description || '');
    const parsed = desc ? parseCaption(desc) : { ingredients: [], directions: [], title: null };
    return {
      name: parsed.title || title,
      ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
      directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
      imageUrl: data.imageUrl || '',
      link: data.sourceUrl || sourceUrl,
    };
  }

  return null;
}

/**
 * Main entry: parse recipe from a URL.
 * Tries: 1) Server-side extraction  2) CORS proxy
 * Returns { name, ingredients, directions, link, imageUrl }
 *      or { _error: true, reason } on failure
 *      or null if completely failed
 */
export async function parseFromUrl(url) {
  // ── 1. Try server-side extraction (works for ALL URLs including social media) ──
  try {
    const { extractUrl } = await import('./api.js');
    const data = await extractUrl(url);
    if (data && data.ok) {
      const recipe = handleServerExtraction(data, url);
      if (recipe) return recipe;
    }
    // If server says login wall
    if (data && data.isLoginWall) {
      return { _error: true, reason: 'login-wall', platform: getSocialPlatform(url) };
    }
  } catch {
    // Server unreachable — fall through to CORS proxy
    console.log('[SpiceHub] Server extraction unavailable, trying CORS proxy...');
  }

  // ── 2. CORS proxy fallback (works for recipe blogs, limited for social media) ──
  try {
    const html = await fetchHtmlViaProxy(url);
    if (html) {
      const recipe = parseHtml(html, url);
      if (recipe) return recipe;
    }
  } catch {
    console.log('[SpiceHub] CORS proxy failed');
  }

  // ── 3. All methods exhausted ──
  if (isSocialMediaUrl(url)) {
    return { _error: true, reason: 'social-fetch-failed', platform: getSocialPlatform(url) };
  }
  return null;
}

/**
 * Parse recipe from raw HTML.
 */
export function parseHtml(html, sourceUrl) {
  // 1. JSON-LD (best, most reliable)
  const [jsonLdRecipe] = findJsonLdRecipes(html);
  if (jsonLdRecipe) {
    return { ...jsonLdRecipe, link: sourceUrl };
  }

  // 2. Meta tags fallback
  let title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  let description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description');
  let imageUrl = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image') || '';

  if (!imageUrl) {
    const posterM = /<video[^>]*poster\s*=\s*["']([^"']+)["']/i.exec(html);
    if (posterM) imageUrl = posterM[1];
  }

  if (!title) return null;
  title = cleanTitle(title);

  // Strip social media prefix from description
  description = stripSocialMetaPrefix(description || '');

  let ingredients = ['See original recipe for ingredients'];
  let directions = ['See original recipe for directions'];

  if (description) {
    const parsed = parseCaption(description);
    if (parsed.ingredients.length > 0) ingredients = parsed.ingredients;
    if (parsed.directions.length > 0) directions = parsed.directions;
    if (parsed.title) title = parsed.title;
  }

  return { name: title, ingredients, directions, link: sourceUrl, imageUrl };
}

