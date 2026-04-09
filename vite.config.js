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
  manifest: false, // you use custom /public/manifest.json — good
  strategies: 'injectManifest',
  swSrc: 'public/sw.js',
  swDest: 'sw.js',
  injectManifest: {
    // Recommended for newer workbox + Vite 7
    injectionPoint: undefined, // if you don't use self.__WB_MANIFEST in sw.js
    // or keep it if you do
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
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
    '/media-proxy': {   // New proxy for images
    ttarget: 'https://dummy.invalid',  // dummy - we override in configure
    changeOrigin: true,
    secure: true,
    configure: (proxy, _options) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Extract the real target URL from the path
        const fullUrl = decodeURIComponent(req.url.replace(/^\/media-proxy\//, ''));
        if (!fullUrl.startsWith('http')) {
          proxyReq.destroy(); // invalid
          return;
        }
// Re-target dynamically
        const url = new URL(fullUrl);
        proxyReq.setHeader('host', url.host);
        proxyReq.path = url.pathname + url.search;
        // Anti-block headers (Instagram checks these)
        proxyReq.setHeader('Referer', 'https://www.instagram.com/');
        proxyReq.setHeader('User-Agent', 'SpiceHub-App/1.0 (+https://spicehub-web.vercel.app)');
        proxyReq.setHeader('Accept', 'image/*');
      });
    },
  },
},
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
