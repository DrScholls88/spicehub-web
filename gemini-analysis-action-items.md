# Gemini UX Analysis — Action Item Backlog

Source: `GeminiAnalysisMealPack.md` (39/100 friction score audit + follow-up Q&A on empty states, starter kit, and recipe discovery). Cross-checked against current codebase (`spicehub-web`) on 2026-07-06 — status notes reflect what's actually built today, not what the doc assumes.

## P0 — Critical (flagged "Severe Risk" in the audit)

1. **Accessibility: focus states not visible.** Audit calls this a critical keyboard-nav gap. Action: audit all interactive elements (buttons, inputs, MealSpinner, ImportSheet) for a visible `:focus-visible` ring; add one design-token-driven focus style globally.
2. **Friction: acceptance-checkbox clarity.** Doc flags an unnamed checkbox as high-friction. Action: locate the checkbox in question (likely an onboarding/consent step) and confirm its copy explains *why* before assuming it needs work — the doc's finding is not codebase-specific and may not apply to SpiceHub as-is.

## P1 — Empty state / first-run experience (biggest gap vs. current code)

3. ✅ **DONE (2026-07-07).** Spin button "0 meals" guard. `generateWeek` (App.jsx) no longer shows a blocking `alert()`; under 5 meals it toasts and routes to Library. LandingPage CTA relabels to "Add Meals to Spin" at 0 meals.
4. ✅ **DONE (2026-07-07).** Starter kit. Turned out `paprika_import_data.js` already held 32 of Brian's real saved recipes, imported into App.jsx but never used — same dead-code pattern as #6. Wired those (not invented filler) via `src/data/starterKitMeals.js`; auto-seeds once per device, tagged `starterKit:true`, removable from Settings.
5. **Progressive "fill your fridge" indicator.** Not built. Lower priority — only worth doing once the empty-state redirect exists (now does), still decoration with nothing new to unlock.

## P2 — Discovery / import architecture

6. ✅ **DONE (2026-07-07).** `redditDiscovery.js` wired up. Turned out single-post Reddit URL import already worked (recipeParser.js already routed reddit.com URLs through `tryRedditJson`) — the actual gap was `discoverRedditRecipes()` (subreddit browsing) having zero callers. Built `DiscoverRecipes.jsx`, a new speed-dial FAB action in Meal Library with 5 curated category chips (see #9). Selecting a result hands the URL to the existing `handleQuickImport` → ImportSheet pipeline — no parallel import path.
7. **"Dual-library" / offline-first boundary.** Preserved — Discover only reads from network on open, never touches Dexie directly.
8. ✅ **Addressed as part of #6.** DiscoverRecipes shows an explicit "needs an internet connection" state (checks `navigator.onLine`) instead of a silent failure.
9. ✅ **Resolved as part of #6.** 5 curated categories: Quick Weeknight (r/EatCheapAndHealthy), Comfort Food (r/recipes), Vegetarian & Vegan (r/veganrecipes), Meal Prep (r/MealPrepSunday), Baking & Sweets (r/Baking). Revisit the subreddit list if any turn out low-quality in practice.

## P3 — Dashboard density / conversion polish

10. **Install prompt already de-risked.** Confirmed in `App.jsx`: the install banner only fires on the real `beforeinstallprompt` event (not persistent), and install is also reachable via Settings. The doc's "move Install to a toast" recommendation is essentially already done — no action needed, just verify the banner auto-dismisses cleanly on first interaction.
11. **"Next 5 Days" visual density.** Doc suggests list view over full card images to cut cognitive load. Action: needs a design pass (candidate for the `layout` or `adapt` skill) before touching `LandingPage.jsx` — not a quick fix, size it as its own ticket.
12. **Lazy-load non-hero imagery + skeleton loaders during Spin.** Action: check whether `LandingPage.jsx` already lazy-loads below-the-fold cards; add skeleton state while `weekPlanner.js` scorer runs, since that's a real (if brief) compute step today.
13. **CTA copy: "Spin the Week" → benefit-oriented variant.** Low-effort copy tweak (e.g. "Spin to Plan Your Week"). Candidate for the `design:ux-copy` skill if you want it workshopped rather than picked ad hoc.

## Explicitly not actioned

- Onboarding "3-slide value walkthrough" — doc suggests it, but no existing onboarding component was found and this is a larger scope item than the others; needs its own brainstorming pass rather than folding into this list.
- General "Time to First Action > 3s" performance tracking — no instrumentation exists to measure this yet; flagging as a future analytics need, not a code fix.

## Suggested sequencing

~~Start with #3 + #4~~ ~~then #6~~ — both done 2026-07-07. Next up: the P0 accessibility items (#1 focus states, #2 checkbox copy), then P3 polish (#11–13).
