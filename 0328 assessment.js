Social Media Import – Detailed Assessment (CRITICAL)
Date: March 29, 2026
Priority: P0 – Must be fixed before any other major work
Executive Summary
The social media import pipeline (Instagram, TikTok, YouTube Shorts, etc.) is the single largest friction point in the entire product. While the March 21 implementation added a cascading strategy (embed → stealth Chrome → Paste Text), the feature is still unreliable in production. Users expect to paste a link and get a recipe instantly. Currently they are forced into manual paste 60–70 % of the time.
Current State & Technical Details

Pipeline: Instagram embed page → stealth headless Chrome fallback → Paste Text tab.
Enhanced Parser: extractWithBrowserAPI, detectRecipePlugins, smartClassifyLines, parseIngredientLine.
Offline Queue: Fully functional via IndexedDB + queueRecipeImport.
Key Files:
src/components/BrowserAssist.jsx (main client-side extraction)
src/components/ImportModal.jsx
src/recipeParser.js (the new unified parser)
server/index.js (optional Express server with stealth Chrome)


Major Issues

Instagram embed endpoint frequently returns login-wall HTML or empty captions.
Stealth Chrome is still being blocked by Instagram’s 2025–2026 anti-bot layer.
Fallback to Paste Text is too aggressive — breaks the “magic import” expectation.
No reliable handling of video-only recipes (TikTok/YouTube Shorts with no caption).
Background Sync for offline queue is registered but not consistently firing on iOS Safari.

User Impact

Breaks the core promise of “paste any recipe link → instant import”.
High cognitive load and frustration for the most common use case.
Prevents viral growth (users cannot easily share SpiceHub links on social media).

Recommended Improvements (Phased)
Phase 0 (Immediate – 1–2 days): Harden client-side path + add better error guidance.
Phase 1 (Short term): Add optional yt-dlp + Whisper pipeline behind user-provided OpenAI key.
Phase 2: Unified import page with clear progress stages and fallback visualization.

DOCUMENT filename="MEAL_LIBRARY_DETAILED.md"
Meal Library – Detailed Assessment
Date: March 29, 2026
Priority: P2 – Strong foundation, minor polish needed
Executive Summary
The Meal Library is one of the strongest and most polished parts of SpiceHub. It delivers a delightful, Notion-like experience that feels native across Windows, iOS, and Android.
Current State & Strengths

Notion-style gallery grid with smooth staggered animations.
Long-press / right-click quick-preview bottom sheet (very interactive).
Horizontal category chips with smooth scrolling.
Favorite starring, 5-star rating, cook-count tracking.
Robust import toolbar: URL, photo OCR (Tesseract with preprocessing), spreadsheet, Paprika bundle.
CardImage component intelligently falls back to CORS proxy when external images 404.
Full offline support with quota monitoring.

Technical Implementation

src/components/MealLibrary.jsx
CardImage with proxy fallback
Long-press touch handlers + bottom sheets
IndexedDB + db.meals

Minor Gaps

No “Recently Cooked” smart section.
No drag-and-drop reordering of favorites.
Search could be more fuzzy (e.g., ingredient-based search).

Recommendations

Add “Recently Cooked” and “Favorites” quick filters at the top.
Implement drag-and-drop reordering for favorites (iOS/Android/Windows touch friendly).
Add ingredient-based search as an advanced toggle.


DOCUMENT filename="HOMEPAGE_MEAL_SPINNER_DETAILED.md"
Homepage & Meal Spinner – Detailed Assessment
Date: March 29, 2026
Priority: P2 – Delightful, small enhancements will make it exceptional
Executive Summary
The homepage (WeekView + Meal Spinner) is highly interactive, fun, and feels premium. The slot-machine animation is a standout feature that users love.
Current State & Strengths

iOS-Calendar-style horizontal day strip with swipe navigation.
Hero card for selected day with quick actions (View, Respin, Change, Clear).
Stats strip (streak, planned meals, top pick) gives instant dopamine.
Meal Spinner with smooth easing and staggered column stops.
Touch/swipe gestures work perfectly on all platforms.

Technical Implementation

src/components/WeekView.jsx
src/components/MealSpinner.jsx
useOnlineStatus integration for offline resilience.

Gaps

Spinner only uses “Dinners” by default — users want category-specific spins.
No “Regenerate with constraints” (e.g., “no repeats”, “vegetarian only”).
No quick “Save as template” for favorite week plans.

Recommendations

Add category selector before spinning.
Add constraint chips in spinner modal.
Add “Save this week as template” button.


DOCUMENT filename="GROCERY_LIST_DETAILED.md"
Grocery List Tab – Detailed Assessment
Date: March 29, 2026
Priority: P3 – Already excellent, small power-user features would make it best-in-class
Executive Summary
The Grocery List is production-grade and one of the most usable parts of the entire app. It feels like a native shopping list app.
Current State & Strengths

Smart store memory (remembers “flour → Trader Joe’s”).
Batch mode with multi-select and “Assign Store” bottom sheet.
Auto-sort from memory.
Progress bar + Keep export (native share or clipboard).
Week-plan context shown at top.
Fully touch-optimized and responsive.

Technical Implementation

src/components/GroceryList.jsx
storeMemory table in IndexedDB.
sendToKeep helper with native share fallback.

Minor Opportunities

One-tap deep links to AnyList, Out of Milk, Apple Reminders, etc.
Quick “Mark all as bought” for entire store section.
Visual store logos next to each section (already partially there).

Recommendations

Add popular shopping-app deep links in the floating action bar.
Add “Copy as plain text” and “Copy as checklist” options.


DOCUMENT filename="BAR_TAB_DETAILED.md"
Bar Tab – Detailed Assessment
Date: March 29, 2026
Priority: P2 – Good foundation, needs parity with meal side
Executive Summary
The Bar tab is fun and visually distinctive (especially the retro pixel-art BarShelf), but it currently lacks the depth and polish of the meal side.
Current State & Strengths

Full BarLibrary with categories, search, backup/restore.
Retro 16-bit BarShelf view with pixel bottles and neon text — very on-brand.
BarFridgeMode (“What’s on My Shelf?”) mirrors FridgeMode nicely.
MixMode component exists and is well implemented.

Gaps

No dedicated “Bar Stats” equivalent to Meal Stats.
Drink scaling in MixMode is implemented but UI polish is lighter than CookMode.
No “Recently Mixed” section.
Import experience for drinks is less robust than for meals.

Recommendations

Add Bar Stats screen (streak of mixing, top drinks, etc.).
Add “Recently Mixed” carousel on the BarLibrary home.
Bring drink import experience up to the same level as meal import.


DOCUMENT filename="BACKEND_RELIABILITY_DETAILED.md"
Backend Reliability & Robustness – Detailed Assessment
Date: March 29, 2026
Priority: P1 – Already very strong for a client-first PWA
Executive Summary
The app is now mostly client-side and extremely robust. It works offline, survives flaky networks, and gracefully degrades. The optional Express server is no longer required for core functionality.
Current State & Strengths

Full offline support via useOnlineStatus + 2-second debounce + cross-tab sync.
IndexedDB + real-time quota monitoring + persistent storage request.
Auto-cleanup of old logs when storage is high.
Recipe import queue with background sync.
All parsing now runs client-side via enhanced recipeParser.js.
PWA with auto-update, service worker, and install prompt.

Remaining Weak Spots

Optional Express server (for stealth Chrome) is still required for best Instagram experience.
Background Sync works well on Android/Chrome but is less reliable on iOS Safari.
Storage warning banner exists but does not yet have a one-tap “Clean Now” action.

Recommendations

Make the server truly optional (already 90 % there).
Add a prominent “Sync Now” button in the offline indicator.
Turn the storage warning banner into an actionable mini Storage Manager.


These six documents give you a complete, detailed picture of the current state of the app.
Let me know which category you want to tackle first (I recommend starting with Social Media Import), and I’ll deliver the exact implementation plan with file-by-file changes and code snippets.