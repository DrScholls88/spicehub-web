// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — LIVE end-to-end spot checks (opt-in, never runs in CI)
//
//   npm run test:live
//
// Requires VITE_GOOGLE_AI_KEY in the environment / .env. Hits real Gemini with
// two corpus captions and asserts structural quality + the zero-junk contract.
// Budget: ~4 requests per run (primary + possible escalation per caption).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { structureWithAIClient, cleanSocialCaption } from '../../../src/recipeParser.js';
import { loadFixture, assertZeroJunk, assertCleanTitle } from '../helpers.js';

const LIVE = process.env.RUN_LIVE === '1';

describe.runIf(LIVE)('golden corpus — LIVE Gemini end-to-end', () => {
  it('ig-messy-prose: prose caption structures into a full recipe', async () => {
    const caption = cleanSocialCaption(loadFixture('captions', 'ig-messy-prose.txt'));
    const r = await structureWithAIClient(caption, {
      title: '', sourceUrl: 'https://www.instagram.com/p/LIVE01/', type: 'meal',
    });
    expect(r, 'Gemini returned null — check VITE_GOOGLE_AI_KEY').toBeTruthy();
    expect(r.title || '').toMatch(/lemon|ricotta|pancake/i);
    expect(r.ingredients.length).toBeGreaterThanOrEqual(7);
    expect(r.directions.length).toBeGreaterThanOrEqual(4);
    assertCleanTitle(r.title, 'live messy-prose');
    assertZeroJunk(r, 'live messy-prose');
  }, 60000);

  it('ig-promo-heavy: promo chrome never reaches the recipe', async () => {
    const caption = cleanSocialCaption(loadFixture('captions', 'ig-promo-heavy.txt'));
    const r = await structureWithAIClient(caption, {
      title: '', sourceUrl: 'https://www.instagram.com/p/LIVE02/', type: 'meal',
    });
    expect(r).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThanOrEqual(4);
    expect(r.directions.length).toBeGreaterThanOrEqual(4);
    assertZeroJunk(r, 'live promo-heavy');
  }, 60000);
});

describe.runIf(!LIVE)('live corpus (skipped)', () => {
  it.skip('set RUN_LIVE=1 (npm run test:live) to run live Gemini checks', () => {});
});
