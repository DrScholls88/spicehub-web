# BarShelf + App.css + ImportModal Fix Plan

A targeted remediation covering four problem areas discovered in the last conversation cycle.

---

## Issues Identified

### 1. BarShelf – Android Layout Wonky + Bar Moved to Top
**Root cause:** The `saloon-mid` layer has `overflowY: 'auto'` and `paddingBottom: '80px'` set inline, which fights the `flex: 1; overflow: hidden` column on `.bs-container`. On Android, the `height: 100dvh` inline style on `.bs-container` + the inner scroll region creates a layout conflict — the bar counter (`.saloon-fg`) and its children drift because `position: absolute; inset: 0` inside a scrolling parent doesn't behave like it does on iOS/desktop.

**Fix:**
- Remove the inline `overflowY: 'auto'` and `paddingBottom` from `saloon-mid` in JSX — the mid layer should be position-absolute, non-scrolling, exactly like the bg and fg layers.
- The `saloon-stage` should be the only flex-1 area; no inner layers should scroll.
- Add `flex-shrink: 0` insurance on `.bs-topbar` and `.bs-page-nav` to stop them being crushed on small screens.
- Fix the `.bs-topbar` CSS: it currently has TWO `z-index` declarations and TWO `background` declarations (the second ones win, but this is a conflict that causes confusion). Clean these up.
- Add `padding-top: env(safe-area-inset-top)` to `.bs-topbar` so the notch doesn't clip the top bar on newer Androids.

### 2. BarShelf – Speech Bubbles Overlapping Bartender
**Root cause:** `.bs-quips-layer` is positioned with `bottom: 155px` and `width: 120px` — the bubble anchors right on top of the bartender sprite because the layer moves with the bartender via `left: ${bartenderX}px`. The `--bubble-x: -85%` and `-15%` modifiers shift the bubble by 85% of the bubble's own width, which is not enough clearance when the bartender is near the center or left edge of the stage.

**Fix:**
- Increase `bottom` of `.bs-quips-layer` to `180px` so bubbles clear the bartender's hat.
- Change bubble positioning strategy: instead of anchoring at `left: 50%` of the 120px layer and translating, switch to using `position: absolute` with `right: 100%` for `--left` and `left: 100%` for `--right` variants, with a small `margin` for breathing room. This guarantees the bubble never overlaps the sprite regardless of viewport width.
- Adjust the triangle tail to point back toward the bartender appropriately.
- Cap bubble `max-width` to `min(240px, 60vw)` to prevent off-screen clipping on narrow Android screens.

### 3. App.css – Full Cleanup & Reorganization
**Root cause:** At 17,044 lines, the file has grown organically with:
- Duplicate `.import-modal` declarations at lines 2360, 16331, and 16985
- Duplicate `z-index` + `background` in `.bs-topbar` (lines 10698–10705)
- Two `ip-preview-footer` blocks rendered in ImportModal JSX (one orphaned duplicate)
- Global `input, textarea { font-size: 16px !important; }` at line 17035 that nukes pixel-font inputs inside `.bs-container`
- The `saloon-fg .bs-bar-surface` and `saloon-fg .bs-bar-rail` rules appear twice (lines 15255 and 15361)

**Fix strategy — NOT a full rewrite (too risky), but targeted surgical fixes:**
- Remove the duplicate `z-index` line from `.bs-topbar`
- Remove the duplicate `background` line from `.bs-topbar`
- Consolidate the three `.import-modal` rules into one section (keep line 16985 version, merge attributes from 2360 and 16331 into it, delete the other two)
- Scope the `font-size: 16px !important` override to only apply outside `.bs-container` so pixel inputs aren't broken
- Remove the duplicate `saloon-fg .bs-bar-surface` / `saloon-fg .bs-bar-rail` block
- Add section header comments to group: **Global Tokens**, **App Shell**, **Week View**, **Meal Library**, **Bar Area (bs-)**, **Import Modal (ip- / import-)**, **BrowserAssist (ba- / browser-assist-)**, **GroceryList (gl-)**, etc.

### 4. ImportModal – Preview Scroll Broken / Start Import Unreachable
**Root cause 1 (JSX):** There are **two** `ip-preview-footer` divs being rendered — one at line 1369 and a duplicate orphan starting at line 1385. This double-footer is caused by a JSX structure error where the closing tags got misaligned. The second footer is outside the `ip-preview-screen` div but still inside the modal, causing layout collapse.

**Root cause 2 (CSS):** `.ip-preview-screen` has `height: 100%` but its parent `.import-modal` is `height: 100dvh; overflow: hidden`. The `.preview-scroll-content` correctly has `overflow-y: auto` but the `flex: 1 1 auto` only works if the flex parent chain is properly constrained — the duplicate footer breaks the flex chain and pushes the scroll area out of the visible window.

**Root cause 3 (BrowserAssist):** When `browserAssistMode === 'showing'`, the BrowserAssist component fills the entire modal but the `ba-fallback-header` breadcrumb sits above it with no height constraint, shrinking the iframe area unpredictably on small screens.

**Fix:**
- Remove the orphaned duplicate `ip-preview-footer` block (lines 1385–1400 in ImportModal.jsx)
- Verify the `ip-preview-screen` JSX closing structure is correct
- In CSS: ensure `.import-modal` uses `display: flex; flex-direction: column; height: 100dvh; overflow: hidden` (already correct at line 16985) and ensure `.ip-preview-screen` has `min-height: 0` to allow flex shrinking
- Add `min-height: 0` to `.ip-preview-screen` and `.preview-scroll-content` as a belt-and-suspenders fix
- For BrowserAssist: add `flex: 1; min-height: 0; overflow: hidden` to the BrowserAssist wrapper div in ImportModal so it fills remaining space without overflow

---

## Roadmap Items to Implement (from BAR_AREA_UI_UX_ROADMAP.md)

Items not yet done that are quick wins:
- **Stool filter buttons** — already implemented in JSX but use fixed `left: ${x}px` pixel positions which break on narrow Android. Convert to `%`-based or flex positioning.
- **`pointerEvents: 'none'`** on `saloon-fg` — correct for most children, but stool buttons need `pointerEvents: 'auto'` individually (already done in JSX via `saloon-stool-btn`, just needs CSS confirmation).
- **Topbar overflow** — on Android, the 7 buttons in `.bs-topbar` overflow at 320px width. Add `overflow-x: auto; scrollbar-width: none;` to `.bs-topbar` and add `flex-shrink: 0` to each button.

---

## Proposed Changes

### ImportModal.jsx
#### [MODIFY] [ImportModal.jsx](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/ImportModal.jsx)
- Remove duplicate `ip-preview-footer` block (lines ~1385–1400)
- Add `style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}` to BrowserAssist wrapper div

### BarShelf.jsx
#### [MODIFY] [BarShelf.jsx](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/components/BarShelf.jsx)
- Remove `overflowY: 'auto'`, `webkitoverflowscrolling`, and `paddingBottom` from `saloon-mid` inline style (line ~1409) — change to `position: 'absolute', inset: 0, overflow: 'hidden'`
- Convert stool button positions from fixed `left: px` to `left: %` or auto-layout via flex on `.saloon-stools`

### App.css
#### [MODIFY] [App.css](file:///c:/Users/bjgoe/Documents/Projects/spicehub_meal_spinner/spicehub-web/src/App.css)
- Fix `.bs-topbar` duplicate declarations
- Fix `.bs-quips-layer` bottom value and speech bubble positioning
- Consolidate duplicate `.import-modal` declarations
- Scope `font-size: 16px !important` override
- Remove duplicate `saloon-fg` block
- Add `min-height: 0` to `.ip-preview-screen`
- Add `overflow-x: auto; scrollbar-width: none` to `.bs-topbar`
- Fix stool positioning in CSS
- Add clear section comments throughout

---

## Verification Plan

### Automated
- `npm run dev` — confirm no compile errors

### Manual Verification
- Open Bar tab on Android (or narrow viewport 360px): confirm bar is at bottom, not top
- Tap a bottle: confirm speech bubble appears to the SIDE of bartender, not overlapping
- Open Import, import a recipe, reach Preview: confirm scroll works and "Save to Library" button is reachable
- Confirm Import modal with BrowserAssist fills viewport correctly

> [!IMPORTANT]
> The duplicate `ip-preview-footer` JSX and the `saloon-mid` inline style are the two highest-risk bugs — fixing these first will unblock both the Android bar layout and the import scroll.

> [!WARNING]
> App.css is 17,044 lines. All edits will be surgical `multi_replace_file_content` calls targeting specific line ranges — no full-file rewrites.
