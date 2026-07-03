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
  corpus.junk.test.js     — the shared zero-junk module (src/import/junk.js)
  corpus.extract.test.js  — /api/extract server parsing (same HTML fixtures, pure helpers)
  corpus.contextpack.test.js — ContextPack sections/budgets, verifier mode, structurePack (stubbed net)
  corpus.instagram.test.js — acquire/instagram race (injected fetchers) + images.js hero/vision gate
  corpus.structure-server.test.js — /api/structure passthrough + step-5 "one brain" guards
  corpus.progress.test.js — progressMap: engine messages → 3-stage timeline + tier chips
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

1. **Zero-junk contract** lives in `src/import/junk.js` (single source since
   2026-07-02); `helpers.js` re-exports it, cleanSocialCaption strips with it,
   and enforceDeterministicRules scrubs with it. Change it in one place only.
2. **KNOWN-GAP tests** use `it.fails` to pin current missing behavior. When the
   engine gains the behavior, the test flips to failing as "expected fail
   passed" — promote it to a normal `it` in the same commit. (The original
   three gaps — bait-caption weakness, mid-caption promo stripping, junk in
   notes — were all fixed and promoted on 2026-07-02.)
3. **Tolerant matchers**: assert counts (`minIngredients`) and key content
   (`mustContain`), never byte equality — the corpus should survive harmless
   wording changes and catch real regressions.
4. **Add tricky real-world cases over time.** Every import that misbehaves in
   the wild should become a fixture here before it gets fixed.
