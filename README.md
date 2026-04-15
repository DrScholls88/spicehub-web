# SpiceHub Meal Spinner

A cross-platform PWA meal planner inspired by Paprika 3, built with React + Vite + IndexedDB.

## Run locally
```
cd spicehub-web
npm install     # only needed once
npm run dev
```
Then open: http://localhost:5173

## Build for production (deploy anywhere)
```
npm run build
# Output goes to dist/ — upload to Netlify, Vercel, GitHub Pages, etc.
```

## Features
- 🎲 Generate a random 5-meal week plan (Mon–Fri)
- 🔄 Re-spin individual days without repeating other picks
- ✏️ Manually pick any meal for any day via dropdown
- 📚 Meal Library with search, add, edit, delete, share
- 📥 Import recipes from: URL (any blog), Instagram/TikTok captions, CSV/Excel spreadsheet
- 🛒 Auto-build grocery list from weekly meals, with store assignment & checkboxes
- 📤 Share recipes via Web Share API (mobile) or clipboard copy
- 💾 All data stored in browser IndexedDB — works offline
- 📱 PWA installable on iOS, Android, Windows (Add to Home Screen)

## Spreadsheet Import Format (CSV)
Columns: `Name | Ingredients (;-separated) | Directions (;-separated) | Link | Image URL`

## Tech Stack
- React 19 + Vite 7
- Dexie.js (IndexedDB wrapper)
- xlsx (Excel import)
- No backend required — fully client-side
