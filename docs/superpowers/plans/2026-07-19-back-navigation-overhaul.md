# Back Navigation Overhaul — Full App Plan

**Date:** 2026-07-19  
**Status:** Tracks 0–3 implemented (2026-07-19). Tracks 4–5 deferred.  
**Scope:** Android hardware back, iOS edge-swipe / standalone, Escape, nested layers, tab history, exit guard  
**Primary code:** `src/navigation/backStack.js`, `src/hooks/useBackHandler.js`, `src/hooks/useSwipeDismiss.js`, `src/App.jsx`, library/shelf/week overlays

---

## 1. Problem statement

Back navigation is “mostly wired” for top-level App overlays, but it is incomplete, inconsistent, and fragile:

| Symptom | Why it happens |
|--------|----------------|
| Back exits the PWA while a sheet is open | Layer never registered a history entry |
| Back closes two things at once | CloseWatcher + `popstate` both fire |
| Back closes whole Import instead of stepping back | Only one handler for multi-phase sheet |
| X / swipe works; hardware back doesn’t (or vice versa) | Parallel dismiss paths not unified |
| iOS standalone feels “stuck” | No hardware back; swipe only works if history entries exist; weak visual back affordance |
| Plan tab sub-UI ignores back | WeekView local modes never register handlers |
| Tabs don’t reverse with back | `setTab` is pure React state — no history |
| Empty back stack exits app abruptly | No root sentinel / double-back-to-exit |

Existing docs (`docs/BACK_BUTTON_TEST_PLAN.md`) list **13** modals; App alone now registers **~18**, plus nested handlers in libraries. The test plan and the product have drifted.

---

## 2. Current architecture (as implemented)

### 2.1 Core hook — `useBackHandler`

```
open modal  → history.pushState({ spicehub: 'modal', id })
            → push { pushId, id, onBack } onto module-global backStack (LIFO)
            → optional CloseWatcher('close' → onBack)

hardware back / edge swipe → popstate
            → if not programmatic: call top of backStack.onBack()
            → onBack splices self from stack + runs close callback

X / setState(false) → active false
            → programmatic history.back() + destroy CloseWatcher
            → programmaticBackCount suppresses re-entrancy for ~300ms
```

**Strengths**
- Simple API: `useBackHandler(active, onClose, id)`
- LIFO stacking works when every layer registers
- CloseWatcher covers Chrome Escape + some Android paths
- Used in App, MealLibrary, BarLibrary, BarShelf detail

**Weaknesses**
1. **Dual channel race** — CloseWatcher `close` and `popstate` can both run for one physical back. Top layer closes, then the *next* stack entry also closes (or app exits).
2. **No single owner of history** — every call site pushes its own entry; no coordinator, no priority, no debug dump in production.
3. **Module global stack** — hard to test; survives HMR oddly; no React integration.
4. **300ms timers** — race-prone on slow devices / rapid backs.
5. **No root sentinel** — empty stack = browser/PWA default (often leave app).
6. **No tab / route layer** — only overlays.
7. **Unmount cleanup** removes stack entry but does **not** always `history.back()` → orphan history entries after unmount while open.
8. **Escape is fragmented** — CloseWatcher (Chrome only) vs ad-hoc `keydown` in ImportSheet, AgeGate, LegalDocument, DishPhotoCropper, libraries, FloatingVideoPlayer.

### 2.2 Swipe dismiss — `useSwipeDismiss`

- Used only for Settings + StorageManager bottom sheets in App.
- ImportSheet uses its own framer-motion drag-down.
- WeekView DetailPanel / many other sheets have no swipe-down.
- Overlay class allowlist is hardcoded (`fm-overlay`, `st-overlay`, `bfm-overlay`).

### 2.3 What is covered today

**App.jsx (top-level)**  
detail · edit-meal · edit-drink · import · fridge · bar-shelf · bar-fridge · discover-landing · cook-mode · pip-video · mix-mode · spinner · stats · storage · settings · batch-queue · batch-review · zip-import

**Nested**  
MealLibrary: select, fab, reextract, quickpreview, discover, tagmgr, bulktag  
BarLibrary: select, fab, reextract, quickpreview  
BarShelf: drink detail while presenting  

### 2.4 What is *not* covered (gaps)

| Layer | Location | Current dismiss | Back gap |
|-------|----------|-----------------|----------|
| ExportSheet | App `exportSheet` | X / onClose only | **No handler** |
| AgeGate | App | Escape + buttons | **No handler** (back may leave app mid-gate) |
| LegalDocument | ConsentGate / LegalFooter | Escape + X | **No handler** |
| ConsentGate nested legal | ConsentGate | Escape | Same |
| WeekView day detail panel | `showDetailPanel` | X / drag | **No handler** |
| WeekView meal picker | `pickerDay` | X | **No handler** |
| WeekView select mode | `selectMode` | Cancel | **No handler** |
| WeekView grocery-select | `grocerySelectMode` | Cancel | **No handler** |
| Import multi-step | ImportSheet phases | Escape closes all | **Should step back** (review→input, cropper→review, etc.) |
| DishPhotoCropper | nested in import/edit | Escape (capture) | Should be own stack layer |
| PhotoScanSession | ImportInput | local UI | Likely unregistered |
| GroceryList sub-sheets | if any | varies | Audit needed |
| CookMode / MixMode step UI | internal steps | back = exit mode | OK if intentional; document |
| Install banner / toasts | App | auto | Correctly ignored |
| **Tab navigation** | App `tab` | bottom nav only | Back never returns previous tab |
| **Root exit** | PWA | single back leaves | No double-back-to-exit |

---

## 3. Product goals (target behavior)

### 3.1 Priority order (always)

1. **Innermost interactive layer** closes first (LIFO).  
2. Then outer overlays.  
3. Then **optional** tab history (if we enable it).  
4. Then **double-back-to-exit** (or soft “press again to leave”) at root.  
5. Never close two layers on one press.  
6. Never leave orphan history entries that “eat” the next back.

### 3.2 Platform matrix

| Platform | Primary back | Secondary | Must work |
|----------|--------------|-----------|-----------|
| Android Chrome PWA | Hardware back | Gesture back | All layers + double-exit |
| Android Chrome tab | Browser back | — | Same as PWA |
| iOS Safari PWA standalone | Edge swipe (history) | Visible X / chevron | Every layer has visible dismiss; swipe closes top layer |
| iOS Safari browser | Toolbar back + edge swipe | X | Same |
| Desktop | Browser back + Escape | — | Escape = same as back for top layer |

### 3.3 Mom-speed UX rules

- One press = one obvious step (never surprise exit).  
- Multi-step flows (Import, Cook): back = previous step, not full abort — until first step, then close.  
- Dirty forms (AddEditMeal mid-edit): back may confirm discard (optional P1).  
- iOS: never rely on “user knows edge swipe”; every overlay keeps a clear close control.  
- Optional: subtle iOS top-left “Back” chevron on full-screen overlays in standalone mode.

---

## 4. Recommended architecture

### 4.1 Replace ad-hoc stacking with a **NavigationController** (small, no router)

Keep the app SPA-simple — **do not** introduce React Router unless we later want URL deep links. Instead:

```
src/navigation/
  NavigationContext.jsx   // provider + useNavigation()
  backStack.js            // pure stack ops + tests
  useRegisterLayer.js     // replaces useBackHandler API (compat wrapper OK)
  useEscapeAsBack.js      // single Escape → top layer
  rootGuard.js            // sentinel + double-back-to-exit
```

**Layer model**

```ts
type Layer = {
  id: string;           // stable: 'import' | 'week-picker' | ...
  kind: 'overlay' | 'sheet' | 'mode' | 'tab' | 'root';
  onBack: () => void | 'prevent';  // return 'prevent' to block (dirty form)
  meta?: { label?: string; step?: number };
};
```

**Single history contract**

- Exactly **one** `popstate` listener (module or provider).  
- Exactly **one** CloseWatcher *or* treat CloseWatcher as “request back” that goes through the same `requestBack()` function (never call `onBack` directly from two places).  
- `requestBack()`:
  1. If top layer → run `onBack`, pop stack, sync history.  
  2. Else if tab history → previous tab.  
  3. Else → root guard (toast “Press back again to exit” within 2s, then `history.back()` / allow exit).

**History sync rules**

| Event | History action |
|-------|----------------|
| push layer | `pushState({ spicehub: true, layerId })` once |
| pop via hardware back | browser already popped; only update JS stack |
| pop via UI (X/swipe) | `history.back()` once, mark `programmatic` with generation token (not timer alone) |
| replace layer (import phase change) | `replaceState` or push child step layer |
| unmount while active | always detach + history.back if we still own the entry |

Use a **monotonic generation / nonce** per push instead of only `programmaticBackCount++` with fixed 300ms.

### 4.2 Compat layer

Keep `useBackHandler(active, onBack, id)` as a thin wrapper around `useRegisterLayer` so MealLibrary / BarLibrary / App don’t all rewrite on day one.

### 4.3 Escape unification

One global Escape handler:

```
if (topLayer) { preventDefault; requestBack(); }
```

Remove duplicate Escape listeners gradually (ImportSheet, AgeGate, etc.) to avoid double-close.

### 4.4 Tabs (optional Track B)

If product wants “back from Grocery → Plan”:

- Maintain `tabHistory: string[]` (max depth 5–8).  
- `navigateToTab(t)` pushes previous tab onto stack **only when user-initiated** (not when import routes you).  
- Register a single soft layer `kind: 'tab'` when `tabHistory.length > 0`.  
- **Do not** push history on every tab tap if it makes exit hard — prefer: back closes overlays first; only then unwinds one tab; then root guard.

### 4.5 iOS-specific

| Item | Approach |
|------|----------|
| Edge swipe | Ensure every open layer has a history entry (already required) |
| Standalone no chrome | Keep large X; add optional chevron on full-screen (Detail, Cook, Import) |
| Swipe-down sheets | Expand `useSwipeDismiss` (or framer pattern) to all bottom sheets; dismiss calls same `onClose` as back |
| Rubber-band / overscroll | `overscroll-behavior: none` on overlays so iOS doesn’t navigate away accidentally |

---

## 5. Implementation tracks

### Track 0 — Hardening the core (P0, foundation)

**Goal:** One press → one layer; no double-close; no orphan history.

1. Rewrite `useBackHandler` internals (or introduce `navigation/backStack.js`) with:
   - Single `requestBack(source: 'popstate' | 'closewatcher' | 'escape' | 'ui')`
   - CloseWatcher only calls `requestBack('closewatcher')`
   - `popstate` only calls `requestBack('popstate')`
   - Dedupe: if both fire within same frame/tick, second is no-op (generation lock)
2. Fix unmount path: if layer still active, `history.back()` under programmatic guard.
3. Add root **sentinel** on app boot: `replaceState` or initial `pushState` so first back never leaves accidentally without guard.
4. Double-back-to-exit toast at root (Android PWA primary).
5. Unit tests for stack ops (push/pop/dedupe/programmatic).

**Files:** `src/hooks/useBackHandler.js` → evolve or re-export; new `src/navigation/*`; `src/__tests__/backStack.test.js`  
**Success:** Rapid back ×3 with 3 stacked modals closes exactly 3 layers; X then back doesn’t exit; CloseWatcher path doesn’t double-pop.

---

### Track 1 — Coverage gaps (P0, product completeness)

Wire `useBackHandler` (or new register API) for every missing layer:

| Priority | Layer | Close action |
|----------|-------|--------------|
| P0 | `exportSheet` | `setExportSheet(null)` |
| P0 | WeekView `showDetailPanel` | close panel |
| P0 | WeekView `pickerDay` | `setPickerDay(null)` |
| P0 | WeekView `selectMode` | exit select |
| P0 | WeekView `grocerySelectMode` | cancel grocery mode |
| P0 | AgeGate | `onCancel` (don’t enter Bar) |
| P1 | LegalDocument (Consent + Footer) | `setOpenDoc(null)` |
| P1 | DishPhotoCropper | close cropper only |
| P1 | PhotoScanSession nested UI | step/close session |
| P1 | Any GroceryList / BatchImport sub-sheets found in audit pass |

**App.jsx:** add export + age-gate handlers.  
**WeekView.jsx:** four handlers (mirror MealLibrary pattern).  
**ConsentGate / LegalFooter / LegalDocument:** register when open.

**Success:** Test matrix “no orphan UI” — every visible overlay dismisses on one back.

---

### Track 2 — Multi-step Import (P0 for flagship flow)

Import is the flagship; back must feel native.

**Phases (illustrative):** `input → loading → review → (cropper) → saving`

| Current phase | Back should |
|---------------|-------------|
| input | Close sheet (confirm if URL/text dirty — P1) |
| loading | Abort fetch + return to input (not full unmount if share-target — define) |
| review | Return to input (or keep draft) |
| cropper open | Close cropper only |
| saving | Ignore or soft-block |

Implementation options:

- **A (preferred):** ImportSheet owns nested layers via `useRegisterLayer` per phase/child.  
- **B:** Single App `import` handler calls `importSheetRef.requestBack()` which returns whether it handled the step.

Prefer **B** if we want one history entry for the whole sheet and internal step state without polluting history — *or* **A** if each step should be a real history entry (better for Android “back through steps”).

**Recommendation:** Option A for cropper + review→input; one sheet-level entry always present while open.

Also: remove ImportSheet’s private Escape handler once global Escape exists (Track 0).

---

### Track 3 — iOS + swipe parity (P1)

1. Inventory all bottom sheets; attach swipe-dismiss → same `onClose` as back.  
2. Expand overlay class list / use data-attribute `data-sheet-overlay` for fade.  
3. Standalone detection (`display-mode: standalone` / `navigator.standalone`):  
   - Ensure history entries exist for open layers (Track 0).  
   - Optional back chevron on full-screen overlays.  
4. `overscroll-behavior: contain` on overlay roots.  
5. Manual test on real iPhone PWA + Safari.

---

### Track 4 — Tab history + deep links (P2, optional)

1. User-initiated tab changes push soft history.  
2. Programmatic navigations (`navigateToTab` from spin/import) use `replace` semantics (no back spam).  
3. Optional future: `?tab=grocery` query sync with `replaceState` for share/debug — out of scope unless needed.

---

### Track 5 — Dirty form confirm (P2)

AddEditMeal / AddEditDrink / Import review with edits:

- `onBack` returns `'prevent'` and opens “Discard changes?”  
- Confirm → force close; cancel → stay + re-push history if needed.

---

### Track 6 — Docs, telemetry, cleanup (P1)

1. Rewrite `docs/BACK_BUTTON_TEST_PLAN.md` to match real layer inventory (~30+ cases).  
2. Dev-only: `window.__spicehubBackStack` dump.  
3. Delete or quarantine `MealLibrary_old.jsx` if unused (dead handlers confuse audits).  
4. Optional analytics event `back_dismiss` with `{ id, source }` for crash/frustration debugging (privacy-safe, local or existing pipeline only).

---

## 6. Suggested implementation order

```
Week 1  Track 0 (core hardening + tests)
        Track 1 P0 gaps (export, week modes, age gate)
Week 2  Track 2 (import multi-step)
        Track 6 (test plan + dev dump)
Week 3  Track 3 (iOS / swipe)
        Track 4 if desired
Later   Track 5 dirty confirms
```

Do **not** ship Track 4 before Track 0 — tab history multiplies bugs if the stack is still racy.

---

## 7. Concrete file change map

| File | Change |
|------|--------|
| `src/navigation/backStack.js` | Pure stack + requestBack + tests |
| `src/navigation/NavigationProvider.jsx` | Optional context; root sentinel; double-exit |
| `src/hooks/useBackHandler.js` | Thin wrapper; fix dual-channel + unmount |
| `src/hooks/useSwipeDismiss.js` | Generic overlay attr; more sheets |
| `src/App.jsx` | exportSheet, ageGate; root guard; Escape once |
| `src/components/WeekView.jsx` | 4 local layers |
| `src/components/ImportSheet.jsx` | Stepped back; drop duplicate Escape |
| `src/components/ExportSheet.jsx` | Ensure close is stable for handler |
| `src/components/AgeGate.jsx` | Register or App-level active flag |
| `src/components/LegalDocument.jsx` | Register while open |
| `src/components/DishPhotoCropper.jsx` | Layer while open |
| `docs/BACK_BUTTON_TEST_PLAN.md` | Full rewrite |
| `src/__tests__/backStack.test.js` | New |

---

## 8. Test plan (condensed; full rewrite in Track 6)

### P0 automated (jsdom)

- push A,B,C → back → only C closes  
- UI close B while A,C… order preserved  
- CloseWatcher + popstate same tick → single pop  
- unmount active layer → stack empty + no extra popstate side effects  
- root double-back within 2s allows exit; single back shows toast  

### P0 manual Android PWA

1. Detail → Cook → back → back  
2. Import URL → review → back → input → back → closed  
3. Export open → back closes export only  
4. Week picker open → back closes picker  
5. Week select mode → back exits select  
6. No modal → back → toast → back → leave  
7. Rapid 5 backs with 3 modals — no freeze, no exit early  

### P0 manual iOS

1. Standalone: open Detail → edge swipe closes Detail  
2. Import sheet → swipe down closes (or steps)  
3. Every overlay has visible X  
4. No accidental bounce-to-Home-screen from overscroll  

### Regression

- Share-target launch still opens import; back doesn’t strand blank history  
- X on all major modals still works  
- Programmatic close after successful import doesn’t require extra back  

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| History fights with share-target `replaceState` | Document: share handler runs before sentinel; re-assert sentinel after clean URL |
| CloseWatcher unsupported (Safari/Firefox) | History path is primary; CloseWatcher optional |
| Too many pushState entries | Cap stack; replace for phase changes where appropriate |
| Double-exit annoys power users | Only when stack empty; 2s window; no toast spam |
| Touching Import mid-flagship work | Feature-flag stepped back behind `importSteppedBack` if needed |

---

## 10. Out of scope (for this plan)

- Full React Router / URL-per-recipe deep linking  
- bfcache restoration edge cases beyond smoke test  
- Changing CookMode to step-back through recipe steps (keep “back = exit cook” unless product asks)  
- Desktop-only windowing  

---

## 11. Definition of done

- [ ] Single `requestBack` path; no dual-close bugs in automated tests  
- [ ] Inventory: every user-visible overlay/mode in app is registered or explicitly exempted with reason  
- [ ] Import stepped back works on Android + iOS  
- [ ] WeekView modes respond to back  
- [ ] Export + AgeGate + Legal respond to back  
- [ ] Root double-back-to-exit on Android PWA  
- [ ] iOS standalone: swipe or X always dismisses top layer  
- [ ] `BACK_BUTTON_TEST_PLAN.md` updated and manually signed off on one Android + one iPhone  
- [ ] Build green; no new console warnings from CloseWatcher  

---

## 12. Decision checklist (for you before build)

Please confirm preferences when ready to implement:

1. **Tab history?** Yes / No / Later  
2. **Double-back-to-exit?** Yes (recommended) / Immediate exit / Soft home tab only  
3. **Import back:** step-through phases (recommended) vs always close sheet  
4. **Dirty form confirm** on Add/Edit? Now / Later  
5. **iOS back chevron** on full-screen overlays? Yes / X-only  

---

## Appendix A — Layer inventory snapshot (2026-07-19)

**Registered:** App×18, MealLibrary×7, BarLibrary×4, BarShelf×1  

**Missing / partial:** ExportSheet, AgeGate, LegalDocument×2 contexts, WeekView×4 modes, Import internal steps, DishPhotoCropper, PhotoScanSession, tab stack, root guard  

**Parallel dismiss systems:** useBackHandler, useSwipeDismiss, framer drag (Import), per-component Escape, CloseWatcher  

**Goal state:** one controller, many layers, one dismiss vocabulary (`requestBack` / `onClose`).
