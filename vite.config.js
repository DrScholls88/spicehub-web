import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Auto-detect local IP for HMR on remote devices (dev only)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer WiFi or ethernet (10.x, 192.168.x, 172.16-31.x)
        if (iface.address.startsWith('192.168') || iface.address.startsWith('10.') || iface.address.startsWith('172.')) {
          return iface.address;
        }
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

// ── Build numbering system ──────────────────────────────────────────────────
// Auto-increments a build counter stored in buildNumber.json on each `vite build`.
// In dev mode, reads current number without incrementing.
const buildNumPath = path.resolve(__dirname, 'buildNumber.json');
let buildNum = 0;
try {
  const data = JSON.parse(fs.readFileSync(buildNumPath, 'utf8'));
  buildNum = data.build || 0;
} catch { /* first run */ }
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('build');
if (isProduction) {
  buildNum++;
  fs.writeFileSync(buildNumPath, JSON.stringify({ build: buildNum }, null, 2));
}
const BUILD_VERSION = `1.0.${buildNum}`;
console.log(`\n  SpiceHub Build #${buildNum}  (v${BUILD_VERSION})\n`);

export default defineConfig({
  define: {
    '__SPICEHUB_BUILD__': JSON.stringify(buildNum),
    '__SPICEHUB_VERSION__': JSON.stringify(BUILD_VERSION),
    '__SPICEHUB_SERVER__': JSON.stringify(process.env.VITE_SERVER_URL || 'http://localhost:3001'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg', 'icon-maskable.svg'],
      manifest: false, // We use our own manifest.json in /public
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /\.[a-z]+$/i],
        runtimeCaching: [
          {
            // Cache recipe images from external sources
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'recipe-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Cache Instagram CDN images (recipe photos)
            urlPattern: /^https:\/\/.*\.cdninstagram\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'instagram-images',
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Cache CORS proxy responses for recipe parsing (client-side fallback)
            urlPattern: /^https:\/\/api\.allorigins\.win\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cors-proxy-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Cache web fonts and SVG icons from CDNs with long expiry
            urlPattern: /\.(?:woff2?|ttf|eot)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'font-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            // Cache general images (PNG, JPEG, GIF, WebP, AVIF)
            urlPattern: /\.(?:png|jpg|jpeg|gif|webp|avif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'general-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Cache API calls with network-first strategy and 5s timeout
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    open: false,
    // HMR: allow connections from remote devices on the network
    middlewareMode: false,
    hmr: {
      host: localIP,
      protocol: 'ws',
      port: 5173,
    },
    // Proxy /api/* to the SpiceHub browser server (server.js on port 3001)
    // Only used in dev when server is running
    proxy: {
      '/api': {
        target: `http://${localIP}:3001`,
        changeOrigin: true,
        // Optional: server not required for basic functionality
        ws: true,
        rewrite: (path) => path,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
