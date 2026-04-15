// ── SpiceHub Service Worker ────────────────────────────────────────────────
// Strategy: injectManifest — vite-plugin-pwa replaces self.__WB_MANIFEST below.
// This file is the single source of truth for all SW behavior:
//   • Precaching Vite build assets
//   • SPA navigation fallback (/index.html)
//   • Runtime caching (images, fonts)
//   • POST share-target → GET redirect
//
// IMPORTANT DESIGN DECISIONS:
//   • Instagram/Meta CDN URLs (scontent.cdninstagram.com, fbcdn.net) are NOT cached.
//     They expire and block hotlinking. SpiceHub now stores images as base64 at import time.
//   • CORS proxy calls (allorigins.win, corsproxy.io, etc.) are NOT intercepted by the SW.
//     They must reach the network directly — SW interception strips CORS headers.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ── Core: claim clients and activate immediately ────────────────────────────
self.skipWaiting();
clientsClaim();

// ── Precache all Vite-built assets ──────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ── SPA navigation fallback ─────────────────────────────────────────────────
const navHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navHandler, {
  denylist: [
    /^\/api\//,           // backend API routes
    /\/share-target/,     // share target — live POST handler below
    /\.[a-z]{2,4}$/i,    // static files (js, css, png, woff2, etc.)
  ],
});
registerRoute(navigationRoute);

// ── Instagram / Meta CDN: NetworkOnly with silent failure ──────────────────
// These URLs WILL 403 (they expire + block hotlinking from external domains).
// We cannot and should not cache them. NetworkOnly + catch means broken images
// fail silently instead of crashing the SW with "no-response".
// SpiceHub now downloads images to base64 at import time to avoid this entirely.
const igCdnMatcher = ({ url }) =>
  /\.(cdninstagram\.com|fbcdn\.net|fbsbx\.com|fna\.fbcdn\.net)$/i.test(url.hostname);

registerRoute(igCdnMatcher, new NetworkOnly());

// ── CORS proxy calls: pass-through (no SW interception) ────────────────────
// allorigins.win, corsproxy.io, codetabs.com, thingproxy — SW must NOT intercept.
// Intercepting strips CORS headers and causes ERR_FAILED / no-response crashes.
// We handle this by NOT registering a route for these origins.
// The SW will let these requests bypass to the network automatically.

// ── Recipe + general images (non-Instagram) ─────────────────────────────────
// CacheFirst is safe here because these URLs don't expire aggressively.
// Explicitly exclude Instagram/Meta CDN origins to prevent 403 cache crashes.
registerRoute(
  ({ url, request }) => {
    if (request.destination !== 'image') return false;
    // Never cache Instagram/Meta CDN — they expire and 403
    if (/\.(cdninstagram\.com|fbcdn\.net|fbsbx\.com|fna\.fbcdn\.net)$/i.test(url.hostname)) return false;
    // Never cache CORS proxy URLs
    if (/\.(allorigins\.win|corsproxy\.io|codetabs\.com|thingproxy\.freeboard\.io)$/i.test(url.hostname)) return false;
    return true;
  },
  new CacheFirst({
    cacheName: 'recipe-images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 150,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ── Unsplash images ─────────────────────────────────────────────────────────
registerRoute(
  /^https:\/\/images\.unsplash\.com\/.*/i,
  new CacheFirst({
    cacheName: 'unsplash-images',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// ── Web fonts ───────────────────────────────────────────────────────────────
registerRoute(
  /\.(?:woff2?|ttf|eot)$/i,
  new StaleWhileRevalidate({
    cacheName: 'font-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 })],
  })
);

// ── Google AI API calls: NetworkFirst (fast, no caching) ───────────────────
registerRoute(
  /^https:\/\/generativelanguage\.googleapis\.com\/.*/i,
  new NetworkFirst({ networkTimeoutSeconds: 15 })
);

// ── Share Target: POST → GET redirect ───────────────────────────────────────
// When Android/iOS shares a URL to SpiceHub:
//   1. OS sends POST /share-target with multipart/form-data
//   2. This handler extracts params, redirects to /?share-target=1&url=...
//   3. App.jsx detects ?share-target param and auto-opens ImportModal
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const sharedUrl = formData.get('url') || formData.get('text') || '';
        const sharedTitle = formData.get('title') || '';

        const params = new URLSearchParams();
        params.append('share-target', '1');
        if (sharedUrl) params.append('url', sharedUrl);
        if (sharedTitle) params.append('title', sharedTitle);

        return Response.redirect(`/?${params.toString()}`, 303);
      } catch (err) {
        console.error('[SpiceHub SW] share-target error:', err);
        return Response.redirect('/?share-target=1', 303);
      }
    })());
  }
});
