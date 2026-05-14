# SpiceHub UI/UX Enhancement Roadmap 2026

**Priority:** High  
**Role:** Senior Product Developer (Cross-platform: Windows, iOS, Android – PWA + Capacitor)  
**Goal:** Maximum usability, simplicity, interactivity + delightful mini-game feel in Bar area  
**Core Principle:** Every change must feel invisible until it delights. Leverage existing architecture (`BarShelf.jsx`, `StorageManager.jsx`, `SyncQueue.jsx`, `SafeMediaImage.jsx`, etc.).

---

## 📋 All Screens (Global / Cross-Cutting Features)

* **Multi-User Sync** – Household Account sharing (one person spins the week → instantly updates partner’s phone)
* **Smart Quantity Aggregation** – Auto-sum ingredients in Grocery List (e.g. three “2 cloves garlic” → “6 cloves garlic”)
* **Unit Normalization + Global Toggle** – Settings → Metric/Imperial auto-conversion everywhere
* **Install Banner Fix** – Remove persistent “Add to home screen” banner from every tab. Replace with single dismissible toast in ⚙️ Settings
* **Thumbnail Optimization** – Lazy-load high-res source images (Instagram/YouTube) instead of generic magnifying glass
* **Haptic “Spin” Feedback** – Vibration on Spin the Week + extend to Bar actions
* **Visual Color-Coding** – Recipe cards tinted by category (Green=Vegan, Red=Meats, Yellow=Breakfast)
* **Native Video Picture-in-Picture** – Built-in player for YouTube/Instagram recipes
* **Search-to-Action Flow** – Negative filtering (`-tofu`) in any library search bar
* **Interactive Rescheduling** – Drag meal blocks in WeekView (extendable to future Bar plans)

---

## 🔄 ImportModal.jsx – UX Polish (Tiny, Dead-Simple Wins)

**Task List**

1. **Auto-focus recipe title on preview mount**  
   Add `autoFocus` to the title `<input>`. User lands in preview → keyboard is immediately ready.

2. **Rename footer button to “Save to Library”**  
   Change from “Add 1 Recipe” (or dynamic count) → **“Save to Library”**.  
   Header already shows “Preview — X recipes found”, making the old label redundant.

3. **Strip promo / social noise from unsorted pile**  
   Add `cleanSocialCaption()` pre-pass in the import pipeline (`recipeParser.js` / `importWorker.js` / `BrowserAssist.jsx`).  
   Remove lines containing: “Use code X”, “link in bio”, “save this post”, “follow for more”, etc.

4. **Fix final "Add Recipe" button placement on mobile**  
   Button is still getting cut off / off-screen on smaller devices. Ensure proper safe-area + bottom spacing.

5. **Fix Instagram Image grab**  
   Instagram primary image extraction is still broken in the import flow. Prioritize `og:image`, `instagram.com` meta, or fallback carousel first image.

---

## ⚙️ Settings

- Metric/Imperial toggle
- Chiptune on/off
- PWA install prompt control
- Household / Multi-User Sync controls

---

**Technical Notes**  
- All changes stay lightweight (SVG/CSS, native Web APIs, Capacitor fallbacks)  
- Reuse existing systems heavily  
- Maintain offline-first + PWA behavior