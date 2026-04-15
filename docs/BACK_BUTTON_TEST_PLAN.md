# Back Button Behavior — Test Plan

## Overview
SpiceHub uses a `useBackHandler` hook that combines the CloseWatcher API (Chrome 120+) with history.pushState/popstate to intercept the hardware back button in PWA standalone mode.

## Modals Under Test (13 total)
1. MealDetail (recipe preview)
2. AddEditMeal (new/edit meal)
3. AddEditDrink (new/edit drink)
4. ImportModal (recipe import)
5. FridgeMode (ingredient search)
6. BarShelf (bar inventory)
7. BarFridgeMode (cocktail ingredient search)
8. CookMode (step-by-step cooking)
9. MixMode (step-by-step mixing)
10. MealSpinner (week plan animation)
11. MealStats (cooking statistics)
12. StorageManager (storage settings)
13. Settings (theme settings)

## Test Matrix

### Platform: Android Chrome PWA (Installed)
| # | Test Case | Steps | Expected | Priority |
|---|-----------|-------|----------|----------|
| 1 | Single modal back | Open MealDetail → press Back | Detail closes, stays in app | P0 |
| 2 | Stacked modals back | Open MealDetail → open CookMode → press Back | CookMode closes, Detail stays | P0 |
| 3 | Double back from stack | Open MealDetail → open CookMode → Back → Back | CookMode closes, then Detail closes | P0 |
| 4 | X button then back | Open MealDetail → click X → press Back | Detail closes via X, back does nothing (doesn't exit) | P0 |
| 5 | Rapid back presses | Open 3 modals quickly → press Back 3 times fast | All 3 close in reverse order | P1 |
| 6 | Back with no modal | No modal open → press Back | App exits normally (or goes to previous page) | P1 |
| 7 | Import modal back | Open Import → start URL import → press Back | Import modal closes, import cancelled | P0 |
| 8 | CookMode back | Open CookMode (mid-recipe) → press Back | CookMode closes WITHOUT logging cook | P0 |
| 9 | MixMode back | Open MixMode → press Back | MixMode closes WITHOUT logging mix | P0 |
| 10 | Settings back | Open Settings → press Back | Settings closes | P1 |
| 11 | Storage Manager back | Open Storage Manager → press Back | Storage Manager closes | P1 |
| 12 | Spinner back | Start Meal Spinner → press Back | Spinner closes, no week plan generated | P1 |
| 13 | FridgeMode back | Open Fridge → press Back | Fridge closes | P1 |

### Platform: Android Chrome (Browser, not installed)
| # | Test Case | Expected |
|---|-----------|----------|
| 14 | Single modal back | Modal closes (history-based handler works in browser too) |
| 15 | No modal back | Normal browser back behavior |

### Platform: iOS Safari (Standalone/PWA)
| # | Test Case | Expected |
|---|-----------|----------|
| 16 | Swipe-back gesture | If modal open: modal closes via popstate |
| 17 | No physical back button | N/A — iOS has no back button in standalone mode |
| 18 | Edge swipe (iOS 15+) | If history has entries: triggers popstate, closes modal |

### Platform: iOS Safari (Browser)
| # | Test Case | Expected |
|---|-----------|----------|
| 19 | Bottom toolbar back | Modal closes if open |
| 20 | Swipe-back gesture | Modal closes if open |

### Platform: Desktop Chrome/Edge
| # | Test Case | Expected |
|---|-----------|----------|
| 21 | Escape key (CloseWatcher) | Modal closes (Chrome 120+ via CloseWatcher) |
| 22 | Browser back button | Modal closes via popstate |
| 23 | Alt+Left arrow | Modal closes via popstate |
| 24 | Keyboard Escape (no CloseWatcher) | Not handled by this hook — modals may have own Escape handling |

### Edge Cases
| # | Test Case | Expected |
|---|-----------|----------|
| 25 | Refresh with modal open | Extra history entries cleaned up, no orphaned state |
| 26 | Switch tabs and return | Modal still open, back handler still works |
| 27 | Open modal, go offline, press back | Modal closes normally (no network needed) |
| 28 | PWA launched from share-target | Share-target URL processed, back button works normally |

## CloseWatcher API Support
- Chrome 120+: Full support (keyboard Escape + Android back)
- Firefox: Not supported (falls back to history)
- Safari: Not supported (falls back to history)
- Edge: Same as Chrome

## Known Limitations
1. iOS Safari standalone mode has no hardware back button — rely on swipe gesture or X buttons
2. CloseWatcher can throw if too many instances (>1 active) — gracefully falls back
3. CookMode/MixMode back does NOT log cooking (intentional — back = cancel)
4. Toast notifications are not dismissible via back (by design)

## Regression Risks
- Verify X button on every modal still works after adding back handler
- Verify programmatic close (e.g., after import success) doesn't break history state
- Verify deep-linking and share-target still work
