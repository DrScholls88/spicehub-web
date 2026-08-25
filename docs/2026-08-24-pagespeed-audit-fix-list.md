# PageSpeed / Lighthouse Audit — Fix & Improvement List

**Source report:** PageSpeed Insights, mobile, Aug 23 2026 11:05 PM — `https://spicehub-web.vercel.app`
**Analyzed:** 2026-08-24

## Scores

| Category | Mobile | Desktop |
|---|---|---|
| Performance | **68** | 98 |
| Accessibility | 96 | 96 |
| Best Practices | 100 | 100 |
| SEO | 82 | 82 |

**Mobile lab metrics**

| Metric | Value | Verdict |
|---|---|---|
| First Contentful Paint | 4.8 s | ✗ bad |
| Largest Contentful Paint | 5.0 s | ✗ bad |
| Speed Index | 5.5 s | ✗ bad |
| Total Blocking Time | 0 ms | ✓ perfect |
| Cumulative Layout Shift | 0 | ✓ perfect |

No CrUX field data — the origin doesn't have enough real-user traffic yet, so everything below is lab-only.

## The one-sentence diagnosis

TBT and CLS are already perfect; the entire 32-point mobile gap is **time-to-first-pixel**. Nothing at all paints until the 484 KiB JS bundle + 102 KiB CSS download, parse and mount React. Lighthouse confirms it:

- LCP breakdown: **TTFB 0 ms, element render delay 2,510 ms** — the server is instant, the client is the bottleneck.
- LCP element is `<p class="consentgate-blurb">` inside the consent modal.
- DOM at load contains **20 elements total** — literally just the consent gate.
- Desktop scores 98 on the *same* code, because it isn't CPU/network throttled. This is a mobile-boot problem, not an architecture problem.

Fix the boot path and mobile should land in the 90s without touching features.

---

## P0 — Highest impact (target: 68 → 90+)

### 1. Kill the Google Fonts `@import` chain
**Evidence:** render-blocking requests, est. savings 1,010 ms; the `css2` request alone costs 750 ms and is *chained behind* the 102 KiB stylesheet.
**Cause:** `src/App.css:1` — `@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap')`. A CSS `@import` can't start downloading until the parent stylesheet has downloaded and parsed, so it serializes two render-blocking requests.
**Fix:** Self-host Press Start 2P as woff2, exactly like `public/fonts/gloock-latin-400.woff2` already is, with a local `@font-face { font-display: swap }`. It's a single-weight pixel font — a Latin subset is ~10–20 KB and it becomes precacheable by the service worker (real offline win, which the `@import` version never was).
**Fallback if you keep Google Fonts:** move it to `<link rel="stylesheet">` in `index.html` plus `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`. Removes the chain but not the third party.

### 2. Break up `App.css` (537 KB built / 102.5 KiB gz, **99.9 KiB of it unused**)
**Evidence:** "Reduce unused CSS — est. savings 100 KiB"; the stylesheet blocks render for 1,840 ms.
**Cause:** `src/App.css` is a 648 KB single-file monolith imported eagerly from `App.jsx`, so every screen's styles block the first paint.
**Fix options, cheapest first:**
- Inline a small critical block (consent gate + landing shell) into `index.html` and load the rest with a non-blocking pattern (`media="print"` + `onload`, or `rel=preload as=style`).
- Split per-feature CSS files and import them from the components that own them (`BarShelf.css`, `WeekView.css`, `CookMode.css`…) so Vite code-splits them alongside the lazy chunks from item 4.
- Long-term: a PurgeCSS/Tailwind-style pass. Note there's already `tailwind.config.js` + `postcss.config.js` in the repo — worth checking whether Tailwind is actually wired into the pipeline or vestigial.

### 3. Paint *something* before React boots
**Evidence:** FCP 4.8 s with 0 ms TTFB and 2,510 ms LCP render delay.
**Fix:** Put static markup in `index.html`'s `#root` — the SpiceHub wordmark + a skeleton, or (best) the consent-gate shell itself, styled with the inlined critical CSS from item 2. React hydrates over it. This alone should move FCP from ~4.8 s to well under 1 s, and since the consent blurb *is* the LCP element, LCP follows it down.
**Watch out:** whatever you inline must not shift when React mounts, or you trade a perfect CLS of 0 for a regression.

### 4. Get the screens out of the eager main bundle
**Evidence:** 484 KiB main bundle, **300.5 KiB of it unused** on first load. Named offenders: `BarShelf.jsx` (26.5 KiB, 24.7 unused), `recipeParser.js` (26.9 / 23.4), `WeekView.jsx` (22.8 / 16.5), `dexie.min.js` (29.2 / 15.4), `vendor-motion` (51.2 / 45.8 unused).
**Cause:** `App.jsx` has ~50 static imports — every screen (`BarShelf`, `MealLibrary`, `BarLibrary`, `CookMode`, `MixMode`, `MealSpinner`, `DiscoverRecipes`, `GroceryList`, `SettingsSheet`, `FriendsSheet`, `AddEditMeal`, `ImportSheet`…) is pulled in at boot. Only 6 components use `lazy()`.
**Fix:** Extend the existing `lazy()` pattern to every non-landing screen. The landing/consent path needs almost none of them. `recipeParser` and the import engine should load on first import action, not at boot.
**Bonus:** `framer-motion` is 45.8 KiB unused on load — most of it belongs behind the lazy screens once they're split.

### 5. Stop `registerSW.js` blocking render
**Evidence:** listed under render-blocking requests — 1.3 KiB but 500 ms of blocking.
**Fix:** `VitePWA({ injectRegister: 'inline' })` (or `'script-defer'`) in `vite.config.js`. Nothing about SW registration needs to happen before first paint.

---

## P1 — Solid wins, low risk

### 6. Lazy-load Supabase
`index-hP0kiQFB.js` is 58.1 KiB with **48.2 KiB unused** — GoTrueClient, realtime, storage-js, postgrest-js, phoenix. SpiceHub is local-first; a logged-out first visit never touches any of it. `App.jsx:50` statically imports `./lib/supabaseClient`. Make the client a dynamic `import()` behind the first auth/sync/friends action, and keep `isHomeGroupEnabled` / `isFriendsEnabled` as cheap env-flag checks in a separate module that doesn't pull the SDK.

### 7. Raise the build target
`vite.config.js` has `build.target: 'es2019'`. Lighthouse flags "Legacy JavaScript — polyfills and transforms not necessary for modern browsers." Every browser that can run a PWA with service workers and Dexie handles ES2022. Bumping to `'es2022'` shrinks output and removes transpiled helpers. Test the iOS Safari floor you actually support first.

### 8. Don't ship source maps to production
`build.sourcemap: true` emits `index-*.js.map` at 5.2 MB, plus a 3.3 MB transformers map, into `dist/`. Users don't download them, so it's not a score issue — but it publishes your full source and bloats every deploy. Use `sourcemap: 'hidden'` (maps generated, no `//# sourceMappingURL` comment) or gate on an env var.

### 9. Add preconnect hints
Lighthouse: **"no origins were preconnected."** Add `<link rel="preconnect">` for any origin still on the critical path after item 1 — and for `spicehub-backend.onrender.com` if the app calls it early (Render cold starts are slow enough that the handshake matters).

### 10. Prune the deploy payload
`dist/assets/ort-wasm-simd-threaded.jsep-*.wasm` is 21.6 MB. It's correctly excluded from the precache via `globIgnores` — good — but it still ships on every deploy for an optional Whisper fallback. Consider loading onnxruntime from a CDN at runtime, or dropping it from the web build and keeping it native-only.

---

## P2 — SEO (82) and Accessibility (96)

### 11. `robots.txt` is invalid — 37 errors
**Cause:** there is no `public/robots.txt`, and `vercel.json`'s catch-all rewrite `{"source": "/(.*)", "destination": "/index.html"}` serves the SPA HTML for `/robots.txt`. Lighthouse fetches it, gets HTML, and reports every line as a parse error.
**Fix:** add a real `public/robots.txt` (`User-agent: * / Allow: / / Sitemap: https://spicehub-web.vercel.app/sitemap.xml`). Same root cause makes the `llms.txt` audit fail — add a real `public/llms.txt` too, or accept that one as informational.

### 12. Missing meta description
`index.html` has `<title>` but no `<meta name="description">`. Add it, plus Open Graph / Twitter card tags (`og:title`, `og:description`, `og:image`) — those also control how the app looks when someone shares the link, which matters for a social-import product.

### 13. Consent-gate contrast failures
Three failing elements, all in the consent modal:
- the `SpiceHub` `<span>` in the header
- the "Read Privacy Policy" button
- the "Read Terms of Service" button

These are the *first* thing every new user sees, and they're the LCP element. Bump the foreground/background pair to ≥4.5:1 (large text ≥3:1) in `ConsentGate`'s styles. This is the only thing between 96 and 100 on accessibility.

---

## P3 — Best Practices hardening (score is already 100; these are unweighted)

### 14. Origin isolation via COOP
Add `Cross-Origin-Opener-Policy: same-origin` to the `/(.*)` header block in `vercel.json`. Verify no OAuth popup flow (Supabase auth) depends on `window.opener` first — `same-origin-allow-popups` is the safe middle ground if it does.

### 15. Trusted Types
`Require-Trusted-Types-For: 'script'` would mitigate DOM XSS. Realistically a bigger lift: it needs an audit of every `innerHTML` / `dangerouslySetInnerHTML` in the recipe-rendering and import-preview paths. File it as a follow-up, not a quick win.

### 16. Baseline features
Informational — flags APIs used that aren't Baseline-wide yet. Worth reading once to confirm nothing on the list breaks older iOS Safari.

---

## Suggested sequencing

| Wave | Items | Expected effect |
|---|---|---|
| 1 | 1, 5, 11, 12 | ~1.3 s off render-blocking; SEO 82 → ~100. Config-only, near-zero regression risk. |
| 2 | 3, 13 | FCP/LCP from ~5 s to ~1–1.5 s; a11y 96 → 100. Highest score-per-hour in the list. |
| 3 | 4, 6 | −300 KiB first-load JS. Touches App.jsx broadly — most regression-prone step. |
| 4 | 2 | −100 KiB blocking CSS. Biggest remaining win, biggest refactor. |
| 5 | 7, 8, 9, 10, 14–16 | Cleanup and hardening. |

---

## Testing plan

**Guardrails (constitution non-negotiables) — verify after every wave:**
1. Install to Home Screen on Android + iOS, then airplane mode → app opens, meals/drinks render from Dexie, no white screen.
2. Offline queue: queue an import while offline, go online, confirm it drains.
3. Service worker updates: deploy, reload twice, confirm `autoUpdate` picks up the new build (`registerType: 'autoUpdate'` + build number in Settings).
4. Instagram share-target: share a reel from the IG app → import starts automatically.
5. `npm run test` (vitest) + `npm run build` clean, no new chunk-size warnings above the 800 KB limit.

**Per-wave specifics:**
- **Wave 1:** confirm Press Start 2P still renders in the Bar/Speakeasy UI *offline* (this is the regression to watch — it silently falls back to a system font). `curl -I` the deployed `/robots.txt` and confirm `content-type: text/plain`, not `text/html`.
- **Wave 2:** re-run Lighthouse and confirm **CLS is still 0** — an inlined skeleton that doesn't match the mounted layout is the classic way to break it. Screenshot the consent gate in light + dark mode and check the contrast ratios with DevTools.
- **Wave 3:** click through every lazy screen with a throttled connection and confirm the `Suspense` fallbacks look intentional, not like flashes. Regression-test Bar → Meals room transitions (`RoomTransition`) since `BarShelf` is 3672 lines and reads layout mid-drag.
- **Wave 4:** visual diff every screen — a monolithic stylesheet that gets split will surface cascade-order bugs. Check the 58 fixed-position rules noted in earlier sessions.

**Measurement:** re-run PageSpeed mobile after each wave and record Performance / FCP / LCP / TBT / CLS in a table so you can attribute the gains. Lab numbers vary ±3 points run to run — don't chase single-point moves.

---

## Suggested conventional commits

```
perf(fonts): self-host Press Start 2P and drop the Google Fonts @import chain
perf(pwa): defer service worker registration with injectRegister inline
fix(seo): add real robots.txt and llms.txt so the SPA rewrite stops serving HTML
feat(seo): add meta description and Open Graph tags to index.html

perf(boot): inline a static consent-gate shell so first paint precedes React mount
fix(a11y): raise consent gate contrast to WCAG AA on wordmark and legal buttons

perf(bundle): lazy-load screen components out of the eager main chunk
perf(supabase): load the Supabase client on demand instead of at boot

perf(css): split App.css and defer non-critical styles off the render path

chore(build): raise vite target to es2022 and stop publishing source maps
perf(net): add preconnect hints for remaining critical-path origins
chore(sec): add Cross-Origin-Opener-Policy header
```

---

## Caveats

- All numbers are **lab** data from a single throttled mobile run. Real-world mobile users on decent connections will see better than 4.8 s FCP — but the shape of the problem (nothing paints until JS boots) is real regardless of network.
- Desktop already scores 98, so none of this is urgent for desktop installs.
- Items 14–16 are currently unweighted in the Best Practices score — fixing them won't move the number from 100.
