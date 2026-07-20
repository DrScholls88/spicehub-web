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
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.js'],
  },
  // Web Workers that use a dynamic import() internally (whisperWorker.js now
  // dynamically imports @huggingface/transformers) force Rollup to code-split
  // the worker bundle. Code-split builds aren't supported in IIFE/UMD, which
  // is Vite's default worker.format — must be 'es' or the build fails with
  // "Invalid value 'iife' for option 'worker.format'". The worker is already
  // instantiated with { type: 'module' } at runtime (transcriptionService.js),
  // so this just makes the build format match the runtime format.
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon-192.svg', 'icon-512.svg', 'icon-maskable.svg',
        // Raster icons (2026-07-16): iOS ignores SVG for apple-touch-icon and
        // falls back to a home-screen screenshot without a real PNG. These are
        // the home-screen + maskable rasters referenced by index.html/manifest.
        'apple-touch-icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
      ],
      manifest: false, // keep your custom /public/manifest.json
      strategies: 'injectManifest',
      srcDir: 'src',
      swSrc: 'sw.js',
      swDest: 'dist/sw.js',           // ← Changed: output to dist/ so Vercel serves it correctly
      // NOTE: strategy is 'injectManifest' (we own sw.js), so precache options
      // belong under `injectManifest`, NOT `workbox` — the `workbox` key only
      // applies to the 'generateSW' strategy and is silently ignored here.
      // (This is exactly what caused the build to fail: the size limit and
      // globPatterns below used to live under `workbox` and had no effect,
      // so workbox-build's real defaults applied — 2MiB cap, and a glob that
      // didn't even match .wasm/.gz — until the self-hosted Tesseract assets
      // in public/tesseract/ (~4MB .wasm.js loaders, 2.9MB .wasm, 2MB .gz)
      // tripped the real 2MiB default.
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,jpg,webp,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // @huggingface/transformers (browser Whisper, 2026-07-20) bundles
        // onnxruntime-web's WASM backend — the SIMD+threaded variant alone is
        // ~21MB. Don't precache it: Transformers.js manages its own runtime
        // cache for this file and for model weights (IndexedDB/browser cache,
        // see whisperWorker.js env.useBrowserCache), so the service worker
        // doesn't need a copy, and eagerly shipping 21MB to every install for
        // an optional ASR fallback most sessions never touch would be a real
        // regression for a "zero-cost, lightweight" PWA. Transcription itself
        // only ever runs against a URL fetch anyway (there's no offline path
        // into it), so there's no offline-sovereignty loss from lazy-loading
        // this on first real use instead of precaching it.
        globIgnores: ['**/ort-*.wasm', '**/ort-*.mjs'],
      },
      // cleanupOutdatedCaches is called directly in sw.js (workbox-precaching
      // import) — no vite-plugin-pwa `workbox` block needed for it.
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
    target: 'https://dummy.invalid',  // dummy - we override in configure
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
    const safePath = url.pathname || '/';
        proxyReq.path = safePath + url.search;
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
    target: 'es2019',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Split heavy, rarely-changing vendor code into its own long-lived
        // chunks so it can be cached (immutable, 1yr) separately from app
        // code that changes every build — and so it's not forced into the
        // single main bundle React.lazy()'d screens still pull in eagerly.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['framer-motion', 'motion'],
        },
    }
  }
  },
})
