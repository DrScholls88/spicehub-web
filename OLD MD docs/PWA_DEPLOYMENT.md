# SpiceHub PWA Deployment Guide

## Overview

SpiceHub is now a **fully standalone Progressive Web App (PWA)** that works completely offline. The Express server (`server.js`) is now **optional** and only needed for advanced recipe extraction from social media URLs.

### Core Features (No Server Required)
- ✅ View/add/edit meal recipes
- ✅ Create and manage drink recipes  
- ✅ Generate weekly meal plans
- ✅ Build and manage grocery lists
- ✅ Import recipes from recipe blogs (via CORS proxy)
- ✅ Import from spreadsheets (CSV/Excel)
- ✅ Import from Paprika 3 exports
- ✅ Full offline functionality with IndexedDB persistence

### Advanced Features (Server Optional)
- 🔗 Advanced social media recipe extraction (Instagram, TikTok, Pinterest, Facebook)
  - Requires running the Express server for headless browser automation
  - Can still use CORS proxy fallback with limited success

## Deployment Options

### Option 1: Vercel (Recommended - Zero Configuration)

```bash
# Vercel will auto-detect and use vercel.json
npm run build
npx vercel --prod
```

**Features:**
- Edge caching for fast global delivery
- Automatic HTTPS
- Service worker support
- Zero cold starts
- Free tier includes unlimited deployments

### Option 2: Netlify (Simple, Git-based)

```bash
# Connect your repo on netlify.com, or use CLI:
npm run build
npm install -g netlify-cli
netlify deploy --prod --dir dist
```

**Features:**
- Git-based auto-deployments
- Built-in CDN
- Serverless functions support (for future server integration)
- Free tier with generous limits

### Option 3: GitHub Pages (Free Static Hosting)

```bash
# Build the app
npm run build

# Deploy to GitHub Pages
git add dist/
git commit -m "Deploy to GitHub Pages"
git push origin main

# In GitHub: Settings → Pages → Source: Deploy from branch (main/dist)
```

Note: This requires `"homepage": "https://yourusername.github.io/spicehub"` in package.json

### Option 4: Self-Hosted (Docker/VPS)

```bash
# Build production bundle
npm run build

# Option 4a: Docker
docker build -t spicehub .
docker run -p 80:3000 spicehub

# Option 4b: Simple HTTP server
npx serve -s dist -p 3000
```

## Development

### Without Server (Basic Recipe Import)
```bash
npm run dev
# Visit http://localhost:5173
# All features work except advanced social media extraction
```

### With Server (Full Features)
```bash
npm run dev:full
# Runs both frontend (5173) and backend (3001)
# Advanced social media extraction available
```

## Key Files Changed

### 1. `/src/api.js`
- Added `extractUrl()` fallback to client-side parsing when server unavailable
- Automatic server availability detection with 30-second cache

### 2. `/src/recipeParser.js`
- Already supported CORS proxy fallback for recipe extraction
- Handles JSON-LD, OpenGraph meta tags, and heuristic parsing

### 3. `/src/db.js`
- Version 3 schema added: `storeMemory` table for persisting ingredient→store mappings
- Helper functions: `getStoreMemory()`, `saveStoreMemory()`

### 4. `/src/components/GroceryList.jsx`
- Now persists store memory to IndexedDB instead of localStorage
- Maintains in-memory cache for instant UI updates

### 5. `/vite.config.js`
- Proxy is optional (dev-only)
- Added CORS proxy caching in Workbox
- Service worker configuration for offline support

### 6. `/public/manifest.json`
- Enhanced with PWA shortcuts for quick actions
- Added offline-first description

### 7. `/vercel.json` (New)
- Rewrites all routes to `/index.html` for SPA routing
- Cache headers for service worker and assets

### 8. `/netlify.toml` (New)
- Equivalent configuration for Netlify deployment

## Architecture

```
┌─────────────────────────────────────────┐
│        SpiceHub React App (5173)        │
├─────────────────────────────────────────┤
│         IndexedDB (Offline Storage)     │
│  • Meals  • Drinks  • Store Memory      │
├─────────────────────────────────────────┤
│          Fallback: CORS Proxy           │
│  (api.allorigins.win for recipe HTML)  │
├─────────────────────────────────────────┤
│   Optional: Express Server (3001)       │
│   (Headless Chrome for social media)    │
└─────────────────────────────────────────┘
```

## Migration from localStorage to IndexedDB

The app now stores ingredient-to-store mappings in IndexedDB instead of localStorage:

**Old (localStorage):**
```javascript
localStorage.setItem('spicehub_store_memory', JSON.stringify(memory));
```

**New (IndexedDB via Dexie):**
```javascript
await saveStoreMemory(ingredientName, storeId);
```

This provides:
- Larger storage quota (50MB+ vs 5-10MB)
- Automatic persistence across sessions
- Better performance for large data sets
- No manual serialization needed

## Environment Variables

### Production
No environment variables needed! The app auto-detects server availability.

### Development
Optional:
```bash
VITE_API_URL=http://localhost:3001  # For custom server URL
```

## Performance Optimization

### Caching Strategy (Workbox)
```
Static Assets (JS/CSS):   Cache-first, 1-year TTL
Recipe Images:            Cache-first, 30-day TTL
CORS Proxy Results:       Network-first, 7-day TTL
Service Worker:           Network-first, no cache
```

### Bundle Size
- Core app: ~150KB (gzipped)
- All dependencies: ~800KB total
- Lazy-loaded modules: Additional on-demand

## Monitoring & Debugging

### Check Server Availability
```javascript
import { isServerAvailable } from './api.js';
const available = await isServerAvailable();
console.log('Server available:', available);
```

### View IndexedDB Data
Browser DevTools → Application → IndexedDB → SpiceHubDB

### Check Service Worker
Browser DevTools → Application → Service Workers

## Troubleshooting

### Recipes not saving offline?
- Check IndexedDB in DevTools
- Ensure localStorage quotas not exceeded
- Try clearing IndexedDB and reloading

### Images not loading on social media URLs?
- Server may be required for some platforms (Instagram, private TikToks)
- CORS proxy fallback may fail for protected pages
- Copy recipe details manually as fallback

### App not updating after deployment?
- Service worker caches aggressively
- Force reload: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
- Or visit URL with `?v=timestamp` parameter

## Future Enhancements

1. **Backend Server Integration**
   - Sync recipes across devices
   - Cloud backup/restore
   - Family sharing

2. **Advanced Features**
   - Meal prep scheduling
   - Nutrition tracking
   - Recipe scaling

3. **Progressive Enhancement**
   - Real-time collaborative planning
   - Voice commands
   - AI recipe suggestions

## Support & Issues

Report issues at: [GitHub Issues](https://github.com/your-repo/spicehub/issues)

Questions? Check the main README or start an Issue discussion.
