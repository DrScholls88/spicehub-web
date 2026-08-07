# Bar Library Parity + Drink Import Repair — Implementation Plan

**Date**: 2026-08-07
**Status**: Plan only. No code changed.
**Sequencing (user-selected)**: Phase 1 (drink import) ships standalone first. Phases 2–4 follow.
**Aesthetic direction (user-selected)**: Speakeasy / after-dark — same bones as MealLibrary, night-mode counterpart.

---

## 0. Diagnosis — what I actually found

### 0.1 The headline finding

**The Bar has a rich, fully-tested domain layer that the Bar UI never calls.** This is not a "build new features" problem, it is a "wire up what already exists" problem — which makes most of Phase 3 far cheaper than it looks.

| Module | Status | Consumed by |
|---|---|---|
| `src/lib/barMatch.js` — alias/category/derivable matcher, substitutes JSON, 16 tests | Built ✅ | `BarFridgeMode`, `PantryMode` — **not BarLibrary** |
| `src/lib/barShopping.js` — `getMissingForDrink`, `buildShoppingList`, `getOneAwayDrinks`, `exportShoppingListText`, tested | Built ✅ | **Nothing.** Only its own test file |
| `src/lib/abvCalculator.js` — Morgenthaler dilution ABV, volume, calories, alcohol units, strength tier, tested | Built ✅ | **Nothing.** Only its own test file |
| `src/data/bar/barMethods.json` — per-method dilution percentages | Built ✅ | Only via `abvCalculator` (dead) |

Meanwhile `BarLibrary.jsx:81-94` ships its own naive matcher:

```js
if (inventory.some(inv => ingLower.includes(inv) || inv.includes(ingLower.split(' ').pop())))
```

Bidirectional substring matching. `"ice"` matches inside `"juice"`. That is the precise bug `barMatch.js` was written in July to fix — and the fix is sitting one import away, unused. Every "Ready to Pour" count in the Bar Library today is wrong.

### 0.2 Instagram drink import — five independent defects, all in the same signal path

The user's "this is a drink" intent gets dropped **twice**, then cached so the drop is sticky.

**Bug I-1 — the user's explicit choice is outranked by the model's guess.**
`src/components/ImportSheet.jsx:52-55`

```js
const itemType =
  result.itemType || result.type || result._type
  || (result.kind === 'drink' ? 'drink' : '')
  || fallbackType || 'meal';
```

`fallbackType` carries the user's choice and is **last**. And `thinFromStructured` *always* sets `_type` (`recipeSchema.js:1505`, `_type: kind`) from the model's `kind` field. So for any AI-structured import, `_type` is always populated and `fallbackType` is **unreachable**. Opening Import from the Bar tab sets `initialItemType='drink'` (`App.jsx:1848`), and that value can never win. A cocktail the model calls a meal becomes a meal, silently.

**Bug I-2 — the destination router also ignores the Bar tab.**
`src/App.jsx:1296` — `const target = destination || showImportFor;`
`ImportSheet.jsx:148` — `const [destination, setDestination] = useState('library');`

`destination` defaults to `'library'`, which is always truthy, so `showImportFor === 'drinks'` is **never consulted**. Control then falls to `App.jsx:1385`:

```js
const isDrinkItem = target === 'drinks' || target === 'bar' ||
  (target !== 'meals' && (r.itemType === 'drink' || r._type === 'drink' || r.type === 'drink'));
```

…which depends entirely on `r.itemType` — already corrupted by I-1. Two independent drops of the same user signal, and neither can rescue the other.

**Bug I-3 — the import cache is type-blind and pre-empts everything.**
`src/db.js:1380-1392` — `db.instagramCache.get(url)`. Primary key is `url` alone.
`src/recipeParser.js:4899` — the cache is checked at the very top of `importFromInstagram`, before any type logic runs.

Import a reel once as a meal (which I-1 and I-2 make likely), and every subsequent drink import of that same URL returns the cached meal for the full TTL. **This also masks the other fixes** — you can correct I-1 and I-2 and still see the old wrong result, which is very likely part of why this has felt unfixable.

**Bug I-4 — `type` never reaches the model as a constraint, only as a hint.**
`src/import/structure/gemini.js:127` uses `type === 'drink'` **only** to select few-shot exemplars. `PACK_RESPONSE_SCHEMA` still permits `kind: 'meal'`, and nothing reconciles the model's answer against the user's request afterward.

The heuristic backstop is also miscalibrated for real cocktail captions. `detectKindHeuristic` (`recipeSchema.js:676-688`) requires score ≥ 3, and applies **−3** for `/simmer|boil|…/`. A cocktail caption containing a simple-syrup sub-recipe ("simmer equal parts sugar and water") is pushed to `meal` almost regardless of its spirits. Espresso martinis, anything with a house syrup, anything with a hot-drink step — systematically misclassified.

There is also no `DRINK_RECONCILIATION` addendum. `IG_RECONCILIATION` (`gemini.js:63-73`) speaks entirely in meal terms — "steps", "amounts". Nothing tells the model that in a drink caption, oz/dash/barspoon are ingredient measures, that garnish is a separate field from ingredients, that glass and build-method matter, or that a syrup sub-recipe is a *component*, not the recipe.

**Bug I-5 — `sourceType` passed as a no-op option.**
`src/recipeParser.js:3016` — `structurePack(pinterestPack, { type, sourceType: 'pinterest' })`. `structurePack` (`gemini.js:216`) destructures only `{ type, clientKey, signal }` and reads `pack.sourceType`. The option is silently discarded. Pinterest happens to survive because `acquire/pinterest.js:18` sets it on the pack — but the call site is misleading and the same mistake will recur.

**Bug I-6 — drink fields are extracted, persisted, then never displayed.**
`thinFromStructured` emits `glass`, `garnish`, `method`, `abv` for drinks (`recipeSchema.js:1508-1513`). `ImportReview` shows garnish. Then drinks open in `MealDetail` — the only detail view they get — which renders **none** of them. Grep confirms `garnish` appears in exactly two components: `ImportReview.jsx` and `MixMode.jsx`. `MealDetail.jsx`'s entire drink adaptation is two emoji swaps (lines 357, 378).

So even a *correct* extraction looks broken to the user, because the drink-specific payload dies at the display layer.

### 0.3 BarLibrary vs MealLibrary — parity gap

BarLibrary is 1001 lines against MealLibrary's 2061. Present in Meals, absent in Bar:

| Capability | MealLibrary | BarLibrary |
|---|---|---|
| User tags + tag manager + bulk tag picker + long-press rearrange | ✅ | ❌ |
| `Filters(n)` sheet (time / diet / cuisine) | ✅ | ❌ |
| Collapsible sections by category | ✅ | ❌ flat list |
| Grid layout toggle (persisted) | ✅ | ❌ fixed |
| Favorite / rating / rotation | ✅ | ❌ (`App.jsx:1792-1794` explicitly null for drinks) |
| `SharedWithYouSection` friend inbox | ✅ | ❌ |
| Discover overlay | ✅ | ❌ |
| Starter pack loader | ✅ | ❌ |
| Proper ingredient matcher | n/a | ❌ uses broken local `matchScore` |

Already at parity, credit where due: speed-dial FAB, expandable card with `layoutId` morph, `isImprovable` + ReExtract, PiP video badge, select mode, batch category, backup/restore, Find Better Photo, SharePickerSheet.

### 0.4 Visual audit — why the Bar reads as a different, cheaper app

- `.bl-tile` (`App.css:8834`) is `var(--card)` + 12px radius + generic drop shadow — **byte-for-byte the meal tile**. The Bar has no identity of its own; it's the meal library with pink bolted on.
- Hardcoded hexes throughout, none tokenized: `#ff4081`, `#1a0a2e`, `#3a1f5e` (`.bl-saloon-btn`), `#ffd700`, `#42a5f5` (rarity), `#4caf50`, `#8b5cf6` (progress fill, `BarLibrary.jsx:644`). These do not respond to light/dark — the exact class of bug the July dark-mode sweep and the light-mode `--text-muted` fix were meant to eliminate. The Bar was skipped.
- `.bl-saloon-count { font-size: 7px }` (`App.css:8253`) — unreadable, and a direct regression against the July iOS legibility sweep.
- Identity is split three ways: pixel-art Saloon (`BarShelf`), neon-pink library, generic meal-card tiles. Nothing bridges them.
- Rarity is ingredient-count driven (`≥6 = legendary`, `BarLibrary.jsx:59-66`). A Long Island Iced Tea scores legendary; a Martini scores common. It is measuring the wrong thing.

---

## Phase 1 — Drink import repair (standalone, ships first)

Small, surgical, testable. Order matters: **fix the cache first**, or you cannot verify anything else.

### 1.1 Make the import cache type-aware — `src/db.js`

`instagramCache` keys on `url`. Change the cache key to `${url}::${type}` and thread `type` through:

- `getCachedInstagramRecipe(url, type = 'meal')` → `db.instagramCache.get(cacheKey(url, type))`
- `cacheInstagramRecipe(url, recipe, type = 'meal')` → `.put({ url: cacheKey(url, type), recipe, cachedAt })`
- Keep `getCachedImport` / `setCachedImport` aliases.
- Dexie schema: the store is keyed by `url` as a plain string — a composite string key needs **no migration**. Existing entries simply age out via TTL. Confirm against the `instagramCache` declaration before writing; if it's `&url`, this is still fine.
- Update the 5 call sites in `recipeParser.js` (4899, 5192, 5425, 5440, 5460) to pass `type`.

**Verify first.** Add a "Clear import cache" affordance (or reuse `clearInstagramCache`) behind the existing Bar Options sheet, so you can force a cold path while testing.

### 1.2 Let the user's choice win — `src/components/ImportSheet.jsx`

Reorder `normalizeRecipeForReview` to honour an explicit user selection, restoring the `itemTypeUserOverride` concept that was lost (it exists nowhere in the codebase today — grep returns zero hits, despite the 2026-05-20 fix note):

```js
export function normalizeRecipeForReview(result, fallbackType = 'meal', { userChose = false } = {}) {
  ...
  const itemType = userChose
    ? fallbackType                                   // explicit intent wins outright
    : (result.itemType || result.type || result._type
       || (result.kind === 'drink' ? 'drink' : '')
       || fallbackType || 'meal');
```

Pass `{ userChose: true }` from every call site where the type came from the Bar tab or an explicit chip tap — `initialItemType === 'drink'`, or `itemType` diverging from the auto-detected value. Keep the auto path unchanged for the Meal tab so nothing regresses there.

Also surface the disagreement rather than hiding it: when the user said drink and the model said meal, show a one-line chip in ImportReview — *"You chose Drink; the parser guessed Meal — keeping Drink."* Honest, and it makes future misclassification visible instead of silent.

### 1.3 Fix destination routing — `src/App.jsx`

`ImportSheet`'s `destination` default of `'library'` shadows `showImportFor`. Two options; **prefer (a)**:

- **(a)** Initialise `destination` from context: `useState(initialItemType === 'drink' ? 'bar' : 'library')` in `ImportSheet.jsx:148`. Fixes it at the source and makes the Save-to grid show the right default selection.
- **(b)** In `App.jsx:1296`, change to `const target = (destination === 'library' && showImportFor === 'drinks') ? 'drinks' : (destination || showImportFor)`. Patches the symptom only.

Do (a). Then simplify `App.jsx:1385-1387` so `target === 'drinks' | 'bar'` is authoritative and the `r.itemType` sniff is a fallback, not the primary.

### 1.4 Constrain the model on `kind` — `src/import/structure/gemini.js`

- Add a **`DRINK_RECONCILIATION`** system addendum, appended when `kind === 'drink'`, covering: oz/dash/barspoon/part are ingredient measures not steps; `garnish` is its own field and must not be duplicated into `ingredients`; populate `glass` and `method` (shaken/stirred/built/blended/muddled/thrown); a syrup/infusion sub-recipe belongs in `notes` as a component, **not** as the main recipe; never convert a drink to a meal because of a `simmer` step in a syrup.
- When `type === 'drink'` is an **explicit user choice**, pin it: append `'The user has confirmed this is a DRINK. Set kind="drink". Do not classify as a meal.'` and, ideally, narrow the response schema's `kind` enum to `['drink']` for that call. Gemini structured output respects a single-value enum, which removes the failure mode entirely rather than asking nicely.
- Thread an explicit `userChose` flag through `structurePack` → `serverStructurePack` → `api/structure.js` request body so the server path gets the same treatment. `api/structure.js:114` already forwards `req.body.type`; add `req.body.kindLocked`.

### 1.5 Recalibrate `detectKindHeuristic` — `src/recipeSchema.js:676`

- Scope the meal-signal penalty: don't apply `−3` for `simmer|boil` when a **spirit or liqueur is present** and the text contains `syrup|infusion|shrub|oleo`. A syrup sub-recipe is the single most common false-negative for cocktail captions.
- Weight glassware and drink units higher when combined with a spirit (spirit + glass + oz should clear the bar comfortably).
- Add a hard trigger: a `SPIRITS` or `LIQUEURS` hit **and** a `DRINK_METHODS`/`COCKTAIL_ACTIONS` hit ⇒ `drink` regardless of score.
- Pin the new behaviour with corpus cases in `src/__tests__/` — espresso martini, a caption with a house simple-syrup step, a hot toddy, a mocktail with zero spirits (must still classify drink via glass + method + units).

### 1.6 Fix the no-op option — `src/recipeParser.js:3016`

Either accept `sourceType` in `structurePack`'s options (overriding `pack.sourceType`) or drop the argument at the call site. Accepting it is the better fix — the call site's intent is correct and the next person will make the same assumption.

### 1.7 Render what we extract — `src/components/MealDetail.jsx`

`glass` / `garnish` / `method` / `abv` currently vanish. Add a drink-only spec strip under the title, gated on `isDrink`: **Glass · Method · Garnish**, plus a computed strength chip via `abvCalculator.getStrengthTier()`. This is the smallest change with the largest "the import finally works" payoff, and it doubles as the first Phase-3 win.

### Phase 1 testing plan

```
npm test -- recipeSchema        # detectKindHeuristic recalibration
npm test -- barMatch            # regression guard, untouched
npm run test:corpus             # extraction corpus — must not regress on meals
npm run build                   # constitution: no truncation, no syntax errors
```

Manual pass (Windows + Android, then iOS Safari):
1. Clear import cache. Bar tab → Import → paste a cocktail reel → **must** land in Bar Library.
2. Same URL, Meal tab → must land in Meals, and must **not** return the cached drink.
3. A cocktail reel whose caption contains a simple-syrup `simmer` step → classified drink.
4. A mocktail reel (no spirits) → classified drink.
5. A genuine dinner reel from the Meal tab → unchanged (regression guard).
6. Open an imported drink → Glass / Method / Garnish / strength all render.
7. Airplane mode → offline queue still intact; drink import queues as before.

### Phase 1 commits

```
fix(import): key instagram cache by url+type so drink and meal imports stop colliding
fix(import): let an explicit drink selection outrank the parser's kind guess
fix(import): initialise import destination from the launching tab
feat(import): add DRINK_RECONCILIATION addendum and lock kind when user confirms drink
fix(schema): stop syrup sub-recipes flipping cocktail captions to meal in detectKindHeuristic
fix(import): honour sourceType option in structurePack instead of silently dropping it
feat(detail): render glass, method, garnish and strength for drinks
```

---

## Phase 2 — Speakeasy identity + design-debt cleanup

Same bones as MealLibrary — identical spacing scale, motion timings, sheet mechanics, touch targets — so it reads as one app. Different *material*: the meal side is daylight, the bar side is after-dark.

### 2.1 Bar token layer — `src/styles/tokens.css`

Scoped tokens, not a theme fork. `.bl` and `.bl-*` opt in; everything else is untouched.

```css
/* Speakeasy — scoped to the Bar surface, stable across light/dark */
[data-theme] .bl {
  --bar-surface:        oklch(0.19 0.018 62);   /* warm near-black, never #000 */
  --bar-surface-raised: oklch(0.235 0.022 62);
  --bar-hairline:       oklch(0.38 0.030 68);
  --bar-text:           oklch(0.93 0.012 70);
  --bar-text-dim:       oklch(0.72 0.016 70);   /* must clear 4.5:1 on --bar-surface */
  --bar-accent:         oklch(0.74 0.130 78);   /* brass */
  --bar-accent-dim:     oklch(0.56 0.090 74);
  --bar-ready:          oklch(0.68 0.110 152);  /* bottle green — replaces #4caf50 */
}
```

Note the chroma discipline: neutrals are tinted toward the brass hue (0.018–0.03 chroma) so surfaces and accent feel related rather than merely co-located. This is the same principle the project already applies elsewhere; the Bar just never got it.

**Deliberate choice:** the Bar stays dark in both themes. It is a *place* in the app, not a mode — the Saloon next door is already dark, and a light-mode Bar would break the doorway transition. Document this in `design.md` so it doesn't get "fixed" later.

**Verify every pairing against WCAG AA before shipping**, since these are new values: `--bar-text-dim` on `--bar-surface`, `--bar-accent` on `--bar-surface`, and the rarity colours below. The July `--text-muted` incident was exactly this failure mode.

### 2.2 Typography — one self-hosted display face

The project currently loads **zero** web fonts (system stack only). Adding a Google Fonts `<link>` would break offline-first — non-negotiable per the constitution.

**Approach**: self-host **one** display face, Latin subset, single weight, `woff2`, in `public/fonts/`, with `font-display: swap` and an explicit `sw.js` precache entry. Budget ~18–25 KB. Applied **only** to drink names, the Saloon button, and Bar section headers — body copy stays on the existing stack so the two libraries still feel related.

Candidates (all outside the usual reflex set — no Inter/DM/Space/Plex/Playfair/Fraunces):

- **Gloock** — high-contrast didone. Reads as a bottle label / printed bar menu. My pick: the "expensive spirits label" association does the identity work for free.
- **Big Shoulders Display** — condensed, Chicago-signage lineage. More "neon bar sign", pairs harder with the pixel Saloon.

Scale: drink name at `clamp(1.05rem, 3.2vw, 1.25rem)` on tiles, `1.75rem` in the expanded card — a genuine ~1.4 step, versus today's flat hierarchy. Nothing below 12px anywhere.

### 2.3 Fix the CSS debt

- `.bl-saloon-count` 7px → 12px minimum (`App.css:8253`).
- Replace every hardcoded hex in the `.bl-*` block with the tokens above: `#ff4081`, `#1a0a2e`, `#3a1f5e`, `#ffd700`, `#42a5f5`, `#4caf50`, `#8b5cf6` (the last is inline in `BarLibrary.jsx:644` and needs a JSX change, not just CSS).
- Re-skin `.bl-tile`: `--bar-surface-raised`, 1px `--bar-hairline` border, 10px radius, and drop the generic drop shadow in favour of a hairline + very low-opacity lift. Dark surfaces do not need drop shadows; they need edges.
- Increase tile density to 3-column on phone (meals stay 2-column) — bottles are tall and narrow, dishes are wide. Different content shape, different grid; this is adaptation, not divergence.
- Audit every `.bl-*` interactive target against `--touch-min-size: 44px`. The `.bl-tile-improve`, `.bl-tile-menu-btn` and `.bl-tile-play` overlay buttons are prime suspects.

### 2.4 Rarity, re-grounded

Ingredient count is the wrong metric. Replace `getDrinkRarity` with something that means something:

- **Canon** (brass) — matches the IBA / classics list. Extend the existing `LEGENDARY_NAMES` into a proper `src/data/bar/barCanon.json`.
- **Rare** (copper) — contains a spirit or modifier the user's inventory doesn't stock, i.e. genuinely hard for *them* to make. Uses `barMatch` — personal, not static.
- **House** (bottle green) — everything else.

Rarity now answers "can I make this, and is it special?" rather than "how long is the list?"

### Phase 2 commits

```
feat(bar): add scoped speakeasy token layer for the Bar surface
feat(bar): self-host Gloock display face for drink names, precached for offline
fix(bar): replace hardcoded hexes in .bl-* with theme tokens
fix(bar): raise 7px saloon count text and audit Bar touch targets to 44px
refactor(bar): reground drink rarity on canon + inventory scarcity, not ingredient count
```

---

## Phase 3 — Feature parity (mostly wiring, not building)

### 3.1 Swap in the real matcher — highest value, ~30 lines

Delete `BarLibrary.jsx:81-94` `matchScore`. Import `matchDrink` from `src/lib/barMatch.js`. This immediately fixes "Ready to Pour" / "Almost There" counts, picks up the alias table, the substitutes JSON, and derivable ingredients (the ice-in-juice class of bug). `BarFridgeMode` already proves the integration shape — copy it.

### 3.2 Wire up `barShopping.js` — a whole feature already written

- **"One Bottle Away"** rail — `getOneAwayDrinks(drinks, inventory)` returns drinks unlocked by exactly one purchase. Surface as a horizontal rail above the grid: *"Buy Campari → unlocks 4 drinks."* This is the single most compelling thing the Bar can do that the Meal Library cannot, and the function already exists and is tested.
- **Bar shopping list** — `buildShoppingList` + `exportShoppingListText` behind the existing "More" sheet, routed into the existing grocery flow.

### 3.3 Wire up `abvCalculator.js`

Strength chip on tiles and in the expanded card (`getStrengthTier`). In `MixMode`, show live ABV / volume / calories / standard units that respond to the scale factor — turning MixMode from a scaler into a real bartending tool. Also fully built already.

### 3.4 MealLibrary parity items, in value order

1. **Tags** — port the tag system wholesale (tag manager, bulk picker, long-press rearrange). Bar-native defaults: *Summer, Batch, Brunch, Nightcap, Low-ABV, Zero-Proof, Crowd-pleaser*. Reuses the existing `userTags` DB table; check whether it needs a domain column to keep drink tags out of the meal picker.
2. **Filters(n) sheet** — Bar dimensions instead of time/diet/cuisine: **Base spirit** (from `barMatch.categorizeBottle`), **Strength** (from `abvCalculator`), **Method**, **Zero-proof**. All four are computable from data we already have.
3. **`SharedWithYouSection`** — drinks are more social than meals; this is a straight port with `itemType="drink"`.
4. **Collapsible sections** — group by base spirit rather than category. More useful than the assignable category chips for a bar.
5. **Grid layout toggle** — persisted, same as meals.
6. **Favourites / rating** — currently hard-nulled for drinks at `App.jsx:1792-1794`. Enable; a 5-star rating on a cocktail you've actually mixed is more meaningful than on a dinner.

### 3.5 Deliberately **not** ported

- **Rotation / week planning** — meals go on a weekly plan; drinks don't. Forcing this would be parity for its own sake.
- **Discover overlay** — the blog aggregator is tuned for recipe blogs. A cocktail equivalent needs its own sources; defer until there's a reason.

---

## Phase 4 — Concepts that make the Bar worth opening

Ordered by (value ÷ effort). Everything in 4.1–4.3 leans on already-built modules.

**4.1 "One Bottle Away" (see 3.2)** — the flagship. Turns a static library into a system with a next move. Low effort, high differentiation.

**4.2 Strength & balance readout** — using `abvCalculator`, show a compact spec: ABV, standard units, calories. Optionally a small **sweet / sour / strong** balance bar derived from ingredient categories in `barMatch`. This is the kind of thing serious cocktail apps charge for, and 80% of it is already in the repo.

**4.3 Pour Count / mix history** — increment a counter when MixMode completes. Unlocks "Your usual", "Untouched since import", and an honest most-poured list. Requires one Dexie field and one write in `finalizeMixMode` (`App.jsx:1474`).

**4.4 Last Call** — a Bar-native answer to the meal spinner, but *constrained by inventory*: "one drink you can make right now, with what's on the shelf." `pickSurprise` already exists in `barMatch.js`. Ties the Bar Library to the Saloon and My Bar in a single tap.

**4.5 The Back Bar (long-term shelf view)** — a horizontal "bottle spine" view where each drink is a label on a bottle. Distinctive, genuinely fits the speakeasy direction, and it is the natural visual bridge between the flat library and the pixel Saloon. Larger build; propose as a follow-on once 4.1–4.3 are in.

**4.6 House Rules / batch scaling** — batch a cocktail to a pitcher (×8, ×12) with correct dilution from `barMethods.json` (batching changes dilution — the data is already there). Real bartending knowledge encoded, and it makes the Bar useful for hosting rather than just cataloguing.

---

## Risks & guardrails

- **Offline sovereignty**: the self-hosted font must be precached in `sw.js` and must degrade to the system stack. Verify in airplane mode before merging Phase 2.
- **iOS**: new dark surfaces need a re-check against the `body::before` status-bar scrim (which reads `var(--primary)`) so the Bar tab doesn't produce a two-tone header. Also re-run the ≥16px input check on any new Bar inputs — that regression has happened twice.
- **Contrast**: every new OKLCH pair must be measured, not eyeballed. The `--text-muted` failure shipped because a token *looked* fine.
- **Scope discipline**: Phase 3 is mostly wiring existing tested modules. Resist rewriting `barMatch`/`barShopping`/`abvCalculator` while integrating them — if they need changes, that's a separate commit with its own test run.
- **`npm run build` before every git command**, per the constitution. Note the known sandbox `dist/` EPERM quirk — verify with `--outDir` to a scratch path if it appears.
- **No git mutations from the agent.** Commit commands provided; you run them.

---

## Suggested execution order

1. **Phase 1** — drink import. Standalone, ship and verify on device before touching UI.
2. **Phase 3.1** — swap in `barMatch`. One import, immediately correct counts.
3. **Phase 2** — speakeasy tokens, font, CSS debt, rarity.
4. **Phase 3.2 / 3.3** — wire `barShopping` + `abvCalculator`.
5. **Phase 3.4** — parity items in listed order.
6. **Phase 4** — differentiators, reassessed once 1–5 are on device.
