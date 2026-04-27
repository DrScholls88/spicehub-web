# Task: Integrate New Visual BrowserAssist with ImportModal

**Goal**: Wire the new BrowserAssist visual overlay component into ImportModal and recipeParser so visual scraping triggers correctly and data flows end-to-end.

## Current State
- New BrowserAssist component is ready (visual overlays, 400-block limit, auto-zoom)
- It calls `/api/import/visual` and returns `{ ok, type: 'visual', visualData, recipe }`
- ImportModal.jsx currently triggers scraping via buttons/UI events
- server.js already has `extractWithHeadlessBrowser()` with rich visual data payloads

## Integration Blockers to Fix

### 1. Auto-Scrape Timing Conflict
**Problem**: New BrowserAssist auto-scrapes on URL change. ImportModal expects manual trigger.
**Fix**:
- Add `triggerVisualScrape()` method to BrowserAssist (expose via ref or callback)
- ImportModal calls this method when user clicks "Scrape" or after URL is pasted and iframe loads
- Remove auto-scrape on URL change; keep it only on initial load if needed

### 2. Missing Social URL Detection
**Problem**: Instagram/TikTok/Reels URLs should auto-activate visual mode, but no check exists.
**Fix**:
- Add function in BrowserAssist: `isSocialMediaUrl(url)` — returns true if URL includes `instagram.com`, `tiktok.com`, `reels.instagram`, `facebook.com/watch`, `youtube.com`
- Call it in `performVisualScrape()` before fetch; if true, set `showOverlays(true)` immediately
- Add toast: "Visual parse active — detecting structure by layout"

### 3. Heuristic Duplication
**Problem**: `parseVisualBlocks()` in BrowserAssist re-classifies blocks. Server already did this in `parseVisualJSON()`.
**Fix**:
- Remove `parseVisualBlocks()` from BrowserAssist entirely
- Use server's classification: `result.visualData.blocks` already has `type` field from server
- Client only renders overlays based on server's type; doesn't re-detect

### 4. Error Handling Missing
**Problem**: Visual scrape fails silently; ImportModal can't show retry UI.
**Fix**:
- Add `onError(err)` callback to BrowserAssist props
- Call it in catch block: `onError({ message: 'Visual scrape failed', originalError: err })`
- ImportModal listens and shows toast: "Visual parse failed, falling back to text extraction"

### 5. Selected Blocks Discarded
**Problem**: User can click overlays to select blocks, but selection is lost.
**Fix**:
- Add `onBlocksSelected(selectedIds)` callback
- Call it whenever `selectedBlockIds` changes
- ImportModal stores this for future "refine selected blocks" UI

## Files to Modify

### src/components/BrowserAssist.jsx

Line 9: Add onError and onBlocksSelected to destructured props
Line 30–35: Remove auto-scrape useEffect; keep it manual
Line 44: Add isSocialMediaUrl() check before fetch
Line 50: Add onError() call in catch block
Line 71–104: Delete parseVisualBlocks() function entirely
Line 298: Use result.visualData.blocks.map() directly; trust server's type field for coloring
After line 300: Expose triggerVisualScrape via useImperativeHandle (or just keep it as internal, let parent call via ref)
Line 340: Add onBlocksSelected(selectedBlockIds) call when selection changes


### src/components/ImportModal.jsx

Add ref to BrowserAssist: const browserAssistRef = useRef(null)
In the button click handler that starts scraping, call: browserAssistRef.current?.triggerVisualScrape()
Wire onError to show a toast: showToast({ type: 'warning', message: err.message })
Wire onBlocksSelected to store selected blocks in state (for future refinement)
Remove any auto-scrape logic that conflicts with manual trigger


### src/recipeParser.js

No changes needed—server already does the parsing via parseVisualJSON()
Confirm parseVisualJSON() is exported and handles all three types (title, ingredient, instruction)


## Success Criteria
1. ✅ Paste Instagram URL → iframe loads → user clicks "Analyze Visually" → overlays render
2. ✅ Overlays are color-coded (yellow=title, green=ingredient, purple=instruction)
3. ✅ Visual scrape fails gracefully → toast shows, user can retry
4. ✅ Non-social URLs skip auto-activation; user must click button
5. ✅ Selected blocks are tracked and available to parent for future UX
6. ✅ All 4 components (BrowserAssist, ImportModal, recipeParser, server) exchange data cleanly

## Notes
- Server's `/api/import/visual` returns blocks with `type` field already set—trust that
- No new API endpoints needed
- Keep BrowserAssist stateless about recipe parsing; that stays in recipeParser.js
- This is a **replacement**, not an addition—old visual scraping logic in ImportModal should be removed

## Deliverable
Updated ImportModal.jsx + BrowserAssist.jsx with integration wired, ready for end-to-end testing.