// ─────────────────────────────────────────────────────────────────────────────
// GATE — pass / salvage / empty quality gate for structured recipes.
//
// Runs AFTER structurePack, checking the recipe + pack for quality.
// Drink-aware: 2-ingredient cocktails pass; missing method is salvage.
// Bait-aware: source text that says "recipe on the blog" + thin extraction → empty.
//
// Replaces the observational schemaQualityGate that only logged and ran at
// two Instagram-only call sites. This gate runs on every fork via the engine.
// ─────────────────────────────────────────────────────────────────────────────
import { BAIT_ONLY_RE } from './junk.js';

const GENERIC_NAMES = /^(recipe|imported|untitled|home|blog|post|page|instagram|reel)$/i;

/**
 * Normalize ingredients/directions to an array of non-empty strings.
 * Handles both array and newline-delimited string formats.
 */
function toLines(val) {
  if (typeof val === 'string') return val.split('\n').filter(Boolean);
  return Array.isArray(val) ? val.filter(Boolean) : [];
}

/**
 * Gate a structured recipe against quality thresholds.
 *
 * @param {object|null} recipe — structured recipe from structurePack / captionToRecipe
 * @param {object}      pack   — ContextPack (carries kind, caption, markdown, etc.)
 * @returns {{ verdict: 'pass'|'salvage'|'empty', reasons: string[] }}
 */
export function gateRecipe(recipe, pack) {
  if (!recipe) {
    return { verdict: 'empty', reasons: ['no-recipe'] };
  }

  const kind = pack?.kind || 'meal';
  const isDrink = kind === 'drink';
  const reasons = [];

  // ── Ingredients ───────────────────────────────────────────────────────
  const ings = toLines(recipe.ingredients);
  if (ings.length < 2) {
    // 0–1 ingredients — nothing to salvage
    return { verdict: 'empty', reasons: ['no-ingredients'] };
  }

  // ── Bait detection ────────────────────────────────────────────────────
  // Source says the recipe is elsewhere ("full recipe on the blog", "link
  // in bio"). If the structured output is thin, the AI hallucinated it.
  const sourceText = pack?.caption || pack?.markdown || '';
  if (BAIT_ONLY_RE.test(sourceText) && ings.length < 3) {
    return { verdict: 'empty', reasons: ['bait-caption'] };
  }

  // ── Name ──────────────────────────────────────────────────────────────
  const name = (recipe.name || '').trim();
  if (!name || GENERIC_NAMES.test(name)) {
    reasons.push('generic-name');
  }

  // ── Ingredient count (kind-aware) ─────────────────────────────────────
  // Drinks: 2 is fine (gin + tonic). Meals: need ≥3 for pass.
  if (!isDrink && ings.length < 3) {
    reasons.push(`ingredients:${ings.length}`);
  }

  // ── Directions ────────────────────────────────────────────────────────
  const dirs = toLines(recipe.directions);
  if (dirs.length < 1) {
    reasons.push('no-directions');
  }

  // ── Verdict ───────────────────────────────────────────────────────────
  if (reasons.length === 0) return { verdict: 'pass', reasons: [] };
  return { verdict: 'salvage', reasons };
}
