# Back Button Behavior — Test Plan

**Updated:** 2026-07-19 (Tracks 0–3 overhaul)

## Overview

SpiceHub routes all back gestures through `src/navigation/backStack.js`:

| Source | Path |
|--------|------|
| Android hardware back / gesture | `popstate` → `requestBack('popstate')` |
| Chrome CloseWatcher | `requestBack('closewatcher')` (deduped with popstate) |
| Escape key | global listener → `requestBack('escape')` |
| X / swipe-down / UI | React `active=false` → `detachLayer` + `history.back()` |

LIFO stack; one gesture never closes two layers (80ms dedupe).  
Root empty stack: toast “Press back again to exit” then allow leave.

Dev dump: `window.__spicehubBackStack()`

## Architecture files

- `src/navigation/backStack.js` — stack + history + root guard
- `src/hooks/useBackHandler.js` — React registration wrapper
- `src/hooks/useRootBackGuard.js` — double-back toast wiring
- `src/hooks/useSwipeDismiss.js` — iOS swipe-down → same onClose

## Layer inventory (register via useBackHandler)

### App.jsx
detail, edit-meal, edit-drink, import, fridge, bar-shelf, bar-fridge, discover-landing, cook-mode, pip-video, mix-mode, spinner, stats, storage, settings, batch-queue, batch-review, zip-import, **export**, **age-gate**

### Nested
- MealLibrary: select, fab, reextract, quickpreview, discover, tagmgr, bulktag  
- BarLibrary: select, fab, reextract, quickpreview  
- BarShelf: bar-shelf-detail  
- WeekView: **week-picker, week-detail, week-select, week-grocery-select**  
- ImportSheet: **import-loading | import-review | import-browserAssist | import-discard** (stepped)  
- LegalDocument: legal-*  
- DishPhotoCropper: photo-cropper  

## Test matrix

### P0 — Core (Android Chrome PWA)

| # | Case | Expected |
|---|------|----------|
| 1 | Single modal back | Closes modal, stays in app |
| 2 | Stacked Detail → Cook → back | Cook closes, Detail stays |
| 3 | Double back on stack | Both close in order |
| 4 | X then back | No exit; root hint at most |
| 5 | Rapid back ×3 with 3 modals | Exactly 3 closes, no freeze |
| 6 | No modal → back | Toast “Press back again to exit” |
| 7 | Second back within 2s | Leave app / previous page |
| 8 | CloseWatcher + popstate same gesture | Only one layer closes |
| 9 | Export open → back | Export closes only |
| 10 | Age gate → back | Gate cancels, not on Bar |

### P0 — Import stepped back

| # | Case | Expected |
|---|------|----------|
| 11 | Review → back | Returns to input (not full close) |
| 12 | Loading → back | Aborts fetch, returns to input |
| 13 | Input → back | Sheet closes |
| 14 | Cropper open → back | Cropper only; import stays |

### P0 — WeekView

| # | Case | Expected |
|---|------|----------|
| 15 | Day detail panel → back | Panel closes |
| 16 | Meal picker → back | Picker closes |
| 17 | Select mode → back | Exits select |
| 18 | Grocery-select mode → back | Cancels grocery mode |

### P0 — iOS Safari / standalone

| # | Case | Expected |
|---|------|----------|
| 19 | Edge swipe with modal | Top layer closes |
| 20 | Settings swipe-down | Closes (same as back) |
| 21 | Every overlay has visible X | Manual visual check |
| 22 | Overscroll on overlay | Does not bounce-navigate away |

### P1

| # | Case | Expected |
|---|------|----------|
| 23 | Legal doc from footer → back | Doc closes |
| 24 | Share-target import → back | Works; no stranded history |
| 25 | Programmatic close after import save | No extra back needed |
| 26 | Escape (desktop) | Same as back for top layer |

## Automated

```bash
npm test -- src/__tests__/backStack.test.js
```

## Known intentional behavior

1. Toasts are not back-dismissible  
2. CookMode/MixMode back = exit without logging cook/mix  
3. Import review X still may show discard confirm; hardware back steps to input  
4. Tab switches are not on the back stack (Track 4 deferred)

## Regression checklist

- [ ] X on Detail, Import, Settings, Export  
- [ ] Share-target still opens import  
- [ ] Bar age gate still blocks first Bar visit  
- [ ] Build green  
