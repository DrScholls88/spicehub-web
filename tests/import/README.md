# Golden Corpus — Import Engine Regression Net

This is the safety net for the import-engine unification
(`docs/superpowers/specs/2026-07-02-import-engine-unification-design.md`).
**Every pipeline change must keep this corpus green before its commit.**

## Layout

```
tests/import/
  helpers.js              — fixture loaders + THE zero-junk contract (single source)
  corpus.captions.test.js — caption cleaning, weakness detection, deterministic tier
  corpus.html.test.js     — parseHtml tiers: JSON-LD, @graph, WPRM, Tasty, microdata,
                            schema-less, JS-shell, >8K long-page truncation guard
  corpus.schema.test.js   — recorded RECIPE_SCHEMA outputs → thinFromStructured → enforce
  live/corpus.live.test.js— opt-in real-Gemini end-to-end (never runs in CI)
  fixtures/
    captions/   9 real-world-shaped IG captions (clean, prose, cocktail, transcript,
                weak/bait, sectioned, promo-heavy, non-recipe, unicode fractions)
    html/       7 sanitized replicas of real site structures (+1 long page built at runtime)
    gemini/     6 recorded model outputs incl. junk-leak and low-confidence cases
    reddit/     r/recipes text post JSON
    transcripts/ yt-dlp style spoken transcript
```

## Commands

- `npm run test:corpus` — corpus only (offline, deterministic, no API calls)
- `npm test` — full suite including corpus
- `npm run test:live` — hits real Gemini with 2 captions (needs `VITE_GOOGLE_AI_KEY`; ~4 requests)

## Rules

1. **Zero-junk contract** lives in `helpers.js` (`JUNK_PATTERNS`). Acquisition-time
   cleaning and the Gemini system instruction must mirror it when the unified
   engine lands. Change it in one place only.
2. **KNOWN-GAP tests** use `it.fails` to pin current missing behavior
   (bait-caption weakness override, mid-caption promo stripping, junk leaked
   into notes). When the engine gains the behavior, the test flips to failing
   as "expected fail passed" — promote it to a normal `it` in the same commit.
3. **Tolerant matchers**: assert counts (`minIngredients`) and key content
   (`mustContain`), never byte equality — the corpus should survive harmless
   wording changes and catch real regressions.
4. **Add tricky real-world cases over time.** Every import that misbehaves in
   the wild should become a fixture here before it gets fixed.
