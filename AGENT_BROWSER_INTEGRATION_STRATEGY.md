# Agent Browser Integration Strategy for SpiceHub PWA

**Goal**: Make Instagram (and general social media) recipe import the **keystone feature** of the app — nearly automatic, reliable, delightful, and mobile-native.

Current pain points:
- Frequent missing or low-quality photos
- Unsorted / misclassified text blocks
- Too much manual dragging in preview
- Small/unusable internal browser window on mobile
- Fragile puppeteer + iframe fallback

Agent Browser (Vercel) + existing parser stack will solve most of these.

## Current Stack Summary
- `recipeParser.js`: `extractWithBrowserAPI`, `parseCaption`, `smartClassifyLines`, `parseIngredientLine`
- `BrowserAssist.jsx`: iframe-based fallback with manual button
- `ImportModal.jsx`: preview with draggable reorganization + offline queue
- Backend: puppeteer + limited yt-dlp attempts

## Proposed New Stack (Hybrid)

**Primary**: Agent Browser (lightweight, AI-native, snapshot + ref system)  
**Secondary**: Playwright (for complex interactions if needed)  
**Parsing Layer**: Keep existing `recipeParser.js` (strong heuristics + structured output)  
**Offline Layer**: Full compatibility with Dexie + SyncQueue

---

### Phase 1 – Low Effort, High Impact (Do This First)

1. **Add Agent Browser snapshot in BrowserAssist.jsx**
   - On Instagram URLs, call Agent Browser to get a clean page snapshot + all visible text.
   - Use element refs to detect caption, images, and post container.
   - Take annotated screenshot before falling back to iframe (for vision debugging).

2. **Improve image grabbing**
   - Use Agent Browser screenshot → Claude vision to pick the best photo instead of `selectBestImage()` heuristics.

3. **Better progress feedback**
   - Stream simple progress events: "Loading post…", "Expanding caption…", "Extracting text…", "Analyzing images…"

**Expected Win**: Faster, more reliable initial extraction with fewer iframe fallbacks.

---

### Phase 2 – Medium Effort (Core Improvement)

1. **Create `/api/extract-instagram-agent` endpoint**
   - Replace most puppeteer logic with Agent Browser.
   - Support session persistence (login once → reuse session for future imports).
   - Use batch commands: navigate → wait for load → expand caption → extract text + images → screenshot.

2. **Stream progress to ImportModal**
   - Real-time updates: "Trying subtitles…", "No subtitles — reading caption…", "Building recipe…"

3. **Smart text sorting**
   - Combine Agent Browser extracted text with `smartClassifyLines()` + confidence scoring.
   - Reduce need for manual dragging.

**Expected Win**: Much higher automatic success rate on Reels and video-heavy posts.

---

### Phase 3 – High Confidence / Polish (Make It Delightful)

1. **Full replacement of puppeteer for social media**
   - Agent Browser becomes the default path for Instagram, TikTok, YouTube, etc.

2. **Advanced features**
   - Carousel support: loop through slides and extract all images + captions.
   - Reel subtitle extraction via JavaScript evaluation on the DOM (faster than yt-dlp for many cases).
   - Smart photo selection: annotated screenshot → vision model picks best image → auto-save.

3. **Premium UX (via UI/UX Pro Max)**
   - Larger, smoother browser view with excellent pinch-to-zoom.
   - Intuitive drag-and-drop in preview with visual confidence indicators.
   - Smooth slide-down gestures on modals.
   - Clear progress UI and success animations.

---

### Why This Matters (The Keystone Argument)

Instagram import is the single biggest friction point for users.  
When it works well → users love the app and use it daily.  
When it fails → they fall back to manual paste and feel disappointed.

**Agent Browser advantages over current stack**:
- Much lighter and faster than puppeteer
- Built-in session persistence (no repeated logins)
- Snapshot + ref system = far more reliable element targeting
- Native vision support for better image selection
- Easier high-level instructions for Claude/Ruflo

Combined with your existing strong parser (`parseCaption`, `smartClassifyLines`, `extractWithBrowserAPI`) and offline queue, this will make SpiceHub’s import experience **noticeably better** than both Mealie and Paprika for social/video content.

---

### Next Immediate Action (Recommended Ruflo Prompt)

Once you’ve added the Agent Browser skill, run this prompt in Claude Cowork:
