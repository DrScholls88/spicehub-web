# Import Engine — Premium Design Critique

**Date:** 2026-06-11
**Scope:** ImportSheet.jsx / ImportInput.jsx / ImportReview.jsx / ImportSheet.css / BrowserAssist.jsx (render skim) / importCopy.js, judged against the 2026-06-06 redesign spec and high-end ("premium and seamless") standards.
**Excluded (known open items, not re-reported):** grocery screen restructure, drag-down-to-dismiss, `_saveDestination` wiring through footer save, and the three live bugs (Instagram photos missing, confidence score wrong, empty titles).

Severity scale: **P0** breaks the flagship promise on real devices · **P1** clearly below the premium bar, user-visible · **P2** quality/consistency erosion · **P3** polish.

---

## 1. Design Health Score (Nielsen heuristics, 0–4)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | Humanized progress copy is genuinely good; but the collapsed bar's status dot is hard-coded green, and nothing escalates during a long (45–60s) wait |
| 2 | Match system / real world | 3 | Culinary-voiced copy ("Sorting ingredients from instructions…") is excellent; emoji-as-icons undercut it |
| 3 | User control & freedom | 2 | Cancel + background-continue exist; but re-expanding the input bar from review silently abandons the parsed recipe, row deletion has no undo, no Escape/scrim dismiss |
| 4 | Consistency & standards | 2 | Two visual dialects coexist (sh-* tokens vs BrowserAssist ip-*/btn-primary); spacing and type scale drift everywhere |
| 5 | Error prevention | 2 | Misplaced-ingredient flags are a standout; but closing the sheet mid-review loses all edits with zero confirmation |
| 6 | Recognition over recall | 3 | Tabs, counters, destination cards are all visible-state; flag chip labels itself well |
| 7 | Flexibility & efficiency | 2 | Enter-to-import, arrow reorder good; the headline drag-to-tab interaction is mouse-only (HTML5 DnD), keyboard users can't open accordions |
| 8 | Aesthetic & minimalist | 3 | Single-accent system is disciplined; loading state is *too* minimal for the wait it covers |
| 9 | Error recovery | 2 | One generic banner with "Dismiss"; spec §1 promised retry / "Try in browser" / "Paste manually" actions — not built |
| 10 | Help & documentation | 3 | Photo hint and BrowserAssist's numbered manual steps are strong |
| **Total** | | **25/40** | Solid mid-tier. The bones are premium; the execution leaks at touch, motion, and recovery seams. |

---

## 2. Anti-pattern verdict — does it look AI-generated?

**Mostly no, with three tells.** The warm cream + single orange accent palette, hairline dividers, pill geometry, and the consistent `cubic-bezier(0.32, 0.72, 0, 1)` spring all read as intentional product design, not template output. The misplaced-ingredient banner and the tab-as-drop-target idea are genuinely original interaction design.

The tells that cheapen it:

1. **Emoji as the entire icon system** (🥕 📝 📚 📅 🛒 🍹 ⚠ ✖ ☰ ▼ — `ImportReview.jsx:355–356, 519–521`, `ListItem`, accordion chevrons). Emoji render differently per OS, can't be tinted to the accent, and sit at inconsistent optical sizes. This is the single biggest "not a $150k build" signal in the flow.
2. **The empty Instagram-gradient square** (`.import-input-social-icon`, ImportSheet.css:429–435) — a 44px gradient block with no glyph inside it looks like a placeholder that shipped.
3. **Generic dead-end error copy** ("Could not extract a recipe from this URL.") — stock parser-speak in a flow whose loading copy has a real voice.

---

## 3. What's working (keep these)

- **The microcopy system is the best part of the flow.** `importCopy.js` mapping dev jargon → "Grabbing the recipe caption…" is exactly right, and preserving raw messages in `console.debug` is smart engineering. "Looks like an ingredient slipped into the steps" + one-tap "Move all to Ingredients" (`ImportReview.jsx:426–433`) is premium CX writing.
- **One easing curve everywhere.** `[0.32, 0.72, 0, 1]` is shared across CSS (`--sh-spring`) and framer-motion constants (`ImportInput.jsx:6`, `ImportReview.jsx:5`). That kind of motion-token discipline is rare and correct.
- **Honest confidence badge.** Letting visible flags override the raw score (`ImportReview.jsx:297–299`) — "Review needed" instead of a lying green "High 92%" — is a real design-ethics win, straight from spec §6 F.1.
- **E.4 background-continue + ready toast with haptic** (`ImportSheet.jsx:224–253`) is the kind of flow-respecting feature premium apps have and clones don't.

---

## 4. Priority issues

### Interaction model

**[P0] The flagship drag interaction doesn't exist on phones.**
- **Evidence:** `ImportReview.jsx:80–83` — `ListItem` uses HTML5 `draggable` + `onDragStart/onDragOver/onDrop`; the cross-list "drop a row on the inactive tab" feature (`ImportReview.jsx:362–367`, `.review-tab.drag-over`) is built entirely on the same API. HTML5 drag-and-drop **does not fire on iOS/Android touch input at all.** This is a mobile-first PWA; the marquee F.6 interaction is desktop-only. Worse, `draggable` on the whole row can interfere with text selection inside the row's `<input>` on desktop.
- **Fix:** Replace HTML5 DnD with framer-motion's `Reorder.Group`/`Reorder.Item` (already a dependency) for same-list reorder, and implement cross-list moves via a long-press → `drag` gesture using `useDragControls`, with the tab drop zone hit-tested via `onDrag` point coordinates. Restrict the drag initiation to the `.review-row-handle` (`dragListener={false}` + `dragControls.start(e)` on the handle's `onPointerDown`). Keep the arrow buttons and flag chips as the accessible fallback they already are. Until that lands, the "Ingredient? ↑" chip is the *only* cross-list affordance on mobile — make it the documented primary, not a fallback.

**[P1] Re-expanding the input bar from review destroys the parsed recipe.**
- **Evidence:** `ImportSheet.jsx:216–221` — `handleReExpand` sets `phase('input')` unconditionally. From review, tapping the collapsed bar (whose label is just the URL + a pencil) drops the user back to input; the review UI and any row edits vanish from view, and the only way "back" is to re-run the entire import. Spec §1 explicitly says re-expand is "non-destructive."
- **Fix:** In `handleReExpand`, snapshot `{recipe, confidence}` to a `lastReviewRef` before switching phases; if the user re-expands and then dismisses the input without importing (add an explicit "← Back to review" text button under the expanded form when `lastReviewRef.current` exists), restore `phase('review')` with the snapshot. Only a *new* import should replace it — and that new import should warn: "This will replace the recipe you're reviewing."

**[P1] Closing the sheet mid-review silently discards everything.**
- **Evidence:** `ImportSheet.jsx:265–271` — the × button calls `onClose()` directly in every phase. After a 45s import plus manual row edits, one mis-tap on the 34px close button (top-right, prime thumb-stretch territory) loses all work. No confirm, no undo, no draft persistence.
- **Fix:** When `phase === 'review'`, intercept close with a lightweight confirm: a two-button inline footer swap ("Discard recipe?" / **Keep editing** · Discard) rather than `window.confirm`. Cheaper still: persist the in-flight review draft to IndexedDB (`db.js` is already imported in ImportSheet) keyed by URL, and offer "Resume your last import?" on next open — that's also your Offline Sovereignty principle applied to the import flow.

**[P1] The input-phase footer is a permanently disabled primary CTA.**
- **Evidence:** `ImportSheet.jsx:380–388` — `<button … onClick={() => {}} disabled>Import recipe</button>`. It never enables; the real submit lives in per-tab buttons inside the form (`ImportInput.jsx:168–175, 199–205`). Users see the app's biggest, most prominent button permanently greyed out — that reads as broken, and it duplicates the URL row's own "Import" button (two competing CTAs for one action).
- **Fix:** Make the footer CTA the single submit. Lift the form state up (or expose an imperative `submit()` via `useImperativeHandle` on ImportInput plus a `canSubmit` callback), enable the footer button when the active tab has content, and demote the in-row "Import" button to an icon-only `→` affordance or remove it. Spec §1 already says the sticky footer owns "Import recipe →".

**[P2] Spec'd error recovery actions were never built.**
- **Evidence:** `ImportSheet.css:265–288` + `ImportSheet.jsx:277–291` — the error banner offers only "Dismiss". Spec §1 loading state: "show inline error toast with **retry + 'Try in browser' + 'Paste manually'** options."
- **Fix:** Add up to three pill actions to the banner: `Retry` (re-call `handleUrlImport(importUrl, itemType)`), `Open in browser assist` (`setPhase('browserAssist')` — `importUrl` is already in state), `Paste instead` (`setTab('paste')` via a forwarded ref/prop). Copy rewrite below (§7).

**[P2] Batch import (spec §1) is absent with no trace.** Multiple pasted URLs go through `cleanUrl` as one string. If batch is deferred, at minimum detect `\n`-separated URLs in `handleUrlImport` and import the first with a notice ("Importing the first link — batch import coming soon") instead of silently failing the whole string. Otherwise this is a spec gap to schedule.

### Motion quality

**[P1] `mode="wait"` + height-auto animations create visible dead gaps and double-jumps at the flow's most-watched moment.**
- **Evidence:** Three stacked problems:
  1. `ImportInput.jsx:101–130` — collapsed ⇄ expanded swap uses `AnimatePresence mode="wait"` where **both** branches animate `height: 0 ⇄ 'auto'`. The exiting branch collapses to 0 (250ms), *then* the entering branch grows from 0 (250ms): a 500ms two-beat accordion stutter with an empty gap in the middle, on every loading start and every re-expand.
  2. `ImportSheet.jsx:306–375` — phase content also uses `mode="wait"`, and the review entry adds `delay: 0.1` (`:339`), so loading→review shows ~300ms of blank sheet before the hero fades in.
  3. Animating `height: 'auto'` (also error banner `:281–283`, accordion `ImportReview.jsx:50–53`) forces layout/reflow every frame inside a scrolling sheet — the exact jank class the GPU-safe rule exists to prevent. On mid-tier Android this will visibly hitch while the Gemini call resolves.
- **Fix:**
  - ImportInput: drop `mode="wait"` → use `mode="popLayout"` or no mode, and crossfade with `position: absolute` on the exiting element so enter/exit overlap. Better: don't unmount at all — keep one container and animate between two measured states with `layout` on a shared parent.
  - ImportSheet phases: switch to `mode="popLayout"` with a 40ms overlap instead of `wait` + delay; loading→review should feel like the status line *becomes* the hero (shared `layoutId` on the progress dot → confidence chip is a cheap, premium continuity trick).
  - Height: where expand/collapse must animate size, animate `max-height` via CSS (as spec §1 actually specified) or wrap content in a fixed-measured container and animate `transform: scaleY` + inner counter-scale only for ≤200ms micro-collapses; for the error banner, the height animation is acceptable (small, rare) but add `will-change: height` removal after settle.

**[P1] No `prefers-reduced-motion` anywhere — CSS or framer.**
- **Evidence:** zero matches in ImportSheet.css; no `MotionConfig` / `useReducedMotion` in any JSX. The pulsing dot (`sh-dot-pulse`, infinite), sheet slide-up, accordion springs, and toast all animate unconditionally. This is a WCAG 2.3.3 / OS-setting violation and a hard fail for "premium" — every system-respecting app honors this.
- **Fix (two lines of leverage):**
  1. Wrap the sheet's children in `<MotionConfig reducedMotion="user">` (framer then auto-disables transform/layout animations).
  2. Add to ImportSheet.css:
     ```css
     @media (prefers-reduced-motion: reduce) {
       .import-sheet, .import-sheet-overlay, .import-input-collapsed,
       .import-review, .import-sheet-loading, .import-sheet-error { animation: none; }
       .import-sheet-progress-dot { animation: none; opacity: 1; }
     }
     ```
     Keep the dot visible-but-static so status isn't lost.

**[P2] Progress-text swap can strobe.**
- **Evidence:** `ImportSheet.jsx:318–329` — nested `AnimatePresence mode="wait"` keyed on `progressMsg`. The engine can emit several status callbacks within a second during phase fallbacks; each triggers a 180ms exit + 180ms enter, so rapid sequences strobe and `mode="wait"` queues blanks.
- **Fix:** Debounce/throttle display updates: hold each message a minimum of 900ms (small `useEffect` queue), and animate only `opacity` + `y` on the entering element (no wait-gap — render old and new stacked with `position: absolute` during the 180ms cross).

**[P3] Inline style mutation during drag fights React.** `ImportReview.jsx:205, 239` set `e.currentTarget.style.opacity` directly. Move to a `dragging` class / framer `whileDrag={{ opacity: 0.45 }}` when DnD is rebuilt.

### Loading experience & perceived speed

**[P1] A 10px dot is carrying a 45–60 second wait.**
- **Evidence:** `.import-sheet-loading` (ImportSheet.css:235–262) — pulsing dot + one 13px muted line, `padding: 32px 0`, in an otherwise empty sheet. The import budget is 45s (spec §3) with a 60s global ceiling. There is no determinate signal, no elapsed-time escalation, no preview of what's coming. Perceived duration is governed by visual occupation; this state maximizes it.
- **Fix (in impact order):**
  1. **Skeleton the destination.** Render a shimmer skeleton of the review layout (hero block 172px, two tab pills, 5 ghost rows) behind/below the status line. The user "sees" the recipe assembling; loading→review then becomes skeleton→content, killing the mode="wait" gap too.
  2. **Show what you already have, early.** The engine captures captions/thumbnails mid-flight (`capturedCaption`, Apify image). Pipe the first captured image into the skeleton hero as soon as it exists — Instagram imports would show *their* food photo within ~2–4s, which transforms the wait.
  3. **Escalate copy on a timer:** at 8s append a second line "Instagram is being slow — still on it…"; at 25s surface the "Continue in background" button *inside the body* (it currently hides in the footer where nobody looks during a wait), styled as the recommended action.
  4. Keep the dot, but pair it with the BrowserAssist-style step checklist for social URLs (the `ip-steps` pipeline already exists at `BrowserAssist.jsx:1040–1066` — it's better than the sheet's own loading state; unify them, see §5 consistency).

**[P2] The collapsed status bar lies.**
- **Evidence:** `.import-input-collapsed-dot` (ImportSheet.css:534–540) is hard-coded `background: var(--sh-conf-high)` (green) in *all* phases — green while loading, green after an error returns you to input.
- **Fix:** Drive the dot from phase: loading → `--sh-accent` + reuse `sh-dot-pulse`; review → green static; error → `#b91c1c`. Pass `phase` into ImportInput or set a `data-phase` attribute on the bar.

### Visual system: typography, spacing, color

**[P2] The type scale is a near-continuum, not a scale.**
- **Evidence:** 10, 11, 12, 13, 14, 15, 16, 17, 18px all appear in ImportSheet.css (e.g. `:120` 17px header, `:170` 15px buttons, `:314` 13px tabs, `:743` 11px badge, `:1064` 10px reorder glyphs). Adjacent 1px steps (13 vs 14 vs 15) read as accidents, not hierarchy, and 10–11px copy (`.review-confidence`, `.review-flag-chip`, `.drop-hint`, `.review-accordion-count`) is below comfortable mobile legibility.
- **Fix:** Collapse to a 5-step scale and tokenize it: `--sh-fs-xs: 12px` (badges, counts — nothing smaller), `--sh-fs-sm: 13px` (meta/labels), `--sh-fs-base: 15px` (rows, inputs, buttons), `--sh-fs-lg: 17px` (sheet title, hero title), `--sh-fs-xl: 20px`. Map: tabs 13→`sm` is fine but rows 14→`base` (15px) improves edit legibility; reorder glyph 10px→ swap glyph for a 16px icon; confidence chip 11→12px.

**[P2] The "8px spacing scale" exists in the header comment only.**
- **Evidence:** ImportSheet.css declares "8px spacing scale" (`:5`) then ships `margin: 9px auto 0` (`:104`), `padding: 13px 14px` (`:376`), `gap: 3px` (`:304`), `padding: 4px 11px` (`:612`), `padding: 11px 8px` (`:780`), `gap: 7px` (`:772`), `padding: 6px 0` (`:846`). Off-grid values are invisible individually and corrosive collectively — they're why the sheet feels slightly "hand-made" rather than machined.
- **Fix:** One pass snapping everything to 4/8/12/16/20/24. Concretely: grab-handle margin 9→8; url input padding 13px 14px→12px 14px (14 is fine as 2×7? no — use 12px 16px); tab gap 3→4; confidence chip 4px 11px→4px 12px; tab padding 11px 8px→12px 8px; row gap 7→8.

**[P1] Contrast failures, light and dark.**
- **Evidence & math:**
  - `--sh-text-muted: #999` on `--sh-bg: #fff8f0` ≈ **2.7:1** — used for the 13px progress text (`.import-sheet-progress-text`), photo hint, placeholders. Fails WCAG AA (4.5:1) badly, on the most-read line in the flow.
  - Dark `--sh-text-muted: #7a7068` on `#1a1714` ≈ **3.6:1** — also fails for small text.
  - `--sh-accent: #e65100` as small text on cream (paste-submit button text, error "Dismiss", `.review-add-row`, source links) ≈ **3.7:1** — fails AA for <18px text.
  - White on `--sh-accent` (primary buttons, 15px/700) ≈ **3.8:1** — under the 4.5 threshold (15px bold doesn't qualify as "large").
  - `--sh-conf-mid: #b26a00` at 11px/700 on the white chip ≈ **4.2:1** — marginal fail at a tiny size.
- **Fix (exact values):** `--sh-text-muted: #7d756c` (light, ≈4.6:1 on #fff8f0) and `#988e82` (dark). Introduce `--sh-accent-text: #c64500` (≈4.6:1 on cream) and use it for all accent-colored *text* under 18px, keeping `#e65100` for fills/borders/chips. For primary buttons either darken the fill to `#d34a00` (white text ≈4.5:1) or bump label to 16px/700 and accept 3:1 large-text under AA's bold≥18.66px is still not met — darkening the fill is the clean fix and barely shifts the brand hue. `--sh-conf-mid: #9a5b00`.

**[P1] Touch targets repeatedly under the app's own 44px rule.**
- **Evidence (spec §4: "minimum 44px height on all interactive elements"; CSS header comment promises the same):
  - `.import-sheet-close` 34×34 (`:127–128`)
  - `.import-input-collapsed` `min-height: 40px` (`:523`) and its pencil `.import-input-collapsed-edit` `padding: 4px` ≈ 22px hit area (`:551–558`)
  - `.review-row-more` 32×32 (`:896–897`), `.review-row-reorder` 28×28 (`:1058–1059`) — and **two** of them sit adjacent per row with no gap compensation
  - `.review-flag-chip` `min-height: 28px` (`:668`)
  - `.review-flag-banner button` 36px (`:648`)
  - `.review-row-handle` 26px wide (`:853`) vs spec's "drag handle: 44×44 touch area"
- **Fix:** Keep visual sizes, expand hit areas: give each small control `position: relative` + `::after { content:''; position:absolute; inset:-8px; }` (close button: inset -5px to reach 44). For rows, the three stacked 28–32px buttons in a 44px row are a fat-finger minefield — replace ▲▼× with the spec'd single `…` overflow menu (44×44) opening a small action sheet (Move up / Move down / Move to ingredients / Remove). That also fixes the row's visual noise (4 controls + flag chip on one 14px line).

**[P2] Hairlines at 0.5px disappear on 1× screens.** `border-bottom: 0.5px solid` (`:115, :157, :847`) renders as nothing or full 1px unpredictably on non-retina Android/desktop. Use `box-shadow: 0 1px 0 var(--sh-border-light)` scaled, or `border-width: 1px` with a lighter color (`#f4efe7`) to get the same optical weight reliably.

**[P2] Destination grid orphan.** `.review-destination-grid` is `1fr 1fr` (`:1004`) but meals have 3 destinations (`ImportReview.jsx:307–311`) → Library/This Week on row one, Grocery alone half-width below. Unbalanced at the decision moment. **Fix:** `grid-template-columns: repeat(3, 1fr)` for meals (cards already center-stack icon+label fine at ~110px) and `repeat(2, 1fr)` for drinks; or make the third card span both columns deliberately with a horizontal layout.

**[P3] Hero title input is a white slab in dark mode.** `.review-hero-title` hard-codes `rgba(255,255,255,0.92)` + `#2c2c2c` (`:688, :697`). It works, but a true premium dark treatment is `rgba(26,23,20,0.72)` + `backdrop-filter: blur(8px)` + `color: var(--sh-text)` under `[data-theme="dark"]` — the glass should belong to the theme.

**[P3] Dark-mode scrim is light-tuned.** `rgba(20,15,10,0.45)` (`:54`) is too weak over a dark app — the sheet edge mushes into the page. Add `[data-theme="dark"] .import-sheet-overlay { background: rgba(0,0,0,0.6); }`.

### Accessibility (beyond the items above)

**[P1] The sheet is not a dialog to assistive tech, and keyboard users can't leave or stay in it.**
- **Evidence:** `ImportSheet.jsx:257–258` — overlay and sheet are bare `<div>`s. No `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby` pointing at the `<h2>`, no focus trap, no initial focus move, no focus restoration on close, no Escape handler, and the scrim isn't tappable to dismiss. Screen-reader and keyboard users can tab straight out into the page behind the scrim.
- **Fix:** `role="dialog" aria-modal="true" aria-labelledby="import-sheet-title"` on `.import-sheet`; on mount, focus the close button (or the URL input); trap Tab within the sheet (a 20-line `useFocusTrap` or `focus-trap-react`); `onKeyDown` Escape → same path as close (with the review-phase confirm from above); `onClick` on the overlay (self-target check) → close.

**[P1] Accordion headers are click-only divs.**
- **Evidence:** `ImportReview.jsx:34` — `<div className="review-accordion-head" onClick=…>`. Not focusable, not announced, no `aria-expanded`. Notes and Drink Details are unreachable by keyboard/switch access.
- **Fix:** Make the head a `<button type="button" aria-expanded={open} aria-controls={bodyId}>` with `width:100%; text-align:left; background:none; border:none;` — zero visual change.

**[P2] Loading status is silent to screen readers.** The progress text region (`ImportSheet.jsx:319–328`) has no `aria-live`. Add `aria-live="polite" role="status"` to `.import-sheet-loading`'s text container (the backgrounded toast already does this correctly — `:239`).

**[P2] Remaining semantics:** review tabs should be `role="tablist"/"tab"` with `aria-selected` (or at least `aria-pressed`); the social card (`ImportInput.jsx:178`) is a clickable div — make it a `<button>`; collapsed bar handles Enter but not Space (`ImportInput.jsx:109`); tab counters animate on a `key` remount (`ImportReview.jsx:371`) — harmless, but add `aria-label={`${count} items`}` so the count is announced with the tab.

**[P3] `autoFocus` on the URL input** (`ImportInput.jsx:166`) pops the keyboard over the bottom sheet instantly on mobile, covering the Paste/Photo tabs before the user has seen them. Defer focus ~250ms (after the sheet-up animation) and skip it entirely when `sharedContent` is present (an import auto-starts anyway).

### Consistency & microcopy

**[P1] Two design systems live inside one flow.**
- **Evidence:** BrowserAssist renders inline (`browser-assist-inline`) inside the sheet but uses an entirely different visual dialect: `btn-primary`, `ip-parse-btn`, `ip-pipeline`, its own spinners, its own step checklist, its own error styles (`BrowserAssist.jsx:976–1185`). The fallback path — the exact moment trust is most fragile — visibly changes apps. Notably its `ip-steps` loading pipeline is *better* than ImportSheet's dot; the polish gradient runs the wrong way.
- **Fix:** Phase the ip-* surfaces onto sh-* tokens: map `ip-parse-btn`→`import-sheet-btn import-sheet-btn-primary`, `ip-skip-btn`→`-ghost`, repaint `ip-step` colors with `--sh-accent`/`--sh-conf-high`, and adopt the `ip-steps` checklist as the *shared* loading component for social imports in both contexts.

**[P2] Copy rewrites (exact strings):**
| Where | Current | Rewrite |
|---|---|---|
| ImportSheet.jsx:120 | "Could not extract a recipe from this URL." | "We couldn't find a recipe at that link. Try pasting the recipe text instead?" (+ `Paste instead` action) |
| ImportSheet.jsx:151 | "Could not parse a recipe from the pasted text." | "That text didn't look like a recipe to us. Add the ingredients or steps and try again." |
| ImportSheet.jsx:181 | "Could not extract a recipe from this image." | "We couldn't read a recipe in that photo. Try a brighter shot, or paste the text instead." |
| ImportSheet.jsx:369 | "Visual extraction failed. Try pasting the recipe text." | "That page wouldn't cooperate. Paste the recipe text and we'll sort it for you." |
| ImportInput.jsx:165 | "Paste recipe URL..." (three periods) | "Paste a recipe link…" (real ellipsis — the rest of the flow uses `…`) |
| ImportInput.jsx:182 | "Recipe detected — tap to import" | "Instagram post spotted — tap to import" (it hasn't detected a *recipe* yet; don't overpromise, the platform name is already in `<strong>`) |
| ImportSheet.jsx footer:415 | "Save to library" (static) | Bind to selection: "Save to {Library/This Week/Grocery/Bar}" — the destination grid currently changes nothing visible in the CTA, so selecting a card feels inert. (Label binding is independent of the known `_saveDestination` wiring task.) |
| importCopy.js:23 | "Working on your recipe…" | Fine as fallback, but add the 8s/25s escalation lines from the loading fix: "Still working — some sites are slow to share…" |

**[P3] Title duplication.** Sheet header says "Import Recipe" while the input-phase footer says "Import recipe" — the disabled CTA reads like a caption echo. Resolved automatically by the footer-CTA fix.

### State coverage gaps

- **[P2] Offline:** BrowserAssist has a real offline state (`BrowserAssist.jsx:980–988`), ImportSheet has none — submitting a URL offline burns into `loading` until timeout. Check `navigator.onLine` in `handleUrlImport` and short-circuit: "You're offline. We'll import this as soon as you're back — or paste the recipe text now." (queue per the Offline Sovereignty principle; `db.js` is already imported).
- **[P2] Empty review lists:** a parse returning 0 ingredients renders just "+ Add ingredient" under the tabs. Add an empty-state line: "We didn't find ingredients — add them here, or drag any from Steps." (also covers the live empty-title bug's blast radius).
- **[P3] Long titles:** `.review-hero-title` is a single-line input; long Instagram titles scroll invisibly. Acceptable, but add `text-overflow` styling is impossible on focused inputs — instead show the full title as `title=` attribute and keep the >7-word heuristic (spec F.4) doing the heavy lifting.
- **[P3] Photo tab dead code:** `cameraRef` input (`ImportInput.jsx:228–235`) is never triggered by any button — either add a second "Take photo" button (mobile delight: direct camera) or delete the node.

---

## 5. Persona red flags

**Maya (Instagram-first home cook, iPhone, the target user):** Shares a Reel → sheet opens → keyboard pops over everything (autoFocus) even though the import already auto-started → stares at a single dot for 30s with no food image → recipe arrives with two ingredients stuck in Steps → tries to drag them onto the Ingredients tab as the UI's highlighted drop-target styling suggests → **nothing happens, drag doesn't work on touch** → eventually finds the "Ingredient? ↑" chip (28px, misses twice) → picks "This Week" destination → button still says "Save to library" → hesitates. She got there, but every step paid a tax.

**Devon (accessibility user, VoiceOver):** Sheet opens with no dialog announcement; focus stays on the page behind the scrim. Progress messages never announced. Cannot open Notes (div accordion). Cannot dismiss with Escape. For Devon this flow is effectively unshipped.

**Sam (power user, desktop PWA):** Enter-to-import works (good). Drag-and-drop works for him — but mid-drag the row's text gets selected because the whole row is `draggable`. Re-expands the input bar to fix a typo'd URL and loses 4 minutes of row edits. Will not trust the importer with long recipes again.

---

## 6. Provocative questions

1. What if loading *was* the review screen — a skeleton that fills in field-by-field as the engine reports phases — so there is no transition to gap at all?
2. The misplaced-ingredient flag is your smartest moment. Why does it live in a 28px chip instead of being the hero of the review screen when flags exist?
3. If the inactive tab is a drop target, should the *count badge* fly +1 when a row lands (spec F.6's "fly-away animation") — the one piece of choreography that would make this feel hand-built?
4. Should "Continue in background" be the default after 10 seconds, instead of a button nobody reads in the footer?

---

## 7. Top-10 prioritized fix list

| # | Sev | Fix | Files |
|---|-----|-----|-------|
| 1 | P0 | Replace HTML5 drag-and-drop with framer-motion `Reorder` + pointer-based cross-list drag; handle-only initiation; keep arrows/chips as a11y fallback | ImportReview.jsx |
| 2 | P1 | Dialog semantics + focus trap + Escape + scrim-tap close + focus restore | ImportSheet.jsx |
| 3 | P1 | Make re-expand non-destructive (snapshot/restore review) and confirm before close-with-edits; persist draft to IndexedDB | ImportSheet.jsx |
| 4 | P1 | Loading overhaul: review-layout skeleton, early captured-image hero, 8s/25s copy escalation, surface background-continue in body | ImportSheet.jsx, ImportSheet.css |
| 5 | P1 | Contrast pass: `--sh-text-muted: #7d756c`/`#988e82`, `--sh-accent-text: #c64500`, primary fill `#d34a00`, `--sh-conf-mid: #9a5b00` | ImportSheet.css tokens |
| 6 | P1 | Touch targets: pseudo-element hit expansion on close/pencil/chips; replace per-row ▲▼× cluster with single 44px `…` overflow menu (spec §4) | ImportSheet.css, ImportReview.jsx |
| 7 | P1 | Enable the footer "Import recipe" CTA as the single submit; kill the dead disabled button; bind review CTA label to selected destination | ImportSheet.jsx, ImportInput.jsx |
| 8 | P1 | Motion: drop `mode="wait"` gaps (popLayout/crossfade), remove review entry delay, stop animating `height:auto` in the collapse swap, add `MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion` block | ImportSheet.jsx, ImportInput.jsx, ImportSheet.css |
| 9 | P2 | Error banner actions (Retry / Browser assist / Paste instead) + copy rewrites table in §4; offline short-circuit in `handleUrlImport` | ImportSheet.jsx, ImportInput.jsx |
| 10 | P2 | System unification: emoji → single light icon set; BrowserAssist ip-* surfaces onto sh-* tokens (adopt its step checklist as the shared social loading component); snap spacing to the 8px grid; 5-step type scale tokens; 3-col destination grid | ImportSheet.css, ImportReview.jsx, BrowserAssist.jsx |

**Bottom line:** the flow's information design, copy voice, and motion-token discipline are already above average — but the flagship interaction silently doesn't work on the platform this PWA is for, the longest wait in the app is visually empty, and the sheet is invisible to assistive tech. Fix #1–#4 and this genuinely clears the "premium and seamless" bar; the rest is the difference between cleared and effortless.
