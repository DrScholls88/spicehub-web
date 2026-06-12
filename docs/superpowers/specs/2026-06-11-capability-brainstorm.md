# SpiceHub Capability Brainstorm — "Replace Five Apps"

**Date:** 2026-06-11
**Status:** Brainstorm — for triage into specs
**Constitution check:** Every idea below must be (a) zero recurring cost, (b) offline-first, (c) network only during imports. Section 5 verifies each idea against those gates.

**Grounding:** Built on the current codebase — screens in App.jsx (Week/Month plan, MealLibrary, GroceryList, BarShelf, FridgeMode, BarFridgeMode, CookMode, MealSpinner, ImportSheet), the `recipeSchema.js` contract (grocery `category` per ingredient, `_ingredientMeta` sidecar, course/dishType/cuisine/dietaryTags taxonomies, drink glass/garnish/method, confidence/needsReview, trash filter), and the 2026-06-06 import redesign spec (single engine entry, 45s budget, batch sub-flow, BrowserAssist fallback). Existing triaged backlog (haptics, search filter, quantity aggregation, equipment tags, multi-user sync, fuzzy fridge) is **not repeated** here — ideas below extend or compound it.

---

## 1. The "Five Apps It Replaces" Framing

The owner's brief: *"End users should feel like the app replaces the work of 5 other apps."* Here is the absorption map — seven categories, what SpiceHub already does, and the **gap to full replacement**. The gaps become the idea backlog in Sections 2–3.

| # | App category it replaces | Example apps users delete | What SpiceHub has today | Gap to full replacement |
|---|---|---|---|---|
| 1 | **Recipe clipper / saver** | Instagram saved posts, Paprika, Pinterest boards, Notes app screenshots | Flagship import engine: URL/caption/photo → structured Schema.org-grade recipe; batch URLs; BrowserAssist fallback | Saved-posts **bulk migration** (one-time "move my whole Instagram collection"), share-target polish so the OS share sheet is *the* clip button, multi-page cookbook capture, voice dictation of family recipes |
| 2 | **Meal planner** | Paprika planner, Mealime, paper on the fridge | Week view, month calendar, MealSpinner for decision fatigue | **Auto-plan**: one tap fills the week from library + constraints (cuisine variety, "haven't cooked in 30 days", weeknight-fast vs weekend-project). Leftover-aware planning (cook once, slot leftovers next day) |
| 3 | **Grocery list** | AnyList, Google Keep, Bring! | GroceryList screen, department categories from `_ingredientMeta`, planned aggregation backlog item | **Store mode** (one-handed, big checkboxes, screen-wake, department order matched to *your* store), pantry-aware list ("you already have soy sauce"), staples auto-replenish |
| 4 | **Cocktail bar manager** | Mixel, Highball, a notes file of cocktail specs | BarShelf, BarFridgeMode, drink-aware schema (glass/garnish/method, drink units) | "**What can I make?**" inverse lookup from owned bottles (fuzzy-fridge backlog item applied to bar), substitution suggestions (no Cointreau → triple sec), shopping ROI ("buying Campari unlocks 4 recipes") |
| 5 | **Pantry / fridge tracker** | Pantry Check, NoWaste, paper inventory | FridgeMode exists; fuzzy fridge matching triaged as large backlog item | **Depletion loop**: marking a meal cooked decrements pantry; pantry feeds both grocery dedup and "use it up" suggestions. Without the loop, pantry tracking is data entry nobody maintains |
| 6 | **Kitchen timer / cook companion** | Phone timer app, smart-speaker timers | CookMode (step display) | **Parsed step timers** ("simmer 10 min" → tappable inline timer), multi-timer dashboard, wake-lock, voice/gesture "next step" with messy hands |
| 7 | **Nutrition logger (lite)** | MyFitnessPal (casual users), Cronometer | dietaryTags taxonomy only | **Offline estimates**, not logging: bundled USDA-derived static table → per-serving calorie/macro *ranges* on recipe cards and week view. Casual users want "is this week roughly balanced?", not barcode scanning |

> **Positioning sentence for the README/landing page:** *"Clip it from anywhere, plan the week in one tap, shop with one thumb, cook with timers built in, and know what's in your fridge and your bar — one app, works on airplane mode, costs nothing."*

---

## 2. Import Engine Expansion Ideas (Flagship)

Format per idea: **What · Why it wows · Zero-cost feasibility · Offline behavior · Effort (S/M/L)**.

### I-1. Instagram Saved-Posts Bulk Migration (the "switch moment")
- **What:** Accept the official Instagram data-export ZIP (Settings → Download Your Information → `saved_posts.json` / `liked_posts.json`). Parse locally in the browser, extract all saved post URLs, feed them through the existing batch import sub-flow with a queue UI ("23 of 117 imported, 4 need review").
- **Why it wows:** This is the single highest-leverage onboarding feature. The user's recipe collection *already lives* in Instagram saves; a one-time migration makes SpiceHub instantly more valuable than the app it replaces. Nobody else does this well.
- **Zero-cost feasibility:** ZIP parsing is pure client JS (e.g. fflate, ~8KB, or DecompressionStream native). Per-post extraction uses the existing Apify/oEmbed/Gemini pipeline. **Risk:** 100+ posts in one session can strain Apify/Gemini free quotas — mitigate with a resumable queue (persisted in Dexie), throttle (e.g. 5/min), and "continue tomorrow" UX that frames quota limits as a feature ("imports trickle in").
- **Offline behavior:** ZIP parse + URL queue building fully offline. Queue persists in IndexedDB; extraction runs only when online and resumes after interruption (this *is* the offline-sovereignty queue pattern from the constitution, applied to imports).
- **Effort:** **M** (queue + resumability is the work; extraction path already exists).

### I-2. Share-Target Auto-Import Polish ("zero-tap clip")
- **What:** Harden the PWA `share_target` manifest entry so sharing from Instagram/TikTok/Chrome lands directly in ImportSheet with the URL pre-filled **and import already running** — the user shares, switches back, and the recipe is waiting. Add a post-save toast with "Add to this week / Add to grocery" quick actions.
- **Why it wows:** The clip flow drops from ~6 taps to 1 (Share → SpiceHub). This is the habit-forming loop; it makes SpiceHub the default destination for every recipe the user sees.
- **Zero-cost feasibility:** Pure manifest + service worker + routing work. No new services.
- **Offline behavior:** If shared while offline, URL goes into a pending-import queue (same Dexie queue as I-1) with a badge on the import button; auto-runs on reconnect.
- **Effort:** **S** (share_target likely partially wired; polish + offline queue + auto-start).

### I-3. Cookbook Photo Multi-Page Capture
- **What:** Extend the photo import path to a multi-shot session: snap page 1 (ingredients), page 2 (directions continued), reorder thumbnails, then send all images in **one** Gemini Vision call (multi-part content → one RECIPE_SCHEMA object). Add a "two-column page" hint toggle for older cookbooks.
- **Why it wows:** Family cookbooks and magazine recipes almost never fit one frame. This turns SpiceHub into the heirloom-recipe digitizer — emotionally sticky in a way URL import isn't.
- **Zero-cost feasibility:** Gemini Vision already in the stack; multi-image content parts are supported on free tier. Client-side downscale/compress before upload keeps tokens low.
- **Offline behavior:** Photos captured offline persist as blobs in Dexie with a "pending extraction" card in the library; extraction fires on reconnect. The capture experience itself never needs network.
- **Effort:** **M**.

### I-4. Voice Dictation Import (Web Speech API)
- **What:** "Dictate a recipe" tab in ImportSheet. Web Speech API (`SpeechRecognition`) streams the user's spoken recipe ("grandma's chili: two pounds ground beef, one onion…") into the text area live; on stop, the transcript runs through the existing `captionToRecipe` path. `wordToNumber`/`normalizeFraction` in recipeSchema.js already handle spoken quantities ("half a cup").
- **Why it wows:** Capturing a recipe *while someone tells it to you* (phone call with mom, watching a friend cook) is magic, and no competitor does it. Also doubles as hands-free entry while flour-covered.
- **Zero-cost feasibility:** Web Speech API is free. **Caveat:** Chrome/Edge recognition is server-backed (network needed during dictation) and iOS Safari support is partial — feature-detect and hide gracefully. Structuring still uses Gemini (import-time call, allowed).
- **Offline behavior:** Dictation itself needs network on most browsers, so frame it honestly as an import mode (imports are the sanctioned online moment). Fallback: record audio offline (MediaRecorder), queue for later transcription via the existing ASR scaffold or paste-from-memory.
- **Effort:** **S** for live dictation → captionToRecipe; **M** if adding the offline audio-queue fallback.

### I-5. Import Quality Self-Healing (re-extraction ledger)
- **What:** Every import already stores `confidence`, `needsReview`, and the captured caption. Add a low-confidence ledger: recipes saved with `confidence < 0.75` or `needsReview` get a subtle "improve" badge. A "Re-run extraction" action re-sends the *stored* caption (no re-scrape) through the current prompt — which keeps improving sprint over sprint — and shows a field-level diff (old vs new ingredients/steps) for one-tap accept/reject. Optional: when the engine prompt version bumps, offer "3 recipes could be improved by the new engine."
- **Why it wows:** The library *gets better over time without re-importing*. It converts engine improvements (the team's main work) into visible user value retroactively, and it's honest about uncertainty instead of hiding it.
- **Zero-cost feasibility:** One Gemini call per user-initiated re-run; cached caption means no Apify spend. Prompt-version stamp is one string in recipeSchema.js.
- **Offline behavior:** Ledger, badges, and diff review fully offline; the re-run itself queues until online (import-class call).
- **Effort:** **M** (diff UI is most of it; storage fields mostly exist).

### I-6. Household Sharing via Export Files + QR (no server, no accounts)
- **What:** Serverless sharing in three tiers: (1) **Single recipe** → compact JSON compressed + base45-encoded into a QR code rendered on-device; partner scans with their SpiceHub camera screen, recipe lands in their library. (2) **Collection/library** → `.spicehub` export file (JSON, images optional) shared via OS share sheet / AirDrop / messaging; import merges with dedup-by-title+source. (3) **Grocery list snapshot** → same QR path, so the person at the store gets the list without any sync infrastructure.
- **Why it wows:** Delivers ~70% of the value of multi-user sync (the triaged **large** backlog item) at ~15% of the cost, with a delightful in-person mechanic ("scan my screen"). It is also the user's backup story — export file = peace of mind for a local-first app.
- **Zero-cost feasibility:** QR generation (`qrcode` lib, small) and scanning (native `BarcodeDetector` where available, `jsQR` fallback) are free and client-side. No server at all. Size limit: a QR holds ~2–3KB compressed — fine for one recipe sans image; collections go the file route.
- **Offline behavior:** **Fully offline end-to-end** — generation, scanning, file import all local. The only sharing feature in this doc with zero network ever.
- **Effort:** **M** (QR single-recipe S; file export/import with merge/dedup adds the M).

### I-7. URL Watchlists (creator follow, import-time refresh)
- **What:** Let the user "watch" a creator profile or blog. A watchlist entry stores the source URL; whenever the user opens ImportSheet (an online, import-class moment), SpiceHub optionally checks watched sources for new posts (via the existing Apify profile actor or RSS for blogs) and shows "3 new from @halfbakedharvest — import?" chips.
- **Why it wows:** Turns import from pull to push — SpiceHub starts *bringing you* recipes from people you trust, replacing doomscrolling for dinner ideas.
- **Zero-cost feasibility:** **Caution flag.** Profile-level Apify actors are pricier per run than single-post fetches and polling burns quota. Keep it strictly user-triggered (a "Check watchlist" button, never background), cap watched sources (e.g. 5), and prefer RSS (free) for blogs. If Apify economics don't fit, ship blog-RSS-only first.
- **Offline behavior:** Watchlist storage and previously fetched "new post" chips fully offline; the check itself is an explicit import-time action.
- **Effort:** **M** (RSS-only) / **L** (Instagram profiles with quota management).

### I-8. Clipboard Sentinel ("you copied a recipe link?")
- **What:** When the app gains focus, read the clipboard (with permission, Async Clipboard API) and if it contains a URL from a known recipe domain or social host, show a non-blocking chip: "Import the link you copied?" One tap → ImportSheet pre-filled and running.
- **Why it wows:** It feels psychic. Pairs with I-2 to cover the platforms where share-target is flaky (iOS PWA share quirks).
- **Zero-cost feasibility:** Pure client. Permission-gated; degrade silently if denied.
- **Offline behavior:** Detection fully offline; import queues if offline.
- **Effort:** **S**.

---

## 3. Whole-App Ideas (compounding the data we already capture)

### A-1. Smart Weekly Auto-Plan ("Plan my week" button)
- **What:** One tap fills empty week slots from the library using a local scoring function over data already on every recipe: course (dinner slots get `course=dinner`), cuisine variety (penalize same cuisine back-to-back), recency (boost "haven't cooked in 30+ days" via cook-history timestamps), time budget (weeknights prefer `totalTime ≤ 40 min`, weekend allows projects), dietary tags (respect a household preference setting). Each suggestion slot has a per-slot reroll — which is exactly the existing **MealSpinner** mechanic, recast: the spinner becomes the reroll animation. "Lock" slots you like, reroll the rest.
- **Why it wows:** Compresses the Sunday-planning chore from 20 minutes to 20 seconds, and it makes the library *do* something. The spinner — currently a toy — becomes the planner's personality.
- **Zero-cost feasibility:** Pure local computation; no LLM needed (taxonomies are already structured at import time — this is the payoff of Extraction Excellence).
- **Offline behavior:** 100% offline.
- **Effort:** **M**.

### A-2. Cook-Mode Step Timers Parsed from Directions
- **What:** Regex pass over direction strings at render time: `(simmer|bake|roast|rest|chill|boil|cook|proof|marinate)[^.]*?(\d+)[-–]?(\d+)?\s*(min|minute|hour|hr|sec)` → render the duration as a tappable inline pill in CookMode. Tap starts a countdown chip pinned to the top of CookMode; multiple concurrent timers stack. Web Notifications + vibration + `<audio>` on completion; `navigator.wakeLock` keeps the screen on while any timer runs.
- **Why it wows:** Kills the "phone timer app + recipe app juggling" entirely — category #6 absorbed with one feature. Tappable durations inside the step you're reading is the kind of detail people screenshot and share.
- **Zero-cost feasibility:** Pure client (regex, setInterval/worker timer, wake lock). No extraction change needed — though optionally the Gemini schema could later emit `durations[]` per step for higher fidelity.
- **Offline behavior:** 100% offline.
- **Effort:** **S** for parse + single timer; **M** with multi-timer dashboard + notifications + wake lock. Ship S first.
- **Compounding:** Builds on the triaged haptics quick-win (timer completion = the flagship haptic moment).

### A-3. Store Mode for GroceryList
- **What:** A dedicated shopping state: oversized checkboxes (one-thumb, cart-pushing ergonomics), wake lock on, items grouped by the department categories already in `_ingredientMeta`, checked items collapse to the bottom with strikethrough + haptic tick. Crucially: a one-time **drag-to-reorder departments** ("my store is Produce → Bakery → Meat…") persisted per-user, so the list walks the store in *your* aisle order. Optional "hide checked" and a progress ring ("14 of 22").
- **Why it wows:** This is where category #3 is won or lost — every grocery app's most-used screen is in-store. Department-order personalization is a feature people evangelize.
- **Zero-cost feasibility:** Pure UI + one Dexie preference record. Phase G's category work makes this nearly free.
- **Offline behavior:** 100% offline (grocery stores are signal dead zones — this is the offline-first poster child).
- **Effort:** **M**.
- **Compounding:** Direct successor to the Phase G grocery restructure already queued; quantity-aggregation backlog item slots in underneath it.

### A-4. Pantry Depletion Loop ("Mark as cooked")
- **What:** Close the loop that makes FridgeMode worth maintaining: a "Cooked it ✓" action on planned meals (week view + CookMode final step) that (a) timestamps cook history (feeding A-1's recency scoring), (b) decrements matching pantry items using the existing alias dictionary (`resolveIngredientAlias`) with a confirm sheet ("Used up: garlic? soy sauce?" — tap to confirm/skip), and (c) flags depleted staples for the next grocery list. Deliberately *fuzzy and forgiving* — confirm-based, never silently wrong.
- **Why it wows:** Pantry apps die because they demand bookkeeping. Tying depletion to an action users already feel good about (I cooked!) makes the inventory self-maintaining, which then powers "what can I make tonight" credibly.
- **Zero-cost feasibility:** Pure local; alias matching is the existing dictionary plus normalization.
- **Offline behavior:** 100% offline.
- **Effort:** **M** (the confirm-sheet UX is the design work; matching is simple).
- **Compounding:** This is the *prerequisite* that turns the triaged "fuzzy fridge matching" large item from a gimmick into a system; also feeds A-1 and A-5.

### A-5. Leftover & "Use It Up" Suggestions
- **What:** Two local heuristics surfaced as gentle cards: (1) **Leftovers:** when a cooked meal's servings exceed household size (servings field already extracted), auto-suggest a "Leftovers: <title>" chip for the next day's lunch slot in the week view. (2) **Use it up:** rank library recipes by overlap with pantry items marked "running low / expiring" (from A-4), shown as "3 recipes use your spinach" on the landing page.
- **Why it wows:** Food waste guilt is universal; an app that quietly says "eat Tuesday's chili for Wednesday lunch" feels like a household manager, not a recipe filing cabinet.
- **Zero-cost feasibility:** Pure local set-intersection over canonical ingredient names.
- **Offline behavior:** 100% offline.
- **Effort:** **S** (leftover chips) + **M** (use-it-up ranking; depends on A-4).

### A-6. Offline Nutrition Estimates (bundled USDA-derived table)
- **What:** Ship a static JSON table (~300–500 common canonical ingredients × calories/protein/fat/carbs per 100g, derived from USDA FoodData Central public-domain data) in the app bundle. At save time (or lazily), match canonical ingredient names + quantities/units (already normalized by `canonicalizeUnit`) to compute a per-serving **estimate range**, displayed as "~520–610 cal/serving" with an explicit "estimate" label. Week view can show a per-day roll-up. Never claims precision; unmatched ingredients listed as "not counted."
- **Why it wows:** Casual nutrition awareness without an account, a subscription, or a connection — absorbs category #7 for the 80% of users who only want a ballpark. The honest-range framing dodges the accuracy trap.
- **Zero-cost feasibility:** USDA data is public domain; a curated 400-row table is ~40–60KB gzipped. Optionally, Gemini can map oddball ingredient names → table keys *at import time* (sanctioned call); core matching is local string + alias work.
- **Offline behavior:** 100% offline by design — the table ships in the service-worker precache.
- **Effort:** **M** (table curation is the real work; computation is simple). 
- **Compounding:** Unit canonicalization and the alias dictionary were built for grocery merging — this is their second payoff.

### A-7. Seasonal & Occasion Collections (zero-data smart shelves)
- **What:** Auto-generated library shelves from data already present: device date + cuisine/dishType/course/dietaryTags → "Soup season" (Oct–Mar, dishType soup/stew), "Grilling" (May–Aug, dishType grill), "Taco Tuesday" (dishType taco, surfaces Tuesdays), "Cinco de Mayo" / "Thanksgiving" (static date→cuisine/course rules), "Cocktail Friday" (kind=drink, Fri/Sat). Plus user-pinnable manual collections. Rules are a static local table — no ML, no network.
- **Why it wows:** The library feels alive and curated ("it knew it was soup weather") with literally zero new data capture. Great surface for the landing page.
- **Zero-cost feasibility:** A rules JSON + a filter function. Trivially free.
- **Offline behavior:** 100% offline.
- **Effort:** **S**.

### A-8. Bar "What Can I Make?" + Unlock Shopping (drink-side payoff)
- **What:** BarShelf bottles become an inventory set; an inverse index over drink recipes' canonical spirit/liqueur names (SPIRITS/LIQUEURS vocab already exists) yields three shelves: **Make now** (all ingredients owned), **One bottle away** (with "buying X unlocks N drinks" sort — the single best bottle to buy next), **Substitutable** (static substitution table: Cointreau↔triple sec, Angostura↔aromatic bitters, lemon↔lime where method allows).
- **Why it wows:** "One bottle away" is the killer sort — it gamifies building a home bar and absorbs category #4 completely. Drinks have small, brand-stable ingredient lists, so matching accuracy is *much* higher than food-side fuzzy fridge — ship the win here first.
- **Zero-cost feasibility:** Local set math + a curated static substitution table (~50 rows).
- **Offline behavior:** 100% offline.
- **Effort:** **M**.
- **Compounding:** De-risks and prototypes the matching engine the food-side fuzzy fridge (large backlog item) will later reuse.

### A-9. Cooked-It Journal (lightweight memory, feeds everything)
- **What:** The "Cooked it ✓" event (A-4) also captures an optional 1–5 star + one-line note + optional photo ("came out great, use less salt"). Recipe cards show last-cooked date, times cooked, and your note. Notes ride along in QR/file sharing (I-6).
- **Why it wows:** Turns the library into *your* cooking history — the moat no re-import can replicate. "We've made this 9 times" is the emotional core of a family recipe app.
- **Zero-cost feasibility:** Three fields + a photo blob in Dexie.
- **Offline behavior:** 100% offline.
- **Effort:** **S**.

---

## 4. Constraint Check Table

| ID | Idea | Zero-cost? | Offline-first? | Network import-only? | Notes |
|----|------|-----------|----------------|---------------------|-------|
| I-1 | Saved-posts bulk migration | ✅ (watch Apify/Gemini quota; throttled queue) | ✅ parse/queue offline | ✅ extraction = import calls | Resumable queue is the quota safety valve |
| I-2 | Share-target auto-import | ✅ | ✅ queues offline shares | ✅ | Pure platform plumbing |
| I-3 | Multi-page photo capture | ✅ (one Vision call/recipe) | ✅ capture offline, extract later | ✅ | Compress client-side |
| I-4 | Voice dictation import | ✅ | ⚠️ dictation needs network on most browsers | ✅ (treated as an import mode) | Feature-detect; honest framing |
| I-5 | Import self-healing re-runs | ✅ (cached caption, no re-scrape) | ✅ ledger/diff offline | ✅ re-run = import call | User-initiated only |
| I-6 | QR / file household sharing | ✅ | ✅ **fully offline** | ✅ (no network at all) | Cleanest constraint fit in the doc |
| I-7 | URL watchlists | ⚠️ Apify profile runs cost quota; RSS free | ✅ list/chips offline | ✅ user-triggered checks only | Ship RSS-only if economics fail |
| I-8 | Clipboard sentinel | ✅ | ✅ | ✅ | Permission-gated |
| A-1 | Smart weekly auto-plan | ✅ | ✅ | ✅ (no network) | Pure local scoring |
| A-2 | Parsed step timers | ✅ | ✅ | ✅ (no network) | Wake lock + notifications local |
| A-3 | Store mode grocery | ✅ | ✅ | ✅ (no network) | Built for dead zones |
| A-4 | Pantry depletion loop | ✅ | ✅ | ✅ (no network) | Confirm-based, forgiving |
| A-5 | Leftover / use-it-up | ✅ | ✅ | ✅ (no network) | Depends on A-4 |
| A-6 | Offline nutrition estimates | ✅ (public-domain data, ~50KB bundle) | ✅ table precached | ✅ (optional name-mapping at import) | Estimate-range framing |
| A-7 | Seasonal collections | ✅ | ✅ | ✅ (no network) | Static rules table |
| A-8 | Bar "what can I make" | ✅ | ✅ | ✅ (no network) | Static substitution table |
| A-9 | Cooked-it journal | ✅ | ✅ | ✅ (no network) | Notes travel via I-6 |

Two ⚠️ flags total, both with documented mitigations (I-4 honest framing; I-7 RSS-first + user-triggered cap). Every other idea is fully constitution-clean.

---

## 5. Recommended Roadmap — Next 3 Sprints

Sequencing logic: **flagship import polish first** (per constitution), then close the daily-use loop (plan → shop → cook), then the data-compounding layer. Each sprint mixes one M anchor with S quick-wins so every sprint ships visible value.

### Sprint 1 — "The Clip Machine" (import flagship)
*Theme: importing becomes effortless and self-improving.*
1. **I-2 Share-target auto-import polish (S)** — the habit loop; do first.
2. **I-8 Clipboard sentinel (S)** — covers share-target gaps on iOS.
3. **I-1 Saved-posts bulk migration (M)** — the switch moment; the resumable Dexie import queue built here is reused by I-2/I-3 offline queuing.
4. *Stretch:* **I-5 re-extraction ledger storage fields only** (stamp prompt version + persist confidence ledger now, UI next sprint) — cheap to add while touching the engine.
- **Compounding effect:** one offline import-queue subsystem powers three features; library size jumps, which makes Sprint 2's auto-plan meaningful (auto-plan is useless on a 10-recipe library — migration fixes that first).

### Sprint 2 — "Plan → Shop → Cook" (the daily loop)
*Theme: SpiceHub replaces the planner, the list app, and the timer in one sprint.*
1. **A-2 Step timers, parse + single timer (S)** — highest wow-per-effort in the whole doc; ship early in sprint.
2. **A-1 Smart weekly auto-plan (M)** — MealSpinner becomes the reroll; pairs with existing week/month views.
3. **A-3 Store mode (M)** — lands on top of the already-queued Phase G grocery restructure; fold the backlog quantity-aggregation item in here.
4. **A-7 Seasonal collections (S)** — filler-sized; makes the landing page feel alive for the demo.
- **Compounding effect:** auto-plan drives grocery list generation drives store mode — one continuous user story to demo end-to-end.

### Sprint 3 — "Memory & Household" (data flywheel)
*Theme: the app starts knowing your kitchen and your people.*
1. **A-4 Pantry depletion loop + A-9 cooked-it journal (M+S, one feature surface)** — "Cooked it ✓" ships both; journal is the carrot that gets users tapping the button that maintains the pantry.
2. **A-8 Bar "what can I make?" (M)** — drink-side inventory matching; doubles as the prototype for future food-side fuzzy fridge.
3. **I-6 QR single-recipe share + library export file (M)** — household sharing *and* the backup story; notes from A-9 ride along.
4. **I-5 Re-extraction diff UI (M, finishes Sprint 1 stretch)** — by now two sprints of prompt improvements exist to retroactively apply, so the feature demos well.
- **Compounding effect:** cook history (A-4/A-9) immediately upgrades Sprint 2's auto-plan recency scoring; bar matching de-risks the large fuzzy-fridge backlog item.

### Parked (revisit after Sprint 3)
- **I-3 multi-page cookbook capture** — strong but independent; slot wherever a sprint runs light.
- **I-4 voice dictation** — small, but wait for share/clipboard analytics to confirm demand.
- **I-7 watchlists** — pending Apify quota math; RSS-only version is a Sprint 4 candidate.
- **A-6 nutrition estimates** — table curation is a good background/parallel task; ship when the table passes a 50-recipe spot-check.
- **A-5 use-it-up ranking** — unlocks automatically once A-4 has a few weeks of pantry data.

---

## 6. Open Questions for the Owner
1. **Household size setting** — A-1 (servings math) and A-5 (leftover detection) both want a "we cook for N people" preference. One-field settings addition; confirm we're comfortable adding a settings surface.
2. **Apify quota reality check** — what do current free-tier limits look like per month? Determines I-1 throttle rate and whether I-7 is viable at all.
3. **Nutrition table curation** — hand-curate 400 ingredients (a focused day of work, fully controlled) vs. script-derive from the USDA FDC bulk CSV (faster, needs a cleaning pass)?
4. **iOS share-target behavior** — PWA share-target support on iOS remains the weakest link for I-2; clipboard sentinel (I-8) is the hedge. Worth a quick device test before Sprint 1 commitment.
5. **QR scan camera screen** — I-6 adds the app's first camera-scanning surface; confirm comfort with the permission prompt UX cost.
