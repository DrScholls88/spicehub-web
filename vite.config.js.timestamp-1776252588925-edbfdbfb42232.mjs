// vite.config.js
import { defineConfig } from "file:///sessions/affectionate-confident-euler/mnt/spicehub-web/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/affectionate-confident-euler/mnt/spicehub-web/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/affectionate-confident-euler/mnt/spicehub-web/node_modules/vite-plugin-pwa/dist/index.js";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __vite_injected_original_import_meta_url = "file:///sessions/affectionate-confident-euler/mnt/spicehub-web/vite.config.js";
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
      // keep your custom /public/manifest.json
      strategies: "injectManifest",
      swSrc: "public/sw.js",
      swDest: "dist/sw.js",
      // ← Changed: output to dist/ so Vercel serves it correctly
      injectManifest: {
        // Minimal & safe for Vite 7
        injectionPoint: "self.__WB_MANIFEST"
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,webp}"],
        cleanupOutdatedCaches: true,
        // Clears old broken caches after deploy
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
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
    },
    "/media-proxy": {
      // New proxy for images
      ttarget: "https://dummy.invalid",
      // dummy - we override in configure
      changeOrigin: true,
      secure: true,
      configure: (proxy, _options) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          const fullUrl = decodeURIComponent(req.url.replace(/^\/media-proxy\//, ""));
          if (!fullUrl.startsWith("http")) {
            proxyReq.destroy();
            return;
          }
          const url = new URL(fullUrl);
          proxyReq.setHeader("host", url.host);
          proxyReq.path = url.pathname + url.search;
          proxyReq.setHeader("Referer", "https://www.instagram.com/");
          proxyReq.setHeader("User-Agent", "SpiceHub-App/1.0 (+https://spicehub-web.vercel.app)");
          proxyReq.setHeader("Accept", "image/*");
        });
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2019",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]"
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYWZmZWN0aW9uYXRlLWNvbmZpZGVudC1ldWxlci9tbnQvc3BpY2VodWItd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvYWZmZWN0aW9uYXRlLWNvbmZpZGVudC1ldWxlci9tbnQvc3BpY2VodWItd2ViL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9hZmZlY3Rpb25hdGUtY29uZmlkZW50LWV1bGVyL21udC9zcGljZWh1Yi13ZWIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcbmltcG9ydCBvcyBmcm9tICdvcydcbmltcG9ydCBmcyBmcm9tICdmcydcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAndXJsJ1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKVxuXG4vLyBBdXRvLWRldGVjdCBsb2NhbCBJUCBmb3IgSE1SIG9uIHJlbW90ZSBkZXZpY2VzIChkZXYgb25seSlcbmZ1bmN0aW9uIGdldExvY2FsSVAoKSB7XG4gIGNvbnN0IGludGVyZmFjZXMgPSBvcy5uZXR3b3JrSW50ZXJmYWNlcygpO1xuICBmb3IgKGNvbnN0IG5hbWUgaW4gaW50ZXJmYWNlcykge1xuICAgIGZvciAoY29uc3QgaWZhY2Ugb2YgaW50ZXJmYWNlc1tuYW1lXSkge1xuICAgICAgLy8gU2tpcCBpbnRlcm5hbCBhbmQgbm9uLUlQdjQgYWRkcmVzc2VzXG4gICAgICBpZiAoaWZhY2UuZmFtaWx5ID09PSAnSVB2NCcgJiYgIWlmYWNlLmludGVybmFsKSB7XG4gICAgICAgIC8vIFByZWZlciBXaUZpIG9yIGV0aGVybmV0ICgxMC54LCAxOTIuMTY4LngsIDE3Mi4xNi0zMS54KVxuICAgICAgICBpZiAoaWZhY2UuYWRkcmVzcy5zdGFydHNXaXRoKCcxOTIuMTY4JykgfHwgaWZhY2UuYWRkcmVzcy5zdGFydHNXaXRoKCcxMC4nKSB8fCBpZmFjZS5hZGRyZXNzLnN0YXJ0c1dpdGgoJzE3Mi4nKSkge1xuICAgICAgICAgIHJldHVybiBpZmFjZS5hZGRyZXNzO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiAnbG9jYWxob3N0Jztcbn1cblxuY29uc3QgbG9jYWxJUCA9IGdldExvY2FsSVAoKTtcblxuLy8gXHUyNTAwXHUyNTAwIEJ1aWxkIG51bWJlcmluZyBzeXN0ZW0gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBBdXRvLWluY3JlbWVudHMgYSBidWlsZCBjb3VudGVyIHN0b3JlZCBpbiBidWlsZE51bWJlci5qc29uIG9uIGVhY2ggYHZpdGUgYnVpbGRgLlxuLy8gSW4gZGV2IG1vZGUsIHJlYWRzIGN1cnJlbnQgbnVtYmVyIHdpdGhvdXQgaW5jcmVtZW50aW5nLlxuY29uc3QgYnVpbGROdW1QYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ2J1aWxkTnVtYmVyLmpzb24nKTtcbmxldCBidWlsZE51bSA9IDA7XG50cnkge1xuICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoYnVpbGROdW1QYXRoLCAndXRmOCcpKTtcbiAgYnVpbGROdW0gPSBkYXRhLmJ1aWxkIHx8IDA7XG59IGNhdGNoIHsgLyogZmlyc3QgcnVuICovIH1cbmNvbnN0IGlzUHJvZHVjdGlvbiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAncHJvZHVjdGlvbicgfHwgcHJvY2Vzcy5hcmd2LmluY2x1ZGVzKCdidWlsZCcpO1xuaWYgKGlzUHJvZHVjdGlvbikge1xuICBidWlsZE51bSsrO1xuICBmcy53cml0ZUZpbGVTeW5jKGJ1aWxkTnVtUGF0aCwgSlNPTi5zdHJpbmdpZnkoeyBidWlsZDogYnVpbGROdW0gfSwgbnVsbCwgMikpO1xufVxuY29uc3QgQlVJTERfVkVSU0lPTiA9IGAxLjAuJHtidWlsZE51bX1gO1xuY29uc29sZS5sb2coYFxcbiAgU3BpY2VIdWIgQnVpbGQgIyR7YnVpbGROdW19ICAodiR7QlVJTERfVkVSU0lPTn0pXFxuYCk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGRlZmluZToge1xuICAgICdfX1NQSUNFSFVCX0JVSUxEX18nOiBKU09OLnN0cmluZ2lmeShidWlsZE51bSksXG4gICAgJ19fU1BJQ0VIVUJfVkVSU0lPTl9fJzogSlNPTi5zdHJpbmdpZnkoQlVJTERfVkVSU0lPTiksXG4gICAgJ19fU1BJQ0VIVUJfU0VSVkVSX18nOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5WSVRFX1NFUlZFUl9VUkwgfHwgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMScpLFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcblZpdGVQV0Eoe1xuICAgICAgcmVnaXN0ZXJUeXBlOiAnYXV0b1VwZGF0ZScsXG4gICAgICBpbmNsdWRlQXNzZXRzOiBbJ2ljb24tMTkyLnN2ZycsICdpY29uLTUxMi5zdmcnLCAnaWNvbi1tYXNrYWJsZS5zdmcnXSxcbiAgICAgIG1hbmlmZXN0OiBmYWxzZSwgLy8ga2VlcCB5b3VyIGN1c3RvbSAvcHVibGljL21hbmlmZXN0Lmpzb25cbiAgICAgIHN0cmF0ZWdpZXM6ICdpbmplY3RNYW5pZmVzdCcsXG4gICAgICBzd1NyYzogJ3B1YmxpYy9zdy5qcycsXG4gICAgICBzd0Rlc3Q6ICdkaXN0L3N3LmpzJywgICAgICAgICAgIC8vIFx1MjE5MCBDaGFuZ2VkOiBvdXRwdXQgdG8gZGlzdC8gc28gVmVyY2VsIHNlcnZlcyBpdCBjb3JyZWN0bHlcbiAgICAgIGluamVjdE1hbmlmZXN0OiB7XG4gICAgICAgIC8vIE1pbmltYWwgJiBzYWZlIGZvciBWaXRlIDdcbiAgICAgICAgaW5qZWN0aW9uUG9pbnQ6ICdzZWxmLl9fV0JfTUFOSUZFU1QnLFxuICAgICAgfSxcbiAgICAgIHdvcmtib3g6IHtcbiAgICAgICAgZ2xvYlBhdHRlcm5zOiBbJyoqLyoue2pzLGNzcyxodG1sLGljbyxwbmcsc3ZnLGpwZyx3ZWJwfSddLFxuICAgICAgICBjbGVhbnVwT3V0ZGF0ZWRDYWNoZXM6IHRydWUsICAgIC8vIENsZWFycyBvbGQgYnJva2VuIGNhY2hlcyBhZnRlciBkZXBsb3lcbiAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDUgKiAxMDI0ICogMTAyNCxcbiAgICAgIH0sXG4gICAgfSksXG4gIF0sXG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6ICcwLjAuMC4wJyxcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIG9wZW46IGZhbHNlLFxuICAgIC8vIEhNUjogYWxsb3cgY29ubmVjdGlvbnMgZnJvbSByZW1vdGUgZGV2aWNlcyBvbiB0aGUgbmV0d29ya1xuICAgIG1pZGRsZXdhcmVNb2RlOiBmYWxzZSxcbiAgICBobXI6IHtcbiAgICAgIGhvc3Q6IGxvY2FsSVAsXG4gICAgICBwcm90b2NvbDogJ3dzJyxcbiAgICAgIHBvcnQ6IDUxNzMsXG4gICAgfSxcbiAgICAvLyBQcm94eSAvYXBpLyogdG8gdGhlIFNwaWNlSHViIGJyb3dzZXIgc2VydmVyIChzZXJ2ZXIuanMgb24gcG9ydCAzMDAxKVxuICAgIC8vIE9ubHkgdXNlZCBpbiBkZXYgd2hlbiBzZXJ2ZXIgaXMgcnVubmluZ1xuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiBgaHR0cDovLyR7bG9jYWxJUH06MzAwMWAsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgLy8gT3B0aW9uYWw6IHNlcnZlciBub3QgcmVxdWlyZWQgZm9yIGJhc2ljIGZ1bmN0aW9uYWxpdHlcbiAgICAgICAgd3M6IHRydWUsXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLFxuICAgICAgfSxcbiAgICB9LFxuICAgICcvbWVkaWEtcHJveHknOiB7ICAgLy8gTmV3IHByb3h5IGZvciBpbWFnZXNcbiAgICB0dGFyZ2V0OiAnaHR0cHM6Ly9kdW1teS5pbnZhbGlkJywgIC8vIGR1bW15IC0gd2Ugb3ZlcnJpZGUgaW4gY29uZmlndXJlXG4gICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgIHNlY3VyZTogdHJ1ZSxcbiAgICBjb25maWd1cmU6IChwcm94eSwgX29wdGlvbnMpID0+IHtcbiAgICAgIHByb3h5Lm9uKCdwcm94eVJlcScsIChwcm94eVJlcSwgcmVxKSA9PiB7XG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIHJlYWwgdGFyZ2V0IFVSTCBmcm9tIHRoZSBwYXRoXG4gICAgICAgIGNvbnN0IGZ1bGxVcmwgPSBkZWNvZGVVUklDb21wb25lbnQocmVxLnVybC5yZXBsYWNlKC9eXFwvbWVkaWEtcHJveHlcXC8vLCAnJykpO1xuICAgICAgICBpZiAoIWZ1bGxVcmwuc3RhcnRzV2l0aCgnaHR0cCcpKSB7XG4gICAgICAgICAgcHJveHlSZXEuZGVzdHJveSgpOyAvLyBpbnZhbGlkXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4vLyBSZS10YXJnZXQgZHluYW1pY2FsbHlcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChmdWxsVXJsKTtcbiAgICAgICAgcHJveHlSZXEuc2V0SGVhZGVyKCdob3N0JywgdXJsLmhvc3QpO1xuICAgICAgICBwcm94eVJlcS5wYXRoID0gdXJsLnBhdGhuYW1lICsgdXJsLnNlYXJjaDtcbiAgICAgICAgLy8gQW50aS1ibG9jayBoZWFkZXJzIChJbnN0YWdyYW0gY2hlY2tzIHRoZXNlKVxuICAgICAgICBwcm94eVJlcS5zZXRIZWFkZXIoJ1JlZmVyZXInLCAnaHR0cHM6Ly93d3cuaW5zdGFncmFtLmNvbS8nKTtcbiAgICAgICAgcHJveHlSZXEuc2V0SGVhZGVyKCdVc2VyLUFnZW50JywgJ1NwaWNlSHViLUFwcC8xLjAgKCtodHRwczovL3NwaWNlaHViLXdlYi52ZXJjZWwuYXBwKScpO1xuICAgICAgICBwcm94eVJlcS5zZXRIZWFkZXIoJ0FjY2VwdCcsICdpbWFnZS8qJyk7XG4gICAgICB9KTtcbiAgICB9LFxuICB9LFxufSxcbmJ1aWxkOiB7XG4gICAgb3V0RGlyOiAnZGlzdCcsXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICAgIHRhcmdldDogJ2VzMjAxOScsXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiA4MDAsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxuICAgICAgICBjaHVua0ZpbGVOYW1lczogJ2Fzc2V0cy9bbmFtZV0tW2hhc2hdLmpzJyxcbiAgICAgICAgYXNzZXRGaWxlTmFtZXM6ICdhc3NldHMvW25hbWVdLVtoYXNoXS5bZXh0XSdcbiAgICB9XG4gIH1cbiAgfSxcbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXVWLFNBQVMsb0JBQW9CO0FBQ3BYLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFDeEIsT0FBTyxRQUFRO0FBQ2YsT0FBTyxRQUFRO0FBQ2YsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBTndMLElBQU0sMkNBQTJDO0FBUXZRLElBQU0sWUFBWSxLQUFLLFFBQVEsY0FBYyx3Q0FBZSxDQUFDO0FBRzdELFNBQVMsYUFBYTtBQUNwQixRQUFNLGFBQWEsR0FBRyxrQkFBa0I7QUFDeEMsYUFBVyxRQUFRLFlBQVk7QUFDN0IsZUFBVyxTQUFTLFdBQVcsSUFBSSxHQUFHO0FBRXBDLFVBQUksTUFBTSxXQUFXLFVBQVUsQ0FBQyxNQUFNLFVBQVU7QUFFOUMsWUFBSSxNQUFNLFFBQVEsV0FBVyxTQUFTLEtBQUssTUFBTSxRQUFRLFdBQVcsS0FBSyxLQUFLLE1BQU0sUUFBUSxXQUFXLE1BQU0sR0FBRztBQUM5RyxpQkFBTyxNQUFNO0FBQUEsUUFDZjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLElBQU0sVUFBVSxXQUFXO0FBSzNCLElBQU0sZUFBZSxLQUFLLFFBQVEsV0FBVyxrQkFBa0I7QUFDL0QsSUFBSSxXQUFXO0FBQ2YsSUFBSTtBQUNGLFFBQU0sT0FBTyxLQUFLLE1BQU0sR0FBRyxhQUFhLGNBQWMsTUFBTSxDQUFDO0FBQzdELGFBQVcsS0FBSyxTQUFTO0FBQzNCLFFBQVE7QUFBa0I7QUFDMUIsSUFBTSxlQUFlLFFBQVEsSUFBSSxhQUFhLGdCQUFnQixRQUFRLEtBQUssU0FBUyxPQUFPO0FBQzNGLElBQUksY0FBYztBQUNoQjtBQUNBLEtBQUcsY0FBYyxjQUFjLEtBQUssVUFBVSxFQUFFLE9BQU8sU0FBUyxHQUFHLE1BQU0sQ0FBQyxDQUFDO0FBQzdFO0FBQ0EsSUFBTSxnQkFBZ0IsT0FBTyxRQUFRO0FBQ3JDLFFBQVEsSUFBSTtBQUFBLG9CQUF1QixRQUFRLE9BQU8sYUFBYTtBQUFBLENBQUs7QUFFcEUsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsUUFBUTtBQUFBLElBQ04sc0JBQXNCLEtBQUssVUFBVSxRQUFRO0FBQUEsSUFDN0Msd0JBQXdCLEtBQUssVUFBVSxhQUFhO0FBQUEsSUFDcEQsdUJBQXVCLEtBQUssVUFBVSxRQUFRLElBQUksbUJBQW1CLHVCQUF1QjtBQUFBLEVBQzlGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDVixRQUFRO0FBQUEsTUFDRixjQUFjO0FBQUEsTUFDZCxlQUFlLENBQUMsZ0JBQWdCLGdCQUFnQixtQkFBbUI7QUFBQSxNQUNuRSxVQUFVO0FBQUE7QUFBQSxNQUNWLFlBQVk7QUFBQSxNQUNaLE9BQU87QUFBQSxNQUNQLFFBQVE7QUFBQTtBQUFBLE1BQ1IsZ0JBQWdCO0FBQUE7QUFBQSxRQUVkLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsTUFDQSxTQUFTO0FBQUEsUUFDUCxjQUFjLENBQUMseUNBQXlDO0FBQUEsUUFDeEQsdUJBQXVCO0FBQUE7QUFBQSxRQUN2QiwrQkFBK0IsSUFBSSxPQUFPO0FBQUEsTUFDNUM7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUE7QUFBQSxJQUVOLGdCQUFnQjtBQUFBLElBQ2hCLEtBQUs7QUFBQSxNQUNILE1BQU07QUFBQSxNQUNOLFVBQVU7QUFBQSxNQUNWLE1BQU07QUFBQSxJQUNSO0FBQUE7QUFBQTtBQUFBLElBR0EsT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUSxVQUFVLE9BQU87QUFBQSxRQUN6QixjQUFjO0FBQUE7QUFBQSxRQUVkLElBQUk7QUFBQSxRQUNKLFNBQVMsQ0FBQ0EsVUFBU0E7QUFBQSxNQUNyQjtBQUFBLElBQ0Y7QUFBQSxJQUNBLGdCQUFnQjtBQUFBO0FBQUEsTUFDaEIsU0FBUztBQUFBO0FBQUEsTUFDVCxjQUFjO0FBQUEsTUFDZCxRQUFRO0FBQUEsTUFDUixXQUFXLENBQUMsT0FBTyxhQUFhO0FBQzlCLGNBQU0sR0FBRyxZQUFZLENBQUMsVUFBVSxRQUFRO0FBRXRDLGdCQUFNLFVBQVUsbUJBQW1CLElBQUksSUFBSSxRQUFRLG9CQUFvQixFQUFFLENBQUM7QUFDMUUsY0FBSSxDQUFDLFFBQVEsV0FBVyxNQUFNLEdBQUc7QUFDL0IscUJBQVMsUUFBUTtBQUNqQjtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxNQUFNLElBQUksSUFBSSxPQUFPO0FBQzNCLG1CQUFTLFVBQVUsUUFBUSxJQUFJLElBQUk7QUFDbkMsbUJBQVMsT0FBTyxJQUFJLFdBQVcsSUFBSTtBQUVuQyxtQkFBUyxVQUFVLFdBQVcsNEJBQTRCO0FBQzFELG1CQUFTLFVBQVUsY0FBYyxxREFBcUQ7QUFDdEYsbUJBQVMsVUFBVSxVQUFVLFNBQVM7QUFBQSxRQUN4QyxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDSCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsSUFDWCxRQUFRO0FBQUEsSUFDUix1QkFBdUI7QUFBQSxJQUN2QixlQUFlO0FBQUEsTUFDYixRQUFRO0FBQUEsUUFDTixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0I7QUFBQSxNQUNwQjtBQUFBLElBQ0Y7QUFBQSxFQUNBO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsicGF0aCJdCn0K
