/**
 * Runtime polyfills — imported FIRST in main.jsx, before any other module.
 *
 * ES module bodies evaluate in import order, so a bare `import './polyfills.js'`
 * as the first import in main.jsx guarantees everything here is installed
 * before any other module body runs. Do not move it below another import.
 *
 * ── Why this file exists (2026-08-24) ───────────────────────────────────────
 * Found while working the "Baseline features" item of the 2026-08-23 PageSpeed
 * audit — the one flagged as purely informational. It was not.
 *
 * `AbortSignal.timeout()` is Safari 16.0+ / iOS 16+. This codebase calls it at
 * 13 sites with NO feature detection anywhere:
 *
 *   recipeParser.js (x4), import/structure/gemini.js (x2),
 *   import/acquire/instagram.js, import/acquire/website.js, import/images.js,
 *   lib/photoImportEngine.js, db.js, components/MealLibrary.jsx,
 *   components/BarLibrary.jsx
 *
 * On iOS 15.x every one of those throws `TypeError: AbortSignal.timeout is not
 * a function` — which takes out URL import, Instagram acquire, Gemini
 * structuring, website fetch, vision, photo import and the library sync. The
 * keystone feature, dead, on a browser version the rest of the app supports
 * (design.md §9 targets iOS Safari generally, and every PWA behaviour it
 * describes — dvh, safe-area insets, navigator.storage.persist — works on 15).
 *
 * Note the codebase already guards the SIBLING api: `AbortSignal.any` is
 * feature-detected in import/acquire/website.js and lib/photoImportEngine.js.
 * `.timeout` simply got missed, and nothing in the build catches it —
 * vite's `target` only downlevels SYNTAX, never library APIs, so raising the
 * target to es2022 neither caused this nor fixes it.
 *
 * Polyfilling centrally rather than editing 13 call sites is deliberate: those
 * sites are spread across the import pipeline, which is the highest-risk code
 * in the app to churn for a compatibility fix.
 */

// AbortSignal.timeout(ms) — Safari 16+, Chrome 103+, Firefox 100+.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function timeout(ms) {
    const controller = new AbortController();
    setTimeout(() => {
      // The spec aborts with a TimeoutError DOMException, and callers do
      // branch on this: several fetch wrappers check `err.name === 'TimeoutError'`
      // to distinguish "the server was slow" from "the user navigated away".
      // Getting the reason wrong would turn timeouts into generic AbortErrors
      // and silently change that error handling.
      let reason;
      try {
        reason = new DOMException('signal timed out', 'TimeoutError');
      } catch {
        // DOMException isn't constructible in a few very old engines.
        reason = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
      }
      controller.abort(reason);
    }, ms);
    return controller.signal;
  };
}
