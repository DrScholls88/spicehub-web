// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — the shared zero-junk module (src/import/junk.js).
// This is the contract every layer imports; pin its edges hard.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  JUNK_PATTERNS,
  STRONG_LINE_JUNK,
  BAIT_ONLY_RE,
  isJunkLine,
  stripJunkLines,
  findJunk,
  lineHasRecipeSignal,
  countQuantityLines,
} from '../../src/import/junk.js';

describe('junk module — line classification', () => {
  it('flags pure promo lines', () => {
    expect(isJunkLine('Use code PROTEIN20 for 20% off, link in bio')).toBe(true);
    expect(isJunkLine('This post is in paid partnership with Daisy Dairy.')).toBe(true);
    expect(isJunkLine('Comment "BAGEL" below and I\'ll DM you the macros!')).toBe(true);
    expect(isJunkLine('GIVEAWAY CLOSED winners announced in stories!')).toBe(true);
    expect(isJunkLine('Follow me for more 10 minute dinners')).toBe(true);
    expect(isJunkLine('Full recipe on the blog!')).toBe(true);
  });

  it('protects lines that carry recipe signals', () => {
    expect(isJunkLine('Use code on the box: simmer 2 cups broth 10 minutes')).toBe(false);
    expect(isJunkLine('1 cup self-rising flour')).toBe(false);
    expect(isJunkLine('Shake with ice and strain into a coupe')).toBe(false);
  });

  it('never flags ordinary cooking prose', () => {
    expect(isJunkLine('Preheat oven to 375F.')).toBe(false);
    expect(isJunkLine("Don't salt the beef until it hits the griddle or the patties turn springy.")).toBe(false);
    expect(isJunkLine('Gluten free if you use tamari! Keeps 3 days in the fridge.')).toBe(false);
    expect(isJunkLine('Skim the fat before serving and save it for dipping tortillas.')).toBe(false);
  });
});

describe('junk module — stripJunkLines', () => {
  it('removes junk lines and keeps the recipe', () => {
    const text = [
      'My 4 ingredient bagels!',
      'Use code PROTEIN20 for 20% off my ebook, link in bio',
      '1 cup self-rising flour',
      '1 cup greek yogurt',
      'Bake 23 minutes until golden.',
      "Comment \"BAGEL\" below and I'll DM you the macros!",
    ].join('\n');
    const out = stripJunkLines(text);
    expect(out).toMatch(/self-rising flour/);
    expect(out).toMatch(/Bake 23 minutes/);
    expect(out).not.toMatch(/PROTEIN20|link in bio|DM you/i);
  });

  it('is a no-op on clean recipe text', () => {
    const clean = '2 cups flour\nMix everything together.\nBake at 350F for 20 minutes.';
    expect(stripJunkLines(clean)).toBe(clean);
  });
});

describe('junk module — bait + quantity heuristics', () => {
  it('BAIT_ONLY_RE hits the classic phrasings', () => {
    expect(BAIT_ONLY_RE.test('Full recipe on the blog, link in bio!')).toBe(true);
    expect(BAIT_ONLY_RE.test('recipe in my bio')).toBe(true);
    expect(BAIT_ONLY_RE.test('This recipe uses biology-grade precision')).toBe(false);
  });

  it('countQuantityLines counts unit-bearing and unicode-fraction lines', () => {
    expect(countQuantityLines('1 cup flour\n2 tbsp oil\nMix well')).toBe(2);
    expect(countQuantityLines('½ tsp baking soda\nno amounts here')).toBe(1);
    expect(countQuantityLines('250g pasta')).toBe(1);
    expect(countQuantityLines('just vibes')).toBe(0);
  });

  it('lineHasRecipeSignal spots quantities and cooking verbs', () => {
    expect(lineHasRecipeSignal('simmer gently until reduced')).toBe(true);
    expect(lineHasRecipeSignal('2 oz mezcal')).toBe(true);
    expect(lineHasRecipeSignal('my favorite dinner ever!!')).toBe(false);
  });
});

describe('junk module — assertion superset', () => {
  it('findJunk reports pattern names', () => {
    expect(findJunk('save this recipe for later')).toEqual({ pattern: 'save bait', match: 'save this recipe' });
    expect(findJunk('a perfectly normal sentence about soup')).toBeNull();
  });

  it('anchored patterns avoid cooking false positives', () => {
    expect(findJunk('bake @ 350 for 20 minutes')).toBeNull();
    expect(findJunk('#1 rated by my kids')).toBeNull();
    expect(findJunk('use 2 cups of code-red cherry soda')).toBeNull(); // "use code" needs the phrase
  });

  it('every STRONG pattern is represented in the assertion superset semantics', () => {
    // Guard against the strong list drifting away from what tests assert.
    const strongSample = [
      'link in bio', 'use code X', 'paid partnership', 'sponsored', '#ad ',
      'dm me', 'giveaway', 'turn on notifications', 'follow for more',
    ];
    for (const s of strongSample) {
      expect(STRONG_LINE_JUNK.some((re) => re.test(s)) || JUNK_PATTERNS.some((p) => p.re.test(s)), s).toBe(true);
    }
  });
});
