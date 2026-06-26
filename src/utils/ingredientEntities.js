// src/utils/ingredientEntities.js
//
// First-class IngredientFood and IngredientUnit entities (Mealie-inspired).
// These live in Dexie tables and provide:
//   - Canonical food/unit resolution (name → entity with plural, aliases, aisle)
//   - Cross-recipe food identity (same "garlic" entity shared by all recipes)
//   - Unit conversion factors (1 cup = 236.588 ml)
//   - Seed population from the ingredientNormalizer catalog
//
// Pure helper module: all Dexie access is wrapped in try/catch with fallbacks.
// Consumers: finalizeAIRecipe, grocery consolidation, display formatter.

import db from '../db.js';
import {
  UNIT_CANON,
  UNIT_CONVERSION_FACTORS,
  UNIT_PLURALS,
  FOOD_PLURALS,
  GROCERY_CATEGORIES,
  categorizeIngredient,
} from '../recipeSchema.js';

// ---------------------------------------------------------------------------
// 1. ENTITY SHAPE DEFINITIONS
// ---------------------------------------------------------------------------
// IngredientFood = {
//   id:           number (autoincrement),
//   name:         string (canonical lowercase, e.g. "garlic"),
//   pluralName:   string (e.g. "garlic" — uncountable — or "tomatoes"),
//   aliases:      string[] (e.g. ["garlic cloves", "fresh garlic"]),
//   aisle:        string (grocery department, one of GROCERY_CATEGORIES),
//   createdAt:    number (Date.now()),
// }
//
// IngredientUnit = {
//   id:           number (autoincrement),
//   name:         string (canonical: "cup", "tbsp", "oz"),
//   pluralName:   string (e.g. "cups"),
//   abbreviation: string (e.g. "c." or "" if same as name),
//   fraction:     boolean (whether to display as fraction by default),
//   aliases:      string[] (e.g. ["cups", "c", "c."]),
//   conversionType:    string ("volume" | "weight" | "count"),
//   conversionFactor:  number (to base SI unit: ml/g/1),
//   createdAt:    number (Date.now()),
// }

// ---------------------------------------------------------------------------
// 2. RESOLVE-OR-CREATE HELPERS
// ---------------------------------------------------------------------------
// These look up an existing entity by name (case-insensitive), or create a new
// one if not found. Used during import to build the entity graph incrementally.

/**
 * Look up an IngredientFood by name or alias. Returns the entity or null.
 * Pure read, never creates.
 */
export async function findFood(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (!key) return null;

  try {
    // Primary key lookup
    const exact = await db.ingredientFoods.where('name').equalsIgnoreCase(key).first();
    if (exact) return exact;

    // Scan aliases (small table, acceptable performance)
    const all = await db.ingredientFoods.toArray();
    return all.find(f =>
      Array.isArray(f.aliases) && f.aliases.some(a => a.toLowerCase() === key)
    ) || null;
  } catch (e) {
    console.warn('[IngredientEntities] findFood failed:', e);
    return null;
  }
}

/**
 * Look up an IngredientUnit by name or alias. Returns the entity or null.
 */
export async function findUnit(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (!key) return null;

  try {
    const exact = await db.ingredientUnits.where('name').equalsIgnoreCase(key).first();
    if (exact) return exact;

    const all = await db.ingredientUnits.toArray();
    return all.find(u =>
      Array.isArray(u.aliases) && u.aliases.some(a => a.toLowerCase() === key)
    ) || null;
  } catch (e) {
    console.warn('[IngredientEntities] findUnit failed:', e);
    return null;
  }
}

/**
 * Resolve a food name to an existing entity, or create a new one.
 * Returns the entity (always). Never throws.
 */
export async function resolveOrCreateFood(name, opts = {}) {
  const { aisle, pluralName, aliases = [] } = opts;
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  try {
    const existing = await findFood(key);
    if (existing) return existing;

    const entity = {
      name: key,
      pluralName: pluralName || FOOD_PLURALS[key] || key,
      aliases: aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean),
      aisle: GROCERY_CATEGORIES.includes(aisle) ? aisle : categorizeIngredient(key),
      createdAt: Date.now(),
    };

    const id = await db.ingredientFoods.add(entity);
    return { ...entity, id };
  } catch (e) {
    console.warn('[IngredientEntities] resolveOrCreateFood failed:', e);
    return { name: key, pluralName: FOOD_PLURALS[key] || key, aliases: [], aisle: 'Other' };
  }
}

/**
 * Resolve a unit name to an existing entity, or create a new one.
 * Returns the entity (always). Never throws.
 */
export async function resolveOrCreateUnit(name, opts = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  try {
    const existing = await findUnit(key);
    if (existing) return existing;

    const convInfo = UNIT_CONVERSION_FACTORS[key] || {};
    const entity = {
      name: key,
      pluralName: UNIT_PLURALS[key] || key,
      abbreviation: opts.abbreviation || '',
      fraction: opts.fraction ?? true,
      aliases: (opts.aliases || []).map(a => String(a).trim().toLowerCase()).filter(Boolean),
      conversionType: convInfo.type || 'count',
      conversionFactor: convInfo.toBase || 1,
      createdAt: Date.now(),
    };

    const id = await db.ingredientUnits.add(entity);
    return { ...entity, id };
  } catch (e) {
    console.warn('[IngredientEntities] resolveOrCreateUnit failed:', e);
    return { name: key, pluralName: UNIT_PLURALS[key] || key, conversionType: 'count', conversionFactor: 1 };
  }
}

// ---------------------------------------------------------------------------
// 3. SEED FROM EXISTING CATALOG
// ---------------------------------------------------------------------------
// Populates the entity tables from recipeSchema's UNIT_CANON and
// FOOD_PLURALS on first DB creation. Idempotent: skips already-seeded records.

/**
 * Seed the IngredientUnit table from UNIT_CANON. Idempotent.
 */
export async function seedUnits() {
  try {
    const existing = await db.ingredientUnits.count();
    if (existing > 0) return; // already seeded

    const entries = [];
    for (const [canonical, aliases] of Object.entries(UNIT_CANON)) {
      const convInfo = UNIT_CONVERSION_FACTORS[canonical] || {};
      entries.push({
        name: canonical,
        pluralName: UNIT_PLURALS[canonical] || canonical,
        abbreviation: '',
        fraction: true,
        aliases: Array.isArray(aliases) ? aliases : [],
        conversionType: convInfo.type || 'count',
        conversionFactor: convInfo.toBase || 1,
        createdAt: Date.now(),
      });
    }

    await db.ingredientUnits.bulkAdd(entries);
    console.log(`[IngredientEntities] Seeded ${entries.length} unit entities`);
  } catch (e) {
    console.warn('[IngredientEntities] seedUnits failed:', e);
  }
}

/**
 * Seed the IngredientFood table from FOOD_PLURALS + the normalizer catalog.
 * Idempotent: only runs if the table is empty.
 */
export async function seedFoods() {
  try {
    const existing = await db.ingredientFoods.count();
    if (existing > 0) return; // already seeded

    const entries = [];
    const seen = new Set();

    // From FOOD_PLURALS: these are the curated foods with known plural forms
    for (const [singular, plural] of Object.entries(FOOD_PLURALS)) {
      if (seen.has(singular)) continue;
      seen.add(singular);
      entries.push({
        name: singular,
        pluralName: plural,
        aliases: [],
        aisle: categorizeIngredient(singular),
        createdAt: Date.now(),
      });
    }

    // Batch insert
    if (entries.length > 0) {
      await db.ingredientFoods.bulkAdd(entries);
      console.log(`[IngredientEntities] Seeded ${entries.length} food entities`);
    }
  } catch (e) {
    console.warn('[IngredientEntities] seedFoods failed:', e);
  }
}

/**
 * Run all seed operations. Call once during app startup. Idempotent.
 */
export async function seedEntities() {
  await seedUnits();
  await seedFoods();
}

// ---------------------------------------------------------------------------
// 4. ENTITY-ENRICHED INGREDIENT
// ---------------------------------------------------------------------------
// Enriches a structured ingredient item with entity references. Used during
// import post-processing to link ingredients to the shared entity graph.

/**
 * Enrich a structured ingredient item with food/unit entity data.
 * Adds _foodEntity and _unitEntity references. Non-blocking; gracefully
 * falls back if entities can't be resolved.
 */
export async function enrichIngredientWithEntities(item) {
  if (!item) return item;

  const enriched = { ...item };

  if (item.name) {
    const food = await resolveOrCreateFood(item.name, {
      aisle: item.category,
    });
    if (food) {
      enriched._foodId = food.id || null;
      enriched._foodCanonical = food.name;
      enriched._foodPlural = food.pluralName;
      // Update category from entity if available
      if (food.aisle && food.aisle !== 'Other') {
        enriched.category = food.aisle;
      }
    }
  }

  if (item.unit) {
    const unit = await resolveOrCreateUnit(item.unit);
    if (unit) {
      enriched._unitId = unit.id || null;
      enriched._unitCanonical = unit.name;
      enriched._unitPlural = unit.pluralName;
      enriched._unitConversionType = unit.conversionType;
      enriched._unitConversionFactor = unit.conversionFactor;
    }
  }

  return enriched;
}

/**
 * Enrich all structured ingredients in a recipe with entity references.
 * Non-blocking, never throws.
 */
export async function enrichRecipeIngredients(structuredItems = []) {
  try {
    return await Promise.all(structuredItems.map(enrichIngredientWithEntities));
  } catch (e) {
    console.warn('[IngredientEntities] enrichRecipeIngredients failed:', e);
    return structuredItems;
  }
}
