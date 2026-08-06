# HardenIdeas.md — Audit Against Current Code (2026-08-06)

Evaluated every claim in `HardenIdeas.md` against the actual pipeline: `src/import/acquire/instagram.js`, `api/proxy.js`, `api/extract.js`, `src/lib/blogLinkFollower.js`, `src/import/structure/gemini.js`, `src/recipeParser.js`, `src/db.js`. Legend: ✅ built · ⚠️ partial/different · 🔴 missing.

---

## 1. Pipeline contracts + telemetry

| Item | Status | Evidence |
|---|---|---|
| Apify → caption/media/shortcode/isVideo contract | ✅ | `instagram.js` `buildRace()` normalizes every source (apify/oembed/ig-json) to `{src, caption, images, title, isVideo}` |
| Blog → ingredients≥2 or `_isPartial`+article text | ✅ | `blogLinkFollower.js` `normalizeRecipe()` sets `_isPartial` when directions are empty; `extractRecipeFromBlog` strategy 5 returns `_isPartial`+`_articleText` when no structure found at all |
| Gemini → schema-valid name+ingredients+directions | ⚠️ | `structurePack()` only checks `best.isRecipe` (a model self-report bool) — no structural check that ingredients/directions are actually non-empty before accepting |
| Finalize → sourceUrl/videoUrl/link never dropped | ⚠️ | Set correctly on first save (`enrichResult` in blogLinkFollower.js), **but see the dedup-merge bug in §5** — a second import merging into an existing record can silently drop a populated `videoUrl` |
| Structured per-import telemetry `{stage,ms,ok,reason,domain,extractionSource}` | 🔴 | Only `console.log` breadcrumbs exist (`logResult()` in blogLinkFollower.js logs one line per attempt: class/reason/links/strategy/method/ms). Nothing is aggregated, stored, or queryable — the doc's own point stands: "you can't harden what you can't see" |

**Verdict:** the contracts are real and mostly honored, but the observability layer the rest of the plan depends on genuinely doesn't exist yet.

---

## 2. Apify layer

| Item | Status | Evidence |
|---|---|---|
| Timeout + single retry | ✅ | `api.js` `fetchInstagramViaApify`: retries once on 5xx with 800ms backoff, no retry on 4xx |
| Validate payload shape | ✅ | Race entries throw `apify-weak` when `caption.length <= MIN_CAPTION(30)`, so a thin/empty payload is treated as a soft fail and falls through to oEmbed/ig-json |
| **Comment pin scan — "wire real comments"** | ✅ already done | `api/proxy.js` mode=`instagram-apify` extracts real `post.latestComments` (top 5), plumbed through `instagram.js` → `pack.latestComments` → `blogLinkFollower.discoverLinks()` scans the first 3. The doc's phrasing ("you designed it — wire real comments") suggests this was believed to be a stub; it isn't. |
| External URL/bio from actor → `profileBioUrl` | 🔴 confirmed missing, self-documented | `recipeParser.js:5066-5068` has the team's own comment: *"profileBioUrl: needs Apify fullData to get the external bio link — basicData only gives ownerUsername... Plumbing is ready; wire when Apify detail level is upgraded."* The parameter exists end-to-end in `tryBlogLinkExtraction`, it's just never populated because the actor call uses `dataDetailLevel: 'basicData'` (`api/proxy.js:277`), which doesn't return the profile's bio link at all. |
| Actor version pin | 🔴 | `api/proxy.js:269` — `apify~instagram-post-scraper`, no revision/build pinned. Real risk: upstream actor changes silently reshape the response. |
| Circuit breaker (session-level, after N failures) | 🔴 | Not present anywhere. Only the single per-request retry above. |
| Cache by canonical IG URL / TTL by shortcode | ⚠️ different mechanism | No app-level TTL cache keyed on shortcode. What exists: (a) `cleanUrl()` canonicalizes the IG URL before it's used as a cache/proxy key, (b) the Apify proxy response sets `Cache-Control: public, max-age=3600, s-maxage=3600` — Vercel's edge/CDN will dedupe identical requests within the hour, but there's no explicit app-level dedup/TTL store, so a second import while a request is in-flight isn't shared (see idempotency, §5). |
| Server-only Apify token | ✅ | `api/proxy.js:260` reads `process.env.APIFY_TOKEN`, never a `VITE_*` var — never reaches the client bundle |

---

## 3. Blog link follower

This section is the most thoroughly built of the whole plan — most items are already shipped, several exceeding what the doc describes.

| Item | Status | Evidence |
|---|---|---|
| Global time budget (12-15s) | ✅ | `tryBlogLinkExtraction`: `BUDGET_MS = 14000`, checked before every attempt via `budgetExpired()`, plus a hard `MAX_ATTEMPTS = 4` cap |
| Attempt ledger `url → strategy` | ⚠️ | `logResult()` logs one summary line (class/reason/links/strategy/method/url/ms) per call, not a structured per-URL ledger array. Fine for manual log reading, not queryable. |
| Short-link unwrap, 1 hop, 3s timeout, SSRF-safe | ⚠️ | `unwrapShortLink()` does 1 hop — but timeout is 5s not 3s, and it routes through `fetchHtmlViaProxy` → `/api/proxy`, which does have SSRF blocking (see below), so the "reject private IPs" half is satisfied even though it's not literally inline in `unwrapShortLink`. |
| SSRF allowlist mindset (block localhost/link-local/metadata IPs) | ✅ — thorough | `api/proxy.js` `isBlockedHost()`: literal loopback/link-local, decimal/octal/hex IP-literal encodings (`2130706433`, `0x7f000001`, `017700000001`), IPv6 loopback/link-local/ULA/mapped-private, and correctly-bounded IPv4 private ranges (172.16-172.31, not a naive `startsWith('172.2')`). The code has an honest comment noting the one real gap: Edge Runtime can't re-resolve DNS to close a DNS-rebinding attack. |
| Paywall/CF detect, early exit | ✅ | `extractRecipeFromBlog`: checks first 3000 chars for "subscribe to continue", "sign in to read", "cf-challenge", "just a moment...", "paywall" — exits before any parsing |
| Partial merge rules (blog ingredients+times win, Gemini fills directions) | 🔴 not found as an explicit rule | `_isPartial` results get merged with caption content, but I did not find an explicit rule anywhere enforcing "blog ingredients/times always win over Gemini's". Worth confirming directly with a test case rather than assuming the `RECONCILIATION_RULES` prompt text alone (`gemini.js:32-45`, which does say "prefer STRUCTURED DATA... only override when missing/contradicts") reliably produces this in practice — it's a prompt instruction, not a code-enforced merge. |
| Domain learning — review queue, not auto-trust | ⚠️ real discrepancy from the doc's own §9 warning | `recordLearnedDomain()` is called **unconditionally** after every successful blog extraction (`blogLinkFollower.js:942-944`) and immediately boosts that domain's priority score in future `scoreUrl()` calls (`db.js` `getLearnedDomains`). There's no review/approval step — this is close to exactly the pattern the doc's own §9 flags as a risk ("Auto-add every successful domain to allowlist — Poisoning"). Not exploitable by an outside attacker (nothing external controls what URLs your own captions contain), but it does mean one bad extraction from a low-quality domain can quietly raise that domain's future priority with no human in the loop. |
| HTML size cap (1.5-2MB) before parse | 🔴 | `extract.js` has `MAX_HTML_BYTES = 2_500_000` for its own fetch path, but `blogLinkFollower.js` calls `fetchHtmlViaProxy()` → generic `/api/proxy`, which does `await response.text()` with no size cap at all. A large page could be read into memory in full. |
| **PiP invariant** (videoUrl=IG, link=blog, sourceUrl=IG) | ✅ on first save | `enrichResult()` in `blogLinkFollower.js:919-948` sets this correctly: `videoUrl = isVideo ? instagramUrl : ''`, `_sources = {primary:'blog', blogUrl, instagramUrl, videoUrl}`. **But this invariant is NOT protected on merge** — see the concrete bug below. |

**Concrete bug found (not in the doc, found while cross-checking the PiP invariant against this session's own dedup work):** `db.js` `mergeRecipeData()` (line 922) spreads `...existing` first and only explicitly carries over `ingredients`/`directions`/`imageUrl`/`link`/`updatedAt` from `incoming`. `videoUrl` is never mentioned, so on a duplicate-import merge the **existing** record's `videoUrl` always wins — including when it's empty and the incoming import just resolved a real one. This directly threatens the "non-negotiable" PiP invariant the doc calls out, via a path the doc didn't anticipate (dedup merging, built this same session in L2). Worth a one-line fix: `videoUrl: existing.videoUrl || incoming.videoUrl` (and likely `_sources` too).

---

## 4. Gemini / structure

| Item | Status | Evidence |
|---|---|---|
| Schema validation before accept, reject empty ingredients/directions | 🔴 | `structurePack()` only checks `best.isRecipe` (the model's own self-reported boolean). No code-level check that `ingredients.length` or `directions.length` are non-zero before accepting. `finalizeAIRecipe()` (the single exit point for every LLM path, `recipeParser.js:864`) also has no reject/retry gate — it falls back to display defaults (`'Imported Recipe'`) rather than rejecting. |
| Input budget (6-8k chars) | ✅ | `recipeParser.js` caps caption/article text to 6000 chars in 3 places (lines 2067, 3134, 5136); `contextPack.js` separately owns a ~50K char total pack budget per its own header comment |
| Provider fallback, explicit + logged order | ⚠️ different shape | What exists is same-provider escalation: flash-lite → flash-flagship on low confidence (`structurePack()`, confidence floor 0.6), not the doc's Gemini→Mistral→deterministic cross-provider chain. Per project memory, a Mistral/deterministic fallback does exist elsewhere in the broader pipeline (Grok is disabled by default), but it isn't unified into one explicit, logged decision point the way the doc suggests. |
| Skip Gemini entirely on full JSON-LD | ⚠️ intentionally different | `packHasCompleteCandidate()` + `buildPackContents()` switch to a cheaper `'verify'` mode (lighter prompt, "don't re-extract, just clean/normalize") rather than skipping the call outright. This looks like a deliberate design choice (catches unit typos/OCR artifacts JSON-LD sites still have) rather than an oversight — worth a conscious decision rather than assuming the doc's "skip" is strictly better. |
| Prompt version pin in result metadata | ✅ (elsewhere) | Not inside `gemini.js` itself, but per existing project history `ENGINE_PROMPT_VERSION` is stamped downstream at persistence time — satisfies the intent even though it's not colocated with the model call. |
| 429/quota handling — never infinite retry | ⚠️ half-satisfied | No infinite retry exists (good), but there's also no 429-specific branch — `geminiPackRequest()` treats a 429 identically to any other non-ok status: log + return null, single attempt. No backoff, no distinct user-facing toast for "rate limited, try again shortly" vs. a generic failure. |
| Client vs server key — server preferred | ✅ well done | `structurePack()` defaults to `serverStructurePack()` (server-side `/api/structure`) unless a test explicitly passes a `clientKey` override, with an explicit comment: "Security: never read VITE_GOOGLE_AI_KEY from the client bundle." |

---

## 5-9. Cross-cutting, security, quality gates, ship order, anti-patterns

| Item | Status | Evidence |
|---|---|---|
| Idempotency — concurrent same-URL imports share one in-flight promise | 🔴 | No in-flight promise registry found anywhere (`inFlight`/dedup-by-URL search came back empty outside of an unrelated file). Two rapid taps on the same link today will race two independent import pipelines; L2's new save-time dedup (this session) will merge the results afterward, but both pipelines still fully execute (wasted Apify/Gemini cost). |
| Offline queueing, no half-written meals | ✅ | Established infrastructure: `backgroundSync.js`, `OfflineIndicator.jsx`, `useOnlineStatus.js`, plus the ghost/ImportReview status flow already handles "processing"/"failed" states without ever showing a half-written meal in the library. |
| Progress-label messaging matching stage | ✅ | `recipeParser.js:5060-5062` — e.g. `"Caption points to blog — following recipe link…"` vs `"Caption thin — checking for recipe blog links…"`, stage-specific |
| Re-extract as explicit user choice (blog vs caption vs AI) | ✅ | `ReExtractSheet.jsx` (per project memory, I-5 feature) already re-runs cached caption with accept/reject diff |
| Image 403 handling, blog hero fallback to IG | ✅ | `resolveDisplayableImage` + `SafeMediaImage` 3-tier fallback (per project memory, shipped 2026-06-19) |
| Security: proxy-only fetch, no open redirect with secrets | ✅ | All external fetches route through `/api/proxy` or `/api/extract`, both with SSRF host-blocking; no client-side fetch-with-secret pattern found |
| Strip HTML before client display of raw blog text | Not directly verified | Didn't check every render path this pass — flag for a follow-up pass if this matters (ImportReview/ReExtractSheet raw-text display) |
| No IG cookies in backend | ✅ | Confirmed — Apify is the sole IG data source; no cookie/session-based scraping found |
| Minimum-accept quality gate (§7) at save/finalize | 🔴 | Same finding as §4 — `finalizeAIRecipe` doesn't enforce "≥2 ingredients, ≥1 direction, sourceUrl set, videoUrl set for reels" as a hard gate. `confidence`/`needsReview` fields do exist and drive the "Improve" badge in MealLibrary (soft signal), but that's different from the doc's proposed hard accept/reject gate with confidence-tiered badges (`blog_jsonld` high / `caption_ai` medium / `partial` low) — today it's a single boolean `needsReview`, not a 3-tier badge. |
| §9 "what not to do" — already avoided | ✅ | No Instaloader/cookie scraping, no auto-follow-every-strong-caption-link (blog follower explicitly skips when `quality.class === 'strong'`), no parallel multi-Gemini calls per import (sequential primary→escalation only) |

---

## Bottom line

The plan reads like it was written without full visibility into how far this pipeline already is — a lot of "build this" is actually "this already shipped," in some cases (comments, SSRF, paywall detection, dual-source PiP identity, server-only keys) more thoroughly than the doc assumes.

**Genuinely new and worth doing, ranked by what's real + cheap:**

1. **The `mergeRecipeData` videoUrl bug** (found this audit, not in the original doc) — one-line fix, directly protects the invariant the doc calls non-negotiable, and is a live regression risk introduced by this session's own dedup work.
2. **Structured per-import telemetry** (§1) — genuinely absent; everything else in the plan that says "log this" is building on a foundation that doesn't exist yet. Cheapest version: an array/IndexedDB table of `{stage, ms, ok, reason, domain, extractionSource}` per import, not a new service.
3. **Hard minimum-accept gate in `finalizeAIRecipe`** (§4/§7) — reject empty ingredients/directions before returning, rather than silently defaulting to "Imported Recipe."
4. **`profileBioUrl` wiring** (§2) — the team already scoped this precisely in their own code comment; just needs the Apify call upgraded from `basicData` to a detail level that returns the bio link (cost/latency tradeoff to weigh — this bumps every Apify call, not just failures).
5. **HTML size cap on `/api/proxy`'s generic path** (§3) — `extract.js` already has the pattern (`MAX_HTML_BYTES`), just needs porting to the shared proxy.
6. **Domain-learning review gate** (§3) — currently auto-trusts after one success; the doc's own §9 warns against exactly this pattern.

**Lower priority / reconsider rather than build as-specified:**

- Apify circuit breaker and actor version pin — real gaps, but lower urgency than the above since the single-retry + soft-fail-to-oEmbed/ig-json fallback already contains most failure modes.
- Cross-provider Gemini→Mistral→deterministic explicit fallback chain — a nice-to-have consolidation of logic that's reportedly already spread across the codebase; would be a refactor for clarity/logging, not new capability.
- "Skip Gemini on strong JSON-LD" — the existing verify-mode behavior may be an intentional and better tradeoff (catches OCR/unit errors JSON-LD misses); worth a decision, not an assumed fix.
- In-flight-promise idempotency — real gap, but low blast radius today since save-time dedup (L2, this session) already prevents duplicate *records* even if it doesn't prevent duplicate *work*.
