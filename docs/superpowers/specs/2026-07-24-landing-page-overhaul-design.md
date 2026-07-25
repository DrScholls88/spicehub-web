# Landing Page Overhaul — Full A+B+C Design Spec

**Date**: 2026-07-24  
**Scope**: LandingPage.jsx full overhaul — dead code purge, section consolidation, onboarding, file decomposition, progressive disclosure, time-of-day theming, pantry-match engine, micro-animations, smart nudges  
**Heuristic Target**: 18/40 → ~33/40  
**Research Sources**: pick-a-recipe (PWA share-target), buzcarter/recipes (cook-mode interactivity), KitchenGeek (portion calc, ingredient search), just-recipes (Schema.org tags), CookBook Manager (one-click AI import), mealie #5448 (video-to-recipe)

---

## 1. Dead Code Purge + Style Unification

### 1a. Dead CSS Deletion

Delete the following unused CSS classes from `LandingPage.css` (remnants of the old full-page hero layout, replaced by slim contextBar):

- `.hero-container` and all its responsive variants
- `.hero-content`
- `.hero-headline`, `.hero-headline .accent`
- `.hero-subheadline`
- `.hero-actions`
- `.btn-secondary` (all states: hover, active, focus, responsive)
- `.hero-visual-mask`, `.hero-image`, `.hero-visual-mask:hover .hero-image`
- `@keyframes heroFadeInUp`, `@keyframes heroFadeIn`
- All responsive rules for the above (768px, 480px media queries)
- Print styles for `.hero-actions button`, `.hero-container`
- Dark mode `.hero-container` rule
- High-DPI `.hero-image` rule
- Touch device `.btn-secondary` rules
- Focus-visible `.btn-secondary:focus-visible`
- `.hero-container:focus-within`

Also delete the `:root` block defining `--bg-dark`, `--text-light`, `--accent-orange`, `--border-dark` — these are hardcoded color values that duplicate the theme system. The file comment at the top referencing "Deep Charcoal (#121212) bg, Mint-Cream (#F5FFF5) text" should also be updated to reference the current design system.

**Estimated removal**: ~200 lines of CSS.

### 1b. Inline STYLES → CSS Classes

Move the following style groups from the `STYLES` object in LandingPage.jsx to LandingPage.css:

| STYLES key(s) | New CSS class | Notes |
|--------------|---------------|-------|
| `contextBar`, `contextGreeting`, `contextDate`, `contextStreak`, `contextDivider` | `.landing-context-bar`, `.landing-greeting`, `.landing-date`, `.landing-streak`, `.landing-divider` | Static layout styles |
| `tagline` | `.landing-tagline` | Static |
| `spinBtnFull` | `.landing-spin-full` | Static (width: 100%, flex) |
| `nextDaysSection`, `nextDaysScrollWrap`, `nextDaysScroll`, `nextDaysFade` | `.landing-next-days`, `.landing-next-days-wrap`, `.landing-next-days-scroll`, `.landing-next-days-fade` | Static |
| `dayCard*` (dayCard, dayCardToday, dayCardPhotoArea, dayCardPhotoFallback, dayCardBody, dayCardDayLabel, dayCardDayLabelToday, dayCardMealName, dayCardEmpty) | `.day-card`, `.day-card--today`, `.day-card-photo`, `.day-card-photo-fallback`, `.day-card-body`, `.day-card-label`, `.day-card-label--today`, `.day-card-name`, `.day-card-empty` | BEM naming |
| `emptyState*` | `.landing-empty`, `.landing-empty-icon`, `.landing-empty-text`, `.landing-empty-hint`, `.landing-empty-btn` | Static |
| `tilesGrid` | `.landing-tiles-grid` | Already partially in CSS (`.landing-tile-glass`) |
| `tile`, `tileHover`, `tileAccent`, `tileEmoji`, `tileTitle`, `tileSubtitle` | `.landing-tile`, `.landing-tile-accent`, `.landing-tile-emoji`, `.landing-tile-title`, `.landing-tile-subtitle` | Hover via CSS `:hover` instead of JS state |
| `statsStrip`, `statItem`, `statEmoji` | `.landing-stats`, `.landing-stat`, `.landing-stat-emoji` | Static |
| `previewOverlay`, `previewSheet`, `previewMealName`, `previewMeta`, `previewBtn` | `.preview-overlay`, `.preview-sheet`, `.preview-meal-name`, `.preview-meta`, `.preview-btn` | These move with MealPreviewSheet.jsx extraction |
| `sectionLabel` | `.landing-section-label` | Used in multiple places |

**What stays inline**: Dynamic/computed styles only — `hoveredTile` conditional (replaced by CSS `:hover`), any `style` prop that reads from JS variables at render time.

**Target**: STYLES object shrinks from ~350 lines to ~50 lines.

---

## 2. Section Consolidation (12 → 6)

### Current structure (12 logical sections):
1. Context bar (greeting + date + streak)
2. Telemetry ticker (auto-rotating)
3. Spin CTA button
4. Install banner
5. Today Hero Card
6. Next 5 Days carousel
7. Widget Dashboard header (label + edit toggle)
8. Widget tiles (7 tiles in 2-col grid)
9. Stats strip
10. Discover card
11. Seasonal Picks carousel
12. Day preview bottom sheet (overlay)

### New structure (6 logical sections):

**1. Hero Zone** (one visual block):
- Context bar (greeting + date)
- Prioritized status line (replaces ticker)
- Streak badge (moved from stats strip into context bar, right-aligned pill)
- State-aware CTA button
- Install banner (slim, inline within hero zone)

**2. Today Hero Card** (conditionally shown when today has a planned non-special meal — unchanged behavior)

**3. Cook Tonight — Pantry Match** (new, conditionally shown — see Section 8)

**4. Next 5 Days Carousel**:
- Same horizontal scroll behavior
- **New**: At the end of the carousel, append a "Seasonal Picks" tail card that teases 1-2 seasonal meals with a "See more →" link to the library with seasonal filter
- This replaces the standalone Seasonal Picks section

**5. Widget Dashboard** (tiles, reorder/hide — unchanged behavior)

**6. Discover Card** (render only when `onOpenDiscover` is functional — add a `discoverEnabled` prop or check, default false)

**Day Preview Sheet**: Overlay, not a scroll section — unchanged.

### What's removed:
- **Stats strip section**: Streak already in context bar. `topMeal` becomes a tooltip on the streak badge (long-press/hover shows "Top meal: [name]"). The `onOpenStats` link moves to a "📊" icon in the context bar or remains accessible via the Stats widget tile.
- **Seasonal Picks standalone section**: Merged into Next 5 Days as a tail card.
- **Telemetry ticker**: Replaced by prioritized status line (see Section 3).

---

## 3. Ticker Fix + State-Aware CTA

### 3a. Ticker → Prioritized Status Line

Replace the auto-rotating `AnimatePresence` ticker with a single-line status display.

**Priority order** (show the first that applies):
1. Tonight's prep time: `"Tonight: {mins} min prep"` (if today has a planned non-special meal with time data)
2. Active streak: `"{streak} day streak 🔥"` (if streak > 0)
3. Grocery status: `"{n} items on the list"` (if groceryItems has unchecked items)
4. Fallback: `"Your meals, gamified."`

**Tap behavior**: Tapping cycles to the next status item (user-initiated, WCAG compliant). A small `• • •` dot indicator below the text shows position when there are 2+ items. No auto-rotation.

**Implementation**: Remove `setInterval`, `tickerIndex` state, and the `AnimatePresence mode="wait"` wrapper. Replace with a `useState(0)` that increments on tap, modulo `tickerItems.length`. Keep the `motion.div` for a gentle crossfade on tap (`key={activeTicker.key}`, same animation params).

### 3b. State-Aware CTA

Replace the current binary logic (`meals.length === 0 ? 'Add Meals to Spin' : 'Spin the Week'`) with a three-state CTA:

```jsx
const ctaConfig = useMemo(() => {
  if (meals.length === 0) {
    return { label: 'Import Your First Recipe', icon: '📥', action: () => onNavigate('import') };
  }
  if (rotationCount < 4) {
    return { label: 'Build Your Rotation', icon: '📓', action: () => onNavigate('library') };
  }
  return { label: 'Spin the Week', icon: '🎲', action: onGenerate };
}, [meals.length, rotationCount, onNavigate, onGenerate]);
```

The `onNavigate('import')` route needs to exist in App.jsx — if it doesn't, fall back to triggering the import flow directly. The `rotationCount` prop is already passed to LandingPage.

**Visual treatment**: The CTA always uses `.btn-primary.spin-tactile`. The `spin-pulse` glow only applies in the "Spin the Week" state (when rotation is ready). In the "Import" state, no pulse — a calm, inviting button. In the "Build Your Rotation" state, a gentle `border: 2px solid var(--primary)` outline instead of the solid fill, to signal "you're not quite ready yet" without being alarming.

---

## 4. First-Launch Onboarding Coach

### New file: `src/components/OnboardingCoach.jsx` (~80 lines)

A 3-step tooltip overlay shown once per device.

**Steps**:

| Step | Target element | Title | Description |
|------|---------------|-------|-------------|
| 1 | CTA button (`.landing-spin-full` or the state-aware CTA) | Import a recipe | "Start by importing a recipe from Instagram, TikTok, or any URL. Just paste a link or share it directly to SpiceHub." |
| 2 | My Meals tile (`#tile-myMeals` — add this id) | Tag your favorites | "Mark meals as 'The Rotation' — those are the ones the weekly spinner draws from." |
| 3 | CTA button (re-targets) | Spin your week | "Tap Spin and SpiceHub plans your whole week. Don't like a day? Re-roll it." |

**Spotlight implementation**:
- Fixed overlay covering the entire viewport: `position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.6)`
- Spotlight cutout via `clip-path: polygon(...)` computed from the target element's `getBoundingClientRect()`
- Tooltip card positioned below/above the spotlight (auto-positioned to stay in viewport)
- Tooltip card: `background: var(--card); border-radius: var(--radius); padding: 16px; max-width: 280px`
- Step indicator: 3 dots, active dot = `var(--primary)`
- "Skip" text button always visible: `color: var(--text-muted); font-size: 12px`
- "Next →" / "Got it!" primary button

**Persistence**: `localStorage.setItem('sh_onboarding_v1', '1')` on completion or skip. The `v1` suffix allows resetting if the onboarding flow changes significantly in the future.

**Rendering**: In LandingPage.jsx:
```jsx
const [showOnboarding] = useState(() => !localStorage.getItem('sh_onboarding_v1'));
// ... at the end of the return:
{showOnboarding && meals.length === 0 && (
  <OnboardingCoach
    onComplete={() => localStorage.setItem('sh_onboarding_v1', '1')}
    targets={{ cta: ctaRef, myMeals: myMealsRef }}
  />
)}
```

Only shows when there are zero meals AND onboarding hasn't been completed. If a user imports a meal before finishing the coach, the coach won't re-show on next visit.

---

## 5. File Decomposition

### Extraction plan

All components below are already defined as function components inside LandingPage.jsx. Extract each to its own file with its own imports. No prop changes — each component keeps its current function signature.

| File | Source lines (approx) | Dependencies |
|------|----------------------|--------------|
| `src/components/landing/TodayHeroCard.jsx` | ~50 | SafeMediaImage, motion, ChevronRight, LandingPage.css (hero card classes) |
| `src/components/landing/DayPhotoCard.jsx` | ~40 | SafeMediaImage, motion, date helpers (from `lib/landingHelpers.js`) |
| `src/components/landing/MealPreviewSheet.jsx` | ~120 | motion, AnimatePresence, date helpers, STYLES → CSS classes |
| `src/components/landing/SeasonalMealCard.jsx` | ~30 | SafeMediaImage, motion |
| `src/components/landing/StickyHeader.jsx` | ~30 | motion, Dices icon |
| `src/components/landing/InstallBanner.jsx` | ~25 | motion |
| `src/components/landing/DiscoverFeatureCard.jsx` | ~35 | motion, Compass icon |
| `src/components/landing/OnboardingCoach.jsx` | ~80 | New component (see Section 4) |
| `src/components/landing/CookTonightCarousel.jsx` | ~60 | New component (see Section 8) |
| `src/lib/landingHelpers.js` | ~80 | Date helpers, mealTickerMinutes, getSeasonInfo, getSeasonalMeals, DOW_SHORT, TILE_COLORS, PRIMARY_TILES, diceVariants |

**Directory**: `src/components/landing/` — keeps landing sub-components grouped. LandingPage.jsx stays at `src/components/LandingPage.jsx` and imports from `./landing/*`.

**CSS strategy**: Component-specific CSS classes stay in `LandingPage.css` with section header comments (e.g., `/* ── TodayHeroCard ── */`). No CSS modules — the project doesn't use them and introducing them would be inconsistent.

**LandingPage.jsx after extraction**: ~400 lines. Contains: imports, state management, layout logic, `useMemo` computations (next5Days, tiles, etc.), and the JSX orchestrator that renders the sub-components.

---

## 6. Progressive Disclosure

### Above the fold (visible without scrolling):
- Hero zone (context bar + status line + CTA)
- Today Hero Card (if applicable)

### First scroll:
- Cook Tonight carousel (if pantry matches exist)
- Next 5 Days carousel

### Second scroll:
- Widget Dashboard (tiles)

### Third scroll:
- Discover card (if enabled)

### Implementation:

Replace the current `initial="hidden" animate="visible"` pattern on the tiles grid with Framer Motion's `whileInView`:

```jsx
<motion.div
  className="landing-tiles-grid"
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.2 }}
  variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
>
```

Same treatment for:
- Cook Tonight carousel container
- Discover card
- Any future sections below the fold

The `once: true` ensures the animation only plays on first scroll into view — subsequent scrolls show the content statically. `amount: 0.2` triggers when 20% of the element is visible.

**Hero zone and Today Hero Card**: Keep the current `initial/animate` pattern (they're above the fold, should animate on mount).

---

## 7. Time-of-Day Themed Landing

### Time zones and CSS classes:

```js
// In landingHelpers.js
export function getTimeOfDayClass() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'sh-morning';
  if (h >= 11 && h < 17) return 'sh-afternoon';
  if (h >= 17 && h < 21) return 'sh-evening';
  return 'sh-night';
}
```

### CSS custom property overrides (in LandingPage.css):

```css
/* Morning — warm golden */
.sh-morning {
  --landing-tint: hsl(38, 90%, 95%);
  --landing-tint-dark: hsl(38, 40%, 12%);
}

/* Afternoon — neutral (no override, uses defaults) */

/* Evening — warm amber, dinner-forward */
.sh-evening {
  --landing-tint: hsl(25, 85%, 95%);
  --landing-tint-dark: hsl(25, 35%, 12%);
}

/* Night — cool/moody, bar-forward */
.sh-night {
  --landing-tint: hsl(240, 20%, 96%);
  --landing-tint-dark: hsl(240, 15%, 10%);
}
```

**Application**: The LandingPage container gets `background: color-mix(in srgb, var(--bg) 92%, var(--landing-tint, var(--bg)))`. In dark mode, swap `--landing-tint` for `--landing-tint-dark`. The blend is subtle — 8% tint — enough to feel different, not enough to clash with the theme.

### Evening mode enhancements:
- Today Hero Card photo height increases from 140px to 180px
- Today Hero Card gets a stronger shadow: `box-shadow: 0 8px 24px rgba(0,0,0,0.12)`
- `.sh-evening .today-hero-card { ... }`

### Night mode enhancements:
- Bar Shelf tile gets promoted to first position in default widget order (if user hasn't customized)
- Bar tile glow intensifies: `.sh-night .tile-bar { box-shadow: 0 0 20px rgba(123, 31, 162, 0.25), ... }`
- Implementation: In the `tiles` useMemo, when `timeClass === 'sh-night'`, reorder the array to put 'bar' first (only if `layout.order` is the default/unchanged)

### Greeting text updates:
- Morning: "Good morning! ☀️" (unchanged)
- Afternoon: "Good afternoon! 🌤️" (unchanged)
- Evening: "What's for dinner? 🍽️" (changed from "Good evening! 🌅" — more actionable)
- Night: "Night owl mode 🦉" (unchanged)

---

## 8. Pantry-Match "Cook Tonight" Engine

### New file: `src/lib/pantryMatch.js`

Adapts the existing `barMatch.js` pattern for meal ingredients.

```js
/**
 * pantryMatch.js — cross-reference pantry inventory against recipe ingredients
 * 
 * Input:  fridgeInventory (array of { ingredient, ... })
 *         meals (array with ingredientsStructured)
 * Output: top N meals sorted by ingredient coverage %
 */

import { normalizeIngredient } from './ingredientNormalizer.js';

const MATCH_THRESHOLD = 0.6; // 60% ingredient coverage required

export function findPantryMatches(fridgeInventory, meals, { limit = 3 } = {}) {
  // Build a normalized set of what's in the pantry
  const pantrySet = new Set(
    fridgeInventory.map(item => normalizeIngredient(item.ingredient)?.canonical || item.ingredient?.toLowerCase())
      .filter(Boolean)
  );

  const scored = meals
    .filter(m => m.ingredientsStructured?.length > 0) // skip meals without parsed ingredients
    .map(meal => {
      const ingredients = meal.ingredientsStructured;
      const total = ingredients.length;
      let matched = 0;
      const missing = [];

      for (const ing of ingredients) {
        const canon = normalizeIngredient(ing.name)?.canonical || ing.name?.toLowerCase();
        if (pantrySet.has(canon)) {
          matched++;
        } else {
          missing.push(ing.name);
        }
      }

      const coverage = total > 0 ? matched / total : 0;
      return { meal, coverage, matched, total, missing };
    })
    .filter(s => s.coverage >= MATCH_THRESHOLD)
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, limit);

  return scored;
}
```

### New file: `src/components/landing/CookTonightCarousel.jsx`

Renders a horizontal scroll carousel of pantry-matched meals:

```
🧊 Cook Tonight — from what you have
[card 1] [card 2] [card 3]
```

Each card shows:
- Recipe photo (SafeMediaImage fallback)
- Recipe name
- Coverage: "7/9 items ✓" (green text if ≥80%, amber if 60-79%)
- Missing: "Need: parmesan, garlic" (truncated to 2 items + "...")

Tapping a card calls `onViewDetail(meal)`.

**Lazy computation**: The `findPantryMatches` call is wrapped in a `useMemo` that only computes when `fridgeInventory` or `meals` change. The section only renders if matches are found.

**Visual treatment**: Same card dimensions and border-radius as DayPhotoCard for visual consistency. Horizontal scroll with the same `.sh-carousel` class and right-edge fade.

---

## 9. Micro-Animations + Haptics

### 9a. Tile Entry Stagger (refinement)

Change `staggerChildren` from `0.05` to `0.08`. Wrap in `whileInView` (see Section 6). Individual tile variants unchanged (`scale: 0.9 → 1`, spring stiffness 300, damping 24).

### 9b. Haptic Feedback

```js
// In landingHelpers.js
export function haptic(ms = 15) {
  if ('vibrate' in navigator) navigator.vibrate(ms);
}
```

Call sites:
- CTA button `onClick`: `haptic(15)` before `onGenerate()` / `onNavigate()`
- Widget tile `onClick`: `haptic(10)`
- Day card tap (preview sheet open): `haptic(10)`

Gated: `if (reducedMotion) return;` — check `useReducedMotion()` from Framer Motion.

### 9c. Stats Count-Up

When the streak badge enters the viewport, animate the number from 0 to its value over 600ms.

```jsx
// In the context bar streak display
const [displayStreak, setDisplayStreak] = useState(0);
const streakRef = useRef(null);

useEffect(() => {
  if (!streak || reducedMotion) { setDisplayStreak(streak); return; }
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      // Animate 0 → streak over 600ms
      const start = performance.now();
      const animate = (now) => {
        const progress = Math.min((now - start) / 600, 1);
        setDisplayStreak(Math.round(progress * streak));
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      observer.disconnect();
    }
  }, { threshold: 0.5 });
  if (streakRef.current) observer.observe(streakRef.current);
  return () => observer.disconnect();
}, [streak, reducedMotion]);
```

### 9d. Empty-State Breathing

The Dices icon in the empty state gets a gentle scale loop:

```jsx
<motion.div
  style={/* emptyStateIcon styles */}
  animate={reducedMotion ? {} : { scale: [1, 1.06, 1] }}
  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
>
  <Dices size={22} strokeWidth={1.75} />
</motion.div>
```

### 9e. Evening CTA Shimmer

During `sh-evening`, the CTA button gets the shimmer overlay:

```css
.sh-evening .btn-primary.spin-tactile::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
  animation: heroShimmer 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  pointer-events: none;
}
```

Requires adding `position: relative; overflow: hidden;` to `.btn-primary.spin-tactile`.

### 9f. Reduced Motion

All of the above respect `prefers-reduced-motion: reduce`:
- Haptics disabled
- Count-up skipped (instant display)
- Breathing animation disabled
- Shimmer disabled
- Tile stagger still runs but with `duration: 0` (instant appearance, no motion)

---

## 10. Smart Import Nudges

### 10a. "Find Something New?" Nudge

**Trigger**: No recipe imported in 7+ days.

**Tracking**: `localStorage.setItem('sh_last_import_ts', Date.now())` — set in the import engine's save path (wherever `db.meals.add()` or `db.drinks.add()` is called for a new import).

**Dismissal**: `localStorage.setItem('sh_import_nudge_dismissed', Date.now())` — re-shows after 3 days.

**Rendering**: Slim banner, same visual treatment as InstallBanner:
```
📥 Find something new?
Import a recipe from Instagram or any URL  [→]
```

### 10b. "Finish Importing" Nudge

**Trigger**: Dexie `offlineQueue` table has pending import items.

**Rendering**:
```
⏳ 2 recipes waiting to import
Tap to finish importing when you're online  [→]
```

**Priority**: pending imports > stale-import nudge > neither. Only one nudge shows at a time.

**Position**: Below the CTA, above the Today Hero Card. Same position as InstallBanner — they stack if both are active (install banner above nudge).

---

## Implementation Order (Suggested Packages)

| Package | Sections | Risk | Dependencies |
|---------|----------|------|-------------|
| **P1**: Dead code + style unification | 1a, 1b | Low | None |
| **P2**: Section consolidation + ticker fix + CTA | 2, 3a, 3b | Low | P1 (clean CSS) |
| **P3**: File decomposition | 5 | Medium | P1+P2 (final STYLES cleanup) |
| **P4**: Onboarding coach | 4 | Low | P3 (needs component refs) |
| **P5**: Progressive disclosure | 6 | Low | P3 (whileInView on extracted components) |
| **P6**: Pantry-match engine | 8 | Medium | P3 (new CookTonightCarousel component) |
| **P7**: Time-of-day theming | 7 | Low | P1 (CSS classes) |
| **P8**: Micro-animations + haptics | 9 | Low | P3+P5 (IntersectionObserver patterns) |
| **P9**: Smart import nudges | 10 | Low | P3 (InstallBanner pattern) |

P1-P3 are sequential (each builds on prior cleanup). P4-P9 are largely parallel after P3.

---

## Non-Goals (Explicitly Out of Scope)

- PWA share-target manifest changes (separate feature, not a LandingPage concern)
- CookMode interactivity (separate spec)
- Serving scaler (separate spec)
- MealLibrary view modes beyond what's already built
- Nutrition display (separate spec for wiring existing data to UI)
- Import engine changes (this spec only adds nudges; import pipeline is unchanged)

---

## Verification Plan

1. **Visual regression**: Screenshot each time-of-day state (morning/afternoon/evening/night) in both light and dark mode (8 screenshots)
2. **WCAG audit**: Confirm ticker no longer auto-rotates. Confirm all interactive elements have focus-visible. Run axe-core on the landing page.
3. **Onboarding flow**: Test first-launch (no localStorage), skip, complete, and verify it doesn't re-show
4. **Pantry match**: Test with 0 inventory (section hidden), partial matches (section shows), and no matches above threshold (section hidden)
5. **Progressive disclosure**: Scroll test on short viewport (375x667) — confirm tiles aren't pre-animated
6. **Performance**: Check that pantry-match computation doesn't block render (should be <10ms for 100 meals)
7. **Reduced motion**: Enable prefers-reduced-motion and verify all animations are disabled/instant
8. **Build**: `npm run build` must pass with zero errors
