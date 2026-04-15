# SpiceHub — Unified Recipe Import Engine Implementation Brief

**You are now acting as the senior backend/frontend engineer** responsible for fixing SpiceHub’s long-troubled social media / recipe import system.

### 1. Project Context & Why This Matters
SpiceHub is a **fully offline-first PWA** (Vercel + installable on iOS/Android/Windows).  
The **#1 killer feature** is frictionless recipe import from Instagram, TikTok, YouTube Shorts, Pinterest, and recipe blogs.  
The current import code is fragmented across `recipeParser.js`, `BrowserAssist.jsx`, `ImportModal.jsx`, `BrowserImport.jsx`, and `api.js`. It is fragile, has too many paths, and still has server dependency in places where it should be client-only.

### 2. Goal
Create **one single, clean, maintainable import engine** with this public API:

```js
async function importRecipeFromUrl(url: string): Promise<Recipe | { _needsManualCaption: true, sourceUrl: string } | null>
This function must return a clean recipe object or a clear signal that the user should paste the caption manually.
3. Desired Strategy (2026 Best Practice)
For Instagram URLs (≈70% of imports)

Phase 0 — Try tryVideoExtraction() (yt-dlp subtitles) first. Many Reels are narrated recipes.
Phase 1 — Fast embed page fetch (/embed/captioned/) via CORS proxy (fetchHtmlViaProxy).
Phase 2 — If needed, fall back to AI Browser (extractInstagramAgent).
Phase 3 — Always run the final cleaned text through structureWithAI() (Gemini client-side preferred).

Use the existing cleanSocialCaption() and isCaptionWeak() aggressively.
For non-Instagram URLs

Use extractWithBrowserAPI() (JSON-LD + heuristics).
Fall back to Gemini structuring on visible text.

4. Required Changes
Primary file to create / update:

recipeParser.js → Add the new unified function importRecipeFromUrl(url) and importFromInstagram(url).

Files to update:

ImportModal.jsx — Call the new unified function instead of the old scattered logic.
BrowserAssist.jsx — Become the clean visual wrapper around the new engine. Show clear progress steps.
api.js — Keep helper functions but deprecate old server-dependent paths.
Any other file that directly calls the old import functions.

Keep existing:

cleanSocialCaption(), isCaptionWeak(), parseCaption(), structureWithAI(), tryVideoExtraction(), etc.

5. Non-Functional Requirements

Must work completely offline-first (queue URLs if needed).
Minimize server dependency — prefer client-side Gemini when VITE_GOOGLE_AI_KEY is present.
Preserve the existing offline queue and background sync behavior.
Keep graceful degradation: if everything fails, fall back to manual paste with the URL pre-filled.
Maintain excellent touch/mobile UX and progress feedback.

6. Acceptance Criteria

One single function importRecipeFromUrl(url) is the only public entry point.
Instagram Reels with narration now work reliably via subtitles-first path.
Thin/hashtag-only captions correctly fall back to video subtitles or manual paste.
All existing UI flows (ImportModal, share-target, BrowserAssist) continue to work and now use the unified engine.
Clear progress feedback is shown to the user during import.
No regression in recipe quality or parsing accuracy.

7. Deliverables
Please implement the changes and return:

The full updated recipeParser.js with the new unified engine.
The minimal diff/changes needed in ImportModal.jsx and BrowserAssist.jsx.
A short testing plan (key Instagram Reels + recipe blogs to verify).

Start by creating the unified importRecipeFromUrl function in recipeParser.js. Use the exact three-phase Instagram strategy described above.
You have full context of the current codebase. Begin.