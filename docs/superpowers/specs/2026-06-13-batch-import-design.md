# Batch Import (Multi-Share) — Design Spec

**Date**: 2026-06-13
**Status**: Approved for implementation planning
**Author**: Claude (brainstorming session with Brian)

## Problem

SpiceHub's Instagram import is single-URL-at-a-time: each share intent opens
`ImportSheet` for one post. When a user selects multiple posts in Instagram
and uses "Send to" → SpiceHub, the OS may bundle several post URLs into a
single share payload (commonly as newline/space-separated URLs in one
`EXTRA_TEXT` string on Android). Today this either fails to parse cleanly or
only the first URL is used. There's also no in-app way to work through a
backlog of saved links faster than one at a time.

## Scope

This spec covers **multi-URL share detection only**. Manual "paste multiple
links" mode and a persistent cross-launch share queue (repeated single
shares accumulating over time) are explicitly out of scope for this round —
candidates for a future fast-follow.

## Goals

- Detect when an incoming share payload contains 2+ recipe URLs.
- Queue all detected items for sequential background extraction, respecting
  the existing per-item extraction budget (45-60s) and Apify/Gemini rate
  limits.
- Persist the queue in Dexie so it survives reload/offline — consistent with
  "Offline Sovereignty."
- Reuse the existing `ImportSheet` review UI for per-item review/save — no
  new editable-recipe UI.
- Each item gets independent meal/drink type auto-detection, editable
  per-item (same `itemTypeUserOverride` pattern as single import).
- Failures are isolated per item; user can retry or fall back to manual entry
  without blocking the rest of the batch.

## Non-Goals

- Bulk "save all" without individual review (v1 requires opening each ready
  item in `ImportSheet` review, even if just to confirm/save).
- Manual multi-URL paste UI in `ImportInput`.
- Cross-session share accumulation queue.

---

## 1. Detection & Routing

Extend the existing share-target handlers in `App.jsx`:
- PWA Web Share Target handler (`share-target` GET/POST params, ~lines 285-299)
- Capacitor native share listener (`spicehub:share-import`, ~lines 305-322)

Before routing to the existing single-import flow (`setShowImportFor` +
`setSharedContent`), call a new helper:

```js
// recipeParser.js
export function extractMultipleUrls(text) {
  // Scan for 2+ recognizable social-media URLs (Instagram, TikTok, etc.)
  // separated by whitespace/newlines. Returns string[] (deduped, validated
  // via isSocialMediaUrl). Returns [] or [singleUrl] for non-batch cases.
}
```

- If `extractMultipleUrls(text).length >= 2` → route to batch flow (Section 2).
- Otherwise → existing single-import flow, completely unchanged (regression
  safety: single shares must behave exactly as today).

---

## 2. Data Model

New Dexie table `batchQueue`:

```js
{
  id: <auto>,
  url: string,
  status: 'pending' | 'extracting' | 'ready' | 'failed' | 'saved',
  itemType: 'meal' | 'drink',
  itemTypeUserOverride: boolean,   // mirrors existing single-import pattern
  recipe: object | null,           // extracted recipe once 'ready'
  error: string | null,            // populated when 'failed'
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

All items are written to `batchQueue` with `status: 'pending'` **immediately**
on share detection, before any extraction begins — so a batch survives an app
close/crash mid-processing.

---

## 3. Queue UI

New component `BatchImportQueue.jsx`:

- Full-screen modal, slide-up sheet using the same `--sh-spring` easing and
  drag-to-dismiss gesture pattern as `ImportSheet` (per the round-4
  drag-to-dismiss work).
- Auto-opens when `extractMultipleUrls` detects a batch.
- Live-reads `batchQueue` (Dexie live query) and renders one row per item:
  - **pending** — greyed, "Queued"
  - **extracting** — spinner + step message (mirrors `BrowserAssist`'s
    `extractionProgress` steps: "AI analyzing...", etc.)
  - **ready** — thumbnail (if captured), title, confidence badge, tappable
    meal/drink pill, "Review →"
  - **failed** — error icon + short reason, "Retry"
  - **saved** — checkmark, dimmed

**Re-entry**: a floating pill (new element, positioned clear of existing FABs)
shows the count of `pending` + `ready` items when `BatchImportQueue` is
closed/backgrounded. Tapping it reopens the queue. Pill disappears when the
queue is empty (all `saved` or cleared).

---

## 4. Processing Engine

Sequential background worker (`batchImportEngine.js`, driven by a `useEffect`
in `App.jsx`):

1. Pick the next `pending` item → mark `extracting`.
2. Run the existing `importItemFromUrl` pipeline (Apify → Gemini → schema
   gate), same per-item timeout budget as single import.
3. **Success**: write `recipe`, auto-detect `itemType` (existing heuristic),
   mark `ready`.
4. **Failure/timeout**: write `error` message, mark `failed`.
5. Move to the next item — strictly sequential (one in-flight extraction at a
   time) to respect Apify/Gemini rate limits.
6. **Offline**: if `navigator.onLine` is false, pause on the current item
   (leave it `pending`/`extracting` as appropriate); resume automatically on
   the `online` event — same pattern as the existing offline action queue.

Processing continues even if `BatchImportQueue` is closed (engine lives at
`App.jsx` level, not inside the modal).

---

## 5. Review, Retry & Cleanup

- **Review/save**: tapping a `ready` row opens `ImportSheet` with
  `phase: 'review'`, pre-populated with that item's `recipe` and `itemType`
  (respecting `itemTypeUserOverride`). Existing save-to-destination footer
  works unchanged. On save, the `batchQueue` row → `saved`.
- **Retry**: tapping a `failed` row opens `ImportSheet` with `phase: 'input'`,
  pre-filled with the item's `url` — identical to today's manual-recovery
  path (retry pipeline or fall back to paste/photo).
- **Cleanup**: when all items are `saved`, or the user dismisses remaining
  `failed`/`pending` rows via a "Clear" action, the floating pill disappears
  and the corresponding `batchQueue` rows are deleted.

---

## 6. Testing Plan

1. Simulate a share payload with 3 valid Instagram URLs (newline-separated) —
   confirm `extractMultipleUrls` returns all 3 and `batchQueue` gets 3
   `pending` rows.
2. Single-URL shares still route through the existing single-import flow
   unchanged (regression check — critical).
3. Mixed meal/drink links — confirm per-item `itemType` auto-detection and
   override UI work independently per row.
4. Force one item to fail (invalid/unsupported URL) — confirm `failed` state;
   retry opens `ImportSheet` pre-filled with that URL.
5. Go offline mid-batch — confirm processing pauses on the current item and
   resumes on reconnect.
6. Close `BatchImportQueue` mid-processing — confirm floating pill shows the
   correct pending+ready count and reopens the queue on tap.
7. Reload the app mid-batch — confirm `batchQueue` persists in Dexie and
   processing resumes from where it left off.
8. `npm run build` on Windows — clean build, no errors.

---

## Open Questions / Future Work

- Manual "paste multiple links" mode in `ImportInput` (deferred).
- Persistent cross-launch share queue for repeated single shares (deferred).
- Bulk "save all high-confidence" action (deferred — v1 requires individual
  review/save per item).
