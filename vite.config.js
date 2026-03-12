import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import os from 'os'

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

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg', 'icon-maskable.svg'],
      manifest: false, // We use our own manifest.json in /public
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
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
