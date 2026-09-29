# First-Run Plan Card + Visual Standardization — Design

**Date:** 2026-09-28
**Status:** Part A approved with review amendments (2026-09-28, marked **[R]**); Part B intent approved with guards
**Owner:** Brian
**Implementation:** two plans, written from this spec — Plan A (Part A) first, Plan B (Part B) second.

---

## Why

Testers give up early because they can't tell what SpiceHub is for or what to do first. The product promise is: **take the weekly chore of brainstorming a meal plan and building a grocery list off your plate, and make it fun.** Import is how your own recipes get in; it is not the first thing a new user can do (most testers do not have a link ready at install time).

Verified against the code on 2026-09-28:

| Finding | Where |
|---|---|
| A fresh install never has 0 recipes: the starter kit auto-seeds on first launch. | `App.jsx:796` |
| `OnboardingCoach` only mounts at `meals.length === 0`, so seeding means new users never see it. | `LandingPage.jsx:582` |
| The starter kit is 10 recipes: 6 vegan, 3 non-dinners (pancakes, French toast casserole, corn dip), all `inRotation: true` by default. | `starterKitData.js`, `starterKitMeals.js:120` |
| The spinner picks from The Rotation, falling back to the whole library only when The Rotation is empty. | `MealSpinner.jsx:123` |
| `handleSpinnerCompleteForDates(pairs, { buildGrocery })` can build the grocery list in the same step, but `WeekView` never passes the option; it shows a separate "Build your grocery list →" button instead. | `App.jsx:1210`, `WeekView.jsx:1931`, `WeekView.jsx:1960` |
| Home already has an empty-week state ("Nothing planned yet / Fill my week"), buried in Next 5 Days. | `LandingPage.jsx` Next 5 Days block |
| Assigning a recipe to a date already exists (`handleAssignMealToDay`, `pendingDaySlot`). | `App.jsx:1292`, `App.jsx:1300` |
| Grocery rebuild with `merge: true` rebuilds from the plan and carries `checked` / store over by name. | `App.jsx:1525` |
| Post-import actions are a bar that auto-dismisses after 8 s. | `App.jsx:654` |
| CSS uses 69 distinct `border-radius` values, 65 distinct font sizes, 274 distinct `box-shadow` values. Light `--radius` is 16px, dark is 14px. | `src/**/*.css`, `App.css:65`, `App.css:4269` |
| White text on `--primary` measures 3.79:1 (light), under AA 4.5:1. White on dark `--primary` (#66bb6a) measures 2.36:1. | `App.css` tokens |

---

# Part A — First-run Plan Card

## A1. What the tester sees

### Home: the Plan Card

Shown whenever **none of the next 7 days (today through today+6) has a meal**. That includes every fresh install.

- Position: directly below `AppIntroHero` (the intro carousel keeps its current position and its one-session life). For users past session one, that makes it the first card under the header.
- Content (ready state):
  - Label: "This week"
  - Headline: "Let's plan your week"
  - Body **[R]**: "One spin fills the empty days this week with dinners and builds your grocery list." (Says *empty days*, so it reads as filling gaps, not planning a restaurant week.)
  - Primary button: **Spin my week**
  - A ghosted strip of the next 7 day names (e.g. "Sat Sun Mon Tue Wed Thu Fri"); empty days are highlighted as the slots the spin will fill.
- **Carousel alignment [R]:** `AppIntroHero`'s position and one-session life are unchanged, but its slides are reordered so the first slide matches the card: "Auto-plan your week" moves to slide 1 with the subtitle "One spin fills your week with dinners and builds the grocery list." "Import from anywhere" becomes slide 2; the other two slides keep their order. This is a copy/order change only, in the same PR as the card, so the first screen teaches one sentence, not two.
- **Existing users [R]:** the card appears for anyone whose next 7 days are empty, but Home never mentions the starter pack or suggests swapping packs. The Settings path is the only one.
- The old "Nothing planned yet / Fill my week" block in Next 5 Days is removed, so the two never show together.
- Everything else on Home (banners, Today card, Cook Tonight, Next 5 Days, shortcuts) is unchanged.

### Spin my week

1. Navigates to the Plan tab and opens the existing `MealSpinner` with the target dates = the empty days among the next 7.
2. **✓ Keep These** applies the plan **and** builds the grocery list (`buildGrocery: true`).
3. **[R]** The spinner closes and the Plan tab scrolls to the top of the current week, so the first thing in view is the filled week, not chrome. Directly above the week's first day card, the tester sees:
   - A link: "Grocery list ready · N items →" (opens Shop). N = unchecked, uncovered items, the same count the header cart badge uses.
   - The **Make it yours** card: "Saved a recipe on Instagram or TikTok? Swap one of these for it." Button: **Import a recipe** (opens the same import sheet as the tab bar +, `showImportFor = 'any'`).
4. These two replace the "Build your grocery list →" button **only when the spin came from the Plan Card**. Every other spin path is unchanged.

### After an import started from Make it yours

- On successful save, the post-import bar shows a **day-picker variant**: "Put it on a day (adds it to The Rotation):" followed by chips for the next 7 days, each chip showing the day and the meal currently planned (e.g. "Tue · Lasagna Soup"). **[R]** The Rotation side effect is stated before the tap, not discovered after.
- This variant does **not** auto-dismiss; it stays until a chip is tapped or it is dismissed (×).
- Tapping a chip:
  1. Replaces that day with the imported recipe (`handleAssignMealToDay(date, recipe)`).
  2. Adds the recipe to The Rotation (`toggleRotation(recipe.id, true)`), because placing it on this week is the clearest signal of "I'm into this right now".
  3. Rebuilds the grocery list (`buildGroceryList(undefined, { merge: true })`), so the replaced meal's ingredients drop off and checked items stay checked.
  4. **[R]** Toasts: "Tuesday is now Marry Me Chicken · added to The Rotation · grocery list updated". Both side effects are named, so a disappeared grocery item (e.g. checked ricotta from the replaced lasagna) reads as intended, not as data loss.
- Imports started anywhere else keep the existing 8-second bar.

### The Rotation stays manual

Only the Make it yours → day chip path adds to The Rotation automatically. Any broader automation (e.g. "add to Rotation?" after cooking) belongs to the Home follow-up project.

## A2. Starter pack v2

**Rules (enforced in code where marked):**

| Rule | Enforced |
|---|---|
| Exactly the dinners Brian curates; target 14 | content |
| Category is `Dinners` after `normalizeMealCategory()` (`recipeSchema.js:167`) | code: gate skips anything else |
| `inRotation: true` | code: existing default |
| Photo required (stable `imageUrl`) | code: new gate |
| ≥4 ingredients, ≥2 directions | code: existing gate |
| Protein mix: ~3 chicken, 2 beef or pork, 2 fish/seafood, 1 turkey or sausage, 4 vegetarian (≤2 vegan), 2 wildcards | content |
| ≥10 of 14 take 45 minutes or less | content |
| No breakfasts, desserts, or party food | content + category gate |
| **[R]** 14 entries, all passing every gate, is a **launch blocker for Part A** | code: test fails if any entry is skipped or fewer than 14 survive |

The code gate reuses `normalizeMealCategory()`, so an entry saved as "Dinner", "Main course" or "Entree" passes and "Pasta" or "Tailgate" does not. Brian sets pasta dishes' category to Dinners when curating. Entries that fail any code gate are skipped with a `console.warn`, like the existing low-ingredient skip.

**Suggested slots** (Brian picks the actual recipes and imports them through the Import Engine, then follows the admin steps at the top of `starterKitMeals.js`):

1. Sheet-pan chicken and vegetables
2. Chicken fajitas or tacos
3. Creamy chicken pasta
4. Beef or turkey burger bowls
5. Pork or beef stir-fry
6. Baked salmon with a side
7. Shrimp tacos or garlic shrimp
8. Sausage and peppers
9. Chickpea curry (vegan)
10. Black bean enchiladas (vegan)
11. Vegetable fried rice
12. Cheesy veggie orzo
13. Wildcard (e.g. homemade pizza night)
14. Wildcard (e.g. lasagna soup)

**Existing installs are untouched.** The new pack seeds only where `STARTER_KIT_SEED_FLAG` is unset (fresh installs). Nothing is removed automatically. Settings' existing "Remove starter recipes" + "Add Starter Pack" lets an existing user swap packs.

**Spin pool:** unchanged (Rotation first, whole library as fallback; 5+ needed). A fresh install has 14 in The Rotation.

## A3. Days and edge cases

- **Plan Card visibility:** no meal on any of the next 7 days.
- **Target dates:** only the empty days among the next 7. Already-placed meals stay.
- Uses the existing multi-date path (`spinnerTargetDates` → `handleSpinnerCompleteForDates`), so no new planning logic.

| Situation | Behavior |
|---|---|
| Recipes still loading on first launch | Card shows; button disabled with "Getting your recipes ready…" |
| The Rotation has 1–4 recipes | Card copy: "Add N more to The Rotation to spin"; button **Open Meals** |
| The Rotation is empty and the library has 1–4 recipes | Card copy: "Add N more recipes to spin"; buttons **Import a recipe** and **Open Meals** |
| Library empty | Card copy: "Get your first recipes in"; buttons **Import a recipe** and **Add starter pack** |
| Spinner closed without keeping | No change; card remains |
| Offline | Spin, apply, grocery all local and work. Import follows the import sheet's existing offline rules. |
| In a home group | Existing sync inside `handleSpinnerCompleteForDates` covers it |
| Import fails or misses | Import sheet's existing Miss → Try again; day chips only after a successful save |
| Make it yours dismissed (×) | Hidden until the next Plan Card spin |
| Day chip tapped | Replace day, add to Rotation, rebuild grocery, toast naming all three |

**Out of scope (YAGNI):** weeknights-only planning, leftover nights, a "how many nights do you cook?" setting. **Again** and Quick Swap already cover "I don't want seven dinners". **[R]** If testers report that seven dinners is too many, the next knob is "spin the empty weeknights only" (a date filter in `nextEmptyDates`), not new UI.

## A4. Code changes

**New:**

| File | Job |
|---|---|
| `src/components/landing/WeekPlanCard.jsx` | Renders one of five states: `hidden`, `loading`, `emptyLibrary`, `rotationShort`, `ready`. Presentation only. |
| `src/components/MakeItYoursCard.jsx` | The card under the new week. Presentation + one callback. |
| `src/lib/landingHelpers.js` → `getPlanCardState({ loading, mealsCount, rotationCount, next7Plan })` | Pure. Returns `{ state, needed, pool }` (`needed` = recipes short of 5 and `pool` = `'rotation' \| 'library'`, both only for `rotationShort`). |
| `src/lib/landingHelpers.js` → `nextEmptyDates(today, plan, days = 7)` | Pure. Returns the empty `Date`s among the next `days`. |

**Changed:**

| File | Change |
|---|---|
| `LandingPage.jsx` | Mount `WeekPlanCard` below `AppIntroHero`; remove the Next 5 Days empty block. |
| `landing/AppIntroHero.jsx` **[R]** | Reorder slides: "Auto-plan your week" first (subtitle per A1), "Import from anywhere" second. Copy/order only. |
| `App.jsx` | `generateWeek({ dates, source })`; new `spinRequest` state `{ dates, buildGrocery, source }` passed to `WeekView`; new `importOrigin` state (`'makeItYours' \| null`); day-picker variant of the post-import bar (no auto-dismiss for that origin); chip handler = assign → rotation → grocery rebuild → toast. |
| `WeekView.jsx` | On spinner open, consume `spinRequest` to set target dates; on Keep, call `onSpinnerComplete(pairs, { buildGrocery: spinRequest.buildGrocery })`; when `source === 'planCard'`, show the grocery link + `MakeItYoursCard` instead of the "Build your grocery list →" button. |
| `starterKitData.js` | Replaced with Brian's curated dinners. |
| `starterKitMeals.js` | Add dinner-category and photo gates. |
| `App.css` (tokens) | Add `--button-fill` / `--on-button-fill` (defined in Phase 0 below; Part A introduces them because the card's button needs them). |

**Retired:** `src/components/landing/OnboardingCoach.jsx` and its mount move to `_to_delete/`. `sh_onboarding_v1` is still read by the intro carousel's retirement check; that logic is unchanged.

**Constraints:**

- Offline: all writes are local first; no new network calls.
- Dexie: no version bump (`inRotation` already exists).
- `design.md`: tokens only, 44px targets, explicit `color` on icon buttons, both themes checked.

## A5. Tests

Vitest, in the existing suite:

1. `src/__tests__/landingHelpers.planCard.test.js`
   - `getPlanCardState`: one case per state; `loading` wins over everything; `hidden` when any of the next 7 days has a meal; `emptyLibrary` when `mealsCount === 0`; `rotationShort` when `1 ≤ rotationCount ≤ 4` (`needed = 5 - rotationCount`, `pool: 'rotation'`) or when `rotationCount === 0` and `1 ≤ mealsCount ≤ 4` (`needed = 5 - mealsCount`, `pool: 'library'`); `ready` otherwise (including `rotationCount === 0` with 5+ meals, matching the spinner's whole-library fallback).
   - `nextEmptyDates`: a Saturday "today"; some days planned; all 7 planned returns `[]`.
2. Extend `src/__tests__/StarterKitMeals.test.js` **[R]**: **no** raw entry is skipped by the gate (every entry is a dinner category, has `imageUrl`, is `inRotation`, and meets ingredient/direction minimums), and at least 14 entries survive. A pack of 8 is a demo, not a first week, so this test is the launch gate.

Manual test plan (Brian, Windows):

1. Clear site data → open app → Plan Card visible under the intro carousel; carousel slide 1 is "Auto-plan your week".
2. Spin my week → Keep → Plan shows the filled week first; the grocery link count matches Shop.
3. Make it yours → import a real Instagram link → pick a day chip → that day changes, recipe is in The Rotation, grocery list updated, checked items preserved, toast names all three.
4. Repeat in dark mode, offline (spin/grocery), and in a home group.

**Ship bar [R]:** Part A is done when a cleared-site install can go card → spin → Keep → grocery count matches Shop → import one real link from Make it yours → chip a day → that day and the grocery list change, including with the network off for the spin/grocery half. If that path works but looks rough, it ships; looks are Part B.

---

# Part B — Visual Standardization (Phases 0, 1, 4)

Goal: the app looks sharper because it uses **fewer values**, not because it gets a new look. No page layouts change. Phase 2 (shared components) and Phase 3 (screen redesigns) are **not** in this spec.

**In scope:** every `src/**/*.css` file **except** `BarShelf.css`, `BarLibrary.css`, `BarFridgeMode.css`, `PantryMode.css`, `MixMode.css`, and `src/lib/photoswipe/**`. Pixel-art rules inside in-scope files (anything using `'Press Start 2P'`, the Saloon, sprites) are exempt via a `/* ds-exempt: pixel */` comment on the declaration's line.

**Inline JSX styles:** converted only in files Part A already touches (`LandingPage.jsx`, `WeekView.jsx`'s new branch, the new components). A full inline-style sweep is a separate follow-up.

## Phase 0 — Fewer values

### Tokens (in `App.css` `:root` and the dark block; `design.md` §2 and §10 updated to match)

**Radius** (same in both themes; fixes the 16px/14px split):

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | indicators, tiny badges |
| `--radius-sm` | 10px | buttons, inputs, thumbnails, chips-in-cards |
| `--radius` | 14px | cards, sections |
| `--radius-lg` | 20px | sheets, modals, hero cards |
| `--radius-pill` | 999px | pills, badges, tabs |
| (literal) | 50% | circles; stays literal |

Mapping: 2–5px → `xs`; 6–11px → `sm`; 12–16px → `radius`; 18–24px → `lg`; ≥28px, 100px, 999px → `pill`.
`ImportSheet.css`'s `--sh-radius*` become aliases: `--sh-radius: var(--radius)`, etc.

**Shadows:**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-hairline` | `0 0 0 1px rgba(60,40,20,0.09)` | `0 0 0 1px rgba(245,240,232,0.08)` | card edge instead of a border |
| `--shadow` | existing value | existing value | resting card |
| `--shadow-lg` | existing value | existing value | elevated, sheets |
| `--shadow-up` | `0 -1px 12px rgba(0,0,0,0.06)` | `0 -1px 12px rgba(0,0,0,0.4)` | bottom-anchored bars |
| `--shadow-glow` | existing value | existing value | focus |

Elevation shadows map to these. Decorative shadows (insets, text glows) may stay literal.

**Type sizes:**

| Token | Size | Role |
|---|---|---|
| `--fs-label` | 11px | uppercase labels, tab labels |
| `--fs-caption` | 12px | captions |
| `--fs-meta` | 13px | detail lines (time · ingredients) |
| `--fs-body` | 14px | body |
| `--fs-card` | 15px | card titles |
| `--fs-input` | 16px | every `input`/`textarea`/`select` (iOS zoom rule) |
| `--fs-section` | 17px | section headers |
| `--fs-title` | 22px | screen titles |
| `--fs-display` | 28px | hero headline only |

Mapping: snap to the nearest token; ties round **up** (a11y). `rem`/`em` values are converted by their px equivalent at 16px root; relative sizes that are genuinely relative (`em` inside a component) may stay.

**Filled buttons (contrast fix):**

| Token | Light | Dark |
|---|---|---|
| `--button-fill` | `#b23c00` (= `--primary-ink`, 5.93:1 with white) | `var(--primary)` (#66bb6a) |
| `--on-button-fill` | `#ffffff` | `#1f1a16` (7.29:1) |

Seasonal accents (light theme) override `--button-fill`: spring `#e2175b` (4.66:1), summer `#ad6100` (4.68:1), winter `#0b77ce` (4.62:1); autumn keeps `#b23c00`. Every filled button with text currently `background: var(--primary); color: white` moves to these tokens. Icon-only fills (e.g. the capture +) may keep `--primary` (3:1 non-text rule). All values re-verified with the `design.md` §3 snippet during implementation.

### Sweep discipline [R]

- Snap strictly by the mapping tables. No "this 13px is special" exceptions; the only exemption is `/* ds-exempt: pixel */` on Press Start / Saloon / sprite rules, including any such leftovers inside Landing's CSS.
- `--button-fill` stays `#b23c00` in light. Do not warm text-bearing buttons back to `#e65100`.
- Land Phase 0 as **one commit per file group** (e.g. App.css tokens, then Landing, then MealLibrary, then WeekView…), each with the test run, so a visual regression can be bisected to a file.
- Phase 0 does not start in the same commit or on the same day as Part A's spinner wiring.

### Exit criteria

A new test, `src/__tests__/designTokens.test.js`, reads every in-scope CSS file and asserts:

1. `border-radius` values are `var(--radius*)`, `0`, `50%`, or `inherit`, unless the line carries `/* ds-exempt`.
2. `font-size` values are `var(--fs-*)`, `inherit`, or `em`/`%`, unless exempt.
3. At most 20 distinct literal `box-shadow` values remain across in-scope files.
4. `:root` and the dark block define the same `--radius` value.

## Phase 1 — Heading type roles

- New tokens: `--font-heading` and `--fw-heading`. Default `--font-heading` = the existing system stack, so **no font download and no visual font change**.
- Screen titles, section headers and card titles use `font-family: var(--font-heading)` with their Phase 0 size role and weights: title 800, section 700, card 600 (uppercase small section labels stay in the `label` role and are not restyled).
- **Optional trial:** Gloock is already self-hosted (`public/fonts/gloock-latin-400.woff2`). Trying it is a two-token change (`--font-heading: 'Gloock', Georgia, serif; --fw-heading: 400`). Whether to ship it is Brian's call after seeing it on device. Fraunces is excluded (new font file on a page scoring 68 on mobile PageSpeed). **[R]** The Gloock trial is never part of the Phase 0 or Phase 1 commits; if kept, it lands alone as its own one-line token commit.
- No layout changes; line wraps may shift where sizes snap.

## Phase 4 — Motion polish

All animations use `transform`/`opacity` only, follow `design.md` §10 durations, and are disabled under `prefers-reduced-motion: reduce`.

1. **Photo transition into the recipe.** `TodayHeroCard` and `DayPhotoCard` get a framer-motion `layoutId` on their photo, following MealLibrary's `ml-card-img-${id}` pattern, so the photo moves into `MealDetail`. If `MealDetail`'s hero (`RecipeMediaCarousel`) cannot share a `layoutId` without restructuring, use a 200ms fade instead; the carousel is not restructured for this. **[R]** The fade is the expected outcome, not the fallback of last resort; this item never ships in a token-sweep commit.
2. **Loading placeholders shaped like the real cards** for library tiles and day cards while meals load, reusing the boot skeleton's 1200ms shimmer (the documented deviation in the P0 perf work).
3. **Favorite heart:** fill plus a 150ms scale 1 → 1.2 → 1 on toggle.
4. **Plan Card → week:** the filled week's day cards stagger in using the existing `dayCardVariants` (70ms stagger).
5. **Pager dots** only render when there are 2+ pages, wherever a carousel shows dots.

---

## Order of work

1. **Plan A: Part A.** Ships first; it is what testers hit. Introduces `--button-fill` / `--on-button-fill` because its button needs them.
2. **Plan B: Phase 0 → Phase 1 → Phase 4.** Starts after Part A is committed. Phase 0 also sweeps Part A's new files, in its own per-file-group commits (never mixed with Part A's wiring). Each phase is its own change package. The Gloock trial and the photo transition never ride along in a token-sweep commit.

## Not in this spec

- Home that adapts beyond the Plan Card (sub-project 2)
- Google Keep sync (sub-project 3)
- Letting testers pick their own starters (follow-up to A2)
- Phase 2 shared components and Phase 3 screen redesigns
- First-90-seconds analytics (needs a service the zero-cost app does not have)

## Verification (every package)

- `npm test` green apart from the known pre-existing reds (`profile.test.js`, `v28.adhoc.test.js`); `npm run test:corpus` green.
- `npm run build` on Windows.
- Both themes checked on device for every screen touched.
