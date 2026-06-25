/**
 * ingredientNormalizer.js — Extended ingredient normalization layer for SpiceHub.
 *
 * This module AUGMENTS the base recipeSchema.js with richer normalization data
 * sourced from curated resource JSON files (measurements, units, modifiers,
 * adverbs, instructions, ingredients, conversions, amounts, language).
 *
 * Architecture:
 *   recipeSchema.js  — base layer: UNIT_CANON, UNIT_LOOKUP, canonicalizeUnit,
 *                       normalizeFraction, wordToNumber, resolveIngredientAlias,
 *                       fuzzyResolveIngredient, categorizeIngredient, etc.
 *   ingredientNormalizer.js (this file) — augmentation layer that extends
 *                       recipeSchema with thousands of additional unit aliases,
 *                       prep-word stripping, a comprehensive ingredient catalog,
 *                       unit conversion, threshold-based auto-conversion, and
 *                       grocery consolidation.
 *
 * All maps are lazily initialized on first use. Zero DOM/network dependencies —
 * safe for workers and server contexts. All JSON imports are resolved at build
 * time by Vite.
 */

// ── Base layer imports from recipeSchema ──────────────────────────────────────
import {
  canonicalizeUnit,
  normalizeFraction,
  wordToNumber,
  resolveIngredientAlias,
  fuzzyResolveIngredient,
  categorizeIngredient,
  normalizeIngredientForMatching,
  UNIT_LOOKUP,
} from '../recipeSchema';

// ── Resource JSON imports (resolved at build time by Vite) ────────────────────
import measurementsData from '../data/ingredients/measurements.json';
import unitsData from '../data/ingredients/units.json';
import modifiersData from '../data/ingredients/modifiers.json';
import adverbsData from '../data/ingredients/adverbs.json';
import instructionsData from '../data/ingredients/instructions.json';
import conversionsData from '../data/ingredients/conversions.json';
import amountsData from '../data/ingredients/amounts.json';
import ingredientsData from '../data/ingredients/ingredients.json';
import languageData from '../data/ingredients/language.json';

// ── Lazy-init state ───────────────────────────────────────────────────────────
let _initialized = false;
let _extendedUnitMap = null;       // Map<string, string>  alias -> canonical unit
let _prepStripSet = null;          // Set<string>  words to strip before matching
let _ingredientCatalog = null;     // Map<string, {canonical, category}>
let _numberWords = null;           // Map<string, number>  word -> numeric value
let _conversionIndex = null;       // Map<string, {type, ratio}>  measurement name -> conversion data
let _thresholds = null;            // Array from conversions.json
let _languageWords = null;         // Set<string>  connector words ("or", "to", "and", "of")

// ── Aisle-to-department mapping (inverse of recipeSchema's DEPARTMENT_TO_AISLE) ─
// resolveIngredientAlias / fuzzyResolveIngredient return lowercase aisle names;
// we need GROCERY_CATEGORIES department names in our output.
const AISLE_TO_DEPT = {
  produce:    'Produce',
  baking:     'Pantry',
  pantry:     'Pantry',
  condiments: 'Pantry',
  canned:     'Pantry',
  dairy:      'Dairy',
  meat:       'Meat & Seafood',
  seafood:    'Meat & Seafood',
  bakery:     'Bakery',
  frozen:     'Frozen',
  unknown:    'Other',
};

// ── Category mapping from ingredients.json keys -> GROCERY_CATEGORIES ─────────
// GROCERY_CATEGORIES in recipeSchema: ['Produce','Meat & Seafood','Dairy','Pantry','Frozen','Bakery','Other']
const CATEGORY_MAP = {
  'Frozen Foods':           'Frozen',
  'Breads and Cereals':     'Bakery',
  'Meat':                   'Meat & Seafood',
  'Seafood':                'Meat & Seafood',
  'Pasta, Rice and Beans':  'Pantry',
  'Baby Products':          'Other',
  'Oils and Dressings':     'Pantry',
  'Bakery':                 'Bakery',
  'Dairy':                  'Dairy',
  'Pet Products':           'Other',
  'International Cuisine':  'Pantry',
  'Beer, Wine and Spirits': 'Pantry',
  'Snacks':                 'Pantry',
  'Deli':                   'Meat & Seafood',
  'Canned and Jar Goods':   'Pantry',
  'Beverages':              'Pantry',
  'Sauces and Condiments':  'Pantry',
  'Miscellaneous':          'Other',
  'Cleaning Supplies':      'Other',
  'Home and Garden':        'Other',
  'Produce':                'Produce',
  'Baking Goods':           'Pantry',
  'Spices and Seasonings':  'Pantry',
  'Health and Beauty':      'Other',
};

// ── Measurement name -> UNIT_CANON key mapping ────────────────────────────────
// Maps the full measurement name from measurements.json to the canonical short
// key used in recipeSchema's UNIT_CANON.
const MEASUREMENT_TO_CANON = {
  'cup':          'cup',
  'ounce':        'oz',
  'gram':         'g',
  'teaspoon':     'tsp',
  'pint':         'pint',
  'inch':         'inch',
  'kilogram':     'kg',
  'milliliter':   'ml',
  'pound':        'lb',
  'deciliter':    'dl',
  'fluid ounce':  'oz',
  'quart':        'quart',
  'liter':        'l',
  'gallon':       'gallon',
  'centimeter':   'cm',
  'tablespoon':   'tbsp',
  'centiliter':   'cl',
  'fahrenheit':   'fahrenheit',
  'celsius':      'celsius',
  'millimeter':   'mm',
  'milligram':    'mg',
  'foot':         'ft',
};

// ── Helper: replace "+" with space in ingredient strings ──────────────────────
function plusToSpace(str) {
  return str.replace(/\s*\+\s*/g, ' ').trim();
}

// ── initializeNormalizer ──────────────────────────────────────────────────────
/**
 * initializeNormalizer — Build all internal maps from the JSON resource data.
 * Called lazily on first use of any exported function, but can be called
 * explicitly to pre-warm (e.g., at app startup). Safe to call multiple times.
 */
export function initializeNormalizer() {
  if (_initialized) return;

  // ── 1. Build extendedUnitMap ──────────────────────────────────────────────
  // Start with a copy of recipeSchema's UNIT_LOOKUP
  _extendedUnitMap = new Map(Object.entries(UNIT_LOOKUP));

  // Add aliases from measurements.json
  for (const m of measurementsData) {
    const canon = MEASUREMENT_TO_CANON[m.name] || m.name;
    // Add the name itself
    _extendedUnitMap.set(m.name.toLowerCase(), canon);
    // Add the plural if present
    if (m.plural) {
      _extendedUnitMap.set(m.plural.toLowerCase(), canon);
    }
    // Add variations
    if (Array.isArray(m.variations)) {
      for (const v of m.variations) {
        if (typeof v === 'string') {
          _extendedUnitMap.set(v.toLowerCase(), canon);
        } else if (Array.isArray(v)) {
          // [singular, plural] pairs
          for (const form of v) {
            _extendedUnitMap.set(form.toLowerCase(), canon);
          }
        }
      }
    }
  }

  // Add aliases from units.json
  for (const u of unitsData) {
    if (typeof u === 'string') {
      // Simple string unit like "x" or "u"
      if (!_extendedUnitMap.has(u.toLowerCase())) {
        _extendedUnitMap.set(u.toLowerCase(), u.toLowerCase());
      }
    } else if (Array.isArray(u)) {
      // [singular, plural]
      const canonical = u[0].toLowerCase();
      for (const form of u) {
        if (!_extendedUnitMap.has(form.toLowerCase())) {
          _extendedUnitMap.set(form.toLowerCase(), canonical);
        }
      }
    } else if (u && typeof u === 'object' && u.name) {
      // Object with name, plural, variations
      const canonical = u.name.toLowerCase();
      _extendedUnitMap.set(canonical, canonical);
      if (u.plural) {
        _extendedUnitMap.set(u.plural.toLowerCase(), canonical);
      }
      if (Array.isArray(u.variations)) {
        for (const v of u.variations) {
          if (typeof v === 'string') {
            _extendedUnitMap.set(v.toLowerCase(), canonical);
          } else if (Array.isArray(v)) {
            for (const form of v) {
              _extendedUnitMap.set(form.toLowerCase(), canonical);
            }
          }
        }
      }
    }
  }

  // ── 2. Build prepStripSet ─────────────────────────────────────────────────
  _prepStripSet = new Set();
  for (const word of modifiersData) {
    _prepStripSet.add(word.toLowerCase());
  }
  for (const word of adverbsData) {
    _prepStripSet.add(word.toLowerCase());
  }
  for (const word of instructionsData) {
    _prepStripSet.add(word.toLowerCase());
  }

  // ── 3. Build ingredientCatalog ────────────────────────────────────────────
  _ingredientCatalog = new Map();

  for (const [rawCategory, items] of Object.entries(ingredientsData)) {
    const category = CATEGORY_MAP[rawCategory] || 'Other';

    for (const item of items) {
      if (typeof item === 'string') {
        // Could be "ice" or "frozen + chopped + spinach"
        const canonical = plusToSpace(item);
        _ingredientCatalog.set(canonical.toLowerCase(), { canonical, category });
      } else if (Array.isArray(item)) {
        // [singular, plural] — canonical is the singular form
        const singular = plusToSpace(item[0]);
        const plural = plusToSpace(item[1]);
        _ingredientCatalog.set(singular.toLowerCase(), { canonical: singular, category });
        if (plural.toLowerCase() !== singular.toLowerCase()) {
          _ingredientCatalog.set(plural.toLowerCase(), { canonical: singular, category });
        }
      } else if (item && typeof item === 'object' && item.name) {
        // Object: { name, plural?, variations? }
        const canonical = plusToSpace(item.name);
        _ingredientCatalog.set(canonical.toLowerCase(), { canonical, category });
        if (item.plural) {
          _ingredientCatalog.set(plusToSpace(item.plural).toLowerCase(), { canonical, category });
        }
        if (Array.isArray(item.variations)) {
          for (const v of item.variations) {
            if (typeof v === 'string') {
              _ingredientCatalog.set(plusToSpace(v).toLowerCase(), { canonical, category });
            } else if (Array.isArray(v)) {
              for (const form of v) {
                _ingredientCatalog.set(plusToSpace(form).toLowerCase(), { canonical, category });
              }
            }
          }
        }
      }
    }
  }

  // ── 4. Build numberWords ──────────────────────────────────────────────────
  _numberWords = new Map();
  const ordinalValues = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
    a: 1, an: 1, dozen: 12,
    half: 0.5, quarter: 0.25, quarters: 0.25,
    third: 0.333, thirds: 0.333,
    fours: 0.25, fourth: 0.25, fourths: 0.25,
    fifth: 0.2, fifths: 0.2,
    sixth: 0.167, sixths: 0.167,
    eighth: 0.125, eighths: 0.125, eights: 0.125,
    tenth: 0.1, tenths: 0.1,
  };
  for (const word of amountsData) {
    const lw = word.toLowerCase();
    if (ordinalValues[lw] !== undefined) {
      _numberWords.set(lw, ordinalValues[lw]);
    }
  }

  // ── 5. Build conversion index ─────────────────────────────────────────────
  _conversionIndex = new Map();
  if (conversionsData.conversions) {
    for (const c of conversionsData.conversions) {
      _conversionIndex.set(c.measurement.toLowerCase(), {
        type: c.type,
        ratio: c.ratio,
        system: c.system,
      });
    }
  }
  _thresholds = conversionsData.thresholds || [];

  // ── 6. Build language words set ───────────────────────────────────────────
  _languageWords = new Set(languageData.map(w => w.toLowerCase()));

  _initialized = true;
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * resolveUnit — Extended unit resolution.
 * 1. Try recipeSchema's canonicalizeUnit first.
 * 2. If empty, try the extended unit map built from measurements.json + units.json.
 * @param {string} raw - Raw unit string (e.g. "tblspn", "ozs", "head")
 * @returns {string} Canonical unit key or ''
 */
export function resolveUnit(raw = '') {
  if (!raw) return '';
  initializeNormalizer();

  // Try base layer first
  const base = canonicalizeUnit(raw);
  if (base) return base;

  // Try extended map
  const extended = _extendedUnitMap.get(raw.toLowerCase());
  return extended || '';
}

/**
 * stripPrepNoise — Remove prep/modifier words from an ingredient string.
 * 1. Remove parentheticals: "(about 2 lbs)"
 * 2. Remove text after commas (prep instructions): "chicken breast, diced"
 * 3. Strip words that are in the prepStripSet (modifiers, adverbs, instructions)
 * 4. Collapse whitespace
 * @param {string} str - Ingredient string possibly containing prep noise
 * @returns {string} Cleaned ingredient string
 */
export function stripPrepNoise(str = '') {
  if (!str) return '';
  initializeNormalizer();

  let s = String(str);

  // Remove parentheticals
  s = s.replace(/\([^)]*\)/g, '');

  // Remove text after commas (prep instructions like ", diced", ", to taste")
  const commaIdx = s.indexOf(',');
  if (commaIdx > 0) {
    s = s.substring(0, commaIdx);
  }

  // Strip prep/modifier words
  const words = s.split(/\s+/).filter(Boolean);
  const cleaned = words.filter(w => !_prepStripSet.has(w.toLowerCase()));

  // Collapse whitespace
  return cleaned.join(' ').trim();
}

/**
 * resolveNumberWord — Convert a word to its numeric value using the extended
 * amounts data. Falls back to recipeSchema's wordToNumber.
 * @param {string} word
 * @returns {number|null}
 */
export function resolveNumberWord(word = '') {
  if (!word) return null;
  initializeNormalizer();

  const lw = word.toLowerCase().trim();
  if (_numberWords.has(lw)) return _numberWords.get(lw);

  // Fallback to recipeSchema
  const base = wordToNumber(lw);
  if (base !== null && base !== undefined && base !== '') {
    const n = Number(base);
    return isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Parse a raw quantity string into a numeric value.
 * Handles fractions ("1/2"), mixed numbers ("1 1/2"), unicode fractions ("1½"),
 * number words ("three"), and ranges ("2-3" takes the first value).
 * @param {string} raw
 * @returns {number|null}
 */
function parseQuantity(raw = '') {
  if (!raw) return null;

  // Normalize unicode fractions
  let s = normalizeFraction(raw).trim();

  // Handle ranges — take the first value
  s = s.split(/\s*[-–—]\s*/)[0].trim();
  s = s.split(/\s+to\s+/i)[0].trim();

  // Try number word
  const wordNum = resolveNumberWord(s);
  if (wordNum !== null) return wordNum;

  // Mixed number: "1 1/2" or "2 3/4"
  const mixedMatch = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1], 10) + parseInt(mixedMatch[2], 10) / parseInt(mixedMatch[3], 10);
  }

  // Simple fraction: "1/2"
  const fracMatch = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fracMatch) {
    return parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
  }

  // Plain number
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * normalizeIngredient — Main entry point for ingredient normalization.
 * 1. Call normalizeFraction() on the raw string
 * 2. Call stripPrepNoise()
 * 3. Call resolveUnit() on detected unit token
 * 4. Try resolveIngredientAlias() on the food name
 * 5. If no alias hit, try ingredientCatalog lookup
 * 6. If still no hit, try fuzzyResolveIngredient()
 * @param {string} rawString - Full ingredient line, e.g. "1 1/2 cups finely chopped onion"
 * @returns {{ quantity: number|null, unit: string, item: string, canonical: string, category: string, confidence: number, source: string }}
 */
export function normalizeIngredient(rawString = '') {
  initializeNormalizer();

  if (!rawString || !rawString.trim()) {
    return { quantity: null, unit: '', item: '', canonical: '', category: 'Other', confidence: 0, source: 'unresolved' };
  }

  // Step 1: Normalize fractions
  let s = normalizeFraction(rawString).trim();

  // Step 2: Extract quantity from the beginning
  let quantity = null;
  let rest = s;

  // Try to parse leading quantity (numbers, fractions, mixed numbers, words)
  // Pattern: optional leading number(s) that could be "1", "1/2", "1 1/2", "one", etc.
  const qtyPatterns = [
    // Mixed number: "1 1/2", "2 3/4"
    /^(\d+\s+\d+\s*\/\s*\d+)\s+/,
    // Fraction: "1/2"
    /^(\d+\s*\/\s*\d+)\s+/,
    // Decimal or integer: "1.5", "2"
    /^(\d+\.?\d*)\s+/,
  ];

  let qtyStr = '';
  for (const pat of qtyPatterns) {
    const m = s.match(pat);
    if (m) {
      qtyStr = m[1];
      rest = s.substring(m[0].length);
      break;
    }
  }

  // If no numeric match, try word numbers at the start
  if (!qtyStr) {
    const firstWord = s.split(/\s+/)[0];
    const wordVal = resolveNumberWord(firstWord);
    if (wordVal !== null) {
      qtyStr = firstWord;
      rest = s.substring(firstWord.length).trim();
    }
  }

  quantity = parseQuantity(qtyStr);

  // Step 3: Detect and resolve unit from the next token(s)
  let unit = '';
  let afterUnit = rest;

  // Try multi-word units first (e.g., "fl oz", "fluid ounce")
  const restWords = rest.split(/\s+/).filter(Boolean);
  if (restWords.length >= 2) {
    const twoWord = (restWords[0] + ' ' + restWords[1]).toLowerCase();
    const resolvedTwo = resolveUnit(twoWord);
    if (resolvedTwo) {
      unit = resolvedTwo;
      afterUnit = restWords.slice(2).join(' ');
    }
  }
  if (!unit && restWords.length >= 1) {
    // Remove trailing period from abbreviation (e.g., "tbsp.")
    const firstToken = restWords[0].replace(/\.$/, '');
    const resolvedOne = resolveUnit(firstToken);
    if (resolvedOne) {
      unit = resolvedOne;
      afterUnit = restWords.slice(1).join(' ');
    }
  }

  // Step 2 (deferred): Strip prep noise from the food name portion
  let foodName = stripPrepNoise(afterUnit).trim();

  // Also strip language words from start/end ("of", "and")
  const foodWords = foodName.split(/\s+/).filter(Boolean);
  while (foodWords.length > 0 && _languageWords.has(foodWords[0].toLowerCase())) {
    foodWords.shift();
  }
  while (foodWords.length > 0 && _languageWords.has(foodWords[foodWords.length - 1].toLowerCase())) {
    foodWords.pop();
  }
  foodName = foodWords.join(' ');

  const item = foodName;

  // Step 4: Try resolveIngredientAlias (recipeSchema base layer)
  let canonical = '';
  let category = 'Other';
  let confidence = 0;
  let source = 'unresolved';

  const alias = resolveIngredientAlias(foodName);
  if (alias) {
    canonical = alias.canonical;
    category = (alias.aisle && AISLE_TO_DEPT[alias.aisle]) || categorizeIngredient(alias.canonical);
    confidence = 1.0;
    source = 'alias';
  }

  // Step 5: If no alias, try ingredientCatalog
  if (!canonical) {
    const catalogEntry = _ingredientCatalog.get(foodName.toLowerCase());
    if (catalogEntry) {
      canonical = catalogEntry.canonical;
      category = catalogEntry.category;
      confidence = 0.95;
      source = 'catalog';
    }
  }

  // Step 5b: Try with normalizeIngredientForMatching (strip qty/unit/prep again)
  if (!canonical) {
    const bareFood = normalizeIngredientForMatching(foodName);
    if (bareFood && bareFood !== foodName) {
      const catalogEntry2 = _ingredientCatalog.get(bareFood.toLowerCase());
      if (catalogEntry2) {
        canonical = catalogEntry2.canonical;
        category = catalogEntry2.category;
        confidence = 0.9;
        source = 'catalog';
      }
    }
  }

  // Step 6: Try fuzzyResolveIngredient (recipeSchema)
  // Note: fuzzyResolveIngredient never returns null — returns { method:'none', score:0 }
  // when no match is found.
  if (!canonical) {
    const fuzzy = fuzzyResolveIngredient(foodName, 0.82);
    if (fuzzy && fuzzy.method !== 'none' && fuzzy.score >= 0.82) {
      canonical = fuzzy.canonical;
      category = (fuzzy.aisle && AISLE_TO_DEPT[fuzzy.aisle]) || categorizeIngredient(fuzzy.canonical);
      confidence = fuzzy.score;
      source = 'fuzzy';
    }
  }

  // Last resort: use categorizeIngredient on the raw food name
  if (!canonical) {
    canonical = foodName;
    category = categorizeIngredient(foodName);
    confidence = category !== 'Other' ? 0.5 : 0.1;
    source = 'unresolved';
  }

  return { quantity, unit, item, canonical, category, confidence, source };
}

/**
 * convertUnit — Convert a quantity from one unit to another using conversions.json.
 * Only converts between compatible types (volume<->volume, weight<->weight).
 * @param {number} quantity
 * @param {string} fromUnit - Canonical or measurement name
 * @param {string} toUnit - Canonical or measurement name
 * @returns {number|null} Converted quantity, or null if incompatible
 */
export function convertUnit(quantity, fromUnit, toUnit) {
  if (quantity == null || !fromUnit || !toUnit) return null;
  initializeNormalizer();

  // Resolve to measurement names for the conversion index
  const fromMeasurement = _resolveToMeasurement(fromUnit);
  const toMeasurement = _resolveToMeasurement(toUnit);

  if (!fromMeasurement || !toMeasurement) return null;

  const fromConv = _conversionIndex.get(fromMeasurement);
  const toConv = _conversionIndex.get(toMeasurement);

  if (!fromConv || !toConv) return null;

  // Only convert within same type
  if (fromConv.type !== toConv.type) return null;

  // Convert: quantity in fromUnit -> base unit -> toUnit
  // ratio = how many of this unit per 1 base unit (liter for volume, gram for weight)
  // So: base_quantity = quantity / fromRatio
  //     result = base_quantity * toRatio
  const baseQuantity = quantity / fromConv.ratio;
  return baseQuantity * toConv.ratio;
}

/**
 * Resolve a canonical unit key or measurement name to the measurement name
 * used in the conversions index.
 * @param {string} unit
 * @returns {string|null}
 */
function _resolveToMeasurement(unit) {
  const lw = unit.toLowerCase();

  // Direct match in conversion index
  if (_conversionIndex.has(lw)) return lw;

  // Check MEASUREMENT_TO_CANON reverse: find measurement name that maps to this canon key
  for (const [measurement, canon] of Object.entries(MEASUREMENT_TO_CANON)) {
    if (canon === lw || measurement === lw) {
      if (_conversionIndex.has(measurement.toLowerCase())) {
        return measurement.toLowerCase();
      }
    }
  }

  // Try resolving the unit first, then look up
  const resolved = resolveUnit(unit);
  if (resolved) {
    for (const [measurement, canon] of Object.entries(MEASUREMENT_TO_CANON)) {
      if (canon === resolved) {
        if (_conversionIndex.has(measurement.toLowerCase())) {
          return measurement.toLowerCase();
        }
      }
    }
  }

  return null;
}

/**
 * shouldAutoConvert — Check if a quantity exceeds a threshold and should be
 * auto-converted to a larger unit.
 * E.g., 48 tsp should suggest conversion to cups.
 * @param {number} quantity
 * @param {string} unit - Canonical unit key or measurement name
 * @returns {{ convertTo: string, newQuantity: number }|null}
 */
export function shouldAutoConvert(quantity, unit) {
  if (quantity == null || !unit) return null;
  initializeNormalizer();

  const measurement = _resolveToMeasurement(unit);
  if (!measurement) return null;

  // Find applicable threshold
  for (const t of _thresholds) {
    if (t.measurement.toLowerCase() === measurement && quantity >= t.quantity) {
      const convertTo = t.convert_to.toLowerCase();
      const newQuantity = convertUnit(quantity, unit, convertTo);
      if (newQuantity !== null) {
        // Find the canonical key for the target unit
        const canonTarget = MEASUREMENT_TO_CANON[convertTo] || convertTo;
        return { convertTo: canonTarget, newQuantity };
      }
    }
  }

  return null;
}

/**
 * consolidateGroceries — Merge duplicate ingredients in a grocery list.
 * Takes an array of raw ingredient strings OR structured items and normalizes,
 * groups by canonical name, and sums compatible quantities.
 * @param {Array<string|{quantity:number, unit:string, name:string}>} ingredients
 * @returns {Array<{canonical:string, category:string, totalQuantity:number|null, unit:string, sources:string[], confidence:number}>}
 */
export function consolidateGroceries(ingredients = []) {
  initializeNormalizer();

  if (!Array.isArray(ingredients) || ingredients.length === 0) return [];

  // Normalize each ingredient
  const normalized = ingredients.map(ing => {
    if (typeof ing === 'string') {
      return { ...normalizeIngredient(ing), raw: ing };
    }
    // Structured item: { quantity, unit, name }
    const resolved = normalizeIngredient(
      `${ing.quantity || ''} ${ing.unit || ''} ${ing.name || ''}`.trim()
    );
    // Override with provided values if more specific
    return {
      ...resolved,
      quantity: ing.quantity != null ? ing.quantity : resolved.quantity,
      unit: ing.unit ? (resolveUnit(ing.unit) || ing.unit) : resolved.unit,
      raw: `${ing.quantity || ''} ${ing.unit || ''} ${ing.name || ''}`.trim(),
    };
  });

  // Group by canonical name (lowercased)
  const groups = new Map();

  for (const item of normalized) {
    const key = item.canonical.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        canonical: item.canonical,
        category: item.category,
        entries: [],
        confidence: item.confidence,
      });
    }
    const group = groups.get(key);
    group.entries.push(item);
    // Keep highest confidence
    if (item.confidence > group.confidence) {
      group.confidence = item.confidence;
      group.category = item.category;
    }
  }

  // Consolidate quantities within each group
  const result = [];

  for (const [, group] of groups) {
    const sources = group.entries.map(e => e.raw).filter(Boolean);

    // Group entries by unit for summing
    const unitGroups = new Map();
    let hasNullQuantity = false;

    for (const entry of group.entries) {
      if (entry.quantity == null) {
        hasNullQuantity = true;
        continue;
      }

      const unitKey = entry.unit || '_none_';

      if (unitGroups.has(unitKey)) {
        unitGroups.get(unitKey).total += entry.quantity;
      } else {
        unitGroups.set(unitKey, { unit: entry.unit, total: entry.quantity });
      }
    }

    // Try to merge unit groups if they are convertible
    const unitEntries = [...unitGroups.values()];

    if (unitEntries.length > 1) {
      // Try to convert all to the first unit
      const primary = unitEntries[0];
      for (let i = 1; i < unitEntries.length; i++) {
        const secondary = unitEntries[i];
        if (primary.unit && secondary.unit) {
          const converted = convertUnit(secondary.total, secondary.unit, primary.unit);
          if (converted !== null) {
            primary.total += converted;
            unitEntries.splice(i, 1);
            i--;
          }
        }
      }
    }

    // Output one entry per remaining unit group
    if (unitEntries.length === 0 && hasNullQuantity) {
      // No quantities at all
      result.push({
        canonical: group.canonical,
        category: group.category,
        totalQuantity: null,
        unit: '',
        sources,
        confidence: group.confidence,
      });
    } else {
      for (const ug of unitEntries) {
        // Check for auto-conversion
        const autoConv = shouldAutoConvert(ug.total, ug.unit);
        const finalQuantity = autoConv ? autoConv.newQuantity : ug.total;
        const finalUnit = autoConv ? autoConv.convertTo : ug.unit;

        result.push({
          canonical: group.canonical,
          category: group.category,
          totalQuantity: Math.round(finalQuantity * 1000) / 1000,
          unit: finalUnit,
          sources,
          confidence: group.confidence,
        });
      }
      // If some entries had no quantity, add one more without
      if (hasNullQuantity && unitEntries.length > 0) {
        result.push({
          canonical: group.canonical,
          category: group.category,
          totalQuantity: null,
          unit: '',
          sources: sources.filter(s => {
            const n = normalizeIngredient(s);
            return n.quantity == null;
          }),
          confidence: group.confidence,
        });
      }
    }
  }

  return result;
}

// ── Convenience exports for testing / advanced usage ──────────────────────────

/**
 * Get the full extended unit map (read-only snapshot).
 * @returns {Map<string, string>}
 */
export function getExtendedUnitMap() {
  initializeNormalizer();
  return new Map(_extendedUnitMap);
}

/**
 * Get the prep strip set (read-only snapshot).
 * @returns {Set<string>}
 */
export function getPrepStripSet() {
  initializeNormalizer();
  return new Set(_prepStripSet);
}

/**
 * Get the ingredient catalog (read-only snapshot).
 * @returns {Map<string, {canonical:string, category:string}>}
 */
export function getIngredientCatalog() {
  initializeNormalizer();
  return new Map(_ingredientCatalog);
}

/**
 * Get the number words map (read-only snapshot).
 * @returns {Map<string, number>}
 */
export function getNumberWords() {
  initializeNormalizer();
  return new Map(_numberWords);
}

/**
 * Get the category mapping from ingredients.json keys to GROCERY_CATEGORIES.
 * @returns {Object}
 */
export function getCategoryMap() {
  return { ...CATEGORY_MAP };
}
