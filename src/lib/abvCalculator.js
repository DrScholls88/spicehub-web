// abvCalculator.js — client-side ABV + volume + calorie calculator for cocktails.
// Zero dependencies. Pure functions only. Safe for browser, worker, server.
//
// Consumed by: BarFridgeMode, BarLibrary, MealDetail (drink variant)
//
// Formula: based on Jeffrey Morgenthaler's cocktail ABV calculation
// https://jeffreymorgenthaler.com/

/**
 * Unit-to-milliliter conversion factors.
 * Covers the units commonly seen in cocktail recipes.
 */
const ML_PER_UNIT = {
  oz: 29.5735,
  cl: 10,
  dash: 0.9,
  barspoon: 5,
  tsp: 4.93,
  tbsp: 14.79,
  shot: 44.36,
  part: 30,
  cup: 236.59,
  ml: 1,
};

/**
 * Calculate the ABV% of a mixed drink after dilution.
 *
 * @param {Array<{amount: number, strength: number}>} ingredients
 *   Each entry has `amount` in oz and `strength` as ABV 0-100.
 * @param {number} dilutionPct
 *   Estimated dilution percentage (e.g. 25 for shaken, 17 for stirred).
 * @returns {number} ABV% rounded to 2 decimal places.
 */
export function calculateAbv(ingredients, dilutionPct) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return 0;
  if (dilutionPct == null || typeof dilutionPct !== 'number') dilutionPct = 0;

  let alcoholVolume = 0;
  let totalAmount = 0;

  for (const ing of ingredients) {
    const amount = Number(ing?.amount) || 0;
    const strength = Number(ing?.strength) || 0;
    alcoholVolume += amount * (strength / 100);
    totalAmount += amount;
  }

  if (totalAmount === 0) return 0;

  const afterDilution = totalAmount * (1 + dilutionPct / 100);
  if (afterDilution === 0) return 0;

  const abv = (alcoholVolume / afterDilution) * 100;
  return Math.round(abv * 100) / 100;
}

/**
 * Convert ingredient volumes to ml and sum them.
 *
 * @param {Array<{amount: number, unit: string}>} ingredients
 *   Each entry has `amount` (numeric) and `unit` (string key from ML_PER_UNIT).
 * @returns {number} Total volume in milliliters.
 */
export function calculateVolumeMl(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return 0;

  let totalMl = 0;

  for (const ing of ingredients) {
    const amount = Number(ing?.amount) || 0;
    const unit = String(ing?.unit || '').toLowerCase().trim();
    const factor = ML_PER_UNIT[unit];
    if (factor != null) {
      totalMl += amount * factor;
    }
    // Unknown units contribute 0 — caller is responsible for ensuring
    // ingredients use recognized units.
  }

  return totalMl;
}

/**
 * Estimate calories from alcohol content.
 * Pure alcohol contains ~7 calories per ml.
 *
 * @param {number} volumeMl   Total drink volume in ml.
 * @param {number} abvPct     ABV as 0-100.
 * @returns {number} Integer calories (floored).
 */
export function calculateCalories(volumeMl, abvPct) {
  const vol = Number(volumeMl) || 0;
  const abv = Number(abvPct) || 0;
  if (vol <= 0 || abv <= 0) return 0;
  return Math.floor(vol * (abv / 100) * 7);
}

/**
 * Calculate UK alcohol units.
 * 1 UK unit = 10ml of pure alcohol = (volume_ml * ABV%) / 1000.
 *
 * @param {number} volumeMl   Total drink volume in ml.
 * @param {number} abvPct     ABV as 0-100.
 * @returns {number} UK alcohol units rounded to 2 decimal places.
 */
export function calculateAlcoholUnits(volumeMl, abvPct) {
  const vol = Number(volumeMl) || 0;
  const abv = Number(abvPct) || 0;
  if (vol <= 0 || abv <= 0) return 0;
  return Math.round(((vol * abv) / 1000) * 100) / 100;
}

/**
 * Classify a drink by strength tier.
 *
 * @param {number|null} abvPct  ABV as 0-100 (or null/undefined).
 * @returns {'virgin'|'light'|'medium'|'strong'|'very strong'|'unknown'}
 */
export function getStrengthTier(abvPct) {
  if (abvPct == null || typeof abvPct !== 'number' || Number.isNaN(abvPct)) {
    return 'unknown';
  }
  if (abvPct === 0) return 'virgin';
  if (abvPct <= 10) return 'light';
  if (abvPct <= 20) return 'medium';
  if (abvPct <= 30) return 'strong';
  return 'very strong';
}
