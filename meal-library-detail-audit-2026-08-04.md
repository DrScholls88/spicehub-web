# Meal Library + Meal Detail — Audit of MealLibIdeas.md / MealLibIdeas2.md

**Date:** 2026-08-04
**Method:** Every claim in both uploaded docs checked directly against the current code (`MealLibrary.jsx`, `MealDetail.jsx`, `CookMode.jsx`, `db.js`, `App.css`) rather than taken at face value.

## Headline finding

Both documents describe an **earlier version** of these two screens. A lot of what they flag as broken was already fixed in prior sessions (FAB speed-dial, PiP player, Cook Mode with wake-lock, the yield scaler, the play/kebab button overlays). One important technical note: **the docs' code snippets are Tailwind (`className="flex bg-zinc-800/80..."`), but this project has Tailwind installed and unused everywhere — the real styling system is semantic CSS classes + `var(--token)` custom properties** (see `App.css`, `.ml-tile-*`, `.detail-*`). Any of the ideas below get implemented in that system, not as pasted Tailwind.

Below, each proposed item is marked:
- ✅ **Already shipped** — skip, doc is stale
- ⚠️ **Partially true** — real but smaller than described, or needs reframing
- 🔴 **Genuine gap** — confirmed missing, worth building

---

## MealLibIdeas2.md — Library grid

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | Heavy magenta play button / kebab overlay obscuring food | ✅ Already shipped | `.ml-tile-play` is a 32px translucent black circle (`rgba(0,0,0,0.5)`), `.ml-tile-menu-btn` is 28px, same translucent treatment. Instagram variant uses IG's actual brand gradient, small and subtle — not "heavy." |
| 2 | Grey flat fallback card w/ plain emoji | ✅ Already shipped | `.ml-tile-placeholder` is a soft warm gradient (`linear-gradient(135deg, #f5f0ea, #e8e0d8)`), not flat grey. |
| 3 | FAB sits over card content | ✅ Already shipped | `.ml-fab-group` is already offset `calc(52px + safe-area + 16px)` above the tab bar, and it's a speed-dial (backdrop scrim + staggered actions), not a plain `+`. |
| 4 | Duplicate imports render as separate cards (e.g. 3x "Broccoli Caesar Pasta") | 🔴 **Genuine gap** | `App.jsx`'s `saveMeal()` — the path most live imports go through — does a bare `db.meals.add()` with **no duplicate check at all**. A same-URL merge check *does* exist, but only in `db.js`'s offline `importQueue` retry path, not the primary save path. |
| 5 | Splintered category taxonomy (`Dinners 57` / `Dinner 6` / `Pasta 5`) | 🔴 **Genuine gap** | Section grouping in `MealLibrary.jsx` groups by the raw `meal.category` string with zero normalization (`const cat = meal.category \|\| 'Dinners'`). Any import-time variance in category spelling creates a new splinter section. |
| 6 | 20+ horizontal filter pills, forced scrolling | ⚠️ Partially true | Current system is a well-built 2-row layout: category tabs + reorderable user-tag chips with per-tag counts — not a flat 20-pill wall. But it genuinely does get long once a user has created many personal tags, and the docs' literal "3 dropdown categories" fix doesn't fit — tags are freeform/user-authored, not typed into Time/Diet/Cuisine buckets. |
| 7 | No title clean-up on import (clickbait prefixes) | 🔴 **Genuine gap** | Confirmed: no such utility anywhere in `recipeSchema.js`. This also *directly* explains gap #4 — the queue-level dedup matches on exact `name`, so an unnormalized clickbait title silently defeats it. |

## MealLibIdeas.md — Meal Detail modal

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | 7 competing header actions incl. rogue floating play button | ✅ Mostly stale | Current header has exactly 5 icons (Edit/Share/Send-to-Friend/Export/Close). The play button lives over the image, not the header. Re-Import appears twice but in two distinct, non-competing contexts (quick action over the image; a separate, labeled action inside the Source section for a different URL when dual-source). Trimming to an overflow menu is a legitimate taste call, not a bug fix. |
| 2 | Cream/beige yield scaler clashing with dark UI | ✅ Already shipped | `.servings-scaler` / `.scale-selector` / `.btn-scale` already exist as a real styled component (memory: fixed 2026-07-17, "were unstyled" → fixed). |
| 3 | Static ingredient list, no pantry cross-reference | 🔴 **Genuine gap, highest ROI item in either doc** | Confirmed: ingredient list is a plain `<li>{ing}</li>` with no click handler and no pantry lookup. Meanwhile `resolveIngredientCoverage`-equivalent pantry-match logic already exists and is proven (used by Grocery). Wiring it into the recipe detail view is a direct reuse, not new infrastructure. |
| 4 | No dedicated Cook Mode | ✅ Already shipped | `CookMode.jsx` already has Wake Lock API integration, 46px step font, and touch/swipe navigation — exceeds the doc's own "20px+" ask. |
| 5 | No proper PIP video architecture | ✅ Already shipped | `FloatingVideoPlayer` + `getMealVideoSource` already implement dock/minimize/close, per `project_pip_video_player_2026_06_19` memory. |
| 6 | 5 empty star outlines wasting header space | ⚠️ Minor, cosmetic | True but low-impact — a single row shared with heart/rotation/category chip, not "premium real estate" lost. |

---

## What's actually worth building

### Phase 1 — Import correctness (do first; B depends on A being at least partially in place)

**A. Title normalization utility** (`recipeSchema.js`)
Strip social clickbait patterns at import time: ALL-CAPS runs, `"..."` continuation markers, `"= The ultimate..."` suffixes, emoji spam. Apply during the same pass that already does other structured-field cleanup. Small, pure function — low risk.

**B. Save-time duplicate detection** (`App.jsx` `saveMeal()`, `db.js`)
Port the existing `importQueue` merge logic (same-URL → merge via `mergeRecipeData`, different recipe/same name → auto-rename) into `saveMeal()`'s no-`id` branch, so it applies to *every* save path, not just offline-queue retries. This is the same pattern already proven in `db.js` — extending its reach, not inventing new logic.

### Phase 2 — Category taxonomy cleanup (`MealLibrary.jsx`, `recipeSchema.js`)

**C. Canonicalize category on save**, mapping common variants (`Dinner`→`Dinners`, `Pasta`→ existing bucket or a defined sub-tag) to the fixed `TYPE_OPTIONS`/`CATEGORY_OPTIONS` list already used elsewhere in the file. Needs a one-time migration pass over existing `db.meals` records plus a guard in the save path so it can't drift again.

### Phase 3 — Interactive ingredients in Meal Detail (`MealDetail.jsx`)

**D. Tap-to-check-off ingredients** — local component state, strike-through style matching existing dark-theme conventions.
**E. Pantry match badge per ingredient** — reuse the coverage-check pattern already proven in Grocery (`resolveIngredientCoverage`), rendered as a small "In Pantry" pill, mute-not-hide (consistent with the app's existing pantry UX convention).

### Optional / low-priority polish (only if you want them — none of these fix a real bug)

- Tag row → "Filters (N)" bottom-sheet trigger once tag count crosses a threshold (e.g. 8+), reusing existing chips inside the sheet.
- Category-tinted SVG watermark on the already-decent gradient fallback thumbnail.
- Collapse MealDetail header icons into a `⋮` overflow menu (taste call).
- Hide the star-rating row until the meal has a rating; show a small "Rate" link instead.
- Hide-on-scroll for the FAB (marginal value — it's already out of the way).

---

## Recommendation

Build Phase 1 → 2 → 3 in that order (each is independently shippable/revertable). Skip the "already shipped" items entirely — implementing them again would be pure churn, and in a couple of cases (the play button, the FAB) the current version is already better than what the docs propose. Treat the "optional polish" list as a backlog, not a commitment.
