// =============================================================================
// recipeSchema.js — SpiceHub Extraction Knowledge Base (single source of truth)
// -----------------------------------------------------------------------------
// Centralizes the controlled vocabularies, taxonomies, the Gemini structured-
// output schema, the shared system instruction, and few-shot exemplars that
// drive recipe extraction. Previously these lived inline and scattered across
// recipeParser.js (UNITS, FOOD_RE, SPIRITS, COCKTAIL_ACTIONS, INGREDIENTS_HEADERS)
// and were duplicated in prose inside the Gemini prompt and in recipeTemplates.js.
//
// Consumed by:
//   - src/recipeParser.js   (extraction: prompt building, post-processing, vocab)
//   - src/components/*       (library filters via COURSE / DISH_TYPE / CUISINE)
//   - server/* mirrors these structures (it is a separate package; keep in sync)
//
// Design rules:
//   - ZERO imports here. Must be safe to import in browser, worker, and server.
//   - Pure data + pure helpers only. No network, no DOM, no secrets.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. UNIT CANONICALIZATION
// -----------------------------------------------------------------------------
// canonical -> [aliases]. Used to normalize messy units so scaling, dedup, and
// grocery aggregation can reason about them. Drink units included.
export const UNIT_CANON = {
  tsp:        ['teaspoon', 'teaspoons', 'tsp', 'tsps', 't'],
  tbsp:       ['tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs', 'tbl', 'T'],
  cup:        ['cup', 'cups', 'c'],
  oz:         ['oz', 'ounce', 'ounces', 'fl oz', 'fluid ounce', 'fluid ounces'],
  lb:         ['lb', 'lbs', 'pound', 'pounds', '#'],
  g:          ['g', 'gram', 'grams', 'gr'],
  kg:         ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  mg:         ['mg', 'milligram', 'milligrams'],
  ml:         ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cc'],
  l:          ['l', 'liter', 'liters', 'litre', 'litres'],
  pint:       ['pint', 'pints', 'pt'],
  quart:      ['quart', 'quarts', 'qt'],
  gallon:     ['gallon', 'gallons', 'gal'],
  clove:      ['clove', 'cloves'],
  can:        ['can', 'cans'],
  jar:        ['jar', 'jars'],
  package:    ['package', 'packages', 'pkg', 'pack', 'packs'],
  stick:      ['stick', 'sticks'],
  slice:      ['slice', 'slices'],
  piece:      ['piece', 'pieces', 'pc', 'pcs'],
  pinch:      ['pinch', 'pinches'],
  handful:    ['handful', 'handfuls'],
  bunch:      ['bunch', 'bunches'],
  sprig:      ['sprig', 'sprigs'],
  // drink-specific
  dash:       ['dash', 'dashes'],
  splash:     ['splash', 'splashes'],
  barspoon:   ['barspoon', 'barspoons', 'bar spoon', 'bar spoons'],
  part:       ['part', 'parts'],
  shot:       ['shot', 'shots'],
  jigger:     ['jigger', 'jiggers'],
  drop:       ['drop', 'drops'],
  float:      ['float', 'floats'],
  rinse:      ['rinse'],
  cl:         ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'],
};

// Flattened alias -> canonical lookup (lowercased keys).
export const UNIT_LOOKUP = Object.fromEntries(
  Object.entries(UNIT_CANON).flatMap(([canon, aliases]) =>
    aliases.map((a) => [a.toLowerCase(), canon])
  )
);

// Every alias as a regex-ready alternation, longest-first so "fl oz" beats "oz".
export const UNIT_ALIASES_ALL = Object.values(UNIT_CANON)
  .flat()
  .sort((a, b) => b.length - a.length);

/** Canonicalize a raw unit token (e.g. "Tablespoons" -> "tbsp"). Returns '' if unknown. */
export function canonicalizeUnit(raw = '') {
  const key = String(raw).trim().toLowerCase().replace(/\.$/, '');
  return UNIT_LOOKUP[key] || '';
}

// -----------------------------------------------------------------------------
// 2. FRACTION / QUANTITY NORMALIZATION
// -----------------------------------------------------------------------------
const VULGAR_FRACTIONS = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6',
  '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};
const WORD_NUMBERS = {
  'a': '1', 'an': '1', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
  'half': '1/2', 'quarter': '1/4', 'third': '1/3',
};

/** Replace unicode vulgar fractions with ascii equivalents, e.g. "1½" -> "1 1/2". */
export function normalizeFraction(str = '') {
  let out = String(str);
  for (const [glyph, ascii] of Object.entries(VULGAR_FRACTIONS)) {
    // Insert a space if a digit immediately precedes the glyph ("1½" -> "1 1/2").
    out = out.replace(new RegExp(`(\\d)${glyph}`, 'g'), `$1 ${ascii}`);
    out = out.replace(new RegExp(glyph, 'g'), ascii);
  }
  return out;
}

/** Map a spoken quantity word to a numeric string. Returns '' if not a number word. */
export function wordToNumber(word = '') {
  return WORD_NUMBERS[String(word).trim().toLowerCase()] || '';
}

// -----------------------------------------------------------------------------
// 3. INGREDIENT ALIAS DICTIONARY (synonym -> canonical + grocery aisle)
// -----------------------------------------------------------------------------
// Powers dedup, cross-recipe grocery merging, and aisle sorting. Extend freely.
export const INGREDIENT_ALIASES = {
  'green onion':   { canonical: 'scallion', aisle: 'produce' },
  'green onions':  { canonical: 'scallion', aisle: 'produce' },
  'spring onion':  { canonical: 'scallion', aisle: 'produce' },
  'spring onions': { canonical: 'scallion', aisle: 'produce' },
  'scallions':     { canonical: 'scallion', aisle: 'produce' },
  'cilantro':      { canonical: 'cilantro', aisle: 'produce' },
  'coriander leaves': { canonical: 'cilantro', aisle: 'produce' },
  'fresh coriander':  { canonical: 'cilantro', aisle: 'produce' },
  'garbanzo bean':  { canonical: 'chickpea', aisle: 'canned' },
  'garbanzo beans': { canonical: 'chickpea', aisle: 'canned' },
  'chickpeas':      { canonical: 'chickpea', aisle: 'canned' },
  'aubergine':      { canonical: 'eggplant', aisle: 'produce' },
  'courgette':      { canonical: 'zucchini', aisle: 'produce' },
  'capsicum':       { canonical: 'bell pepper', aisle: 'produce' },
  'bell peppers':   { canonical: 'bell pepper', aisle: 'produce' },
  'all purpose flour': { canonical: 'all-purpose flour', aisle: 'baking' },
  'plain flour':       { canonical: 'all-purpose flour', aisle: 'baking' },
  'caster sugar':      { canonical: 'superfine sugar', aisle: 'baking' },
  'icing sugar':       { canonical: 'powdered sugar', aisle: 'baking' },
  'confectioners sugar': { canonical: 'powdered sugar', aisle: 'baking' },
  'double cream':   { canonical: 'heavy cream', aisle: 'dairy' },
  'heavy whipping cream': { canonical: 'heavy cream', aisle: 'dairy' },
  'soy sauce':      { canonical: 'soy sauce', aisle: 'condiments' },
  'shoyu':          { canonical: 'soy sauce', aisle: 'condiments' },
  'scallion greens': { canonical: 'scallion', aisle: 'produce' },
};

/** Resolve an ingredient name to {canonical, aisle} (case-insensitive). Returns null if unknown. */
export function resolveIngredientAlias(name = '') {
  const key = String(name).trim().toLowerCase();
  return INGREDIENT_ALIASES[key] || null;
}

// -----------------------------------------------------------------------------
// 3b. GROCERY DEPARTMENT CATEGORIES (Phase G — store-department taxonomy)
// -----------------------------------------------------------------------------
// The LLM classifies each ingredient at ingestion (RECIPE_SCHEMA item.category);
// categorizeIngredient() is the keyword fallback for legacy/heuristic paths.
export const GROCERY_CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy', 'Pantry', 'Frozen', 'Bakery', 'Other',
];

const CATEGORY_KEYWORDS = {
  'Produce': /\b(onion|garlic|scallion|shallot|tomato|potato|carrot|celery|pepper|chili|chile|jalapeno|jalapeño|spinach|kale|lettuce|arugula|cabbage|broccoli|cauliflower|zucchini|eggplant|cucumber|avocado|lemon|lime|orange|apple|banana|berr(?:y|ies)|strawberr|blueberr|mango|pineapple|grape|melon|peach|pear|plum|cherr|herb|cilantro|parsley|basil|mint|rosemary|thyme|dill|sage|ginger|mushroom|squash|pumpkin|corn|pea[s]?\b|green bean|asparagus|beet|radish|turnip|leek|fennel|sprout)/i,
  'Meat & Seafood': /\b(chicken|beef|steak|pork|bacon|ham|sausage|turkey|lamb|veal|duck|ground (?:beef|turkey|pork|chicken)|brisket|rib[s]?\b|chorizo|prosciutto|salami|pepperoni|fish|salmon|tuna|cod|tilapia|halibut|trout|shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster|anchov|sardine|calamari|squid)/i,
  'Dairy': /\b(milk|cream|half[- ]and[- ]half|butter|cheese|cheddar|mozzarella|parmesan|feta|ricotta|cream cheese|yogurt|yoghurt|sour cream|egg[s]?\b|creme fraiche|crème fraîche|buttermilk|ghee|mascarpone|brie|gouda|provolone|queso)/i,
  'Frozen': /\b(frozen|ice cream|sorbet|popsicle|puff pastry|phyllo|filo)/i,
  'Bakery': /\b(bread|baguette|brioche|bun[s]?\b|roll[s]?\b|tortilla|pita|naan|croissant|bagel|english muffin|sourdough|ciabatta|focaccia)/i,
  'Pantry': /\b(flour|sugar|salt|pepper(?:corn)?s?$|oil|olive oil|vegetable oil|vinegar|rice|pasta|noodle|quinoa|oat|cereal|bean[s]?\b|lentil|chickpea|stock|broth|sauce|soy sauce|fish sauce|honey|maple syrup|vanilla|baking (?:soda|powder)|yeast|cocoa|chocolate|spice|cumin|paprika|oregano|cinnamon|nutmeg|turmeric|curry|chili powder|cayenne|can(?:ned)?\b|jar|tomato paste|coconut milk|peanut butter|tahini|mustard|ketchup|mayo|nut[s]?\b|almond|walnut|pecan|cashew|seed[s]?\b|raisin|date[s]?\b|wine|whiskey|rum|vodka|gin|tequila|vermouth|bitters|liqueur|syrup|soda|tonic|juice)/i,
};

/**
 * Keyword fallback categorizer — returns one of GROCERY_CATEGORIES. Order
 * matters: Frozen beats Produce ("frozen peas"), proteins beat Pantry
 * ("chicken stock" is Pantry though — stock/broth checked first).
 */
export function categorizeIngredient(name = '') {
  const s = String(name).toLowerCase();
  if (!s.trim()) return 'Other';
  // Pantry liquids made FROM proteins/produce ("chicken stock", "tomato paste")
  if (/\b(stock|broth|paste|powder|sauce|canned|can of|dried|juice)\b/.test(s) && CATEGORY_KEYWORDS['Pantry'].test(s)) return 'Pantry';
  if (CATEGORY_KEYWORDS['Frozen'].test(s)) return 'Frozen';
  if (CATEGORY_KEYWORDS['Meat & Seafood'].test(s)) return 'Meat & Seafood';
  if (CATEGORY_KEYWORDS['Dairy'].test(s)) return 'Dairy';
  if (CATEGORY_KEYWORDS['Bakery'].test(s)) return 'Bakery';
  if (CATEGORY_KEYWORDS['Produce'].test(s)) return 'Produce';
  if (CATEGORY_KEYWORDS['Pantry'].test(s)) return 'Pantry';
  return 'Other';
}

// -----------------------------------------------------------------------------
// 3c. INGESTION TRASH FILTER (Phase G — discard junk lines before save)
// -----------------------------------------------------------------------------
// Lines that slip through extraction but are never real ingredients:
//   - standalone scaling strings: "1x", "2x 3x", "1x 2x 3x"
//   - bare sub-section labels:    "Topping", "Toppings:", "Garnish:"
//   - header remnants:            "Ingredients (serves 4)", "Ingredients:"
//   - trailing-colon headers:     "For the sauce:", "Marinade:"
const TRASH_SCALING_RE = /^\s*(?:\d+\s*[x×]\s*)+$/i;
const TRASH_HEADER_RE = /^\s*ingredients?\s*(?:\(.*\))?\s*:?\s*$/i;
const TRASH_BARE_LABEL_RE = /^\s*(?:toppings?|garnish(?:es)?|optional|for serving|to serve|notes?)\s*:?\s*$/i;
const TRAILING_COLON_HEADER_RE = /^[^,.;]{1,40}:\s*$/;

// Conversational hype / sign-off lines that sometimes survive caption cleaning
// and get mis-classified as ingredients (e.g. "So EASY and quick", "Enjoy!",
// "Gluten free", "DB x"). These are short, punchy, and contain no food/quantity
// signal — strip them so they don't pollute the ingredient list.
const TRASH_HYPE_RE = /^(so\s+(easy|quick|good|simple|delicious|yummy)\b.*|packed\s+(with|full of)\s+.*|enjoy\s*!*|gluten\s*[- ]?free!?|dairy\s*[- ]?free!?|vegan!?|vegetarian!?|keto!?|healthy!?|so\s+good!?|yum+!?|delicious!?|easy\s+(peasy)?!?|quick\s+and\s+easy!?|perfect!?|amazing!?|love\s+this!?|xo+|x{1,3})\s*$/i;
// Initial-style sign-offs: "DB x", "— J.", "K x", "love, Sam"
const TRASH_SIGNOFF_RE = /^(?:[-—]\s*)?(?:love,?\s*)?[A-Z]{1,3}\.?\s*x{1,3}$/;

/** True if an extracted ingredient line is structural junk, not a real item. */
export function isTrashIngredientLine(line = '') {
  const s = String(line).trim();
  if (!s) return true;
  if (TRASH_SCALING_RE.test(s)) return true;
  if (TRASH_HEADER_RE.test(s)) return true;
  if (TRASH_BARE_LABEL_RE.test(s)) return true;
  if (TRASH_HYPE_RE.test(s)) return true;
  if (TRASH_SIGNOFF_RE.test(s)) return true;
  // Trailing-colon headers with no quantity ("For the sauce:") — but keep
  // legit lines that happen to end in ":" AND start with a quantity.
  if (TRAILING_COLON_HEADER_RE.test(s) && !/^\d/.test(s)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// 4. CONTROLLED TAXONOMIES (for library filtering + AI classification)
// -----------------------------------------------------------------------------
export const COURSE = [
  'breakfast', 'brunch', 'lunch', 'dinner', 'appetizer', 'side',
  'dessert', 'snack', 'drink', 'sauce', 'condiment', 'baked good',
];
export const DISH_TYPE = [
  'pasta', 'soup', 'stew', 'salad', 'stir-fry', 'casserole', 'sandwich',
  'wrap', 'taco', 'burger', 'bowl', 'bake', 'roast', 'grill', 'curry',
  'pizza', 'noodles', 'rice dish', 'smoothie', 'cocktail', 'mocktail',
  'cake', 'cookie', 'bread', 'pie', 'dip', 'marinade',
];
export const CUISINE = [
  'American', 'Italian', 'Mexican', 'Thai', 'Chinese', 'Japanese', 'Korean',
  'Vietnamese', 'Indian', 'Mediterranean', 'Greek', 'French', 'Spanish',
  'Middle Eastern', 'Caribbean', 'Cajun', 'Southern', 'Tex-Mex', 'Fusion',
];
export const DIETARY_TAGS = [
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'keto', 'paleo',
  'low-carb', 'high-protein', 'nut-free', 'whole30', 'pescatarian',
];

// -----------------------------------------------------------------------------
// 5. SECTION HEADER VOCABULARY (shared by client splitter + AI prompt rules)
// -----------------------------------------------------------------------------
export const SECTION_HEADERS = {
  ingredientStart: [
    'ingredients', 'you will need', 'you\'ll need', 'what you need',
    'shopping list', 'grocery list',
  ],
  subSections: [
    'for the sauce', 'for the dressing', 'for the marinade', 'marinade',
    'spice mix', 'spice rub', 'rub', 'topping', 'toppings', 'filling',
    'dough', 'batter', 'crust', 'garnish', 'dressing', 'broth', 'base',
    'glaze', 'frosting', 'icing', 'crumble', 'streusel', 'assembly',
    'to serve', 'for serving', 'for the bowl', 'for the cake',
  ],
  directionStart: [
    'directions', 'instructions', 'method', 'steps', 'preparation',
    'how to make', 'how to make it', 'let\'s make it', 'to make',
  ],
};

/** True if a line is (only) a section header, e.g. "For the sauce:". */
export function isSectionHeader(line = '') {
  const t = String(line).trim().toLowerCase().replace(/[:：]\s*$/, '').replace(/^[-*•]\s*/, '');
  if (t.length === 0 || t.length > 40) return false;
  const all = [...SECTION_HEADERS.subSections, ...SECTION_HEADERS.ingredientStart, ...SECTION_HEADERS.directionStart];
  return all.some((h) => t === h || t === h + ':' || t.startsWith(h));
}

/** Extract a short section label from a header line, e.g. "For the sauce:" -> "sauce". */
export function sectionLabelFrom(line = '') {
  return String(line)
    .trim()
    .replace(/[:：]\s*$/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^for the\s+/i, '')
    .replace(/^for\s+/i, '')
    .trim();
}

// -----------------------------------------------------------------------------
// 6. DRINK DETECTION VOCABULARY (centralized; replaces inline SPIRITS/etc.)
// -----------------------------------------------------------------------------
export const SPIRITS = [
  'vodka', 'gin', 'rum', 'white rum', 'dark rum', 'spiced rum', 'tequila',
  'mezcal', 'whiskey', 'whisky', 'bourbon', 'rye', 'scotch', 'brandy',
  'cognac', 'armagnac', 'pisco', 'cachaça', 'cachaca', 'soju', 'sake',
  'absinthe', 'aquavit',
];
export const LIQUEURS = [
  'vermouth', 'sweet vermouth', 'dry vermouth', 'aperol', 'campari',
  'triple sec', 'cointreau', 'grand marnier', 'amaretto', 'kahlua',
  'baileys', 'chambord', 'st germain', 'st-germain', 'curaçao', 'curacao',
  'maraschino', 'chartreuse', 'fernet', 'amaro', 'limoncello', 'midori',
  'frangelico', 'drambuie', 'cynar', 'lillet', 'crème de', 'creme de',
];
export const COCKTAIL_ACTIONS = [
  'shake', 'shaken', 'stir', 'stirred', 'strain', 'double strain',
  'muddle', 'muddled', 'build', 'built', 'top with', 'top up', 'float',
  'express', 'twist', 'garnish with', 'rim the glass', 'dry shake',
  'fine strain', 'churn',
];
export const GLASSWARE = [
  'coupe', 'martini glass', 'rocks glass', 'old fashioned glass',
  'highball', 'collins glass', 'nick and nora', 'flute', 'wine glass',
  'shot glass', 'mule mug', 'hurricane glass', 'snifter', 'tiki mug', 'mug',
];
export const DRINK_METHODS = ['shaken', 'stirred', 'built', 'blended', 'muddled', 'thrown'];
const DRINK_UNIT_SIGNALS = ['oz', 'dash', 'dashes', 'splash', 'barspoon', 'part', 'parts', 'cl', 'ml', 'jigger', 'shot'];

/**
 * Heuristic kind detection used as a *hint* only — the AI is the authority via
 * RECIPE_SCHEMA.kind. Returns 'drink' | 'meal'. Mirrors the old inline logic
 * but centralized so prompt + parser stay in sync.
 */
export function detectKindHeuristic(text = '') {
  const t = String(text).toLowerCase();
  let score = 0;
  for (const s of SPIRITS) if (t.includes(s)) score += 2;
  for (const l of LIQUEURS) if (t.includes(l)) score += 2;
  for (const a of COCKTAIL_ACTIONS) if (t.includes(a)) score += 1;
  for (const g of GLASSWARE) if (t.includes(g)) score += 1;
  for (const u of DRINK_UNIT_SIGNALS) {
    if (new RegExp(`\\b\\d[\\d.\\/ ]*\\s*${u}\\b`).test(t)) score += 1;
  }
  // Meal signals counterbalance (oven/bake/etc. rarely appear in cocktails).
  if (/\b(oven|bake|baked|preheat|roast|simmer|boil|sauté|saute|knead|marinate)\b/.test(t)) score -= 3;
  return score >= 3 ? 'drink' : 'meal';
}

// -----------------------------------------------------------------------------
// 7. DISPLAY FIELD SHAPE (the thin SpiceHub recipe object used by the UI/db)
// -----------------------------------------------------------------------------
// Documents the fields the renderer + db expect. The rich AI output (Section 8)
// is flattened down to this via thinFromStructured().
export const DISPLAY_SCHEMA = {
  meal: ['title', 'imageUrl', 'ingredients', 'directions', 'servings',
         'prepTime', 'cookTime', 'totalTime', 'cuisine', 'course', 'dishType',
         'dietaryTags', 'notes', 'sourceUrl'],
  drink: ['title', 'imageUrl', 'ingredients', 'directions', 'glass', 'garnish',
          'method', 'notes', 'sourceUrl'],
};

// -----------------------------------------------------------------------------
// 8. GEMINI STRUCTURED-OUTPUT SCHEMA (responseSchema)
// -----------------------------------------------------------------------------
// OpenAPI-3.0 subset accepted by the Gemini REST v1beta `generationConfig`.
// Use together with `responseMimeType: "application/json"`. This guarantees
// parseable JSON and makes ingredient/direction sorting STRUCTURAL rather than
// dependent on the model following prose instructions.
//
// NOTE for the REST endpoint: lowercase type names are accepted by v1beta. If
// the API ever rejects this, uppercase the `type` values (OBJECT/STRING/etc.).
export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    isRecipe: { type: 'boolean' },
    kind: { type: 'string', enum: ['meal', 'drink'] },
    title: { type: 'string' },
    ingredientGroups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' }, // "" when ungrouped, else e.g. "Sauce"
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quantity: { type: 'string' }, // "2", "1/2", ""
                unit: { type: 'string' },     // canonical unit or ""
                name: { type: 'string' },     // "all-purpose flour"
                prep: { type: 'string' },     // "minced", "to taste", ""
                category: { type: 'string', enum: GROCERY_CATEGORIES }, // store department
              },
              required: ['name'],
            },
          },
        },
        required: ['items'],
      },
    },
    directions: { type: 'array', items: { type: 'string' } },
    servings: { type: 'string' },
    prepTime: { type: 'string' },
    cookTime: { type: 'string' },
    totalTime: { type: 'string' },
    cuisine: { type: 'string' },
    course: { type: 'string', enum: COURSE },
    dishType: { type: 'string' },
    dietaryTags: { type: 'array', items: { type: 'string' } },
    glass: { type: 'string' },   // drink only
    garnish: { type: 'string' }, // drink only
    method: { type: 'string' },  // drink only
    notes: { type: 'string' },
    confidence: { type: 'number' },  // 0..1, model self-rated
    needsReview: { type: 'boolean' },
  },
  required: ['isRecipe', 'kind', 'title', 'ingredientGroups', 'directions', 'confidence'],
};

// -----------------------------------------------------------------------------
// 8b. ENGINE PROMPT VERSION (I-5 self-healing)
// -----------------------------------------------------------------------------
// Stamp every extraction with the prompt/engine version that produced it. Bump
// this string whenever SYSTEM_INSTRUCTION, the schema, or the extraction prompt
// changes in a way that could improve results. The Meal Library re-extraction
// ledger compares a recipe's stored `engineVersion` against this value to offer
// "improve" re-runs that re-send the cached caption (no re-scrape, no Apify cost).
// Format: YYYY.MM.patch — human-readable and monotonically comparable as a string.
export const ENGINE_PROMPT_VERSION = '2026.06.1';

// -----------------------------------------------------------------------------
// 9. SHARED SYSTEM INSTRUCTION (used identically by text / server / vision)
// -----------------------------------------------------------------------------
export const SYSTEM_INSTRUCTION = [
  "You are SpiceHub's recipe extraction engine. You convert messy real-world recipe sources",
  "— Instagram/TikTok captions, YouTube transcripts, recipe-blog text, and photos of recipe",
  "cards, cookbook pages, handwritten notes, or plated dishes — into ONE strict JSON object",
  "that conforms to the provided response schema. Output the JSON object only: no prose, no",
  "markdown, no code fences.",
  "",
  "CLASSIFY FIRST. Set kind=\"drink\" when the source is a cocktail or mixed drink (spirits,",
  "liqueurs; oz/dash/splash/part/barspoon units; shake/stir/strain/build/muddle language;",
  "glassware). Otherwise kind=\"meal\". Populate glass, garnish, and method only for drinks.",
  "",
  "INGREDIENTS vs DIRECTIONS — the most important rule. An INGREDIENT is [quantity] [unit]",
  "[food] [prep] with no action verb (e.g. \"2 cups flour\", \"1 lemon, juiced\", \"salt to taste\",",
  "\"1.5 oz Aperol\"). A DIRECTION is an imperative action step (e.g. \"Preheat oven to 400°F\",",
  "\"Shake with ice 12s\"). Numbered lines that describe actions are ALWAYS directions. \"2 eggs,",
  "beaten\" is an INGREDIENT. Before returning, re-scan: any ingredient that begins with a",
  "cooking verb (Mix, Combine, Preheat, Add, Cook, Bake, Stir, Pour, Heat, Fold, Whisk, Blend,",
  "Season, Serve, Place, Remove, Transfer, Bring, Let, Cover, Simmer, Boil, Drain, Rinse,",
  "Sprinkle, Drizzle, Toss, Marinate, Melt, Beat, Knead, Roll, Broil, Brush, Sear, Steam,",
  "Shake, Strain, Muddle, Garnish) must MOVE to directions; any direction that is purely a",
  "food + quantity must MOVE to an ingredient.",
  "",
  "SECTIONS. When the source groups items under headers (\"For the sauce:\", \"Marinade:\",",
  "\"Spice rub:\", \"Filling:\", \"Garnish:\"), create one ingredientGroups entry per header with",
  "`section` set to the cleaned label (e.g. \"sauce\") and the items beneath it. Items with no",
  "header go in a single group with section=\"\". NEVER emit a header line as an ingredient.",
  "",
  "QUANTITIES. Split every ingredient into quantity, unit, name, prep. Normalize fractions",
  "(½ -> \"1/2\", ¾ -> \"3/4\"), spoken amounts (\"half a cup\" -> quantity \"1/2\" unit \"cup\";",
  "\"a tablespoon\" -> \"1\"/\"tbsp\"), and \"to taste\"/\"as needed\" (quantity \"\", unit \"\", prep",
  "\"to taste\"). Prefer canonical units: tsp, tbsp, cup, oz, lb, g, kg, ml, l, clove, can, pinch,",
  "and for drinks oz, ml, cl, dash, splash, barspoon, part.",
  "",
  "CLEANING. Strip from the TITLE and ALL fields: hashtags, @handles, emojis, calls-to-action",
  "(\"save this\", \"link in bio\", \"follow for more\", \"comment RECIPE\"), sponsor disclosures,",
  "engagement bait, view/like counts, and blog boilerplate (\"Jump to Recipe\", \"Pin this\").",
  "The title is the dish/drink name only, 2–6 words, no serving context.",
  "",
  "TAXONOMY. For meals, set `course` to the single best value from the provided enum and",
  "`dishType` to a short lowercase dish descriptor (e.g. \"pasta\", \"soup\", \"taco\"). Set",
  "`cuisine` when evident.",
  "",
  "CATEGORY. Set each ingredient's `category` to its grocery-store department: Produce,",
  "Meat & Seafood, Dairy, Pantry, Frozen, Bakery, or Other. Fresh vegetables/fruits/herbs ->",
  "Produce; raw meat/fish -> Meat & Seafood; milk/cheese/eggs/butter -> Dairy; dry goods,",
  "oils, spices, canned items, condiments, and alcohol -> Pantry; frozen items -> Frozen;",
  "bread/tortillas -> Bakery. Derived products follow their shelf form: chicken STOCK is",
  "Pantry, not Meat & Seafood.",
  "",
  "TRASH. NEVER emit as ingredients: scaling strings (\"1x 2x 3x\"), bare section labels",
  "(\"Topping\", \"Garnish:\"), header remnants (\"Ingredients (serves 4)\"), or any line that is",
  "only a label ending in a colon.",
  "",
  "COMPLETENESS. Capture EVERY ingredient (including minor spices, oils, garnishes) and EVERY",
  "step in order; never summarize multiple steps into one.",
  "",
  "CONFIDENCE. Set `confidence` 0–1 for how cleanly the source mapped to the schema, and",
  "`needsReview`=true if anything was ambiguous, illegible, or inferred rather than stated. If",
  "the source is not a recipe, return {\"isRecipe\":false,\"kind\":\"meal\",\"title\":\"\",",
  "\"ingredientGroups\":[],\"directions\":[],\"confidence\":0}.",
].join('\n');

// -----------------------------------------------------------------------------
// 10. FEW-SHOT EXEMPLARS (input -> ideal structured output)
// -----------------------------------------------------------------------------
// Injected as prior conversation turns so the model pattern-matches the exact
// header-stripping and ingredient/direction sorting the rules describe. These
// also serve as parser unit-test fixtures.
export const EXEMPLARS = {
  meal: [
    {
      raw: [
        '😍 The BEST weeknight dinner!! 🍝 save this & follow @thefoodie for more',
        '#pasta #dinner #easyrecipe',
        '',
        'For the sauce:',
        '- 1 cup heavy cream',
        '- ½ cup sun-dried tomatoes, chopped',
        '- 3 cloves garlic, minced',
        '',
        '2 cups chicken breast, diced',
        '2 cups baby spinach',
        'salt and pepper to taste',
        '',
        'Sear the chicken until golden, ~5 min. Set aside.',
        'Sauté garlic, add cream and sun-dried tomatoes, simmer 3 min.',
        'Stir in spinach until wilted, then return chicken. Toss with pasta.',
      ].join('\n'),
      output: {
        isRecipe: true,
        kind: 'meal',
        title: 'Creamy Tuscan Chicken Pasta',
        ingredientGroups: [
          {
            section: 'sauce',
            items: [
              { quantity: '1', unit: 'cup', name: 'heavy cream', prep: '', category: 'Dairy' },
              { quantity: '1/2', unit: 'cup', name: 'sun-dried tomatoes', prep: 'chopped', category: 'Pantry' },
              { quantity: '3', unit: 'clove', name: 'garlic', prep: 'minced', category: 'Produce' },
            ],
          },
          {
            section: '',
            items: [
              { quantity: '2', unit: 'cup', name: 'chicken breast', prep: 'diced', category: 'Meat & Seafood' },
              { quantity: '2', unit: 'cup', name: 'baby spinach', prep: '', category: 'Produce' },
              { quantity: '', unit: '', name: 'salt and pepper', prep: 'to taste', category: 'Pantry' },
            ],
          },
        ],
        directions: [
          'Sear the chicken until golden, about 5 minutes. Set aside.',
          'Sauté garlic, then add cream and sun-dried tomatoes and simmer 3 minutes.',
          'Stir in spinach until wilted, return the chicken, and toss with pasta.',
        ],
        servings: '4',
        prepTime: '',
        cookTime: '15 min',
        totalTime: '',
        cuisine: 'Italian',
        course: 'dinner',
        dishType: 'pasta',
        dietaryTags: [],
        notes: '',
        confidence: 0.95,
        needsReview: false,
      },
    },
  ],
  drink: [
    {
      raw: '2 oz rye whiskey, 0.75 oz sweet vermouth, 2 dashes Angostura bitters. Stir with ice, strain into a coupe, express an orange peel over the top.',
      output: {
        isRecipe: true,
        kind: 'drink',
        title: 'Manhattan',
        ingredientGroups: [
          {
            section: '',
            items: [
              { quantity: '2', unit: 'oz', name: 'rye whiskey', prep: '', category: 'Pantry' },
              { quantity: '0.75', unit: 'oz', name: 'sweet vermouth', prep: '', category: 'Pantry' },
              { quantity: '2', unit: 'dash', name: 'Angostura bitters', prep: '', category: 'Pantry' },
            ],
          },
        ],
        directions: [
          'Stir with ice until well chilled.',
          'Strain into a chilled coupe.',
          'Express an orange peel over the top and garnish.',
        ],
        glass: 'coupe',
        garnish: 'expressed orange peel',
        method: 'stirred',
        notes: '',
        confidence: 0.96,
        needsReview: false,
      },
    },
  ],
};

/**
 * Build Gemini `contents` few-shot turns for a given kind. Returns an array of
 * { role, parts } objects to prepend before the real user content. Keeps the
 * shot count small (cost) and kind-relevant.
 */
export function buildFewShotContents(kind = 'meal') {
  const shots = EXEMPLARS[kind] || EXEMPLARS.meal;
  const turns = [];
  for (const shot of shots.slice(0, 2)) {
    turns.push({ role: 'user', parts: [{ text: shot.raw }] });
    turns.push({ role: 'model', parts: [{ text: JSON.stringify(shot.output) }] });
  }
  return turns;
}

// -----------------------------------------------------------------------------
// 11. FLATTENING HELPERS (rich AI output -> thin SpiceHub display object)
// -----------------------------------------------------------------------------

/** Join a structured ingredient item into a display string, e.g. "2 cups flour, sifted". */
export function ingredientItemToString(item = {}) {
  const qty = (item.quantity || '').trim();
  const unit = (item.unit || '').trim();
  const name = (item.name || '').trim();
  const prep = (item.prep || '').trim();
  let head = [qty, unit].filter(Boolean).join(' ');
  let line = [head, name].filter(Boolean).join(' ').trim();
  if (prep) line = line ? `${line}, ${prep}` : prep;
  return line.trim();
}

/**
 * Flatten ingredientGroups into the flat string[] the UI/db expects. Section
 * labels become parenthetical suffixes on each item, e.g. "1 cup cream (sauce)",
 * preserving grouping information without a schema change downstream.
 */
export function flattenIngredientGroups(groups = []) {
  const out = [];
  for (const g of groups || []) {
    const section = (g.section || '').trim();
    for (const item of g.items || []) {
      let line = ingredientItemToString(item);
      if (!line) continue;
      // Phase G ingestion trash filter — drop scaling strings / header remnants
      if (isTrashIngredientLine(line)) continue;
      if (section) line = `${line} (${section})`;
      out.push(line);
    }
  }
  return out;
}

/**
 * Phase G: parallel category metadata for flattened ingredients. Returns
 * [{ text, category }] in the same order/filtering as flattenIngredientGroups.
 * category comes from the LLM when present, else the keyword fallback.
 */
export function ingredientMetaFromGroups(groups = []) {
  const out = [];
  for (const g of groups || []) {
    const section = (g.section || '').trim();
    for (const item of g.items || []) {
      let line = ingredientItemToString(item);
      if (!line) continue;
      if (isTrashIngredientLine(line)) continue;
      if (section) line = `${line} (${section})`;
      const category = GROCERY_CATEGORIES.includes(item.category)
        ? item.category
        : categorizeIngredient(item.name || line);
      out.push({ text: line, category });
    }
  }
  return out;
}

/**
 * Convert a validated RECIPE_SCHEMA object into the thin SpiceHub display
 * recipe. Pure; callers attach imageUrl / link / _type etc. as needed.
 */
export function thinFromStructured(structured = {}) {
  const kind = structured.kind === 'drink' ? 'drink' : 'meal';
  const base = {
    title: (structured.title || '').trim(),
    ingredients: flattenIngredientGroups(structured.ingredientGroups),
    // Phase G: department metadata for grocery routing (non-breaking sidecar)
    _ingredientMeta: ingredientMetaFromGroups(structured.ingredientGroups),
    directions: Array.isArray(structured.directions) ? structured.directions.filter(Boolean) : [],
    notes: structured.notes || '',
    confidence: typeof structured.confidence === 'number' ? structured.confidence : null,
    needsReview: !!structured.needsReview,
    _type: kind,
  };
  if (kind === 'drink') {
    return {
      ...base,
      glass: structured.glass || '',
      garnish: structured.garnish || '',
      method: structured.method || '',
    };
  }
  return {
    ...base,
    servings: structured.servings || '',
    prepTime: structured.prepTime || '',
    cookTime: structured.cookTime || '',
    totalTime: structured.totalTime || '',
    cuisine: structured.cuisine || '',
    course: structured.course || '',
    dishType: structured.dishType || '',
    dietaryTags: Array.isArray(structured.dietaryTags) ? structured.dietaryTags : [],
  };
}

// Convenience export bundle for callers that prefer a namespace import.
export default {
  UNIT_CANON, UNIT_LOOKUP, UNIT_ALIASES_ALL, canonicalizeUnit,
  normalizeFraction, wordToNumber,
  INGREDIENT_ALIASES, resolveIngredientAlias,
  GROCERY_CATEGORIES, categorizeIngredient, isTrashIngredientLine,
  COURSE, DISH_TYPE, CUISINE, DIETARY_TAGS,
  SECTION_HEADERS, isSectionHeader, sectionLabelFrom,
  SPIRITS, LIQUEURS, COCKTAIL_ACTIONS, GLASSWARE, DRINK_METHODS, detectKindHeuristic,
  DISPLAY_SCHEMA, RECIPE_SCHEMA, SYSTEM_INSTRUCTION, EXEMPLARS, buildFewShotContents,
  ingredientItemToString, flattenIngredientGroups, ingredientMetaFromGroups, thinFromStructured,
};
