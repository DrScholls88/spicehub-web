# SpiceHub

**Offline-first meal planner, recipe manager, and Bar experience.**

SpiceHub is a production-grade Progressive Web App (PWA) + Capacitor hybrid.  
Snap a photo or paste an Instagram / TikTok / recipe link → AI turns messy captions into clean, structured recipes. Everything works offline.

**Core promise:** Near-zero manual correction after import.

---

## Features

- **Smart Import** — Instagram, TikTok, Pinterest, blogs, photos, PDFs, native share intents
- **Meal Planning** — Week view, random spin, manual override, special days
- **Recipe Library** — Search, edit, scale, share, photo gallery
- **Bar** — Cocktail inventory, shelf, fridge mode, mix mode
- **Pantry** — Ingredient catalog, proximity matching, grocery list with store assignment
- **Fully Offline** — All data lives in IndexedDB (Dexie). Optimistic updates + sync queue
- **Installable** — Android, iOS, and Windows (Add to Home Screen / PWA)

---

## Quick Start (Local Development)

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start Vite dev server
npm run dev

# Or run full stack (Vite + extraction server if present)
npm run dev:full
```

Open [http://localhost:5173](http://localhost:5173).

---

## Build & Deploy

```bash
npm run build
```

Output is in `dist/`. Deploy the static build to **Vercel**.

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_API_URL` | Client | Points to extraction server (if used) |
| `GEMINI_API_KEY` | Server only | Primary extraction model |
| `MISTRAL_API_KEY` | Server only | Fallback vision |
| `APIFY_API_TOKEN` | Server only | Instagram scraping (optional) |

Never put secrets in client code. All LLM / scraping calls must go through `/api/*` proxies.

---

## Project Structure (Key Files)

```
src/
├── App.jsx                 # Main router & state
├── db.js                   # Dexie schema + offline queue
├── recipeSchema.js         # Single source of truth for recipe shape
├── recipeParser.js         # Extraction brain
├── components/
│   ├── ImportSheet.jsx     # Import UI
│   ├── MealLibrary.jsx
│   ├── BarShelf.jsx
│   ├── PantryMode.jsx
│   └── WeekView.jsx
└── ...
```

**Constitution files (AI & developers):**
- `CLAUDE.md` — Always-on principles & workflow
- `design.md` — Theming, contrast, and UI rules (load for any visual work)

---

## Core Principles

1. **Extraction Excellence** — Social import is the product.
2. **Offline Sovereignty** — Fully usable with no network (except live LLM calls).
3. **Security-First** — Zero hardcoded secrets.

---

## Tech Stack

- React 19 + Vite 7
- Dexie (IndexedDB)
- Framer Motion
- Capacitor (hybrid packaging)
- Gemini (primary extraction) + Mistral fallback + Tesseract OCR
- Service Worker (PWA)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite development server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test` | Unit tests |
| `npm run test:corpus` | Import corpus tests |

---

## Notes

- All user data stays on-device. Cloud sync is a future (P6) feature.
- Use Backup / Restore in the Meal Library to move data between devices.
- For AI-assisted development, always start from `CLAUDE.md`.

---

**Owner:** Brian Goeke  
**Deployed at:** spicehub.vercel.app (or your Vercel URL)
```

---