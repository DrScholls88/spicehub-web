# Gemini Idea Sheets — Triage & Harmonized Inventory Plan (2026-07-25)

Sources: GeminiAnalysisEatThis.md, GeminiAnalysisFridgeFood.md, GeminiAnalysisGrocery.md
Triage is against current code state, verified by reading the actual files (not assumed from memory):
`pantryDomain.js`, `barMatch.js`, `pantryMatch.js`, `GroceryList.jsx`, `StoreMode.jsx`, `BarLibrary.jsx`,
`App.jsx`, `weekPlanner.js`, `recipeSchema.js`, `db.js`.

**Headline finding:** the app already has a unified Bar+Kitchen inventory (`db.barInventory`, one table,
domain-flagged by `pantryDomain.js`). It does **not** have a unified Grocery↔Pantry inventory. `GroceryList.jsx`
has its own fake "pantry" — a pseudo-store (`store === '__pantry__'`) on `db.groceryItems` rows — that has
never been wired to the real `db.barInventory`. Checking an item off in Grocery doesn't stock it in Pantry/Bar;
running out in Pantry/Bar doesn't re-add it to Grocery. That gap is the actual work behind "harmonize Pantry,
MyBar, and Grocery into one inventory," and it's more precise than what any of the three docs described.

---

## Verdicts

### Reject (would regress the constitution)
| Idea | Sheet | Why |
|---|---|---|
| Reverse-engineered Hy-Vee cart API / stored session cookie or auth token (Path 2) | Grocery | Requires storing a live retailer session credential client-side or server-side. Violates "Security-First Architecture / zero tolerance for hardcoded secrets" and the offline-first, zero-cost posture — also self-admitted by the sheet as high-maintenance and breakage-prone. |
| Companion Chrome extension that intercepts the user's logged-in Hy-Vee session (Path 1) | Grocery | Out of scope for a PWA; a second codebase/distribution channel to maintain for one regional chain. Not worth it pre-revenue. |
| Enterprise middleware (Basketful/Whisk/SmartCommerce) for cart population (Path 3) | Grocery | Paid/affiliate dependency, contradicts "Zero-cost downloadable PWA." |

### Already shipped (do not rebuild)
| Idea | Sheet | Evidence |
|---|---|---|
| Per-slot Lock + single-slot Swap/regenerate ("🔒 Lock" / "🎲 Swap") | Eat This Much | `App.jsx` `toggleLockDay` (line 959) + `respinDay`/`pickForSlot` (line 874, `weekPlanner.js` line 221), both wired to UI via `onToggleLock` / `onRespin` props. |
| Recurring "always lock this day" pattern | Eat This Much | `lockAllPlanned` (`App.jsx` line 971) generalizes this already. |
| Scraper sanitization / "ghost header" filtering (`1x 2x 3x`, `Ingredients (serves 4):`, `Topping:`) | Grocery | `recipeSchema.js` lines 344–383, `isTrashIngredientLine()` — a full Phase G trash filter, broader than the sheet's proposal (also strips hype/sign-off/social-CTA lines). |
| Native share-sheet export (iOS/Android → Reminders, Keep, Todoist, SMS) | Grocery | `GroceryList.jsx` `sendToKeep()` (line 105) already calls `navigator.share()`. Function name is legacy ("Keep") but behavior is the generic share sheet already. |
| In-store Focus/Store Mode: filtered single-store view, big tap targets, progress ring, WakeLock | Grocery | `StoreMode.jsx` — `ProgressRing` (line 46) + `navigator.wakeLock.request('screen')` (line 144). Fully built. |
| Store memory ("last bought at X, route restocks there") — the plumbing | Grocery | `db.js` `saveStoreMemory`/`getStoreMemory` + `GroceryList.jsx` `rememberStore()` (line 97) already persist per-ingredient store assignment and `App.jsx` `buildGroceryList` (line 1144) reads it back in. What's missing is only the Pantry→Grocery trigger (Phase 2 below), not the memory itself. |
| Categorized staple quick-add (Essentials/Baking/Oils/Sauces/Plant-Protein groups) | FridgeFood | `pantryDomain.js` `STAPLE_GROUPS` (line 85) + `PantryIngredientCatalog.jsx`. |
| Staples exempted from "missing ingredient" counting — the primitive exists | FridgeFood | `pantryDomain.js` `isStaple()` (line 150) exists but is **not used** by `pantryMatch.js` yet — see Phase 1, this is the one place the primitive isn't wired up. |
| Personal curated library vs. generic recipe database | Eat This Much | This is the app's entire premise (Instagram import). Not actionable, just confirms current direction. |

### Adopt (real gaps, worth building)
| Idea | Sheet | Why |
|---|---|---|
| Tiered "Ready to Cook 🟢 / Almost There 🟡 (missing 1)" match view for meals | FridgeFood + Eat This Much | `BarLibrary.jsx` already built this exact pattern for drinks (`matchScore`, `almostReady` = missing 1–2, `bl-qf-badge` count, lines 81–202). Kitchen only has a flat 60%-coverage cutoff (`pantryMatch.js`) with no tiers, no staple exemption, and it's used in exactly one place (Landing page). Port the proven Bar pattern to Meals. |
| Pantry-match badge on recipe/meal cards | Eat This Much | No such badge exists today; `findPantryMatches` output isn't surfaced on `MealLibrary` cards, only a Landing-page list. |
| "Add missing ingredient to grocery" one-tap action on Almost-There meal cards | FridgeFood | Bar already has this via the `bar-quest` tag pattern (`App.jsx` `handleAddToGrocery`, line 1192) — reuse that plumbing for meals instead of inventing a new path. |
| **Real** Pantry↔Grocery harmonization (replace the fake `__pantry__` pseudo-store with the actual `db.barInventory`) | Grocery | The core gap — see Phase 2. |
| Deep-link "Search on [Store]" buttons per grocery item (Option A only) | Grocery | Cheap, no credentials, no maintenance burden — just a URL template per store, tap opens the store's own search. |

### Defer / low priority
| Idea | Sheet | Why |
|---|---|---|
| Per-slot complexity/time constraints (e.g., "Mon–Thu dinners = Quick Weeknight only") | Eat This Much | Real idea, but additive to an already-solid planner; not part of the inventory-harmonization ask. Backlog after Phases 1–3 below. |
| Mini category filter tabs above Quick Add chips | FridgeFood | `STAPLE_GROUPS` already segments staples into labeled shelves; fresh-item quick-add chips are a short, scannable list already. Low marginal value — revisit only if the fresh-add list grows past ~15 items. |

**Housekeeping note (unrelated to these docs):** `App.jsx.fixed` exists alongside `App.jsx` in the repo root — looks like a stray merge/recovery artifact. Flagging for you to confirm whether it's safe to delete; not touching it without your say-so.

---

## Architecture: the harmonized lifecycle

One inventory record lives in exactly one of two "location" states at a time, tracked by where it's stored today
— no new table needed, no migration of `db.barInventory`'s schema:

```
   NEEDED (db.groceryItems, active)
        │  buy it / check it off
        ▼
   OWNED (db.barInventory, qtyLevel FULL/MEDIUM/LOW)
        │  "Run Dry" (qtyLevel → EMPTY) or manual "↩ Move to Grocery"
        ▼
   NEEDED (db.groceryItems, re-created, routed to remembered store)
```

`db.groceryItems` stays the "shopping trip" table (store sections, checked state, Store Mode) — that part of the
model is fine and shouldn't be merged away. The fix is that **both directions of the arrow must go through
`db.barInventory`**, using functions that already exist (`addToBarInventory`, `updateBarBottle`,
`removeFromBarInventory`, `getInventory({domain})`), instead of the parallel fake `__pantry__` store string.

---

## Phase 1 — Port the Bar's match-tiering to the Kitchen

**Goal:** `pantryMatch.js` gets the same Ready/Almost tiering `BarLibrary.jsx` already proved out, and staples stop counting as "missing."

**Files:**
- Modify: `src/lib/pantryMatch.js`
- Modify: `src/components/LandingPage.jsx` (consumes the new shape)
- Modify: `src/components/MealLibrary.jsx` (add the badge)
- Test: `src/__tests__/pantryMatch.test.js` (new)

**Package 1a — tiered matcher**
1. In `pantryMatch.js`, import `isStaple` from `pantryDomain.js`. Before counting an ingredient as missing, check `isStaple(name)` — staples always count as matched, mirroring FridgeFood's "salt and steak aren't the same weight" point and BarLibrary's existing bar-side convention.
2. Replace the single `MATCH_THRESHOLD = 0.6` cutoff with two buckets computed the same way `BarLibrary.jsx` computes `almostReady` (missing > 0 && missing <= 2): return `{ ready: [...], almost: [...] }` instead of one flat array, each entry keeping `{ meal, matched, total, missing }` (unchanged shape, just bucketed).
3. Update `findPantryMatches` callers (`LandingPage.jsx` line 288) to read `.ready` / `.almost` instead of a flat list.

**Package 1b — surface it**
4. Add a small badge to `MealLibrary.jsx` cards: 🟢 "Ready to cook" or 🟡 "Missing {n}" using the same result, computed once per render pass (not per-card) and passed down, matching how `BarLibrary.jsx` precomputes `almostCount` once (line 199).
5. On Almost-There cards, add a "+ Add missing to grocery" action that calls the existing `handleAddToGrocery` path (`App.jsx` line 1192) with the specific missing ingredient(s), reusing the `bar-quest`-style tag pattern already proven for drinks (generalize the tag, don't fork a new one).

**Testing:** unit test `pantryMatch.js` with a fixture pantry (some staples, some fresh items) against 3 fixture meals — assert one lands in `ready`, one in `almost` with the correct `missing` list, one is excluded (too many missing). Run `npm test`.

**Commit:**
```
git add src/lib/pantryMatch.js src/components/LandingPage.jsx src/components/MealLibrary.jsx src/__tests__/pantryMatch.test.js
git commit -m "feat(pantry): tier meal matches into ready/almost, exempt staples from missing count"
```

---

## Phase 2 — Real Pantry↔Grocery harmonization (the core ask)

**Goal:** delete the fake `__pantry__` pseudo-store; route grocery ↔ pantry through `db.barInventory` for real.

**Files:**
- Modify: `src/components/GroceryList.jsx`
- Modify: `src/App.jsx` (`buildGroceryList`, ~line 1119)
- Modify: `src/db.js` (small helper additions only, no schema/version bump needed — `barInventory` already has everything: `qtyLevel`, `category`, `addedAt`)

**Package 2a — grocery build reads real inventory**
1. In `App.jsx`, `buildGroceryList` currently builds `items{}` purely from `weekPlan` ingredients + `window._storeMemory`. Before pushing a new key into `items`, call `getInventory({ domain: 'all' })` (imported from `pantryDomain.js`) once per build, index it by canonicalized name, and check: staple → skip entirely (never appears on the list, matching FridgeFood's rule); in-stock non-staple with `qtyLevel` FULL/MEDIUM → route into a new `covered: true` flag on the item instead of `active`; anything else → normal active/unsorted flow (unchanged).
2. Replace the `__pantry__` pseudo-store rendering block (`GroceryList.jsx` lines ~745–763, the `gl-pantry-section`) with a "Pantry Covered" accordion driven by `item.covered`, not `item.store === PANTRY_ID`. Visually it's the same muted section FridgeFood/Grocery docs both describe — the data source changes, not the UI shell.
3. Delete `PANTRY_ID`/`PANTRY_STORE`, `markAsPantry`, `unmarkPantry` from `GroceryList.jsx`. Replace their two call sites (drag-to-pantry-zone, swipe action) with two new handlers described next.

**Package 2b — check off → really stock it**
4. New handler `promoteToInventory(name)` in `GroceryList.jsx`: calls `addToBarInventory(name, { qtyLevel: 'FULL' })` (already imported, already used once for bar-quest at line 358 — generalize that call site to run for *any* grocery item the user marks bought, not just quest items), then removes/greys the item from the active grocery list.
5. Wire this to the existing "mark bought"/checkbox interaction so buying something for real also stocks it — this is the "Grocery → Pantry" half of the loop that never previously touched `db.barInventory` for ordinary items.

**Package 2c — run dry → really re-add it, at the right store**
6. In `PantryMode.jsx` / `BarFridgeMode.jsx`, when a user sets `qtyLevel` to `EMPTY` ("Run Dry"), call a new `db.js` helper `getStoreMemory(name)` to look up the last store, then call the existing `App.jsx`-level grocery-add path (same one `handleAddToGrocery` uses) so the item reappears already routed to Hy-Vee/Trader Joe's/etc. instead of landing in Unsorted — this closes Grocery doc's "Store Memory for Pantry Restocks" idea using infrastructure that already exists (`saveStoreMemory`/`getStoreMemory`), it just needs this one new call site.
7. No schema change needed: `db.barInventory` already has `qtyLevel`; `db.groceryItems` already has `store`.

**Testing:**
- `npm test` — extend `pantryDomain.test.js` or add `src/__tests__/groceryPantryLoop.test.js` covering: (a) a staple ingredient never appears in a built grocery list, (b) a FULL-stocked non-staple lands in `covered`, (c) `promoteToInventory` results in a `db.barInventory` record, (d) setting `qtyLevel: 'EMPTY'` on an existing bottle produces a grocery item pre-assigned to its remembered store.
- Manual pass (Windows): `npm run build`, then in the running app — add a recipe with a staple + a fresh item to the week, build grocery, confirm the staple never shows; check off a non-staple item, confirm it now appears in Pantry/My Bar; set that item to Run Dry in Pantry, confirm it reappears in Grocery already under its last store.

**Commit:**
```
git add src/components/GroceryList.jsx src/App.jsx src/db.js src/components/PantryMode.jsx src/components/BarFridgeMode.jsx src/__tests__/groceryPantryLoop.test.js
git commit -m "feat(inventory): replace fake grocery pantry toggle with real barInventory sync, both directions"
```

---

## Phase 3 — Deep-link store search buttons (cheap, no credential risk)

**Goal:** one-tap "search on [Store]" per grocery item, Grocery doc's Option A only.

**Files:**
- Modify: `src/components/GroceryList.jsx` (STORES array already has `id`/`name`/`color`/`logo` per store, line 26)

**Package 3a**
1. Add a `searchUrl` template per entry in the existing `STORES` array, e.g. Target `https://www.target.com/s?searchTerm=`, Trader Joe's has no public search deep link (skip/disable for that one — don't fabricate one), HyVee `https://www.hy-vee.com/aisles-online/search?q=`, Costco `https://www.costco.com/CatalogSearch?keyword=`. Verify each URL still resolves before shipping (retailers change search params).
2. Add a small 🔍 icon button next to each item that opens `store.searchUrl + encodeURIComponent(item.name)` in a new tab — no auth, no scraping, no maintenance beyond the URL template itself.

**Testing:** manual click-through per store in Chrome, confirm the search actually populates (retailers occasionally require exact param names).

**Commit:**
```
git add src/components/GroceryList.jsx
git commit -m "feat(grocery): one-tap deep-link search per item on assigned store"
```

---

## Backlog (not in this sprint)

- Per-slot time/complexity constraints on the weekly planner (Eat This Much #3).
- Category filter tabs above fresh-item quick-add chips (only if that list grows).
- Resolve/delete `App.jsx.fixed` (confirm with Brian first).

---

## Summary for Brian

Three sheets, three verdicts: the "in-store shopping" and "lock/swap planner" ideas are already built — nothing
to do there. The one real, valuable gap across all three documents is that Grocery has never actually talked to
the Pantry/Bar inventory; it faked it with a per-item toggle. Phase 2 fixes that for real, using plumbing
(`barInventory`, store-memory) that already exists. Phase 1 ports the Bar's already-working "almost there"
matching to meals. Phase 3 is a cheap, safe version of "send to store" — the two credential-based Hy-Vee cart
integrations in the Grocery sheet are rejected outright as security/scope regressions.
