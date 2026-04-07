/**
 * SpiceHub Recipe Parser
 * Strategy (mirrors Paprika 3):
 *   1. ALL URLs      → server-side extraction first (server.js /api/extract-url)
 *      • Social media URLs → headless Chrome (real browser, renders JS like Paprika's WebView)
 *      • Recipe blogs      → fast HTTP fetch + JSON-LD / OG meta parsing
 *   2. CORS PROXY    → fallback if server unreachable (limited for social media)
 *   3. CAPTION TEXT  → 4-pass heuristic parser (used internally on extracted captions)
 */

// ─── Title sanitizer (public export, delegates to cleanTitle) ────────────────
export function sanitizeRecipeTitle(raw) {
  return cleanTitle(raw);
}

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

// ─── Mealie-inspired image selection: pick the best/largest from candidates ──
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

// ─── Ingredient / Direction heuristics (enhanced) ─────────────────────────────
const UNITS_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|medium|large|small|whole|half|to taste|chopped|diced|minced|sliced|crushed|grated|shredded|fresh|dried|frozen|peeled|deveined|boneless|skinless|room temperature|softened|melted|divided)\b/i;
const BULLET_RE = /^[-•*▪▸►◦‣⁃✓✔🔸🔹◽◾▫▪️🥄🥕🧅🧄🍳🥚🧈🥛🍗🥩🧀🍅🫒🌿🫑🥦🍋]\s*/;
const FRACTION_RE = /^[½¼¾⅓⅔⅛⅜⅝⅞\d]/;
const NUM_UNIT_RE = /^[\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s]*\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?)/i;
const STEP_NUM_RE = /^\d+[.):\s-]/;
const COOKING_VERBS_RE = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|stir-fry|deep.fry|pan.fry|air.fry)\b/i;
// Spoken/informal direction starters (YouTube Shorts, TikTok narration style)
const SPOKEN_DIRECTION_RE = /^(you'?re? (?:gonna|going to)|go ahead and|now (?:we|you|I)|what (?:we|you|I) (?:do|did)|take (?:your|the|some)|grab (?:your|the|some)|throw (?:it|that|the|some) in|pop (?:it|that|the) in|toss (?:it|that|the) in|once (?:it|that|the|your)|when (?:it|that|the|your)|after (?:it|that|the|your|about)|make sure|be sure to|don'?t forget to|carefully|gently|slowly|quickly|keep (?:stirring|mixing|cooking)|continue|allow|until|while)\b/i;

// Common food words that indicate an ingredient line even without a unit
const FOOD_RE = /\b(chicken|beef|pork|salmon|shrimp|tofu|rice|pasta|noodles|bread|flour|sugar|butter|oil|olive oil|vegetable oil|canola oil|sesame oil|coconut oil|garlic|onion|onions|shallot|shallots|tomato|tomatoes|pepper|peppers|salt|cheese|cream|milk|eggs?|lemon|lime|vinegar|soy sauce|honey|ginger|cilantro|parsley|basil|oregano|cumin|paprika|cinnamon|avocado|potato|potatoes|broccoli|spinach|mushrooms?|carrots?|celery|corn|beans?|chickpeas?|lentils?|coconut|vanilla|chocolate|bacon|sausage|ham|turkey|lettuce|cucumber|zucchini|bell pepper|jalape[nñ]o|mayo|mayonnaise|mustard|ketchup|sriracha|sesame|peanut|almond|walnut|cashew|oats?|yogurt|sour cream|cream cheese|mozzarella|parmesan|cheddar|feta|ricotta|tortilla|pita|naan|wonton|dumpling|vodka|whiskey|bourbon|rum|tequila|gin|scotch|vermouth|bitters|angostura|triple sec|cointreau|campari|kahlua|amaretto|ginger beer|tonic|soda water|club soda|cranberry juice|orange juice|lime juice|lemon juice|simple syrup|grenadine|baking soda|baking powder|cornstarch|cream of tartar|yeast|heavy cream|half.and.half|buttermilk|sweetened condensed milk|evaporated milk|cocoa powder|brown sugar|powdered sugar|confectioners|maple syrup|molasses|worcestershire|fish sauce|oyster sauce|hoisin|tahini|miso|sambal|harissa|chili flakes?|red pepper flakes?|cayenne|nutmeg|turmeric|cardamom|cloves?|allspice|thyme|rosemary|sage|dill|chives?|scallions?|green onions?|leeks?|capers|olives|artichoke|eggplant|squash|pumpkin|sweet potato|yam|beet|radish|cabbage|kale|arugula|watercress)\b/i;

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
  if (/\b(\d+\s*(?:degrees?|°)\s*[FCfc]?)\b/i.test(line) && line.length > 25) return true;
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
  const cleaned = lower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}👇⬇️↓📝✨💫🍽️🥘🍲]/gu, '').trim();
  return INGREDIENTS_HEADERS.some(h => cleaned === h || cleaned.startsWith(h + ':') || cleaned.startsWith(h + ' -') || lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}
function isDirectionsHeader(lower) {
  const cleaned = lower.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}👇⬇️↓📝✨💫🍽️🥘🍲]/gu, '').trim();
  return DIRECTIONS_HEADERS.some(h => cleaned === h || cleaned.startsWith(h + ':') || cleaned.startsWith(h + ' -') || lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}

// ─── ReciME-style aggressive social caption cleaner ─────────────────────────
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
    /^[🔗👇⬇️📲💌📩🔔📌🏷️].{0,80}$/m,
  ];
  for (const re of BAIT_LINES) t = t.replace(new RegExp(re.source, re.flags + 'g'), '');

  // 3. Strip "See more" / "… more" truncation artifacts
  t = t.replace(/\.{3,}\s*(more|see more|read more)\s*$/im, '');
  t = t.replace(/\s*[…]\s*(more|see more)?\s*$/im, '');

  // 4. Strip Instagram OG engagement prefix (e.g. "13K likes, 213 comments - user on Jan 1, 2025: ")
  t = t.replace(/^[\d,.]+[kKmM]?\s*likes?,\s*[\d,.]+[kKmM]?\s*comments?\s*[-–—]\s*\S+\s+on\s+[^:]+:\s*[""]?/im, '');
  t = t.replace(/^[\d,.]+[kKmM]?\s*(likes?|comments?|views?|shares?|saves?)\s*[,·•|]+\s*/im, '');

  // 5. Strip video timestamps (e.g. "2:30 - Add the garlic")
  t = t.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*[-–—:]\s*/gm, '');
  t = t.replace(/\bat\s+\d{1,2}:\d{2}(?::\d{2})?\s*/gi, '');

  // 6. Strip inline @mentions (keep rest of line)
  t = t.replace(/@[\w.]+/g, '');

  // 7. Strip inline #hashtags (keep rest of line so recipe text survives)
  t = t.replace(/#[\w.]+/g, '');

  // 8. Strip bare URLs
  t = t.replace(/https?:\/\/\S+/g, '');

  // 9. Strip Instagram/TikTok UI chrome that leaks into scraped text
  t = t.replace(/^(verified|view profile|follow|following|message|share profile|send message)\s*$/gim, '');
  t = t.replace(/verified\s*[·•]\s*(view\s+profile|follow)/gi, '');
  t = t.replace(/^\d+[\s,]*(likes?|followers?|following|comments?|views?|saves?)\s*$/gim, '');

  // 10. Strip soft CTA lines ("watch the full video", "see recipe below", etc.)
  // ⚠️  Be surgical: only strip if the line is CLEARLY a CTA, not cooking narration.
  //     "watch the garlic", "see how it thickens" should survive.
  //     Match only when the line starts with a CTA trigger AND ends with a CTA-shaped phrase.
  t = t.replace(/^(watch the full (video|reel|recipe)|see (the )?(full |original )?recipe|check (out )?(the )?(full |my )?recipe|full recipe (is |in |at |below|on)|recipe (is |in |at |below|available)|swipe (up|left|right) for|tap (the )?(link|here)|link in bio for).{0,80}$/gim, '');

  // 11. Normalize whitespace
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/^[\s,;|·•–—]+$/gm, '');

  return t.trim();
}

/**
 * isCaptionWeak — returns true if the caption is too thin to contain a full
 * recipe on its own. Triggers early yt-dlp subtitle fallback in BrowserAssist.
 */
export function isCaptionWeak(text) {
  if (!text || text.trim().length < 20) return true;
  const cleaned = cleanSocialCaption(text);
  // Very short after cleaning → definitely weak
  if (cleaned.length < 50) return true;

  // Recipe signals: units/measurements + food words + cooking verbs
  const hasIngredientSignal = UNITS_RE.test(cleaned) || FOOD_RE.test(cleaned);
  const hasDirectionSignal = COOKING_VERBS_RE.test(cleaned);

  // Strong caption: has both ingredient AND direction signals → always good
  if (hasIngredientSignal && hasDirectionSignal) return false;

  // Medium caption with at least one signal and reasonable length → accept
  // Narrated Reels often have 100–200 chars of real content but only one signal type
  if ((hasIngredientSignal || hasDirectionSignal) && cleaned.length >= 120) return false;

  // Short single-signal caption → weak
  if (cleaned.length < 200 && !(hasIngredientSignal && hasDirectionSignal)) return true;

  return false;
}

// ─── Caption Parser wrapper (used by BrowserImport) ─────────────────────────
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

// ─── Client-side Google AI (Gemini) — direct browser call ───────────────────
// Uses VITE_GOOGLE_AI_KEY if set. Runs in the browser without a backend hop,
// giving faster results and working even when the backend server is cold/offline.
// The API key is bundled into the client build — acceptable for personal/family apps.
export async function structureWithAIClient(rawText, { title: hintTitle = '', imageUrl = '', sourceUrl = '' } = {}) {
  const clientKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_GOOGLE_AI_KEY : null;
  if (!clientKey || !rawText || rawText.trim().length < 20) return null;

  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${clientKey}`;

  const prompt = `You are a ReciME-style recipe extraction assistant. Extract a clean, structured recipe from the following text (from an Instagram caption, TikTok description, YouTube video, or recipe blog).

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "title": "string — concise recipe name, no hashtags, no emojis, no brand names",
  "ingredients": [{ "name": "string", "amount": "string — e.g. '2 cups' or 'to taste'" }],
  "directions": ["string — one clear cooking step per array item, written as an instruction"],
  "servings": "string or null",
  "cookTime": "string or null",
  "notes": "string or null"
}

Extraction rules (follow strictly):
- TITLE: Extract the dish name only. Remove phrases like "on Instagram", "@username", hashtags.
- INGREDIENTS: Each item = one ingredient with its measurement. Normalize fractions (½ → 1/2).
- DIRECTIONS: Each step = one action. Split compound steps at ". Then" / ". Next" / sentence breaks.
- CLEANING: Aggressively remove social chrome — hashtags, @mentions, "link in bio", "save this recipe", "follow me", sponsor disclosures, timestamps, view counts, and any text that isn't part of the recipe.
- SORTING: Lines with measurements + food words → ingredients[]. Lines with cooking verbs (mix, bake, sauté, etc.) → directions[].
- If the text contains a spoken/narrated recipe (video transcript), extract the recipe the speaker is describing.
- If no recipe can be found at all, return: { "error": "not a recipe" }
${hintTitle ? `\nDish name hint: "${hintTitle}"` : ''}

Text to parse:
---
${rawText.slice(0, 7000)}
---`;

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    if (parsed.error) return null;
    const ingredients = Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map(ing => typeof ing === 'string' ? ing : [ing.amount, ing.name].filter(Boolean).join(' ').trim()).filter(Boolean)
      : [];
    return {
      name: parsed.title || hintTitle || 'Imported Recipe',
      ingredients: ingredients.length > 0 ? ingredients : ['See original post for ingredients'],
      directions: Array.isArray(parsed.directions) && parsed.directions.length > 0
        ? parsed.directions : ['See original post for directions'],
      servings: parsed.servings || null,
      cookTime: parsed.cookTime || null,
      notes: parsed.notes || null,
      imageUrl: imageUrl || '',
      link: sourceUrl || '',
      _aiStructured: true,
      _structuredVia: 'gemini-client',
    };
  } catch {
    return null;
  }
}

// ─── AI-powered structuring via server /api/structure-recipe (Gemini Flash) ───
// Falls back to direct client call if VITE_GOOGLE_AI_KEY is configured.
// Returns a SpiceHub recipe object on success, null if unavailable.
export async function structureWithAI(rawText, { title: hintTitle = '', imageUrl = '', sourceUrl = '' } = {}) {
  if (!rawText || rawText.trim().length < 20) return null;

  // Try client-side Gemini first (faster, no backend roundtrip)
  try {
    const clientResult = await structureWithAIClient(rawText, { title: hintTitle, imageUrl, sourceUrl });
    if (clientResult) return clientResult;
  } catch { /* fall through to server */ }

  try {
    const serverBase = typeof window !== 'undefined' && window.__SPICEHUB_SERVER__ ? window.__SPICEHUB_SERVER__ : 'http://localhost:3001';
    const res = await fetch(`${serverBase}/api/structure-recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, title: hintTitle, imageUrl }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok || !data.recipe) return null;
    const r = data.recipe;
    // Normalize ingredients — Gemini returns [{name, amount}], SpiceHub uses strings
    const ingredients = Array.isArray(r.ingredients)
      ? r.ingredients.map(ing => {
        if (typeof ing === 'string') return ing;
        return [ing.amount, ing.name].filter(Boolean).join(' ').trim();
      }).filter(Boolean)
      : [];
    return {
      name: r.title || hintTitle || 'Imported Recipe',
      ingredients: ingredients.length > 0 ? ingredients : ['See original post for ingredients'],
      directions: Array.isArray(r.directions) && r.directions.length > 0
        ? r.directions
        : ['See original post for directions'],
      servings: r.servings || null,
      cookTime: r.cookTime || null,
      notes: r.notes || null,
      imageUrl: imageUrl || '',
      link: sourceUrl || '',
      _aiStructured: true,
    };
  } catch {
    return null;
  }
}

// ─── captionToRecipe: Gemini-first structuring with heuristic fallback ────────
// Takes raw caption text and returns a structured recipe object.
// Used by BrowserAssist Pass 0 and extractInstagramAgent to get clean results.
export async function captionToRecipe(captionText, { title = '', imageUrl = '', sourceUrl = '' } = {}) {
  if (!captionText || captionText.trim().length < 20) return null;

  // ReciME-style: aggressively clean social chrome before sending to AI
  const cleanedCaption = cleanSocialCaption(captionText);
  const textForAI = cleanedCaption.length >= 20 ? cleanedCaption : captionText;

  // Try Gemini AI structuring first (most reliable for social media captions)
  try {
    const aiResult = await structureWithAI(textForAI, { title, imageUrl, sourceUrl });
    if (aiResult) {
      const hasRealIngs = (aiResult.ingredients || []).some(i => i && !/^see (original post|recipe) for/i.test(i.trim()));
      const hasRealDirs = (aiResult.directions || []).some(d => d && !/^see (original post|recipe) for/i.test(d.trim()));
      if (hasRealIngs || hasRealDirs) return { ...aiResult, _structuredVia: 'gemini' };
    }
  } catch { /* fall through to heuristic */ }

  // Heuristic fallback: parseCaption on cleaned text
  const parsed = parseCaption(textForAI);
  if (!parsed) return null;

  const name = parsed.title || title || '';
  const ingredients = parsed.ingredients?.length > 0 ? parsed.ingredients : [];
  const directions = parsed.directions?.length > 0 ? parsed.directions : [];

  if (ingredients.length === 0 && directions.length === 0) return null;

  return {
    name,
    ingredients,
    directions,
    imageUrl,
    link: sourceUrl,
    _structuredVia: 'heuristic',
  };
}

// ─── Caption Parser (Paprika-style 4-pass, enhanced for video content) ─────────
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
  // Convert "🥕 2 carrots" into "- 2 carrots" for better bullet detection
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
  text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]\s*/gm, '');
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
  const ABBREV_RE = /^[\d½¼¾⅓⅔][\d./]*\s*[a-z]{1,4}\s+\w+(?:\s*,\s*[\d½¼¾⅓⅔][\d./]*\s*[a-z]{1,4}\s+\w+){2,}/i;
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
    let cleanLine = line.replace(/#\w[\w.]*/g, '').replace(/@\w+/g, '').trim();
    if (!cleanLine) continue;

    // Extract title from the first meaningful line before any section
    if (title === null && !inIngredients && !inDirections && !foundSections) {
      const isBulletOrNum = BULLET_RE.test(cleanLine) || STEP_NUM_RE.test(cleanLine);
      if (!isBulletOrNum && cleanLine.length > 3 && !looksLikeIngredient(cleanLine)) {
        let titleCandidate = cleanLine;

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
      const looksIng = looksLikeIngredient(cleanLine);
      const looksDir = looksLikeDirection(cleanLine);

      // Only switch modes if the signal is clear — avoid misclassification
      if (looksIng && !looksDir) {
        // Extra check: if line contains a cooking verb AND a measurement, it's ambiguous
        // e.g. "Add 2 cups flour" — this is a direction that mentions an ingredient
        if (COOKING_VERBS_RE.test(cleanLine) && cleanLine.length > 40) {
          // Long line with cooking verb — treat as direction even if it has measurements
          inIngredients = false; inDirections = true;
        } else {
          inIngredients = true; inDirections = false;
        }
      }
      else if (looksDir && !looksIng) { inIngredients = false; inDirections = true; }
      // If both look true, use length as tiebreaker: short = ingredient, long = direction
      else if (looksIng && looksDir) {
        if (cleanLine.length < 50) { inIngredients = true; inDirections = false; }
        else { inIngredients = false; inDirections = true; }
      }
    }

    // Clean prefix markers
    // First strip bullet markers (but preserve what follows, including leading numbers)
    let cleaned = cleanLine
      .replace(/^[-•*▪▸►◦‣⁃✓✔]\s*/, '');
    // Only strip leading numbers when followed by punctuation delimiter (step numbers like "1." or "2)")
    // NOT when followed by a space + unit (ingredient quantities like "2 tbsp")
    cleaned = cleaned.replace(/^\d+[.):-]\s*/, '').trim();
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

// ─── Speech transcript parser (for yt-dlp subtitle content) ──────────────────
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

  // Split transcript into sentences — handle both period-separated and natural speech
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
    // Remove "... | Instagram" / "... - TikTok" / "... - YouTube" suffix
    .replace(/\s*[|\-–—•]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube|Reels?).*$/i, '')
    .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
    // Remove social handle prefixes: "Chris • Ⓥ | " or "@username: "
    .replace(/^[^|]*[•\u24cb\u24b6-\u24E9][^|]*\|\s*/u, '')
    .replace(/^@[\w.]+[:\s]+/i, '')
    // Remove handles and hashtags
    .replace(/\s*\(@[\w.]+\).*$/, '')
    .replace(/#\w[\w.]*/g, '')
    // Remove "Reel by username" etc.
    .replace(/^(Reel|Video|Post)\s+by\s+[\w.]+\s*[-–—:.]?\s*/i, '')
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
    const parts = title.split(/\s*[|\-–—]\s*/);
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

// ─── Flexible instruction parser (Mealie-inspired) ──────────────────────────
// Handles the many formats recipe sites use for instructions:
//   - Array of strings
//   - Array of { text: "..." } objects (HowToStep)
//   - Array of { "@type": "HowToSection", itemListElement: [...] }
//   - A single string (newline-separated or JSON-encoded)
//   - Dict-indexed objects { "0": { text: "..." }, "1": { text: "..." } }
function parseInstructionsFlexible(inst) {
  if (!inst) return [];

  // String — could be newline-separated or a JSON string
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

      // HowToSection — flatten nested itemListElement
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
 * Strip HTML, decode entities, collapse whitespace — loop until stable.
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

  // Directions — Mealie-inspired comprehensive parsing:
  // Handles HowToStep, HowToSection, plain strings, JSON strings,
  // dict-indexed steps, and newline-separated blocks.
  let directions = [];
  const inst = node.recipeInstructions;
  directions = parseInstructionsFlexible(inst);

  // Image — Mealie-inspired: pick the best/largest from multiple candidates
  const imageUrl = selectBestImage(node.image);

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

// ─── CORS proxy cascade (fully client-side, no server needed) ─────────────────
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchHtmlViaProxy(url, timeoutMs = 15000) {
  for (const makeProxy of PROXIES) {
    const proxyUrl = makeProxy(url);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text.includes('Log in') && text.includes('instagram') && text.length < 20000) {
        continue; // Instagram login wall — try next proxy
      }
      if (text.length < 500) continue; // Likely an error page
      return text;
    } catch { /* try next proxy */ }
  }
  return null;
}

// ─── Instagram embed extraction (client-side via CORS proxy) ──────────────────
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
      const candidate = await fetchHtmlViaProxy(embedUrl, 18000);
      if (candidate && candidate.length > 3000) {
        html = candidate;
        console.log(`[instagram-embed] Got response from: ${embedUrl}`);
        break;
      }
    }
    if (!html) html = await fetchHtmlViaProxy(embedUrls[0], 18000); // final fallback
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
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (text && text.length > 15) { caption = text; break; }
      }
    }
    // JSON data fallback — multiple 2026 Instagram patterns
    if (!caption) {
      const dataPatterns = [
        // 2024/2025 SFX JSON payload: "caption":{"text":"…"}
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

    // Extract image
    let imageUrl = extractMeta(html, 'og:image') || '';
    if (!imageUrl) {
      const imgPatterns = [
        /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.jpg[^"]*)"/i,
        /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
        /"display_url"\s*:\s*"(https:[^"]+)"/i,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
      ];
      for (const re of imgPatterns) {
        const m = re.exec(html);
        if (m) { imageUrl = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&'); break; }
      }
    }

    // Extract title
    let title = cleanTitle(extractMeta(html, 'og:title') || '');

    // If embed page gave nothing, try Instagram oEmbed (public, no auth needed)
    if (!caption) {
      try {
        const oEmbedUrl = `https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}&format=json`;
        const oEmbedHtml = await fetchHtmlViaProxy(oEmbedUrl, 8000);
        if (oEmbedHtml && oEmbedHtml.length > 10) {
          const oData = JSON.parse(oEmbedHtml);
          if (oData?.title && oData.title.length > 10) {
            caption = oData.title;
            if (!title) title = oData.author_name || '';
            if (!imageUrl && oData.thumbnail_url) imageUrl = oData.thumbnail_url;
            console.log(`[instagram-embed] oEmbed fallback success — ${caption.length} chars`);
          }
        }
      } catch { /* oEmbed not available */ }
    }

    if (!caption && !title) { console.log('[instagram-embed] No data found'); return null; }

    console.log(`[instagram-embed] Success — caption: ${caption.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);
    return { ok: true, type: 'caption', caption: stripSocialMetaPrefix(caption), title, imageUrl, sourceUrl: url };
  } catch (e) {
    console.log(`[instagram-embed] Error: ${e.message}`);
    return null;
  }
}

// ─── Convert embed extraction result → recipe format ─────────────────────────
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

// ── Server API helpers for unified pipeline ──────────────────────────────────
// The server (server/index.js) provides yt-dlp and headless Chrome capabilities.
// These are optional — if the server is unavailable, we fall back to client-side.

let _serverBaseUrl = null;
let _serverChecked = false;

/**
 * Detect the SpiceHub server URL. Tries common locations.
 * Returns base URL string or null if server is not available.
 */
async function detectServer() {
  if (_serverChecked) return _serverBaseUrl;
  _serverChecked = true;

  // Vite injects VITE_SERVER_URL as __SPICEHUB_SERVER__ at build time
  const buildTimeUrl = (typeof __SPICEHUB_SERVER__ !== 'undefined' && __SPICEHUB_SERVER__ !== 'http://localhost:3001')
    ? __SPICEHUB_SERVER__ : null;

  const candidates = [
    buildTimeUrl,
    // Same origin (if deployed together)
    window.location.origin,
    // Local dev
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ].filter(Boolean);

  for (const base of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(`${base}/api/status`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) {
          _serverBaseUrl = base;
          console.log(`[SpiceHub] Server found at ${base} (yt-dlp: ${data.ytdlpAvailable ? 'yes' : 'no'})`);
          return _serverBaseUrl;
        }
      }
    } catch { /* try next */ }
  }

  console.log('[SpiceHub] No server found — using client-side only');
  return null;
}

/** Reset server detection (e.g. after network change) */
export function resetServerDetection() {
  _serverBaseUrl = null;
  _serverChecked = false;
}

/**
 * Try dedicated video extraction endpoint (/api/extract-video).
 * This uses yt-dlp metadata + subtitles — faster and more targeted than
 * the general /api/extract-url endpoint for video/social URLs.
 * Returns parsed recipe object or null.
 */
/**
 * Try to parse comma-delimited Instagram-style ingredient lists.
 * Instagram captions often list ingredients as: "2 eggs, 1 cup flour, butter, salt"
 * or use emoji separators: "🥚 2 eggs 🧈 butter 🧀 cheese"
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

    // Check for emoji-separated ingredients (🥚 2 eggs 🧈 butter)
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
      directions.push(line.replace(/^[-•*▪▸►◦‣⁃✓✔🔸🔹]\s*/, '').replace(/^\d+[.):-]\s*/, '').trim());
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
  const SPOKEN_DIRECTION_RE = /\b(?:preheat|mix|stir|cook|bake|fry|saut[ée]|boil|simmer|chop|dice|slice|fold|whisk|pour|drain|season|sprinkle|spread|roll|knead|let it|set aside|cover|flip|turn|remove|place|combine|toss|serve|plate|garnish)\b/i;

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
      // Sentence mentions quantities but no cooking verbs — likely ingredient listing
      const clean = sentence.replace(/^(?:and\s+|also\s+|plus\s+)/i, '').trim();
      if (clean.length > 3 && clean.length < 120) ingredients.push(clean);
    } else if (hasAction) {
      // Sentence has cooking verbs — it's a direction
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

export async function tryVideoExtraction(url, onProgress) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Connecting to extraction server...');
    const ctrl = new AbortController();
    // 50s timeout — Render.com free tier cold starts take ~30s; give it headroom
    const timer = setTimeout(() => ctrl.abort(), 50000);

    if (onProgress) onProgress('Downloading video metadata & subtitles...');
    const resp = await fetch(`${serverUrl}/api/extract-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok) return null;

    if (onProgress) {
      if (data.hasSubtitles) onProgress('Parsing subtitles for recipe...');
      else onProgress('Parsing video description for recipe...');
    }

    // ── Priority 1: Subtitle text (spoken transcript from video) ──
    // Subtitles are the richest source — the creator speaks the full recipe
    let parsed = { ingredients: [], directions: [], title: '' };
    let source = 'description';

    if (data.subtitleText && data.subtitleText.length > 30) {
      source = 'subtitles';
      if (onProgress) onProgress('Extracting recipe from subtitles...');

      // Try structured parsing first (works if subtitles have some structure)
      parsed = parseCaption(data.subtitleText);

      // Spoken-word transcripts need special handling
      if (parsed.ingredients.length <= 1 || parsed.directions.length <= 1) {
        const spoken = parseSpokenTranscript(data.subtitleText);
        if (spoken) {
          if (spoken.ingredients.length > parsed.ingredients.length) parsed.ingredients = spoken.ingredients;
          if (spoken.directions.length > parsed.directions.length) parsed.directions = spoken.directions;
        }
      }

      // smartClassifyLines as another fallback
      if (parsed.ingredients.length === 0 || parsed.directions.length === 0) {
        const lines = data.subtitleText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 3) {
          const classified = smartClassifyLines(lines);
          if (classified.ingredients.length > parsed.ingredients.length) parsed.ingredients = classified.ingredients;
          if (classified.directions.length > parsed.directions.length) parsed.directions = classified.directions;
        }
      }
    }

    // ── Priority 2: Caption/description text ──
    const captionText = data.combinedText || data.description || '';
    if (captionText.length > 15) {
      if (onProgress && source !== 'subtitles') onProgress('Parsing caption text...');

      const captionParsed = parseCaption(captionText);

      // Merge: prefer whichever source gave more results
      if (captionParsed.ingredients.length > parsed.ingredients.length) {
        parsed.ingredients = captionParsed.ingredients;
      }
      if (captionParsed.directions.length > parsed.directions.length) {
        parsed.directions = captionParsed.directions;
      }
      if (!parsed.title && captionParsed.title) parsed.title = captionParsed.title;

      // smartClassifyLines fallback on caption
      if (parsed.ingredients.length === 0 || parsed.directions.length === 0) {
        const lines = captionText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 3) {
          const classified = smartClassifyLines(lines);
          if (classified.ingredients.length > parsed.ingredients.length) parsed.ingredients = classified.ingredients;
          if (classified.directions.length > parsed.directions.length) parsed.directions = classified.directions;
        }
      }

      // Comma-delimited ingredients (common in Instagram)
      if (parsed.ingredients.length <= 1 && parsed.directions.length <= 1) {
        const commaParsed = tryCommaDelimitedParse(captionText);
        if (commaParsed) {
          if (commaParsed.ingredients.length > parsed.ingredients.length) parsed.ingredients = commaParsed.ingredients;
          if (commaParsed.directions.length > parsed.directions.length) parsed.directions = commaParsed.directions;
        }
      }
    }

    // Build recipe if we have any content
    if (parsed.ingredients.length > 0 || parsed.directions.length > 0 || captionText.length > 15) {
      const recipe = {
        name: data.title ? cleanTitle(data.title) : (parsed.title || 'Imported Recipe'),
        ingredients: parsed.ingredients.length > 0
          ? parsed.ingredients
          : ['See original post for ingredients'],
        directions: parsed.directions.length > 0
          ? parsed.directions
          : ['See original post for directions'],
        imageUrl: data.thumbnail || '',
        link: data.sourceUrl || url,
        _extractedVia: data.hasSubtitles ? 'yt-dlp-subtitles' : (data.extractedVia || 'video-endpoint'),
        _hasSubtitles: data.hasSubtitles || false,
        _platform: data.platform || '',
        _isShortForm: data.isShortForm || false,
      };

      if (data.hasSubtitles) {
        console.log(`[SpiceHub] Subtitle-first extraction: ${data.subtitleText.length} chars → ${parsed.ingredients.length} ing, ${parsed.directions.length} dir`);
      }

      return recipe;
    }

    // Partial result: title + thumbnail but no recipe text
    if (data.title) {
      return {
        name: cleanTitle(data.title),
        ingredients: ['See original post for ingredients'],
        directions: ['See original post for directions'],
        imageUrl: data.thumbnail || '',
        link: data.sourceUrl || url,
        _extractedVia: data.extractedVia || 'video-endpoint',
        _hasSubtitles: false,
        _platform: data.platform || '',
      };
    }

    return null;
  } catch (e) {
    console.log(`[SpiceHub] Video extraction error: ${e.message}`);
    return null;
  }
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
export async function extractInstagramAgent(url, onProgress) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Loading post on server...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 50000);

    const resp = await fetch(`${serverUrl}/api/extract-instagram-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok || data.type === 'none') return null;

    const rawCaption = data.caption || '';
    const rawTitle = data.title || '';

    // JSON-LD (recipe blog structured data) — parse directly
    if (data.type === 'jsonld' && data.recipe) {
      const r = data.recipe;
      const ings = normalizeInstructions(r.recipeIngredient || []);
      const dirs = normalizeInstructions(
        Array.isArray(r.recipeInstructions)
          ? r.recipeInstructions.map(s => (typeof s === 'string' ? s : s.text || s.name || ''))
          : []
      );
      return {
        name: cleanTitle(r.name || rawTitle),
        ingredients: ings.length > 0 ? ings : [],
        directions: dirs.length > 0 ? dirs : [],
        imageUrl: data.imageUrl || '',
        imageUrls: data.imageUrls || [],
        link: url,
        _extractedVia: 'agent-jsonld',
      };
    }

    // Caption text — structure with Gemini-first via captionToRecipe
    if (onProgress) onProgress('Analyzing recipe content...');

    // Priority: subtitle text first (Reels transcript), then caption
    const textToStructure = (data.subtitleText && data.subtitleText.length > 50)
      ? `${data.subtitleText}\n${rawCaption}`
      : rawCaption;

    if (!textToStructure || textToStructure.length < 15) return null;

    const structured = await captionToRecipe(textToStructure, {
      title: rawTitle,
      imageUrl: data.imageUrl || '',
      sourceUrl: url,
    });

    if (structured) {
      return {
        ...structured,
        imageUrl: data.imageUrl || structured.imageUrl || '',
        imageUrls: data.imageUrls || [],
        link: url,
        _extractedVia: `agent-${structured._structuredVia || 'auto'}`,
        _hasSubtitles: !!(data.subtitleText),
      };
    }

    return null;
  } catch (e) {
    console.log(`[SpiceHub] Agent extraction error: ${e.message}`);
    return null;
  }
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
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl: imageUrl || '',
  };
}

/**
 * Main entry: parse recipe from a URL.
 * Mealie-inspired unified pipeline — tries multiple strategies automatically.
 *
 * Strategy (in order):
 *   1. Instagram URLs → embed extraction, then server (yt-dlp + Chrome)
 *   2. Video/Social URLs → server (yt-dlp metadata + subtitles), then CORS proxy
 *   3. Recipe blogs → CORS proxy + JSON-LD / microdata / CSS heuristics
 *   4. All strategies exhausted → guide user to Paste Text
 *
 * @param {string} url - The URL to import from
 * @param {function} onProgress - Optional callback for progress updates
 * Returns { name, ingredients, directions, link, imageUrl }
 *      or { _error: true, reason } on failure
 *      or null if completely failed
 */
export async function parseFromUrl(url, onProgress) {

  // ── 1. Instagram: try embed first, then Agent extraction ──
  if (isInstagramUrl(url)) {
    console.log('[SpiceHub] Instagram URL — trying embed extraction...');
    if (onProgress) onProgress('Trying Instagram embed extraction...');

    // Try client-side embed extraction first (fastest)
    const embedResult = await extractInstagramEmbed(url);
    if (embedResult && embedResult.ok && embedResult.caption && embedResult.caption.length > 20) {
      const recipe = handleEmbedResult(embedResult, url);
      if (recipe && recipe.ingredients[0] !== 'See original post for ingredients') {
        return recipe;
      }
    }

    // Try dedicated Agent extraction (agent-browser + vision)
    if (onProgress) onProgress('Trying Agent Browser extraction...');
    const agentResult = await extractInstagramAgent(url, onProgress);
    if (agentResult && !agentResult._error && agentResult.ingredients?.[0] !== 'See original post for ingredients') {
      return agentResult;
    }

    // If agent fails or only returns partial, we can try video endpoint (yt-dlp)
    if (onProgress) onProgress('Trying video extraction (yt-dlp)...');
    const videoResult = await tryVideoExtraction(url, onProgress);
    if (videoResult && !videoResult._error) return videoResult;

    // Use partial agent result if available
    if (agentResult && !agentResult._error) return agentResult;

    // Instagram all paths failed — route to BrowserAssist
    console.log('[SpiceHub] Instagram extraction failed — routing to BrowserAssist');
    return null;
  }

  // ── 2. Video/Social URLs: try Agent extraction, then yt-dlp, then CORS proxy ──
  if (isSocialMediaUrl(url)) {
    console.log('[SpiceHub] Social/video URL — trying extraction pipeline...');

    // Step A: Agent Browser (Full DOM parsing, carousels, subtitles)
    if (onProgress) onProgress('Trying Agent Browser extraction...');
    const agentResult = await extractInstagramAgent(url, onProgress);
    if (agentResult && !agentResult._error && agentResult.ingredients?.[0] !== 'See original post for ingredients') {
      return agentResult;
    }

    // Step B: Try dedicated /api/extract-video endpoint (yt-dlp metadata + subtitles)
    if (onProgress) onProgress('Extracting video metadata and subtitles...');
    const videoResult = await tryVideoExtraction(url, onProgress);
    if (videoResult && !videoResult._error) return videoResult;

    // Step C: Fallback to partial agent result
    if (agentResult && !agentResult._error) return agentResult;

    // Fallback: CORS proxy (sometimes works for public pages)
    if (onProgress) onProgress('Trying direct extraction...');
    try {
      const html = await fetchHtmlViaProxy(url);
      if (html) {
        const recipe = parseHtml(html, url);
        if (recipe) return recipe;
      }
    } catch {
      console.log('[SpiceHub] Social media CORS proxy failed');
    }

    return { _error: true, reason: 'social-fetch-failed', platform: getSocialPlatform(url) };
  }

  // ── 3. Recipe blogs: CORS proxy first (fast), server fallback ──
  console.log('[SpiceHub] Fetching recipe via CORS proxy...');
  if (onProgress) onProgress('Extracting recipe from page...');
  try {
    const html = await fetchHtmlViaProxy(url);
    if (html) {
      const recipe = parseHtml(html, url);
      if (recipe) return recipe;
    }
  } catch (e) {
    console.log('[SpiceHub] CORS proxy failed:', e.message);
  }

  // CORS proxy failed — try server-side extraction as fallback
  if (onProgress) onProgress('Trying server-side extraction...');
  const serverResult = await tryServerExtraction(url, onProgress);
  if (serverResult && !serverResult._error) return serverResult;

  // ── 4. All methods exhausted ──
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
  // 1. JSON-LD (best, most reliable)
  const [jsonLdRecipe] = findJsonLdRecipes(html);
  if (jsonLdRecipe) {
    return { ...jsonLdRecipe, link: sourceUrl };
  }

  // 2. Microdata (itemprop/itemtype)
  const microdataRecipe = extractMicrodataFromHtml(html);
  if (microdataRecipe) {
    return { ...microdataRecipe, link: sourceUrl };
  }

  // 3. Heuristic CSS class matching (WPRM, Tasty, etc.)
  const heuristicRecipe = extractRecipeByCSS(html);
  if (heuristicRecipe) {
    return { ...heuristicRecipe, link: sourceUrl };
  }

  // 4. Meta tags fallback
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

// ── Client-side Microdata extraction ──────────────────────────────────────────
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
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
  };
}

// ── Client-side heuristic CSS class extraction ─────────────────────────────────
function extractRecipeByCSS(html) {
  const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Look for popular recipe plugin patterns
  const ingPatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*ingredient-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
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
    /class\s*=\s*["'][^"']*wprm-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*step-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
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
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl: extractMeta(html, 'og:image') || '',
  };
}

// ── Extract recipe from DOM (used by BrowserAssist for visible page content) ──────
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
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
    link: sourceUrl,
  };
}

// ── Helper: Classify DOM lines into ingredients vs directions ──
// Mutates recipe.ingredients and recipe.directions in place.
function classifyDOMLines(lines, recipe) {
  // Measurement units that strongly indicate ingredients
  const UNIT_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|cloves?|cans?|packages?|sticks?|slices?|bunch)\b/i;
  // Fractions at start of line strongly indicate ingredients
  const STARTS_WITH_NUM = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/;
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
    // Short lines without clear signal — guess ingredient
    else {
      recipe.ingredients.push(trimmed);
    }
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED RECIPE EXTRACTION FUNCTIONS (Production-Ready)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect recipe plugins and structured markup in DOM/HTML content.
 *
 * Recognizes:
 *   - WPRM (WP Recipe Maker) — .wprm-recipe, data-json
 *   - Tasty Recipes — .tasty-recipes, schema.org JSON-LD
 *   - EasyRecipe — .EasyRecipeType
 *   - Schema.org Recipe — JSON-LD @type: Recipe
 *   - Semantic HTML — <article>, <section> with microdata/aria labels
 *   - Common CSS patterns — recipe-ingredient, recipe-instruction, etc.
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

  // ── WPRM (WP Recipe Maker) Detection ──
  const wprmContainer = doc.querySelector('.wprm-recipe, [data-wprm-recipe]');
  if (wprmContainer) {
    const result = extractWPRM(wprmContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'wprm', ...result };
    }
  }

  // ── Tasty Recipes Detection ──
  const tastyContainer = doc.querySelector('.tasty-recipes, [data-tasty-recipe]');
  if (tastyContainer) {
    const result = extractTastyRecipes(tastyContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'tasty', ...result };
    }
  }

  // ── EasyRecipe Detection ──
  const easyRecipeContainer = doc.querySelector('.EasyRecipeType, [itemtype*="Recipe"]');
  if (easyRecipeContainer) {
    const result = extractEasyRecipe(easyRecipeContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'easyrecipe', ...result };
    }
  }

  // ── JSON-LD Recipe Detection (Schema.org) ──
  const jsonldResult = extractJsonLdRecipe(doc);
  if (jsonldResult.ingredients.length > 0 || jsonldResult.directions.length > 0) {
    return { type: 'jsonld', ...jsonldResult };
  }

  // ── Semantic HTML + Microdata Detection ──
  const semanticResult = extractSemanticRecipe(doc);
  if (semanticResult.ingredients.length > 0 || semanticResult.directions.length > 0) {
    return { type: 'semantic', ...semanticResult };
  }

  // ── Common CSS pattern detection ──
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

  const type = (obj['@type'] || '').toString().toLowerCase();
  if (type.includes('recipe')) return obj;

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

  // Instructions can be string array or objects with @type: RecipeInstructions
  if (recipe.recipeInstructions) {
    const instrs = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [recipe.recipeInstructions];
    for (const instr of instrs) {
      if (typeof instr === 'string') {
        directions.push(instr);
      } else if (instr.text) {
        directions.push(instr.text);
      } else if (instr.itemListElement && Array.isArray(instr.itemListElement)) {
        for (const item of instr.itemListElement) {
          if (item.text) directions.push(item.text);
        }
      }
    }
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
  text = text.replace(/^[-•*▪▸►◦‣⁃✓✔]\s*/, '').trim();

  // Remove numbered list markers (1., 1), 1:) but NOT bare numbers followed by space+unit (quantities)
  text = text.replace(/^\d+[.):-]\s*/, '').trim();

  // Match quantity + unit pattern
  // Quantity: decimal numbers, fractions (1/2, ⅓), unicode fractions
  const quantityUnitPattern = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s-]*?)\s+(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|pinches|dash|dashes|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|handfuls|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|counts?)\b/i;

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
  const quantityOnlyPattern = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s-]*?)\s+/;
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

  // No quantity/unit detected — entire line is ingredient name
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
  const STRONG_INGREDIENT_PATTERN = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s]*\s+)?(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|packages?|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|pieces?)\b/i;

  const DIRECTION_KEYWORD_START = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|you'?re? gonna|go ahead|now (?:we|you|I)|take (?:your|the)|grab (?:your|the)|throw|once|when|after|carefully|gently|slowly|continue|allow|until|while)\b/i;

  const NUMBERED_STEP = /^\d+[.):\s-]/;
  const BULLET_POINT = /^[-•*▪▸►◦‣⁃]/;

  // Timestamp pattern: "2:30" or "0:00:15" — strip these from lines (common in video descriptions)
  const TIMESTAMP_PREFIX = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:.]?\s*/;

  // Filler lines common in video descriptions
  const VIDEO_FILLER_RE = /^(follow me|subscribe|like and subscribe|link in bio|comment below|tag a friend|save this|share this|check out|don't forget|make sure to|music:|song:|audio:|outfit:|shop:|affiliate|#\w+\s*$|@\w+\s*$)/i;

  let inIngredientsSection = false;
  let inDirectionsSection = false;

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Strip timestamp prefixes (e.g. "2:30 Add the garlic" → "Add the garlic")
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

    // Strong signals
    if (hasStrongIngredientPattern && !hasDirectionKeyword) {
      ingredients.push(trimmed);
    } else if ((hasNumberedStep || hasDirectionKeyword) && length > 20) {
      directions.push(trimmed);
    } else if (hasBulletPoint && !hasDirectionKeyword && !hasNumberedStep) {
      // Bullets without clear direction signal — likely ingredients
      ingredients.push(trimmed);
    } else if (hasDirectionKeyword) {
      directions.push(trimmed);
    } else if (length > 80 && !FOOD_RE.test(trimmed)) {
      // Very long lines without food words are probably directions
      directions.push(trimmed);
    } else if (length < 50 && FOOD_RE.test(trimmed)) {
      // Short line with food keywords → ingredient
      ingredients.push(trimmed);
    } else if (hasNumberedStep) {
      directions.push(trimmed);
    } else if (length > 60 && /[,.]/.test(trimmed) && FOOD_RE.test(trimmed)) {
      // Long line WITH food words and punctuation — could be ingredient list
      ingredients.push(trimmed);
    } else if (length > 60) {
      // Long lines default to directions
      directions.push(trimmed);
    } else {
      // Default: short unknown lines → ingredients, long ones → directions
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
  const quantifiedIngs = realIngs.filter(i => /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(i.trim()));
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

    // Ambiguous — use length and food words as tiebreaker
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

  // ── Step 1: Try to detect recipe plugins/structured markup ──
  if (html) {
    const pluginResult = detectRecipePlugins(html);
    if (pluginResult.type && (pluginResult.ingredients.length > 0 || pluginResult.directions.length > 0)) {
      return {
        name: cleanTitle(pluginResult.title || 'Recipe'),
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

  // ── Helper: extract title from HTML meta tags ──
  function extractTitleFromHtml() {
    if (!html) return '';
    const ogTitle = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i);
    if (ogTitle?.[1]) return ogTitle[1].trim();
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag?.[1]) return titleTag[1].trim();
    return '';
  }

  // ── Step 2: Try parseCaption on visible text (leverages existing heuristics) ──
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

    // ── Step 3: Use smart line classification as fallback ──
    const lines = visibleText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);

    if (lines.length > 0) {
      const classified = smartClassifyLines(lines);
      if (classified.ingredients.length > 0 || classified.directions.length > 0) {
        return {
          name: cleanTitle('Recipe'),
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

// ═══════════════════════════════════════════════════════════════════════════════
// URL SHORTCUT RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED IMPORT ENGINE  (Build 79)
// Single entry point for all recipe URL imports.
// For Instagram: yt-dlp FIRST → embed page → AI browser → manual fallback.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Internal — checks if a recipe object has real extractable content
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
 * resolveShortUrl — attempts to follow short-URL redirects via the backend.
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
 * importFromInstagram — Unified 3-phase Instagram extraction engine.
 *
 * Phase order (ReciME insight — video subtitles are richest for Reels):
 *   0. yt-dlp video subtitles  ← FIRST
 *   1. Instagram embed page (fast, no Puppeteer)
 *   2. AI browser (Puppeteer, only if 0+1 fail)
 *   3. Gemini AI on any captured text
 *   → Last resort: { _needsManualCaption: true, sourceUrl }
 *
 * @param {string} url  - Instagram post/reel URL
 * @param {function} onProgress  - callback(phaseIndex, status, message)
 *   status: 'running' | 'done' | 'failed' | 'skipped' | 'pending'
 * @returns {Object} Structured recipe or { _needsManualCaption: true }
 */
export async function importFromInstagram(url, onProgress = () => {}) {
  const progress = (phase, status, msg) => onProgress(phase, status, msg);

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
    ...(r.directions || []).filter(d => !PLACEHOLDERS.includes(d)),
  ].filter(Boolean).join('\n');

  let capturedCaption = '';
  let capturedImageUrl = '';
  let videoRecipe = null; // yt-dlp structured result (skip phases 1+2 if rich enough)

  // ── Phase 0: yt-dlp video subtitles (narration — richest source for Reels) ──
  progress(0, 'running', 'Scanning for video subtitles…');
  try {
    const videoResult = await tryVideoExtraction(url, (msg) => progress(0, 'running', msg));
    if (videoResult && !videoResult._error) {
      // Accept yt-dlp result only if BOTH ingredients AND directions are non-placeholder
      const hasIng = !isPlaceholder(videoResult.ingredients);
      const hasDir = !isPlaceholder(videoResult.directions);
      if (hasIng && hasDir) {
        videoRecipe = videoResult;
        capturedImageUrl = videoResult.imageUrl || '';
        // Reconstruct text so Gemini can re-polish structure in Phase 3
        capturedCaption = recipeToText(videoResult);
        progress(0, 'done', 'Rich video content found — structuring with Gemini…');
        progress(1, 'skipped', 'Video subtitles sufficient');
        progress(2, 'skipped', 'Video subtitles sufficient');
        // Fall through to Phase 3 (Gemini always runs per unified plan)
      } else if (hasIng || hasDir) {
        // Partial yt-dlp — collect what we can and continue to embed/agent
        capturedCaption = recipeToText(videoResult);
        capturedImageUrl = videoResult.imageUrl || '';
        progress(0, 'done', 'Partial video data — trying embed for more…');
      } else {
        progress(0, 'failed', 'No usable video subtitles');
      }
    } else {
      progress(0, 'failed', 'No video subtitles available');
    }
  } catch { progress(0, 'failed', 'Video extraction unavailable'); }

  // ── Phase 1: Instagram embed page (skip if yt-dlp gave full content) ─────────
  if (!videoRecipe) {
    progress(1, 'running', 'Fetching Instagram caption…');
    try {
      const embedData = await extractInstagramEmbed(url);
      if (embedData?.caption) {
        const embedCaption = cleanSocialCaption(embedData.caption);
        if (embedCaption.length > capturedCaption.length) capturedCaption = embedCaption;
        if (embedData.imageUrl && !capturedImageUrl) capturedImageUrl = embedData.imageUrl;

        const isWeak = isCaptionWeak(capturedCaption);
        progress(1, 'done',
          capturedCaption
            ? `Caption found${isWeak ? ' (thin — will try AI browser)' : ' ✓'}`
            : 'Embed returned no text');

        // Strong caption: skip AI browser, go straight to Phase 3
        if (capturedCaption && !isWeak) {
          progress(2, 'skipped', 'Strong caption — skipping AI browser');
          // Fall through to Phase 3
        }
        // Weak caption: continue to Phase 2 (AI browser) to try to get more text
      } else {
        progress(1, 'failed', 'No caption in embed page');
      }
    } catch { progress(1, 'failed', 'Embed fetch failed'); }

    // ── Phase 2: AI Browser (Puppeteer) — only when embed gave no/weak caption ──
    const skipAgent = capturedCaption && !isCaptionWeak(capturedCaption);
    if (!skipAgent) {
      progress(2, 'running', 'Launching AI browser…');
      try {
        const agentResult = await extractInstagramAgent(url, (msg) => progress(2, 'running', msg));
        if (agentResult) {
          const rawCaption = agentResult.caption || '';
          const agentCaption = rawCaption ? cleanSocialCaption(rawCaption) : '';
          // Keep whichever caption is longer (more content)
          if (agentCaption.length > capturedCaption.length) capturedCaption = agentCaption;
          if (agentResult.imageUrl && !capturedImageUrl) capturedImageUrl = agentResult.imageUrl;

          if (agentCaption.length > 20 || !isPlaceholder(agentResult.ingredients)) {
            progress(2, 'done', 'AI browser succeeded');
          } else {
            progress(2, 'failed', 'AI browser returned no recipe content');
          }
        } else {
          progress(2, 'failed', 'AI browser unavailable (server may be cold-starting)');
        }
      } catch (err) {
        progress(2, 'failed', `AI browser error: ${(err?.message || '').slice(0, 50)}`);
      }
    }
  } // end phases 1+2

  // ── Phase 3: Gemini AI structuring — ALWAYS runs on any captured text ─────────
  // Per unified plan: "Phase 3 is the always-run intelligence layer."
  // Even thin captions get a Gemini attempt — it often salvages partial content.
  if (capturedCaption && capturedCaption.trim().length >= 20) {
    progress(3, 'running', '✨ Structuring recipe with Gemini…');
    try {
      const recipe = await captionToRecipe(capturedCaption, { imageUrl: capturedImageUrl, sourceUrl: url });
      if (recipe && !isPlaceholder(recipe.ingredients) && !isPlaceholder(recipe.directions)) {
        progress(3, 'done', 'Recipe structured successfully!');
        return {
          ...recipe,
          imageUrl: capturedImageUrl || recipe.imageUrl,
          extractedVia: videoRecipe ? 'yt-dlp+ai' : 'caption-ai',
          sourceUrl: url,
          importedAt: new Date().toISOString(),
        };
      }
      // Gemini returned partial — try heuristic + merge with yt-dlp if available
      if (videoRecipe && hasRecipeContent(videoRecipe)) {
        const merged = {
          ...videoRecipe,
          ...(recipe?.name ? { name: recipe.name } : {}),
          ingredients: !isPlaceholder(recipe?.ingredients) ? recipe.ingredients : videoRecipe.ingredients,
          directions: !isPlaceholder(recipe?.directions) ? recipe.directions : videoRecipe.directions,
        };
        if (hasRecipeContent(merged)) {
          progress(3, 'done', 'Recipe extracted from video!');
          return { ...merged, imageUrl: capturedImageUrl || merged.imageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
        }
      }
    } catch (err) {
      // Gemini failed — fall back to yt-dlp result if available
      if (videoRecipe && hasRecipeContent(videoRecipe)) {
        progress(3, 'done', 'Using video extraction (AI unavailable)');
        return { ...videoRecipe, imageUrl: capturedImageUrl || videoRecipe.imageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
      }
    }
    progress(3, 'failed', 'AI could not structure a recipe from this post');
  } else if (videoRecipe && hasRecipeContent(videoRecipe)) {
    // No caption text but yt-dlp gave us a full recipe — use it directly
    progress(3, 'done', 'Recipe from video subtitles!');
    return { ...videoRecipe, imageUrl: capturedImageUrl || videoRecipe.imageUrl, extractedVia: 'yt-dlp', sourceUrl: url, importedAt: new Date().toISOString() };
  } else {
    progress(3, 'failed', 'No text captured from any source');
  }

  // ── Manual fallback — all phases exhausted ───────────────────────────────────
  return { _needsManualCaption: true, sourceUrl: url };
}

/**
 * importRecipeFromUrl — single entry point for all recipe imports.
 *
 * - Resolves short URLs first (bit.ly, vm.tiktok.com, etc.)
 * - Routes Instagram through importFromInstagram() (yt-dlp-first pipeline)
 * - Routes everything else through parseFromUrl() (generic extraction)
 *
 * @param {string} url - Any recipe URL (social or blog)
 * @param {function} onProgress - callback(phaseIndex, status, message)
 * @returns {Object} Structured recipe or { _needsManualCaption: true }
 */
export async function importRecipeFromUrl(url, onProgress = () => {}) {
  // Resolve URL shorteners before routing
  let resolvedUrl = url;
  try { resolvedUrl = await resolveShortUrl(url); } catch { /* use original */ }

  if (isInstagramUrl(resolvedUrl)) {
    return await importFromInstagram(resolvedUrl, onProgress);
  }

  // Non-Instagram social + recipe blogs: use existing generic pipeline
  return await parseFromUrl(resolvedUrl, (msg) => onProgress(0, 'running', msg));
}