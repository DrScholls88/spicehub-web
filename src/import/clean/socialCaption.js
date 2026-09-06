// socialCaption.js — social-media caption cleaning & weakness detection
// Extracted from recipeParser.js (strangler-fig step).
import { stripJunkLines, BAIT_ONLY_RE, countQuantityLines } from '../junk.js';

// ── Signal-detection regexes (local copies; canonical versions stay in recipeParser) ──
const UNITS_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|cl|liters?|litres?|pinch|dash(?:es)?|splash(?:es)?|drops?|parts?|barspoons?|bar spoons?|jiggers?|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|medium|large|small|whole|half|to taste|chopped|diced|minced|sliced|crushed|grated|shredded|fresh|dried|frozen|peeled|deveined|boneless|skinless|room temperature|softened|melted|divided)\b/i;
const COOKING_VERBS_RE = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eÃƒÂ©]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|stir-fry|deep.fry|pan.fry|air.fry|shake|muddle|double.strain|fine.strain|strain|build|rim|express|float|swizzle|jigger|churn|dry.shake)\b/im;
const SPOKEN_DIRECTION_RE = /^(you'?re? (?:gonna|going to)|go ahead and|now (?:we|you|I)|what (?:we|you|I) (?:do|did)|take (?:your|the|some)|grab (?:your|the|some)|throw (?:it|that|the|some) in|pop (?:it|that|the) in|toss (?:it|that|the) in|once (?:it|that|the|your)|when (?:it|that|the|your)|after (?:it|that|the|your|about)|make sure|be sure to|don'?t forget to|carefully|gently|slowly|quickly|keep (?:stirring|mixing|cooking)|continue|allow|until|while)\b/i;
const FOOD_RE = /\b(chicken|beef|pork|salmon|shrimp|tofu|rice|pasta|noodles|bread|flour|sugar|butter|oil|olive oil|vegetable oil|canola oil|sesame oil|coconut oil|garlic|onion|onions|shallot|shallots|tomato|tomatoes|pepper|peppers|salt|cheese|cream|milk|eggs?|lemon|lime|vinegar|soy sauce|honey|ginger|cilantro|parsley|basil|oregano|cumin|paprika|cinnamon|avocado|potato|potatoes|broccoli|spinach|mushrooms?|carrots?|celery|corn|beans?|chickpeas?|lentils?|coconut|vanilla|chocolate|bacon|sausage|ham|turkey|lettuce|cucumber|zucchini|bell pepper|jalape[nÃƒÂ±]o|mayo|mayonnaise|mustard|ketchup|sriracha|sesame|peanut|almond|walnut|cashew|oats?|yogurt|sour cream|cream cheese|mozzarella|parmesan|cheddar|feta|ricotta|tortilla|pita|naan|wonton|dumpling|vodka|whiskey|bourbon|rum|tequila|gin|scotch|vermouth|bitters|angostura|triple sec|cointreau|campari|kahlua|amaretto|ginger beer|tonic|soda water|club soda|cranberry juice|orange juice|lime juice|lemon juice|simple syrup|grenadine|baking soda|baking powder|cornstarch|cream of tartar|yeast|heavy cream|half.and.half|buttermilk|sweetened condensed milk|evaporated milk|cocoa powder|brown sugar|powdered sugar|confectioners|maple syrup|molasses|worcestershire|fish sauce|oyster sauce|hoisin|tahini|miso|sambal|harissa|chili flakes?|red pepper flakes?|cayenne|nutmeg|turmeric|cardamom|cloves?|allspice|thyme|rosemary|sage|dill|chives?|scallions?|green onions?|leeks?|capers|olives|artichoke|eggplant|squash|pumpkin|sweet potato|yam|beet|radish|cabbage|kale|arugula|watercress)\b/i;

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
  ];
  for (const re of BAIT_LINES) t = t.replace(new RegExp(re.source, re.flags + 'g'), '');

  // 2.5 Zero-junk contract: drop whole lines that carry strong promo junk
  // ANYWHERE in the line (mid-caption "use code X ... link in bio" prose that
  // the anchored BAIT_LINES above cannot catch). Lines with real recipe
  // signals (quantities/cooking verbs) are always preserved.
  t = stripJunkLines(t);

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

  // Tier 1.5 (bait override): "full recipe on the blog / link in bio" means the
  // recipe is NOT here. A stray food word must not rescue a bait caption —
  // require at least 2 quantified ingredient lines to overrule the bait phrase.
  if (BAIT_ONLY_RE.test(text) && countQuantityLines(cleaned) < 2) return true;

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
