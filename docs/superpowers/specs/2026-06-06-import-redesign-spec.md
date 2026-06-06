# SpiceHub Import Redesign — Collapse & Reveal + Engine Reliability

**Date:** 2026-06-06  
**Status:** Design approved, pending implementation  
**Scope:** Phases 1 + 5 from the May 2026 audit. Replaces the current ImportModal with a Collapse & Reveal flow and unifies the import engine.

---

## 1. Interaction model: Collapse & Reveal

The import UI is a single bottom sheet with three visual states — **input**, **loading**, **review+save** — driven by a `phase` state enum. There are no wizard steps, no step counter, no back/forward navigation. The input area smoothly collapses to a compact status bar when results arrive; the review area fades in below it.

### State machine

```
input  →  loading  →  review
  ↑                      │
  └──── (tap collapsed input bar to re-expand inline) ────┘
  
input  →  loading  →  browserAssist (inline)  →  review
                         ↑
                    (timeout auto-fallback)

Any state → (cancel/close) → dismissed
```

### Input state
- Segmented tab control: From URL | Paste Text | From Photo | More (overflow for Spreadsheet, Paprika)
- Meal/Drink type toggle — subtle icon + tint, not two saturated colors
- URL field with Enter-to-import
- Collapsed social preview card (tap to expand in its own sub-sheet)
- Sticky footer: "Import recipe →" primary CTA

### Loading state
- Input area collapses to 40px status bar: green pulsing dot + URL + "importing" label
- Linear progress bar + real phase text from engine progress callback (not fake spinner)
- Cancel button in sticky footer (calls `abortController.abort()`)
- On success → transition to review
- On engine returning `_needsBrowserAssist` (all phases exhausted) → transition to BrowserAssist inline
- On 45s hard timeout (engine hanging) → also transition to BrowserAssist inline with partial data
- On error → show inline error toast with retry + "Try in browser" + "Paste manually" options

### Batch import
When multiple URLs are detected (newline/space-separated), ImportSheet enters a batch sub-flow:
- Loading state shows "Importing 2 of 5 recipes..." with a batch progress bar
- Each recipe flows through the engine independently
- Results accumulate; review state shows all recipes as a scrollable list of cards
- Save CTA: "Save 5 recipes to library"
- Individual recipe failures show inline with retry option, don't block the batch

### Review + Save state
- Collapsed input bar stays at top (tap to re-expand inline, non-destructive)
- Hero image with editable title overlay + confidence chip (green/amber dot)
- Collapsible accordion sections:
  - Ingredients (count badge, inner max-height scroll)
  - Steps (count badge, inner max-height scroll)
  - Drink fields (glass, garnish, method) — shown only for drinks
  - Notes (collapsed by default)
  - Original caption (collapsed by default, "Show original ▾")
- Simplified rows: drag-handle + text + "..." overflow menu (move/remove/misplaced-hint)
- Save destination grid (Library, This Week, Grocery, Bar) inline at bottom of scroll
- Sticky footer: "Save to [destination]" primary CTA

### Collapse animation
The input area compresses from full height to 40px over 250ms using `max-height` + `overflow: hidden` with `cubic-bezier(0.32, 0.72, 0, 1)` (spring-like). Review content fades in with 100ms delay (`opacity 0→1, transform translateY(8px)→0`). Re-expanding is the reverse animation.

---

## 2. Component architecture

### New files

**`src/components/ImportSheet.jsx`** — top-level orchestrator. Replaces ImportModal.jsx.
- State: `phase` (input | loading | review | browserAssist), `recipe`, `error`, `progress`, `abortController`
- Manages the collapse animation via a `collapsed` boolean on the input section
- Renders: ImportInput (collapsible), loading UI, ImportReview, BrowserAssist (inline), sticky footer
- Single import entry point: always calls `importRecipeFromUrl` or `captionToRecipe`
- Thread `abortController.signal` into every engine call

**`src/components/ImportInput.jsx`** — the input form.
- Props: `collapsed`, `onImport(url, type)`, `onModeChange`, `initialUrl`, `initialType`
- Renders segmented tabs, type toggle, URL field, social preview card, batch detection
- When `collapsed=true`, renders as compact status bar with tap-to-expand
- No parsing logic — pure presentation + callbacks

**`src/components/ImportReview.jsx`** — the review and edit surface.
- Props: `recipe`, `onChange(recipe)`, `onSave(recipe, destination)`, `confidence`
- Hero image, editable title, collapsible accordions, simplified rows, drag-reorder
- Save destination grid
- All editing state is local; calls `onChange` on every mutation

### Modified files

**`src/components/BrowserAssist.jsx`** — gains `inline` prop.
- When `inline={true}`: renders without its own header/footer chrome, fits inside ImportSheet body
- Calls `onRecipe(recipe)` when user completes tap-to-pick extraction
- No other behavioral changes

**`src/recipeParser.js`** — engine unification.
- `importRecipeFromUrl` gains `{ signal }` option (AbortController signal)
- `importFromInstagram` phases 0.25/0.5/0.75 run in parallel via `Promise.any`
- Hard 45s `Promise.race` wrapper on the entire engine call
- All phases return `{ ok, stage, caption, imageUrl, reason }` (no silent catches)
- Returns `{ _needsBrowserAssist: true, seed }` instead of throwing when all phases exhaust

**`src/App.css`** — new CSS for ImportSheet, collapse animation, accordion, hero, simplified rows. Removes old ImportModal styles (or marks them deprecated).

### Deleted files
- `src/components/ImportModal.jsx` — replaced by ImportSheet.jsx
- Update `App.jsx` (or wherever ImportModal is rendered) to use ImportSheet

---

## 3. Engine reliability (Phase 1)

### Entry point unification
Delete the duplicate `handleUrlImport` logic. `ImportSheet` always calls one of:
- `importRecipeFromUrl(url, onProgress, { type, signal })` — for URL imports
- `captionToRecipe(text, { type, imageUrl })` — for paste text and photo OCR
- `structureRecipeFromImage(imageDataUrl, { type })` — for photo (Gemini Vision → captionToRecipe)

The engine returns a recipe object or `{ _needsBrowserAssist: true, seed, capturedCaption }`.

### Global AbortController
```js
const controller = new AbortController();
const result = await Promise.race([
  importRecipeFromUrl(url, onProgress, { type, signal: controller.signal }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 45000)),
]);
```
- Cancel button calls `controller.abort()`
- Every internal fetch in recipeParser.js and api.js passes `{ signal }`
- On TIMEOUT: ImportSheet transitions to BrowserAssist inline with partial data

### Parallel Instagram phases
```js
// Inside importFromInstagram:
const cheapPhases = [
  fetchInstagramViaApify(url, { signal }),    // Phase 0.25
  fetchInstagramOEmbed(url, { signal }),       // Phase 0.5
  fetchInstagramJson(url, { signal }),         // Phase 0.75
];
const firstGood = await Promise.any(cheapPhases.map(p =>
  p.then(r => r?.caption?.length > 50 ? r : Promise.reject('weak'))
));
// Cancel remaining phases via shared signal
```
If all cheap phases reject, fall through to embed → agent → BrowserAssist.

### Structured phase results
Every extraction phase returns:
```js
{ ok: boolean, stage: string, caption?: string, imageUrl?: string, reason?: string }
```
Progress callback signature: `onProgress(phaseIndex, status, message)`. The loading UI maps these to real progress updates.

---

## 4. Visual design system

### Single accent
- Primary: `#e65100` (warm orange) — all interactive elements, active states, progress bars
- Meal tint: warm neutral background on type pill
- Drink tint: cool neutral background on type pill
- Remove competing cyan/amber toggle colors

### Confidence chip
- Green dot + "95%" for high confidence (≥75%)
- Amber dot + "62%" for medium confidence (40-74%)
- No chip for low confidence — absence is more honest than a red warning

### Row simplification
- Reading state: drag-handle (⠿) + text + overflow button (...)
- Overflow menu: Move to ingredients/steps, Remove, Edit
- Touch targets: minimum 44px height on all interactive elements
- Drag handle: 44px × 44px touch area

### Accordion sections
- Default state: Ingredients open, Steps open, Notes collapsed, Caption collapsed
- Section header: icon + label + count badge + chevron
- Inner scroll: `max-height: 240px; overflow-y: auto` per section
- Collapse/expand with 200ms height animation

### Hero image
- Full-bleed within the scroll area, 160px height, border-radius
- Gradient overlay at bottom for title legibility
- Editable title input overlaid at bottom
- Confidence chip positioned top-right
- Fallback: colored gradient with food emoji placeholder (current no-img behavior, refined)

### Typography
- Section labels: 13px medium, secondary color
- Count badges: 11px medium, surface background, pill shape
- Row text: 14px regular
- Title input: 16px bold

### Spacing
- 8px base spacing scale (8, 12, 16, 24, 32)
- Hairline dividers (0.5px) between rows, not heavy borders
- 16px padding inside scroll body

---

## 5. Migration strategy

### Phase A: Engine reliability (no UI changes)
1. Thread `signal` through `importRecipeFromUrl` → all internal fetches
2. Parallelize Instagram cheap phases with `Promise.any`
3. Add structured phase results (`{ ok, stage, caption, reason }`)
4. Add 45s `Promise.race` wrapper
5. Make `importRecipeFromUrl` return `{ _needsBrowserAssist }` instead of throwing

### Phase B: Component scaffolding
1. Create `ImportSheet.jsx` with the three-phase state machine
2. Create `ImportInput.jsx` (extracted from ImportModal)
3. Create `ImportReview.jsx` (extracted from ImportModal)
4. Add `inline` prop to `BrowserAssist.jsx`
5. Wire ImportSheet into App.jsx, keep ImportModal alive as fallback behind `VITE_USE_IMPORT_SHEET` env flag

### Phase C: Visual polish
1. Collapse animation CSS
2. Hero image + confidence chip
3. Accordion sections with count badges
4. Simplified row controls
5. Single accent color system
6. Save destination grid in review footer

### Phase D: Cleanup
1. Delete ImportModal.jsx
2. Remove old CSS from App.css
3. Remove feature flag
4. `npm run build` verification

---

## 6. What's NOT in scope

- **Audio/video transcription (Phase 6)** — ASR scaffold exists on server but client integration deferred
- **Two-pane desktop layout** — mentioned in mockup for ≥720px; defer to a follow-up
- **Drag-down-to-dismiss gesture** — implement as a fast follow after the core flow ships
- **recipeTemplates.js cleanup** — dead code, low priority
- **Grocery/bar routing logic** — save-destination selection is UI only; actual routing logic exists
