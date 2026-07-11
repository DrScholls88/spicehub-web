# Gemini Idea Sheets — Triage & Implementation Plan (2026-07-10)

Sources: GeminiAnalysisSaloon.md, GeminiAnalysisPantry.md, GeminiAnalysisBackroomBarFridge.md
Triage is against current code state (Saloon Alive Pack shipped, My Bar pixel buildout A–C complete,
barMatch engine + Dexie v17 granular bottles + BottleEditSheet + ingredient normalizer/entities live).

---

## Verdicts

### Adopt (clear wins)
| Idea | Sheet | Why |
|---|---|---|
| Consolidate header into ⚙ TOOLS menu (keep + IMPORT visible) | Saloon | Real crowding: 5+ controls in topbar. Import stays top-level — it's the keystone feature. |
| Western-theme the topbar (brass/wood/parchment, pixel font) | Saloon | "Cyberpunk header on western room" clash is accurate and cheap to fix. |
| Speech bubble → auto-fade toast (4 s) + reappear on tap/state change | Saloon | Finishes the "quote box obstructive" complaint properly. |
| Push shelves ~24 px below the shingle | Saloon | Sign currently collides with top-shelf labels. One CSS value. |
| Anchor boards with pixel nails/strings; bartender torso clipped by counter | Saloon | Cheap gravity fixes; anchoring already half-done for the door. |
| Empty-slot "locked bottle" silhouettes | Saloon | Gamifies empty shelves; pairs with existing cobwebs. |
| Door dressing: STOCKROOM sign, amber light spill, crate/barrel, creak + swing-open transition | Saloon | Builds on the new backbar door; all additive. |
| WANTED poster tap → full parchment modal (big mugshot, bounty, unlocks, Add-to-Quest CTA) | Saloon | Posters are tiny; modal gives the data room. Mugshots already exist. |
| Detail card View/Edit split (View: stock bar, "Unlocks X recipes" via barMatch, flavor tags; Edit behind ✏) | Pantry | Highest-value UX idea in the sheets. barMatch already computes unlocks. |
| **Bug**: BottleEditSheet placeholders show gin examples ("Tanqueray", "London Dry") for every spirit | Pantry | Real bug — make placeholders per-category. |
| Semantic quantity enum [EMPTY, LOW, MEDIUM, FULL] + visual fill stepper | Backroom | Right call for frictionless tracking; maps onto v17 qty field. |
| "Run Dry" → silhouette sprite + auto-add to grocery quest | Pantry | Closes the bar→grocery loop that quest list already started. |
| Catalog: collapsible categories + sticky jump-dock (SPR/LIQ/MIX…) | Pantry | 180+ items = real scroll fatigue. Pure utility. |
| Catalog selection: silhouette→color "wake" (replaces ✓ badge) + pop animation | Pantry | Diegetic, removes the flat-web checkmark, no overlap badge needed. |
| Reskin chips/search as parchment tags + ledger; inset FRIDGE 2000 HUD; ground the cactus | Pantry | Cheap CSS/asset polish, big cohesion gain. |
| can_drink / can_eat / can_both flags on the ingredient catalog | Backroom | Foundation for the pantry; derivable from existing category data — no schema rewrite. |
| Dual-icon 🍸/🍳 crossover tags | Backroom | Trivial once flags exist. |
| Proximity Match on Meal Library ("5 of 6 — missing lemon") | Backroom | Bar side already does this; porting to meals is the single most useful pantry feature. |
| Staples vs Perishables (staples default In Stock) | Backroom | Solves the #1 reason inventory tracking gets abandoned. |

### Adapt (good instinct, different execution)
- **Pin ALL/CKTL/MOCK/NEW to an opaque bottom bar** → keep the diegetic stools (they're the charm), but clear a reserved floor strip: lower label z-index, prevent overlap with bartender/counter art. Revisit only if it still reads cluttered.
- **Remove bottle text labels + tooltip** → labels stay (glanceability matters on mobile); instead fix truncation with the chalkboard marquee for long names and rely on tap → detail card.
- **Two doors / Supply Depot hub** → one new door when the Pantry ships (Phase 5), not before; skip the hallway hub.

### Defer
- Horizontal "camera pan" bar counter carousel — big rework, gesture conflicts with page swipes.
- Drag-and-drop shelf rearrangement — high effort, low utility vs. smart category shelving.
- Cross-system stock drain (auto-decrement on making a drink/meal) — revisit after semantic quantities prove out; auto-drain risks wrong data + entry fatigue.
- Tavern Orders / combo quests — great retention hook, but needs the Pantry to exist first.
- Expiration/freshness spinner weighting — ship the simple freshness dot first (5.5), weighting later.

### Reject
- Dynamic shelf-count scaling (hide empty shelves) — conflicts with the locked-silhouette gamification, causes layout jumps.
- Full "Focus Panel" HUD replacing labels — duplicative of the existing tap → detail card flow.

---

## Phased Packages

### Phase 1 — Saloon Declutter & Cohesion (BarShelf.jsx + App.css; S/M) — ✅ SHIPPED 2026-07-11
1. ⚙ TOOLS popover in topbar housing REMODEL / TUNE / FILL; keep BACK, title, count, + IMPORT. Wood-plaque button skin, brass/parchment palette, pixel font across topbar.
2. Speech bubble: fades after 4 s (AnimatePresence exit), returns on bartender tap or state change; idle quips become periodic pop-ins instead of persistent.
3. Shelves start 24 px lower; shingle gets its own row.
4. Pixel nails + string on chalkboard/bounty board; verify bartender counter clipping.
5. Empty slots: dim "?" locked-bottle silhouettes (import CTA on tap unchanged).
6. Door: crooked STOCKROOM sign, light spill on floorboards, crate stack, 8-bit creak + swing-open before the transition fires — **extends RoomTransition.jsx (currently a minimal 62-line veil component) with a door-swing pre-phase**.

### Phase 2 — Wanted Modal (BarShelf.jsx; S) — ✅ SHIPPED 2026-07-11
1. Slim posters to mugshot + WANTED.
2. Tap → full-screen parchment modal: 64 px outlaw, nickname, bounty $, "wanted for" ingredient, recipes it unlocks (barMatch), Add-to-Quest CTA. Torn-edge clip-path, stamp-in animation.

### Phase 3 — My Bar Stock UX (BarFridgeMode.jsx, BottleEditSheet, IngredientCatalog.jsx; M/L) — ✅ SHIPPED 2026-07-11
1. Detail card View Mode default: large sprite, pixel stock bar, "Unlocks X recipes"; ✏ opens existing edit form. Rename Save/Remove → STASH/TOSS with pressed states. Unlocks memoized per bottle via `matchDrink` (alias-aware).
   **Implementation deviation:** the unlocks tap-through opens BarFridgeMode's own slide-up Drinks panel with a "using: X" filter chip (alias-aware via matchDrink) instead of routing to BarLibrary — zero cross-screen navigation, fewer taps, and the panel is already in the room. BarLibrary `initialFilter` left unbuilt; add later only if a cross-screen entry point is wanted.
2. Per-category dynamic placeholders (fixes gin-examples-on-bourbon bug).
3. Semantic quantity [-]/[+] stepper with bottle-fill visual; store enum alongside v17 qty. **Enum values are strings ('EMPTY'|'LOW'|'MEDIUM'|'FULL'), additive field — never replace/repurpose the existing qty field (Dexie migration safety).**
4. Run Dry: swipe-down/double-tap → EMPTY, silhouette sprite, auto-push to grocery quest — **via App's `handleAddToGrocery` (dedupes by name, tags 'bar-quest'), which persists to the single Dexie `groceryItems` table (`++id, name, storeId, isChecked`). P5.3 must use the same path so both writers share one store + dedupe.** Grocery is local-only Dexie — works offline natively, no service-worker/backgroundSync changes needed.
5. Catalog: collapsible category sections + sticky pixel jump-dock; silhouette-wake selection + scale-bounce; parchment chip reskin; ledger-style search; FRIDGE 2000 inset bezel; cactus in a pot on the shelf line.

### Phase 4 — Shared Pantry Backend (lib/, resources JSON, db.js; M) — ✅ SHIPPED 2026-07-11
> Implemented as `src/lib/pantryDomain.js`: derived flags (bar taxonomy = categorizeBottle, kitchen = new keyword table, crossovers = BOTH_KEYWORDS override list; unknowns default to edible), `getInventory({domain})` over the single `barInventory` store with pure `filterRecordsByDomain` for tests, shared QTY enum moved here from BarFridgeMode, dual-duty 🍸🍳 tags in catalog + bottle sheet. Also fixed: `updateBarBottle`'s field whitelist was silently dropping `qtyLevel` (P3 Run Dry saves) — added `qtyLevel` + `addedAt`; `addToBarInventory` now preserves `qtyLevel` on re-add. Tests: `src/__tests__/pantryDomain.test.js`.
1. Add domain flags (can_drink/can_eat/can_both) to the normalizer catalog — derived from existing categories, overridable per item.
2. Unified inventory accessor: `getInventory({ domain: 'bar' | 'kitchen' })` over the single store; bar = drink+both, kitchen = eat+both.
3. Shared semantic-quantity enum module (used by Phase 3.3 and Pantry).
4. Dual-icon crossover tags in catalog + detail cards — kept here (not P3) because they depend on the flags; this is P4's only visible change and doubles as its smoke test.
5. Tests: flag derivation, domain filtering, enum round-trip. **Also run `npm run test:corpus` after P4 — it touches the shared ingredient normalizer the import pipeline depends on.**

### Phase 5 — Kitchen Pantry Screen (new PantryMode.jsx off Meal Library; L) — ✅ SHIPPED 2026-07-11
> Implemented: `PantryMode.jsx` (morning-lit cream/oak/brass theme, sprites recontextualized in ceramic dishes + brass-lid jars), FRESH zone w/ freshness dots (fresh<3d/aging≤6d/old>6d, red pulses), STAPLES cabinet (24 staples default In Stock, tap→ledger→run out), gourmet ledger card (shared qty stepper, storage tip per category, "Cook with this"), WHAT CAN I COOK? proximity panel (ready/almost tiers, missing 1–2 highlighted red, one-tap +🛒 via handleAddToGrocery), cookhouse door in the Saloon (chef hat, steam, creak) → pantry. FridgeMode fully superseded — App renders PantryMode at every old entry point (header 🧺 + Landing tile); FridgeMode.jsx now unreferenced/tree-shaken, delete in a cleanup commit. **Deviation:** proximity match lives in PantryMode's panel, not as badges inside MealLibrary.jsx — same data, zero risk to the 49KB library component; in-library badges remain a follow-up if wanted.
1. Upscale theme: marble/oak palette, morning-light gradient, same sprites recontextualized in mason jars / ceramic bowls / baskets (container assets, not new sprites).
2. Staples vs Perishables zones; staples default In Stock.
3. Proximity Match in Meal Library: "You have 5 of 6" badges + missing-ingredient highlight → one-tap add to grocery.
4. Gourmet ledger detail card: storage tip line + "Cook with this" (pre-filtered Meal Library).
5. Freshness dot (green/yellow/red) on perishables — manual reset on restock.
6. Second saloon door (cookhouse) appears only once PantryMode exists.
7. **FridgeMode.jsx disposition:** the existing "What's in My Fridge?" sheet (ephemeral, type-in-ingredients meal matcher) is superseded — refactor it to read the persistent pantry (thin wrapper over PantryMode's matcher) or retire it and point its entry button at PantryMode. Decide at P5 start; do not leave two competing fridge UIs. (BarFridgeMode.jsx is the bar side and is unaffected.)

## Standing Requirements (all phases)
- **Reduced motion:** every new animation (door swing, stamp-in modal, silhouette-wake, fill stepper, etc.) ships with a `prefers-reduced-motion: reduce` variant in the same commit — not as a later pass. Pattern already established in the Saloon Alive Pack CSS block.
- **Offline-first:** all inventory/grocery writes stay local Dexie; nothing new touches the network or service worker.
- **Import pipeline untouchable:** any phase touching `ingredientNormalizer`/`ingredientEntities`/`recipeSchema` (P4) must pass `npm run test:corpus` before commit.
- **One grocery writer path:** all quest/missing-ingredient pushes go through `handleAddToGrocery` → Dexie `groceryItems`. No component writes that table directly.

## Carry-Forward Risks
- **barMatch cost:** memoize unlocks-per-ingredient by inventory hash; never run the full matcher inside render or per-frame.
- **Dexie compatibility:** semantic enum is a new string field beside v17's qty — additive only; write a v18 migration that backfills from qty where derivable.
- **IngredientCatalog.jsx growth:** currently ~4.5 KB; P3.5 (collapsible sections + jump-dock + reskin) will triple it — split into an `IngredientCatalog/` directory (Grid, Section, JumpDock) when it crosses ~15 KB.
- **App.css debt:** ~496 KB and growing. P1's reskin should prefer replacing rules over appending; audit the topbar section for dead rules while in there. Longer-term: carve saloon/bar styles into `BarShelf.css` (pattern already used by CookMode.css, StoreMode.css).
- **BarLibrary filter API:** tap-through needs an `initialFilter` prop; keep it additive so existing entry points don't change behavior.

**Order rationale:** 1–2 finish the Saloon's polish debt while it's fresh; 3 makes the existing bar inventory genuinely useful; 4 is the quiet foundation; 5 is the new surface that pays it all off. Each phase = one conventional commit package with its own testing pass.

---

## Testing plan per phase
- Every phase: `npm run build` clean + reduced-motion spot check (OS toggle) before commit.
- P1/P2: manual — topbar menu, bubble fade/tap, door swing transition, poster modal.
- P3: unit tests for quantity enum mapping + run-dry→grocery (assert single `groceryItems` write path + dedupe); manual catalog scroll/jump-dock on a phone; verify "Unlocks X" tap lands in BarLibrary correctly filtered.
- P4: vitest for flag derivation + domain filters (`npm test`) **and `npm run test:corpus`** (import pipeline regression — normalizer is shared); only visible change should be dual-icon tags.
- P5: build + manual proximity-match correctness against normalizer edge cases (structured vs legacy ingredients); confirm FridgeMode entry point resolves to exactly one fridge UI; grocery one-tap add dedupes against existing list + week-plan-generated items.
