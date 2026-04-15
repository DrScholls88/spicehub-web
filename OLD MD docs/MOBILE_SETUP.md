# SpiceHub Mobile Testing Guide

## Quick Start — Desktop to Phone

### Prerequisites
- PC and phone on the **same WiFi network**
- Both have internet access
- Phone can reach PC's local IP

### Setup Steps

#### 1. Install `vite-plugin-pwa`
```bash
npm install vite-plugin-pwa --save-dev
```

#### 2. Start the dev servers
```bash
npm run dev:full
```

This runs:
- Vite dev server on port **5173** (auto-detects your PC's local IP)
- SpiceHub browser server on port **3001**

#### 3. Find your PC's local IP
On Windows, open Command Prompt and run:
```bash
ipconfig
```

Look for the WiFi adapter's IPv4 address, e.g. `192.168.1.100` or `192.168.4.186`

#### 4. Open on your phone
In Chrome or Safari on your phone, visit:
```
http://192.168.X.X:5173
```
(replace with your actual local IP)

#### 5. Install as PWA
- **Android (Chrome)**: Tap the three-dot menu → "Install app" (or wait for the banner)
- **iOS (Safari)**: Tap Share → "Add to Home Screen"

The app now runs offline with full native feel!

---

## Features on Mobile

✅ **All core features work:**
- Meal spinner (generate random 5-day plan)
- Meal library (search, view, share)
- Grocery list (checkbox, store selection)
- Backup/Restore (export/import JSON via share sheet)

⚠️ **Browser import (Instagram/TikTok) doesn't work on mobile** — this requires Chrome automation which is desktop-only. On mobile, fall back to:
1. Open the recipe post in your Instagram/TikTok app
2. Tap Share → SpiceHub (if installed as PWA)
3. Paste the caption in the "Paste Caption" tab

---

## Troubleshooting

### "Can't reach the page"
- Make sure both devices are on the **same WiFi**
- Try pinging your PC from the phone: `ping 192.168.X.X`
- Check if port 5173 is open (shouldn't need special firewall settings for local networks)

### "Blank white screen"
- Open phone's browser DevTools (Chrome: `chrome://inspect`)
- Check Console tab for errors
- Try hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows/Android)

### "API calls failing (Can't reach server.js)"
- The vite.config.js auto-detects your PC's IP
- If it picks the wrong IP, manually set `hmr.host` and `proxy` target in vite.config.js

### "Service worker not working"
- PWA features only work over HTTPS on public internet
- On local network, they work over HTTP
- If stuck, clear site data: Chrome Settings → Apps → SpiceHub → Clear Data

---

## Production Deployment (Future)

When ready to deploy online:
1. Build: `npm run build`
2. Host on Vercel, Netlify, or your server
3. Update `manifest.json` start_url to your domain
4. For Instagram browser import, deploy `server.js` on a backend (Render, Railway, Heroku free tier)

For now, local testing is perfect! 🚀
