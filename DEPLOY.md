# SpiceHub — Deployment Guide

## Architecture

SpiceHub is now split into two deployable pieces:

| Piece | What | Where | Purpose |
|-------|------|-------|---------|
| **PWA Client** | Static React app | Vercel (free) | The UI — meal planning, library, grocery list, bar |
| **Extraction Server** | Express + Puppeteer | Render (free) | Recipe import from URLs (Instagram, TikTok, blogs) |

The PWA stores all data locally on each device (IndexedDB via Dexie). The server is **only** needed for recipe URL imports — everything else works fully offline.

---

## Step 1: Deploy the Extraction Server (Render)

1. Push the `server/` folder to a GitHub repo (or include it in the same repo as the main app).

2. Go to [render.com](https://render.com) → **New** → **Web Service**.

3. Connect your repo and configure:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

4. Add these **Environment Variables** in the Render dashboard:
   - `SPICEHUB_MODE` = `cloud`
   - `NODE_ENV` = `production`
   - `ALLOWED_ORIGINS` = *(leave blank for now, fill in after Step 2)*

5. Deploy. Note your server URL — it'll be something like:
   ```
   https://spicehub-server.onrender.com
   ```

> **Note:** Render's free tier spins down after 15 min of inactivity. First recipe import after idle will take ~30-60 seconds while it wakes up. You can upgrade to the $7/mo plan to keep it always on.

---

## Step 2: Deploy the PWA (Vercel)

1. Push the root project to GitHub (the repo should contain `src/`, `public/`, `package.json`, `vercel.json`, etc.).

2. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo.

3. Vercel should auto-detect Vite. Verify these settings:
   - **Framework**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install --legacy-peer-deps`

4. Add this **Environment Variable**:
   - `VITE_API_URL` = `https://spicehub-server.onrender.com`
     *(use whatever URL you got from Step 1)*

5. Deploy. Your app will be at something like:
   ```
   https://spicehub-web.vercel.app
   ```

6. **Go back to Render** and set the `ALLOWED_ORIGINS` env var to your Vercel URL:
   ```
   https://spicehub-web.vercel.app
   ```

---

## Step 3: Install as PWA

Once deployed, visit your Vercel URL on any device:

- **Android (Chrome)**: Tap the 3-dot menu → "Add to Home Screen" or "Install App"
- **iOS (Safari)**: Tap Share → "Add to Home Screen"
- **Desktop (Chrome/Edge)**: Click the install icon in the address bar

---

## Local Development

Everything still works the same locally:

```bash
# Install deps (use --legacy-peer-deps for vite-plugin-pwa)
npm install --legacy-peer-deps

# Run both Vite dev server + extraction server
npm run dev:full

# Or run them separately:
npm run dev          # Vite on :5173
npm run dev:server   # Server on :3001
```

The server folder has its own `package.json` for cloud deployment. For local dev, you still install from the root and run `server/index.js` directly.

---

## Repo Structure

```
spicehub-web/
├── public/              # Static assets (icons, manifest)
├── server/
│   ├── index.js         # Express + Puppeteer extraction server
│   ├── package.json     # Server-only deps (for Render)
│   └── render.yaml      # Render deployment blueprint
├── src/
│   ├── components/      # React components
│   ├── api.js           # API client (uses VITE_API_URL)
│   ├── db.js            # Dexie (IndexedDB) schema
│   └── ...
├── .env                 # Local dev env vars
├── .env.production      # Production env vars
├── package.json         # Client deps + dev scripts
├── vercel.json          # Vercel deployment config
└── vite.config.js       # Vite + PWA config
```

---

## Troubleshooting

**Recipe import not working after deploy?**
- Check that `VITE_API_URL` is set correctly in Vercel
- Check that `ALLOWED_ORIGINS` in Render matches your Vercel URL exactly
- Render free tier may be asleep — wait 30-60 seconds and retry

**PWA not installable?**
- Make sure you're visiting via HTTPS (Vercel provides this automatically)
- Check that manifest.json is being served (visit `https://your-app.vercel.app/manifest.json`)

**Data lost between devices?**
- This is expected — each device has its own local IndexedDB. Cloud sync is a future feature.
- Use the Backup/Restore feature in the Meal Library to transfer data between devices.

---

## Quick CLI Deploy

If you just want to deploy fast:

```bash
cd spicehub-web
npm run build
npx vercel --prod
```

Vercel will prompt you to log in on first run and auto-detect the Vite config.

---

## Build Android APK (Flutter)

### Prerequisites
- Flutter SDK installed
- Android SDK + Build Tools
- Java 17+

### Steps
```bash
cd spicehub_meal_spinner   # Flutter project root
flutter pub get
flutter build apk --release
```

APK output: `build/app/outputs/flutter-apk/app-release.apk`

### For Play Store (App Bundle)
```bash
flutter build appbundle --release
```

Output: `build/app/outputs/bundle/release/app-release.aab`

---

## iOS Submission (Requires Mac)

```bash
flutter build ios --release
```
Then open `ios/Runner.xcworkspace` in Xcode to archive and submit.

---

## Pre-Launch Checklist

### Security
- [x] No API keys in client code (all data is local IndexedDB)
- [x] All external links use `rel="noopener noreferrer"`
- [x] Service worker scoped correctly (Vite PWA plugin)
- [ ] Content Security Policy headers (add to vercel.json)
- [ ] Rate limit extraction server endpoints

### Performance
- [x] Bundle size ~310KB gzipped (within target)
- [x] PWA caching with service worker
- [ ] Lazy load heavy components (xlsx import)
- [ ] Image compression/CDN for recipe images
- [ ] Remove console.log statements for production

### App Store Submission
- [ ] App icon (1024x1024 for iOS, 512x512 for Play Store)
- [ ] Screenshots for all device sizes
- [ ] Privacy policy URL
- [ ] App description and keywords
- [ ] Test on physical devices (iPhone, Android)
