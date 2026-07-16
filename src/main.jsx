import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ThemeProvider from './components/ThemeProvider.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { registerBackgroundSync } from './backgroundSync.js'

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
      const checkForUpdate = () => { registration.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);

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
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdateReady();
          }
        });
      });
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
    if (document.visibilityState === 'hidden') {
      applyUpdate();            // user isn't looking — safe to refresh now
    } else {
      window.dispatchEvent(new CustomEvent('spicehub:update-ready'));
    }
  }

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
