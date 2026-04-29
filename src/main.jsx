import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ThemeProvider from './components/ThemeProvider.jsx'
import { registerBackgroundSync } from './backgroundSync.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
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
    } catch (error) {
      console.warn('Service Worker registration failed:', error)
    }
  })
}
