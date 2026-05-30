/**
 * SpiceHub Recipe Parser
 * Strategy (mirrors Paprika 3):
 *   1. ALL URLs      Ã¢â€ â€™ server-side extraction first (server.js /api/extract-url)
 *      Ã¢â‚¬Â¢ Social media URLs Ã¢â€ â€™ headless Chrome (real browser, renders JS like Paprika's WebView)
 *      Ã¢â‚¬Â¢ Recipe blogs      Ã¢â€ â€™ fast HTTP fetch + JSON-LD / OG meta parsing
 *   2. CORS PROXY    Ã¢â€ â€™ fallback if server unreachable (limited for social media)
 *   3. CAPTION TEXT  Ã¢â€ â€™ 4-pass heuristic parser (used internally on extracted captions)
 */
import { cleanUrl, isInstagramCdnUrl, fetchHtmlViaProxy as fetchHtmlViaProxyFromApi, downloadImageAsDataUrl, fetchInstagramOEmbed, fetchInstagramJson, fetchInstagramJsonDetails, fetchInstagramViaApify } from './api.js';
import { getCachedImport, setCachedImport } from './db.js';
import { isRedditUrl, isRedditPostUrl, tryRedditJson } from './scrapers/redditDiscovery.js';
import { htmlToMarkdown, htmlLooksLikeRecipe } from './scrapers/markdownConverter.js';
import { parseIngredient } from 'parse-ingredient';
import {
  canonicalizeUnit,
  normalizeFraction,
  wordToNumber,
  resolveIngredientAlias,
  isSectionHeader,
  sectionLabelFrom,
  detectKindHeuristic,
  COURSE,
  DISH_TYPE,
  RECIPE_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildFewShotContents,
  thinFromStructured,
} from './recipeSchema.js';

// ─── Phase 1: Global abort + timeout plumbing ───────────────────────────────
// One AbortController + a hard 45s race aborts every in-flight fetch and Gemini
// call, then resolves the public entry point to { _error, reason:'timeout' }.
const GLOBAL_IMPORT_TIMEOUT_MS = 45000;

/**
 * Compose a caller-supplied AbortSignal with one or more internal signals.
 * Returns a single AbortSignal that fires when ANY input signal fires. Uses the
 * native AbortSignal.any when available, falling back to manual wiring.
 */
function composeSignals(...signals) {
  const real = signals.filter(Boolean);
  if (real.length === 0) return undefined;
  if (real.length === 1) return real[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    try { return AbortSignal.any(real); } catch { /* fall through */ }
  }
  const ctrl = new AbortController();
  const onAbort = () => { try { ctrl.abort(); } catch { /* noop */ } };
  for (const s of real) {
    if (s.aborted) { onAbort(); break; }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

/** True if the given signal is aborted (defensive against undefined). */
function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}

// ─── Phase 6 (Frontier): optional spoken-recipe transcription, OFF by default ──
// Mealie-style video path. Provider-agnostic and env-gated: unless a Whisper-
// compatible endpoint is configured via VITE_ASR_ENDPOINT, this is a no-op and
// the pipeline behaves exactly as before. When configured, the server is asked
// to pull subtitles first (cheapest) and only transcribe audio if needed; the
// returned transcript is fed back through captionToRecipe. No key lives in code.
async function transcribeViaASR(mediaUrl, { type = 'meal', signal } = {}) {
  const asrEndpoint = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ASR_ENDPOINT : null;
  if (!asrEndpoint || !mediaUrl) return null;              // disabled → unchanged behavior
  if (isAborted(signal)) return null;
  try {
    // The actual subtitle/audio extraction runs server-side (yt-dlp + ffmpeg +
    // Whisper) because the browser cannot download media streams. We only ask
    // the configured backend for a transcript here; the network/credentials live
    // entirely in env + server. This stub returns null until ASR is provisioned.
    const serverBase =
      (typeof window !== 'undefined' && window.__SPICEHUB_SERVER__)
      || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SERVER_URL : null)
      || null;
    if (!serverBase) return null;
    const res = await fetch(`${serverBase}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: mediaUrl, type }),
      signal: composeSignals(signal, AbortSignal.timeout(GLOBAL_IMPORT_TIMEOUT_MS)),
    });
    if (!res.ok) return null;                              // 501 when server ASR disabled
    const data = await res.json();
    const transcript = (data && (data.transcript || data.text)) || '';
    if (!transcript || transcript.trim().length < 20) return null;
    return captionToRecipe(transcript, { imageUrl: '', sourceUrl: mediaUrl, type, signal });
  } catch {
    return null;
  }
}

/**
 * looksLikeIngredientLine Ã¢â‚¬â€ uses parse-ingredient (battle-tested NLP for
 * "1 Ã‚Â½ cups flour" / fractions / metric / parenthetical notes) as the
 * primary signal that a line is an ingredient. Falls back gracefully on
 * malformed input. Returns true when at least one parsed entry has a
 * recognised quantity, unit, or non-empty description.
 */
function looksLikeIngredientLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 240) return false;
  try {
    const parsed = parseIngredient(trimmed);
    if (!parsed || parsed.length === 0) return false;
    const entry = parsed[0];
    // Require either a quantity OR a unit OR an "ingredient" identified beyond
    // the raw text Ã¢â‚¬â€ protects against parse-ingredient labelling whole sentences
    // (e.g. "Mix the flour with eggs") as ingredients with quantity 1.
    const hasQty = entry.quantity != null || entry.quantity2 != null;
    const hasUnit = entry.unitOfMeasure || entry.unitOfMeasureID;
    const hasShortDesc = entry.description && entry.description.length > 0 && entry.description.length < 80;
    return Boolean((hasQty && hasShortDesc) || (hasUnit && hasShortDesc));
  } catch {
    return false;
  }
}

// ——— Image URL validation helpers ———————————————————————————————————————————
// Instagram embed HTML contains many URLs from cdninstagram.com that are NOT
// images (JS bundles, CSS, fonts, WASM). These must be rejected before we try
// to proxy/display them as recipe photos.

/** Returns true if `url` looks like an actual image URL (not JS/CSS/font/etc). */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // data: URIs are fine if they're images
  if (url.startsWith('data:')) return url.startsWith('data:image/');
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    // Reject known non-image extensions
    if (/\.(js|css|woff2?|ttf|eot|svg|html?|json|xml|wasm|map|txt)(\?|$)/i.test(path)) return false;
    // Reject Instagram/Meta resource paths (rsrc.php bundles, static assets)
    if (/\/rsrc\.php\//i.test(path)) return false;
    if (/\/static\//.test(path) && !/\.(jpg|jpeg|png|webp|gif|avif|heic)/i.test(path)) return false;
    return true;
  } catch {
    // If URL can't be parsed, check basic patterns
    return !/\.(js|css|woff2?|ttf)([?#]|$)/i.test(url);
  }
}

/** Returns true if `url` is a profile picture / avatar (not a food photo). */
function isProfilePicUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /profile_pic|avatar|accounts\/avatars|[?&]s=150|150x150|s150x150|dst-jpg_s150x150|\/profile\//i.test(url);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Title sanitizer (public export, delegates to cleanTitle) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export function sanitizeRecipeTitle(raw) {
  return cleanTitle(raw);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Structured ingredient / direction helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * structureIngredient Ã¢â‚¬â€ Parse a raw ingredient string into quantity/unit/item parts.
 * Returns {quantity, unit, item} where any field may be empty string.
 * Examples:
 *   "2 cups flour"            Ã¢â€ â€™ { quantity: "2", unit: "cups", item: "flour" }
 *   "1/2 tsp vanilla extract" Ã¢â€ â€™ { quantity: "1/2", unit: "tsp", item: "vanilla extract" }
 *   "Salt to taste"           Ã¢â€ â€™ { quantity: "", unit: "", item: "Salt to taste" }
 *   "Ã¢â‚¬Â¢ 3 tbsp olive oil"      Ã¢â€ â€™ { quantity: "3", unit: "tbsp", item: "olive oil" }
 */
export function structureIngredient(raw = '') {
  const text = raw.replace(/^[\u2022\-\*]\s*/, '').trim(); // strip bullets
  const UNITS = /^(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|liters?|l|cloves?|pieces?|pinch(?:es)?|dash(?:es)?|handfuls?|slices?|cans?|packages?|pkgs?|bunches?|heads?|stalks?|sprigs?|leaves?)/i;
  // Match: optional fraction/decimal/integer, optional unit, rest = item
  const m = text.match(/^(\d+(?:[\/\.]\d+)?(?:\s+\d+\/\d+)?)\s+(?:(\S+)\s+)?(.*)/);

  // Phase 4: finalize() canonicalizes the unit (teaspoons->tsp) and resolves the
  // ingredient to its canonical name + grocery aisle via the shared schema, so
  // downstream search/sort/shopping-list grouping is consistent. Additive fields
  // (unitCanon, canonicalName, aisle) preserve the original {quantity,unit,item}.
  const finalize = (quantity, unit, item) => {
    const cleanItem = (item || '').trim();
    const canonUnit = unit ? (canonicalizeUnit(unit) || unit.trim()) : '';
    const alias = resolveIngredientAlias(cleanItem);
    return {
      quantity: (quantity || '').trim(),
      unit: canonUnit,
      item: cleanItem,
      unitCanon: canonUnit,
      canonicalName: alias.canonical || cleanItem,
      aisle: alias.aisle || '',
    };
  };

  if (!m) return finalize('', '', text);
  const [, qty, maybeUnit, rest] = m;
  if (maybeUnit && UNITS.test(maybeUnit)) {
    return finalize(qty, maybeUnit, rest);
  }
  // No unit match Ã¢â‚¬â€ quantity only, rest is item
  return finalize(qty, '', ((maybeUnit || '') + ' ' + (rest || '')).trim());
}

/**
 * structureDirection Ã¢â‚¬â€ Wrap a direction string as a numbered step object.
 */
export function structureDirection(raw = '', index = 0) {
  return { step: index + 1, text: raw.trim() };
}

/**
 * buildStructuredFields Ã¢â‚¬â€ Compute all four structured/searchable fields from
 * plain ingredient and direction arrays. Always safe to call Ã¢â‚¬â€ returns empty
 * arrays/strings if inputs are missing or empty.
 */
export function buildStructuredFields(ingredients = [], directions = []) {
  const ings = (ingredients || []).filter(Boolean);
  const dirs = (directions || []).filter(Boolean);
  return {
    ingredients_structured: ings.map(structureIngredient),
    directions_structured:  dirs.map(structureDirection),
    ingredients_text: ings.map(i => i.replace(/^[\u2022\-\*]\s*/, '')).join(' '),
    directions_text:  dirs.join(' '),
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Social media detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Mealie-inspired image selection: pick the best/largest from candidates Ã¢â€â‚¬Ã¢â€â‚¬
// JSON-LD `image` can be: a string, an array of strings, an ImageObject,
// an array of ImageObjects, or nested combinations.
function selectBestImage(imageField) {
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
    // Prefer images with explicit dimensions in URL
    const sizeMatch = url.match(/(\d{3,4})x(\d{3,4})/);
    if (sizeMatch) {
      const w = parseInt(sizeMatch[1]), h = parseInt(sizeMatch[2]);
      score = w * h;
      // Penalize extreme aspect ratios (likely banners or strips)
      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio > 3) score *= 0.3;
    }
    // Keyword bonuses/penalties
    if (/\b(full|large|original|hero|featured|1080|1200|1440)\b/i.test(url)) score += 500000;
    if (/\b(thumb|small|tiny|icon|avatar|emoji|s150|s320|150x150|320x320|profile_pic)\b/i.test(url)) score -= 1000000;
    // Prefer shorter URLs (cleaner, fewer query params = more likely direct image)
    score -= url.length * 0.5;
    return score;
  }

  candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return candidates[0];
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Ingredient / Direction heuristics (enhanced) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const UNITS_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|medium|large|small|whole|half|to taste|chopped|diced|minced|sliced|crushed|grated|shredded|fresh|dried|frozen|peeled|deveined|boneless|skinless|room temperature|softened|melted|divided)\b/i;
const BULLET_RE = /^[-Ã¢â‚¬Â¢*Ã¢â€“ÂªÃ¢â€“Â¸Ã¢â€“ÂºÃ¢â€”Â¦Ã¢â‚¬Â£Ã¢ÂÆ’Ã¢Å“â€œÃ¢Å“â€Ã°Å¸â€Â¸Ã°Å¸â€Â¹Ã¢â€”Â½Ã¢â€”Â¾Ã¢â€“Â«Ã¢â€“ÂªÃ¯Â¸ÂÃ°Å¸Â¥â€žÃ°Å¸Â¥â€¢Ã°Å¸Â§â€¦Ã°Å¸Â§â€žÃ°Å¸ÂÂ³Ã°Å¸Â¥Å¡Ã°Å¸Â§Ë†Ã°Å¸Â¥â€ºÃ°Å¸Ââ€”Ã°Å¸Â¥Â©Ã°Å¸Â§â‚¬Ã°Å¸Ââ€¦Ã°Å¸Â«â€™Ã°Å¸Å’Â¿Ã°Å¸Â«â€˜Ã°Å¸Â¥Â¦Ã°Å¸Ââ€¹]\s*/;
const FRACTION_RE = /^[Ã‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾\d]/;
const NUM_UNIT_RE = /^[\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾][\d./\s]*\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?)/i;
const STEP_NUM_RE = /^\d+[.):\s-]/;
// CB-02: Added 'm' flag so '^' matches start of each line in multiline captions,
// fixing false negatives on recipes where the first cooking verb is not the first word
// of the entire caption (e.g. "Basil, garlic\nBlend until smooth").
const COOKING_VERBS_RE = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eÃƒÂ©]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|stir-fry|deep.fry|pan.fry|air.fry)\b/im;
// Spoken/informal direction starters (YouTube Shorts, TikTok narration style)
const SPOKEN_DIRECTION_RE = /^(you'?re? (?:gonna|going to)|go ahead and|now (?:we|you|I)|what (?:we|you|I) (?:do|did)|take (?:your|the|some)|grab (?:your|the|some)|throw (?:it|that|the|some) in|pop (?:it|that|the) in|toss (?:it|that|the) in|once (?:it|that|the|your)|when (?:it|that|the|your)|after (?:it|that|the|your|about)|make sure|be sure to|don'?t forget to|carefully|gently|slowly|quickly|keep (?:stirring|mixing|cooking)|continue|allow|until|while)\b/i;

// Common food words that indicate an ingredient line even without a unit
const FOOD_RE = /\b(chicken|beef|pork|salmon|shrimp|tofu|rice|pasta|noodles|bread|flour|sugar|butter|oil|olive oil|vegetable oil|canola oil|sesame oil|coconut oil|garlic|onion|onions|shallot|shallots|tomato|tomatoes|pepper|peppers|salt|cheese|cream|milk|eggs?|lemon|lime|vinegar|soy sauce|honey|ginger|cilantro|parsley|basil|oregano|cumin|paprika|cinnamon|avocado|potato|potatoes|broccoli|spinach|mushrooms?|carrots?|celery|corn|beans?|chickpeas?|lentils?|coconut|vanilla|chocolate|bacon|sausage|ham|turkey|lettuce|cucumber|zucchini|bell pepper|jalape[nÃƒÂ±]o|mayo|mayonnaise|mustard|ketchup|sriracha|sesame|peanut|almond|walnut|cashew|oats?|yogurt|sour cream|cream cheese|mozzarella|parmesan|cheddar|feta|ricotta|tortilla|pita|naan|wonton|dumpling|vodka|whiskey|bourbon|rum|tequila|gin|scotch|vermouth|bitters|angostura|triple sec|cointreau|campari|kahlua|amaretto|ginger beer|tonic|soda water|club soda|cranberry juice|orange juice|lime juice|lemon juice|simple syrup|grenadine|baking soda|baking powder|cornstarch|cream of tartar|yeast|heavy cream|half.and.half|buttermilk|sweetened condensed milk|evaporated milk|cocoa powder|brown sugar|powdered sugar|confectioners|maple syrup|molasses|worcestershire|fish sauce|oyster sauce|hoisin|tahini|miso|sambal|harissa|chili flakes?|red pepper flakes?|cayenne|nutmeg|turmeric|cardamom|cloves?|allspice|thyme|rosemary|sage|dill|chives?|scallions?|green onions?|leeks?|capers|olives|artichoke|eggplant|squash|pumpkin|sweet potato|yam|beet|radish|cabbage|kale|arugula|watercress)\b/i;

function looksLikeIngredient(line) {
  if (BULLET_RE.test(line)) return true;
  if (NUM_UNIT_RE.test(line)) return true;
  if (line.length < 100 && UNITS_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 80 && UNITS_RE.test(line)) return true;
  // Short lines with food words are likely ingredients
  if (line.length < 60 && FOOD_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 40 && FOOD_RE.test(line)) return true;
  // "X for garnish" / "X to taste" / "X (optional)" patterns
  if (line.length < 60 && /\b(for garnish|to taste|optional|as needed|to rim|for serving)\b/i.test(line)) return true;
  return false;
}

function looksLikeDirection(line) {
  if (STEP_NUM_RE.test(line)) return true;
  if (COOKING_VERBS_RE.test(line)) return true;
  if (SPOKEN_DIRECTION_RE.test(line)) return true;
  // Sentences containing time/temperature are usually directions
  if (/\b(\d+\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))\b/i.test(line) && line.length > 25) return true;
  if (/\b(\d+\s*(?:degrees?|Ã‚Â°)\s*[FCfc]?)\b/i.test(line) && line.length > 25) return true;
  return false;
}

const INGREDIENTS_HEADERS = [
  'ingredients', 'you will need', "you'll need", 'what you need',
  "what you'll need", 'shopping list', 'what you\'ll need',
  'for the', 'for this recipe', 'recipe ingredients',
  // Instagram-style informal headers
  'what u need', 'what you\'ll need', 'grab these', 'grocery list',
  'heres what you need', "here's what you need", 'recipe below',
  'whats in it', "what's in it", 'you need',
];
const DIRECTIONS_HEADERS = [
  'directions', 'instructions', 'method', 'steps', 'preparation',
  'how to make', 'how to prepare', 'to make', 'to prepare',
  'the process', 'process', 'let\'s make', "let's make",
  'how to cook', 'cooking instructions', 'recipe instructions',
  'procedure', 'directions:', 'instructions:',
  // Instagram-style informal headers
  'how i made it', 'how i make it', 'heres how', "here's how",
  'the recipe', 'recipe', 'how to',
];

function isIngredientsHeader(lower) {
  // Strip emoji and common Instagram punctuation for matching
  const cleaned = lower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}Ã°Å¸â€˜â€¡Ã¢Â¬â€¡Ã¯Â¸ÂÃ¢â€ â€œÃ°Å¸â€œÂÃ¢Å“Â¨Ã°Å¸â€™Â«Ã°Å¸ÂÂ½Ã¯Â¸ÂÃ°Å¸Â¥ËœÃ°Å¸ÂÂ²]/gu, '').trim();
  return INGREDIENTS_HEADERS.some(h => cleaned === h || cleaned.startsWith(h + ':') || cleaned.startsWith(h + ' -') || lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}
function isDirectionsHeader(lower) {
  const cleaned = lower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}Ã°Å¸â€˜â€¡Ã¢Â¬â€¡Ã¯Â¸ÂÃ¢â€ â€œÃ°Å¸â€œÂÃ¢Å“Â¨Ã°Å¸â€™Â«Ã°Å¸ÂÂ½Ã¯Â¸ÂÃ°Å¸Â¥ËœÃ°Å¸ÂÂ²]/gu, '').trim();
  return DIRECTIONS_HEADERS.some(h => cleaned === h || cleaned.startsWith(h + ':') || cleaned.startsWith(h + ' -') || lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ReciME-style aggressive social caption cleaner Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Strips hashtags, @mentions, engagement bait, timestamps, sponsor phrases,
// and platform UI chrome before feeding text to Gemini.
export function cleanSocialCaption(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;

  // 1. Strip trailing hashtag blocks (3+ hashtags at end of post)
  t = t.replace(/(\n\s*)(#[\w.]+\s*){3,}[\s\S]*$/m, '');

  // 2. Strip engagement bait whole lines
  const BAIT_LINES = [
    /^(save|bookmark|share|pin|tag|repost|retweet|like|follow|subscribe|hit the bell|turn on notifications|comment below|double tap|tap the heart|let me know in the comments?).{0,80}$/im,
    /^(link in bio|full recipe in bio|recipe (is |in |below|at)|check (my )?bio|bio link|swipe up).{0,80}$/im,
    /^(#?ad\b|advertisement|sponsored|collab|partnership|gifted|#sponsored|#partner|#collab).{0,80}$/im,
    /^(use code|discount code|promo code|coupon|affiliate|shop now|buy now|purchase).{0,80}$/im,
    /^(follow (?:me|us|@\w+)?|follow for more|more recipes on|find me on|join me on|new video|new post).{0,80}$/im,
    /^(music:|song:|audio:|outfit:|shop my|wearing:|featuring:|soundtrack:|ft\.|prod\. by).{0,80}$/im,
    /^[Ã°Å¸â€â€”Ã°Å¸â€˜â€¡Ã¢Â¬â€¡Ã¯Â¸ÂÃ°Å¸â€œÂ²Ã°Å¸â€™Å’Ã°Å¸â€œÂ©Ã°Å¸â€â€Ã°Å¸â€œÅ’Ã°Å¸ÂÂ·Ã¯Â¸Â].{0,80}$/m,
    // Inline discount codes anywhere in line (e.g. "Want more? Use code AUGUST to save 10%")
    /^.{0,120}(?:use code|enter code|promo code)\s+[A-Z0-9]{2,15}.{0,120}$/im,
    // Lines pushing ebooks / courses / meal plans / newsletters
    /^.{0,80}(?:ebook|cookbook|meal plan|meal prep guide|course|masterclass|newsletter|podcast|youtube channel).{0,80}(?:save|off|free|link|grab|get|download|sign up|subscribe).{0,80}$/im,
    // "Want more X recipes?" standalone promo hooks
    /^want more.{0,60}\?.*$/im,
    // Lines with "get X% off" / "save X% off"
    /^.{0,80}(?:save|get|take)\s+\d+%\s+(?:off|on).{0,80}$/im,
  ];
  for (const re of BAIT_LINES) t = t.replace(new RegExp(re.source, re.flags + 'g'), '');

  // 3. Strip "See more" / "Ã¢â‚¬Â¦ more" truncation artifacts
  t = t.replace(/\.{3,}\s*(more|see more|read more)\s*$/im, '');
  t = t.replace(/\s*[Ã¢â‚¬Â¦]\s*(more|see more)?\s*$/im, '');

  // 4. Strip Instagram OG engagement prefix (e.g. "13K likes, 213 comments - user on Jan 1, 2025: ")
  t = t.replace(/^[\d,.]+[kKmM]?\s*likes?,\s*[\d,.]+[kKmM]?\s*comments?\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€]\s*\S+\s+on\s+[^:]+:\s*[""]?/im, '');
  t = t.replace(/^[\d,.]+[kKmM]?\s*(likes?|comments?|views?|shares?|saves?)\s*[,Ã‚Â·Ã¢â‚¬Â¢|]+\s*/im, '');

  // 5. Strip video timestamps (e.g. "2:30 - Add the garlic")
  t = t.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€:]\s*/gm, '');
  t = t.replace(/\bat\s+\d{1,2}:\d{2}(?::\d{2})?\s*/gi, '');

  // 6. Strip inline @mentions (keep rest of line)
  t = t.replace(/@[\w.]+/g, '');

  // 7. Strip inline #hashtags (keep rest of line so recipe text survives)
  t = t.replace(/#[\w.]+/g, '');

  // 8. Strip bare URLs
  t = t.replace(/https?:\/\/\S+/g, '');

  // 9. Strip Instagram/TikTok UI chrome that leaks into scraped text
  t = t.replace(/^(verified|view profile|follow|following|message|share profile|send message)\s*$/gim, '');
  t = t.replace(/verified\s*[Ã‚Â·Ã¢â‚¬Â¢]\s*(view\s+profile|follow)/gi, '');
  t = t.replace(/^\d+[\s,]*(likes?|followers?|following|comments?|views?|saves?)\s*$/gim, '');

  // 10. Strip soft CTA lines ("watch the full video", "see recipe below", etc.)
  // Ã¢Å¡Â Ã¯Â¸Â  Be surgical: only strip if the line is CLEARLY a CTA, not cooking narration.
  //     "watch the garlic", "see how it thickens" should survive.
  //     Match only when the line starts with a CTA trigger AND ends with a CTA-shaped phrase.
  t = t.replace(/^(watch the full (video|reel|recipe)|see (the )?(full |original )?recipe|check (out )?(the )?(full |my )?recipe|full recipe (is |in |at |below|on)|recipe (is |in |at |below|available)|swipe (up|left|right) for|tap (the )?(link|here)|link in bio for).{0,80}$/gim, '');

  // 11. Normalize whitespace
  // Instagram embed captions often encode original newlines as 3+ spaces (because
  // the embed HTML strips <br> tags to spaces during extraction). Convert them to
  // real newlines first so parseCaption can split sections correctly.
  t = t.replace(/[ \t]{3,}/g, '\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/^[\s,;|Ã‚Â·Ã¢â‚¬Â¢Ã¢â‚¬â€œÃ¢â‚¬â€]+$/gm, '');

  return t.trim();
}


/**
 * cleanLine — normalize a single ingredient or direction string.
 * Port of Mealie's "recursive clean until stable" pattern.
 * Strips HTML entities, residual tags, non-breaking spaces, and excess whitespace.
 * Safe to call on already-clean strings. Max 5 iterations.
 */
export function cleanLine(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&hellip;': '…',
    '&mdash;': '—', '&ndash;': '–', '&lsquo;': '‘', '&rsquo;': '’',
    '&ldquo;': '“', '&rdquo;': '”', '&frac12;': '½',
    '&frac14;': '¼', '&frac34;': '¾',
  };
  let s = raw.replace(/&[a-zA-Z0-9#]+;/g, m => HTML_ENTITIES[m] || m);
  let prev;
  let iter = 0;
  do {
    prev = s;
    s = s
      .replace(/<[^>]+>/g, '')        // strip residual HTML tags
      .replace(/ /g, ' ')         // non-breaking space → space
      .replace(/​/g, '')          // zero-width space
      .replace(/	/g, ' ')             // tab → space
      .replace(/[ ]{2,}/g, ' ')        // collapse multi-space
      .replace(/^[\s]+|[\s]+$/g, ''); // trim
  } while (s !== prev && ++iter < 5);
  return s;
}

function isSocialCaptionProse(line) {
  const value = String(line || '').trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (/[?]/.test(value)) return true;
  if (/^(would you|will you|do you|did you|can you|could you|try this|save this|share this|tag |comment |follow |like |bright,|fresh,|sweet,|bitter,)/i.test(value)) return true;
  if (/\b(would you try|try this one|save for later|let me know|follow for more|link in bio)\b/i.test(value)) return true;
  const hasQuantity = /\b\d+\s*(?:g|kg|ml|l|oz|cup|cups|tbsp|tsp|tablespoons?|teaspoons?|small|large|medium|head|clove|cloves|bunch|pinch|dash|handful)\b/i.test(value);
  const hasAction = COOKING_VERBS_RE.test(value) || SPOKEN_DIRECTION_RE.test(value);
  const sentenceLike = value.length > 35 && /[,.;!]/.test(value);
  if (sentenceLike && !hasQuantity && !hasAction) return true;
  if (lower.split(/\s+/).length > 10 && !hasQuantity && !hasAction) return true;
  return false;
}

function cleanStructuredSocialRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return recipe;
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.filter((line) => !isSocialCaptionProse(line))
    : [];
  const directions = Array.isArray(recipe.directions)
    ? recipe.directions.filter((line) => !/^(would you|save this|follow|link in bio)/i.test(String(line || '').trim()))
    : [];
  return { ...recipe, ingredients, directions };
}

/**
 * isCaptionWeak Ã¢â‚¬â€ returns true if the caption is too thin to contain a full
 * recipe on its own. Triggers yt-dlp subtitle / AI fallback in BrowserAssist.
 *
 * CB-01: Signal detection now runs BEFORE length checks so that short but
 *        valid recipes (TikTok cards, metric-only captions) are not rejected.
 * CB-03: Compact metric notation (250g, 200ml, 1.5kg) detected separately since
 *        UNITS_RE requires a word boundary before 'g'/'ml' that breaks on "250g".
 */
export function isCaptionWeak(text) {
  // Raw junk check Ã¢â‚¬â€ raw (uncleaned) text below 20 chars is never a recipe
  if (!text || text.trim().length < 20) return true;
  const cleaned = cleanSocialCaption(text);

  // CB-03: Compact metric units (e.g. "250g", "200ml", "1.5kg", "180Ã‚Â°C")
  // UNITS_RE misses these because \b requires a word boundary BEFORE 'g'/'ml',
  // but a digit is a word char, so "250g" has no boundary between '0' and 'g'.
  const hasMetricUnit = /\d+\s*(?:g|ml|kg|cl|dl|l|Ã‚Â°[CF])\b/i.test(cleaned);

  // CB-01: Detect recipe signals BEFORE applying length penalties
  const hasIngredientSignal = hasMetricUnit || UNITS_RE.test(cleaned) || FOOD_RE.test(cleaned);
  const hasDirectionSignal = COOKING_VERBS_RE.test(cleaned) || SPOKEN_DIRECTION_RE.test(cleaned);

  // Tier 1 (revised): Junk only if both short AND signal-free
  // Old behaviour rejected all cleaned < 50 Ã¢â‚¬â€ too aggressive for "2 cups flour\nMix and fry"
  if (cleaned.length < 50 && !hasIngredientSignal && !hasDirectionSignal) return true;

  // Tier 2: Strong Ã¢â‚¬â€ both ingredient AND direction signals Ã¢â€ â€™ always good
  if (hasIngredientSignal && hasDirectionSignal) return false;

  // Tier 3 (lowered 80Ã¢â€ â€™60): One signal + sufficient length Ã¢â€ â€™ accept
  // 60 chars covers TikTok ingredient cards and terse metric recipes
  if ((hasIngredientSignal || hasDirectionSignal) && cleaned.length >= 60) return false;

  // Tier 4 (new): Ingredient-only captions at Ã¢â€°Â¥ 40 chars Ã¢â€ â€™ accept
  // Common pattern: creator lists ingredients in caption, shows technique in video
  if (hasIngredientSignal && cleaned.length >= 40) return false;

  // No usable recipe signal Ã¢â€ â€™ definitely weak
  if (!hasIngredientSignal && !hasDirectionSignal) return true;

  return false;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Caption Parser wrapper (used by BrowserImport) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export function parseManualCaption(captionText, sourceUrl) {
  const parsed = parseCaption(captionText);
  return {
    name: parsed.title || 'Imported Recipe',
    ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
    directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
    imageUrl: '',
    link: sourceUrl || '',
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Client-side Google AI (Gemini) Ã¢â‚¬â€ direct browser call Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Uses VITE_GOOGLE_AI_KEY if set. Runs in the browser without a backend hop,
// giving faster results and working even when the backend server is cold/offline.
// The API key is bundled into the client build Ã¢â‚¬â€ acceptable for personal/family apps.
/**
 * Build the Gemini system prompt. Meal vs drink prompts differ materially:
 * cocktails use oz/dash/splash/float units and often have terse directions,
 * while meal recipes tend toward cups/tbsp and step-by-step instructions.
 * Keeping both prompts local (rather than a remote config) makes the engine
 * fully offline-capable for prompt changes.
 */
function _buildExtractionPrompt(rawText, { hintTitle = '', type = 'meal' } = {}) {
  // Auto-upgrade to drink schema when text has strong cocktail signals.
  if (type !== 'drink') {
    const lower = rawText.toLowerCase();
    const SPIRITS = [
      'whiskey','whisky','bourbon','scotch','rye whiskey',' gin ','rum ','tequila',
      'mezcal','vodka','cognac','brandy','vermouth','campari','aperol','amaretto','kahlua',
      'baileys','triple sec','cointreau','amaro','bitters','angostura','absinthe','chartreuse',
      'prosecco','champagne','cava','pisco','sake','soju','grappa','limoncello','curaçao',
      'maraschino','falernum','orgeat','elderflower liqueur','st. germain','fernet','grand marnier',
      'benedictine','drambuie','frangelico','lillet','suze','cynar','galliano','midori',
      'blue curaçao','sloe gin','raspberry liqueur','peach schnapps','spiced rum','dark rum',
      'light rum','aged rum','blanco tequila','reposado','añejo','london dry gin','new western gin',
      'islay scotch','speyside','irish whiskey','japanese whisky','rye bourbon',
    ];
    const COCKTAIL_ACTIONS = [
      ' shake',' shaker','stir and strain','muddle','strain into','double strain',
      'build in glass','top with ','float the ','garnish with','express the peel',
      'rimmed glass','jigger','bar spoon','barspoon','cocktail glass','coupe glass',
      'rocks glass','highball glass','nick and nora','mixing glass','hawthorne strain',
      'fine strain','throw the cocktail','dry shake','reverse dry shake',
      'fat wash','infuse','batch cocktail','on the rocks','neat','straight up',
      'ice sphere','large cube','cracked ice','cobbler','julep cup','tiki mug',
    ];
    const UNIT_SIGNALS = [
      ' oz ',' oz,','.5 oz','ml ','1 dash','2 dash','splash of','rinse with',
      '0.5 oz','0.75 oz','1.5 oz','2 oz','3 oz',' cl ',' part ','barspoon of',
      '1/2 oz','3/4 oz','1/4 oz','2 parts','1 part','float of',
    ];
    const spiritHits = SPIRITS.filter(w => lower.includes(w)).length;
    const verbHits   = COCKTAIL_ACTIONS.filter(w => lower.includes(w)).length;
    const unitHits   = UNIT_SIGNALS.filter(w => lower.includes(w)).length;
    if ((spiritHits >= 1 && (verbHits + unitHits) >= 1) || (spiritHits + verbHits + unitHits) >= 3) {
      type = 'drink';
    }
  }

  const isDrink = type === 'drink';
  const subjectNoun = isDrink ? 'cocktail/drink' : 'recipe';

  // ── JSON schema ─────────────────────────────────────────────────────────────
  const schema = isDrink
    ? `{
  "title": "string — concise drink name only (2–5 words), no hashtags, emojis, or brand names unless the drink is specifically named",
  "ingredients": [{ "name": "string — spirit/mixer/modifier/garnish name", "amount": "string — e.g. '2 oz', '0.75 oz', '1 dash', '3 slices', 'splash', 'float'" }],
  "directions": ["string — one terse action step per item, verb-first (e.g. 'Combine all ingredients in shaker with ice', 'Shake vigorously for 12 seconds', 'Double-strain into chilled coupe')"],
  "glass": "string or null — specific glass name, e.g. 'coupe', 'rocks/old fashioned', 'highball', 'martini', 'collins', 'nick & nora', 'champagne flute', 'copper mug', 'tiki mug', 'julep cup'",
  "garnish": "string or null — precise garnish description, e.g. 'expressed lemon peel', 'dehydrated lime wheel', 'fresh mint sprig', 'Luxardo cherry', 'salted rim', 'smoked rosemary'",
  "method": "string or null — preparation method: 'shaken', 'stirred', 'built', 'blended', 'thrown', 'dry shaken', 'rolled'",
  "servings": "string or null — usually '1 cocktail' or '1 serving'",
  "notes": "string or null — flavor notes, variations, substitutions, or bartender tips"
}`
    : `{
  "title": "string — concise recipe name (2–6 words), no hashtags, emojis, or brand names",
  "ingredients": [{ "name": "string — ingredient name with prep note if given (e.g. 'chicken thighs, boneless', 'garlic cloves, minced')", "amount": "string — quantity + unit (e.g. '2 cups', '1 lb', '3 tbsp', 'to taste', 'pinch')" }],
  "directions": ["string — one clear cooking step per item, written as an imperative instruction (verb-first). Each step should be a complete action."],
  "servings": "string or null — e.g. '4 servings', 'makes 12 cookies', 'serves 6–8'",
  "prepTime": "string or null — prep time if stated, e.g. '15 minutes'",
  "cookTime": "string or null — cook/bake/rest time if stated, e.g. '30 minutes', '1 hour'",
  "totalTime": "string or null — total time if stated, e.g. '45 minutes'",
  "cuisine": "string or null — cuisine type if determinable, e.g. 'Italian', 'Mexican', 'Thai', 'American BBQ'",
  "dietaryTags": ["string — only include if clearly stated: 'vegan', 'vegetarian', 'gluten-free', 'dairy-free', 'keto', 'paleo', 'nut-free'"],
  "notes": "string or null — chef tips, make-ahead notes, storage info, substitution suggestions"
}`;

  // ── Shared rules ─────────────────────────────────────────────────────────────
  const rulesCommon = `TITLE EXTRACTION:
- Extract the ${subjectNoun} name ONLY (2–6 words max). Remove: "@username", "on Instagram", "by [name]", hashtags (#), emojis, brand sponsors.
- Prefer an explicit title found in the text. If none, infer from the main dish/drink being described.
- Do NOT include serving context like "for 4" or "easy weeknight" in the title itself.

SOCIAL CHROME CLEANING (strip all of these before parsing):
- Hashtags: #anythingLikeThis, entire hashtag blocks at the end
- @Mentions and handles: @username, @brand
- CTAs: "save this", "follow for more", "link in bio", "shop link", "use code X", "DM me", "click link"
- Engagement bait: "comment your fave", "tag a friend", "like if you agree", "drop a below"
- Sponsor disclosures: "ad", "#ad", "#sponsored", "partnered with", "gifted by", "collab with"
- Timestamps/view counts: "3d ago", "12k likes", "2.1M views"
- Outro lines: "Hope you enjoy!", "Let me know what you think!", "Happy cooking!"
- Ebook/course promos: "grab my ebook", "join my course", "full recipe on my website"
- Recipe blog boilerplate: "Jump to Recipe", "Pin this for later", "Print Recipe"

VIDEO TRANSCRIPT HANDLING:
- If the text is narrated/spoken (video captions/subtitles), it will sound conversational: "okay so first you're gonna want to...", "what I like to do is...", "you need about..."
- Extract the RECIPE being described, not the narration style. Convert narrated quantities to normal format.
- Spoken fractional amounts: "half a cup" → "1/2 cup", "a tablespoon" → "1 tbsp", "some" → omit or "to taste"

STRICT INGREDIENT vs DIRECTION SORTING (CRITICAL — verify each line before assigning):
- INGREDIENT pattern: [quantity] [unit?] [food noun] [prep note?]
  Examples: "2 cups all-purpose flour", "1 lemon, juiced", "salt and pepper to taste", "1.5 oz Aperol"
- DIRECTION pattern: starts with or contains an imperative action verb
  Examples: "Preheat oven to 400°F", "Toss vegetables with olive oil", "Shake with ice for 15 seconds"
- Numbered lines (1. 2. 3.) are ALWAYS directions if they describe actions
- Section headers like "For the sauce:", "Spice mix:", "Marinade:" — extract the items BELOW as ingredients, add a note like "(for the sauce)" in their name field
- NEVER cross-contaminate: ingredients[] must contain only food items with amounts; directions[] must contain only action steps
- If a line is ambiguous (e.g. "2 eggs, beaten"), it goes to ingredients (has quantity + food noun)

COMPLETENESS:
- Extract ALL ingredients listed. Do not skip minor items (spices, oils, garnishes).
- Extract ALL steps in order. Do not summarize multiple steps into one.
- For multi-section recipes (e.g. sauce + protein + assembly), use parenthetical notes in ingredient names: "tomatoes, diced (for sauce)".`;

  // ── Drink-specific rules ─────────────────────────────────────────────────────
  const rulesDrink = `
COCKTAIL-SPECIFIC RULES:
MEASUREMENTS: Recognize all mixology units — oz, ml, cl, dash, splash, barspoon, part, drop, float, rinse. Normalize written forms: "half ounce" → "0.5 oz", "a jigger" → "1.5 oz".
INGREDIENTS to capture:
  - Base spirits with full name (keep brand if specified, e.g. "Rittenhouse Rye Whiskey")
  - Liqueurs and modifiers with amounts ("0.5 oz Cointreau", "2 dashes Angostura bitters")
  - Fresh juices ("0.75 oz fresh lemon juice" — note "fresh" if stated)
  - Syrups: include ratio if given ("2:1 simple syrup")
  - Garnishes in the ingredients list: "1 lemon peel, for garnish"
  - Rinse/wash: "absinthe (for rinse)" with amount "rinse"
DIRECTIONS: Cocktail directions are typically brief (3-6 steps):
  - "Combine [ingredients] in shaker with ice"
  - "Shake [hard/vigorously] for [time]" or "Stir for [rotations/time]"
  - "Strain/Double-strain into [glass]"
  - "Top with [soda/sparkling wine]" / "Float [ingredient] on top"
  - "Garnish with [garnish item]"
  Do NOT pad with extra steps. Brevity = correct for cocktails.
METHOD detection: infer from verbs — "shake/shaker" → "shaken"; "stir/mixing glass" → "stirred"; "build/pour directly" → "built"; "blend/blender" → "blended"; "dry shake" → "dry shaken".
GLASS/GARNISH: Extract into their dedicated fields. Garnish field should be the item, not the action ("lime wheel" not "garnish with a lime wheel").`;

  // ── Meal-specific rules ──────────────────────────────────────────────────────
  const rulesMeal = `
MEAL-SPECIFIC RULES:
INGREDIENT FORMATTING:
  - Always include the amount field. Use "to taste" for seasonings or "as needed" for variable items.
  - Normalize fractions: ½ → "1/2", ¾ → "3/4", ¼ → "1/4"
  - Include prep notes in the name: "onion, finely diced"
  - Canned/packaged: "1 can (15 oz) chickpeas, drained and rinsed" — keep the parenthetical size note
DIRECTION QUALITY:
  - Each step = ONE action. Split compound steps at ". Then" / ". Next" / sentence breaks.
  - Include temperatures, timing, and doneness cues ("until golden brown", "internal temp 165°F")
  - Keep steps in strict chronological order; preheat oven step should always be first if oven is used.
MULTI-SECTION RECIPES (Sauce, Marinade, Spice Rub, Topping, Filling, Dough, etc.):
  - Include ALL section ingredients with parenthetical labels: "garlic cloves, minced (for marinade)"
TIME FIELDS: Extract prepTime, cookTime, totalTime whenever mentioned.
DIETARY TAGS: Only include tags that are EXPLICITLY stated in the source text. Do not infer.`;

  return `You are an expert recipe extraction AI. Your job is to extract a clean, precise, structured ${subjectNoun} from social media content (Instagram caption, TikTok description, YouTube transcript, or recipe blog text).

Return ONLY valid JSON matching this exact schema — no markdown fences, no explanation text, no preamble:
${schema}

=== EXTRACTION RULES ===
${rulesCommon}
${isDrink ? rulesDrink : rulesMeal}

=== QUALITY CHECK (apply before returning) ===
STEP 1 — Audit ingredients[]:
- Scan every entry. If it starts with a cooking verb (Mix, Combine, Preheat, Add, Cook, Bake, Stir, Pour, Heat, Fold, Whisk, Blend, Season, Serve, Place, Remove, Transfer, Bring, Let, Cover, Simmer, Boil, Drain, Rinse, Prepare, Sprinkle, Drizzle, Toss, Marinate, Melt, Beat, Knead, Roll, Broil, Brush, Sear, Steam) — MOVE IT to directions[].
- Concrete violation: ingredients: ["Preheat oven to 400°F"] → WRONG. Move to directions.
- Concrete violation: ingredients: ["1. Mix flour and butter"] → WRONG. Move to directions (strip the number).
STEP 2 — Audit directions[]:
- Scan every entry. If it is purely a food quantity + item with no action verb — MOVE IT to ingredients[].
- Concrete violation: directions: ["2 cups all-purpose flour"] → WRONG. Move to ingredients.
- Concrete violation: directions: ["1 lemon, juiced"] → WRONG. Move to ingredients.
STEP 3 — Title check:
- Remove all hashtags (#word), @handles, emojis, and trailing punctuation from the title.
- Title must be 2–6 words only.
STEP 4 — Section sub-headers:
- Lines like "For the sauce:", "Marinade:", "Spice rub:" are NOT ingredients. Either skip them or add them as parenthetical labels on the ingredients below (e.g., "tomatoes, diced (for sauce)").
STEP 5 — Drinks only:
- Confirm glass, method, and garnish fields are populated if determinable from the text.
STEP 6 — Empty result:
- If no recipe or drink can be identified at all, return: { "error": "not a recipe" }
${hintTitle ? `\n=== NAME HINT ===\nThe ${subjectNoun} is likely called: "${hintTitle}" — use this if no better title is found in the text.` : ''}

=== TEXT TO PARSE ===
---
${rawText.slice(0, 8000)}
---`;
}




/**
 * structureRecipeFromImage â€” uses Gemini 1.5 Flash multimodal vision to
 * extract a structured recipe directly from an image (photo, screenshot, etc.).
 *
 * @param {string} imageDataUrl - Base64 data URL of the image
 * @param {object} options - { type: 'meal' | 'drink' }
 * @returns {object|null} Structured recipe or null
 */
// ─── Phase 3: vision-transcribe an image to plain recipe text ────────────────
// Instead of asking Gemini Vision to both READ and STRUCTURE in one shot (the
// old weak path), we first transcribe the image to faithful plain text, then
// feed that text through the SAME captionToRecipe pipeline used for social
// captions. This means OCR output gets the full shared SYSTEM_INSTRUCTION,
// quantity/unit canonicalization, and cross-contamination validation — closing
// the gap that made photo imports noticeably worse than URL imports.
async function transcribeImageToText(imageDataUrl, { type = 'meal', signal } = {}) {
  const clientKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null;
  if (!clientKey || !imageDataUrl) return '';
  const base64Data = imageDataUrl.split(',')[1];
  if (!base64Data) return '';
  const mimeMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = (mimeMatch?.[1] || 'image/jpeg').replace('image/jpg', 'image/jpeg');
  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${clientKey}`;

  const isDrink = type === 'drink';
  const prompt = `Transcribe this ${isDrink ? 'cocktail/drink' : 'food'} recipe image into plain text, exactly as written.
- Output ONLY the transcribed text — no commentary, no JSON, no markdown fences.
- Preserve line breaks: put each ingredient on its own line and each step on its own line.
- Keep section headers (e.g. "Ingredients", "For the sauce", "Directions") on their own lines.
- Transcribe quantities and units precisely (e.g. "2 1/4 cups", "1.5 oz", "1 tbsp").
- If the image is a finished dish/drink photo with NO readable recipe text, output exactly: NO_TEXT`;

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
      signal: composeSignals(signal, AbortSignal.timeout(25000)),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (/^NO_TEXT\b/i.test(text)) return '';
    return text;
  } catch {
    return '';
  }
}

/**
 * Phase 3 public entry: transcribe → captionToRecipe, with the legacy one-shot
 * vision structuring kept as a fallback for text-free dish/drink photos.
 * Returns a recipe object, or { _error:true, reason:'photo_unreadable' } when
 * nothing usable can be extracted (the shape ImportModal renders against).
 */
export async function structureRecipeFromImage(imageDataUrl, { type = 'meal', hintTitle = '', signal } = {}) {
  const clientKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null;
  if (!clientKey || !imageDataUrl) return { _error: true, reason: 'photo_unreadable' };
  if (isAborted(signal)) return { _error: true, reason: 'aborted' };

  // 1. Transcribe the image, then run the shared caption pipeline.
  const transcript = await transcribeImageToText(imageDataUrl, { type, signal });
  if (transcript && transcript.length >= 20) {
    const fromCaption = await captionToRecipe(transcript, {
      title: hintTitle,
      imageUrl: imageDataUrl,
      type,
      signal,
    });
    if (fromCaption && (fromCaption.ingredients?.length || fromCaption.directions?.length)) {
      return { ...fromCaption, _structuredVia: 'vision-transcribe', _imageAnalysis: 'transcribed from photo' };
    }
  }

  if (isAborted(signal)) return { _error: true, reason: 'aborted' };

  // 2. Fallback: legacy one-shot vision structuring (handles text-free photos by
  //    inferring a recipe from the visible dish/drink).
  const inferred = await _structureImageViaVision(imageDataUrl, { type, hintTitle, signal });
  if (inferred && (inferred.ingredients?.length || inferred.directions?.length)) {
    return inferred;
  }

  // 3. Nothing usable — let the UI show an inviting "couldn't read it" state.
  return { _error: true, reason: 'photo_unreadable' };
}

async function _structureImageViaVision(imageDataUrl, { type = 'meal', hintTitle = '', signal } = {}) {
  const clientKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null;
  if (!clientKey || !imageDataUrl) return null;

  const base64Data = imageDataUrl.split(',')[1];
  if (!base64Data) return null;

  // Detect MIME type from data URL header
  const mimeMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = (mimeMatch?.[1] || 'image/jpeg').replace('image/jpg', 'image/jpeg');

  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${clientKey}`;

  const isDrink = type === 'drink';

  // ── Build image type analysis prefix ────────────────────────────────────────
  // Gemini Vision performs better when we tell it what kind of image to expect.
  const imageTypeHint = isDrink
    ? `This image likely shows a cocktail, drink, or bar recipe. Look for:
- Recipe card / menu text with spirit names, measurements (oz, ml, dash), and mixing instructions
- A finished cocktail in a glass — identify the glass type, garnish, color, and likely spirits used
- A bar setup with bottles — identify the visible spirits/mixers and infer a recipe if instructions are present
- Handwritten or printed cocktail recipe cards`
    : `This image likely shows a food dish or recipe. Look for:
- Recipe card / cookbook page with ingredient lists and numbered cooking steps
- A plated dish — identify the dish and list likely main ingredients
- Handwritten recipe notes — transcribe accurately even if hard to read
- Screenshot of a recipe from a website or app`;

  const prompt = `You are an expert recipe extraction AI with computer vision capabilities. Analyze this image and extract the complete recipe.

${imageTypeHint}

ANALYSIS APPROACH:
1. First, identify what TYPE of image this is: (a) recipe card/text, (b) food photo, (c) handwritten recipe, (d) screenshot
2. If recipe text is visible: transcribe ALL text accurately, then structure it
3. If it's a food photo with no text: identify the dish and infer a reasonable recipe based on what's visible
4. If handwritten: OCR carefully, noting uncertain characters

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
${isDrink ? `{
  "title": "string — concise drink name (2–5 words)",
  "ingredients": [{ "name": "string — spirit/mixer/garnish name", "amount": "string — e.g. '2 oz', '0.75 oz', '1 dash', 'splash'" }],
  "directions": ["string — one terse action step, verb-first (e.g. 'Add all ingredients to shaker with ice', 'Shake for 12 seconds', 'Double-strain into coupe')"],
  "glass": "string or null — glass type (coupe, rocks, highball, martini, nick & nora, julep cup, tiki mug, etc.)",
  "garnish": "string or null — garnish description (lime wheel, expressed lemon peel, mint sprig, Luxardo cherry, etc.)",
  "method": "string or null — shaken, stirred, built, blended, thrown, dry shaken",
  "servings": "string or null",
  "notes": "string or null — flavor profile, variations, or tips",
  "imageAnalysis": "string — brief description of what was in the image (e.g. 'Recipe card showing Aperol Spritz', 'Photo of a dark cocktail in a coupe glass')"
}` : `{
  "title": "string — concise recipe name (2–6 words)",
  "ingredients": [{ "name": "string — ingredient name with prep note (e.g. 'garlic cloves, minced')", "amount": "string — quantity + unit (e.g. '2 cups', '1 lb', '3 tbsp', 'to taste')" }],
  "directions": ["string — one complete cooking step per item, verb-first and imperative"],
  "servings": "string or null",
  "cookTime": "string or null",
  "prepTime": "string or null",
  "cuisine": "string or null",
  "dietaryTags": ["string — only explicitly visible tags: vegan, vegetarian, gluten-free, dairy-free, keto, paleo"],
  "notes": "string or null",
  "imageAnalysis": "string — brief description of what was in the image (e.g. 'Printed recipe card for chocolate chip cookies', 'Photo of pasta dish')"
}`}

STRICT RULES:
- ingredients[]: ONLY food/liquid items with amounts. NO action verbs in this array.
- directions[]: ONLY action steps starting with a verb. NO ingredient lists here.
- If the image is a food photo with no visible text: infer reasonable ingredients from what you can see; note in imageAnalysis.
- If text is too small/blurry to read: extract what you can and note uncertainty in notes field.
- If no recipe can be identified at all: return { "error": "not a recipe" }
${hintTitle ? `- The recipe is likely called: "${hintTitle}"` : ''}`;

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
      signal: composeSignals(signal, AbortSignal.timeout(25000)),
    });

    if (!res.ok) {
      if (import.meta.env.DEV) console.warn('[SpiceHub] Gemini Vision HTTP error:', res.status);
      return null;
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;

    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    if (parsed.error) return null;

    // Normalize ingredients — Gemini may return strings or {name, amount} objects
    const ingredients = Array.isArray(parsed.ingredients)
      ? parsed.ingredients
          .map(ing => typeof ing === 'string' ? ing : [ing.amount, ing.name].filter(Boolean).join(' ').trim())
          .filter(Boolean)
      : [];
    const directions = Array.isArray(parsed.directions) ? parsed.directions.filter(Boolean) : [];

    return {
      name: parsed.title || hintTitle || 'Recipe from Photo',
      ingredients,
      directions,
      ...buildStructuredFields(ingredients, directions),
      servings: parsed.servings || null,
      cookTime: parsed.cookTime || null,
      prepTime: parsed.prepTime || null,
      cuisine: parsed.cuisine || null,
      dietaryTags: Array.isArray(parsed.dietaryTags) ? parsed.dietaryTags.filter(Boolean) : [],
      notes: parsed.notes || null,
      ...(isDrink
        ? { glass: parsed.glass || null, garnish: parsed.garnish || null, method: parsed.method || null, _type: 'drink' }
        : { _type: 'meal' }),
      imageUrl: imageDataUrl,
      link: '',
      _aiStructured: true,
      _structuredVia: 'gemini-vision',
      _imageAnalysis: parsed.imageAnalysis || null,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error('[SpiceHub] Gemini Vision error:', err);
    return null;
  }
}


// ─── Post-Gemini cross-contamination validator ──────────────────────────────
// Runs SpiceHub's existing heuristics (looksLikeIngredient / looksLikeDirection)
// against Gemini's output to catch every misfiled item. Gemini is reliable but
// still misclassifies ~5–15% of lines, especially from social media captions.
// This is the JS equivalent of Mealie's cleaner.py validation loop.
//
// Input/output use SpiceHub's internal schema: { ingredients: string[], directions: string[] }
// NOT Schema.org field names.
function postProcessGeminiResult(rawIngredients, rawDirs) {
  const ingredients = [];
  const directions  = [];
  const rescued     = [];

  // Pass 1: validate each Gemini ingredient — eject action steps to directions
  for (const line of rawIngredients) {
    const t = cleanLine(line);
    if (!t) continue;
    // Strip leading step numbers that Gemini sometimes puts in ingredients
    const stripped = t.replace(/^(step\s*)?\d+[.):\s-]+/i, '').trim();
    if (looksLikeDirection(stripped) && !looksLikeIngredient(stripped)) {
      // This is clearly a direction masquerading as an ingredient
      directions.push(stripped.replace(/^\d+[.):\s]+/, '').trim());
      rescued.push({ line: t, movedTo: 'directions' });
    } else {
      // Strip leading bullet chars that Gemini sometimes retains
      ingredients.push(stripped.replace(/^[-•*]\s*/, '').trim());
    }
  }

  // Pass 2: validate each Gemini direction — eject food lines to ingredients
  for (const line of rawDirs) {
    const t = cleanLine(line);
    if (!t) continue;
    // Strip leading step numbers first before testing
    const stripped = t.replace(/^\d+[.):\s]+/, '').trim();
    if ((looksLikeIngredientLine(stripped) || looksLikeIngredient(stripped)) && !looksLikeDirection(stripped)) {
      // This is an ingredient that ended up in directions[]
      ingredients.push(stripped);
      rescued.push({ line: t, movedTo: 'ingredients' });
    } else {
      // Keep as direction, but strip leading step numbers since SpiceHub numbers them
      directions.push(stripped || t);
    }
  }

  // Deduplicate both lists while preserving order
  const seenIng = new Set();
  const cleanIngredients = ingredients.filter(i => {
    if (!i || seenIng.has(i)) return false;
    seenIng.add(i);
    return true;
  });
  const seenDir = new Set();
  const cleanDirections = directions.filter(d => {
    if (!d || seenDir.has(d)) return false;
    seenDir.add(d);
    return true;
  });

  if (rescued.length > 0 && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log('🔧 postProcessGeminiResult: moved', rescued.length, 'item(s)', rescued);
  }

  return {
    ingredients: cleanIngredients,
    directions:  cleanDirections,
    _rescued:    rescued.length,
  };
}

export async function structureWithAIClient(rawText, { title: hintTitle = '', imageUrl = '', sourceUrl = '', type = 'meal', signal } = {}) {
  const clientKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null;
  if (!clientKey || !rawText || rawText.trim().length < 20) return null;
  if (isAborted(signal)) return null;

  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${clientKey}`;
  const prompt = _buildExtractionPrompt(rawText, { hintTitle, type });

  // Phase 2: shared SYSTEM_INSTRUCTION + JSON mode for reliable auto-sorting.
  // responseSchema (RECIPE_SCHEMA) is gated behind an env flag so it can be
  // verified against a live key before becoming the default — when off, Gemini
  // still returns JSON in the legacy {ingredients, directions} shape the parser
  // has always read, so there is zero regression risk.
  const useResponseSchema = typeof import.meta !== 'undefined'
    && import.meta.env?.VITE_GEMINI_RESPONSE_SCHEMA === 'true';
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    ...(useResponseSchema ? { responseSchema: RECIPE_SCHEMA } : {}),
  };

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: composeSignals(signal, AbortSignal.timeout(14000)),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    if (parsed.error || parsed.isRecipe === false) return null;

    // Support BOTH the new RECIPE_SCHEMA shape (ingredientGroups + kind + course)
    // and the legacy flat {ingredients, directions} shape. thinFromStructured
    // flattens groups (section → parenthetical suffix) and surfaces confidence,
    // course, and dishType so auto-sorting metadata flows through unchanged.
    const isStructuredShape = Array.isArray(parsed.ingredientGroups);
    const thin = isStructuredShape ? thinFromStructured(parsed) : null;

    const rawIngredients = isStructuredShape
      ? thin.ingredients
      : (Array.isArray(parsed.ingredients)
          ? parsed.ingredients.map(ing => typeof ing === 'string' ? ing : [ing.amount, ing.name].filter(Boolean).join(' ').trim()).filter(Boolean)
          : []);
    // IMPORTANT: Leave empty arrays empty — UI decides how to present thin results.
    const rawDirs = isStructuredShape
      ? thin.directions
      : (Array.isArray(parsed.directions) ? parsed.directions.filter(Boolean) : []);
    // Post-Gemini validation: run heuristics to catch ingredient/direction cross-contamination
    const { ingredients, directions: _dirs, _rescued } = postProcessGeminiResult(rawIngredients, rawDirs);

    const meta = isStructuredShape ? thin : parsed;
    return {
      ...buildStructuredFields(ingredients, _dirs),
      servings: meta.servings || null,
      cookTime: meta.cookTime || null,
      prepTime: meta.prepTime || null,
      totalTime: meta.totalTime || null,
      cuisine: meta.cuisine || null,
      course: meta.course || null,
      dishType: meta.dishType || null,
      dietaryTags: Array.isArray(meta.dietaryTags) ? meta.dietaryTags.filter(Boolean) : [],
      notes: meta.notes || null,
      // Drink-specific fields survive as extras on the result; meal flow ignores them.
      ...(type === 'drink' || meta._type === 'drink'
        ? { glass: meta.glass || null, garnish: meta.garnish || null, method: meta.method || null, _type: 'drink' }
        : { _type: 'meal' }),
      imageUrl: imageUrl || '',
      link: sourceUrl || '',
      _aiStructured: true,
      _structuredVia: isStructuredShape ? 'gemini-client-schema' : 'gemini-client',
      _confidence: typeof meta.confidence === 'number' ? meta.confidence : null,
      _needsReview: !!meta.needsReview,
      _rescued: _rescued || 0,
    };
  } catch {
    return null;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AI-powered structuring via server /api/structure-recipe (Gemini Flash) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Falls back to direct client call if VITE_GOOGLE_AI_KEY is configured.
// Returns a SpiceHub recipe object on success, null if unavailable.
export async function structureWithAI(rawText, { title: hintTitle = '', imageUrl = '', sourceUrl = '', type = 'meal', signal } = {}) {
  if (!rawText || rawText.trim().length < 20) return null;
  if (isAborted(signal)) return null;

  // Try client-side Gemini first (faster, no backend roundtrip)
  try {
    const clientResult = await structureWithAIClient(rawText, { title: hintTitle, imageUrl, sourceUrl, type, signal });
    if (clientResult && (clientResult.ingredients?.length || clientResult.directions?.length)) {
      return clientResult;
    }
  } catch { /* fall through to server */ }

  try {
    // Only try server structuring if we have a non-local server configured.
    // Check window.__SPICEHUB_SERVER__ first (runtime override), then fall back to
    // the VITE_SERVER_URL env var baked into the bundle at build time.
    const serverBase =
      (typeof window !== 'undefined' && window.__SPICEHUB_SERVER__)
      || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SERVER_URL : null)
      || null;
    if (!serverBase) return null; // Skip server call in client-only mode
    const res = await fetch(`${serverBase}/api/structure-recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, title: hintTitle, imageUrl, type }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok || !data.recipe) return null;
    const r = data.recipe;
    // Normalize ingredients Ã¢â‚¬â€ Gemini returns [{name, amount}], SpiceHub uses strings
    const rawServerIngredients = Array.isArray(r.ingredients)
      ? r.ingredients.map(ing => {
        if (typeof ing === 'string') return ing;
        return [ing.amount, ing.name].filter(Boolean).join(' ').trim();
      }).filter(Boolean)
      : [];
    // IMPORTANT: Empty arrays remain empty — never inject placeholder strings.
    const rawServerDirs = Array.isArray(r.directions) ? r.directions.filter(Boolean) : [];
    // Post-Gemini validation: same cross-contamination check as client path
    const { ingredients, directions: _serverDirs, _rescued: _serverRescued } = postProcessGeminiResult(rawServerIngredients, rawServerDirs);
    return {
      ...buildStructuredFields(ingredients, _serverDirs),
      servings: r.servings || null,
      cookTime: r.cookTime || null,
      notes: r.notes || null,
      ...(type === 'drink' ? { glass: r.glass || null, garnish: r.garnish || null, _type: 'drink' } : { _type: 'meal' }),
      imageUrl: imageUrl || '',
      link: sourceUrl || '',
      _aiStructured: true,
    };
  } catch {
    return null;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ captionToRecipe: Gemini-first structuring with heuristic fallback Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Takes raw caption text and returns a structured recipe object.
// Used by BrowserAssist Pass 0 and extractInstagramAgent to get clean results.
export async function captionToRecipe(captionText, { title = '', imageUrl = '', sourceUrl = '', type = 'meal', signal } = {}) {
  if (!captionText || captionText.trim().length < 20) return null;
  if (isAborted(signal)) return null;

  // ReciME-style: aggressively clean social chrome before sending to AI
  const cleanedCaption = cleanSocialCaption(captionText);
  const textForAI = cleanedCaption.length >= 20 ? cleanedCaption : captionText;

  // Try Gemini AI structuring first (most reliable for social media captions)
  try {
    const aiResult = await structureWithAI(textForAI, { title, imageUrl, sourceUrl, type, signal });
    if (aiResult) {
      const hasRealIngs = (aiResult.ingredients || []).some(i => i && !/^see (original post|recipe) for/i.test(i.trim()));
      const hasRealDirs = (aiResult.directions || []).some(d => d && !/^see (original post|recipe) for/i.test(d.trim()));
      if (hasRealIngs || hasRealDirs) return { ...aiResult, _structuredVia: 'gemini' };
    }
  } catch { /* fall through to heuristic */ }

  // Heuristic fallback: parseCaption on cleaned text.
  // Pre-normalize: if the text has no newlines but has runs of 3+ spaces, those
  // are almost certainly encoded newlines from an Instagram embed extraction. Convert
  // them so parseCaption can split sections properly.
  const textForParse = !textForAI.includes('\n') && /   /.test(textForAI)
    ? textForAI.replace(/   +/g, '\n').replace(/[ \t]+/g, ' ')
    : textForAI;
  const parsed = parseCaption(textForParse);
  if (!parsed) return null;

  const name = parsed.title || title || '';
  // Apply cleanLine (Mealie-style recursive stable-clean) to heuristic parser output
  const ingredients = (parsed.ingredients?.length > 0 ? parsed.ingredients : []).map(cleanLine).filter(Boolean);
  const directions  = (parsed.directions?.length > 0  ? parsed.directions  : []).map(cleanLine).filter(Boolean);

  if (ingredients.length === 0 && directions.length === 0) return null;

  return {
    name,
    ingredients,
    directions,
    ...buildStructuredFields(ingredients, directions),
    imageUrl,
    link: sourceUrl,
    _structuredVia: 'heuristic',
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Caption Parser (Paprika-style 4-pass, enhanced for video content) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export function parseCaption(text) {
  const ingredients = [];
  const directions = [];
  let title = null;

  if (!text || !text.trim()) return { title, ingredients, directions };

  // PASS 0: Pre-process video transcript content
  // Detect and handle "Transcript:" sections from yt-dlp subtitle extraction
  let hasTranscript = false;
  const transcriptIdx = text.indexOf('\nTranscript:\n');
  let descriptionPart = text;
  let transcriptPart = '';
  if (transcriptIdx >= 0) {
    hasTranscript = true;
    descriptionPart = text.substring(0, transcriptIdx).trim();
    transcriptPart = text.substring(transcriptIdx + '\nTranscript:\n'.length).trim();
  }

  // If we have both description and transcript, try to parse description first
  // (descriptions often have structured ingredients), transcript for directions
  if (hasTranscript && descriptionPart.length > 30) {
    const descParsed = parseCaption(descriptionPart);
    const transParsed = parseSpeechTranscript(transcriptPart);

    // Merge: use description ingredients if found, otherwise transcript
    const mergedIngredients = descParsed.ingredients.length > 0
      ? descParsed.ingredients
      : transParsed.ingredients;
    const mergedDirections = descParsed.directions.length > 0
      ? descParsed.directions
      : transParsed.directions;

    return {
      title: descParsed.title || transParsed.title,
      ingredients: mergedIngredients,
      directions: mergedDirections.length > 0 ? mergedDirections : transParsed.directions,
    };
  }

  // If only transcript (no description), parse as spoken content
  if (hasTranscript && !descriptionPart) {
    return parseSpeechTranscript(transcriptPart);
  }

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

  // PASS 1.1: Normalize Instagram-style emoji bullet lines
  // Convert "Ã°Å¸Â¥â€¢ 2 carrots" into "- 2 carrots" for better bullet detection
  text = text.replace(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}])\s+/gmu, '- ');
  // Strip trailing hashtag blocks (common at end of Instagram captions)
  const hashtagBlockIdx = text.search(/\n\s*(?:#\w+\s*){3,}$/);
  if (hashtagBlockIdx > 30) {
    text = text.substring(0, hashtagBlockIdx).trim();
  }

  // PASS 1.5: Handle video timestamp formats from multiple platforms
  // YouTube: "2:30 - Add the garlic" / "2:30 Add the garlic"
  // TikTok: timestamps in descriptions
  // Also handles "0:00 Intro\n0:30 Ingredients\n2:00 Steps" style chapter lists
  text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€:]\s*/gm, '');
  text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–— :]\s*/gm, '');
  const timestampLines = text.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm);
  if (timestampLines && timestampLines.length >= 3) {
    // This looks like a chapter list — convert to structured text
    text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/gm, '');
  }
  // Strip inline timestamps within sentences (common in auto-generated descriptions)
  // e.g. "at 2:30 add the garlic" → "add the garlic"
  text = text.replace(/\bat\s+\d{1,2}:\d{2}(?::\d{2})?\s*/gi, '');

  // PASS 1.55: Strip common video description filler (social links, credits, music)
  // These often appear at the end of video descriptions and pollute recipe parsing
  const fillerIdx = text.search(/\n\s*(?:follow me|subscribe|music:|song:|audio:|outfit:|shop:|affiliate|use code|discount|sponsored|#\w+\s*\n)/i);
  if (fillerIdx > 50) {
    text = text.substring(0, fillerIdx).trim();
  }

  // PASS 1.6: Handle abbreviated social media recipe formats
  // e.g. "1c flour, 2 eggs, mix & bake 350° 25min"
  const ABBREV_RE = /^[\d½¼¾⅓⅖][\d./]*\s*[a-z]{1,4}\s+\w+(?:\s*,\s*[\d½¼¾⅓⅖][\d./]*\s*[a-z]{1,4}\s+\w+){2,}/i;
  if (ABBREV_RE.test(text.trim()) && text.trim().length < 300) {
    // Entire text is a comma-separated abbreviated recipe
    const parts = text.split(/\s*,\s*/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (looksLikeIngredient(trimmed) && !looksLikeDirection(trimmed)) {
        ingredients.push(trimmed);
      } else if (looksLikeDirection(trimmed)) {
        directions.push(trimmed);
      } else if (trimmed.length < 40 && NUM_UNIT_RE.test(trimmed)) {
        ingredients.push(trimmed);
      } else {
        directions.push(trimmed);
      }
    }
    return {
      title: null,
      ingredients,
      directions,
    };
  }

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
    let lineStripped = line.replace(/#\w[\w.]*/g, '').replace(/@\w+/g, '').trim();
    if (!lineStripped) continue;

    // Extract title from the first meaningful line before any section
    if (title === null && !inIngredients && !inDirections && !foundSections) {
      const isBulletOrNum = BULLET_RE.test(lineStripped) || STEP_NUM_RE.test(lineStripped);
      if (!isBulletOrNum && lineStripped.length > 3 && !looksLikeIngredient(lineStripped)) {
        let titleCandidate = lineStripped;

        // Remove emoji from title candidates
        titleCandidate = titleCandidate.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}]/gu, '').trim();

        // Skip lines that look like social media usernames/handles:
        //   - Single word with no spaces (e.g. "sweetsimplevegan")
        //   - Lines that are just numbers + "likes"/"comments"/"views"
        //   - Lines matching @username pattern
        const looksLikeUsername = /^[a-zA-Z0-9._]{3,30}$/.test(titleCandidate) && !titleCandidate.includes(' ');
        const looksLikeSocialMeta = /^\d[\d,.]*\s*(likes?|comments?|views?|followers?|shares?|saves?)\s*$/i.test(titleCandidate);
        const looksLikeHandle = /^@\w+$/.test(titleCandidate);
        if (looksLikeUsername || looksLikeSocialMeta || looksLikeHandle) {
          continue; // Skip — not a recipe title
        }

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
      const looksIng = looksLikeIngredient(lineStripped);
      const looksDir = looksLikeDirection(lineStripped);

      // Only switch modes if the signal is clear — avoid misclassification
      if (looksIng && !looksDir) {
        // Extra check: if line contains a cooking verb AND a measurement, it's ambiguous
        // e.g. "Add 2 cups flour" — this is a direction that mentions an ingredient
        if (COOKING_VERBS_RE.test(lineStripped) && lineStripped.length > 40) {
          // Long line with cooking verb — treat as direction even if it has measurements
          inIngredients = false; inDirections = true;
        } else {
          inIngredients = true; inDirections = false;
        }
      }
      else if (looksDir && !looksIng) { inIngredients = false; inDirections = true; }
      // If both look true, use length as tiebreaker: short = ingredient, long = direction
      else if (looksIng && looksDir) {
        if (lineStripped.length < 50) { inIngredients = true; inDirections = false; }
        else { inIngredients = false; inDirections = true; }
      }
    }


    // ── Contamination guard A: Sub-section headers (e.g. "jalapeño crema:") ──────
    // Lines ending with ":" that carry no quantity are organisational labels, not
    // ingredients or directions. Skip them so they don't pollute the ingredient list.
    const hasQuantity = /\d|½|¼|¾|⅓|⅔|⅛|⅜|⅝|⅞/.test(lineStripped);
    const isSubHeader = /:\s*$/.test(lineStripped) && !hasQuantity && lineStripped.length < 70
      && !isIngredientsHeader(lineStripped.toLowerCase()) && !isDirectionsHeader(lineStripped.toLowerCase());
    if (isSubHeader) {
      // Sub-section header — preserve current in/out mode, skip adding to any list
      continue;
    }

    // Clean prefix markers
    // First strip bullet markers (but preserve what follows, including leading numbers)
    let cleaned = lineStripped
      .replace(/^[-\u2022*\u203A\u2023\u2043\u2212\u2022\u00A3\u29B8\u2714\u2713]\s*/, '');
    // Only strip leading numbers when followed by punctuation delimiter (step numbers like "1." or "2)")
    // NOT when followed by a space + unit (ingredient quantities like "2 tbsp")
    cleaned = cleaned.replace(/^\d+[.):-]\s*/, '').trim();
    if (!cleaned) continue;

    // ── Contamination guard B: Narrative sentences in ingredient mode ────────────
    // Instagram captions include prose like "the star of the show is frozen cauliflower
    // rice" which has food words but is clearly a note/direction, not an ingredient.
    // Heuristic: long lines starting with an article/pronoun with no quantity digit
    // are almost never stand-alone ingredients.
    const NARRATIVE_START_RE = /^(the |a |an |this |these |it |they |i |you |we |what |one of |my |our )/i;
    const isLongNarrative = NARRATIVE_START_RE.test(cleaned) && !hasQuantity && cleaned.length > 40
      && !looksLikeIngredientLine(cleaned); // parse-ingredient handles "the juice of 1 lemon"
    if (isLongNarrative && inIngredients) {
      // Override — move to directions so it doesn't contaminate the ingredient list
      directions.push(cleaned);
      continue;
    }

    // PASS 4: Route to correct list
    if (inIngredients) {
      if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
    } else if (inDirections) {
      directions.push(cleaned);
    } else {
      // Final fallback
      if (looksLikeIngredient(lineStripped) && !looksLikeDirection(lineStripped)) {
        if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
      } else if (looksLikeDirection(lineStripped)) {
        directions.push(cleaned);
      }
    }
  }
  return { title, ingredients, directions };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Speech transcript parser (for yt-dlp subtitle content) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Spoken recipe content is unstructured continuous text. We split it into
// sentences, then classify each sentence as ingredient-like or direction-like.
function parseSpeechTranscript(text) {
  if (!text || text.trim().length < 20) return { title: null, ingredients: [], directions: [] };

  const ingredients = [];
  const directions = [];
  let title = null;

  // Pre-process: clean up common transcript artifacts
  text = text
    // Remove [Music], [Applause], etc. markers that survive subtitle cleaning
    .replace(/\[[\w\s]+\]/g, '')
    // Normalize whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Split transcript into sentences Ã¢â‚¬â€ handle both period-separated and natural speech
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    // Also split on "so" / "and then" / "now" when they start a new thought after a pause
    .replace(/\.\s*(so|and then|now|next|then|after that|once)\s/gi, '.\n$1 ')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 3);

  // Filter out common filler/intro phrases (expanded for video content)
  const FILLER_RE = /^(hey |hi |hello |what's up|welcome|subscribe|like and subscribe|follow me|link in bio|comment below|check out my|don't forget to subscribe|make sure to subscribe|hit that|smash that|thanks for watching|see you |bye |peace |what's going on|how's it going|good morning|good evening|in this video|in today's video|let me know in the comments|drop a comment|tag a friend|save this for later|share this|if you enjoyed|if you liked|new video every)/i;

  // Phase 1: Extract ingredient mentions from spoken content
  // Spoken recipes often embed ingredients within instructions like
  // "grab two cups of flour and a teaspoon of salt"
  // Also handles written-out numbers: "two cups", "a half cup", "three tablespoons"
  const SPOKEN_INGREDIENT_RE = /(\d[\d./]*\s+(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch(?:es)?|dash(?:es)?|cloves?|cans?|packages?|sticks?|slices?|pieces?|drops?|shots?|jiggers?|splashe?s?|handfuls?|sprigs?|bunche?s?|heads?|stalks?)\s+(?:of\s+)?[\w\s]+?)(?:[,.]|\s+and\s+|\s+then\s+|$)/gi;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];

    // Skip filler
    if (FILLER_RE.test(s)) continue;

    // Skip very short non-content fragments
    if (s.length < 5) continue;

    // Extract title from first meaningful sentence if short enough
    if (title === null && s.length < 80 && !looksLikeIngredient(s) && !FILLER_RE.test(s)) {
      // Check if it sounds like a recipe name: "Today we're making X" / "This is my X recipe"
      const nameMatch = s.match(/(?:mak(?:e|ing)|cook(?:ing)?|prepar(?:e|ing)|recipe for|showing you|teach you|how (?:to|I) (?:make|cook|prepare))\s+(?:my\s+|this\s+|a\s+|an?\s+|some\s+|the\s+)?(.{5,60})/i);
      if (nameMatch) {
        title = cleanTitle(nameMatch[1].replace(/[.!?]+$/, ''));
      } else if (i === 0 && s.length < 60) {
        title = cleanTitle(s.replace(/[.!?]+$/, ''));
      }
      continue;
    }

    // Try to extract inline ingredient mentions from spoken sentences
    // e.g. "So grab two cups of flour and a teaspoon of salt"
    const inlineIngredients = [];
    let match;
    const reClone = new RegExp(SPOKEN_INGREDIENT_RE.source, SPOKEN_INGREDIENT_RE.flags);
    while ((match = reClone.exec(s)) !== null) {
      const ing = match[1].trim().replace(/\s+/g, ' ');
      if (ing.length > 3 && ing.length < 80) {
        inlineIngredients.push(ing);
      }
    }

    // If we found inline ingredients, add them AND add the sentence as a direction
    if (inlineIngredients.length > 0) {
      for (const ing of inlineIngredients) {
        // Avoid duplicates
        if (!ingredients.some(existing => existing.toLowerCase() === ing.toLowerCase())) {
          ingredients.push(ing);
        }
      }
      // The whole sentence is still a direction (the cooking step)
      let cleaned = s.replace(/^\d+[.):-]\s*/, '').trim();
      if (cleaned.length > 10 && looksLikeDirection(cleaned)) {
        directions.push(cleaned);
      }
      continue;
    }

    // Standard classification: ingredient mentions vs cooking steps
    if (looksLikeIngredient(s) && !looksLikeDirection(s) && s.length < 60) {
      ingredients.push(s.replace(/^[-•*]\s*/, '').replace(/^\d+[.):-]\s*/, '').trim());
    } else if (looksLikeDirection(s) || s.length > 30) {
      // Clean up direction-style sentences
      let cleaned = s.replace(/^\d+[.):-]\s*/, '').trim();
      // Capitalize first letter for cleaner display
      if (cleaned.length > 5) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        directions.push(cleaned);
      }
    }
  }

  return { title, ingredients, directions };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ HTML helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
    // Remove "... | Instagram" / "... - TikTok" / "... - YouTube" / "... | Allrecipes" suffix
    .replace(/\s*[|\-Ã¢â‚¬â€œÃ¢â‚¬â€Ã¢â‚¬Â¢]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube|Reels?|Allrecipes|AllRecipes|Food Network|Tasty|Delish|Serious Eats|Bon AppÃƒÂ©tit|Epicurious|Simply Recipes|The Pioneer Woman|Yummly|Skinnytaste|Love and Lemons|Half Baked Harvest|Cookie and Kate|Minimalist Baker|Budget Bytes).*$/i, '')
    // Generic site-suffix strip: " | Word" or " - Word" at end where Word is 2-25 chars (likely a domain/brand)
    .replace(/\s*[|]\s*[A-Z][A-Za-z0-9 &]{1,24}$/, '')
    .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
    // Remove social handle prefixes: "Chris Ã¢â‚¬Â¢ Ã¢â€œâ€¹ | " or "@username: "
    .replace(/^[^|]*[Ã¢â‚¬Â¢\u24cb\u24b6-\u24E9][^|]*\|\s*/u, '')
    .replace(/^@[\w.]+[:\s]+/i, '')
    // Remove handles and hashtags
    .replace(/\s*\(@[\w.]+\).*$/, '')
    .replace(/#\w[\w.]*/g, '')
    // Remove "Reel by username" etc.
    .replace(/^(Reel|Video|Post)\s+by\s+[\w.]+\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€:.]?\s*/i, '')
    // Remove social media engagement stats
    .replace(/\d+[kKmM]?\s*(likes?|comments?|shares?|views?|saves?)\s*[,.]?\s*/gi, '')
    // Remove "Part N!" suffix
    .replace(/\s*Part\s*\d+!?\s*$/i, '')
    // Remove "Ready in Just N Minutes!" filler
    .replace(/\s*Ready in Just \d+ Minutes!?\s*/i, '')
    // Remove trailing "Welcome" filler
    .replace(/\s*Welcome\s*$/i, '')
    // Remove emojis
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, '')
    // Fix smart quotes
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Remove trailing exclamation marks clutter
  title = title.replace(/[!]+$/, '').trim();

  // If title is too long, try to find a natural break point
  if (title.length > 120) {
    const parts = title.split(/\s*[|\-Ã¢â‚¬â€œÃ¢â‚¬â€]\s*/);
    if (parts[0].length > 3 && parts[0].length <= 120) {
      title = parts[0].trim();
    } else {
      title = title.substring(0, 115).replace(/\s\S+$/, '').trim();
    }
  }

  // If title ended up empty after cleaning, use fallback
  if (!title || title.length < 2) return 'Imported Recipe';

  // Fix ALL CAPS to Title Case
  if (title === title.toUpperCase() && title.length > 5) {
    title = title.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
  }

  // Capitalize first letter if it's all lowercase
  if (title === title.toLowerCase() && title.length < 80) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Flexible instruction parser (Mealie-inspired) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Handles the many formats recipe sites use for instructions:
//   - Array of strings
//   - Array of { text: "..." } objects (HowToStep)
//   - Array of { "@type": "HowToSection", itemListElement: [...] }
//   - A single string (newline-separated or JSON-encoded)
//   - Dict-indexed objects { "0": { text: "..." }, "1": { text: "..." } }
function parseInstructionsFlexible(inst) {
  if (!inst) return [];

  // String Ã¢â‚¬â€ could be newline-separated or a JSON string
  if (typeof inst === 'string') {
    const trimmed = inst.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try { return parseInstructionsFlexible(JSON.parse(trimmed)); }
      catch { /* fall through to split */ }
    }
    return trimmed.split(/[\n\r]+/).map(s => sanitizeInstruction(s)).filter(Boolean);
  }

  // Dict-indexed (e.g. { "0": { text: "..." }, "1": { text: "..." } })
  if (inst && typeof inst === 'object' && !Array.isArray(inst)) {
    const keys = Object.keys(inst);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      return parseInstructionsFlexible(keys.sort((a, b) => +a - +b).map(k => inst[k]));
    }
    // Single object with text
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

      // HowToSection Ã¢â‚¬â€ flatten nested itemListElement
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

/**
 * Mealie-inspired iterative instruction sanitization:
 * Strip HTML, decode entities, collapse whitespace Ã¢â‚¬â€ loop until stable.
 */
function sanitizeInstruction(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text.trim();
  let prev = '';
  for (let i = 0; i < 5 && clean !== prev; i++) {
    prev = clean;
    clean = decodeHtml(clean.replace(/<[^>]+>/g, ' ').replace(/\xa0/g, ' ').replace(/ +/g, ' ')).trim();
  }
  return clean;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ JSON-LD extraction Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Directions Ã¢â‚¬â€ Mealie-inspired comprehensive parsing:
  // Handles HowToStep, HowToSection, plain strings, JSON strings,
  // dict-indexed steps, and newline-separated blocks.
  let directions = [];
  const inst = node.recipeInstructions;
  directions = parseInstructionsFlexible(inst);

  // Image Ã¢â‚¬â€ Mealie-inspired: pick the best/largest from multiple candidates
  const imageUrl = selectBestImage(node.image);

  return {
    name,
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl,
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Strip social media OG description prefix Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Instagram OG descriptions start with "123 likes, 45 comments - username on Month Day, Year:"
// TikTok starts with "username (@handle). ... | ... likes. ..."
function stripSocialMetaPrefix(text) {
  if (!text) return text;
  // Instagram: "123 likes, 45 comments - username on Month Day, Year:"
  text = text.replace(/^[\d,.]+[kKmM]?\s+likes?,?\s*[\d,.]+[kKmM]?\s+comments?\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€]\s*[^:]+:\s*/i, '');
  // Instagram alt: "username shared a post on Instagram: "..."
  text = text.replace(/^[\w.]+\s+shared\s+a\s+(post|reel)\s+on\s+Instagram\s*:\s*/i, '');
  // TikTok: "username (@handle). description | 123 Likes..."
  text = text.replace(/^[\w.]+\s*\(@[\w.]+\)\.\s*/i, '');
  // Remove trailing " | 123 Likes. 45 Comments. ..."
  text = text.replace(/\s*\|\s*[\d,.]+[kKmM]?\s+Likes\..*$/i, '');
  return text.trim();
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ CORS proxy cascade (fully client-side, no server needed) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// PROXIES removed

// fetchHtmlViaProxy removed

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Instagram embed extraction (client-side via CORS proxy) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function extractInstagramShortcode(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function isInstagramUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

async function extractInstagramEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  // Try both the /p/ and /reel/ embed URL patterns (Instagram changed their structure in 2025)
  const embedUrls = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
  ];
  console.log(`[instagram-embed] Trying embed pages for shortcode: ${shortcode}`);

  try {
    // Try both embed URL patterns, take the first that returns useful HTML
    let html = null;
    for (const embedUrl of embedUrls) {
      const candidate = await fetchHtmlViaProxyFromApi(embedUrl, 18000);
      if (candidate && candidate.length > 3000) {
        html = candidate;
        console.log(`[instagram-embed] Got response from: ${embedUrl}`);
        break;
      }
    }
    if (!html) html = await fetchHtmlViaProxyFromApi(embedUrls[0], 18000); // final fallback
    if (!html) { console.log('[instagram-embed] CORS proxy returned no data'); return null; }
    if (html.length < 5000 && (html.includes('Log in') || html.includes('login'))) {
      console.log('[instagram-embed] Login wall detected'); return null;
    }

    // Extract caption
    let caption = '';
    const captionPatterns = [
      /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    ];
    for (const re of captionPatterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        // Preserve line structure: convert block-level end tags and <br> to newlines
        // BEFORE stripping all tags. Without this, a multi-line Instagram caption
        // collapses to a single space-separated line and parseCaption can't split it.
        const text = m[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
          .replace(/<[^>]+>/g, '')          // strip remaining tags (no space insertion)
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace only
          .replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n') // trim line edges
          .replace(/\n{3,}/g, '\n\n').trim();
        if (text && text.length > 15) { caption = text; break; }
      }
    }
    // JSON data fallback Ã¢â‚¬â€ multiple 2026 Instagram patterns
    if (!caption) {
      const dataPatterns = [
        // 2024/2025 SFX JSON payload: "caption":{"text":"Ã¢â‚¬Â¦"}
        /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
        // Flat caption field
        /"caption"\s*:\s*"((?:[^"\\]|\\.){20,})"/,
        // edge_media_to_caption
        /"edge_media_to_caption"[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/,
        // xdt_api__v1__media pattern (2025/2026 API leak in embed HTML)
        /"caption_text"\s*:\s*"((?:[^"\\]|\\.){15,})"/,
        // Generic text field with enough length
        /"text"\s*:\s*"((?:[^"\\]|\\.){30,})"/,
      ];
      for (const re of dataPatterns) {
        const m = re.exec(html);
        if (m && m[1]) {
          try {
            const decoded = JSON.parse('"' + m[1] + '"');
            if (decoded.length > 15) { caption = decoded; break; }
          } catch {
            if (m[1].length > 15) { caption = m[1].replace(/\\n/g, '\n').replace(/\\t/g, ' '); break; }
          }
        }
      }
    }
    // OG description fallback
    if (!caption) {
      const og = extractMeta(html, 'og:description');
      if (og && og.length > 15) caption = og;
    }
    // Twitter card description fallback
    if (!caption) {
      const tc = extractMeta(html, 'twitter:description');
      if (tc && tc.length > 15) caption = tc;
    }

    // Extract image — prefer post-specific URLs (display_url is the actual food photo)
    // over og:image which Instagram sometimes sets to the profile avatar in embed pages.
    let imageUrl = '';
    // Patterns in priority order — display_url is the actual food photo.
    // Profile avatar patterns are explicitly rejected below.
    const postImgPatterns = [
      /"display_url"\s*:\s*"(https:[^"]+)"/i,
      /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
      /"url"\s*:\s*"(https:[^"]*(?:scontent|fbcdn)[^"]+)"/i,
      /"src"\s*:\s*"(https:[^"]*(?:scontent|fbcdn)[^"]+)"/i,
      /"poster"\s*:\s*"(https:[^"]+)"/i,
      /display_url":"(https:[^"]+)"/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["'](https:\/\/[^"']+)["']/i,
      /<img[^>]+src="(https:\/\/[^"]*(?:scontent|fbcdn|cdninstagram)[^"]*_n\.(?:jpg|webp)[^"]*)"/i,
      /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
      /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.(?:jpg|webp)[^"]*)"/i,
    ];
    for (const re of postImgPatterns) {
      const m = re.exec(html);
      if (m) {
        const candidate = m[1]
          .replace(/\\\//g, '/')
          .replace(/&amp;/g, '&')
          .replace(/\\u0026/g, '&');
        // Skip non-image URLs (JS/CSS/font resources from cdninstagram)
        if (!isValidImageUrl(candidate)) continue;
        // Skip profile pics / avatars — these are account images, not food photos
        if (isProfilePicUrl(candidate)) continue;
        imageUrl = candidate;
        break;
      }
    }
    // Only fall back to og:image if no post-specific image found
    if (!imageUrl) {
      const ogImage = extractMeta(html, 'og:image') || '';
      if (ogImage && isValidImageUrl(ogImage) && !isProfilePicUrl(ogImage)) imageUrl = ogImage;
    }

    // Extract title — og:title often reads "Username on Instagram: 'first line of caption'"
    // cleanTitle strips the "Username on Instagram:" prefix, leaving the recipe name.
    // If that's still empty/generic, try to grab the first meaningful line of the caption.
    let title = cleanTitle(extractMeta(html, 'og:title') || '');
    if (!title || title === 'Imported Recipe') {
      // Try first non-empty line of caption as title hint
      const firstLine = (caption || '').split('\n').map(l => l.trim()).find(l => l.length > 4 && l.length < 100 && !/^[#@]/.test(l));
      if (firstLine) title = cleanTitle(firstLine);
    }

    // If embed page gave nothing, try Instagram oEmbed (public, no auth needed)
    if (!caption) {
      try {
        const oEmbedUrl = `https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}&format=json`;
        const oEmbedHtml = await fetchHtmlViaProxyFromApi(oEmbedUrl, 8000);
        if (oEmbedHtml && oEmbedHtml.length > 10) {
          const oData = JSON.parse(oEmbedHtml);
          if (oData?.title && oData.title.length > 10) {
            caption = oData.title;
            if (!title) title = oData.author_name || '';
            if (!imageUrl && oData.thumbnail_url && isValidImageUrl(oData.thumbnail_url) && !isProfilePicUrl(oData.thumbnail_url)) imageUrl = oData.thumbnail_url;
            console.log(`[instagram-embed] oEmbed fallback success Ã¢â‚¬â€ ${caption.length} chars`);
          }
        }
      } catch { /* oEmbed not available */ }
    }

    if (!caption && !title) {
      // No clean caption found Ã¢â‚¬â€ extract visible text from HTML for Gemini AI fallback
      if (html && html.length > 500) {
        const rawPageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 6000);
        if (rawPageText.length > 300) {
          console.log(`[instagram-embed] No caption Ã¢â‚¬â€ returning ${rawPageText.length}c page text for AI fallback`);
          return { ok: false, rawPageText, imageUrl, sourceUrl: url };
        }
      }
      console.log('[instagram-embed] No data found');
      return null;
    }

    console.log(`[instagram-embed] Success Ã¢â‚¬â€ caption: ${caption.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);
    return { ok: true, type: 'caption', caption: stripSocialMetaPrefix(caption), title, imageUrl, sourceUrl: url };
  } catch (e) {
    console.log(`[instagram-embed] Error: ${e.message}`);
    return null;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Convert embed extraction result Ã¢â€ â€™ recipe format Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function handleEmbedResult(data, sourceUrl) {
  if (!data || !data.ok) return null;

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

// Ã¢â€â‚¬Ã¢â€â‚¬ Server API helpers for unified pipeline Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// The server (server/index.js) provides yt-dlp and headless Chrome capabilities.
// These are optional Ã¢â‚¬â€ if the server is unavailable, we fall back to client-side.

let _serverBaseUrl = null;
let _serverChecked = false;

/**
 * Detect the SpiceHub server URL. Tries configured URL + same-origin.
 * NEVER tries localhost/127.0.0.1 when running on HTTPS (production) Ã¢â‚¬â€ that
 * generates ERR_CONNECTION_REFUSED spam for every import with no benefit.
 * Returns base URL string or null if server is not available.
 */
async function detectServer() {
  if (_serverChecked) return _serverBaseUrl;
  _serverChecked = true;

  const configured =
    (typeof window !== 'undefined' && window.__SPICEHUB_SERVER__) ||
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_BASE || import.meta.env?.VITE_SERVER_URL)) ||
    '';
  const candidates = [];

  if (configured) candidates.push(String(configured).replace(/\/$/, ''));
  if (typeof window !== 'undefined') {
    candidates.push(window.location.origin);
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(window.location.hostname);
    if (isLocal && window.location.port !== '3001') candidates.push('http://localhost:3001');
  }

  for (const base of [...new Set(candidates.filter(Boolean))]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(`${base}/api/v2/ping`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        _serverBaseUrl = base;
        return _serverBaseUrl;
      }
    } catch { /* try next candidate */ }
  }

  _serverBaseUrl = null;
  return null;
}

/** Reset server detection (e.g. after network change) */
export function resetServerDetection() {
  _serverBaseUrl = null;
  _serverChecked = false;
}

/**
 * Try dedicated video extraction endpoint (/api/extract-video).
 * This uses yt-dlp metadata + subtitles Ã¢â‚¬â€ faster and more targeted than
 * the general /api/extract-url endpoint for video/social URLs.
 * Returns parsed recipe object or null.
 */
/**
 * Try to parse comma-delimited Instagram-style ingredient lists.
 * Instagram captions often list ingredients as: "2 eggs, 1 cup flour, butter, salt"
 * or use emoji separators: "Ã°Å¸Â¥Å¡ 2 eggs Ã°Å¸Â§Ë† butter Ã°Å¸Â§â‚¬ cheese"
 */
function tryCommaDelimitedParse(text) {
  if (!text || text.length < 20) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const ingredients = [];
  const directions = [];

  for (const line of lines) {
    // Check if line looks like a comma-separated ingredient list
    const commaItems = line.split(/\s*[,;]\s*/);
    if (commaItems.length >= 3 && commaItems.every(item => item.length < 50)) {
      const allLookLikeIngredients = commaItems.filter(item =>
        item.length > 1 && (NUM_UNIT_RE.test(item) || FOOD_RE.test(item) || UNITS_RE.test(item))
      ).length >= commaItems.length * 0.5;

      if (allLookLikeIngredients) {
        for (const item of commaItems) {
          const trimmed = item.trim();
          if (trimmed.length > 1) ingredients.push(trimmed);
        }
        continue;
      }
    }

    // Check for emoji-separated ingredients (Ã°Å¸Â¥Å¡ 2 eggs Ã°Å¸Â§Ë† butter)
    const emojiParts = line.split(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u).filter(p => p.trim().length > 1);
    if (emojiParts.length >= 3) {
      const foodCount = emojiParts.filter(p => FOOD_RE.test(p.trim()) || NUM_UNIT_RE.test(p.trim())).length;
      if (foodCount >= emojiParts.length * 0.4) {
        for (const part of emojiParts) {
          const trimmed = part.trim();
          if (trimmed.length > 1) ingredients.push(trimmed);
        }
        continue;
      }
    }

    // If the line has cooking verbs, it's a direction
    if (COOKING_VERBS_RE.test(line) && line.length > 15) {
      directions.push(line.replace(/^[-Ã¢â‚¬Â¢*Ã¢â€“ÂªÃ¢â€“Â¸Ã¢â€“ÂºÃ¢â€”Â¦Ã¢â‚¬Â£Ã¢ÂÆ’Ã¢Å“â€œÃ¢Å“â€Ã°Å¸â€Â¸Ã°Å¸â€Â¹]\s*/, '').replace(/^\d+[.):-]\s*/, '').trim());
    }
  }

  if (ingredients.length === 0 && directions.length === 0) return null;
  return { ingredients, directions };
}

/**
 * Parse spoken-word subtitle/transcript text into ingredients and directions.
 * Subtitles from yt-dlp are spoken format like:
 *   "you're going to need two cups of flour a cup of sugar some butter..."
 *   "first preheat your oven to 350 then mix all the dry ingredients..."
 * This extracts structure from spoken prose that parseCaption can't handle.
 */
function parseSpokenTranscript(text) {
  if (!text || text.length < 30) return null;

  const ingredients = [];
  const directions = [];

  // Split into sentences on periods, then also on common spoken transitions
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|(?:\s+(?:and then|then|next|after that|now|so then|okay so)\s+)/i)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // Spoken ingredient patterns: "you'll need X", "grab your X", "X of Y"
  const SPOKEN_ING_RE = /(?:you(?:'re| are| will)? (?:going to )?need|you(?:'ll| will) need|grab(?: your)?|take|get|add|use|put in)\s+(.+)/i;
  const QUANTITY_MENTION_RE = /\b(?:cup|tablespoon|teaspoon|tbsp|tsp|ounce|oz|pound|lb|pinch|dash|handful|bunch|clove|can|jar|package|stick|piece)s?\b/i;
  const SPOKEN_DIRECTION_RE = /\b(?:preheat|mix|stir|cook|bake|fry|saut[ÃƒÂ©e]|boil|simmer|chop|dice|slice|fold|whisk|pour|drain|season|sprinkle|spread|roll|knead|let it|set aside|cover|flip|turn|remove|place|combine|toss|serve|plate|garnish)\b/i;

  for (const sentence of sentences) {
    const lc = sentence.toLowerCase();

    // Check if it mentions ingredient quantities
    const hasQuantity = QUANTITY_MENTION_RE.test(sentence) ||
      /\b\d+\s*(?:\/\d+)?\s*(?:cup|tsp|tbsp|oz|lb|g|ml)\b/i.test(sentence);

    // Check for cooking action verbs
    const hasAction = SPOKEN_DIRECTION_RE.test(sentence);

    // Extract ingredient mentions from "you'll need" patterns
    const ingMatch = sentence.match(SPOKEN_ING_RE);
    if (ingMatch) {
      // Split by "and" or comma for multiple ingredients
      const items = ingMatch[1].split(/\s*(?:,|and)\s*/i).filter(i => i.length > 2);
      for (const item of items) {
        const clean = item.replace(/\s+/g, ' ').trim();
        if (clean.length > 2 && clean.length < 80) ingredients.push(clean);
      }
    } else if (hasQuantity && !hasAction) {
      // Sentence mentions quantities but no cooking verbs Ã¢â‚¬â€ likely ingredient listing
      const clean = sentence.replace(/^(?:and\s+|also\s+|plus\s+)/i, '').trim();
      if (clean.length > 3 && clean.length < 120) ingredients.push(clean);
    } else if (hasAction) {
      // Sentence has cooking verbs Ã¢â‚¬â€ it's a direction
      const clean = sentence
        .replace(/^(?:and\s+then\s+|then\s+|next\s+|now\s+|so\s+)/i, '')
        .replace(/^\w/, c => c.toUpperCase())
        .trim();
      if (clean.length > 10) directions.push(clean);
    }
  }

  if (ingredients.length === 0 && directions.length === 0) return null;
  return { ingredients, directions };
}

async function tryVideoExtraction(url, onProgress, { type = 'meal' } = {}) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Checking video subtitles...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75000);
    const resp = await fetch(`${serverUrl}/api/extract-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl(url), type }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.ok) return null;

    const rawText = [data.title, data.description, data.transcript].filter(Boolean).join('\n\n');
    if (rawText.trim().length < 20) return null;

    const spoken = data.transcript ? parseSpokenTranscript(data.transcript) : null;
    const parsed = parseCaption(rawText);
    const baseRecipe = {
      name: cleanTitle(data.title || parsed.title || 'Imported Recipe'),
      ingredients: spoken?.ingredients?.length ? spoken.ingredients : parsed.ingredients,
      directions: spoken?.directions?.length ? spoken.directions : parsed.directions,
      imageUrl: data.imageUrl || data.thumbnail || '',
      link: data.sourceUrl || url,
      _extractedVia: data.hasSubtitles ? 'yt-dlp-subtitles' : 'yt-dlp-metadata',
      _hasSubtitles: Boolean(data.hasSubtitles),
    };

    if (hasRecipeContent(baseRecipe)) return baseRecipe;

    const aiRecipe = await captionToRecipe(rawText, {
      title: data.title || '',
      imageUrl: baseRecipe.imageUrl,
      sourceUrl: url,
      type,
    });
    if (aiRecipe && hasRecipeContent(aiRecipe)) {
      return {
        ...aiRecipe,
        imageUrl: baseRecipe.imageUrl || aiRecipe.imageUrl,
        link: url,
        _extractedVia: data.hasSubtitles ? 'yt-dlp-subtitles-ai' : 'yt-dlp-metadata-ai',
        _hasSubtitles: Boolean(data.hasSubtitles),
      };
    }
  } catch (e) {
    console.log(`[SpiceHub] Video extraction error: ${e.message}`);
  }

  return null;
}

/**
 * Phase 2: Agent-style automatic extraction via the /api/extract-instagram-agent endpoint.
 * This runs full headless Chrome server-side with:
 *   - Mobile viewport for better Instagram rendering
 *   - Auto-expansion of truncated captions
 *   - Carousel image extraction (returns imageUrls[])
 *   - Subtitle extraction via DOM eval for Reels
 *
 * Returns a parsed recipe object with imageUrls[] or null on failure.
 */
async function extractInstagramAgent(url, onProgress, { type = 'meal' } = {}) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Trying server browser extraction...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 75000);
    const resp = await fetch(`${serverUrl}/api/extract-instagram-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cleanUrl(url), type }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.ok) return null;

    const rawText = [data.caption, data.rawText, data.transcript].filter(Boolean).join('\n\n');
    const imageUrl = Array.isArray(data.imageUrls) ? data.imageUrls[0] : data.imageUrl || '';
    if (rawText.trim().length < 20 && !imageUrl) return null;

    const recipe = rawText.trim().length >= 20
      ? await captionToRecipe(rawText, { title: data.title || '', imageUrl, sourceUrl: url, type })
      : null;

    if (recipe && hasRecipeContent(recipe)) {
      return {
        ...recipe,
        imageUrl: imageUrl || recipe.imageUrl,
        link: url,
        _extractedVia: data.extractedVia || 'server-browser-ai',
        _hasSubtitles: Boolean(data.transcript),
      };
    }

    if (rawText.trim().length >= 20) {
      const parsed = parseCaption(rawText);
      return {
        name: cleanTitle(data.title || parsed.title || 'Imported Recipe'),
        ingredients: parsed.ingredients,
        directions: parsed.directions,
        imageUrl,
        link: url,
        _extractedVia: data.extractedVia || 'server-browser',
      };
    }
  } catch (e) {
    console.log(`[SpiceHub] Instagram browser extraction error: ${e.message}`);
  }

  return null;
}

/**
 * Try server-side extraction (yt-dlp + headless Chrome).
 * Returns parsed recipe object or null.
 */
async function tryServerExtraction(url, onProgress) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Extracting via server (yt-dlp + metadata)...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);

    const resp = await fetch(`${serverUrl}/api/extract-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok) return null;

    // Handle different response types
    if (data.type === 'jsonld' && data.recipe) {
      // Structured recipe data from JSON-LD
      const recipe = parseRecipeFromServerJsonLd(data.recipe);
      if (recipe) {
        recipe.link = data.sourceUrl || url;
        recipe.imageUrl = recipe.imageUrl || data.imageUrl || '';
        recipe._extractedVia = data.extractedVia || 'server';
        return recipe;
      }
    }

    if (data.type === 'caption' || data.type === 'video-meta') {
      // Caption text (from yt-dlp description + subtitles, or headless Chrome)
      const captionText = data.caption || '';
      if (captionText.length > 15) {
        const parsed = parseCaption(captionText);
        const recipe = {
          name: data.title ? cleanTitle(data.title) : (parsed.title || 'Imported Recipe'),
          ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
          directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
          imageUrl: data.imageUrl || data.thumbnail || '',
          link: data.sourceUrl || url,
          _extractedVia: data.extractedVia || 'server',
          _hasSubtitles: data.hasSubtitles || false,
        };
        return recipe;
      }

      // Even if caption is minimal, if we got title + image, return what we have
      if (data.title) {
        return {
          name: cleanTitle(data.title),
          ingredients: ['See original post for ingredients'],
          directions: ['See original post for directions'],
          imageUrl: data.imageUrl || data.thumbnail || '',
          link: data.sourceUrl || url,
          _extractedVia: data.extractedVia || 'server',
          _hasSubtitles: false,
        };
      }
    }

    // Login wall or empty result from server
    if (data.type === 'none') {
      if (data.isLoginWall) {
        return { _error: true, reason: 'login-wall', platform: getSocialPlatform(url) };
      }
      return null;
    }

    return null;
  } catch (e) {
    console.log(`[SpiceHub] Server extraction error: ${e.message}`);
    return null;
  }
}

/** Parse a JSON-LD recipe object from the server response */
function parseRecipeFromServerJsonLd(recipe) {
  if (!recipe || !recipe.name) return null;

  let ingredients = [];
  if (Array.isArray(recipe.recipeIngredient)) {
    ingredients = recipe.recipeIngredient.map(i => i.toString().trim()).filter(Boolean);
  }

  let directions = parseInstructionsFlexible(recipe.recipeInstructions);

  const imageUrl = selectBestImage(recipe.image);

  return {
    name: cleanTitle(recipe.name),
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl: imageUrl || '',
  };
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// SCRAPER TIER 0: ENDPOINT NUDGING
// Try to find a background JSON endpoint the site is already serving.
// Zero-cost, no DOM parsing, no CSS selectors Ã¢â‚¬â€ just smarter URL construction.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Endpoint nudging: check if the recipe site already serves structured JSON
 * from a background endpoint (WordPress REST API, WP Recipe Maker API, etc.).
 *
 * Checks (in order):
 *   1. WordPress REST API: /wp-json/wp/v2/posts?slug={slug}
 *      Ã¢â€ â€™ Returns post object with `content.rendered` (full HTML)
 *   2. WP Recipe Maker public API: /wp-json/wprm/v1/recipe/{id}
 *      Ã¢â€ â€™ Returns structured { ingredients, instructions } (ideal)
 *   3. Generic JSON suffix: {url}.json or {url}?format=json
 *      Ã¢â€ â€™ Some headless or JAMstack sites serve JSON versions
 *
 * @param {string} url - Original page URL
 * @param {string|null} [fetchedHtml] - Already-fetched HTML (to extract WP post ID)
 * @returns {object|null} Recipe object or null
 */
async function tryEndpointNudging(url, fetchedHtml = null) {
  try {
    const u = new URL(url);
    const origin = u.origin;
    const pathParts = u.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const slug = pathParts[pathParts.length - 1] || '';

    // Ã¢â€â‚¬Ã¢â€â‚¬ Strategy 1: WordPress REST API by slug Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // Works on any site running WordPress (the majority of recipe blogs do).
    // Endpoint: /wp-json/wp/v2/posts?slug={slug}&_fields=id,title,content
    if (slug) {
      const wpApiUrl = `${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,title,content,featured_media&per_page=1`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const resp = await fetch(wpApiUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const posts = await resp.json();
          if (Array.isArray(posts) && posts.length > 0) {
            const post = posts[0];
            const contentHtml = post.content?.rendered || '';
            const title = post.title?.rendered || '';
            if (contentHtml.length > 200) {
              console.log(`[endpoint-nudge] WP REST API hit for slug "${slug}" (${contentHtml.length} chars)`);

              // First try: JSON-LD inside the post content
              const ldRecipes = findJsonLdRecipes(contentHtml);
              if (ldRecipes.length > 0 && (ldRecipes[0].ingredients?.length > 0 || ldRecipes[0].directions?.length > 0)) {
                return { ...ldRecipes[0], link: url, _extractedVia: 'wp-rest-jsonld' };
              }

              // Second try: CSS heuristics on the rendered content
              const cssRecipe = extractRecipeByCSS(contentHtml);
              if (cssRecipe && (cssRecipe.ingredients?.length > 0 || cssRecipe.directions?.length > 0)) {
                cssRecipe.name = cssRecipe.name || cleanTitle(title);
                return { ...cssRecipe, link: url, _extractedVia: 'wp-rest-css' };
              }

              // Third try: Turndown Ã¢â€ â€™ Gemini on rendered content
              const md = htmlToMarkdown(contentHtml, { focusSection: true });
              if (md.length > 100) {
                const aiResult = await structureWithAIClient(md, { title: cleanTitle(title), sourceUrl: url });
                if (aiResult) return { ...aiResult, link: url, _extractedVia: 'wp-rest-ai' };
              }
            }

            // Strategy 1b: WP Recipe Maker plugin JSON (if post has WPRM recipe)
            const postId = post.id;
            if (postId) {
              const wprmUrl = `${origin}/wp-json/wprm/v1/recipe/${postId}`;
              try {
                const ctrl2 = new AbortController();
                const t2 = setTimeout(() => ctrl2.abort(), 4000);
                const r2 = await fetch(wprmUrl, { signal: ctrl2.signal });
                clearTimeout(t2);
                if (r2.ok) {
                  const wprm = await r2.json();
                  if (wprm && (wprm.ingredients?.length > 0 || wprm.instructions?.length > 0)) {
                    console.log(`[endpoint-nudge] WPRM API hit for post ${postId}`);
                    return normalizeWprmApiResponse(wprm, url);
                  }
                }
              } catch { /* WPRM not installed or endpoint blocked */ }
            }
          }
        }
      } catch { /* WP REST API not available or CORS blocked */ }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Strategy 2: Generic JSON suffix Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // Some sites (Ghost, Craft CMS, some headless setups) serve JSON at ?format=json
    const jsonSuffixUrls = [
      `${url}${url.includes('?') ? '&' : '?'}format=json`,
      `${url}.json`,
    ];
    for (const jsonUrl of jsonSuffixUrls) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(jsonUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok && resp.headers.get('content-type')?.includes('json')) {
          const data = await resp.json();
          // Ghost CMS: { posts: [{ title, html, feature_image }] }
          if (data?.posts?.[0]) {
            const post = data.posts[0];
            const md = htmlToMarkdown(post.html || '', { focusSection: false });
            if (md.length > 100) {
              const aiResult = await structureWithAIClient(md, {
                title: cleanTitle(post.title || ''),
                imageUrl: post.feature_image || '',
                sourceUrl: url,
              });
              if (aiResult) return { ...aiResult, link: url, _extractedVia: 'json-suffix-ghost' };
            }
          }
          // Recipe JSON-LD directly in JSON response
          if (data?.['@type'] === 'Recipe' || data?.recipeIngredient) {
            const recipe = parseRecipeNode(data);
            if (recipe) return { ...recipe, link: url, _extractedVia: 'json-suffix-ld' };
          }
        }
      } catch { /* endpoint doesn't exist or not JSON */ }
    }
  } catch (e) {
    console.log(`[endpoint-nudge] Error: ${e.message}`);
  }

  return null;
}

/**
 * Normalize a WP Recipe Maker API response to SpiceHub recipe format.
 * WPRM API returns: { name, ingredients: [{...}], instructions: [{...}], image_url }
 */
function normalizeWprmApiResponse(wprm, sourceUrl) {
  const name = cleanTitle(wprm.name || wprm.recipe_name || 'Imported Recipe');

  // WPRM ingredients: [{ amount, unit: {name}, name, notes }]
  const ingredients = (wprm.ingredients || [])
    .flatMap(group => (group.ingredients || [group]))
    .map(ing => {
      const parts = [ing.amount, ing.unit?.name, ing.name, ing.notes ? `(${ing.notes})` : ''].filter(Boolean);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);

  // WPRM instructions: [{ text }] or [{ instructions: [{ text }] }]
  const directions = (wprm.instructions || [])
    .flatMap(group => (group.instructions || [group]))
    .map(step => (step.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const imageUrl = wprm.image_url || wprm.image?.url || '';

  return {
    name,
    ingredients: ingredients.length > 0 ? ingredients : [],
    directions: directions.length > 0 ? directions : [],
    imageUrl,
    link: sourceUrl,
    _extractedVia: 'wprm-api',
  };
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// SCRAPER TIER 1: TURNDOWN Ã¢â€ â€™ GEMINI BLOG PIPELINE
// Convert full blog HTML to clean Markdown via Turndown, then structure with AI.
// Better than raw text stripping: preserves list structure, numbered steps,
// and section headings that guide Gemini to correct ingredient/direction split.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Convert fetched HTML to Markdown and structure via Gemini.
 * Called as a final fallback when JSON-LD, microdata, CSS patterns, and server
 * extraction all fail. Requires VITE_GOOGLE_AI_KEY.
 *
 * @param {string} html - Raw HTML from CORS proxy
 * @param {string} sourceUrl - Original URL (for link and title extraction)
 * @returns {object|null} Recipe object or null
 */
async function tryMarkdownExtraction(html, sourceUrl, { type = 'meal' } = {}) {
  if (!html || html.length < 200) return null;
  if (!htmlLooksLikeRecipe(html)) {
    console.log('[md-extract] HTML does not look like a recipe Ã¢â‚¬â€ skipping Turndown pipeline');
    return null;
  }

  try {
    const titleHint = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || '';
    const imageUrl = extractMeta(html, 'og:image') || '';

    // Convert to Markdown Ã¢â‚¬â€ this is the key improvement over plain text stripping
    const markdown = htmlToMarkdown(html, { focusSection: true, maxChars: 7000 });
    if (!markdown || markdown.length < 100) {
      console.log('[md-extract] Turndown produced empty/tiny output');
      return null;
    }

    console.log(`[md-extract] Turndown Ã¢â€ â€™ ${markdown.length} chars of Markdown Ã¢â‚¬â€ sending to Gemini`);

    const aiResult = await structureWithAIClient(markdown, {
      title: cleanTitle(titleHint),
      imageUrl,
      sourceUrl,
      type,
    });

    if (!aiResult) return null;

    const hasContent =
      aiResult.ingredients?.some(i => !/^see (original|recipe)/i.test(i)) ||
      aiResult.directions?.some(d => !/^see (original|recipe)/i.test(d));

    if (!hasContent) return null;

    console.log(`[md-extract] Turndown+Gemini success Ã¢â‚¬â€ ${aiResult.ingredients?.length} ing, ${aiResult.directions?.length} dir`);
    return { ...aiResult, link: sourceUrl, _extractedVia: 'turndown-gemini' };
  } catch (e) {
    console.log(`[md-extract] Error: ${e.message}`);
    return null;
  }
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// SCRAPER TIER 2: REDDIT JSON RECIPE STRUCTURING
// Parse Reddit selftext (already Markdown) through our caption parser + Gemini.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Given rawText from a Reddit post (already in Markdown), structure it into
 * a full recipe object using parseCaption + Gemini fallback.
 *
 * @param {object} redditData - Result from tryRedditJson()
 * @param {function} [onProgress]
 * @returns {object|null}
 */
async function structureRedditRecipe(redditData, onProgress) {
  if (!redditData || !redditData.rawText) return null;

  const { rawText, name: rawName, imageUrl, link } = redditData;
  const title = cleanTitle(rawName || '');

  if (onProgress) onProgress('Structuring Reddit recipe...');

  // Reddit selftext is Markdown Ã¢â‚¬â€ parseCaption handles it well
  // (lists become bullet lines, numbered steps are detected by STEP_NUM_RE)
  const parsed = parseCaption(rawText);

  const hasContent =
    (parsed.ingredients?.length > 0) ||
    (parsed.directions?.length > 0);

  if (hasContent) {
    return {
      name: parsed.title || title || 'Reddit Recipe',
      ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
      directions: parsed.directions.length > 0 ? parsed.directions : [],
      imageUrl: imageUrl || '',
      link: link || '',
      _extractedVia: 'reddit-heuristic',
    };
  }

  // Heuristic failed Ã¢â‚¬â€ try Gemini
  if (onProgress) onProgress('Using AI to structure Reddit recipe...');
  const aiResult = await structureWithAIClient(rawText, { title, imageUrl, sourceUrl: link });
  if (aiResult) {
    return { ...aiResult, link, _extractedVia: 'reddit-ai' };
  }

  return null;
}

/**
 * Main entry: parse recipe from a URL.
 * Mealie-inspired unified pipeline Ã¢â‚¬â€ tries multiple strategies automatically.
 *
 * Strategy (in order):
 *   0. Reddit URLs Ã¢â€ â€™ .json endpoint (zero-auth, no scraping)
 *   1. Instagram URLs Ã¢â€ â€™ embed extraction, then server (yt-dlp + Chrome)
 *   2. Video/Social URLs Ã¢â€ â€™ server (yt-dlp metadata + subtitles), then CORS proxy
 *   3. Recipe blogs Ã¢â€ â€™ CORS proxy + JSON-LD / endpoint nudging / microdata /
 *      CSS heuristics / Turndown+Gemini
 *   4. All strategies exhausted Ã¢â€ â€™ guide user to Paste Text
 *
 * @param {string} url - The URL to import from
 * @param {function} onProgress - Optional callback for progress updates
 * Returns { name, ingredients, directions, link, imageUrl }
 *      or { _error: true, reason } on failure
 *      or null if completely failed
 */
export async function parseFromUrl(url, onProgress, { type = 'meal' } = {}) {
  // Backwards compatibility alias
  return await importRecipeFromUrl(url, onProgress, { type });
}

export async function importRecipeFromUrl(url, onProgress, { type = 'meal', signal: callerSignal } = {}) {

  // ── Phase 1: global abort + 45s budget ──────────────────────────────────────
  // Compose any caller signal (the Cancel button) with a self-clearing 45s
  // timeout budget. Downstream calls that accept { signal } abort immediately;
  // for stages that don't, we poll isAborted(signal) at each boundary so a
  // cancel/timeout is still honored between awaits and we resolve to a
  // structured { _error, reason } rather than hanging.
  const signal = composeSignals(callerSignal, AbortSignal.timeout(GLOBAL_IMPORT_TIMEOUT_MS));
  const _bail = () => ({ _error: true, reason: (callerSignal && callerSignal.aborted) ? 'aborted' : 'timeout' });
  if (isAborted(signal)) return _bail();

  // Ã¢â€â‚¬Ã¢â€â‚¬ 0. Reddit: zero-auth JSON endpoint (fastest non-Instagram path) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Reddit's .json trick gives structured post data with no scraping, no auth,
  // and no CORS proxy needed. Always try this first for reddit.com URLs.
  if (isRedditUrl(url)) {
    console.log('[SpiceHub] Reddit URL Ã¢â‚¬â€ trying .json API...');
    if (onProgress) onProgress('Fetching Reddit post via JSON API...');

    const redditData = await tryRedditJson(url, onProgress);

    if (redditData) {
      // Special case: link post pointing to external recipe site
      if (redditData._isRedirectToExternal && redditData.externalUrl) {
        console.log(`[SpiceHub] Reddit link post Ã¢â‚¬â€ redirecting to: ${redditData.externalUrl}`);
        if (onProgress) onProgress('Following Reddit link to recipe site...');
        // Recursively parse the external URL (without Reddit wrapper)
        const externalRecipe = await parseFromUrl(redditData.externalUrl, onProgress);
        if (externalRecipe && !externalRecipe._error) {
          // Attach Reddit metadata
          return {
            ...externalRecipe,
            link: redditData.link || url,
            _redditTitle: redditData.name,
            _extractedVia: (externalRecipe._extractedVia || 'external') + '+reddit-link',
          };
        }
      }

      // Text post with recipe content Ã¢â‚¬â€ structure it
      const structured = await structureRedditRecipe(redditData, onProgress);
      if (structured && (structured.ingredients?.length > 0 || structured.directions?.length > 0)) {
        return structured;
      }
    }

    // Reddit extraction failed Ã¢â‚¬â€ fall through to CORS proxy as final fallback
    console.log('[SpiceHub] Reddit JSON API failed Ã¢â‚¬â€ trying CORS proxy fallback');
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 1. Instagram: try embed first, then Agent extraction Ã¢â€â‚¬Ã¢â€â‚¬
  if (isInstagramUrl(url)) {
    if (isAborted(signal)) return _bail();
    console.log('[SpiceHub] Instagram URL Ã¢â‚¬â€ trying embed extraction...');
    if (onProgress) onProgress('Trying Instagram embed extraction...');

    const instagramRecipe = await importFromInstagram(url, (phaseOrMsg, status, msg) => {
      if (!onProgress) return;
      onProgress(typeof msg === 'string' ? msg : String(phaseOrMsg || 'Importing Instagram post...'));
    }, { type, signal });
    if (instagramRecipe && !instagramRecipe._needsManualCaption && !instagramRecipe._error) {
      return instagramRecipe;
    }
    if (isAborted(signal)) return _bail();

    // Instagram all paths failed Ã¢â‚¬â€ route to BrowserAssist
    console.log('[SpiceHub] Instagram extraction failed Ã¢â‚¬â€ routing to BrowserAssist');
    return { _needsBrowserAssist: true, url, type };
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 2. Video/Social URLs: try Agent extraction, then yt-dlp, then CORS proxy Ã¢â€â‚¬Ã¢â€â‚¬
  if (isSocialMediaUrl(url)) {
    if (isAborted(signal)) return _bail();
    console.log('[SpiceHub] Social/video URL Ã¢â‚¬â€ trying extraction pipeline...');

    const videoRecipe = await tryVideoExtraction(url, onProgress, { type, signal });
    if (videoRecipe && !videoRecipe._error && hasRecipeContent(videoRecipe)) return videoRecipe;

    // Fallback: CORS proxy (sometimes works for public pages)
    if (onProgress) onProgress('Trying direct extraction...');
    try {
      let html = await fetchHtmlViaProxyFromApi(url);
      // Detect redirect pages (CORS proxy may return redirect HTML instead of following)
      if (html && (
        /^\s*<!DOCTYPE[^>]*>\s*<html[^>]*>\s*<head[^>]*>\s*<meta[^>]+refresh[^>]+url=/i.test(html) ||
        /<body[^>]*>\s*(?:Redirecting|Moved|Location:)/i.test(html) ||
        html.length < 2000 && /window\.location\s*=/.test(html)
      )) {
        html = null;
      }
      if (html) {
        const recipe = parseHtml(html, url);
        if (recipe) return recipe;
      }
    } catch {
      console.log('[SpiceHub] Social media CORS proxy failed');
    }

    // Last resort (Phase 6, opt-in): spoken-recipe transcription for video-only
    // posts. No-op unless VITE_ASR_ENDPOINT is configured.
    if (!isAborted(signal)) {
      const asrRecipe = await transcribeViaASR(url, { type, signal });
      if (asrRecipe && hasRecipeContent(asrRecipe)) return asrRecipe;
    }
    if (isAborted(signal)) return _bail();

    return { _error: true, reason: 'social-fetch-failed', platform: getSocialPlatform(url) };
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 3. Recipe blogs: multi-tier pipeline Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //    3a. CORS proxy + JSON-LD / microdata / CSS heuristics (fast, reliable)
  //    3b. Endpoint nudging (WordPress REST API, WP Recipe Maker API)
  //    3c. Server-side extraction (yt-dlp, headless Chrome)
  //    3d. Turndown Ã¢â€ â€™ Gemini (HTML Ã¢â€ â€™ clean Markdown Ã¢â€ â€™ AI structuring)
  //    3e. Raw text Ã¢â€ â€™ Gemini (legacy fallback, coarser than Turndown)

  console.log('[SpiceHub] Fetching recipe via CORS proxy...');
  if (onProgress) onProgress('Extracting recipe from page...');

  let fetchedHtml = null; // Keep a reference to avoid double-fetching in later steps

  try {
    let html = await fetchHtmlViaProxyFromApi(url);
    // Detect redirect pages (CORS proxy may return redirect HTML instead of following)
    if (html && (
      /^\s*<!DOCTYPE[^>]*>\s*<html[^>]*>\s*<head[^>]*>\s*<meta[^>]+refresh[^>]+url=/i.test(html) ||
      /<body[^>]*>\s*(?:Redirecting|Moved|Location:)/i.test(html) ||
      html.length < 2000 && /window\.location\s*=/.test(html)
    )) {
      html = null;
    }
    if (html) {
      fetchedHtml = html;
      // 3a: Standard JSON-LD / microdata / CSS extraction
      const recipe = parseHtml(html, url);
      if (recipe) return recipe;
    }
  } catch (e) {
    console.log('[SpiceHub] CORS proxy failed:', e.message);
  }

  // 3b: Endpoint nudging Ã¢â‚¬â€ try WP REST API, WPRM API, JSON suffix
  // Only run if we have HTML (to extract slug) or can construct the API URL from the URL itself
  if (onProgress) onProgress('Checking for structured data endpoints...');
  const nudgedResult = await tryEndpointNudging(url, fetchedHtml);
  if (nudgedResult) {
    console.log(`[SpiceHub] Endpoint nudging succeeded via: ${nudgedResult._extractedVia}`);
    return nudgedResult;
  }

  // 3c: Server-side extraction (yt-dlp + headless Chrome)
  if (onProgress) onProgress('Trying server-side extraction...');
  const serverResult = await tryServerExtraction(url, onProgress);
  if (serverResult && !serverResult._error) return serverResult;

  // 3d: Turndown Ã¢â€ â€™ Gemini Ã¢â‚¬â€ better than raw text stripping
  // Uses the HTML we already fetched (or refetches if needed)
  if (onProgress) onProgress('Trying AI extraction with Markdown conversion...');
  const htmlForTurndown = fetchedHtml || await fetchHtmlViaProxyFromApi(url, 20000).catch(() => null);
  if (htmlForTurndown) {
    fetchedHtml = htmlForTurndown; // Cache for step 3e if needed
    const turndownResult = await tryMarkdownExtraction(htmlForTurndown, url, { type });
    if (turndownResult) return turndownResult;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 4. Gemini AI fallback (legacy raw-text path) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Kept as a last resort; Turndown pipeline above is better but may not always
  // have access to the fetched HTML (e.g. all proxies timed out on both attempts).
  if (onProgress) onProgress('Trying AI extraction...');
  try {
    const html2 = fetchedHtml || await fetchHtmlViaProxyFromApi(url, 20000).catch(() => null);
    if (html2 && html2.length > 500) {
      // Extract only meaningful text (no scripts/styles) for the AI prompt
      const pageText = html2
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\s{3,}/g, '\n')
        .trim()
        .slice(0, 6000);

      if (pageText.length > 200) {
        const titleHint = extractMeta(html2, 'og:title') || '';
        const imageUrl = extractMeta(html2, 'og:image') || '';
        const aiRecipe = await structureWithAIClient(pageText, { title: titleHint, imageUrl, sourceUrl: url, type });
        if (aiRecipe) {
          const hasContent = (aiRecipe.ingredients?.length > 0 && !aiRecipe.ingredients[0].includes('See original')) ||
                            (aiRecipe.directions?.length > 0 && !aiRecipe.directions[0].includes('See original'));
          if (hasContent) {
            console.log('[SpiceHub] AI extraction succeeded for ' + url);
            return { ...aiRecipe, link: url, _extractedVia: 'gemini-ai' };
          }
        }
      }
    }
  } catch (e) {
    console.log('[SpiceHub] AI fallback failed:', e.message);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 5. All methods exhausted Ã¢â€â‚¬Ã¢â€â‚¬
  return null;
}

/**
 * Parse recipe from raw HTML.
 * Multi-pass strategy (mirrors Paprika 3):
 *   1. JSON-LD structured data
 *   2. Microdata (Schema.org itemscope)
 *   3. Heuristic CSS class matching
 *   4. OG meta tags fallback
 */
export function parseHtml(html, sourceUrl) {
  // Aggressive image extraction Ã¢â‚¬â€ tries every known source, returns first non-empty.
  // Order: caller-provided Ã¢â€ â€™ JSON-LD (via selectBestImage) Ã¢â€ â€™ og:image Ã¢â€ â€™ twitter:image
  //        Ã¢â€ â€™ schema itemprop="image" Ã¢â€ â€™ video poster Ã¢â€ â€™ largest recipe-context <img>.
  // Designed so "recipe blogs missing the main image" becomes nearly impossible.
  const _pickImage = (...preferred) => {
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
    // Last resort: first reasonably-large <img> with "recipe" in alt/class/src.
    const imgRe = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(html)) !== null) {
      const tag = m[0];
      const src = m[1];
      if (!src || src.startsWith('data:') || /\.(svg|gif)(\?|$)/i.test(src)) continue;
      if (/(recipe|food|dish|hero|wp-post-image|featured)/i.test(tag)) return src;
    }
    return '';
  };

  // 1. JSON-LD (best, most reliable)
  // IMPORTANT: Only accept if it has at least a title + some content (ingredients OR directions).
  // Many sites have a Recipe JSON-LD schema stub with empty arrays Ã¢â‚¬â€ falling through lets CSS
  // extraction (WPRM, Tasty, Feast, Mediavine Create, etc.) find the actual content.
  const [jsonLdRecipe] = findJsonLdRecipes(html);
  if (jsonLdRecipe) {
    const hasContent = jsonLdRecipe.ingredients?.length > 0 || jsonLdRecipe.directions?.length > 0;
    if (hasContent) {
      // Always reinforce imageUrl with aggressive fallbacks Ã¢â‚¬â€ many JSON-LD stubs lack an image.
      return { ...jsonLdRecipe, link: sourceUrl, imageUrl: _pickImage(jsonLdRecipe.imageUrl) };
    }
    // Has a name but no content Ã¢â‚¬â€ continue to CSS/microdata for the actual recipe data.
    // We'll merge the JSON-LD name/image back in at the end if CSS finds content.
    console.log('[SpiceHub] JSON-LD Recipe found but empty content Ã¢â‚¬â€ falling through to CSS extraction');
  }

  // 2. Microdata (itemprop/itemtype)
  const microdataRecipe = extractMicrodataFromHtml(html);
  if (microdataRecipe) {
    // Merge in JSON-LD title/image if better
    const name = (jsonLdRecipe?.name && !microdataRecipe.name) ? jsonLdRecipe.name : microdataRecipe.name;
    const imageUrl = _pickImage(microdataRecipe.imageUrl, jsonLdRecipe?.imageUrl);
    return { ...microdataRecipe, name, imageUrl, link: sourceUrl };
  }

  // 3. Heuristic CSS class matching (WPRM, Tasty, Feast, Mediavine Create, etc.)
  const heuristicRecipe = extractRecipeByCSS(html);
  if (heuristicRecipe) {
    // Merge JSON-LD title/image if CSS didn't find them
    const name = heuristicRecipe.name || jsonLdRecipe?.name || '';
    const imageUrl = _pickImage(heuristicRecipe.imageUrl, jsonLdRecipe?.imageUrl);
    return { ...heuristicRecipe, name, imageUrl, link: sourceUrl };
  }

  // 4. Meta tags fallback
  let title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  let description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description');
  let imageUrl = _pickImage();

  if (!title) return null;
  title = cleanTitle(title);

  // Strip social media prefix from description
  description = stripSocialMetaPrefix(description || '');

  let ingredients = [];
  let directions = [];

  if (description) {
    const parsed = parseCaption(description);
    if (parsed.ingredients.length > 0) ingredients = parsed.ingredients;
    if (parsed.directions.length > 0) directions = parsed.directions;
    if (parsed.title) title = parsed.title;
  }

  return { name: title, ingredients, directions, link: sourceUrl, imageUrl };
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Client-side Microdata extraction Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function extractMicrodataFromHtml(html) {
  if (!html.includes('schema.org/Recipe')) return null;

  const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Name
  const nameRe = /<[^>]*itemprop\s*=\s*["']name["'][^>]*>([^<]+)/i;
  const nameM = nameRe.exec(html);
  const name = nameM ? decodeHtml(nameM[1].trim()) : '';
  if (!name) return null;

  // Ingredients
  const ingredients = [];
  const ingRe = /<[^>]*itemprop\s*=\s*["']recipeIngredient["'][^>]*>([\s\S]*?)<\/(?:li|span|div|p)>/gi;
  let m;
  while ((m = ingRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 2) ingredients.push(text);
  }

  // Instructions
  const directions = [];
  const instRe = /<[^>]*itemprop\s*=\s*["']recipeInstructions["'][^>]*>([\s\S]*?)<\/(?:li|div|ol|section)>/gi;
  while ((m = instRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 5) directions.push(text);
  }

  if (ingredients.length === 0 && directions.length === 0) return null;

  const imageUrl = extractMeta(html, 'og:image') || '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl,
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Client-side heuristic CSS class extraction Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function extractRecipeByCSS(html) {
  const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Look for popular recipe plugin patterns
  // WPRM, Tasty, Mediavine Create, Feast Plugin, AdThrive, NYT Cooking, Allrecipes, etc.
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

  // Get title from recipe plugin or OG
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Extract recipe from DOM (used by BrowserAssist for visible page content) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
/**
 * Extract recipe from visible DOM content (text + image URLs).
 * Called by BrowserAssist when user clicks "Extract Recipe" button on visible page.
 * Tries: parseCaption() first, then heuristic line classification.
 * Returns recipe object or null if nothing found.
 */
export function extractRecipeFromDOM(visibleText, imageUrls = [], sourceUrl = '') {
  if (!visibleText || visibleText.trim().length < 10) return null;

  // First try parseCaption to split ingredients/directions
  let parsed = parseCaption(visibleText);
  let name = parsed.title || 'Imported Recipe';
  let ingredients = parsed.ingredients;
  let directions = parsed.directions;

  // If parseCaption didn't find clear structure, use heuristic classification
  if (ingredients.length === 0 && directions.length === 0) {
    const lines = visibleText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length > 0) {
      const classified = { ingredients: [], directions: [] };
      classifyDOMLines(lines, classified);
      ingredients = classified.ingredients;
      directions = classified.directions;
    }
  }

  // If still nothing found, put all text in directions
  if (ingredients.length === 0 && directions.length === 0) {
    const lines = visibleText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length > 0) {
      directions = lines;
    } else {
      return null;
    }
  }

  // Pick best image from available URLs
  let imageUrl = '';
  if (imageUrls && imageUrls.length > 0) {
    imageUrl = imageUrls[0];
  }

  return {
    name: cleanTitle(name),
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    imageUrl,
    link: sourceUrl,
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper: Classify DOM lines into ingredients vs directions Ã¢â€â‚¬Ã¢â€â‚¬
// Mutates recipe.ingredients and recipe.directions in place.
function classifyDOMLines(lines, recipe) {
  // Measurement units that strongly indicate ingredients
  const UNIT_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|cloves?|cans?|packages?|sticks?|slices?|bunch)\b/i;
  // Fractions at start of line strongly indicate ingredients
  const STARTS_WITH_NUM = /^[\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾]/;
  // Cooking action verbs strongly indicate directions
  const COOKING_VERB = COOKING_VERBS_RE;
  // Numbered step at start
  const STEP_NUM = /^\d+[.):\s-]\s*/;

  let inIngredients = false;
  let inDirections = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section headers
    const lower = trimmed.toLowerCase();
    if (/^ingredients?:?\s*$/i.test(lower) || lower === 'you will need' || lower === "what you'll need") {
      inIngredients = true;
      inDirections = false;
      continue;
    }
    if (/^(directions?|instructions?|method|steps?|preparation):?\s*$/i.test(lower)) {
      inIngredients = false;
      inDirections = true;
      continue;
    }

    // If we're in a detected section, use that
    if (inIngredients) {
      recipe.ingredients.push(trimmed);
      continue;
    }
    if (inDirections) {
      recipe.directions.push(trimmed);
      continue;
    }

    // Heuristic classification
    const hasUnit = UNIT_RE.test(trimmed);
    const startsWithNum = STARTS_WITH_NUM.test(trimmed);
    const hasCookingVerb = COOKING_VERB.test(trimmed);
    const hasStepNum = STEP_NUM.test(trimmed);
    const isShort = trimmed.length < 50;

    // Strong ingredient signals
    if ((startsWithNum && hasUnit) || (isShort && hasUnit && !hasCookingVerb)) {
      recipe.ingredients.push(trimmed);
    }
    // Strong direction signals
    else if (hasCookingVerb || hasStepNum || trimmed.length > 80) {
      recipe.directions.push(trimmed);
    }
    // Moderate: starts with number + short = ingredient
    else if (startsWithNum && isShort) {
      recipe.ingredients.push(trimmed);
    }
    // Default: longer lines are more likely directions
    else if (trimmed.length > 40) {
      recipe.directions.push(trimmed);
    }
    // Short lines without clear signal Ã¢â‚¬â€ guess ingredient
    else {
      recipe.ingredients.push(trimmed);
    }
  }

}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// ENHANCED RECIPE EXTRACTION FUNCTIONS (Production-Ready)
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Detect recipe plugins and structured markup in DOM/HTML content.
 *
 * Recognizes:
 *   - WPRM (WP Recipe Maker) Ã¢â‚¬â€ .wprm-recipe, data-json
 *   - Tasty Recipes Ã¢â‚¬â€ .tasty-recipes, schema.org JSON-LD
 *   - EasyRecipe Ã¢â‚¬â€ .EasyRecipeType
 *   - Schema.org Recipe Ã¢â‚¬â€ JSON-LD @type: Recipe
 *   - Semantic HTML Ã¢â‚¬â€ <article>, <section> with microdata/aria labels
 *   - Common CSS patterns Ã¢â‚¬â€ recipe-ingredient, recipe-instruction, etc.
 *
 * Returns: { type, title, ingredients, directions, imageUrl, meta }
 *   type: 'wprm' | 'tasty' | 'easyrecipe' | 'jsonld' | 'semantic' | null
 *   Each returns normalized { title, ingredients: [...], directions: [...], imageUrl }
 */
export function detectRecipePlugins(domOrHtml) {
  // Support both DOM Document and HTML string
  let doc = domOrHtml;
  if (typeof domOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(domOrHtml, 'text/html');
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ WPRM (WP Recipe Maker) Detection Ã¢â€â‚¬Ã¢â€â‚¬
  const wprmContainer = doc.querySelector('.wprm-recipe, [data-wprm-recipe]');
  if (wprmContainer) {
    const result = extractWPRM(wprmContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'wprm', ...result };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Tasty Recipes Detection Ã¢â€â‚¬Ã¢â€â‚¬
  const tastyContainer = doc.querySelector('.tasty-recipes, [data-tasty-recipe]');
  if (tastyContainer) {
    const result = extractTastyRecipes(tastyContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'tasty', ...result };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ EasyRecipe Detection Ã¢â€â‚¬Ã¢â€â‚¬
  const easyRecipeContainer = doc.querySelector('.EasyRecipeType, [itemtype*="Recipe"]');
  if (easyRecipeContainer) {
    const result = extractEasyRecipe(easyRecipeContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'easyrecipe', ...result };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ JSON-LD Recipe Detection (Schema.org) Ã¢â€â‚¬Ã¢â€â‚¬
  const jsonldResult = extractJsonLdRecipe(doc);
  if (jsonldResult.ingredients.length > 0 || jsonldResult.directions.length > 0) {
    return { type: 'jsonld', ...jsonldResult };
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Semantic HTML + Microdata Detection Ã¢â€â‚¬Ã¢â€â‚¬
  const semanticResult = extractSemanticRecipe(doc);
  if (semanticResult.ingredients.length > 0 || semanticResult.directions.length > 0) {
    return { type: 'semantic', ...semanticResult };
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Common CSS pattern detection Ã¢â€â‚¬Ã¢â€â‚¬
  const cssResult = extractByCommonPatterns(doc);
  if (cssResult.ingredients.length > 0 || cssResult.directions.length > 0) {
    return { type: 'css-patterns', ...cssResult };
  }

  // No recognized plugin found
  return { type: null, title: '', ingredients: [], directions: [], imageUrl: '' };
}

/**
 * Extract recipe from WPRM (WP Recipe Maker) markup.
 * WPRM stores recipe data in data-wprm-recipe JSON attributes and semantic HTML.
 */
function extractWPRM(container) {
  const title = container.querySelector('.wprm-recipe-name, h2.wprm-recipe-name, [itemprop="name"]')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Extract ingredients from list items with proper class patterns
  for (const item of container.querySelectorAll('.wprm-recipe-ingredient, li[itemprop="recipeIngredient"]')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Extract directions from numbered steps
  for (const item of container.querySelectorAll('.wprm-recipe-instruction, li[itemprop="recipeInstructions"]')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Try to find image
  const imgEl = container.querySelector('img[itemprop="image"], .wprm-recipe-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from Tasty Recipes markup.
 * Tasty Recipes uses semantic HTML with microdata and CSS classes.
 */
function extractTastyRecipes(container) {
  const title = container.querySelector('h1[itemprop="name"], .tasty-recipes-title')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Tasty Recipes uses structured list items
  for (const item of container.querySelectorAll('[itemprop="recipeIngredient"], .tasty-recipe-ingredient')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Instructions are in divs/spans with itemprop
  for (const item of container.querySelectorAll('[itemprop="recipeInstructions"], .tasty-recipe-instructions li')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Try to find recipe image
  const imgEl = container.querySelector('img[itemprop="image"], .tasty-recipes-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from EasyRecipe markup (microdata based).
 * Uses schema.org itemtype and itemprop attributes.
 */
function extractEasyRecipe(container) {
  const title = container.querySelector('[itemprop="name"]')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // EasyRecipe wraps ingredients in divs with itemprop
  for (const item of container.querySelectorAll('[itemprop="recipeIngredient"], .ingredient')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Instructions are in itemprop="recipeInstructions" or similar
  for (const item of container.querySelectorAll('[itemprop="recipeInstructions"], .recipe-instructions li')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Image extraction
  const imgEl = container.querySelector('[itemprop="image"]');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || imgEl.getAttribute('content') || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from JSON-LD structured data (Schema.org Recipe type).
 * Searches for <script type="application/ld+json"> with @type: Recipe.
 */
function extractJsonLdRecipe(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const recipe = findRecipeInJson(data);
      if (recipe) {
        const result = normalizeJsonLdRecipe(recipe);
        if (result.ingredients.length > 0 || result.directions.length > 0) {
          return result;
        }
      }
    } catch { /* not valid JSON, skip */ }
  }

  return { title: '', ingredients: [], directions: [], imageUrl: '' };
}

/**
 * Recursively find Recipe object in JSON-LD data structure.
 * Handles nested @graph and arrays.
 */
function findRecipeInJson(obj) {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findRecipeInJson(item);
      if (found) return found;
    }
    return null;
  }

  // @type can be a string or an array (e.g. ["Recipe","NewsArticle"])
  const rawType = obj['@type'] || '';
  const typeStr = (Array.isArray(rawType) ? rawType.join(',') : rawType.toString()).toLowerCase();
  if (typeStr.includes('recipe')) return obj;

  if (obj['@graph']) {
    return findRecipeInJson(obj['@graph']);
  }

  return null;
}

/**
 * Normalize JSON-LD Recipe to standard format.
 * Handles various field names and structures.
 */
function normalizeJsonLdRecipe(recipe) {
  const title = recipe.name || recipe.title || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = selectBestImage(recipe.image) || '';

  // Ingredients can be string array or objects with @type: RecipeIngredient
  if (recipe.recipeIngredient) {
    if (Array.isArray(recipe.recipeIngredient)) {
      for (const ing of recipe.recipeIngredient) {
        if (typeof ing === 'string') {
          ingredients.push(ing);
        } else if (ing.text) {
          ingredients.push(ing.text);
        }
      }
    }
  }

  // Instructions: string | HowToStep | HowToSection (wraps itemListElement of HowToStep)
  // AllRecipes often uses HowToSection > itemListElement > HowToStep pattern.
  function flattenInstruction(instr) {
    if (!instr) return;
    if (typeof instr === 'string') {
      const s = instr.trim();
      if (s) directions.push(s);
      return;
    }
    if (typeof instr !== 'object') return;
    // HowToStep / RecipeStep Ã¢â‚¬â€ direct text
    if (instr.text) {
      directions.push(instr.text.trim());
      return;
    }
    // HowToSection Ã¢â‚¬â€ recurse into itemListElement
    if (instr.itemListElement && Array.isArray(instr.itemListElement)) {
      for (const item of instr.itemListElement) flattenInstruction(item);
      return;
    }
    // ItemList (less common)
    if (instr['@type']?.toString().toLowerCase().includes('itemlist') && Array.isArray(instr.item)) {
      for (const item of instr.item) flattenInstruction(item);
    }
  }

  if (recipe.recipeInstructions) {
    const instrs = Array.isArray(recipe.recipeInstructions)
      ? recipe.recipeInstructions
      : [recipe.recipeInstructions];
    for (const instr of instrs) flattenInstruction(instr);
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe using semantic HTML structure.
 * Looks for <article>, <section> with aria-labels and semantic markup.
 */
function extractSemanticRecipe(doc) {
  const title = '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Find semantic containers for recipe sections
  const ingSection = doc.querySelector(
    'section[aria-label*="ingredient" i], section[aria-label*="ingredient" i], ' +
    'div[aria-label*="ingredient" i], .ingredients-section'
  );

  const dirSection = doc.querySelector(
    'section[aria-label*="instruction" i], section[aria-label*="direction" i], ' +
    'div[aria-label*="instruction" i], .directions-section'
  );

  // Extract ingredients from semantic container
  if (ingSection) {
    for (const item of ingSection.querySelectorAll('li, div[role="listitem"], p')) {
      const text = item.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        ingredients.push(text);
      }
    }
  }

  // Extract directions from semantic container
  if (dirSection) {
    for (const item of dirSection.querySelectorAll('li, div[role="listitem"], p')) {
      const text = item.textContent?.trim();
      if (text && text.length > 2) {
        directions.push(text);
      }
    }
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe by looking for common CSS class and attribute patterns.
 * Useful for non-standard recipe sites with custom markup.
 *
 * Patterns include:
 *   - recipe-ingredient, recipe-ingredient-item, ingredient-*
 *   - recipe-instruction, recipe-direction, recipe-step, instruction-*
 *   - ingredient-name, ingredient-amount, ingredient-unit
 */
function extractByCommonPatterns(doc) {
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Common ingredient selector patterns
  const ingredientSelectors = [
    '.recipe-ingredient',
    '.recipe-ingredient-item',
    '.ingredient-item',
    '[data-ingredient]',
    '.ingredients li',
    '.ingredient-list li',
    '[class*="ingredient"][class*="item"]',
  ];

  const directionSelectors = [
    '.recipe-instruction',
    '.recipe-step',
    '.instruction-item',
    '.recipe-direction',
    '[data-instruction]',
    '.instructions li',
    '.directions li',
    '.steps li',
    '[class*="instruction"][class*="item"]',
    '[class*="step"][class*="item"]',
  ];

  // Extract ingredients
  for (const selector of ingredientSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        ingredients.push(text);
      }
    }
    if (ingredients.length > 0) break; // Stop after finding first pattern
  }

  // Extract directions
  for (const selector of directionSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const text = el.textContent?.trim();
      if (text && text.length > 2) {
        directions.push(text);
      }
    }
    if (directions.length > 0) break; // Stop after finding first pattern
  }

  // Look for recipe image
  const imgEl = doc.querySelector('img[alt*="recipe" i], img[alt*="dish" i], .recipe-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title: '', ingredients, directions, imageUrl };
}

/**
 * Parse a single ingredient line into structured components.
 *
 * Input:  "2 1/2 cups all-purpose flour"
 * Output: { quantity: "2 1/2", unit: "cups", name: "all-purpose flour" }
 *
 * Input:  "3 cloves garlic, minced"
 * Output: { quantity: "3", unit: "cloves", name: "garlic, minced" }
 *
 * Input:  "Salt and pepper to taste"
 * Output: { quantity: null, unit: null, name: "Salt and pepper to taste" }
 */
export function parseIngredientLine(text) {
  if (!text || text.trim().length === 0) {
    return { quantity: null, unit: null, name: '' };
  }

  text = text.trim();

  // Remove bullet points and list markers
  text = text.replace(/^[-Ã¢â‚¬Â¢*Ã¢â€“ÂªÃ¢â€“Â¸Ã¢â€“ÂºÃ¢â€”Â¦Ã¢â‚¬Â£Ã¢ÂÆ’Ã¢Å“â€œÃ¢Å“â€]\s*/, '').trim();

  // Remove numbered list markers (1., 1), 1:) but NOT bare numbers followed by space+unit (quantities)
  text = text.replace(/^\d+[.):-]\s*/, '').trim();

  // Match quantity + unit pattern
  // Quantity: decimal numbers, fractions (1/2, Ã¢â€¦â€œ), unicode fractions
  const quantityUnitPattern = /^([\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾][\d./\s-]*?)\s+(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|pinches|dash|dashes|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|handfuls|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|counts?)\b/i;

  const match = text.match(quantityUnitPattern);
  if (match) {
    const quantity = match[1].trim();
    const unit = match[2].toLowerCase();
    const name = text.substring(match[0].length).trim();

    return {
      quantity: quantity || null,
      unit: unit || null,
      name: name || 'Unknown ingredient',
    };
  }

  // Try to match just quantity (for things like "3 chicken breasts")
  const quantityOnlyPattern = /^([\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾][\d./\s-]*?)\s+/;
  const qMatch = text.match(quantityOnlyPattern);
  if (qMatch) {
    const quantity = qMatch[1].trim();
    // Check if what follows is a food item (heuristic)
    const rest = text.substring(qMatch[0].length).trim();
    if (rest.length > 0 && /^[a-z]/i.test(rest)) {
      return {
        quantity: quantity || null,
        unit: null,
        name: rest,
      };
    }
  }

  // No quantity/unit detected Ã¢â‚¬â€ entire line is ingredient name
  return {
    quantity: null,
    unit: null,
    name: text,
  };
}

/**
 * Smart classification of text lines into ingredients vs directions.
 *
 * Combines multiple signals:
 *   1. CSS/class patterns from DOM elements
 *   2. Content heuristics (cooking verbs, measurements, structure)
 *   3. Section header detection
 *   4. Length and formatting analysis
 *
 * Returns: { ingredients: [...], directions: [...] }
 *   Each string is normalized and trimmed.
 */
export function smartClassifyLines(lines, sourceElement = null) {
  const ingredients = [];
  const directions = [];

  if (!lines || lines.length === 0) {
    return { ingredients, directions };
  }

  // Enhanced patterns with stronger signals
  const STRONG_INGREDIENT_PATTERN = /^([\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾][\d./\s]*\s+)?(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|packages?|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|pieces?)\b/i;

  const DIRECTION_KEYWORD_START = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eÃƒÂ©]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|you'?re? gonna|go ahead|now (?:we|you|I)|take (?:your|the)|grab (?:your|the)|throw|once|when|after|carefully|gently|slowly|continue|allow|until|while)\b/i;

  const NUMBERED_STEP = /^\d+[.):\s-]/;
  const BULLET_POINT = /^[-Ã¢â‚¬Â¢*Ã¢â€“ÂªÃ¢â€“Â¸Ã¢â€“ÂºÃ¢â€”Â¦Ã¢â‚¬Â£Ã¢ÂÆ’]/;

  // Timestamp pattern: "2:30" or "0:00:15" Ã¢â‚¬â€ strip these from lines (common in video descriptions)
  const TIMESTAMP_PREFIX = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-Ã¢â‚¬â€œÃ¢â‚¬â€:.]?\s*/;

  // Filler lines common in video descriptions
  const VIDEO_FILLER_RE = /^(follow me|subscribe|like and subscribe|link in bio|comment below|tag a friend|save this|share this|check out|don't forget|make sure to|music:|song:|audio:|outfit:|shop:|affiliate|#\w+\s*$|@\w+\s*$)/i;

  let inIngredientsSection = false;
  let inDirectionsSection = false;

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Strip timestamp prefixes (e.g. "2:30 Add the garlic" Ã¢â€ â€™ "Add the garlic")
    trimmed = trimmed.replace(TIMESTAMP_PREFIX, '').trim();
    if (!trimmed) continue;

    // Skip video filler lines
    if (VIDEO_FILLER_RE.test(trimmed)) continue;

    // Skip lines that are just hashtags or mentions
    if (/^[#@]/.test(trimmed) && !trimmed.includes(' ')) continue;

    const lower = trimmed.toLowerCase();

    // Check for explicit section headers
    if (/^ingredients?s?:?\s*$|^you will need:?\s*$|^what you need:?\s*$/i.test(lower)) {
      inIngredientsSection = true;
      inDirectionsSection = false;
      continue;
    }

    if (/^(directions?|instructions?|method|steps?|preparation|how to.*):?\s*$/i.test(lower)) {
      inIngredientsSection = false;
      inDirectionsSection = true;
      continue;
    }

    // If we're in a known section, use that classification
    if (inIngredientsSection) {
      ingredients.push(trimmed);
      continue;
    }
    if (inDirectionsSection) {
      directions.push(trimmed);
      continue;
    }

    // Heuristic classification (no explicit section found yet)
    const hasStrongIngredientPattern = STRONG_INGREDIENT_PATTERN.test(trimmed);
    const hasDirectionKeyword = DIRECTION_KEYWORD_START.test(trimmed);
    const hasNumberedStep = NUMBERED_STEP.test(trimmed);
    const hasBulletPoint = BULLET_POINT.test(trimmed);
    const length = trimmed.length;

    // parse-ingredient provides the strongest signal for ingredient lines:
    // it knows fractions, metric, parens, and odd unit forms regex misses.
    // Run it first, but defer to the direction-keyword check so verbs win.
    const ingredientParserMatched = looksLikeIngredientLine(trimmed);

    // Strong signals
    if (ingredientParserMatched && !hasDirectionKeyword && !hasNumberedStep) {
      ingredients.push(trimmed);
    } else if (hasStrongIngredientPattern && !hasDirectionKeyword) {
      ingredients.push(trimmed);
    } else if ((hasNumberedStep || hasDirectionKeyword) && length > 20) {
      directions.push(trimmed);
    } else if (hasBulletPoint && !hasDirectionKeyword && !hasNumberedStep) {
      // Bullets without clear direction signal Ã¢â‚¬â€ likely ingredients
      ingredients.push(trimmed);
    } else if (hasDirectionKeyword) {
      directions.push(trimmed);
    } else if (length > 80 && !FOOD_RE.test(trimmed)) {
      // Very long lines without food words are probably directions
      directions.push(trimmed);
    } else if (length < 50 && FOOD_RE.test(trimmed)) {
      // Short line with food keywords Ã¢â€ â€™ ingredient
      ingredients.push(trimmed);
    } else if (hasNumberedStep) {
      directions.push(trimmed);
    } else if (length > 60 && /[,.]/.test(trimmed) && FOOD_RE.test(trimmed)) {
      // Long line WITH food words and punctuation Ã¢â‚¬â€ could be ingredient list
      ingredients.push(trimmed);
    } else if (length > 60) {
      // Long lines default to directions
      directions.push(trimmed);
    } else {
      // Default: short unknown lines Ã¢â€ â€™ ingredients, long ones Ã¢â€ â€™ directions
      if (length < 45) {
        ingredients.push(trimmed);
      } else {
        directions.push(trimmed);
      }
    }
  }

  return { ingredients, directions };
}

/**
 * Score extraction confidence 0-100.
 * Used to show users how reliable the auto-extraction was.
 */
export function scoreExtractionConfidence(recipe) {
  if (!recipe) return 0;
  let score = 0;
  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];

  // Title quality (0-15)
  if (recipe.name && recipe.name.length > 3 && !/^(recipe|imported|untitled)/i.test(recipe.name)) {
    score += 15;
  } else if (recipe.name && recipe.name.length > 0) {
    score += 5;
  }

  // Ingredient count and quality (0-35)
  const realIngs = ings.filter(i => i && i.trim().length > 2);
  if (realIngs.length >= 5) score += 25;
  else if (realIngs.length >= 3) score += 18;
  else if (realIngs.length >= 1) score += 8;
  // Bonus: ingredients with quantities
  const quantifiedIngs = realIngs.filter(i => /^[\dÃ‚Â½Ã‚Â¼Ã‚Â¾Ã¢â€¦â€œÃ¢â€¦â€Ã¢â€¦â€ºÃ¢â€¦Å“Ã¢â€¦ÂÃ¢â€¦Å¾]/.test(i.trim()));
  if (quantifiedIngs.length >= 3) score += 10;
  else if (quantifiedIngs.length >= 1) score += 5;

  // Direction count and quality (0-35)
  const realDirs = dirs.filter(d => d && d.trim().length > 10);
  if (realDirs.length >= 4) score += 25;
  else if (realDirs.length >= 2) score += 18;
  else if (realDirs.length >= 1) score += 8;
  // Bonus: directions with cooking verbs
  const verbDirs = realDirs.filter(d => COOKING_VERBS_RE.test(d.trim()));
  if (verbDirs.length >= 2) score += 10;
  else if (verbDirs.length >= 1) score += 5;

  // Image (0-10)
  if (recipe.imageUrl && recipe.imageUrl.startsWith('http')) score += 10;

  // Source URL (0-5)
  if (recipe.link && recipe.link.startsWith('http')) score += 5;

  return Math.min(100, score);
}

/**
 * Classify each line with a confidence score and suggested category.
 * Returns array of { text, category: 'ingredient'|'direction'|'skip', confidence: 0-100, reason }
 * Used for inline suggestions in the preview UI.
 */
export function classifyWithConfidence(lines) {
  if (!lines || lines.length === 0) return [];

  return lines.map(rawLine => {
    const line = (typeof rawLine === 'string' ? rawLine : '').trim();
    if (!line || line.length < 2) return { text: line, category: 'skip', confidence: 0, reason: 'empty' };

    // Video filler
    if (/^(follow me|subscribe|like and subscribe|link in bio|comment below|tag a friend|save this|share this|check out|don't forget|make sure to|music:|song:|audio:)/i.test(line)) {
      return { text: line, category: 'skip', confidence: 90, reason: 'social filler' };
    }

    // Strong ingredient signals
    if (NUM_UNIT_RE.test(line)) {
      return { text: line, category: 'ingredient', confidence: 95, reason: 'has quantity + unit' };
    }
    if (FRACTION_RE.test(line) && UNITS_RE.test(line) && line.length < 100) {
      return { text: line, category: 'ingredient', confidence: 90, reason: 'has fraction + unit' };
    }
    if (line.length < 40 && FOOD_RE.test(line) && !COOKING_VERBS_RE.test(line)) {
      return { text: line, category: 'ingredient', confidence: 75, reason: 'short line with food word' };
    }

    // Strong direction signals
    if (STEP_NUM_RE.test(line) && line.length > 15) {
      return { text: line, category: 'direction', confidence: 92, reason: 'numbered step' };
    }
    if (COOKING_VERBS_RE.test(line) && line.length > 20) {
      return { text: line, category: 'direction', confidence: 85, reason: 'starts with cooking verb' };
    }
    if (SPOKEN_DIRECTION_RE.test(line)) {
      return { text: line, category: 'direction', confidence: 80, reason: 'spoken direction pattern' };
    }
    if (/\b(\d+\s*(?:minutes?|mins?|hours?|hrs?))\b/i.test(line) && line.length > 25) {
      return { text: line, category: 'direction', confidence: 78, reason: 'contains time reference' };
    }

    // Ambiguous Ã¢â‚¬â€ use length and food words as tiebreaker
    if (line.length < 45 && FOOD_RE.test(line)) {
      return { text: line, category: 'ingredient', confidence: 55, reason: 'short with food word (uncertain)' };
    }
    if (line.length > 70) {
      return { text: line, category: 'direction', confidence: 50, reason: 'long line (uncertain)' };
    }

    // Default
    return { text: line, category: line.length < 45 ? 'ingredient' : 'direction', confidence: 30, reason: 'default by length' };
  });
}

/**
 * Normalize and deduplicate a list of ingredient or direction strings.
 * Trims whitespace, removes empty lines, deduplicates case-insensitively.
 */
export function normalizeAndDedupe(lines) {
  if (!lines || !Array.isArray(lines)) return [];
  const seen = new Set();
  return lines
    .map(l => (typeof l === 'string' ? l.trim() : ''))
    .filter(l => {
      if (!l || l.length < 2) return false;
      const key = l.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Automatically extract recipe from page content without requiring user interaction.
 *
 * Attempts extraction in order of confidence:
 *   1. Detect recipe plugin markup (WPRM, Tasty Recipes, etc.)
 *   2. Extract JSON-LD structured data
 *   3. Use smart heuristic classification on visible text
 *
 * This is suitable for:
 *   - Server-side processing (render Instagram posts automatically)
 *   - Client-side auto-extraction (without BrowserAssist button)
 *
 * Args:
 *   pageContent - { html, visibleText, imageUrls, sourceUrl }
 *   or just HTML string for backward compat
 *
 * Returns:
 *   { name, ingredients, directions, imageUrl, link, extractedVia }
 *   or null if nothing found
 */
export function extractWithBrowserAPI(pageContent) {
  let html, visibleText, imageUrls, sourceUrl;

  // Support both object and string input
  if (typeof pageContent === 'string') {
    html = pageContent;
    visibleText = '';
    imageUrls = [];
    sourceUrl = '';
  } else {
    html = pageContent.html || '';
    visibleText = pageContent.visibleText || '';
    imageUrls = pageContent.imageUrls || [];
    sourceUrl = pageContent.sourceUrl || '';
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Step 1: Try to detect recipe plugins/structured markup Ã¢â€â‚¬Ã¢â€â‚¬
  if (html) {
    const pluginResult = detectRecipePlugins(html);
    if (pluginResult.type && (pluginResult.ingredients.length > 0 || pluginResult.directions.length > 0)) {
      return {
        name: cleanTitle(pluginResult.title || extractTitleFromHtml() || 'Recipe'),
        ingredients: pluginResult.ingredients.length > 0
          ? pluginResult.ingredients
          : ['See recipe for ingredients'],
        directions: pluginResult.directions.length > 0
          ? pluginResult.directions
          : ['See recipe for directions'],
        imageUrl: pluginResult.imageUrl || (imageUrls.length > 0 ? selectBestImage(imageUrls) || imageUrls[0] : ''),
        link: sourceUrl,
        extractedVia: `plugin-${pluginResult.type}`,
      };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Helper: extract title from HTML meta tags Ã¢â€â‚¬Ã¢â€â‚¬
  function extractTitleFromHtml() {
    if (!html) return '';
    const ogTitle = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i);
    if (ogTitle?.[1]) return ogTitle[1].trim();
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag?.[1]) return titleTag[1].trim();
    return '';
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Step 2: Try parseCaption on visible text (leverages existing heuristics) Ã¢â€â‚¬Ã¢â€â‚¬
  if (visibleText) {
    const parsed = parseCaption(visibleText);
    if (parsed.ingredients.length > 0 || parsed.directions.length > 0) {
      const bestTitle = parsed.title || extractTitleFromHtml() || 'Recipe';
      return {
        name: cleanTitle(bestTitle),
        ingredients: parsed.ingredients.length > 0
          ? parsed.ingredients
          : ['See recipe for ingredients'],
        directions: parsed.directions.length > 0
          ? parsed.directions
          : ['See recipe for directions'],
        imageUrl: (imageUrls.length > 0 ? selectBestImage(imageUrls) || imageUrls[0] : ''),
        link: sourceUrl,
        extractedVia: 'caption-parsing',
      };
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Step 3: Use smart line classification as fallback Ã¢â€â‚¬Ã¢â€â‚¬
    const lines = visibleText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);

    if (lines.length > 0) {
      const classified = smartClassifyLines(lines);
      if (classified.ingredients.length > 0 || classified.directions.length > 0) {
        // Use the title we extracted from parseCaption, or from HTML meta if available
        const fallbackTitle = classified.title || extractTitleFromHtml() || 'Recipe';
        return {
          name: cleanTitle(fallbackTitle),
          ingredients: classified.ingredients.length > 0
            ? classified.ingredients
            : ['See recipe for ingredients'],
          directions: classified.directions.length > 0
            ? classified.directions
            : ['See recipe for directions'],
          imageUrl: (imageUrls.length > 0 ? selectBestImage(imageUrls) || imageUrls[0] : ''),
          link: sourceUrl,
          extractedVia: 'smart-classification',
        };
      }
    }
  }

  // No recipe found
  return null;
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// URL SHORTCUT RESOLVER
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Known URL shortener / redirect domains.
 * These wrap the real recipe URL and need to be resolved before extraction.
 */
const SHORTENER_HOSTS = [
  'bit.ly', 'bitly.com', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly',
  'buff.ly', 'is.gd', 'v.gd', 'soo.gd', 'rb.gy', 'cutt.ly',
  'linktr.ee', 'linkin.bio', 'lnk.bio', 'beacons.ai', 'stan.store',
  'tap.bio', 'campsite.bio', 'hoo.be', 'snip.ly', 'dub.sh',
  'amzn.to', 'amzn.com', 'youtu.be', // YouTube short URLs pass through
  'fb.me', 'fb.watch',
  'vm.tiktok.com', // TikTok short URLs
];

/**
 * Check if a URL is a known shortener / redirect that needs resolving.
 */
export function isShortUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SHORTENER_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// UNIFIED IMPORT ENGINE  (Build 79)
// Single entry point for all recipe URL imports.
// For Instagram: yt-dlp FIRST Ã¢â€ â€™ embed page Ã¢â€ â€™ AI browser Ã¢â€ â€™ manual fallback.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Internal Ã¢â‚¬â€ checks if a recipe object has real extractable content
 * (not just placeholder strings injected when extraction partially fails).
 */
function hasRecipeContent(recipe) {
  if (!recipe) return false;
  if (recipe._error || recipe._needsManualCaption) return false;
  const PLACEHOLDERS = [
    'See original post for ingredients',
    'See original post for directions',
    'See recipe for ingredients',
    'See recipe for directions',
  ];
  const hasIngredients = Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
    && !PLACEHOLDERS.includes(recipe.ingredients[0]);
  const hasDirections = Array.isArray(recipe.directions) && recipe.directions.length > 0
    && !PLACEHOLDERS.includes(recipe.directions[0]);
  return hasIngredients || hasDirections;
}

/**
 * Public Ã¢â‚¬â€ the inverse contract used by UI code (ImportModal / BrowserAssist).
 *
 * A "weak" result is one where the automatic pipeline didn't produce something
 * the user can actually cook from. This is the trigger for auto-handoff to the
 * internal browser: rather than dead-ending on an error or a placeholder card,
 * we open BrowserAssist with the page loaded and let the user aim the parser.
 *
 * Returns true if ANY of:
 *   Ã¢â‚¬Â¢ recipe is null/undefined
 *   Ã¢â‚¬Â¢ recipe._error is set
 *   Ã¢â‚¬Â¢ recipe._needsManualCaption is set
 *   Ã¢â‚¬Â¢ BOTH ingredients AND directions are placeholder/empty
 *   Ã¢â‚¬Â¢ ingredients has fewer than 2 real items AND directions has fewer than 2 real items
 *     (heuristic: a recipe you can follow needs at least a couple of each)
 */
export function isWeakResult(recipe) {
  if (!recipe) return true;
  if (recipe._error || recipe._needsManualCaption) return true;
  const PLACEHOLDERS = new Set([
    'See original post for ingredients',
    'See original post for directions',
    'See recipe for ingredients',
    'See recipe for directions',
  ]);
  const realIng = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.filter(x => typeof x === 'string' && x.trim() && !PLACEHOLDERS.has(x.trim()))
    : [];
  const realDir = Array.isArray(recipe.directions)
    ? recipe.directions.filter(x => typeof x === 'string' && x.trim() && !PLACEHOLDERS.has(x.trim()))
    : [];
  // Confirmed strong: at least 2 of each
  if (realIng.length >= 2 && realDir.length >= 2) return false;
  // Borderline: at least 1 of each AND a non-placeholder name
  const hasName = recipe.name && recipe.name !== 'Imported Recipe' && recipe.name.trim().length > 2;
  if (realIng.length >= 1 && realDir.length >= 1 && hasName) return false;
  return true;
}

/**
 * parseVisualJSON Ã¢â‚¬â€ Paprika-style layout-based recipe extractor.
 *
 * CONTRACT:
 *   Input:  visualJson { url, viewport: { width, height }, scrollY, nodes[] }
 *   Each node: { text, tagName, rect: { x, y, width, height, top },
 *                style: { fontSize, fontWeight, color, backgroundColor,
 *                         fontFamily, lineHeight, textDecoration },
 *                depth, zIndex, src? (for IMG nodes) }
 *   Output: standard SpiceHub recipe schema Ã¢â‚¬â€ same shape as parseFromHTML / parseFromText.
 *
 * Strategy:
 *   1. Score every text node by visual weight (font-size Ãƒâ€” font-weight Ãƒâ€” position bias).
 *   2. Pick title: highest-weight node in the top 40% of viewport, 5-80 chars.
 *   3. Identify ingredients: medium-weight nodes that match ingredient patterns
 *      (bullets, fractions, quantity words) or cluster tightly with ones that do.
 *   4. Identify instructions: numbered or long paragraph blocks below ingredients.
 *   5. Filter noise: tiny text, footer/comment zones (> 3Ãƒâ€” viewport height).
 *   6. IG/TikTok captions: high-zIndex or semi-transparent background nodes captured first.
 */
export function parseVisualJSON(visualJson, url) {
  // Guard: return error shape on bad input so callers can use isWeakResult() to detect
  if (!visualJson || !Array.isArray(visualJson.nodes) || visualJson.nodes.length === 0) {
    return { _error: true, name: 'Imported Recipe', ingredients: [], directions: [] };
  }

  const { nodes, viewport = { width: 390, height: 844 }, scrollY = 0 } = visualJson;
  const sourceUrl = url || visualJson.url || '';
  const vpH = viewport.height || 844;
  const vpW = viewport.width || 390;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const parseFontSize = (s) => parseFloat(s) || 14;
  const parseFontWeight = (s) => {
    if (!s) return 400;
    if (s === 'bold') return 700;
    if (s === 'normal') return 400;
    return parseInt(s) || 400;
  };

  // Ingredient-line patterns: starts with bullet, fraction, digit+unit, or common measure
  const INGREDIENT_PATTERN = /^[\u2022\-\*\u00bc\u00bd\u00be\u2153\u2154\u215b\d]|^\s*(cup|tbsp|tsp|tablespoon|teaspoon|pound|lb|oz|gram|ml|clove|pinch|dash|handful|slice|piece)/i;
  const INSTRUCTION_PATTERN = /^\d+[\.\)]\s|^Step\s+\d+/i;

  // Visual weight score (higher = more prominent)
  const nodeScore = (n) => {
    const fs = parseFontSize(n.style?.fontSize);
    const fw = parseFontWeight(n.style?.fontWeight);
    const topBias = 1 - Math.min(n.rect.top / (vpH * 3), 1); // closer to top = higher score
    return fs * (fw / 400) * (1 + topBias * 0.5);
  };

  // Filter out noise nodes
  const isNoisy = (n) => {
    if (!n.text || n.text.trim().length < 3) return true;
    if (n.rect.width < 20 || n.rect.height < 8) return true;
    const fs = parseFontSize(n.style?.fontSize);
    if (fs < 10) return true;
    if (n.rect.top > vpH * 4) return true; // deep footer / comments
    return false;
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ Caption / overlay detection (Instagram Reels, TikTok) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // High z-index or semi-transparent background = video caption overlay
  const captionNodes = nodes.filter(n =>
    !isNoisy(n) &&
    (n.zIndex > 5 ||
      (n.style?.backgroundColor && n.style.backgroundColor !== 'transparent' &&
       n.style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
       !n.style.backgroundColor.startsWith('rgb(255') &&
       !n.style.backgroundColor.startsWith('rgb(248') &&
       !n.style.backgroundColor.startsWith('rgb(250')))
  );

  // Ã¢â€â‚¬Ã¢â€â‚¬ Working set: clean, non-noisy nodes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const clean = nodes.filter(n => !isNoisy(n));

  // Ã¢â€â‚¬Ã¢â€â‚¬ 1. Title detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Highest visual weight + top 40% of viewport + 5-80 chars text
  const titleCandidates = clean.filter(n => {
    const text = n.text.trim();
    return text.length >= 5 && text.length <= 120 &&
           n.rect.top < vpH * 0.5 &&
           parseFontSize(n.style?.fontSize) >= 16 &&
           parseFontWeight(n.style?.fontWeight) >= 500;
  });
  titleCandidates.sort((a, b) => nodeScore(b) - nodeScore(a));
  const titleNode = titleCandidates[0] || null;
  const title = titleNode ? titleNode.text.trim() : 'Imported Recipe';

  // Exclude the title node from further parsing
  const titleTop = titleNode ? titleNode.rect.top : -1;

  // Ã¢â€â‚¬Ã¢â€â‚¬ 2. Ingredient detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Look below the title for clustered medium-weight nodes matching ingredient patterns
  const belowTitle = clean.filter(n => n.rect.top > titleTop + 20);

  // Primary: nodes directly matching ingredient pattern
  const directIngNodes = belowTitle.filter(n => INGREDIENT_PATTERN.test(n.text.trim()));

  // Secondary: if we have Ã¢â€°Â¥ 3 direct matches, also pull in nearby (vertical gap < 60px)
  // nodes of similar style that likely belong to the same list
  let ingredientNodes = [...directIngNodes];
  if (directIngNodes.length >= 2) {
    const ingTops = directIngNodes.map(n => n.rect.top);
    const ingMinTop = Math.min(...ingTops) - 80;
    const ingMaxTop = Math.max(...ingTops) + 120;
    const avgFs = directIngNodes.reduce((s, n) => s + parseFontSize(n.style?.fontSize), 0) / directIngNodes.length;
    const avgFw = directIngNodes.reduce((s, n) => s + parseFontWeight(n.style?.fontWeight), 0) / directIngNodes.length;
    const proxNodes = belowTitle.filter(n =>
      !directIngNodes.includes(n) &&
      n.rect.top >= ingMinTop && n.rect.top <= ingMaxTop &&
      Math.abs(parseFontSize(n.style?.fontSize) - avgFs) < 4 &&
      Math.abs(parseFontWeight(n.style?.fontWeight) - avgFw) < 150 &&
      n.text.trim().length > 3 && n.text.trim().length < 200
    );
    ingredientNodes = [...directIngNodes, ...proxNodes];
  }

  // Sort by vertical position
  ingredientNodes.sort((a, b) => a.rect.top - b.rect.top);
  const ingredients = ingredientNodes.map(n => n.text.trim()).filter(Boolean);

  // Ã¢â€â‚¬Ã¢â€â‚¬ 3. Instruction detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Numbered blocks or longer text paragraphs below ingredients
  const ingMaxTop = ingredientNodes.length > 0
    ? Math.max(...ingredientNodes.map(n => n.rect.top))
    : titleTop + 100;

  const instructionNodes = belowTitle.filter(n => {
    if (n.rect.top < ingMaxTop - 50) return false; // above ingredients
    const text = n.text.trim();
    if (text.length < 15) return false; // too short to be an instruction
    if (INSTRUCTION_PATTERN.test(text)) return true; // numbered step
    if (text.length > 40 && parseFontWeight(n.style?.fontWeight) <= 500) return true; // paragraph
    return false;
  });
  instructionNodes.sort((a, b) => a.rect.top - b.rect.top);
  const directions = instructionNodes.map(n => n.text.trim()).filter(Boolean);

  // Ã¢â€â‚¬Ã¢â€â‚¬ 4. Caption fallback (social / video overlay) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // If ingredients/directions are empty, try to extract from caption nodes
  const effectiveIngredients = ingredients.length > 0 ? ingredients
    : captionNodes.filter(n => INGREDIENT_PATTERN.test(n.text.trim())).map(n => n.text.trim());
  const effectiveDirections = directions.length > 0 ? directions
    : captionNodes.filter(n => n.text.trim().length > 20).map(n => n.text.trim()).slice(0, 20);

  // Ã¢â€â‚¬Ã¢â€â‚¬ 5. Image detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const imgNode = nodes.find(n => n.tagName === 'IMG' && n.src && n.rect.width > 80);
  const image = imgNode ? imgNode.src : null;

  // Ã¢â€â‚¬Ã¢â€â‚¬ 6. Confidence score Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const classified = (titleNode ? 1 : 0) + Math.min(effectiveIngredients.length, 5) + Math.min(effectiveDirections.length, 5);
  const total = clean.length > 0 ? clean.length : 1;
  const confidence = Math.min(classified / Math.min(total, 15), 1);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Debug logging (development only) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development')
    || (typeof import.meta !== 'undefined' && import.meta.env?.DEV);
  if (isDev) {
    console.debug('[parseVisualJSON] title:', title,
      '| ingredients:', effectiveIngredients.length,
      '| directions:', effectiveDirections.length,
      '| confidence:', confidence.toFixed(2),
      '| titleNode:', titleNode?.text?.slice(0, 40),
      '| captionNodes:', captionNodes.length);
  }

  return {
    name: title,
    ingredients: effectiveIngredients,
    directions: effectiveDirections,
    ...buildStructuredFields(effectiveIngredients, effectiveDirections),
    image,
    sourceUrl,
    _visualParsed: true,
    _visualConfidence: confidence,
  };
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// GEMINI HYBRID FALLBACK (Phase 1)
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * calculateVisualConfidence Ã¢â‚¬â€ Enhanced confidence scoring for visual parsing results.
 *
 * Factors:
 *   - Title presence (strongest signal)
 *   - Ingredient count (Ã¢â€°Â¥ 3 is strong)
 *   - Direction count (Ã¢â€°Â¥ 2 is strong)
 *   - Content completeness ratio
 *
 * Returns: 0-1 confidence score
 *   Ã¢â€°Â¥ 0.75 Ã¢â€ â€™ visual result is reliable (ship it)
 *   0.5-0.75 Ã¢â€ â€™ ambiguous (use Gemini fallback)
 *   < 0.5 Ã¢â€ â€™ weak (escalate to full deep extraction)
 */
export function calculateVisualConfidence(visualResult) {
  if (!visualResult || visualResult._error) return 0;

  const {
    name = '',
    ingredients = [],
    directions = [],
    image = null,
  } = visualResult;

  let score = 0;

  // Title presence: 0.3 points max
  if (name && name.length > 3 && name !== 'Imported Recipe') {
    score += 0.3;
  }

  // Ingredient count: up to 0.35 points
  const ingCount = Math.min(ingredients.length, 10);
  if (ingCount >= 3) score += 0.35;
  else if (ingCount >= 1) score += 0.15 * ingCount;

  // Direction count: up to 0.25 points
  const dirCount = Math.min(directions.length, 8);
  if (dirCount >= 2) score += 0.25;
  else if (dirCount >= 1) score += 0.12 * dirCount;

  // Image presence: 0.1 bonus
  if (image) score += 0.1;

  // Cap at 1.0
  return Math.min(score, 1);
}

/**
 * parseRecipeHybrid Ã¢â‚¬â€ Browser-side wrapper for hybrid visual + Gemini parsing.
 *
 * Flow:
 *   1. Run visual heuristics Ã¢â€ â€™ get confidence score
 *   2. If confidence Ã¢â€°Â¥ 0.75 Ã¢â€ â€™ return visual result (fast, deterministic)
 *   3. Else Ã¢â€ â€™ call server /api/gemini-fallback endpoint
 *   4. Server calls Gemini, returns structured recipe + confidence
 *   5. Blend results: visual 60% + Gemini 40% when fallback used
 *
 * This keeps 80%+ of imports instant + free while using Gemini's intelligence
 * only when visual layout is ambiguous.
 */
export async function parseRecipeHybrid(visualNodes = [], caption = '', url = '') {
  const visualThresholdHigh = 0.75; // Strong visual signal Ã¢â€ â€™ ship immediately
  const geminiThresholdMin = 0.6; // Gemini confidence floor

  // Step 1: Run visual parser
  const visualResult = parseVisualJSON({ nodes: visualNodes }, url);
  if (visualResult._error) {
    console.log('[Hybrid] Visual parse failed, trying Gemini...');
  }

  // Step 2: Calculate visual confidence
  const visualConfidence = calculateVisualConfidence(visualResult);
  console.log(`[Hybrid] Visual confidence: ${(visualConfidence * 100).toFixed(0)}%`);

  // Step 3: If visual is strong, return it immediately
  if (visualConfidence >= visualThresholdHigh && !visualResult._error) {
    return {
      ...visualResult,
      _source: 'visual-only',
      _hybridConfidence: visualConfidence,
      _hybridUsed: false,
    };
  }

  // Step 4: Visual weak or missing Ã¢â€ â€™ call server Gemini endpoint
  console.log(`[Hybrid] Low visual confidence (${(visualConfidence * 100).toFixed(0)}%), using Client-Side AI...`);

  let geminiResult = null;
  try {
    // Convert visual nodes to a readable summary for Gemini (limit to ~4000 chars)
    const textSummary = visualNodes.slice(0, 300).map(n => n.text).join('\n').slice(0, 4000);
    const combinedInput = [caption, textSummary].filter(Boolean).join('\n\n');
    
    // Call our client-side Gemini structurer directly
    const result = await structureWithAIClient(combinedInput, { 
      title: visualResult.name, 
      sourceUrl: url,
      imageUrl: visualResult.image
    });

    if (result && !isWeakResult(result)) {
       geminiResult = { ...result, confidence: 0.85 }; // Assume high confidence if structured
    }
  } catch (err) {
    console.error('[Gemini fallback] Client call failed:', err?.message || err);
  }
  // Step 5: No Gemini result or too low confidence Ã¢â€ â€™ return visual as-is
  if (!geminiResult || geminiResult.confidence < geminiThresholdMin) {
    console.log('[Hybrid] Gemini result weak or unavailable, returning visual fallback');
    return {
      ...visualResult,
      _source: 'visual-fallback',
      _hybridConfidence: visualConfidence,
      _hybridUsed: false,
    };
  }

  // Step 6: Blend visual + Gemini (60% visual weight + 40% Gemini weight)
  const blendedConfidence = (visualConfidence * 0.6) + (geminiResult.confidence * 0.4);

  return {
    name: geminiResult.name || visualResult.name,
    ingredients: geminiResult.ingredients?.length
      ? geminiResult.ingredients
      : visualResult.ingredients,
    directions: geminiResult.directions?.length
      ? geminiResult.directions
      : visualResult.directions,
    image: visualResult.image || null,
    sourceUrl: url,
    servings: geminiResult.servings || 1,
    time: geminiResult.time || '',
    _source: 'visual+gemini-hybrid',
    _hybridConfidence: blendedConfidence,
    _hybridUsed: true,
    _debug: {
      visualConfidence,
      geminiConfidence: geminiResult.confidence,
      geminiReasoning: geminiResult.reasoning,
    },
  };
}

/**
 * resolveShortUrl Ã¢â‚¬â€ attempts to follow short-URL redirects via the backend.
 * Falls back silently to the original URL on any error.
 */
export async function resolveShortUrl(url) {
  if (!isShortUrl(url)) return url;
  try {
    const serverUrl = await detectServer();
    if (!serverUrl) return url;
    const resp = await fetch(`${serverUrl}/api/resolve-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return url;
    const data = await resp.json();
    return data.resolvedUrl || url;
  } catch {
    return url;
  }
}

/**
 * importFromInstagram Ã¢â‚¬â€ Unified 3-phase Instagram extraction engine.
 *
 * Phase order (ReciME insight Ã¢â‚¬â€ video subtitles are richest for Reels):
 *   0. yt-dlp video subtitles  Ã¢â€ Â FIRST
 *   1. Instagram embed page (fast, no Puppeteer)
 *   2. AI browser (Puppeteer, only if 0+1 fail)
 *   3. Gemini AI on any captured text
 *   Ã¢â€ â€™ Last resort: { _needsManualCaption: true, sourceUrl }
 *
 * @param {string} url  - Instagram post/reel URL
 * @param {function} onProgress  - callback(phaseIndex, status, message)
 *   status: 'running' | 'done' | 'failed' | 'skipped' | 'pending'
 * @returns {Object} Structured recipe or { _needsManualCaption: true }
 */
export async function importFromInstagram(url, onProgress = () => {}, { type = 'meal' } = {}) {
  url = cleanUrl(url);
  const progress = (phase, status, msg) => onProgress(phase, status, msg);

  // ── Cache check: return early if we already have a fresh result ──────────────
  try {
    const cached = await getCachedImport(url);
    if (cached) {
      progress(0, 'done',    'Loaded from cache');
      progress(1, 'skipped', 'Cached');
      progress(2, 'skipped', 'Cached');
      progress(3, 'done',    'Recipe from cache!');
      return cached;
    }
  } catch { /* cache miss or DB error — continue */ }

  // Placeholders to explicitly reject from any phase result
  const PLACEHOLDERS = [
    'See original post for ingredients', 'See original post for directions',
    'See recipe for ingredients', 'See recipe for directions',
  ];
  const isPlaceholder = (arr) =>
    !Array.isArray(arr) || arr.length === 0 || PLACEHOLDERS.includes(arr[0]);

  // Reconstruct raw text from a structured recipe result (for Gemini re-polish)
  const recipeToText = (r) => [
    r.name || '',
    ...(r.ingredients || []).filter(i => !PLACEHOLDERS.includes(i)),
    ...(r.directions  || []).filter(d => !PLACEHOLDERS.includes(d)),
  ].filter(Boolean).join('\n');

  let capturedCaption   = '';
  let capturedImageUrl  = '';
  let capturedTitle     = '';   // best title found across all phases
  let videoRecipe       = null; // yt-dlp/server resource helper result

  // Track raw page text from embed as last-resort Gemini input
  let capturedRawPageText = '';

  const persistCapturedImage = async (imageUrl = capturedImageUrl) => {
    if (!imageUrl || imageUrl.startsWith('data:')) return imageUrl || '';
    // Reject non-image URLs before attempting download
    if (!isValidImageUrl(imageUrl)) return '';
    if (!isInstagramCdnUrl(imageUrl) && !/scontent|fbcdn|cdninstagram/i.test(imageUrl)) return imageUrl;
    try {
      const dataUrl = await downloadImageAsDataUrl(imageUrl, { timeoutMs: 12000 });
      return dataUrl || imageUrl;
    } catch {
      return imageUrl;
    }
  };

  // -- Phase 0: yt-dlp video subtitles (optional always-on server resource helper) --
  progress(0, 'running', 'Checking video subtitles...');
  try {
    videoRecipe = await tryVideoExtraction(url, (msg) => progress(0, 'running', msg), { type });
    if (videoRecipe && hasRecipeContent(videoRecipe)) {
      capturedCaption = recipeToText(videoRecipe);
      capturedImageUrl = videoRecipe.imageUrl || capturedImageUrl;
      capturedTitle = videoRecipe.name || capturedTitle;
      progress(0, 'done', videoRecipe._hasSubtitles ? 'Video subtitles found' : 'Video metadata found');
    } else {
      progress(0, 'skipped', 'No video subtitles available');
    }
  } catch {
    progress(0, 'skipped', 'Video subtitles unavailable');
  }

  // ── Phase 0.25: Apify Instagram scraper — managed residential proxies ─────────
  // Most reliable extraction source: returns full caption + fresh CDN image URL.
  // Runs server-side via Vercel → Apify REST API. Falls through if APIFY_TOKEN not set.
  if (!capturedCaption) {
    progress(1, 'running', 'Trying Apify scraper…');
    try {
      const apifyData = await fetchInstagramViaApify(url);
      if (apifyData?.caption && apifyData.caption.length > 30) {
        capturedCaption = cleanSocialCaption(apifyData.caption);
        capturedTitle = apifyData.ownerFullName || apifyData.ownerUsername || capturedTitle;
        // Apify displayUrl is a FRESH CDN URL with valid auth tokens — download immediately
        // as a base64 data URL so it persists after the CDN token expires.
        if (apifyData.displayUrl) {
          capturedImageUrl = apifyData.displayUrl; // raw CDN fallback
          try {
            const persisted = await downloadImageAsDataUrl(apifyData.displayUrl, { timeoutMs: 20000 });
            if (persisted) {
              capturedImageUrl = persisted; // promoted to self-contained data URL
              console.log('[importFromInstagram] Image persisted as data URL ✔');
            } else {
              // downloadImageAsDataUrl returned null — try weserv.nl directly as last resort
              const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(apifyData.displayUrl)}&w=1200&output=jpg&q=85`;
              try {
                const wResp = await fetch(weservUrl, { signal: AbortSignal.timeout(12000) });
                if (wResp.ok && wResp.headers.get('content-type')?.startsWith('image/')) {
                  const buf = await wResp.arrayBuffer();
                  if (buf.byteLength > 100) {
                    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                    capturedImageUrl = `data:image/jpeg;base64,${b64}`;
                    console.log('[importFromInstagram] Image via weserv fallback ✔');
                  }
                }
              } catch { /* keep raw CDN URL */ }
              if (capturedImageUrl === apifyData.displayUrl) {
                console.warn('[importFromInstagram] Image persist failed — storing raw CDN URL (may expire)');
              }
            }
          } catch (imgErr) {
            console.warn('[importFromInstagram] Image download threw:', imgErr?.message);
          }
        }
        const imgStatus = capturedImageUrl?.startsWith('data:') ? 'data URL ✔' : capturedImageUrl ? 'raw URL ⚠' : 'none ✗';
        progress(1, 'done', `Apify: caption (${capturedCaption.length} chars) + image ${imgStatus}`);
        console.log('[importFromInstagram] Apify succeeded — skipping embed/browser phases');
      } else {
        progress(1, 'done', 'Apify: no caption — falling through');
      }
    } catch {
      progress(1, 'done', 'Apify unavailable — using embed fallback');
    }
  }

  // ── Phase 0.5: Instagram oEmbed API — fastest when FB_APP_TOKEN is configured ──
  // Calls /api/proxy?mode=instagram-oembed on the Vercel edge function.
  // Falls through silently if token not set (503) or oEmbed fails.
  if (!capturedCaption) {
    try {
      const oembed = await fetchInstagramOEmbed(url);
      // oEmbed thumbnail_url is commonly the creator avatar, not the food photo.
      // The embed/server phases below are responsible for post-specific images.
      if (oembed?.html) {
        // oEmbed HTML contains the post caption inside a <p> tag
        const capMatch = oembed.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (capMatch) {
          const raw = capMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim();
          if (raw.length > 30) capturedCaption = cleanSocialCaption(raw);
        }
      }
    } catch { /* oEmbed not configured or failed */ }
  }

  // ── Phase 0.75: Instagram JSON endpoint (?__a=1&__d=dis) — often blocked but worth trying ──
  {
    try {
      const scMatch = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (scMatch) {
        const jsonDetails = await fetchInstagramJsonDetails(scMatch[2]);
        const jsonCaption = jsonDetails?.caption || (!capturedCaption ? await fetchInstagramJson(scMatch[2]) : '');
        if (!capturedCaption && jsonCaption && jsonCaption.length > 30) {
          capturedCaption = cleanSocialCaption(jsonCaption);
        }
        if (!capturedImageUrl && jsonDetails?.imageUrl) capturedImageUrl = jsonDetails.imageUrl;
        if (!capturedTitle && jsonDetails?.title) capturedTitle = jsonDetails.title;
      }
    } catch { /* JSON endpoint blocked */ }
  }

  // ── Phase 1: Instagram embed page (CORS proxy path — main workhorse) ────────
  // Skip if Apify (or yt-dlp) already gave us a strong caption AND a persisted image.
  const apifyFullSuccess = capturedCaption && capturedCaption.length > 50
    && capturedImageUrl && !isCaptionWeak(capturedCaption)
    && !videoRecipe;
  if (!videoRecipe && !apifyFullSuccess) {
    progress(1, 'running', 'Fetching Instagram caption…');
    try {
      const embedData = await extractInstagramEmbed(url);
      if (embedData?.rawPageText && !embedData?.caption) {
        // No clean caption but we have raw page text — save for Phase 3 Gemini fallback
        capturedRawPageText = embedData.rawPageText;
      }
      // Always capture image and title from embed data, regardless of caption
      // display_url / scontent images from extractInstagramEmbed are post-specific
      // food photos — always prefer them over the oEmbed profile avatar.
      // Guard: only accept URLs that are actual images (not .js/.css resources).
      if (embedData?.imageUrl && isValidImageUrl(embedData.imageUrl) && !isProfilePicUrl(embedData.imageUrl)) {
        // Never overwrite a persisted data: URL — those are already downloaded and stable.
        // Only prefer embed's CDN URL when we have nothing, or what we have is also a CDN URL.
        if (!capturedImageUrl?.startsWith('data:')) {
          const isPostSpecific = /scontent|fbcdn/.test(embedData.imageUrl)
            || embedData.imageUrl.includes('_n.jpg');
          if (isPostSpecific || !capturedImageUrl) {
            capturedImageUrl = embedData.imageUrl;
          }
        }
      }
      if (embedData?.title && !capturedTitle) capturedTitle = embedData.title;

      if (embedData?.caption) {
        const embedCaption = cleanSocialCaption(embedData.caption);
        if (embedCaption.length > capturedCaption.length) capturedCaption = embedCaption;

        const isWeak = isCaptionWeak(capturedCaption);
        progress(1, 'done',
          capturedCaption
            ? `Caption found${isWeak ? ' (thin — will try AI browser)' : ' ✔'}`
            : 'Embed returned no text');

        if (capturedCaption && !isWeak) {
          progress(2, 'pending', 'Strong caption captured; browser assist remains available');
        }
      } else if (embedData?.rawPageText) {
        progress(1, 'done', 'No caption — sending page content to Google AI…');
      } else {
        // Embed returned nothing — try third-party viewers as fallback
        const scMatch = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (scMatch && !capturedCaption) {
          const shortcode = scMatch[2];
          const viewers = [
            `https://imginn.com/p/${shortcode}/`,
            `https://picuki.com/media/${shortcode}`,
          ];
          for (const viewerUrl of viewers) {
            try {
              const vHtml = await fetchHtmlViaProxyFromApi(viewerUrl, 10000);
              if (vHtml && vHtml.length > 200) {
                const capMatch = vHtml.match(/<div[^>]*class="[^"]*caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                  || vHtml.match(/<p[^>]*class="[^"]*caption[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
                if (capMatch) {
                  const raw = capMatch[1].replace(/<[^>]+>/g, ' ').trim();
                  if (raw.length > 50) {
                    capturedCaption = cleanSocialCaption(raw);
                    const imgMatch = vHtml.match(/<img[^>]*src="(https:\/\/[^"]*instagram[^"]*)"[^>]*>/i);
                    if (imgMatch && !capturedImageUrl) capturedImageUrl = imgMatch[1];
                    break;
                  }
                }
              }
            } catch { /* try next viewer */ }
          }
        }
        if (!capturedCaption) {
          progress(1, 'failed', 'Caption not found — will try AI browser');
        }
      }
    } catch { progress(1, 'failed', 'Embed fetch failed'); }

    // -- Phase 2: Server browser extraction for thin or missing captions --
    if (!capturedCaption || isCaptionWeak(capturedCaption) || !capturedImageUrl) {
      progress(2, 'running', 'Trying browser-assisted extraction...');
      const agentRecipe = await extractInstagramAgent(url, (msg) => progress(2, 'running', msg), { type });
      if (agentRecipe && (hasRecipeContent(agentRecipe) || agentRecipe.imageUrl)) {
        const agentText = recipeToText(agentRecipe);
        if (agentText.length > capturedCaption.length) capturedCaption = agentText;
        capturedImageUrl = agentRecipe.imageUrl || capturedImageUrl;
        capturedTitle = agentRecipe.name || capturedTitle;
        if (agentRecipe._hasSubtitles) videoRecipe = agentRecipe;
        progress(2, 'done', agentRecipe.imageUrl && !agentText ? 'Browser-assisted extraction found image' : 'Browser-assisted extraction found recipe text');
      } else {
        progress(2, 'skipped', 'Browser-assisted extraction unavailable');
      }
    } else {
      progress(2, 'skipped', 'Strong caption captured');
    }
  } else if (apifyFullSuccess) {
    // Apify delivered caption + image — mark embed/browser phases as skipped in UI
    progress(1, 'skipped', 'Apify captured caption ✔');
    progress(2, 'skipped', 'Apify captured image ✔');
  } // end phases 0.5–1+2

  // ── Phase 3: Gemini AI structuring — ALWAYS runs on any captured text ────────
  // Last-resort: if we have zero text from all phases, try a raw proxy fetch of the URL
  if (!capturedCaption?.trim() && !capturedRawPageText?.trim()) {
    progress(3, 'running', '✨ Last resort — fetching page for AI…');
    try {
      const rawHtml = await fetchHtmlViaProxyFromApi(url, 15000);
      if (rawHtml && rawHtml.length > 500) {
        const extracted = rawHtml
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 6000);
        if (extracted.length > 300) capturedRawPageText = extracted;
      }
    } catch { /* continue without it */ }
  }

  const textForGemini = capturedCaption?.trim().length >= 20
    ? capturedCaption
    : capturedRawPageText?.trim().length >= 100 ? capturedRawPageText : '';

  if (textForGemini) {
    if (!capturedCaption?.trim().length) {
      progress(3, 'running', '✨ Trying AI on raw page content…');
    } else {
      progress(3, 'running', '✨ Structuring recipe with Gemini…');
    }
    try {
      const recipe = cleanStructuredSocialRecipe(await captionToRecipe(textForGemini, { title: capturedTitle, imageUrl: capturedImageUrl, sourceUrl: url, type }));
      // Use OR: accept if EITHER ingredients OR directions is non-placeholder
      if (recipe && (!isPlaceholder(recipe.ingredients) || !isPlaceholder(recipe.directions))) {
        progress(3, 'done', 'Recipe structured successfully!');
        const persistedImageUrl = await persistCapturedImage(capturedImageUrl || recipe.imageUrl || '');
const finalRecipe = {
  ...recipe,
  imageUrl: persistedImageUrl || capturedImageUrl || recipe.imageUrl || '',
  capturedImageUrl: persistedImageUrl || capturedImageUrl,
          extractedVia: videoRecipe ? 'yt-dlp+ai' : 'caption-ai',
          sourceUrl: url,
          importedAt: new Date().toISOString(),
        };
        try { await setCachedImport(url, finalRecipe); } catch { /* cache write failure is non-fatal */ }
        return finalRecipe;
      }
      // Gemini returned partial — try merge with yt-dlp if available
      if (videoRecipe && hasRecipeContent(videoRecipe)) {
        const merged = cleanStructuredSocialRecipe({
          ...videoRecipe,
          ...(recipe?.name ? { name: recipe.name } : {}),
          ingredients: !isPlaceholder(recipe?.ingredients) ? recipe.ingredients : videoRecipe.ingredients,
          directions:  !isPlaceholder(recipe?.directions)  ? recipe.directions  : videoRecipe.directions,
        });
        if (hasRecipeContent(merged)) {
          progress(3, 'done', 'Recipe extracted from video!');
          const persistedImageUrl = await persistCapturedImage(capturedImageUrl || merged.imageUrl || '');
          const finalRecipe = { ...merged, imageUrl: persistedImageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
          try { await setCachedImport(url, finalRecipe); } catch { /* non-fatal */ }
          return finalRecipe;
        }
      }
    } catch (err) {
      // Gemini failed — fall back to yt-dlp result if available
      if (videoRecipe && hasRecipeContent(videoRecipe)) {
        progress(3, 'done', 'Using video extraction (AI unavailable)');
        const persistedImageUrl = await persistCapturedImage(capturedImageUrl || videoRecipe.imageUrl || '');
        const finalRecipe = { ...videoRecipe, imageUrl: persistedImageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
        try { await setCachedImport(url, finalRecipe); } catch { /* non-fatal */ }
        return finalRecipe;
      }
    }
    progress(3, 'failed', 'AI could not structure a recipe from this post');
  } else if (videoRecipe && hasRecipeContent(videoRecipe)) {
    // No caption text but yt-dlp gave us a full recipe — use it directly
    progress(3, 'done', 'Recipe from video subtitles!');
    const persistedImageUrl = await persistCapturedImage(capturedImageUrl || videoRecipe.imageUrl || '');
    const finalRecipe = { ...videoRecipe, imageUrl: persistedImageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
    try { await setCachedImport(url, finalRecipe); } catch { /* non-fatal */ }
    return finalRecipe;
  } else {
    progress(3, 'failed', 'No text captured from any source');
  }

  // ── CDN image caching — download Instagram CDN images at import time ─────────
  // Instagram scontent / fbcdn URLs expire (usually within hours) and block
  // cross-origin requests. We try to download the image through the proxy and
  // convert it to a data URL so the recipe image stays available offline and
  // after the CDN URL expires. Non-fatal — keep the original URL on failure.
  if (capturedImageUrl
    && !capturedImageUrl.startsWith('data:')
    && isValidImageUrl(capturedImageUrl)
    && /scontent|fbcdn|cdninstagram/.test(capturedImageUrl)) {
    try {
      const dataUrl = await downloadImageAsDataUrl(capturedImageUrl, { timeoutMs: 10000 });
      if (dataUrl) {
        console.log('[importFromInstagram] CDN image cached as data URL');
        capturedImageUrl = dataUrl;
      }
    } catch { /* non-fatal — keep original CDN URL */ }
  }

  // ── Manual fallback — all phases exhausted ───────────────────────────────────
  // Pass back whatever we captured so BrowserAssist can pre-fill the manual textarea.
  // capturedCaption may be a full recipe caption that just failed the AI step —
  // handing it back lets the user hit "Parse" without having to re-paste anything.
  // ── Final image persistence (critical for Instagram) ─────────────────────
  const finalImageUrl = await persistCapturedImage(capturedImageUrl || '');

  // ── Manual fallback — all phases exhausted ───────────────────────────────
  return {
    _needsManualCaption: true,
    capturedCaption: capturedCaption || '',
    capturedImageUrl: finalImageUrl,           // ← FIXED
    capturedTitle: capturedTitle || '',
    imageUrl: finalImageUrl,                   // ← NEW: direct field for preview
    sourceUrl: url,
  };
}


export function detectImportType(url = '', initialText = '') {
  const u = String(url || '').toLowerCase();
  const t = String(initialText || '').toLowerCase();

  // -- Strong URL hints — host and path --------------------------------------
  const DRINK_HOSTS = /(?:^|\/\/)(?:www\.)?(?:liquor\.com|diffordsguide\.com|imbibemagazine\.com|punchdrink\.com|cocktailsdistilled\.com|tuxedono2\.com|drinkswithmommy\.com|garnishcocktails\.com|kindredcocktails\.com|thespruceeats\.com|cocktailparty\.com|tasteofhome\.com\/recipes\/cocktails)/i;
  if (DRINK_HOSTS.test(u)) return 'drink';

  // URL path hints
  if (/\/(cocktails?|drinks?|bar|mixology|bartender|spirits?|mocktails?|liqueurs?)(?:\/|-|_|$)/i.test(u)) {
    return 'drink';
  }

  const MEAL_HOSTS = /(?:^|\/\/)(?:www\.)?(?:allrecipes\.com|foodnetwork\.com|seriouseats\.com|bonappetit\.com|epicurious\.com|food\.com|cooking\.nytimes\.com|bbcgoodfood\.com|simplyrecipes\.com|smittenkitchen\.com|budgetbytes\.com|delish\.com|tasty\.co|minimalistbaker\.com|foodwishes\.com)/i;
  if (MEAL_HOSTS.test(u)) return 'meal';

  // -- Keyword scan on URL path + accompanying text -------------------------
  const haystack = u + ' ' + t;

  // Strong single-word signals — any one match is enough
  const DRINK_STRONG = [
    'whiskey', 'whisky', 'bourbon', 'scotch', 'mezcal', 'tequila', 'vodka',
    'vermouth', 'campari', 'aperol', 'amaretto', 'kahlua', 'angostura',
    'absinthe', 'chartreuse', 'bitters', 'liqueur', 'cocktail', 'mocktail',
    'jigger', 'muddle', 'shaker', 'bartender', 'mixology', 'highball',
    'old fashioned', 'negroni', 'margarita', 'martini', 'daiquiri', 'mojito',
    'aperitivo', 'digestif', 'nightcap',
  ];
  if (DRINK_STRONG.some(w => haystack.includes(w))) return 'drink';

  // Weaker signals — need 2+ to classify as drink
  const DRINK_WEAK = ['shake', 'stir', 'strain', 'rim', 'garnish', 'build in glass',
    ' oz ', 'dash', ' gin ', ' rum '];
  const weakHits = DRINK_WEAK.filter(w => haystack.includes(w)).length;
  if (weakHits >= 2) return 'drink';

  // Default fallback
  return 'meal';
}

