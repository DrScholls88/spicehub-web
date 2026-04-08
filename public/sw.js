// ── SpiceHub Service Worker ────────────────────────────────────────────────
// Strategy: injectManifest — vite-plugin-pwa replaces self.__WB_MANIFEST below.
// This file is the single source of truth for all SW behavior:
//   • Precaching Vite build assets
//   • SPA navigation fallback (/index.html)
//   • Runtime caching (images, CORS proxy, fonts)
//   • POST share-target → GET redirect (the critical missing piece)

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ── Core: claim clients and activate immediately ────────────────────────────
self.skipWaiting();
clientsClaim();

// ── Precache all Vite-built assets ──────────────────────────────────────────
// vite-plugin-pwa injects the manifest array in place of self.__WB_MANIFEST
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ── SPA navigation fallback ─────────────────────────────────────────────────
// Serve /index.html for all navigation requests EXCEPT:
//   - /api/* routes (proxy)
//   - Static file extensions (.js, .css, .png etc.)
//   - /share-target (must NOT be cached — it needs live POST data)
const navHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navHandler, {
  denylist: [
    /^\/api\//,           // backend API routes
    /\/share-target/,     // share target — must reach live SW, not cache
    /\.[a-z]{2,4}$/i,    // static files (js, css, png, woff2, etc.)
  ],
});
registerRoute(navigationRoute);

// ── Runtime caching ─────────────────────────────────────────────────────────

// Instagram CDN images (recipe photos imported from Instagram)
registerRoute(
  /^https:\/\/.*\.cdninstagram\.com\/.*/i,
  new CacheFirst({
    cacheName: 'instagram-images',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  })
);

// Unsplash recipe images
registerRoute(
  /^https:\/\/images\.unsplash\.com\/.*/i,
  new CacheFirst({
    cacheName: 'recipe-images',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// CORS proxy responses (network-first so fresh content takes priority)
registerRoute(
  /^https:\/\/(?:api\.allorigins\.win|corsproxy\.io|api\.codetabs\.com)\/.*/i,
  new NetworkFirst({
    cacheName: 'cors-proxy-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 })],
    networkTimeoutSeconds: 10,
  })
);

// Web fonts (long-lived, stale-while-revalidate)
registerRoute(
  /\.(?:woff2?|ttf|eot)$/i,
  new StaleWhileRevalidate({
    cacheName: 'font-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 })],
  })
);

// General images (PNG, JPEG, GIF, WebP, AVIF, SVG)
registerRoute(
  /\.(?:png|jpg|jpeg|gif|webp|avif|svg)$/i,
  new CacheFirst({
    cacheName: 'general-images',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// ── Share Target: POST → GET redirect ───────────────────────────────────────
// When Android shares a URL to SpiceHub:
//   1. OS sends POST /share-target with multipart/form-data
//   2. This handler intercepts, extracts params, redirects to /?share-target=1&url=...
//   3. App.jsx detects ?share-target param and auto-opens ImportModal
//
// This MUST be a fetch event listener (not a registerRoute) so it fires BEFORE
// any routing/caching logic intercepts the POST request.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        // Shared URL is in 'url' field; 'text' is a fallback (some apps put URL in text)
        const sharedUrl = formData.get('url') || formData.get('text') || '';
        const sharedTitle = formData.get('title') || '';

        const params = new URLSearchParams();
        params.append('share-target', '1');
        if (sharedUrl) params.append('url', sharedUrl);
        if (sharedTitle) params.append('title', sharedTitle);

        // 303 See Other — browser follows redirect with GET, preserving query string
        return Response.redirect(`/?${params.toString()}`, 303);
      } catch (err) {
        console.error('[SpiceHub SW] share-target error:', err);
        // Fallback: at least open the app
        return Response.redirect('/?share-target=1', 303);
      }
    })());
  }
});
