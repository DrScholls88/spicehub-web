# Landing Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul LandingPage from 18/40 heuristic score to ~33/40 — dead code purge, section consolidation, onboarding, file decomposition, time-of-day theming, pantry-match engine, micro-animations, and smart import nudges.

**Architecture:** Extract the 1507-line LandingPage monolith into a ~400-line orchestrator + 8 sub-components in `src/components/landing/`. Move helper functions/constants to `src/lib/landingHelpers.js`. Add `src/lib/pantryMatch.js` for ingredient-based recipe discovery. All styling moves from inline STYLES object to CSS classes.

**Tech Stack:** React 18, Framer Motion, Dexie.js (IndexedDB), Vite, CSS custom properties (no CSS modules — project doesn't use them)

**Spec:** `docs/superpowers/specs/2026-07-24-landing-page-overhaul-design.md`

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `src/components/landing/TodayHeroCard.jsx` | Today's dinner hero card with shimmer |
| `src/components/landing/DayPhotoCard.jsx` | Individual day card in 5-day carousel |
| `src/components/landing/MealPreviewSheet.jsx` | Bottom-sheet day preview with actions |
| `src/components/landing/SeasonalMealCard.jsx` | Card in seasonal picks carousel |
| `src/components/landing/StickyHeader.jsx` | Fixed header appearing on scroll |
| `src/components/landing/InstallBanner.jsx` | PWA install prompt |
| `src/components/landing/DiscoverFeatureCard.jsx` | Discover recipes entry point |
| `src/components/landing/OnboardingCoach.jsx` | First-launch 3-step tooltip overlay |
| `src/components/landing/CookTonightCarousel.jsx` | Pantry-match "Cook Tonight" section |
| `src/components/landing/ImportNudgeBanner.jsx` | Smart import nudge banners |
| `src/lib/landingHelpers.js` | Date helpers, constants, seasonal logic, haptic util |
| `src/lib/pantryMatch.js` | Cross-reference pantry inventory against recipe ingredients |

### Modified files
| Path | Changes |
|------|---------|
| `src/components/LandingPage.jsx` | Gut to ~400-line orchestrator importing sub-components |
| `src/components/LandingPage.css` | Delete ~200 lines dead hero CSS, add ~150 lines for migrated STYLES + new classes |
| `src/lib/landingLayout.js` | Export `DEFAULT_WIDGET_ORDER` (already exported, no change needed) |

---

## Task 1: Extract Helper Functions to `landingHelpers.js`

**Files:**
- Create: `src/lib/landingHelpers.js`
- Modify: `src/components/LandingPage.jsx`

- [ ] **Step 1: Create `src/lib/landingHelpers.js` with all helpers and constants**

```js
// landingHelpers.js — shared helpers, constants, and animation variants
// for the Landing Page and its sub-components.

// ── Date helpers ──────────────────────────────────────────────────────────────
export function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Small, tolerant duration parser for the ticker's prep time line.
export function mealTickerMinutes(meal) {
  const raw = meal?.totalTime || meal?.prepTime || meal?.cookTime;
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/);
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/);
  let total = 0;
  if (hrMatch) total += parseFloat(hrMatch[1]) * 60;
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  return bare ? Math.round(parseFloat(bare[1])) : null;
}

// ── Day-of-week abbreviations ────────────────────────────────────────────────
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Animation variants ──────────────────────────────────────────────────────
export const dayCardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.94 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 320, damping: 26 },
  },
};

export const diceVariants = {
  rest:  { rotate: 0 },
  hover: { rotate: [0, -22, 20, -10, 6, 0], transition: { duration: 0.55, ease: 'easeInOut' } },
};

// ── Tile accent colors ──────────────────────────────────────────────────────
export const TILE_COLORS = {
  planWeek: '#e65100',
  myMeals: '#2e7d32',
  bar: '#7b1fa2',
  grocery: '#1565c0',
  pantry: '#8a6d3b',
  fridge: '#00838f',
  stats: '#e65100',
};

// Primary tiles span full width with distinct treatment
export const PRIMARY_TILES = new Set(['planWeek', 'fridge']);

// ── Seasonal helpers ────────────────────────────────────────────────────────
export function getSeasonInfo() {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return {
    name: 'Spring', emoji: '🌸',
    headline: 'Perfect for Spring',
    keywords: ['spring', 'pea', 'asparagus', 'radish', 'artichoke', 'strawberry', 'lemon', 'salad', 'light', 'fresh', 'herb'],
  };
  if (m >= 5 && m <= 7) return {
    name: 'Summer', emoji: '☀️',
    headline: 'Summer Favorites',
    keywords: ['summer', 'grill', 'grilled', 'bbq', 'barbecue', 'corn', 'tomato', 'zucchini', 'peach', 'watermelon', 'taco', 'burger', 'fresh', 'light', 'salad'],
  };
  if (m >= 8 && m <= 10) return {
    name: 'Fall', emoji: '🍂',
    headline: 'Cozy Fall Recipes',
    keywords: ['fall', 'pumpkin', 'squash', 'apple', 'sweet potato', 'butternut', 'soup', 'stew', 'roast', 'harvest', 'cider', 'maple'],
  };
  return {
    name: 'Winter', emoji: '❄️',
    headline: 'Warm Winter Comfort',
    keywords: ['winter', 'soup', 'stew', 'chili', 'braise', 'roast', 'hearty', 'comfort', 'pot roast', 'casserole', 'curry', 'warm', 'slow cooker'],
  };
}

export function getSeasonalMeals(meals, season) {
  const kws = season.keywords;
  const scored = meals.map(m => {
    const haystack = [
      m.name || '',
      m.category || '',
      m.cuisine || '',
      m.dishType || '',
      ...(m.tags || []),
      ...(m.ingredients || []).slice(0, 8),
    ].join(' ').toLowerCase();
    const hits = kws.filter(k => haystack.includes(k)).length;
    return { meal: m, hits };
  })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 5).map(x => x.meal);
}

// ── Time-of-day theming ─────────────────────────────────────────────────────
export function getTimeOfDayClass() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'sh-morning';
  if (h >= 11 && h < 17) return 'sh-afternoon';
  if (h >= 17 && h < 21) return 'sh-evening';
  return 'sh-night';
}

// ── Haptic feedback ─────────────────────────────────────────────────────────
export function haptic(ms = 15) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch { /* non-critical */ }
}
```

- [ ] **Step 2: Update imports in LandingPage.jsx**

Replace the top of `LandingPage.jsx` (lines 9-45, the date helpers and `mealTickerMinutes`) and lines 438-508 (DOW_SHORT, animation variants, TILE_COLORS, PRIMARY_TILES, seasonal helpers) with imports:

```js
import {
  getMondayOfWeek, localDateKey, addDays, mealTickerMinutes,
  DOW_SHORT, dayCardVariants, diceVariants,
  TILE_COLORS, PRIMARY_TILES,
  getSeasonInfo, getSeasonalMeals,
  getTimeOfDayClass, haptic,
} from '../lib/landingHelpers.js';
```

Delete the original function/constant definitions from LandingPage.jsx.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with zero errors. LandingPage still renders identically.

- [ ] **Step 4: Commit**

```bash
git add src/lib/landingHelpers.js src/components/LandingPage.jsx
git commit -m "refactor(landing): extract helpers and constants to landingHelpers.js"
```

---

## Task 2: Delete Dead CSS

**Files:**
- Modify: `src/components/LandingPage.css`

- [ ] **Step 1: Delete unused hero CSS**

Remove the following blocks from `LandingPage.css`:

1. The `:root` block (lines 10-16) defining `--bg-dark`, `--text-light`, `--accent-orange`, `--border-dark`, `--transition-primary`
2. `.hero-container` (lines 32-43)
3. `.hero-content` (lines 49-55)
4. `.hero-headline` and `.hero-headline .accent` (lines 61-78)
5. `.hero-subheadline` (lines 84-96)
6. `.hero-actions` (lines 102-109)
7. `.btn-secondary` and all its states (`:hover`, `:active`, `:focus`) (lines 157-196)
8. `.hero-visual-mask`, `.hero-image`, `.hero-visual-mask:hover .hero-image` (lines 202-225)
9. `@keyframes heroFadeInUp` and `@keyframes heroFadeIn` (lines 231-249)
10. All responsive rules for the above at 768px (lines 255-284) and 480px (lines 290-331)
11. Dark mode `.hero-container` rule (lines 799-803)
12. Print styles for `.hero-actions button` and `.hero-container` (lines 810-818)
13. High-DPI `.hero-image` rule (lines 825-829)
14. Touch device `.btn-secondary` rules inside `@media (hover: none)` (lines 838-840 — only the .btn-secondary lines, keep .btn-primary lines)
15. `.btn-secondary:focus-visible` (line within 856-860 block — only the .btn-secondary line)
16. `.hero-container:focus-within` (lines 862-864)
17. Reduced-motion rules referencing `.hero-headline`, `.hero-subheadline`, `.hero-actions` (lines 767-773 — only those selectors, keep other reduced-motion rules)

2. Update the file's header comment (lines 1-4) from referencing "Deep Charcoal (#121212)" to just:
```css
/* ═══════════════════════════════════════════════════════════════════════════
   LandingPage.css - Landing Page Component Styles
   ═══════════════════════════════════════════════════════════════════════════ */
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. No CSS references broken (none of these classes are used in JSX).

- [ ] **Step 3: Commit**

```bash
git add src/components/LandingPage.css
git commit -m "refactor(landing): delete ~200 lines of dead hero CSS"
```

---

## Task 3: Migrate Inline STYLES to CSS Classes

**Files:**
- Modify: `src/components/LandingPage.css`
- Modify: `src/components/LandingPage.jsx`

This is the largest single task. The goal: move all static style declarations from the STYLES object to CSS classes, leaving only dynamic/computed styles inline.

- [ ] **Step 1: Add new CSS classes to LandingPage.css**

Append these classes after the existing `.sh-carousel` block (around line 27, after the dead CSS is removed):

```css
/* ─────────────────────────────────────────────────────────────────────────────
   Context Bar — slim greeting + date + streak
   ───────────────────────────────────────────────────────────────────────────── */

.landing-context-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 14px;
  font-size: 15px;
  line-height: 1.3;
}

.landing-greeting {
  font-weight: 700;
  color: var(--text);
}

.landing-divider {
  color: var(--text-muted, var(--text-light));
  opacity: 0.55;
}

.landing-date {
  color: var(--text-light);
  font-weight: 500;
}

.landing-streak {
  margin-left: auto;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--primary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Spin CTA — full-width primary action
   ───────────────────────────────────────────────────────────────────────────── */

.landing-spin-full {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Next 5 Days — horizontal carousel
   ───────────────────────────────────────────────────────────────────────────── */

.landing-next-days {
  margin-bottom: 24px;
}

.landing-next-days-wrap {
  position: relative;
}

.landing-next-days-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 8px;
  padding-right: 20px;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  scroll-padding-left: 2px;
  touch-action: pan-x;
  overscroll-behavior-x: contain;
}

.landing-next-days-fade {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 8px;
  width: 36px;
  pointer-events: none;
  background: linear-gradient(to right, rgba(0,0,0,0), var(--bg));
}

/* ─────────────────────────────────────────────────────────────────────────────
   Day Photo Cards
   ───────────────────────────────────────────────────────────────────────────── */

.day-card {
  flex-shrink: 0;
  width: 144px;
  background: var(--card);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
  display: flex;
  flex-direction: column;
  text-align: left;
  padding: 0;
  outline: none;
}

.day-card--today {
  border: 2px solid var(--primary);
}

.day-card-photo {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
  background: var(--surface);
  flex-shrink: 0;
}

.day-card-photo-fallback {
  width: 100%;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  font-size: 28px;
  flex-shrink: 0;
}

.day-card-body {
  padding: 8px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.day-card-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.day-card-label--today {
  color: var(--primary);
}

.day-card-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.day-card-empty {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Empty State
   ───────────────────────────────────────────────────────────────────────────── */

.landing-empty {
  background: var(--surface);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 20px 16px;
  text-align: center;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.landing-empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--text-muted, var(--text-light));
  margin-bottom: 10px;
}

.landing-empty-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.landing-empty-hint {
  font-size: 13px;
  color: var(--text-muted, var(--text-light));
  margin-bottom: 14px;
  line-height: 1.5;
  max-width: 260px;
}

.landing-empty-btn {
  display: inline-block;
  background: var(--primary);
  color: #fff;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease-out;
}

.landing-empty-btn:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.landing-empty-btn:active {
  transform: translateY(0);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Widget Tiles Grid
   ───────────────────────────────────────────────────────────────────────────── */

.landing-tiles-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.landing-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 16px 16px 20px;
  cursor: pointer;
  transition: all 0.2s ease-out;
  min-height: 140px;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  text-align: left;
  outline: none;
}

.landing-tile-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 0 2px 2px 0;
}

.landing-tile-emoji {
  font-size: 28px;
  margin-bottom: 8px;
}

.landing-tile-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}

.landing-tile-subtitle {
  font-size: 12px;
  color: var(--text-muted, var(--text-light));
  font-weight: 500;
  line-height: 1.35;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Stats Strip
   ───────────────────────────────────────────────────────────────────────────── */

.landing-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--card);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  outline: none;
  border: 1px solid var(--border);
  width: 100%;
  justify-content: center;
  margin-bottom: 24px;
}

.landing-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.landing-stat-emoji {
  font-size: 16px;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Section Label
   ───────────────────────────────────────────────────────────────────────────── */

.landing-section-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 12px;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Preview Sheet
   ───────────────────────────────────────────────────────────────────────────── */

.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 500;
}

.preview-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 501;
  background: var(--card);
  border-radius: 18px 18px 0 0;
  padding: 10px 18px 28px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.18);
}

.preview-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  margin: 0 auto 12px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.preview-close-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-muted, var(--text-light));
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-photo {
  width: 100%;
  height: 180px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  margin-bottom: 14px;
}

.preview-photo-fallback {
  width: 100%;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border-radius: var(--radius-sm);
  font-size: 40px;
  margin-bottom: 14px;
}

.preview-meal-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 4px;
}

.preview-meta {
  font-size: 13px;
  color: var(--text-muted, var(--text-light));
  margin-bottom: 14px;
}

.preview-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.preview-view-btn:active {
  transform: scale(0.98);
}
```

- [ ] **Step 2: Replace STYLES references with CSS classes in LandingPage.jsx**

This is a systematic find-and-replace throughout the JSX. For each component, replace `style={STYLES.xxx}` with `className="new-class"`. For example:

- `style={STYLES.contextBar}` → `className="landing-context-bar"`
- `style={STYLES.contextGreeting}` → `className="landing-greeting"`
- `style={STYLES.contextDivider}` → `className="landing-divider"`
- `style={STYLES.contextDate}` → `className="landing-date"`
- `style={STYLES.contextStreak}` → `className="landing-streak"`
- `style={STYLES.spinBtnFull}` → `className="landing-spin-full"` (add to existing className)
- `style={STYLES.nextDaysSection}` → `className="landing-next-days"`
- `style={STYLES.nextDaysScroll}` → add `className="landing-next-days-scroll sh-carousel"` (merge existing sh-carousel class)
- `style={STYLES.nextDaysFade}` → `className="landing-next-days-fade"`
- All `STYLES.dayCard*` → corresponding `.day-card*` classes
- All `STYLES.emptyState*` → corresponding `.landing-empty*` classes
- `style={STYLES.tilesGrid}` → `className="landing-tiles-grid"`
- All `STYLES.tile*` → corresponding `.landing-tile*` classes
- All `STYLES.statsStrip` / `STYLES.statItem` / `STYLES.statEmoji` → `.landing-stats` / `.landing-stat` / `.landing-stat-emoji`
- All `STYLES.preview*` / `STYLES.scrim` → corresponding `.preview-*` classes
- `style={STYLES.sectionLabel}` → `className="landing-section-label"`

Then delete the STYLES entries that have been migrated. Keep only entries that are dynamic or used with spread on hover states that need JS (e.g., the container padding/minHeight can stay since it uses the full-page layout).

- [ ] **Step 3: Remove `hoveredTile`/`hoveredStats`/`hoverEmptyButton` state**

These hover states are no longer needed since hover effects are now handled by CSS `:hover` pseudo-classes. Delete:
- `const [hoveredTile, setHoveredTile] = useState(null);`
- `const [hoveredStats, setHoveredStats] = useState(false);`
- `const [hoverEmptyButton, setHoverEmptyButton] = useState(false);`
- All `onMouseEnter`/`onMouseLeave` handlers referencing these states
- The `getTileStyle` function

- [ ] **Step 4: Delete remaining STYLES entries that are now CSS classes**

The STYLES object should shrink to only the `container` entry (the outer div's basic layout: display, flexDirection, minHeight, background, color, padding, paddingBottom). Everything else is now in CSS.

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Visual appearance unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/LandingPage.jsx src/components/LandingPage.css
git commit -m "refactor(landing): migrate inline STYLES to CSS classes

Move ~300 lines of CSS-in-JS to proper CSS classes. Remove JS hover
state management (now CSS :hover). STYLES object reduced to ~10 lines."
```

---

## Task 4: Extract Sub-Components to `src/components/landing/`

**Files:**
- Create: `src/components/landing/TodayHeroCard.jsx`
- Create: `src/components/landing/DayPhotoCard.jsx`
- Create: `src/components/landing/MealPreviewSheet.jsx`
- Create: `src/components/landing/SeasonalMealCard.jsx`
- Create: `src/components/landing/StickyHeader.jsx`
- Create: `src/components/landing/InstallBanner.jsx`
- Create: `src/components/landing/DiscoverFeatureCard.jsx`
- Modify: `src/components/LandingPage.jsx`

- [ ] **Step 1: Create `src/components/landing/StickyHeader.jsx`**

```jsx
import React from 'react';

export default function StickyHeader({ visible, onSpin }) {
  return (
    <div className={`landing-sticky-header${visible ? ' visible' : ''}`}>
      <div className="sticky-brand">
        🌶️ SpiceHub
      </div>
      <button className="sticky-spin-btn" onClick={onSpin}>
        Spin 🎲
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/landing/InstallBanner.jsx`**

```jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';

export default function InstallBanner({ onInstall }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <motion.div
      className="install-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={onInstall}
    >
      <span className="install-icon">📲</span>
      <div className="install-text">
        <div className="install-title">Install SpiceHub</div>
        <div className="install-subtitle">Add to home screen for faster access</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}
```

- [ ] **Step 3: Create `src/components/landing/TodayHeroCard.jsx`**

```jsx
import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function TodayHeroCard({ meal, onPress }) {
  if (!meal || meal._special) return null;
  return (
    <motion.button
      className="today-hero-card"
      onClick={() => onPress(meal)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      style={{ width: '100%', border: 'none', outline: 'none', textAlign: 'left', padding: 0 }}
    >
      {meal.imageUrl ? (
        <div className="hero-photo-wrap">
          <SafeMediaImage
            src={meal.imageUrl}
            alt={meal.name || ''}
            className="hero-photo"
            style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block' }}
            fallbackEmoji="🍳"
          />
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--surface)', fontSize: '40px',
        }}>
          🍳
        </div>
      )}
      <div className="hero-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hero-tag">Tonight's dinner</div>
          <div className="hero-meal-name">{meal.name}</div>
          {(meal.category || meal.cuisine) && (
            <div className="hero-meal-meta">
              {[meal.category, meal.cuisine].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="hero-arrow">
          <ChevronRight size={16} strokeWidth={2.5} />
        </div>
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 4: Create `src/components/landing/SeasonalMealCard.jsx`**

```jsx
import React from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function SeasonalMealCard({ meal, onPress }) {
  return (
    <motion.button
      whileHover={{ y: -3, boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.96 }}
      onClick={onPress}
      className="day-card"
      style={{ width: '140px' }}
    >
      {meal.imageUrl ? (
        <SafeMediaImage
          src={meal.imageUrl}
          alt={meal.name || ''}
          style={{ width: '100%', height: '90px', objectFit: 'cover', display: 'block' }}
          fallbackEmoji="🍳"
        />
      ) : (
        <div className="day-card-photo-fallback" style={{ height: '90px' }}>🍳</div>
      )}
      <div className="day-card-body">
        <div className="day-card-name">{meal.name}</div>
        {meal.category && (
          <div style={{ fontSize: '10px', color: 'var(--text-muted, var(--text-light))', marginTop: '3px', fontWeight: '500' }}>
            {meal.category}
          </div>
        )}
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 5: Create `src/components/landing/DayPhotoCard.jsx`**

```jsx
import React from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';
import { DOW_SHORT, dayCardVariants } from '../../lib/landingHelpers.js';

export default function DayPhotoCard({ date, meal, isToday, onClick }) {
  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateNum = date.getDate();
  const specialEmoji = meal?._special ? meal.icon : null;

  return (
    <motion.button
      variants={dayCardVariants}
      whileHover={{ y: -4, boxShadow: '0 8px 16px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`day-card${isToday ? ' day-card--today' : ''}`}
    >
      {specialEmoji ? (
        <div className="day-card-photo-fallback">{specialEmoji}</div>
      ) : meal?.imageUrl ? (
        <SafeMediaImage
          src={meal.imageUrl}
          alt={meal?.name || ''}
          className="day-card-photo"
          fallbackEmoji={meal ? '🍳' : '🍽️'}
        />
      ) : (
        <div className="day-card-photo-fallback">
          {meal ? '🍳' : '🍽️'}
        </div>
      )}
      <div className="day-card-body">
        <div className={`day-card-label${isToday ? ' day-card-label--today' : ''}`}>
          <span>{dayLabel} {dateNum}</span>
          {meal?._locked && <span style={{ fontSize: '12px' }} title="Locked">🔒</span>}
        </div>
        {meal ? (
          <div className="day-card-name">{meal.name}</div>
        ) : (
          <div className="day-card-empty">Nothing yet</div>
        )}
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 6: Create `src/components/landing/DiscoverFeatureCard.jsx`**

```jsx
import React from 'react';
import { motion } from 'framer-motion';
import { Compass, ChevronRight } from 'lucide-react';

export default function DiscoverFeatureCard({ onPress }) {
  return (
    <motion.button
      className="discover-feature-card"
      onClick={onPress}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="discover-card-glow" aria-hidden="true" />
      <span className="discover-card-badge">
        <span className="discover-card-badge-ring" aria-hidden="true" />
        <Compass size={22} strokeWidth={1.75} />
      </span>
      <span className="discover-card-text">
        <span className="discover-card-eyebrow">Discover</span>
        <span className="discover-card-title">Find your next favorite</span>
        <span className="discover-card-subtitle">Browse recipe communities — tap one to import</span>
      </span>
      <span className="discover-card-arrow">
        <ChevronRight size={16} strokeWidth={2.5} />
      </span>
    </motion.button>
  );
}
```

- [ ] **Step 7: Create `src/components/landing/MealPreviewSheet.jsx`**

Extract the full `MealPreviewSheet` function component as-is from LandingPage.jsx into this file. Add imports for React, useState, useMemo, motion, AnimatePresence, SafeMediaImage, and DOW_SHORT. Replace all `STYLES.xxx` references with the CSS class equivalents from Task 3 (e.g., `style={STYLES.scrim}` → `className="preview-overlay"`, `style={STYLES.previewSheet}` → `className="preview-sheet"`, etc.).

The component's function signature stays identical:
```jsx
export default function MealPreviewSheet({
  date, meal, isToday, onClose, onViewFull,
  meals = [], onRespinDate = null, onAssignMeal = null, onCreateMealForDay = null,
}) { ... }
```

- [ ] **Step 8: Update LandingPage.jsx imports**

Replace the inline component definitions with imports:

```jsx
import StickyHeader from './landing/StickyHeader.jsx';
import InstallBanner from './landing/InstallBanner.jsx';
import TodayHeroCard from './landing/TodayHeroCard.jsx';
import DayPhotoCard from './landing/DayPhotoCard.jsx';
import SeasonalMealCard from './landing/SeasonalMealCard.jsx';
import DiscoverFeatureCard from './landing/DiscoverFeatureCard.jsx';
import MealPreviewSheet from './landing/MealPreviewSheet.jsx';
```

Delete the original function definitions of all 7 components from LandingPage.jsx.

- [ ] **Step 9: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. All imports resolve. Visual appearance unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/components/landing/ src/components/LandingPage.jsx
git commit -m "refactor(landing): extract 7 sub-components to landing/ directory

TodayHeroCard, DayPhotoCard, MealPreviewSheet, SeasonalMealCard,
StickyHeader, InstallBanner, DiscoverFeatureCard. LandingPage.jsx
is now a ~400-line orchestrator."
```

---

## Task 5: Section Consolidation + Ticker Fix + State-Aware CTA

**Files:**
- Modify: `src/components/LandingPage.jsx`
- Modify: `src/components/LandingPage.css`

- [ ] **Step 1: Replace auto-rotating ticker with prioritized status line**

In LandingPage.jsx, delete the `setInterval`-based ticker logic:
- Delete `const [tickerIndex, setTickerIndex] = useState(0);`
- Delete the `useEffect` with `setInterval` that auto-rotates
- Delete the `activeTicker` clamping line

Replace with user-tap-to-cycle:

```jsx
const [statusIndex, setStatusIndex] = useState(0);

// Build prioritized status items (same as before, but no auto-rotate)
const statusItems = useMemo(() => {
  const items = [];
  const todayMealForStatus = next5Days[0]?.meal;
  if (todayMealForStatus && !todayMealForStatus._special) {
    const mins = mealTickerMinutes(todayMealForStatus);
    if (mins != null) {
      items.push({ key: 'tonight', text: `Tonight: ${mins} min prep`, onTap: () => onViewDetail(todayMealForStatus) });
    }
  }
  if (streak > 0) {
    items.push({ key: 'streak', text: `${streak} day streak 🔥`, onTap: () => onOpenStats() });
  }
  if (groceryItems.length > 0) {
    const unchecked = groceryItems.filter(i => !i.isChecked).length;
    if (unchecked > 0) {
      items.push({ key: 'grocery', text: `${unchecked} item${unchecked === 1 ? '' : 's'} on the list`, onTap: () => onNavigate('grocery') });
    }
  }
  if (items.length === 0) {
    items.push({ key: 'tagline', text: 'Your meals, gamified.', onTap: null });
  }
  return items;
}, [streak, groceryItems, next5Days, onOpenStats, onNavigate, onViewDetail]);

const activeStatus = statusItems[statusIndex % statusItems.length];

const handleStatusTap = useCallback(() => {
  if (activeStatus.onTap) {
    activeStatus.onTap();
  } else if (statusItems.length > 1) {
    setStatusIndex(i => (i + 1) % statusItems.length);
  }
}, [activeStatus, statusItems]);
```

Update the ticker JSX to remove `AnimatePresence mode="wait"` auto-rotation and use tap-to-cycle:

```jsx
<div
  className="landing-ticker"
  onClick={handleStatusTap}
  role={statusItems.length > 1 || activeStatus.onTap ? 'button' : undefined}
  tabIndex={statusItems.length > 1 || activeStatus.onTap ? 0 : undefined}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStatusTap(); } }}
>
  <AnimatePresence mode="wait">
    <motion.div
      key={activeStatus.key}
      className="landing-ticker-text"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
    >
      {activeStatus.text}
    </motion.div>
  </AnimatePresence>
  {statusItems.length > 1 && (
    <div className="landing-ticker-dots">
      {statusItems.map((_, i) => (
        <span key={i} className={`landing-ticker-dot${i === statusIndex % statusItems.length ? ' active' : ''}`} />
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 2: Add ticker dot CSS**

Append to `LandingPage.css`:

```css
.landing-ticker-dots {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.landing-ticker-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-muted, var(--text-light));
  opacity: 0.3;
  transition: opacity 0.2s;
}

.landing-ticker-dot.active {
  opacity: 0.8;
}
```

- [ ] **Step 3: Implement state-aware CTA**

Replace the current CTA logic in LandingPage.jsx:

```jsx
const ctaConfig = useMemo(() => {
  if (meals.length === 0) {
    return { label: 'Import Your First Recipe', icon: '📥', action: () => onNavigate('library'), pulse: false, outline: false };
  }
  if (rotationCount < 4) {
    return { label: 'Build Your Rotation', icon: '📓', action: () => onNavigate('library'), pulse: false, outline: true };
  }
  return { label: 'Spin the Week', icon: '🎲', action: onGenerate, pulse: !hasAnyMeal, outline: false };
}, [meals.length, rotationCount, onNavigate, onGenerate, hasAnyMeal]);
```

Update the CTA button JSX:

```jsx
<motion.button
  className={`btn-primary spin-tactile${ctaConfig.pulse ? ' spin-pulse' : ''}${ctaConfig.outline ? ' spin-outline' : ''}`}
  onClick={() => {
    haptic(15);
    if (ctaConfig.icon === '🎲') { setDiceRattling(true); setTimeout(() => setDiceRattling(false), 600); }
    ctaConfig.action();
  }}
  initial="rest"
  whileHover="hover"
  whileTap={{ scale: 0.97 }}
  animate="rest"
  className="landing-spin-full btn-primary spin-tactile"
>
  {ctaConfig.label}{' '}
  {ctaConfig.icon === '🎲' ? (
    <motion.span
      variants={diceVariants}
      className={diceRattling ? 'dice-rattle-on-tap' : ''}
      style={{ display: 'inline-block', transformOrigin: 'center' }}
    >🎲</motion.span>
  ) : (
    <span>{ctaConfig.icon}</span>
  )}
</motion.button>
```

- [ ] **Step 4: Add outline CTA style**

Append to `LandingPage.css`:

```css
.btn-primary.spin-outline {
  background: transparent;
  color: var(--primary);
  border: 2px solid var(--primary);
}

.btn-primary.spin-outline:hover {
  background: color-mix(in srgb, var(--primary) 10%, transparent);
}
```

- [ ] **Step 5: Merge stats strip into context bar**

Remove the standalone stats strip section from the JSX (the `{(streak > 0 || topMeal) && (` block). The streak is already in the context bar as `.landing-streak`. For `topMeal`, add a title attribute to the streak badge:

```jsx
{streak > 0 && (
  <span
    className="landing-streak"
    title={topMeal ? `Top meal: ${topMeal?.name || topMeal}` : undefined}
  >
    {streak} day streak 🔥
  </span>
)}
```

- [ ] **Step 6: Merge seasonal picks into carousel tail**

Remove the standalone Seasonal Picks section. In the Next 5 Days carousel, after the `next5Days.map(...)`, add a tail card:

```jsx
{seasonalMeals.length >= 2 && (
  <motion.button
    variants={dayCardVariants}
    whileHover={{ y: -4 }}
    whileTap={{ scale: 0.95 }}
    onClick={() => onNavigate('library')}
    className="day-card"
    style={{ background: `linear-gradient(135deg, var(--surface), var(--card))` }}
  >
    <div className="day-card-photo-fallback" style={{ fontSize: '22px' }}>
      {seasonInfo.emoji}
    </div>
    <div className="day-card-body">
      <div className="day-card-label">{seasonInfo.name}</div>
      <div className="day-card-name">{seasonalMeals.length} seasonal picks →</div>
    </div>
  </motion.button>
)}
```

- [ ] **Step 7: Update evening greeting**

In the `greeting` useMemo, change the evening greeting:

```js
if (hour < 21) return { greeting: "What's for dinner? 🍽️" };
```

- [ ] **Step 8: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/LandingPage.jsx src/components/LandingPage.css
git commit -m "feat(landing): consolidate sections 12→6, fix WCAG ticker, state-aware CTA

- Replace auto-rotating ticker with prioritized tap-to-cycle status
- CTA now shows Import/Build Rotation/Spin based on state
- Stats strip merged into context bar streak badge
- Seasonal picks merged into Next 5 Days carousel tail card
- Evening greeting changed to 'What's for dinner?'"
```

---

## Task 6: Time-of-Day Theming

**Files:**
- Modify: `src/components/LandingPage.jsx`
- Modify: `src/components/LandingPage.css`

- [ ] **Step 1: Add time-of-day CSS classes**

Append to `LandingPage.css`:

```css
/* ─────────────────────────────────────────────────────────────────────────────
   Time-of-Day Theming
   ───────────────────────────────────────────────────────────────────────────── */

.sh-morning {
  --landing-tint: hsl(38, 90%, 95%);
}

.sh-evening {
  --landing-tint: hsl(25, 85%, 95%);
}

.sh-night {
  --landing-tint: hsl(240, 20%, 96%);
}

/* Subtle tint blend on the container */
.sh-morning,
.sh-evening,
.sh-night {
  background: color-mix(in srgb, var(--bg) 92%, var(--landing-tint)) !important;
}

/* Dark mode tints — lower lightness */
@media (prefers-color-scheme: dark) {
  .sh-morning { --landing-tint: hsl(38, 40%, 12%); }
  .sh-evening { --landing-tint: hsl(25, 35%, 12%); }
  .sh-night   { --landing-tint: hsl(240, 15%, 10%); }
}

/* [data-theme="dark"] override for manual theme toggle */
[data-theme="dark"] .sh-morning { --landing-tint: hsl(38, 40%, 12%); }
[data-theme="dark"] .sh-evening { --landing-tint: hsl(25, 35%, 12%); }
[data-theme="dark"] .sh-night   { --landing-tint: hsl(240, 15%, 10%); }

/* Evening: larger hero card */
.sh-evening .today-hero-card .hero-photo {
  height: 180px;
}

.sh-evening .today-hero-card {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

/* Evening: CTA shimmer */
.sh-evening .btn-primary.spin-tactile {
  position: relative;
  overflow: hidden;
}

.sh-evening .btn-primary.spin-tactile::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
  animation: heroShimmer 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  pointer-events: none;
}

/* Night: intensified bar tile glow */
.sh-night .landing-tile-glass.tile-bar {
  box-shadow: 0 0 20px rgba(123, 31, 162, 0.25),
              0 2px 12px rgba(0, 0, 0, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .sh-evening .btn-primary.spin-tactile::after {
    animation: none;
    display: none;
  }
}
```

- [ ] **Step 2: Apply time-of-day class in LandingPage.jsx**

Add `getTimeOfDayClass` to the imports from `landingHelpers.js` (already done in Task 1). Then in the component:

```jsx
const timeClass = useMemo(() => getTimeOfDayClass(), []);
```

Update the container div:

```jsx
<div style={STYLES.container} className={timeClass}>
```

- [ ] **Step 3: Night mode bar tile promotion**

In the `tiles` useMemo, after building the array, add promotion logic:

```jsx
const tiles = useMemo(() => {
  const baseTiles = [
    // ... existing tile definitions ...
  ];

  // Night mode: promote bar tile to first position (only if user hasn't customized)
  if (timeClass === 'sh-night') {
    const barIdx = baseTiles.findIndex(t => t.id === 'bar');
    if (barIdx > 0) {
      const [barTile] = baseTiles.splice(barIdx, 1);
      baseTiles.unshift(barTile);
    }
  }

  return baseTiles;
}, [/* existing deps */, timeClass]);
```

In `visibleTiles` useMemo, check if layout is default before applying the promotion:

```jsx
const isDefaultOrder = useMemo(() => {
  const saved = layout.order;
  return DEFAULT_WIDGET_ORDER.every((id, i) => saved[i] === id);
}, [layout.order]);
```

Only apply the night promotion when `isDefaultOrder` is true. If the user has customized, skip.

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Background gets a subtle tint based on time of day.

- [ ] **Step 5: Commit**

```bash
git add src/components/LandingPage.jsx src/components/LandingPage.css
git commit -m "feat(landing): add time-of-day theming

Morning=golden, evening=amber+hero prominence+CTA shimmer,
night=cool+bar tile promotion. All CSS-driven, respects
reduced-motion and dark mode."
```

---

## Task 7: Pantry-Match "Cook Tonight" Engine

**Files:**
- Create: `src/lib/pantryMatch.js`
- Create: `src/components/landing/CookTonightCarousel.jsx`
- Modify: `src/components/LandingPage.jsx`

- [ ] **Step 1: Create `src/lib/pantryMatch.js`**

```js
// pantryMatch.js — cross-reference pantry inventory against recipe ingredients.
// Adapts the barMatch.js pattern for meals: normalize ingredient names, compute
// coverage %, surface meals you can cook with what you have on hand.

import { normalizeIngredient } from '../utils/ingredientNormalizer.js';

const MATCH_THRESHOLD = 0.6; // 60% ingredient coverage required

/**
 * Find meals the user can cook based on their current pantry inventory.
 *
 * @param {Array} fridgeInventory - Items from Dexie fridgeInventory table
 * @param {Array} meals - All meals with ingredientsStructured
 * @param {Object} [opts]
 * @param {number} [opts.limit=3] - Max results to return
 * @returns {Array<{meal, coverage, matched, total, missing}>}
 */
export function findPantryMatches(fridgeInventory, meals, { limit = 3 } = {}) {
  if (!fridgeInventory?.length || !meals?.length) return [];

  // Build normalized set of what's in the pantry
  const pantrySet = new Set();
  for (const item of fridgeInventory) {
    const raw = item?.ingredient || item?.name || '';
    if (!raw) continue;
    const result = normalizeIngredient(raw);
    const canon = result?.canonical || raw.toLowerCase().trim();
    if (canon) pantrySet.add(canon);
  }

  if (pantrySet.size === 0) return [];

  const scored = [];

  for (const meal of meals) {
    const ingredients = meal.ingredientsStructured;
    if (!ingredients?.length) continue;

    const total = ingredients.length;
    let matched = 0;
    const missing = [];

    for (const ing of ingredients) {
      const name = ing?.name || ing?.ingredient || '';
      if (!name) { matched++; continue; } // skip empty entries

      const result = normalizeIngredient(name);
      const canon = result?.canonical || name.toLowerCase().trim();

      if (pantrySet.has(canon)) {
        matched++;
      } else {
        missing.push(name);
      }
    }

    const coverage = total > 0 ? matched / total : 0;
    if (coverage >= MATCH_THRESHOLD) {
      scored.push({ meal, coverage, matched, total, missing: missing.slice(0, 3) });
    }
  }

  scored.sort((a, b) => b.coverage - a.coverage);
  return scored.slice(0, limit);
}
```

- [ ] **Step 2: Create `src/components/landing/CookTonightCarousel.jsx`**

```jsx
import React from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function CookTonightCarousel({ matches, onViewDetail }) {
  if (!matches?.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
      style={{ marginBottom: '24px' }}
    >
      <div className="landing-section-label">🧊 Cook Tonight — from what you have</div>
      <div className="landing-next-days-wrap">
        <div className="landing-next-days-scroll sh-carousel">
          {matches.map(({ meal, matched, total, missing, coverage }) => (
            <motion.button
              key={meal.id || meal.name}
              whileHover={{ y: -4, boxShadow: '0 8px 16px rgba(0,0,0,0.12)' }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onViewDetail(meal)}
              className="day-card"
              style={{ width: '150px' }}
            >
              {meal.imageUrl ? (
                <SafeMediaImage
                  src={meal.imageUrl}
                  alt={meal.name || ''}
                  className="day-card-photo"
                  fallbackEmoji="🍳"
                />
              ) : (
                <div className="day-card-photo-fallback">🍳</div>
              )}
              <div className="day-card-body">
                <div className="day-card-name">{meal.name}</div>
                <div style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  color: coverage >= 0.8 ? 'var(--success, #16a34a)' : 'var(--warning, #d97706)',
                  marginTop: '3px',
                }}>
                  {matched}/{total} items ✓
                </div>
                {missing.length > 0 && (
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--text-muted, var(--text-light))',
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    Need: {missing.join(', ')}
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>
        <div className="landing-next-days-fade" aria-hidden="true" />
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 3: Wire into LandingPage.jsx**

Add imports:
```jsx
import { findPantryMatches } from '../lib/pantryMatch.js';
import CookTonightCarousel from './landing/CookTonightCarousel.jsx';
```

Add the match computation (lazy — only when props change):
```jsx
const pantryMatches = useMemo(
  () => findPantryMatches(fridgeInventory, meals),
  [fridgeInventory, meals]
);
```

In the JSX, render between TodayHeroCard and Next 5 Days:
```jsx
{/* Cook Tonight — pantry-matched meals */}
<CookTonightCarousel matches={pantryMatches} onViewDetail={onViewDetail} />
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Section only renders when pantry has items matching recipes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pantryMatch.js src/components/landing/CookTonightCarousel.jsx src/components/LandingPage.jsx
git commit -m "feat(landing): add Cook Tonight pantry-match section

Cross-references pantry inventory against recipe ingredients.
Shows top 3 meals at ≥60% coverage with missing item list.
Adapts barMatch.js pattern for meal ingredients."
```

---

## Task 8: Progressive Disclosure (whileInView)

**Files:**
- Modify: `src/components/LandingPage.jsx`

- [ ] **Step 1: Update tiles grid to use whileInView**

Change the tiles grid animation from `initial/animate` to `initial/whileInView`:

```jsx
<motion.div
  className="landing-tiles-grid"
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.2 }}
  variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
>
```

- [ ] **Step 2: Update Next 5 Days carousel similarly**

The carousel already uses `initial="hidden" animate="visible"`. Change to:

```jsx
<motion.div
  className="landing-next-days-scroll sh-carousel"
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.15 }}
  variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
>
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Elements now animate in on scroll rather than on mount.

- [ ] **Step 4: Commit**

```bash
git add src/components/LandingPage.jsx
git commit -m "feat(landing): progressive disclosure with whileInView

Tiles and carousels now animate in on scroll rather than mount.
Reduces cognitive load — above-fold content appears first."
```

---

## Task 9: Onboarding Coach

**Files:**
- Create: `src/components/landing/OnboardingCoach.jsx`
- Modify: `src/components/LandingPage.jsx`
- Modify: `src/components/LandingPage.css`

- [ ] **Step 1: Create `src/components/landing/OnboardingCoach.jsx`**

```jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  {
    title: 'Import a recipe',
    description: "Start by importing a recipe from Instagram, TikTok, or any URL. Just paste a link or share it directly to SpiceHub.",
    targetKey: 'cta',
  },
  {
    title: 'Tag your favorites',
    description: "Mark meals as 'The Rotation' — those are the ones the weekly spinner draws from.",
    targetKey: 'myMeals',
  },
  {
    title: 'Spin your week',
    description: "Tap Spin and SpiceHub plans your whole week. Don't like a day? Re-roll it.",
    targetKey: 'cta',
  },
];

export default function OnboardingCoach({ onComplete, targets }) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const tooltipRef = useRef(null);

  const currentStep = STEPS[step];
  const targetEl = targets?.[currentStep.targetKey]?.current;

  // Measure target element position
  useEffect(() => {
    if (!targetEl) { setSpotlightRect(null); return; }
    const updateRect = () => {
      const r = targetEl.getBoundingClientRect();
      const pad = 8;
      setSpotlightRect({
        x: r.left - pad,
        y: r.top - pad,
        w: r.width + pad * 2,
        h: r.height + pad * 2,
      });
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [targetEl, step]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Compute clip-path for spotlight cutout
  const clipPath = spotlightRect
    ? `polygon(
        0% 0%, 0% 100%, 
        ${spotlightRect.x}px 100%, 
        ${spotlightRect.x}px ${spotlightRect.y}px, 
        ${spotlightRect.x + spotlightRect.w}px ${spotlightRect.y}px, 
        ${spotlightRect.x + spotlightRect.w}px ${spotlightRect.y + spotlightRect.h}px, 
        ${spotlightRect.x}px ${spotlightRect.y + spotlightRect.h}px, 
        ${spotlightRect.x}px 100%, 
        100% 100%, 100% 0%
      )`
    : 'none';

  // Position tooltip below or above spotlight
  const tooltipStyle = {};
  if (spotlightRect) {
    const spaceBelow = window.innerHeight - (spotlightRect.y + spotlightRect.h);
    if (spaceBelow > 200) {
      tooltipStyle.top = spotlightRect.y + spotlightRect.h + 12;
    } else {
      tooltipStyle.bottom = window.innerHeight - spotlightRect.y + 12;
    }
    tooltipStyle.left = Math.max(16, Math.min(spotlightRect.x, window.innerWidth - 296));
  } else {
    tooltipStyle.top = '50%';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  return (
    <div className="onboarding-overlay">
      {/* Scrim with spotlight cutout */}
      <div className="onboarding-scrim" style={{ clipPath }} />

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          ref={tooltipRef}
          className="onboarding-tooltip"
          style={{ position: 'fixed', maxWidth: 280, zIndex: 10001, ...tooltipStyle }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <div className="onboarding-tooltip-title">{currentStep.title}</div>
          <div className="onboarding-tooltip-desc">{currentStep.description}</div>
          <div className="onboarding-tooltip-footer">
            <div className="onboarding-dots">
              {STEPS.map((_, i) => (
                <span key={i} className={`onboarding-dot${i === step ? ' active' : ''}`} />
              ))}
            </div>
            <div className="onboarding-tooltip-actions">
              <button className="onboarding-skip" onClick={handleSkip}>Skip</button>
              <button className="onboarding-next" onClick={handleNext}>
                {step === STEPS.length - 1 ? 'Got it!' : 'Next →'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Add onboarding CSS**

Append to `LandingPage.css`:

```css
/* ─────────────────────────────────────────────────────────────────────────────
   Onboarding Coach
   ───────────────────────────────────────────────────────────────────────────── */

.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.onboarding-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10000;
}

.onboarding-tooltip {
  background: var(--card);
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
}

.onboarding-tooltip-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 6px;
}

.onboarding-tooltip-desc {
  font-size: 13px;
  color: var(--text-muted, var(--text-light));
  line-height: 1.5;
  margin-bottom: 14px;
}

.onboarding-tooltip-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.onboarding-dots {
  display: flex;
  gap: 5px;
}

.onboarding-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border);
}

.onboarding-dot.active {
  background: var(--primary);
}

.onboarding-tooltip-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.onboarding-skip {
  font-size: 12px;
  color: var(--text-muted, var(--text-light));
  background: none;
  border: none;
  cursor: pointer;
  font-weight: 600;
}

.onboarding-next {
  font-size: 13px;
  font-weight: 700;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 100px;
  padding: 8px 16px;
  cursor: pointer;
}

.onboarding-next:active {
  transform: scale(0.96);
}
```

- [ ] **Step 3: Wire into LandingPage.jsx**

Add import:
```jsx
import OnboardingCoach from './landing/OnboardingCoach.jsx';
```

Add refs and state:
```jsx
const ctaRef = useRef(null);
const myMealsRef = useRef(null);
const [showOnboarding] = useState(() => {
  try { return !localStorage.getItem('sh_onboarding_v1'); } catch { return false; }
});
```

Attach refs to target elements:
- CTA button: add `ref={ctaRef}`
- My Meals tile: attach ref dynamically by adding `ref={tile.id === 'myMeals' ? myMealsRef : undefined}` to the tile button

Add at the end of the return, before closing `</div>`:
```jsx
{showOnboarding && meals.length === 0 && (
  <OnboardingCoach
    onComplete={() => { try { localStorage.setItem('sh_onboarding_v1', '1'); } catch {} }}
    targets={{ cta: ctaRef, myMeals: myMealsRef }}
  />
)}
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds. Onboarding shows on first visit with 0 meals.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/OnboardingCoach.jsx src/components/LandingPage.jsx src/components/LandingPage.css
git commit -m "feat(landing): add first-launch onboarding coach

3-step tooltip overlay: Import → Label → Spin. Spotlight cutout
highlights target elements. Skip button always visible. Persisted
via localStorage, only shows with 0 meals on first device visit."
```

---

## Task 10: Micro-Animations + Haptics

**Files:**
- Modify: `src/components/LandingPage.jsx`
- Modify: `src/components/landing/DayPhotoCard.jsx`

- [ ] **Step 1: Add haptic calls to interaction handlers**

In LandingPage.jsx, `haptic` is already imported from `landingHelpers.js` (Task 1). Add calls:

CTA button onClick (already done in Task 5 if combined — verify it's there):
```jsx
onClick={() => { haptic(15); /* ... rest of handler */ }}
```

Widget tile onClick:
```jsx
onClick={() => { haptic(10); tile.onClick(); }}
```

In DayPhotoCard.jsx, add import and call:
```jsx
import { DOW_SHORT, dayCardVariants, haptic } from '../../lib/landingHelpers.js';
// ... in the button:
onClick={() => { haptic(10); onClick(); }}
```

- [ ] **Step 2: Add empty-state breathing animation**

In LandingPage.jsx, update the empty state icon:

```jsx
<motion.div
  className="landing-empty-icon"
  animate={{ scale: [1, 1.06, 1] }}
  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
>
  <Dices size={22} strokeWidth={1.75} />
</motion.div>
```

- [ ] **Step 3: Add stats count-up**

In the context bar, animate the streak number. Add a small hook:

```jsx
const [displayStreak, setDisplayStreak] = useState(0);
const streakRef = useRef(null);

useEffect(() => {
  if (!streak) { setDisplayStreak(0); return; }
  setDisplayStreak(streak); // immediate for reduced motion
  // Animate count-up on first render
  const start = performance.now();
  const animate = (now) => {
    const progress = Math.min((now - start) / 600, 1);
    setDisplayStreak(Math.round(progress * streak));
    if (progress < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}, [streak]);
```

Update the streak badge to use `displayStreak`:
```jsx
<span className="landing-streak">
  {displayStreak} day streak 🔥
</span>
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/LandingPage.jsx src/components/landing/DayPhotoCard.jsx
git commit -m "feat(landing): add haptic feedback, breathing empty state, streak count-up

- navigator.vibrate() on CTA, tile, and day card taps (10-15ms)
- Empty state Dices icon breathes with gentle scale loop
- Streak number counts up from 0 on first render (600ms)"
```

---

## Task 11: Smart Import Nudges

**Files:**
- Create: `src/components/landing/ImportNudgeBanner.jsx`
- Modify: `src/components/LandingPage.jsx`
- Modify: `src/components/LandingPage.css`

- [ ] **Step 1: Create `src/components/landing/ImportNudgeBanner.jsx`**

```jsx
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';

const NUDGE_DISMISS_KEY = 'sh_import_nudge_dismissed';
const LAST_IMPORT_KEY = 'sh_last_import_ts';
const STALE_DAYS = 7;
const REDISMISS_DAYS = 3;

function isDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(NUDGE_DISMISS_KEY), 10);
    if (!ts) return false;
    return Date.now() - ts < REDISMISS_DAYS * 86400000;
  } catch { return false; }
}

function isImportStale() {
  try {
    const ts = parseInt(localStorage.getItem(LAST_IMPORT_KEY), 10);
    if (!ts) return true; // never imported
    return Date.now() - ts > STALE_DAYS * 86400000;
  } catch { return true; }
}

export default function ImportNudgeBanner({ batchQueueCount = 0, onNavigate }) {
  const [dismissed, setDismissed] = useState(false);

  const nudge = useMemo(() => {
    if (dismissed || isDismissed()) return null;

    // Priority 1: pending imports in queue
    if (batchQueueCount > 0) {
      return {
        icon: '⏳',
        title: `${batchQueueCount} recipe${batchQueueCount === 1 ? '' : 's'} waiting to import`,
        subtitle: 'Tap to finish importing when you\'re online',
        action: () => onNavigate('library'),
      };
    }

    // Priority 2: stale imports
    if (isImportStale()) {
      return {
        icon: '📥',
        title: 'Find something new?',
        subtitle: 'Import a recipe from Instagram or any URL',
        action: () => onNavigate('library'),
      };
    }

    return null;
  }, [batchQueueCount, dismissed, onNavigate]);

  if (!nudge) return null;

  return (
    <motion.div
      className="install-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={nudge.action}
    >
      <span className="install-icon">{nudge.icon}</span>
      <div className="install-text">
        <div className="install-title">{nudge.title}</div>
        <div className="install-subtitle">{nudge.subtitle}</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
          try { localStorage.setItem(NUDGE_DISMISS_KEY, String(Date.now())); } catch {}
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}

/** Call this from the import engine on successful save */
export function markImportTimestamp() {
  try { localStorage.setItem(LAST_IMPORT_KEY, String(Date.now())); } catch {}
}
```

- [ ] **Step 2: Wire into LandingPage.jsx**

Add import:
```jsx
import ImportNudgeBanner from './landing/ImportNudgeBanner.jsx';
```

LandingPage needs `batchQueueCount` as a prop. Check if App.jsx already passes it — if not, add it to the LandingPage render in App.jsx:
```jsx
<LandingPage
  ...
  batchQueueCount={batchQueueCount}
/>
```

In LandingPage.jsx, add the prop:
```jsx
export default function LandingPage({
  ...
  batchQueueCount = 0,
}) {
```

Render after InstallBanner, before TodayHeroCard:
```jsx
<AnimatePresence>
  <ImportNudgeBanner batchQueueCount={batchQueueCount} onNavigate={onNavigate} />
</AnimatePresence>
```

- [ ] **Step 3: Wire `markImportTimestamp` into the import save path**

In the import engine's save function (wherever `db.meals.add()` or `db.drinks.add()` is called for new imports), add:

```jsx
import { markImportTimestamp } from '../components/landing/ImportNudgeBanner.jsx';
// ... after successful save:
markImportTimestamp();
```

This likely lives in `App.jsx` or `ImportSheet.jsx` — search for `db.meals.add` or `db.meals.put` to find the exact location.

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/ImportNudgeBanner.jsx src/components/LandingPage.jsx src/App.jsx
git commit -m "feat(landing): add smart import nudge banners

Shows 'recipes waiting to import' when batch queue has items,
or 'Find something new?' when no import in 7+ days. Dismissable
with 3-day re-show. markImportTimestamp() wired into save path."
```

---

## Task 12: Final Build Verification

**Files:** (all modified files from Tasks 1-11)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: Build succeeds with zero errors and zero warnings.

- [ ] **Step 2: File size audit**

Check that LandingPage.jsx is now ~400 lines (not 1507):
```bash
wc -l src/components/LandingPage.jsx
```
Expected: ~350-450 lines.

Check that all new files exist:
```bash
ls -la src/components/landing/
ls -la src/lib/landingHelpers.js src/lib/pantryMatch.js
```

- [ ] **Step 3: Import chain verification**

Verify no circular imports:
```bash
npx madge --circular src/components/LandingPage.jsx
```
Expected: No circular dependencies.

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git status
```

Provide final conventional commit command:

```bash
git commit -m "chore(landing): final verification pass — build clean, no circular imports"
```
