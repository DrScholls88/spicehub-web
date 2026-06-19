import { describe, it, expect } from 'vitest';
import {
  fuzzyResolveIngredient,
  normalizeIngredientForMatching,
} from '../recipeSchema.js';

// The fuzzy ingredient matcher (recipeSchema.js §13) is the model-agnostic
// safety net that maps messy LLM / scraped ingredient names onto the canonical
// INGREDIENT_ALIASES vocabulary. These tests pin its behaviour so a future
// change to the alias table, normalizer, or scoring can't silently regress
// grocery aggregation / department routing.
//
// All asserted canonical values are traced directly to INGREDIENT_ALIASES
// entries in recipeSchema.js — see the comment on each block for the source.

const ALLOWED_METHODS = ['exact', 'fuzzy-levenshtein', 'fuzzy-token', 'none'];

describe('fuzzyResolveIngredient — exact alias hits', () => {
  // recipeSchema.js:117  'green onions' -> { canonical: 'scallion', aisle: 'produce' }
  it("resolves 'green onions' exactly to scallion/produce", () => {
    const r = fuzzyResolveIngredient('green onions');
    expect(r).toBeTruthy();
    expect(r.method).toBe('exact');
    expect(r.score).toBe(1.0);
    expect(r.canonical).toBe('scallion');
    expect(r.aisle).toBe('produce');
  });

  // recipeSchema.js:158  'evoo' -> { canonical: 'olive oil', aisle: 'pantry' }
  it("resolves 'evoo' exactly to olive oil/pantry", () => {
    const r = fuzzyResolveIngredient('evoo');
    expect(r.method).toBe('exact');
    expect(r.score).toBe(1.0);
    expect(r.canonical).toBe('olive oil');
    expect(r.aisle).toBe('pantry');
  });

  // recipeSchema.js:152  'kosher salt' -> { canonical: 'salt', aisle: 'pantry' }
  it("resolves 'kosher salt' exactly to salt/pantry", () => {
    const r = fuzzyResolveIngredient('kosher salt');
    expect(r.method).toBe('exact');
    expect(r.score).toBe(1.0);
    expect(r.canonical).toBe('salt');
    expect(r.aisle).toBe('pantry');
  });

  // recipeSchema.js:186  'parmesan cheese' -> { canonical: 'parmesan', aisle: 'dairy' }
  it("resolves 'parmesan cheese' exactly to parmesan/dairy", () => {
    const r = fuzzyResolveIngredient('parmesan cheese');
    expect(r.method).toBe('exact');
    expect(r.canonical).toBe('parmesan');
    expect(r.aisle).toBe('dairy');
  });
});

describe('fuzzyResolveIngredient — exact hit after normalization', () => {
  // '2 cups all purpose flour, sifted' normalizes to 'all purpose flour'
  // (qty+unit '2 cups' stripped, ', sifted' clause dropped), which is an exact
  // alias at recipeSchema.js:131 -> { canonical: 'all-purpose flour', aisle: 'baking' }.
  it("normalizes '2 cups all purpose flour, sifted' to the all-purpose flour alias", () => {
    // Sanity-check the normalization step the resolution relies on.
    expect(normalizeIngredientForMatching('2 cups all purpose flour, sifted')).toBe(
      'all purpose flour',
    );
    const r = fuzzyResolveIngredient('2 cups all purpose flour, sifted');
    expect(r.method).toBe('exact');
    expect(r.score).toBe(1.0);
    expect(r.canonical).toBe('all-purpose flour');
    expect(r.aisle).toBe('baking');
  });

  // '3 cloves garlic' normalizes to bare 'garlic'. IMPORTANT: bare 'garlic' is a
  // canonical VALUE but is NOT itself an alias KEY (the keys are 'garlic cloves',
  // 'fresh garlic', etc. — recipeSchema.js:161-164), and no alias key scores >=
  // 0.82 against the single token 'garlic' (token-Jaccard with 2-word keys caps
  // at 0.5). So the matcher takes the no-match fallback: method 'none', score 0,
  // canonical = the normalized target ('garlic'), aisle 'unknown'. We assert that
  // robust fallback contract rather than a produce hit that the code does NOT make.
  it("falls back to method 'none' for '3 cloves garlic' (bare 'garlic' is not an alias key)", () => {
    expect(normalizeIngredientForMatching('3 cloves garlic')).toBe('garlic');
    const r = fuzzyResolveIngredient('3 cloves garlic');
    expect(r).toBeTruthy();
    expect(r.method).toBe('none');
    expect(r.score).toBe(0);
    expect(r.canonical).toBe('garlic');
    expect(r.aisle).toBe('unknown');
  });
});

describe('fuzzyResolveIngredient — fuzzy Levenshtein (typo)', () => {
  // Alias 'cilantro' (recipeSchema.js:121) -> canonical 'cilantro'.
  // 'cilanto' is a 1-deletion typo: distance 1, maxLen 8, levScore = 1 - 1/8 =
  // 0.875 (>= default threshold 0.82). Token Jaccard is 0 (no shared whole
  // token), so method resolves to 'fuzzy-levenshtein'.
  it("matches the typo 'cilanto' to cilantro via levenshtein", () => {
    const r = fuzzyResolveIngredient('cilanto');
    expect(r.method).toBe('fuzzy-levenshtein');
    expect(r.canonical).toBe('cilantro');
    expect(r.aisle).toBe('produce');
    expect(r.score).toBeCloseTo(0.875, 5);
    expect(r.score).toBeLessThan(1);
    expect(r.score).toBeGreaterThanOrEqual(0.82);
  });
});

describe('fuzzyResolveIngredient — fuzzy token (word reorder)', () => {
  // Alias 'chicken breasts' (recipeSchema.js:182) -> canonical 'chicken'.
  // 'breasts chicken' has the same two tokens reordered: token-Jaccard = 1.0,
  // which beats the (large) levenshtein distance, so method is 'fuzzy-token'.
  it("matches reordered 'breasts chicken' to chicken via token similarity", () => {
    const r = fuzzyResolveIngredient('breasts chicken');
    expect(r.method).toBe('fuzzy-token');
    expect(r.canonical).toBe('chicken');
    expect(r.aisle).toBe('meat');
    expect(r.score).toBeCloseTo(1.0, 5);
    expect(r.score).toBeGreaterThanOrEqual(0.82);
  });
});

describe('fuzzyResolveIngredient — no match', () => {
  it("returns method 'none', score 0 for an unknown string", () => {
    const r = fuzzyResolveIngredient('zzzqqq widget');
    expect(r).toBeTruthy();
    expect(r.method).toBe('none');
    expect(r.score).toBe(0);
    expect(r.aisle).toBe('unknown');
    // canonical falls back to the normalized input (no aliases stripped here).
    expect(r.canonical).toBe('zzzqqq widget');
  });
});

describe('fuzzyResolveIngredient — safety / defensive', () => {
  it("returns null for empty string", () => {
    expect(fuzzyResolveIngredient('')).toBeNull();
  });

  it("returns null for null input", () => {
    expect(fuzzyResolveIngredient(null)).toBeNull();
  });

  it("returns null for undefined (defaults to '')", () => {
    expect(fuzzyResolveIngredient(undefined)).toBeNull();
  });

  it("does not throw on non-string input", () => {
    // String(...) coercion guards the implementation; assert robust invariants.
    expect(() => fuzzyResolveIngredient(12345)).not.toThrow();
    const r = fuzzyResolveIngredient(12345);
    if (r !== null) {
      expect(ALLOWED_METHODS).toContain(r.method);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(typeof r.canonical).toBe('string');
    }
  });

  it("always returns a well-formed shape for known input", () => {
    const r = fuzzyResolveIngredient('green onions');
    expect(ALLOWED_METHODS).toContain(r.method);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(typeof r.canonical).toBe('string');
    expect(r.canonical.length).toBeGreaterThan(0);
    expect(typeof r.aisle).toBe('string');
  });
});

describe('normalizeIngredientForMatching', () => {
  it("strips leading quantity + unit ('3 cloves garlic' -> 'garlic')", () => {
    const out = normalizeIngredientForMatching('3 cloves garlic');
    expect(out).toContain('garlic');
    expect(out).not.toMatch(/\d/); // no digits remain
    expect(out).not.toMatch(/\bcloves?\b/); // unit token removed
  });

  it("strips a prep clause after a comma ('1 onion, diced' -> 'onion')", () => {
    const out = normalizeIngredientForMatching('1 onion, diced');
    expect(out).toBe('onion');
  });

  it("drops parentheticals ('butter (softened)' -> 'butter')", () => {
    const out = normalizeIngredientForMatching('butter (softened)');
    expect(out).toBe('butter');
  });

  it("removes prep descriptor words ('finely chopped fresh parsley' -> 'parsley')", () => {
    // 'finely', 'chopped', 'fresh' are all in PREP_DESCRIPTORS (recipeSchema.js:766+).
    const out = normalizeIngredientForMatching('finely chopped fresh parsley');
    expect(out).toBe('parsley');
  });

  it("returns '' for non-string input", () => {
    expect(normalizeIngredientForMatching(null)).toBe('');
    expect(normalizeIngredientForMatching(undefined)).toBe('');
    expect(normalizeIngredientForMatching(42)).toBe('');
  });

  it("returns '' for an empty / whitespace string", () => {
    expect(normalizeIngredientForMatching('')).toBe('');
    expect(normalizeIngredientForMatching('   ')).toBe('');
  });
});
