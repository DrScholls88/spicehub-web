# Discovery Mode v2 — Spec

**Date**: 2026-08-06  
**Status**: Draft  
**Scope**: Source expansion (17→25), content filtering + post-type detection, expandable preview card, "Show Everything" toggle. PiP from Discovery deferred.

---

## Problem

Discovery Mode ships single-recipe blog posts alongside roundups, meal plans, baking tool reviews, gift guides. One tap = commit to full import engine — no preview, no undo without manual delete. Only 17 sources when recipe-scrapers supports 700+.

## Goals

1. Only show import-ready single-recipe posts by default
2. Preview before import (reduce mistaken imports to near-zero)
3. Expand source coverage to 25 high-traffic recipe blogs
4. Preserve zero-auth RSS architecture (no API keys, no cost)

---

## 1. Source Expansion

Add 8 sources to `SOURCES` in `api/discover.js`:

| Key | Name | Feed URL | Emoji | Tags |
|-----|------|----------|-------|------|
| `allrecipes` | AllRecipes | `https://www.allrecipes.com/rss` | 🍽️ | weeknight, comfort |
| `simplyrecipes` | Simply Recipes | `https://www.simplyrecipes.com/feed` | 📖 | technique, weeknight |
| `thekitchn` | The Kitchn | `https://www.thekitchn.com/main.rss` | 🏠 | technique, healthy |
| `eatingwell` | EatingWell | `https://www.eatingwell.com/rss` | 🥬 | healthy, mealprep |
| `epicurious` | Epicurious | `https://www.epicurious.com/feed/recipes-rss-feed/rss` | 🧑‍🍳 | technique, seasonal |
| `bonappetit` | Bon Appétit | `https://www.bonappetit.com/feed/recipes-rss-feed/rss` | 🇫🇷 | technique, comfort |
| `foodnetwork` | Food Network | `https://www.foodnetwork.com/fn-dish/recipes.rss` (VERIFY — FN may not publish a single RSS feed; may need per-show feeds or drop this source) | 📺 | comfort, weeknight |
| `nytcooking` | NYT Cooking | `https://rss.nytimes.com/services/xml/rss/nyt/Cooking.xml` | 📰 | technique, seasonal |

No arch change — same registry pattern, same parallel fetch, same round-robin interleave.

**Risk**: Some feeds may require different User-Agent or return Atom instead of RSS. Mitigated by `allSettled` — one bad feed doesn't break others. Test each feed URL before shipping.

---

## 2. Post-Type Detection

New server-side heuristic in `parseRssFeed`. Each parsed post gets a `postType` field.

### Detection Logic

```
postType = 'recipe' (default)

IF title matches roundup pattern → postType = 'roundup'
   Patterns: /\d{2,}\s+(best|easy|quick|favorite|delicious)/i
             /roundup|recipe ideas|meal ideas|what to cook/i
             /top\s+\d+/i

IF title matches meal-plan pattern → postType = 'mealplan'
   Patterns: /meal\s*plan|weekly\s*menu|week of meals/i
             /\d+\s*day\s*(meal|menu|eating)/i

IF title matches guide/tool pattern → postType = 'guide'
   Patterns: /best .+(to buy|we tested|we tried|for \d{4})/i
             /kitchen gadget|product review|equipment|tool/i
             /how to (choose|pick|buy|select)/i

IF title matches baking-tool pattern → postType = 'baking-tool'
   Patterns: /best .+(pan|mixer|sheet|spatula|thermometer|scale)/i

ALSO check content:encoded link density:
  IF >4 internal recipe links in content:encoded → postType = 'roundup'
```

Link density check: count `<a href>` pointing to same domain. Roundup posts typically embed 5-20 links to other recipes on same site.

### Post object shape change

```js
// Before
{ title, link, imageUrl, snippet, pubDate, categories, source, sourceName, sourceEmoji }

// After (additive)
{ ...existing, postType: 'recipe'|'roundup'|'mealplan'|'guide'|'baking-tool' }
```

---

## 3. Content Filtering

### Server-side (api/discover.js)

New query param: `?filter=strict|relaxed` (default: `strict`).

- **strict** (default): Existing `skipPatterns` + new post-type filter. Only `postType === 'recipe'` passes through. All others excluded from response.
- **relaxed**: Only original `skipPatterns` (giveaways, sweepstakes). All post types included. Each post still tagged with `postType` for client-side badge display.

Response shape unchanged. `filter` param just controls which posts make it into `posts[]`.

### Client-side (blogDiscovery.js + DiscoverRecipes.jsx)

New chip in category row: "Unfiltered" (or last position, after Seasonal).

When tapped:
1. Set `activeFilter = 'relaxed'`
2. Re-fetch with `?filter=relaxed` (bypasses client cache since different param)
3. Posts that would be filtered in strict mode get a badge pill (see §4)

When untapped: revert to `?filter=strict`, use cached strict results.

State: `const [showAll, setShowAll] = useState(false);`

---

## 4. Expandable Preview Card

Reuse Aceternity expandable-card pattern from MealLibrary.

### Interaction Flow

```
[Card in list]
    │ tap
    ▼
[Card expands inline — layoutId animation]
    ├── Hero image (full-width, max-height 200px, SafeMediaImage)
    ├── Title (larger, 16px weight 800)
    ├── Source badge + date + postType pill (if not 'recipe')
    ├── Full snippet/description (untruncated, max ~300 chars from RSS)
    ├── Category chips (from RSS <category> tags, max 5)
    ├── ─────────────────────────
    ├── [Import] button — primary CTA, fires onSelectUrl(post.link)
    └── [View on {sourceName}] — secondary, window.open(post.link, '_blank')
    │
    │ tap outside / collapse button / swipe down
    ▼
[Card collapses back to list item]
```

### Implementation

- `expandedPost` state (null or post object)
- Tap card → `setExpandedPost(post)` (instead of directly calling `onSelectUrl`)
- Only expanded card's "Import" button calls `onSelectUrl`
- `layoutId={post.link}` for morph animation (link is unique key)
- Collapse: click scrim, X button, or `Escape` key

### PostType Badge

When `showAll` active and post has `postType !== 'recipe'`:
- Small pill next to source badge: "Roundup" / "Meal Plan" / "Guide" / "Baking Tool"
- Color: `var(--text-muted)` bg, not alarming — informational only
- In strict mode these posts never appear, so badge only relevant when unfiltered

---

## 5. Files Changed

| File | Change |
|------|--------|
| `api/discover.js` | +8 SOURCES entries, expanded `skipPatterns`, `postType` detection heuristic, `?filter` query param |
| `src/scrapers/blogDiscovery.js` | Pass `filter` param to API, handle cache keying by filter mode |
| `src/components/DiscoverRecipes.jsx` | `expandedPost` state, expandable card UI, "Unfiltered" chip, postType badge |
| `src/components/DiscoverRecipes.css` | Expanded card styles, badge pill, unfiltered chip styling |

No new files. No new dependencies. No DB changes.

---

## 6. Edge Cases

- **Feed timeout**: Existing `allSettled` + per-feed 8s timeout handles this. New sources follow same pattern.
- **NYT/Epicurious paywalled content**: RSS feeds are public; import engine handles paywall when user taps Import (existing behavior — blog link follower extracts JSON-LD before hitting paywall wall).
- **Atom vs RSS**: Some feeds (NYT) may serve Atom XML. `extractTag` regex should handle `<entry>` + `<content>` in addition to `<item>` + `<description>`. Add Atom fallback parsing if NYT feed returns Atom.
- **Empty expanded card**: If RSS snippet is empty and no image, expanded card is sparse. Show "Visit source for details" link prominently.
- **Category cache split**: Client caches strict and relaxed results separately (different cache keys) to avoid re-fetching when toggling.

---

## 7. What's NOT In Scope

- PiP video from Discovery cards (deferred — separate spec)
- Recipe search API (Edamam/Spoonacular) — future enhancement
- User-customizable source list (pick your blogs) — future
- Infinite scroll / pagination (current per-source cap of 15 is sufficient)
- Offline Discovery (already handled — shows offline message)

---

## 8. Testing Plan

1. **Feed validation**: Hit each of 8 new RSS URLs, confirm parseable XML, verify image extraction works
2. **Post-type detection**: Collect 20 sample titles from AllRecipes/Epicurious, verify roundup/mealplan/recipe classification accuracy
3. **Filter toggle**: Strict returns only `recipe` type; relaxed returns all with correct badges
4. **Expandable card**: Tap expands, shows all fields, Import fires `onSelectUrl`, collapse works (tap outside, X, Escape)
5. **Cache behavior**: Toggle strict↔relaxed doesn't serve wrong cached data
6. **Regression**: Existing 17 sources still load, existing category/source filters still work, search still works
