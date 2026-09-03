// MUST stay the first import in this file — see src/polyfills.js for why.
// It installs AbortSignal.timeout on iOS 15, without which the entire import
// pipeline throws TypeError at its first fetch.
import './polyfills.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ThemeProvider from './components/ThemeProvider.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { registerBackgroundSync } from './backgroundSync.js'

// ── Adopt the deferred main stylesheet (2026-08-24) ──────────────────────────
// The production build ships the bundled CSS as `media="print"` so it does not
// block the first paint of the boot skeleton in index.html (the swap is done by
// the `spicehub-defer-main-stylesheet` plugin in vite.config.js, build only —
// in dev, Vite injects CSS through JS and there is nothing to flip). Flipping
// it back to `all` here is what actually applies the app's styles.
//
// Why here and not an onload handler on the <link>: the CSP is
// `script-src 'self'` with no 'unsafe-inline', so an `onload="…"` attribute in
// index.html would be blocked outright.
//
// Why this is safe:
//   * It runs before createRoot().render(), so React never commits a frame
//     against unstyled CSS.
//   * The stylesheet (~102 KiB) starts downloading during HTML parse and is a
//     fifth the size of this bundle, so by the time this module executes it has
//     effectively always arrived. In the pathological case where it has not,
//     the browser simply blocks the NEXT paint until it does — the skeleton is
//     already on screen, so FCP/LCP are banked either way.
//   * If this module never runs at all, the user is left on the boot skeleton
//     rather than the blank page they used to get, so it fails no worse.
for (const link of document.querySelectorAll('link[data-sh-deferred-css]')) {
  link.media = 'all';
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// ── Share-target intent (Android/iOS via Capacitor) ──────────────────────────
// When the user taps "Share → SpiceHub" from Instagram/TikTok/etc., the OS
// hands us either a URL or a chunk of text. We dispatch a CustomEvent that
// App.jsx listens for and pipes into ImportModal as `sharedContent`, which
// triggers parseHybrid automatically — no copy-paste required.
//
// The plugin import is dynamic + try-wrapped because the web build doesn't
// have access to Capacitor; on web this is a no-op. On native, it auto-fires
// when the OS routes a share intent to us.
async function wireShareTarget() {
  try {
    // Only run on native platforms — quick guard avoids loading the plugin
    // bundle on web where it'd just throw.
    if (typeof window === 'undefined') return;
    const capModule = await import(/* @vite-ignore */ '@capacitor/core').catch(() => null);
    const isNative = capModule?.Capacitor?.isNativePlatform?.();
    if (!isNative) return;

    const { ShareTarget } = await import(/* @vite-ignore */ '@capgo/capacitor-share-target');
    if (!ShareTarget?.addListener) return;

    ShareTarget.addListener('shareReceived', (payload) => {
      // payload shape: { url?, text?, title?, mimeType? }
      const url = payload?.url || extractFirstUrl(payload?.text || '');
      const text = payload?.text || '';
      const title = payload?.title || '';
      if (!url && !text) return;

      const evt = new CustomEvent('spicehub:share-import', {
        detail: { url, text, title, mode: url ? 'url' : 'text' },
      });
      window.dispatchEvent(evt);
    });
  } catch (err) {
    console.warn('[share-target] wiring failed:', err?.message || err);
  }
}

function extractFirstUrl(s) {
  const m = s.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[)\].,;]+$/, '') : '';
}

wireShareTarget();

// Register service worker with background sync support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      console.log('Service Worker registered:', registration)
      // Exposed so the Settings sheet's "Check for Updates" button can call
      // registration.update() without needing its own SW plumbing.
      window.__spicehubSWRegistration = registration;

      // Check for Background Sync API support
      if ('sync' in registration) {
        console.log('Background Sync API available')
      }

      // Listen for sync completion messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_COMPLETE') {
          const syncEvent = new CustomEvent('sw-sync-complete', {
            detail: event.data.payload,
          })
          window.dispatchEvent(syncEvent)
        }
      })

      // Register background sync tasks
      await registerBackgroundSync(registration)

      // ── Auto-check for updates whenever the PWA comes back to the
      // foreground (feedback 2026-07-15: iOS home-screen users had to
      // delete + re-add the app to get new builds). iOS standalone PWAs
      // don't reliably re-check for a new sw.js on their own, so we force
      // a check every time the tab/app becomes visible or regains focus —
      // "just reopen the app" is now enough to pick up an update. ──────────
      //
      // `announce` is passed only by the once-per-load check further down.
      // Resume/focus/interval checks stay silent: a status bar on every tab
      // focus is noise, and if one of them does find something, updatefound
      // still reports the 'downloading' phase on its own.
      const checkForUpdate = (announce = false) => {
        const done = registration.update();
        // !updateAnnounced: a waiting worker found at startup has already put
        // the bar in its ready state, and narrating a check underneath that
        // would be describing work whose answer is already on screen.
        if (announce && navigator.serviceWorker.controller && !updateAnnounced) {
          setUpdatePhase('checking');
          // update() settles when the whole job finishes: immediately when
          // sw.js came back byte-identical, or only AFTER install when it did
          // not. Clear the phase only if we are still in 'checking' — in the
          // second case updatefound has long since moved us to 'downloading'
          // and clearing here would yank the bar mid-download.
          const settle = () => { if (updatePhase === 'checking') setUpdatePhase('idle'); };
          done.then(settle, settle);
        }
        return done.catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
          // Re-surface prompt if user dismissed but waiting worker still exists
          if (registration.waiting && navigator.serviceWorker.controller) {
            announceUpdateReady();
          }
        }
      });
      // Wrapped rather than passed directly: as a listener it would receive the
      // FocusEvent as `announce`, which is truthy.
      window.addEventListener('focus', () => { checkForUpdate(); });

      // iOS bfcache / Home Screen resume — visibilitychange sometimes
      // doesn't fire on iOS standalone, but pageshow always does.
      window.addEventListener('pageshow', () => {
        checkForUpdate();
        if (registration.waiting && navigator.serviceWorker.controller) {
          announceUpdateReady();
        }
      });

      // Periodic check while in foreground (every 60 min) — catches deploys
      // that happen while the user keeps the app open for extended sessions.
      setInterval(() => {
        if (document.visibilityState === 'visible') checkForUpdate();
      }, 60 * 60 * 1000);

      // ── Handle a waiting worker that already exists at startup ──────────
      // If a previous visit installed a new SW but it wasn't applied
      // (e.g. user closed the app before tapping Refresh, or the
      // updatefound event was missed), announce immediately.
      if (registration.waiting && navigator.serviceWorker.controller) {
        announceUpdateReady();
      }

      // ── Detect a freshly-installed build ────────────────────────────────
      // sw.js calls skipWaiting()+clientsClaim(), so a new worker jumps
      // straight to 'installed' → 'activating'. We catch the 'installed'
      // state: if there's already a controller, this is an UPDATE (not the
      // first install), so we announce it. announceUpdateReady() then decides
      // whether to apply it silently (app hidden) or surface a tap-to-refresh
      // prompt (app on-screen) instead of yanking the user out of their task.
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        // This is the slow stretch users were complaining about: the new
        // worker is precaching the whole app shell, which can run past ten
        // seconds on a phone. A controller already existing is what makes it
        // an UPDATE rather than a first install, and only an update is worth
        // narrating — nobody needs to be told their first visit is loading.
        if (navigator.serviceWorker.controller) setUpdatePhase('downloading');
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdateReady();
          } else if (installing.state === 'redundant') {
            // Install failed — went offline mid-download, quota, bad response.
            // Release the bar instead of leaving it shimmering forever.
            setUpdatePhase('idle');
          }
        });
      });

      // The once-per-load check. Registration itself triggers an update job,
      // but it gives us no promise to hang a phase on, and every other check
      // above is bound to resume/focus — a cold session that stays in the
      // foreground would otherwise report nothing at all. Deliberately placed
      // after the updatefound listener so the event cannot fire unobserved.
      checkForUpdate(true);
    } catch (error) {
      console.warn('Service Worker registration failed:', error)
    }
  })

  // ── Update application: one reload, guarded against loops ───────────────
  // sw.js calls self.skipWaiting() + clientsClaim(), so a newly installed SW
  // takes control immediately — but the running page keeps its old JS/CSS
  // until it reloads. We control WHEN that reload happens so it's never a
  // surprise (the old unconditional controllerchange reload was yanking users
  // out of in-progress screens).
  let swRefreshing = false;
  let updateAnnounced = false;

  // ── Update-phase channel (2026-09-03) ─────────────────────────────────────
  // Feedback: precaching a new build can take 10+ seconds, so the green "New
  // version ready" bar arrived long after the user had scrolled on and stopped
  // expecting anything. The UI now renders the SAME bar in a pending state for
  // the duration of that work, so the Refresh button appears somewhere the eye
  // has already been given a reason to rest.
  //
  //   'checking'    — sw.js is being fetched and byte-compared (fast, usually)
  //   'downloading' — a new worker exists and is precaching (the slow one)
  //   'idle'        — nothing in flight; the UI takes the bar away
  //
  // 'ready' is deliberately NOT a phase: it stays on the existing
  // spicehub:update-ready event, so none of the wiring around it changes.
  //
  // This module reports only what is true. App.jsx decides what is worth
  // painting — it holds 'checking' behind a delay so that the common case, a
  // check that comes back empty in a few hundred milliseconds, never puts a
  // single pixel on screen or costs a layout shift.
  let updatePhase = 'idle';
  function setUpdatePhase(next) {
    if (updatePhase === next) return;
    updatePhase = next;
    window.dispatchEvent(new CustomEvent('spicehub:update-phase', { detail: { phase: next } }));
  }

  function applyUpdate() {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  }
  // The in-app "Update ready" prompt (App.jsx) calls this when the user taps
  // Refresh. Exposed on window so the UI doesn't need its own SW plumbing.
  window.__spicehubApplyUpdate = applyUpdate;

  function announceUpdateReady() {
    if (updateAnnounced) return;
    updateAnnounced = true;
    // Hand the bar over: the pending state has nothing left to say once the
    // ready state can speak for itself.
    setUpdatePhase('idle');
    if (document.visibilityState === 'hidden') {
      applyUpdate();            // user isn't looking — safe to refresh now
    } else {
      window.dispatchEvent(new CustomEvent('spicehub:update-ready'));
    }
  }
  // When the user dismisses the banner, allow re-prompt on next
  // visibilitychange/pageshow if a waiting worker still exists.
  window.addEventListener('spicehub:update-dismissed', () => {
    updateAnnounced = false;
  });

  // Safety net for control changes we didn't originate (e.g. another tab
  // installed a new SW, or a first install claiming this page): only auto-
  // reload when the screen is HIDDEN, so a visible session is never
  // interrupted. Visible updates go through the tap-to-refresh prompt above.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    if (document.visibilityState !== 'hidden') return;
    applyUpdate();
  });
}
