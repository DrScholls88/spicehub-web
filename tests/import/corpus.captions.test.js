// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — social captions (cleaning, weakness detection, deterministic
// structuring). No network, no LLM: pins the local heuristic tier.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  cleanSocialCaption,
  isCaptionWeak,
  structureDeterministic,
} from '../../src/recipeParser.js';
import { loadFixture, findJunk, assertZeroJunk, assertCleanTitle } from './helpers.js';

const cap = (id) => loadFixture('captions', `${id}.txt`);

describe('golden corpus — caption weakness detection', () => {
  // PROMOTED 2026-07-02: the Tier-1.5 bait override (BAIT_ONLY_RE +
  // countQuantityLines in isCaptionWeak) closed this gap.
  it('ig-weak-caption: "link in bio" bait is flagged weak', () => {
    expect(isCaptionWeak(cap('ig-weak-caption'))).toBe(true);
  });

  it('ig-clean-structured: a full recipe caption is NOT weak', () => {
    expect(isCaptionWeak(cap('ig-clean-structured'))).toBe(false);
  });

  it('ig-sectioned: a sectioned recipe caption is NOT weak', () => {
    expect(isCaptionWeak(cap('ig-sectioned'))).toBe(false);
  });
});

describe('golden corpus — caption cleaning strips social chrome', () => {
  it('ig-clean-structured: trailing follow-bait and hashtag block are removed', () => {
    const cleaned = cleanSocialCaption(cap('ig-clean-structured'));
    expect(cleaned).not.toMatch(/follow @|noodle\.ninja/i);
    expect(cleaned).not.toMatch(/#easydinner|#dinnerinspo/i);
    // Recipe content must survive cleaning.
    expect(cleaned).toMatch(/rice noodles/i);
    expect(cleaned).toMatch(/chili crisp/i);
  });

  // PROMOTED 2026-07-02: stripJunkLines (src/import/junk.js) now runs inside
  // cleanSocialCaption and removes mid-caption promo prose.
  it('ig-promo-heavy: sponsor/promo lines are removed, recipe survives', () => {
    const cleaned = cleanSocialCaption(cap('ig-promo-heavy'));
    expect(cleaned).toMatch(/self-rising flour/i);
    expect(cleaned).toMatch(/greek yogurt/i);
    const junk = findJunk(cleaned);
    expect(junk, `promo junk survived cleaning: ${junk?.pattern} "${junk?.match}"`).toBeNull();
  });

  it('ig-promo-heavy: recipe content still survives cleaning', () => {
    const cleaned = cleanSocialCaption(cap('ig-promo-heavy'));
    expect(cleaned).toMatch(/self-rising flour/i);
    expect(cleaned).toMatch(/greek yogurt/i);
    expect(cleaned).toMatch(/bake 23 minutes/i);
  });
});

describe('golden corpus — deterministic structuring (no-LLM tier)', () => {
  it('ig-clean-structured: bulleted caption structures cleanly', () => {
    const r = structureDeterministic(cleanSocialCaption(cap('ig-clean-structured')), {
      type: 'meal', sourceUrl: 'https://www.instagram.com/p/CORPUS01/',
    });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(8);
    expect(r.directions.length).toBeGreaterThanOrEqual(4);
    expect(r.ingredients.join('\n')).toMatch(/rice noodles/i);
    expect(r.directions.join('\n')).toMatch(/wok|noodles/i);
    assertCleanTitle(r.title || r.name || '', 'ig-clean-structured');
    assertZeroJunk(r, 'ig-clean-structured');
  });

  it('ig-cocktail-reel: mixology units classify as ingredients', () => {
    const r = structureDeterministic(cleanSocialCaption(cap('ig-cocktail-reel')), {
      type: 'drink', sourceUrl: 'https://www.instagram.com/reel/CORPUS02/',
    });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(5);
    expect(r.ingredients.join('\n')).toMatch(/mezcal/i);
    expect(r.ingredients.join('\n')).toMatch(/lime/i);
    // "2 oz mezcal" must never be classified as a direction.
    expect(r.directions.join('\n')).not.toMatch(/^\s*2 oz mezcal/im);
    assertZeroJunk(r, 'ig-cocktail-reel');
  });

  it('ig-sectioned: section headers are not swallowed as ingredients or steps', () => {
    const r = structureDeterministic(cleanSocialCaption(cap('ig-sectioned')), {
      type: 'meal', sourceUrl: 'https://www.instagram.com/p/CORPUS03/',
    });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(12);
    expect(r.ingredients.join('\n')).toMatch(/guajillo/i);
    expect(r.ingredients.join('\n')).toMatch(/oaxaca/i);
    // Bare section headers must not appear as ingredient lines.
    for (const ing of r.ingredients) {
      expect(ing).not.toMatch(/^for the (birria|tacos):?\s*$/i);
    }
    assertZeroJunk(r, 'ig-sectioned');
  });

  it('ig-unicode-fractions: ½ ¾ ⅓ quantities survive intact', () => {
    const r = structureDeterministic(cleanSocialCaption(cap('ig-unicode-fractions')), {
      type: 'meal', sourceUrl: 'https://www.instagram.com/p/CORPUS04/',
    });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(8);
    const joined = r.ingredients.join('\n');
    expect(joined).toMatch(/miso/i);
    // Unicode fraction content must not be dropped or mangled to empty amounts.
    expect(joined).toMatch(/2\s*¼|2\.25|2 1\/4/);
    assertZeroJunk(r, 'ig-unicode-fractions');
  });

  it('ig-nonrecipe: travel post does not hallucinate a recipe', () => {
    const raw = cap('ig-nonrecipe');
    const r = structureDeterministic(cleanSocialCaption(raw), {
      type: 'meal', sourceUrl: 'https://www.instagram.com/p/CORPUS05/',
    });
    // Correct outcomes: null, or a shape with (near-)empty ingredients.
    const ingCount = r?.ingredients?.length ?? 0;
    expect(ingCount, 'hallucinated ingredients from a travel post').toBeLessThanOrEqual(1);
  });

  it('reddit text post: markdown selftext structures cleanly', () => {
    const post = JSON.parse(loadFixture('reddit', 'text-post.json'));
    const r = structureDeterministic(post.selftext, { type: 'meal', sourceUrl: post.link });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(9);
    expect(r.directions.length).toBeGreaterThanOrEqual(4);
    expect(r.ingredients.join('\n')).toMatch(/cannellini/i);
    assertZeroJunk(r, 'reddit-text-post');
  });
});

// Prose-style captions (ig-messy-prose, ig-transcript-narration, ytdlp
// transcript) are AI-tier inputs by design — the deterministic parser only
// needs to fail SAFELY on them. Their happy-path coverage lives in
// corpus.schema.test.js via recorded model outputs.
describe('golden corpus — prose captions fail safely at the deterministic tier', () => {
  for (const id of ['ig-messy-prose', 'ig-transcript-narration']) {
    it(`${id}: returns a safe shape (no crash, arrays present)`, () => {
      const r = structureDeterministic(cleanSocialCaption(cap(id)), { type: 'meal', sourceUrl: '' });
      if (r) {
        expect(Array.isArray(r.ingredients)).toBe(true);
        expect(Array.isArray(r.directions)).toBe(true);
      }
    });
  }

  it('ytdlp transcript: returns a safe shape', () => {
    const r = structureDeterministic(loadFixture('transcripts', 'ytdlp-subtitles.txt'), { type: 'meal', sourceUrl: '' });
    if (r) {
      expect(Array.isArray(r.ingredients)).toBe(true);
      expect(Array.isArray(r.directions)).toBe(true);
    }
  });
});
