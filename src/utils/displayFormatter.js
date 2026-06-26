// src/utils/displayFormatter.js
//
// Smart display formatting engine.
// Converts raw ingredient data into polished, human-readable strings with:
//   - Unicode fraction rendering (½, ⅓, ¾, etc.)
//   - Automatic unit pluralization ("1 cup" → "2 cups")
//   - Automatic food pluralization ("1 tomato" → "2 tomatoes")
//   - Professional formatted ingredient lines
//
// Pure module: no I/O, no imports beyond recipeSchema constants. Never throws.

import {
  pluralizeUnit,
  pluralizeFood,
  UNIT_PLURALS,
  FOOD_PLURALS,
} from '../recipeSchema.js';

// ---------------------------------------------------------------------------
// 1. UNICODE FRACTION RENDERING
// ---------------------------------------------------------------------------
// SUPERSCRIPT/SUBSCRIPT maps for arbitrary n/d fractions,
// with a fast path for common vulgar fraction code points.

const SUPERSCRIPT = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹',
};

const SUBSCRIPT = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃',
  '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉',
};

// Common fractions → single Unicode code points (preferred when available)
const VULGAR_FRACTIONS = {
  '1/2': '½',  // ½
  '1/3': '⅓',  // ⅓
  '2/3': '⅔',  // ⅔
  '1/4': '¼',  // ¼
  '3/4': '¾',  // ¾
  '1/5': '⅕',  // ⅕
  '2/5': '⅖',  // ⅖
  '3/5': '⅗',  // ⅗
  '4/5': '⅘',  // ⅘
  '1/6': '⅙',  // ⅙
  '5/6': '⅚',  // ⅚
  '1/7': '⅐',  // ⅐
  '1/8': '⅛',  // ⅛
  '3/8': '⅜',  // ⅜
  '5/8': '⅝',  // ⅝
  '7/8': '⅞',  // ⅞
  '1/9': '⅑',  // ⅑
  '1/10': '⅒', // ⅒
};

// Fraction slash (U+2044) used in superscript/subscript rendering
const FRACTION_SLASH = '⁄'; // ⁄

/**
 * Convert a fraction string like "1/2" to Unicode display form.
 * Uses vulgar fraction code points when available, otherwise builds
 * superscript-numerator ⁄ subscript-denominator.
 *
 * @param {string} fraction - e.g. "3/4", "1/16"
 * @returns {string} Unicode fraction
 */
export function formatFraction(fraction) {
  if (!fraction || typeof fraction !== 'string') return fraction || '';
  const trimmed = fraction.trim();

  // Fast path: known vulgar fraction
  if (VULGAR_FRACTIONS[trimmed]) return VULGAR_FRACTIONS[trimmed];

  // Must be n/d format
  const parts = trimmed.split('/');
  if (parts.length !== 2) return trimmed;

  const [numStr, denStr] = parts.map(p => p.trim());
  if (!numStr || !denStr || !/^\d+$/.test(numStr) || !/^\d+$/.test(denStr)) {
    return trimmed;
  }

  // Build superscript numerator + fraction slash + subscript denominator
  const sup = numStr.split('').map(c => SUPERSCRIPT[c] || c).join('');
  const sub = denStr.split('').map(c => SUBSCRIPT[c] || c).join('');
  return `${sup}${FRACTION_SLASH}${sub}`;
}

// Max denominator for decimal→fraction conversion
const MAX_DENOMINATOR = 32;
// Precision: 3 decimal places
const QTY_PRECISION = 3;

/**
 * Convert a decimal number to a mixed fraction string.
 * E.g. 1.5 → "1 1/2", 0.75 → "3/4", 2.333 → "2 1/3".
 * Returns null if the number cannot be cleanly represented as a fraction
 * within MAX_DENOMINATOR.
 */
export function decimalToFraction(value) {
  if (value == null || isNaN(value)) return null;
  const num = Number(value);
  if (num < 0) return null;
  if (num === 0) return '0';
  if (Number.isInteger(num)) return String(num);

  const whole = Math.floor(num);
  const remainder = num - whole;

  // Find best fraction approximation via brute force (small denominator space)
  let bestNum = 0;
  let bestDen = 1;
  let bestErr = Infinity;

  for (let den = 2; den <= MAX_DENOMINATOR; den++) {
    const approxNum = Math.round(remainder * den);
    const err = Math.abs(remainder - approxNum / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = approxNum;
      bestDen = den;
    }
    if (err < 1e-9) break; // exact match
  }

  // If error > 5%, it's not a clean fraction — return decimal
  if (bestErr > 0.05) return null;

  // Simplify fraction via GCD
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(bestNum, bestDen);
  bestNum /= g;
  bestDen /= g;

  if (bestNum === 0) return whole > 0 ? String(whole) : '0';
  if (bestNum >= bestDen) {
    // Overflow: e.g. 0.99 rounded to 1/1 — just increment whole
    return String(whole + 1);
  }

  const fracStr = `${bestNum}/${bestDen}`;
  return whole > 0 ? `${whole} ${fracStr}` : fracStr;
}

/**
 * Format a quantity for display. Handles:
 *   - Already fractional strings: "1/2" → "½", "2 1/2" → "2 ½"
 *   - Decimal numbers: 1.5 → "1 ½", 0.75 → "¾"
 *   - Integers: "2" → "2"
 *   - Ranges: "2-3" → "2–3" (en-dash)
 *   - Empty/null → ""
 *
 * When useFractions is false, returns the raw quantity without fraction conversion.
 */
export function formatQuantity(qty, { useFractions = true } = {}) {
  if (qty == null || qty === '') return '';
  const str = String(qty).trim();
  if (!str) return '';

  if (!useFractions) {
    // Just clean up: normalize range dashes
    return str.replace(/\s*-\s*/g, '–');
  }

  // Range: "2-3" or "2 - 3"
  if (/^\d+\s*-\s*\d+$/.test(str)) {
    const [lo, hi] = str.split(/\s*-\s*/);
    return `${lo}–${hi}`;
  }

  // Mixed fraction: "2 1/2"
  const mixedMatch = str.match(/^(\d+)\s+(\d+\/\d+)$/);
  if (mixedMatch) {
    const whole = mixedMatch[1];
    const frac = formatFraction(mixedMatch[2]);
    return `${whole} ${frac}`; // thin space between whole and fraction
  }

  // Simple fraction: "1/2"
  if (/^\d+\/\d+$/.test(str)) {
    return formatFraction(str);
  }

  // Decimal: try converting to fraction
  const num = parseFloat(str);
  if (!isNaN(num) && str === String(num)) {
    if (Number.isInteger(num)) return String(num);
    const frac = decimalToFraction(num);
    if (frac) {
      // frac is like "1 1/2" or "3/4" — format the fraction parts
      const fracMixed = frac.match(/^(\d+)\s+(\d+\/\d+)$/);
      if (fracMixed) {
        return `${fracMixed[1]} ${formatFraction(fracMixed[2])}`;
      }
      if (/^\d+\/\d+$/.test(frac)) {
        return formatFraction(frac);
      }
      return frac;
    }
    // Can't fraction: round to precision
    return Number(num.toFixed(QTY_PRECISION)).toString();
  }

  return str;
}

// ---------------------------------------------------------------------------
// 2. UNIT DISPLAY FORMATTING
// ---------------------------------------------------------------------------

/**
 * Format a unit for display with automatic pluralization.
 * "cup" + qty 2 → "cups". "oz" stays "oz" (abbreviation).
 *
 * @param {string} unit - canonical unit
 * @param {number|string} qty - quantity for pluralization
 * @returns {string} formatted unit
 */
export function formatUnit(unit, qty = 1) {
  if (!unit) return '';
  const numQty = typeof qty === 'number' ? qty : parseFloat(qty);
  const effectiveQty = isNaN(numQty) ? 1 : numQty;
  return pluralizeUnit(unit, effectiveQty);
}

// ---------------------------------------------------------------------------
// 3. FOOD NAME DISPLAY FORMATTING
// ---------------------------------------------------------------------------

/**
 * Format a food name for display with automatic pluralization.
 * "tomato" + qty 2 → "tomatoes". Uncountable foods stay singular.
 *
 * @param {string} food - food name
 * @param {number|string} qty - quantity for pluralization
 * @param {boolean} hasUnit - if true, skip food pluralization (unit handles count)
 * @returns {string} formatted food name
 */
export function formatFood(food, qty = 1, hasUnit = false) {
  if (!food) return '';
  // When there's a unit (e.g. "2 cups flour"), the food is treated as a mass
  // noun and doesn't need pluralization. Only pluralize when counting directly
  // (e.g. "2 tomatoes", "3 eggs").
  if (hasUnit) return food;
  const numQty = typeof qty === 'number' ? qty : parseFloat(qty);
  const effectiveQty = isNaN(numQty) ? 1 : numQty;
  return pluralizeFood(food, effectiveQty);
}

// ---------------------------------------------------------------------------
// 4. FORMATTED INGREDIENT LINE ASSEMBLY
// ---------------------------------------------------------------------------

/**
 * Format a structured ingredient item into a polished display string.
 *
 * Input: { quantity: "1/2", unit: "cup", name: "heavy cream", prep: "warmed" }
 * Output: "½ cup heavy cream, warmed"
 *
 * Input: { quantity: "2", unit: "", name: "tomato", prep: "" }
 * Output: "2 tomatoes"
 *
 * @param {object} item - structured ingredient { quantity, unit, name, prep, section }
 * @param {object} options
 * @param {boolean} options.useFractions - use unicode fractions (default true)
 * @param {boolean} options.includeSection - append "(section)" suffix (default false)
 * @param {number} options.scaleFactor - multiply quantity by this factor (default 1)
 * @returns {string} formatted ingredient line
 */
export function formatIngredientLine(item = {}, options = {}) {
  const { useFractions = true, includeSection = false, scaleFactor = 1 } = options;

  const rawQty = (item.quantity || '').trim();
  const unit = (item.unit || '').trim();
  const name = (item.name || '').trim();
  const prep = (item.prep || '').trim();
  const section = (item.section || '').trim();

  if (!name && !rawQty && !unit) return '';

  // Scale quantity if needed
  let effectiveQty = rawQty;
  let numericQty = NaN;

  if (rawQty && scaleFactor !== 1) {
    // Parse the quantity
    let parsed = 0;
    const mixedMatch = rawQty.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedMatch) {
      parsed = Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3]);
    } else if (rawQty.includes('/')) {
      const [n, d] = rawQty.split('/').map(Number);
      parsed = d ? n / d : 0;
    } else {
      parsed = parseFloat(rawQty);
    }

    if (!isNaN(parsed)) {
      const scaled = parsed * scaleFactor;
      numericQty = scaled;
      // Try to represent as fraction
      const frac = decimalToFraction(scaled);
      effectiveQty = frac || Number(scaled.toFixed(QTY_PRECISION)).toString();
    }
  } else if (rawQty) {
    // Parse numeric qty for pluralization decisions
    const mixedMatch = rawQty.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedMatch) {
      numericQty = Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3]);
    } else if (rawQty.includes('/')) {
      const [n, d] = rawQty.split('/').map(Number);
      numericQty = d ? n / d : NaN;
    } else {
      numericQty = parseFloat(rawQty);
    }
  }

  // Format parts
  const fmtQty = formatQuantity(effectiveQty, { useFractions });
  const fmtUnit = formatUnit(unit, isNaN(numericQty) ? 1 : numericQty);
  const fmtFood = formatFood(name, isNaN(numericQty) ? 1 : numericQty, !!unit);

  // Assemble: qty + unit + food
  let line = [fmtQty, fmtUnit, fmtFood].filter(Boolean).join(' ').trim();

  // Append prep modifier
  if (prep) line = line ? `${line}, ${prep}` : prep;

  // Append section suffix
  if (includeSection && section) line = `${line} (${section})`;

  return line;
}

/**
 * Format an entire structured ingredient array for display. Returns the same
 * structure with an updated `display` field for each item. Does not mutate
 * the original array.
 *
 * @param {Array} items - structured ingredient items (Spec A format)
 * @param {object} options - same as formatIngredientLine options
 * @returns {Array} items with updated .display
 */
export function formatIngredientList(items = [], options = {}) {
  return items.map(item => ({
    ...item,
    display: formatIngredientLine(item, options),
  }));
}

// ---------------------------------------------------------------------------
// 5. NUTRITION DISPLAY FORMATTING
// ---------------------------------------------------------------------------

/**
 * Format a nutrition value for display. Normalizes units and presentation.
 * "250 kcal" → "250 kcal", "12g" → "12 g", "480mg" → "480 mg"
 */
export function formatNutritionValue(value) {
  if (!value) return '';
  const str = String(value).trim();
  // Insert space between number and unit if missing: "12g" → "12 g"
  return str.replace(/(\d)\s*([a-zA-Z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------
// 6. CONVENIENCE RE-EXPORTS
// ---------------------------------------------------------------------------
export { pluralizeUnit, pluralizeFood };
