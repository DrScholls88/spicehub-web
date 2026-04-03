# Vercel Agent Browser Integration Walkthrough

## What Was Accomplished
The user's goal was to integrate `@vercel/agent-browser` directly within the SpiceHub recipe extraction pipeline to drastically improve the reliability of parsing recipes from social media (especially Instagram), replacing the legacy, fragile Puppeteer methods.

This was completed across 3 coordinated phases:

### Frontend Hooks & Previews (Phase 1)
- Updated [BrowserAssist.jsx](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/BrowserAssist.jsx) to explicitly stream progress updates like **"Loading post…"**, **"Expanding caption…"**, and **"Analyzing images…"**.
- Integrated logic to evaluate [scoreExtractionConfidence()](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/recipeParser.js#2383-2428); if the `agent-browser` returns poor data, it falls back seamlessly to the manual extraction iframe.
- Bound the vision-selected image field implicitly mapped to `agentResult.visionSelectedImage` to ensure the most relevant photo (instead of generic heuristics) is presented.

### Server CLI Integration (Phase 2 & 3)
- Created a new backend route `POST /api/extract-instagram-agent` inside [server/index.js](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/server/index.js).
- Configured dynamic Node `child_process.exec` using `npx @vercel/agent-browser`.
- Set session isolation flags (`--session spicehub_social`) to preserve cookies and login states transparently on the backend.
- Sent batch evaluations directly into the browser to extract text context, query carousel images (`img` and `video[poster]` elements), and capture Reel subtitles via DOM evaluation (`time`, `.subtitle`, and `[data-testid='video-caption']`).

### Pipeline Realignment
- Edited [src/recipeParser.js](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/recipeParser.js) to strip [tryServerExtraction](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/recipeParser.js#1316-1398) fallback logic away from social media URLs. All [isSocialMediaUrl(url)](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/recipeParser.js#26-32) flows now attempt [extractInstagramAgent](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/recipeParser.js#1213-1315) first, allowing the backend CLI to take the lead on the heaviest DOM lifting while still preserving `yt-dlp` as a secondary video layer.

### Premium UX
- Appended responsive animation rules inside [index.css](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/index.css):
  - Hover bounding boxes for `.preview-editable-row` that pop and lift context into emphasis (with `cursor: grab`, transitions, and depth shadows).
  - Implicit `touch-action: pan-x pan-y pinch-zoom;` appended to the BrowserAssist wrapper.
  - Form-in fade-in animations spanning the overlay wrappers.

## Phase 4: High-Impact UI & Integrity Refactor
* **Data Integrity**: Exorcised the hardcoded default `SEED_MEALS` array from Database initialization. Users starting fresh will now have a blank slate, permanently eliminating the "zombie recipe" phenomena.
* **Component Restructuring**: Extracted the previously obfuscated Meal Spinner logic from an overlay modal into a native, dynamic Hero block on the [WeekView](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/WeekView.jsx#126-553) home screen that directly intercepts and rolls active plans.
* **Locked Calendar States**: 
  - Redesigned visual rules mapping to [DESIGN_SYSTEM.md](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/DESIGN_SYSTEM.md) elevations.
  - Days in the "Suggestion/Draft" phase feature light dashed borders and transparent card structures.
  - Pressing the **"🔓 Lock"** toggle immediately commits the recipe. The calendar card elevates, gaining a solid warm surface background, drops a rich shadow, and actively masks out any destructible actions (like `Respin`, [Change](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/ImportModal.jsx#196-207), or `Clear`) to ensure the user's hard week decisions are protected.
  - [MealSpinner](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/MealSpinner.jsx#3-179) pipeline naturally avoids overwriting explicitly `_locked` recipes globally.
* **Visual Polish**: Enforced `16px` border-radii across primary active rows, adopted glassmorphism boundaries, and transformed simple fallback texts (like the standard `+`) into dedicated, inviting dashed `wv-empty-circle` drop action zones structurally identical to Apple's design languages.

## Validation Visuals

<div style="display:flex; gap:16px;">
  <img src="file:///C:/Users/bjgoe/.gemini/antigravity/brain/4b0d15dd-585c-4539-9cd0-630461aa6f0c/empty_calendar_1775194164701.png" alt="Empty Calendar State" width="300"/>
  <img src="file:///C:/Users/bjgoe/.gemini/antigravity/brain/4b0d15dd-585c-4539-9cd0-630461aa6f0c/.system_generated/click_feedback/click_feedback_1775194287668.png" alt="Locked vs Unlocked Card Design" width="300"/>
</div>
