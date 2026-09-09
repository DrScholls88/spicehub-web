/**
 * SpiceHub - PWA update-detection signals
 *
 * Pure helpers pulled out of main.jsx's service-worker registration block so
 * they can be unit tested without a DOM/SW mock. Everything here exists to
 * answer two small questions robustly, because getting either one wrong is
 * exactly what made the update banner (App.jsx's "Downloading new version…"
 * skeleton) silently never appear on iOS home-screen installs:
 *
 *   1. isUpdateContext  — "is this launch an UPDATE (there was already an
 *      older build on this device), or a first install?" main.jsx used to
 *      answer this with a single check: `navigator.serviceWorker.controller`
 *      truthy. That property is a live, transient read of which worker is
 *      currently controlling the page — and iOS/WebKit is documented to null
 *      it out across a resumed standalone-app session even when a worker is
 *      genuinely active, because Apple suspends/evicts the whole SW process
 *      far more aggressively for home-screen apps than Safari suspends a
 *      background tab. Every place main.jsx gated the update UI behind
 *      `navigator.serviceWorker.controller` was a place iOS could silently
 *      swallow the banner. isUpdateContext adds a second, DURABLE signal
 *      (a localStorage flag proving this device has launched the app
 *      before) so a null controller on iOS no longer means "assume first
 *      install, show nothing."
 *
 *   2. isNewerBuild — compares a numeric build marker this bundle was
 *      compiled with against the same field fetched at runtime from
 *      /version.json (see vite.config.js's spicehub-emit-version-manifest
 *      plugin). This is the fallback update-detection path: it does not
 *      depend on `updatefound` / `controllerchange` / `statechange` ever
 *      firing at all, so it still works on the iOS sessions where those
 *      events are the ones that go missing.
 *
 *      Callers MUST pass buildTime (__SPICEHUB_BUILD_TIME__ / the
 *      version.json `buildTime` field — Date.now() at build), not the
 *      human-readable `build` counter from buildNumber.json. That counter
 *      is incremented-and-committed by hand on whichever machine happens
 *      to run a local `vite build`; CI's own build increments a separate,
 *      ephemeral copy that is never pushed back to git. Two consecutive
 *      real deploys can easily bake in the identical `build` number, which
 *      silently breaks this comparison (confirmed live: Settings > Check
 *      for Updates reported "latest version" while 2 real deploys behind).
 *      buildTime has no such failure mode — it's wall-clock time, so it's
 *      monotonic across real deploys with zero coordination required.
 */

/**
 * @param {{ hasController: boolean, hasLaunchedBefore: boolean }} signals
 * @returns {boolean} true if this looks like an update (not a first install)
 */
export function isUpdateContext({ hasController, hasLaunchedBefore }) {
  return Boolean(hasController) || Boolean(hasLaunchedBefore);
}

/**
 * @param {unknown} remoteBuild - the `buildTime` field read from /version.json
 * @param {unknown} localBuild - __SPICEHUB_BUILD_TIME__ baked into this bundle
 * @returns {boolean} true only when remoteBuild is a valid, strictly greater
 *   build number. Anything malformed (missing file, bad JSON, non-numeric
 *   field, a build that went backwards) resolves to false rather than
 *   throwing or false-triggering the banner — a poll is a bonus signal, not
 *   one worth surfacing a wrong prompt over.
 */
export function isNewerBuild(remoteBuild, localBuild) {
  const remote = Number(remoteBuild);
  const local = Number(localBuild);
  if (!Number.isFinite(remote) || !Number.isFinite(local)) return false;
  return remote > local;
}
