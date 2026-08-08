# Hero Micro-Canvas Implementation Plan

**Goal:** Give each `AppIntroHero` stage a small looping animated "micro-canvas" mockup (per the Gemini landing-page doc) instead of today's icon + one line of text, and add a 4th stage for Smart Grocery BOM (the doc's pitch — confirmed this is a real, already-shipped feature: `GroceryList.jsx` assigns items to `item.store` via remembered `storeMemory` mappings and consolidates duplicate ingredients).

**Decision locked in with user (2026-08-08):** Grocery BOM is a **4th stage**, not a replacement for "Cook what you have." Carousel goes from 3 stages to 4. Auto-advance loop grows from ~13s to ~17s at the current 4.2s/stage pace — flagged as a design nit in Package D6, not a blocker.

**Non-negotiable constraint:** `AppIntroHero.jsx`'s existing carousel shell (auto-advance, touch/drag pause, swipe, debounced index changes, progress-fill dots, ARIA roles) is already more robust than the Gemini doc's own carousel code and must not be rebuilt. This plan only adds a `renderGraphic` slot per stage — it does not touch the swipe/pause/dot mechanics.

**Tech note:** the Gemini doc's code samples are Tailwind + `className`. This codebase does not use Tailwind for components (inline `style` objects + CSS custom properties from `design.md`, same convention as every other component touched in this session). All graphics below are specced in that convention, not Tailwind.

---

## Current State

`src/components/landing/AppIntroHero.jsx`:
- `STAGES` array: 3 entries (`import`, `spin`, `cook`), each `{ id, icon, title, subtitle, color }`
- Renders: icon in a 34×34 rounded box + title + subtitle, no per-stage graphic
- Stage viewport `minHeight: 58px` — sized for icon+text only, **will need to grow** once a graphic is added
- Auto-advance 4.2s per stage, pauses on touch/pointer down, resumes on up, 250ms swipe debounce, drag-to-navigate

## Target State

Same shell, `STAGES` grows to 4 entries, each gets a `renderGraphic: () => JSX` field (function, not pre-rendered JSX, so it can be lazily invoked only for the active stage — avoids 4 concurrent looping animations running offscreen). Stage viewport grows to a fixed height (~150–160px) that fits graphic + title + subtitle without reflow when swiping between stages (all stages must reserve the same footprint).

---

## File Structure

### New Files
- `src/components/landing/stageGraphics/ImportGraphic.jsx` — URL bar → recipe card morph
- `src/components/landing/stageGraphics/PlanGraphic.jsx` — slot-machine day-slot reveal
- `src/components/landing/stageGraphics/GroceryGraphic.jsx` — ingredient → store-lane routing
- `src/components/landing/stageGraphics/CookGraphic.jsx` — pantry-match highlight (not in the Gemini doc — added so all 4 stages are visually consistent instead of 3 rich graphics + 1 bare icon)
- `src/components/landing/stageGraphics/index.js` — barrel export

### Modified Files
- `src/components/landing/AppIntroHero.jsx` — add `GROCERY` stage entry, add `renderGraphic` per stage, add graphic container to the stage viewport, bump `minHeight`

---

## Package D1: Carousel Shell — Graphic Slot

**File:** `AppIntroHero.jsx`

- Add a fixed-height graphic container (`height: 92px` suggested, tune after visual check) directly above the existing icon+title+subtitle block, inside the same swipeable `motion.div` so it enters/exits with the rest of the stage content (no separate animation timing to manage).
- `STAGES[i].renderGraphic()` is called only while that stage is the active `AnimatePresence` child — because `AnimatePresence mode="wait"` already unmounts the previous stage before mounting the next, this is free: an offscreen stage's graphic component is never mounted, so it never runs its `useEffect`/looping timers. No extra visibility-gating code needed beyond what's already there.
- `STAGES[i].color` stays as the accent (icon tint, active dot fill) — graphics use the same `stage.color` for their accent details so a stage reads as one coherent color story (icon, graphic highlight, and dot all match).
- Bump outer card `minHeight`/padding so the card doesn't visually jump in height between the 3 old stages and the new taller ones — since all 4 will now reserve the same graphic height, this is a one-time size increase, not per-stage jitter.
- Respect `prefers-reduced-motion`: graphics should render their *end state* immediately (no looping) when the media query matches — add a tiny `useReducedMotion()` (Framer Motion ships this hook) check shared via a `stageGraphics/useGraphicMotion.js` helper, so each graphic file doesn't reimplement the check.

**Effort:** small — this is layout/plumbing, no new animation logic.

---

## Package D2: Import Graphic — URL → Recipe Card Morph

**File:** `stageGraphics/ImportGraphic.jsx`

- Element 1: a pill styled like the existing `.pc-name-input`/token-based input chrome (`background: var(--surface-2)`, `border: 1px solid var(--border)`, monospace-ish text) reading `instagram.com/reel/C8x9Y…`, with a subtle opacity pulse (`animate={{opacity:[0.5,1,0.5]}}`, `repeat: Infinity`) — same pulse technique the doc used, ported off Tailwind.
- ~1.2s in, cross-fade/scale that pill down and reveal a small recipe-card mockup below it: 28×28 thumbnail placeholder (a rounded box tinted `stage.color` at low opacity — no real image asset), fake title text, small `⏱ 35m` + `🏷 Pasta` tag row, and a green `✓ Parsed in 0.8s` badge that pops in last with a spring.
- Loop: after the reveal holds ~1.8s, fade both back out and restart from the pill — implement as a `useEffect` interval inside the component (safe, since it only mounts while the stage is active per D1) rather than trying to time it against the parent's 4.2s auto-advance; the two timers don't need to be synchronized, the graphic just needs to be mid-loop-and-legible at any random point the user glances at it.

**Effort:** medium — 2-phase crossfade + one badge pop, all Framer Motion primitives already used elsewhere in this codebase (BarShelf, ProfileCard's `stg-pulse`).

---

## Package D3: Plan Graphic — Slot-Machine Reveal

**File:** `stageGraphics/PlanGraphic.jsx`

- 3 mini day-slot boxes (`MON` / `TUE` / `WED`) laid out horizontally, each a small bordered box matching the existing dot/card token styling.
- On mount: a small 🎲 rotates 360° (`animate={{rotate: 360}}`, ~0.6s), then each slot springs in staggered (`delay: idx * 0.15`, `type: 'spring', stiffness: 300`) revealing a placeholder meal name (`Salmon` / `Tacos` / `Ramen` — matches the real rotation-planner naming style already used in `weekPlanner.js` test fixtures, not generic filler).
- Skip the doc's "motion-blur slot reel spin" — expensive to fake convincingly with CSS/SVG and this project's `useRotationEngine.js` already has a real spin/reroll interaction elsewhere (the actual "Spin the Week" tile); the hero graphic's job is to *tease* that interaction, not duplicate its full animation, so a clean stagger-spring reveal reads better at this size and is cheaper to run on a low-end Android phone.
- Loop: reset all 3 slots to hidden and re-run the stagger every ~3s while mounted.

**Effort:** small-medium — reuses stagger+spring patterns already in the codebase (Pantry catalog reveal, BarFridgeMode item drops).

---

## Package D4: Grocery Graphic — Ingredient Routing

**File:** `stageGraphics/GroceryGraphic.jsx`

- Left: a small "Unsorted" chip stack — 3 floating ingredient pills (`Onions`, `Salmon`, `Heavy Cream`), matches `GroceryList.jsx`'s real unsorted-items concept (`rawUnsorted` in the current code), not invented.
- Right: two labeled lane boxes using generic-but-plausible store names (`Costco`, `Trader Joe's` — same as the doc; landing page is pre-login, so it's fine that this is illustrative rather than pulling the current user's real `storeMemory`).
- Animation: a thin horizontal "scan line" (`div` with a gradient background, animated `top`/`y` position) sweeps down once; as it crosses each pill, that pill translates (`animate={{x, y}}` to the matching lane's position) and fades into the lane list. Stagger the 3 pills' scan-cross times slightly so it doesn't read as one simultaneous jump.
- Closing beat: a small `+1` merge pulse on `Onions` if you want to show quantity consolidation (optional — matches doc's "1 Onion + 1 Onion = 2 Onions" beat, but only worth it if D4 is otherwise under budget; cut first if the package needs to be trimmed).
- Loop: reset all pills to the unsorted pile and re-run every ~3.5s.

**Effort:** medium-high — this is the most complex graphic (per-pill trajectory + lane reflow). If cutting scope anywhere, cut the merge-pulse beat here first, then simplify to 2 pills instead of 3.

---

## Package D5: Cook Graphic + Stage Reorder

**File:** `stageGraphics/CookGraphic.jsx`, `AppIntroHero.jsx`

- Not in the Gemini doc — added for visual parity so 3 stages aren't rich and 1 is bare.
- Small pantry grid (4-6 tiny ingredient icons/dots), 2-3 highlight (`stage.color` glow ring) in sequence with a small `✓ You have this` tag appearing next to a mini recipe-name chip, echoing the doc's visual language without copying a beat that doesn't belong to this feature.
- Insert `GROCERY` stage into `STAGES` as the **4th** entry (after `cook`, per the "add, don't replace" decision) — confirm dot row and `AnimatePresence custom={direction}` still work correctly with 4 entries (they should; `STAGES.length` is already used generically throughout the modulo math, nothing hardcodes "3").

**Effort:** small (graphic) + trivial (array insert + `STAGES.length`-driven code already generic).

---

## Package D6: Perf, Reduced-Motion, iOS Pass

- Confirm only the *active* stage's graphic component is ever mounted (see D1) — verify with React DevTools profiler that swiping through all 4 stages never leaves more than one graphic's `useEffect` timers running.
- `prefers-reduced-motion`: verify every graphic's static end-state is legible on its own (no information conveyed only by the animation, e.g. the `✓ Parsed in 0.8s` badge and recipe title must still be visible, just not animated in).
- Confirm the taller stage viewport (~150-160px graphic+text vs. today's 58px) still keeps the whole `AppIntroHero` card comfortably above the fold alongside the widget grid below it — spot-check on a 375×667 (iPhone SE) viewport, the tightest common target per this project's iOS-first testing note in CLAUDE.md.
- Confirm swipe/drag still targets the *whole* stage `motion.div` including the new graphic area (it will, since the graphic is a child of the same draggable container) — no dead zones where a swipe over the graphic fails to register.
- Auto-advance timing nit: at 4.2s/stage × 4 stages = ~17s full loop, up from ~13s. Flagging, not fixing — no action unless you want to shorten `AUTO_ADVANCE_S` for the now-longer loop (e.g. to 3.5s) as part of this package.

---

## Testing Plan

- No new automated test coverage proposed — this is presentational/decorative motion with no business logic, consistent with how `AppIntroHero.jsx` itself has no test file today.
- Manual pass (per package, not just at the end): each graphic in isolation looks correct mid-loop and at its reduced-motion end-state; full carousel swipe-through on both a real touch device and desktop pointer; confirm no layout jump when the card height increases; confirm auto-advance still pauses correctly on touch with the new taller touch target.

---

## Suggested Build Order

1. **D1** (shell/plumbing) — must land first, everything else depends on the `renderGraphic` slot existing.
2. **D2** (Import) — highest "wow" per the doc's own framing ("proves the heavy lifting happens instantly"), do it first so you can sanity-check the whole approach on one graphic before building 3 more.
3. **D5** (Cook, cheapest) — quick parity win, validates the pattern on a second, simpler graphic.
4. **D3** (Plan) — medium complexity, reuses existing stagger/spring patterns.
5. **D4** (Grocery) — most complex, do last so any budget/time pressure trims this one first (its own optional merge-pulse beat is the first thing to cut).
6. **D6** (perf/reduced-motion/iOS pass) — last, across all 4 graphics at once.

Each package is independently shippable/committable (matches this project's "incremental, never full rewrites" constitution) — D1 alone is a safe no-visual-regression commit, then each graphic package after it is additive.
