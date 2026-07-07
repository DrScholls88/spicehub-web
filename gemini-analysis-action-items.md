# Gemini UX Analysis — Action Item Backlog

Source: `GeminiAnalysisMealPack.md` (39/100 friction score audit + follow-up Q&A on empty states, starter kit, and recipe discovery). Cross-checked against current codebase (`spicehub-web`) on 2026-07-06 — status notes reflect what's actually built today, not what the doc assumes.

## P0 — Critical (flagged "Severe Risk" in the audit)

1. **Accessibility: focus states not visible.** Audit calls this a critical keyboard-nav gap. Action: audit all interactive elements (buttons, inputs, MealSpinner, ImportSheet) for a visible `:focus-visible` ring; add one design-token-driven focus style globally.
2. **Friction: acceptance-checkbox clarity.** Doc flags an unnamed checkbox as high-friction. Action: locate the checkbox in question (likely an onboarding/consent step) and confirm its copy explains *why* before assuming it needs work — the doc's finding is not codebase-specific and may not apply to SpiceHub as-is.

## P1 — Empty state / first-run experience (biggest gap vs. current code)

3. **Spin button has no "0 meals" guard.** Checked `App.jsx` / `MealSpinner.jsx` — no `savedMeals.length === 0` disabled/redirect logic found. Action: disable/relabel the Spin CTA to "Add Meals to Spin" and route to Quick Import when the library is empty, per the doc's pseudo-code.
4. **No starter-kit / pre-seeded recipes.** Confirmed no seed data, no `source: "starter-kit"` field, no first-run bundle exists anywhere in the codebase. Action: build a ~5-10 recipe JSON bundle, seed it into a new user's Dexie store once, tag with a `source` field so it can be bulk-hidden/deleted later. Decide whether to reuse the "Summer Favorites" content already shown on the landing page or curate separately (open question from the doc).
5. **Progressive "fill your fridge" indicator.** Not built. Lower priority than #3/#4 — only worth doing once the empty-state redirect exists, otherwise it's decoration with nothing to unlock.

## P2 — Discovery / import architecture

6. **`redditDiscovery.js` exists but is fully unwired.** This is the biggest finding: the scraper (Reddit `.json` trick, no-auth, tiered post-vs-subreddit handling) is already written but no component imports it — there's no UI entry point. Action: this is a near-complete version of the "on-demand Discover" flow the doc proposes. Wire it into a dedicated Search/Import surface (e.g. a "+"/Discover affordance in Meal Library) instead of building new scraping logic.
7. **"Dual-library" / offline-first boundary.** Already the architecture (Dexie is source of truth, `Spin` never touches network) — no action needed, just confirm the new Discover surface doesn't regress this by keeping it clearly a separate, online-only overlay.
8. **Offline queuing gap for on-demand imports.** Per existing memory: pasted-URL imports can't be queued offline (no re-fetch path). If the Discover flow is reachable while offline, it needs an explicit "you're offline, try again when connected" state rather than a silent failure — don't let this slip through as the doc assumes networked import always works.
9. **Curated "Discover" categories vs. open search.** Doc recommends 3-5 static curated categories over a Reddit-style feed. Action: decide category set (e.g. Quick Weeknight, Healthy Summer, Low-Carb) — this is a product decision, not just engineering, worth a quick call before building.

## P3 — Dashboard density / conversion polish

10. **Install prompt already de-risked.** Confirmed in `App.jsx`: the install banner only fires on the real `beforeinstallprompt` event (not persistent), and install is also reachable via Settings. The doc's "move Install to a toast" recommendation is essentially already done — no action needed, just verify the banner auto-dismisses cleanly on first interaction.
11. **"Next 5 Days" visual density.** Doc suggests list view over full card images to cut cognitive load. Action: needs a design pass (candidate for the `layout` or `adapt` skill) before touching `LandingPage.jsx` — not a quick fix, size it as its own ticket.
12. **Lazy-load non-hero imagery + skeleton loaders during Spin.** Action: check whether `LandingPage.jsx` already lazy-loads below-the-fold cards; add skeleton state while `weekPlanner.js` scorer runs, since that's a real (if brief) compute step today.
13. **CTA copy: "Spin the Week" → benefit-oriented variant.** Low-effort copy tweak (e.g. "Spin to Plan Your Week"). Candidate for the `design:ux-copy` skill if you want it workshopped rather than picked ad hoc.

## Explicitly not actioned

- Onboarding "3-slide value walkthrough" — doc suggests it, but no existing onboarding component was found and this is a larger scope item than the others; needs its own brainstorming pass rather than folding into this list.
- General "Time to First Action > 3s" performance tracking — no instrumentation exists to measure this yet; flagging as a future analytics need, not a code fix.

## Suggested sequencing

Start with #3 + #4 together (empty-state guard + starter kit) since they solve the same underlying "0 meals" failure the doc calls a trust-breaker, then #6 (wire up the dormant Reddit scraper — highest leverage per line of new code), then the P0 accessibility items, then P3 polish.
