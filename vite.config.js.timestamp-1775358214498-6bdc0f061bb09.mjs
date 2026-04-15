// vite.config.js
import { defineConfig } from "file:///sessions/blissful-relaxed-thompson/mnt/spicehub-web/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/blissful-relaxed-thompson/mnt/spicehub-web/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/blissful-relaxed-thompson/mnt/spicehub-web/node_modules/vite-plugin-pwa/dist/index.js";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __vite_injected_original_import_meta_url = "file:///sessions/blissful-relaxed-thompson/mnt/spicehub-web/vite.config.js";
var __dirname = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        if (iface.address.startsWith("192.168") || iface.address.startsWith("10.") || iface.address.startsWith("172.")) {
          return iface.address;
        }
      }
    }
  }
  return "localhost";
}
var localIP = getLocalIP();
var buildNumPath = path.resolve(__dirname, "buildNumber.json");
var buildNum = 0;
try {
  const data = JSON.parse(fs.readFileSync(buildNumPath, "utf8"));
  buildNum = data.build || 0;
} catch {
}
var isProduction = process.env.NODE_ENV === "production" || process.argv.includes("build");
if (isProduction) {
  buildNum++;
  fs.writeFileSync(buildNumPath, JSON.stringify({ build: buildNum }, null, 2));
}
var BUILD_VERSION = `1.0.${buildNum}`;
console.log(`
  SpiceHub Build #${buildNum}  (v${BUILD_VERSION})
`);
var vite_config_default = defineConfig({
  define: {
    "__SPICEHUB_BUILD__": JSON.stringify(buildNum),
    "__SPICEHUB_VERSION__": JSON.stringify(BUILD_VERSION),
    "__SPICEHUB_SERVER__": JSON.stringify(process.env.VITE_SERVER_URL || "http://localhost:3001")
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.svg", "icon-512.svg", "icon-maskable.svg"],
      manifest: false,
      // We use our own manifest.json in /public
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /\.[a-z]+$/i],
        runtimeCaching: [
          {
            // Cache recipe images from external sources
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "recipe-images",
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            // Cache Instagram CDN images (recipe photos)
            urlPattern: /^https:\/\/.*\.cdninstagram\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "instagram-images",
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 }
            }
          },
          {
            // Cache CORS proxy responses for recipe parsing (client-side fallback)
            urlPattern: /^https:\/\/api\.allorigins\.win\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "cors-proxy-cache",
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }
            }
          },
          {
            // Cache web fonts and SVG icons from CDNs with long expiry
            urlPattern: /\.(?:woff2?|ttf|eot)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "font-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          },
          {
            // Cache general images (PNG, JPEG, GIF, WebP, AVIF)
            urlPattern: /\.(?:png|jpg|jpeg|gif|webp|avif)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "general-images",
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            // Cache API calls with network-first strategy and 5s timeout
            urlPattern: /\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              networkTimeoutSeconds: 5
            }
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    open: false,
    // HMR: allow connections from remote devices on the network
    middlewareMode: false,
    hmr: {
      host: localIP,
      protocol: "ws",
      port: 5173
    },
    // Proxy /api/* to the SpiceHub browser server (server.js on port 3001)
    // Only used in dev when server is running
    proxy: {
      "/api": {
        target: `http://${localIP}:3001`,
        changeOrigin: true,
        // Optional: server not required for basic functionality
        ws: true,
        rewrite: (path2) => path2
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYmxpc3NmdWwtcmVsYXhlZC10aG9tcHNvbi9tbnQvc3BpY2VodWItd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvYmxpc3NmdWwtcmVsYXhlZC10aG9tcHNvbi9tbnQvc3BpY2VodWItd2ViL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9ibGlzc2Z1bC1yZWxheGVkLXRob21wc29uL21udC9zcGljZWh1Yi13ZWIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcbmltcG9ydCBvcyBmcm9tICdvcydcbmltcG9ydCBmcyBmcm9tICdmcydcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAndXJsJ1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKVxuXG4vLyBBdXRvLWRldGVjdCBsb2NhbCBJUCBmb3IgSE1SIG9uIHJlbW90ZSBkZXZpY2VzIChkZXYgb25seSlcbmZ1bmN0aW9uIGdldExvY2FsSVAoKSB7XG4gIGNvbnN0IGludGVyZmFjZXMgPSBvcy5uZXR3b3JrSW50ZXJmYWNlcygpO1xuICBmb3IgKGNvbnN0IG5hbWUgaW4gaW50ZXJmYWNlcykge1xuICAgIGZvciAoY29uc3QgaWZhY2Ugb2YgaW50ZXJmYWNlc1tuYW1lXSkge1xuICAgICAgLy8gU2tpcCBpbnRlcm5hbCBhbmQgbm9uLUlQdjQgYWRkcmVzc2VzXG4gICAgICBpZiAoaWZhY2UuZmFtaWx5ID09PSAnSVB2NCcgJiYgIWlmYWNlLmludGVybmFsKSB7XG4gICAgICAgIC8vIFByZWZlciBXaUZpIG9yIGV0aGVybmV0ICgxMC54LCAxOTIuMTY4LngsIDE3Mi4xNi0zMS54KVxuICAgICAgICBpZiAoaWZhY2UuYWRkcmVzcy5zdGFydHNXaXRoKCcxOTIuMTY4JykgfHwgaWZhY2UuYWRkcmVzcy5zdGFydHNXaXRoKCcxMC4nKSB8fCBpZmFjZS5hZGRyZXNzLnN0YXJ0c1dpdGgoJzE3Mi4nKSkge1xuICAgICAgICAgIHJldHVybiBpZmFjZS5hZGRyZXNzO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnbG9jYWxob3N0Jztcbn1cblxuY29uc3QgbG9jYWxJUCA9IGdldExvY2FsSVAoKTtcblxuLy8gXHUyNTAwXHUyNTAwIEJ1aWxkIG51bWJlcmluZyBzeXN0ZW0gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBBdXRvLWluY3JlbWVudHMgYSBidWlsZCBjb3VudGVyIHN0b3JlZCBpbiBidWlsZE51bWJlci5qc29uIG9uIGVhY2ggYHZpdGUgYnVpbGRgLlxuLy8gSW4gZGV2IG1vZGUsIHJlYWRzIGN1cnJlbnQgbnVtYmVyIHdpdGhvdXQgaW5jcmVtZW50aW5nLlxuY29uc3QgYnVpbGROdW1QYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ2J1aWxkTnVtYmVyLmpzb24nKTtcbmxldCBidWlsZE51bSA9IDA7XG50cnkge1xuICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoYnVpbGROdW1QYXRoLCAndXRmOCcpKTtcbiAgYnVpbGROdW0gPSBkYXRhLmJ1aWxkIHx8IDA7XG59IGNhdGNoIHsgLyogZmlyc3QgcnVuICovIH1cbmNvbnN0IGlzUHJvZHVjdGlvbiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAncHJvZHVjdGlvbicgfHwgcHJvY2Vzcy5hcmd2LmluY2x1ZGVzKCdidWlsZCcpO1xuaWYgKGlzUHJvZHVjdGlvbikge1xuICBidWlsZE51bSsrO1xuICBmcy53cml0ZUZpbGVTeW5jKGJ1aWxkTnVtUGF0aCwgSlNPTi5zdHJpbmdpZnkoeyBidWlsZDogYnVpbGROdW0gfSwgbnVsbCwgMikpO1xufVxuY29uc3QgQlVJTERfVkVSU0lPTiA9IGAxLjAuJHtidWlsZE51bX1gO1xuY29uc29sZS5sb2coYFxcbiAgU3BpY2VIdWIgQnVpbGQgIyR7YnVpbGROdW19ICAodiR7QlVJTERfVkVSU0lPTn0pXFxuYCk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGRlZmluZToge1xuICAgICdfX1NQSUNFSFVCX0JVSUxEX18nOiBKU09OLnN0cmluZ2lmeShidWlsZE51bSksXG4gICAgJ19fU1BJQ0VIVUJfVkVSU0lPTl9fJzogSlNPTi5zdHJpbmdpZnkoQlVJTERfVkVSU0lPTiksXG4gICAgJ19fU1BJQ0VIVUJfU0VSVkVSX18nOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5WSVRFX1NFUlZFUl9VUkwgfHwgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMScpLFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBWaXRlUFdBKHtcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ2F1dG9VcGRhdGUnLFxuICAgICAgaW5jbHVkZUFzc2V0czogWydpY29uLTE5Mi5zdmcnLCAnaWNvbi01MTIuc3ZnJywgJ2ljb24tbWFza2FibGUuc3ZnJ10sXG4gICAgICBtYW5pZmVzdDogZmFsc2UsIC8vIFdlIHVzZSBvdXIgb3duIG1hbmlmZXN0Lmpzb24gaW4gL3B1YmxpY1xuICAgICAgd29ya2JveDoge1xuICAgICAgICBza2lwV2FpdGluZzogdHJ1ZSxcbiAgICAgICAgY2xpZW50c0NsYWltOiB0cnVlLFxuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsc3ZnLHBuZyx3b2ZmMn0nXSxcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogJy9pbmRleC5odG1sJyxcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFja0RlbnlsaXN0OiBbL15cXC9hcGlcXC8vLCAvXFwuW2Etel0rJC9pXSxcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBDYWNoZSByZWNpcGUgaW1hZ2VzIGZyb20gZXh0ZXJuYWwgc291cmNlc1xuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9pbWFnZXNcXC51bnNwbGFzaFxcLmNvbVxcLy4qL2ksXG4gICAgICAgICAgICBoYW5kbGVyOiAnQ2FjaGVGaXJzdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ3JlY2lwZS1pbWFnZXMnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDEwMCwgbWF4QWdlU2Vjb25kczogMzAgKiAyNCAqIDYwICogNjAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBDYWNoZSBJbnN0YWdyYW0gQ0ROIGltYWdlcyAocmVjaXBlIHBob3RvcylcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9eaHR0cHM6XFwvXFwvLipcXC5jZG5pbnN0YWdyYW1cXC5jb21cXC8uKi9pLFxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdpbnN0YWdyYW0taW1hZ2VzJyxcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjogeyBtYXhFbnRyaWVzOiA1MCwgbWF4QWdlU2Vjb25kczogNyAqIDI0ICogNjAgKiA2MCB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIC8vIENhY2hlIENPUlMgcHJveHkgcmVzcG9uc2VzIGZvciByZWNpcGUgcGFyc2luZyAoY2xpZW50LXNpZGUgZmFsbGJhY2spXG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXmh0dHBzOlxcL1xcL2FwaVxcLmFsbG9yaWdpbnNcXC53aW5cXC8uKi9pLFxuICAgICAgICAgICAgaGFuZGxlcjogJ05ldHdvcmtGaXJzdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2NvcnMtcHJveHktY2FjaGUnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDMwLCBtYXhBZ2VTZWNvbmRzOiA3ICogMjQgKiA2MCAqIDYwIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgLy8gQ2FjaGUgd2ViIGZvbnRzIGFuZCBTVkcgaWNvbnMgZnJvbSBDRE5zIHdpdGggbG9uZyBleHBpcnlcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9cXC4oPzp3b2ZmMj98dHRmfGVvdCkkL2ksXG4gICAgICAgICAgICBoYW5kbGVyOiAnU3RhbGVXaGlsZVJldmFsaWRhdGUnLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdmb250LWNhY2hlJyxcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjogeyBtYXhFbnRyaWVzOiAyMCwgbWF4QWdlU2Vjb25kczogMzY1ICogMjQgKiA2MCAqIDYwIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgLy8gQ2FjaGUgZ2VuZXJhbCBpbWFnZXMgKFBORywgSlBFRywgR0lGLCBXZWJQLCBBVklGKVxuICAgICAgICAgICAgdXJsUGF0dGVybjogL1xcLig/OnBuZ3xqcGd8anBlZ3xnaWZ8d2VicHxhdmlmKSQvaSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZ2VuZXJhbC1pbWFnZXMnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDIwMCwgbWF4QWdlU2Vjb25kczogMzAgKiAyNCAqIDYwICogNjAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBDYWNoZSBBUEkgY2FsbHMgd2l0aCBuZXR3b3JrLWZpcnN0IHN0cmF0ZWd5IGFuZCA1cyB0aW1lb3V0XG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAvXFwvYXBpXFwvLiovaSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdOZXR3b3JrRmlyc3QnLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICBjYWNoZU5hbWU6ICdhcGktY2FjaGUnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDUwLCBtYXhBZ2VTZWNvbmRzOiAyNCAqIDYwICogNjAgfSxcbiAgICAgICAgICAgICAgbmV0d29ya1RpbWVvdXRTZWNvbmRzOiA1LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KSxcbiAgXSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogJzAuMC4wLjAnLFxuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gICAgb3BlbjogZmFsc2UsXG4gICAgLy8gSE1SOiBhbGxvdyBjb25uZWN0aW9ucyBmcm9tIHJlbW90ZSBkZXZpY2VzIG9uIHRoZSBuZXR3b3JrXG4gICAgbWlkZGxld2FyZU1vZGU6IGZhbHNlLFxuICAgIGhtcjoge1xuICAgICAgaG9zdDogbG9jYWxJUCxcbiAgICAgIHByb3RvY29sOiAnd3MnLFxuICAgICAgcG9ydDogNTE3MyxcbiAgICB9LFxuICAgIC8vIFByb3h5IC9hcGkvKiB0byB0aGUgU3BpY2VIdWIgYnJvd3NlciBzZXJ2ZXIgKHNlcnZlci5qcyBvbiBwb3J0IDMwMDEpXG4gICAgLy8gT25seSB1c2VkIGluIGRldiB3aGVuIHNlcnZlciBpcyBydW5uaW5nXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzoge1xuICAgICAgICB0YXJnZXQ6IGBodHRwOi8vJHtsb2NhbElQfTozMDAxYCxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICAvLyBPcHRpb25hbDogc2VydmVyIG5vdCByZXF1aXJlZCBmb3IgYmFzaWMgZnVuY3Rpb25hbGl0eVxuICAgICAgICB3czogdHJ1ZSxcbiAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiAnZGlzdCcsXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBOFUsU0FBUyxvQkFBb0I7QUFDM1csT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQUN4QixPQUFPLFFBQVE7QUFDZixPQUFPLFFBQVE7QUFDZixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFOa0wsSUFBTSwyQ0FBMkM7QUFRalEsSUFBTSxZQUFZLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFHN0QsU0FBUyxhQUFhO0FBQ3BCLFFBQU0s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
