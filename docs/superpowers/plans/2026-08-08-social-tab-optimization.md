# Social Tab Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Friends/Social tab for Supabase free-tier limits (5GB egress, 200 concurrent Realtime connections) while adding custom avatar uploads and polished avatar UX across the social layer.

**Architecture:** Three independent packages: (A) bandwidth/Realtime optimization (delta sync, scoped Realtime, activity feed caching), (B) Supabase Storage avatar upload pipeline with client-side compression, (C) avatar UI polish (circular photo avatars, initials fallback, online indicators). Each package ships independently with its own migration file where needed.

**Tech Stack:** Supabase Storage (public `avatars` bucket), existing `imageCompressor.js` canvas pipeline (no new dependency — Gemini doc suggests `browser-image-compression` but we already have a working compressor), Dexie IndexedDB, Framer Motion, vitest.

**Prerequisite:** Migration `005_social_features_tier1.sql` must be applied before starting. It's been in the repo since 2026-08-06 but has NOT been run yet per project memory.

**iOS Compatibility Notes (apply to every task):**
- Safari/WebKit doesn't support WebP `canvas.toDataURL('image/webp')` — always fall through to JPEG (the existing `compressFromImageSrc` already handles this correctly via the `dataUrl.length < 50` guard)
- `<input type="file" accept="image/*">` on iOS Safari opens the photo picker natively — no special handling needed, but `capture="environment"` should NOT be set (it forces camera-only, skipping Photo Library)
- `URL.createObjectURL` works on iOS Safari 14.5+ (our min target) — safe to use for optimistic preview
- Supabase Storage upload via `ArrayBuffer` works cross-platform; `File` objects from iOS photo picker preserve EXIF orientation — canvas draw auto-corrects on modern WebKit (since Safari 13.1)
- Safe-area insets on the avatar upload sheet: use existing `useSwipeDismiss` bottom-sheet pattern which already handles `env(safe-area-inset-bottom)`

---

## Gap Analysis (Gemini Doc vs Current State)

| Gemini Recommendation | Current State | Action |
|---|---|---|
| 1. Delta fetching (Dexie cache + `created_at > lastSync`) | `syncFriendsToLocal()` does full clear-and-replace every time (4 RPCs) | **PKG A — implement delta sync** |
| 2. Optimistic UI updates | Shares have optimistic Dexie write; friends sync does not | **PKG A — add optimistic friend-accept** |
| 3. Scoped Realtime listeners | `useFriendsRealtime` is globally mounted in `App.jsx` — channels stay open 100% of session time | **PKG A — scope channels to Friends modal mount** |
| 4. Debounce user search | **ALREADY DONE** — 400ms debounce + 6-call/3s cooldown in `FriendsSection.jsx` | No action |
| 5. Optimize feed query (RPCs, `.limit()`) | **ALREADY DONE** — `get_friend_activity` RPC with `LIMIT/OFFSET` | No action |
| 6. Client-side avatar compression | No avatar upload exists; `imageCompressor.js` exists but isn't wired to avatars | **PKG B — avatar upload pipeline** |
| 7. Storage uploads to `avatars` bucket | No Supabase Storage bucket exists (`storage.buckets` has 0 rows) | **PKG B — Supabase migration** |
| 8. Local avatar URL caching in Dexie | Avatars are emoji-only (pixelAvatars.js) — no URLs to cache | **PKG B — cache avatar URLs in Dexie friends table** |
| 9. Interactive upload trigger (camera icon overlay) | ProfileCard has emoji picker only, no photo upload | **PKG C — avatar upload UX** |
| 10. Replace emoji with circular avatars + initials fallback | All surfaces use `getAvatar(id).emoji` — 8 components | **PKG C — AvatarCircle component** |
| 11. Activity indicators (green dot for online/recent) | No online presence or "recently shared" indicator | **PKG C — presence dot** |

---

## File Structure

### New Files
- `src/lib/avatarUpload.js` — compress + upload to Supabase Storage + cache URL in Dexie
- `src/components/AvatarCircle.jsx` — universal avatar renderer (photo URL → initials → emoji fallback)
- `src/__tests__/avatarUpload.test.js` — upload pipeline unit tests
- `src/__tests__/avatarCircle.test.js` — rendering fallback chain tests
- `supabase/migrations/006_avatar_storage.sql` — Storage bucket + RLS policies

### Modified Files
- `src/lib/cloudProfile.js` — add `avatar_url` field handling, delta-sync timestamp
- `src/lib/friends.js` — delta sync logic (skip full clear when possible)
- `src/hooks/useFriendsRealtime.js` — accept `enabled` prop, scope channel lifecycle
- `src/lib/friendActivity.js` — add Dexie caching layer
- `src/components/ProfileCard.jsx` — photo upload trigger + AvatarCircle
- `src/components/FriendsSection.jsx` — AvatarCircle in friend rows, presence dot
- `src/components/FriendActivityFeed.jsx` — AvatarCircle in activity rows
- `src/components/ShareHistorySheet.jsx` — AvatarCircle
- `src/components/SharedWithYouSection.jsx` — AvatarCircle
- `src/components/SharePickerSheet.jsx` — AvatarCircle
- `src/components/HomeGroupSection.jsx` — AvatarCircle for member dots
- `src/data/pixelAvatars.js` — export `getAvatarFallback()` for use by AvatarCircle
- `src/db.js` — add `avatarUrl` field to friends store, add `friendActivityCache` store
- `src/App.jsx` — pass `friendsModalOpen` to control Realtime channel scoping

---

## Package A: Bandwidth & Realtime Optimization

### Task 1: Delta Sync for Friends List

**Files:**
- Modify: `src/lib/friends.js` (the `doSyncFriendsToLocal` function, ~line 227)
- Modify: `src/db.js` (add `lastFriendsSync` key-value entry)
- Test: `src/__tests__/friends.deltaSync.test.js`

The current `syncFriendsToLocal()` calls 4 RPCs and does `db.friends.clear()` + full repopulate on every open. This is wasteful — most times nothing has changed. We'll add a `lastFriendsSyncAt` timestamp to Dexie's `storageMetadata` table (already exists for quota tracking), and on subsequent syncs, only fetch rows where `created_at > lastSyncAt` OR where the friends-updated custom event has fired (indicating a Realtime change arrived).

**Important constraint:** The `get_friends` RPC doesn't support a `created_at >` filter — it returns all friends for a given status. Adding a filter parameter to the RPC would be ideal but requires a new migration. For the initial optimization, we'll use a **time-gated skip**: if less than 60 seconds have passed since the last full sync AND no `spicehub:friends-updated` event has fired, skip the sync entirely and serve from Dexie. This avoids the 4-RPC cost on rapid re-opens (user opening/closing the Friends sheet) with zero migration needed.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/friends.deltaSync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We're testing the skip-logic wrapper, not the actual Supabase calls.
// Mock the Dexie storageMetadata table.
const mockGet = vi.fn();
const mockPut = vi.fn();

vi.mock('../db', () => ({
  default: {
    storageMetadata: { get: mockGet, put: mockPut },
    friends: { toArray: vi.fn().mockResolvedValue([]) },
  },
}));

// Mock the actual sync function so we can test the skip logic
const mockDoSync = vi.fn().mockResolvedValue(undefined);

// We'll test the exported helper
import { shouldSkipFriendsSync, recordFriendsSync } from '../lib/friends';

describe('friends delta sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT skip when no previous sync exists', async () => {
    mockGet.mockResolvedValue(undefined);
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(false);
  });

  it('should skip when last sync was < 60s ago and no event fired', async () => {
    mockGet.mockResolvedValue({ key: 'lastFriendsSyncAt', value: Date.now() - 10_000 });
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(true);
  });

  it('should NOT skip when last sync was > 60s ago', async () => {
    mockGet.mockResolvedValue({ key: 'lastFriendsSyncAt', value: Date.now() - 90_000 });
    const result = await shouldSkipFriendsSync();
    expect(result).toBe(false);
  });

  it('recordFriendsSync writes timestamp to storageMetadata', async () => {
    await recordFriendsSync();
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'lastFriendsSyncAt', value: expect.any(Number) })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/friends.deltaSync.test.js`
Expected: FAIL — `shouldSkipFriendsSync` and `recordFriendsSync` not exported from `friends.js`

- [ ] **Step 3: Implement delta sync helpers in friends.js**

Add to `src/lib/friends.js` (before the existing `syncFriendsToLocal` function):

```js
import db from '../db';

const FRIENDS_SYNC_COOLDOWN_MS = 60_000; // 1 minute
let _friendsEventFiredSinceLastSync = false;

// Listen for Realtime events — when one fires, the next sync must NOT be skipped.
if (typeof window !== 'undefined') {
  window.addEventListener('spicehub:friends-updated', () => {
    _friendsEventFiredSinceLastSync = true;
  });
}

/**
 * Check whether a full friends sync can be safely skipped.
 * Skip if: (a) last sync was < 60s ago, AND (b) no Realtime event has
 * arrived since. This prevents 4 redundant RPCs when the user rapidly
 * opens/closes the Friends sheet.
 */
export async function shouldSkipFriendsSync() {
  if (_friendsEventFiredSinceLastSync) return false;
  try {
    const entry = await db.storageMetadata.get('lastFriendsSyncAt');
    if (!entry?.value) return false;
    return (Date.now() - entry.value) < FRIENDS_SYNC_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Record that a full sync just completed. */
export async function recordFriendsSync() {
  _friendsEventFiredSinceLastSync = false;
  try {
    await db.storageMetadata.put({ key: 'lastFriendsSyncAt', value: Date.now() });
  } catch { /* non-critical */ }
}
```

- [ ] **Step 4: Wire skip logic into syncFriendsToLocal**

In `src/lib/friends.js`, modify the existing `syncFriendsToLocal()`:

```js
export async function syncFriendsToLocal() {
  // Time-gated skip: avoid 4 RPCs if we just synced and nothing changed
  if (await shouldSkipFriendsSync()) {
    return;
  }
  if (syncFriendsInFlight) return syncFriendsInFlight;
  syncFriendsInFlight = doSyncFriendsToLocal().then(() => {
    return recordFriendsSync();
  }).finally(() => {
    syncFriendsInFlight = null;
  });
  return syncFriendsInFlight;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/friends.deltaSync.test.js`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```
git add src/lib/friends.js src/__tests__/friends.deltaSync.test.js
```
```
git commit -m "perf(friends): add 60s sync cooldown to skip redundant RPCs on rapid re-opens"
```

---

### Task 2: Scope Realtime Channels to Friends Modal

**Files:**
- Modify: `src/hooks/useFriendsRealtime.js`
- Modify: `src/App.jsx` (~line 200)

Currently `useFriendsRealtime` is called unconditionally in `App.jsx` line 200 — channels stay subscribed for the entire session lifetime. On the free tier this counts against the 200 concurrent connection limit. We'll gate subscription on whether the Friends sheet is open, plus a 30-second grace period after close (to catch Realtime events that arrive right after closing).

- [ ] **Step 1: Add `active` prop to useFriendsRealtime**

In `src/hooks/useFriendsRealtime.js`, the hook already accepts `{ enabled }` but it's always `true`. Change `App.jsx` to pass a smarter value.

In `src/App.jsx`, find:

```js
useFriendsRealtime({ showToast });
```

Replace with:

```js
// Scope Realtime channels: subscribe when Friends sheet is open + 30s grace.
// Keeps the channel alive briefly after close to catch late events,
// then unsubscribes to free the connection slot for other users.
const [friendsSheetOpen, setFriendsSheetOpen] = useState(false);
const [realtimeGrace, setRealtimeGrace] = useState(false);
const graceTimerRef = useRef(null);

useEffect(() => {
  if (friendsSheetOpen) {
    setRealtimeGrace(true);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
  } else {
    graceTimerRef.current = setTimeout(() => setRealtimeGrace(false), 30_000);
  }
  return () => { if (graceTimerRef.current) clearTimeout(graceTimerRef.current); };
}, [friendsSheetOpen]);

useFriendsRealtime({ showToast, enabled: realtimeGrace });
```

Then wire `setFriendsSheetOpen(true)` / `setFriendsSheetOpen(false)` to wherever the Friends sheet mounts/unmounts (it's already controlled by a state variable in App.jsx — find `showFriendsSheet` or the equivalent toggle and add the setter).

- [ ] **Step 2: Verify the Friends sheet open/close wiring**

Search App.jsx for the Friends sheet toggle state. Ensure `setFriendsSheetOpen` is called in sync. This is a manual code-reading step — the exact state variable name may differ.

- [ ] **Step 3: Test manually**

Open the app → confirm Friends sheet opens and Realtime events arrive (friend request, share received). Close the sheet → wait 30+ seconds → confirm channels are unsubscribed (check browser DevTools Network tab for WebSocket close).

- [ ] **Step 4: Commit**

```
git add src/hooks/useFriendsRealtime.js src/App.jsx
```
```
git commit -m "perf(realtime): scope friends channels to sheet lifecycle + 30s grace"
```

---

### Task 3: Cache Activity Feed in Dexie

**Files:**
- Modify: `src/db.js` — add `friendActivityCache` store
- Modify: `src/lib/friendActivity.js` — read from cache first, then delta-fetch
- Modify: `src/components/FriendActivityFeed.jsx` — show cached data instantly
- Test: `src/__tests__/friendActivity.cache.test.js`

The activity feed is online-only today (`friendActivity.js` line 11: "no Dexie cache for it"). We'll add a lightweight cache so the feed renders instantly from local data, then refreshes in the background — matching the Gemini doc's "instant UI from IndexedDB" recommendation.

- [ ] **Step 1: Add Dexie store**

In `src/db.js`, increment the version and add a cache table. Find the latest `db.version(N)` block:

```js
// vNN: Friend activity feed cache (offline-first instant load)
db.version(NN).stores({
  friendActivityCache: '++id, occurredAt',
});
```

(Replace `NN` with the next version number after the current latest.)

- [ ] **Step 2: Write the cache helpers**

Add to `src/lib/friendActivity.js`:

```js
import db from '../db';

const ACTIVITY_CACHE_KEY = 'friendActivityCachedAt';

/**
 * Load cached activity feed items from Dexie.
 * Returns [] if no cache exists — never throws.
 */
export async function getCachedActivity() {
  try {
    const items = await db.friendActivityCache
      .orderBy('occurredAt')
      .reverse()
      .limit(20)
      .toArray();
    return items;
  } catch {
    return [];
  }
}

/**
 * Replace the local activity cache with fresh items from the server.
 */
export async function cacheActivityItems(items) {
  try {
    await db.friendActivityCache.clear();
    if (items.length > 0) {
      await db.friendActivityCache.bulkPut(
        items.map((item, idx) => ({ ...item, id: idx + 1 }))
      );
    }
    await db.storageMetadata.put({ key: ACTIVITY_CACHE_KEY, value: Date.now() });
  } catch (err) {
    console.warn('[FriendActivity] cacheActivityItems error:', err.message);
  }
}
```

- [ ] **Step 3: Wire cache into FriendActivityFeed.jsx**

Modify the `load` callback in `FriendActivityFeed.jsx`:

```js
import { getFriendActivity, describeActivity, getCachedActivity, cacheActivityItems } from '../lib/friendActivity';

// Inside the component:
const load = useCallback(async () => {
  // 1. Show cached data instantly (no spinner if we have cache)
  const cached = await getCachedActivity();
  if (cached.length > 0) {
    setItems(cached);
    setLoading(false);
  }

  // 2. If offline, stop here
  if (!isOnline) { setLoading(false); return; }

  // 3. Fetch fresh from server in background
  try {
    const rows = await getFriendActivity({ limit: PAGE_SIZE });
    setItems(rows);
    setErrored(false);
    await cacheActivityItems(rows);
  } catch {
    // Only show error if we had no cached data
    if (cached.length === 0) setErrored(true);
  } finally {
    setLoading(false);
  }
}, [isOnline]);
```

- [ ] **Step 4: Write test**

Create `src/__tests__/friendActivity.cache.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockToArray = vi.fn().mockResolvedValue([]);
const mockClear = vi.fn().mockResolvedValue(undefined);
const mockBulkPut = vi.fn().mockResolvedValue(undefined);
const mockPut = vi.fn().mockResolvedValue(undefined);

vi.mock('../db', () => ({
  default: {
    friendActivityCache: {
      orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: mockToArray }) }) }),
      clear: mockClear,
      bulkPut: mockBulkPut,
    },
    storageMetadata: { put: mockPut },
  },
}));

import { getCachedActivity, cacheActivityItems } from '../lib/friendActivity';

describe('friendActivity cache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getCachedActivity returns empty array when no cache', async () => {
    mockToArray.mockResolvedValue([]);
    const items = await getCachedActivity();
    expect(items).toEqual([]);
  });

  it('getCachedActivity returns cached items', async () => {
    const cached = [{ activityType: 'friend_added', occurredAt: '2026-08-01T00:00:00Z' }];
    mockToArray.mockResolvedValue(cached);
    const items = await getCachedActivity();
    expect(items).toEqual(cached);
  });

  it('cacheActivityItems clears and repopulates', async () => {
    const items = [
      { activityType: 'share_sent', occurredAt: '2026-08-07T12:00:00Z', otherUserId: 'u1' },
    ];
    await cacheActivityItems(items);
    expect(mockClear).toHaveBeenCalledOnce();
    expect(mockBulkPut).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ activityType: 'share_sent', id: 1 })])
    );
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'friendActivityCachedAt' })
    );
  });

  it('getCachedActivity swallows errors and returns []', async () => {
    mockToArray.mockRejectedValue(new Error('Dexie borked'));
    const items = await getCachedActivity();
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/__tests__/friendActivity.cache.test.js`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```
git add src/db.js src/lib/friendActivity.js src/components/FriendActivityFeed.jsx src/__tests__/friendActivity.cache.test.js
```
```
git commit -m "perf(activity): cache friend activity feed in Dexie for instant offline load"
```

---

## Package B: Custom Avatar Upload Pipeline

### Task 4: Supabase Migration — Avatars Bucket + avatar_url Column

**Files:**
- Create: `supabase/migrations/006_avatar_storage.sql`
- Modify: `src/db.js` — add `avatarUrl` to friends store

This migration creates a public `avatars` Storage bucket with RLS policies that allow authenticated users to upload/overwrite their own avatar and anyone authenticated to read any avatar. It also adds `avatar_url` to the `profiles` table so the URL can be served alongside the existing `avatar_id` (pixel avatar ID) — both coexist, with `avatar_url` taking priority when present.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/006_avatar_storage.sql`:

```sql
-- SpiceHub 006: Custom Avatar Uploads
-- Creates a public 'avatars' Storage bucket with per-user RLS, and adds
-- avatar_url to profiles for custom photo URLs (coexists with avatar_id).
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. STORAGE BUCKET — public 'avatars'
-- ══════════════════════════════════════════════════════════════════════════════

-- Public bucket = files are readable without auth token via the public URL.
-- Saves egress vs signed URLs and lets us cache the URL in Dexie forever
-- (it never expires). File size capped at 500KB — client compresses to
-- ~50-100KB before upload, this is a server-side safety net.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  512000, -- 500KB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies on storage.objects ──────────────────────────────────────────

-- Read: any authenticated user can read any avatar (they're public anyway,
-- but this allows listing via the Storage API if ever needed).
CREATE POLICY "avatars_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- Upload/Upsert: authenticated users can only write to their own folder.
-- Path convention: avatars/{user_id}/avatar.{ext}
-- The (storage.foldername(name))[1] = auth.uid()::text check ensures users
-- can't write into another user's folder.
CREATE POLICY "avatars_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: users can delete their own avatar (to replace it).
CREATE POLICY "avatars_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. PROFILES — avatar_url column
-- ══════════════════════════════════════════════════════════════════════════════

-- Stores the public URL of the user's uploaded avatar photo. When present,
-- takes priority over avatar_id (pixel emoji avatar). Both coexist: the
-- user can clear their photo and fall back to the pixel avatar, or vice versa.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT NULL;

-- Update get_friends to also return avatar_url so friend rows carry it.
DROP FUNCTION IF EXISTS public.get_friends(text);

CREATE FUNCTION public.get_friends(for_status text DEFAULT 'accepted')
RETURNS TABLE (
  friendship_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_id text,
  avatar_url text,
  status text,
  created_at timestamptz,
  current_status jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id, p.user_id, p.username, p.display_name, p.avatar_id, p.avatar_url,
         f.status, f.created_at, p.current_status
  FROM friendships f
  JOIN profiles p ON p.user_id = CASE
    WHEN f.requester_id = auth.uid() THEN f.addressee_id
    ELSE f.requester_id
  END
  WHERE (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    AND f.status = for_status
    AND (
      for_status <> 'blocked' OR f.requester_id = auth.uid()
    )
  ORDER BY p.display_name;
$$;

REVOKE ALL ON FUNCTION public.get_friends(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_friends(text) TO authenticated;

-- Update get_friend_activity to include avatar_url.
DROP FUNCTION IF EXISTS public.get_friend_activity(int, int);

CREATE FUNCTION public.get_friend_activity(
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  activity_type text,
  occurred_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_id text,
  other_avatar_url text,
  item_type text,
  recipe_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT activity_type, occurred_at, other_user_id, other_username,
         other_display_name, other_avatar_id, other_avatar_url, item_type, recipe_name
  FROM (
    SELECT
      'friend_added'::text AS activity_type,
      f.updated_at AS occurred_at,
      CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END AS other_user_id,
      p.username AS other_username,
      p.display_name AS other_display_name,
      p.avatar_id AS other_avatar_id,
      p.avatar_url AS other_avatar_url,
      NULL::text AS item_type,
      NULL::text AS recipe_name
    FROM friendships f
    JOIN profiles p ON p.user_id = CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted'
      AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())

    UNION ALL

    SELECT
      'share_sent'::text,
      rs.created_at,
      rs.to_user_id,
      p.username,
      p.display_name,
      p.avatar_id,
      p.avatar_url,
      rs.item_type,
      rs.recipe_data->>'name'
    FROM recipe_shares rs
    JOIN profiles p ON p.user_id = rs.to_user_id
    WHERE rs.from_user_id = auth.uid()

    UNION ALL

    SELECT
      'share_received'::text,
      rs.created_at,
      rs.from_user_id,
      p.username,
      p.display_name,
      p.avatar_id,
      p.avatar_url,
      rs.item_type,
      rs.recipe_data->>'name'
    FROM recipe_shares rs
    JOIN profiles p ON p.user_id = rs.from_user_id
    WHERE rs.to_user_id = auth.uid()
  ) activity
  ORDER BY occurred_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.get_friend_activity(int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_friend_activity(int, int) TO authenticated;

-- Update search_users to also return avatar_url.
DROP FUNCTION IF EXISTS public.search_users(text);

CREATE FUNCTION public.search_users(query text)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_id text,
  avatar_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.display_name, p.avatar_id, p.avatar_url
  FROM profiles p
  WHERE p.is_searchable = true
    AND p.username IS NOT NULL
    AND p.username LIKE (query || '%')
    AND p.user_id <> auth.uid()
  ORDER BY p.username
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_users(text) FROM public;
GRANT EXECUTE ON FUNCTION public.search_users(text) TO authenticated;
```

- [ ] **Step 2: Update Dexie schema for avatar_url on friends**

In `src/db.js`, increment version and add `avatarUrl` to the friends store index (the field is already being written as a value, but we add it here so it's part of the schema declaration and searchable):

```js
// vNN: Avatar URL support on friends + activity cache
db.version(NN).stores({
  friends: 'id, otherUserId, username, displayName, avatarId, avatarUrl, status, updatedAt',
  friendActivityCache: '++id, occurredAt',
});
```

(Combine with Task 3's Dexie version bump into a single version increment if implementing in the same pass.)

- [ ] **Step 3: Update friends.js to store avatar_url from RPC**

In `src/lib/friends.js`, in `doSyncFriendsToLocal()`, the accepted-friends loop (~line 270) already maps RPC columns to Dexie fields. Add `avatarUrl`:

```js
rows.push({
  id: f.friendship_id,
  otherUserId: f.friend_id,
  username: f.username,
  displayName: f.display_name,
  avatarId: f.avatar_id,
  avatarUrl: f.avatar_url || null,   // ← NEW
  status: 'accepted',
  updatedAt: f.created_at,
  currentStatus: f.current_status || null,
});
```

Do the same for the pending-inbound and pending-outbound mapping loops.

- [ ] **Step 4: Update friendActivity.js to map avatar_url**

In `src/lib/friendActivity.js`, in `getFriendActivity()`, add to the row mapper:

```js
return (data || []).map(row => ({
  activityType: row.activity_type,
  occurredAt: row.occurred_at,
  otherUserId: row.other_user_id,
  otherUsername: row.other_username,
  otherDisplayName: row.other_display_name,
  otherAvatarId: row.other_avatar_id,
  otherAvatarUrl: row.other_avatar_url || null,   // ← NEW
  itemType: row.item_type,
  recipeName: row.recipe_name,
}));
```

- [ ] **Step 5: Update cloudProfile.js to read/write avatar_url**

In `getCloudProfile()`, add `avatar_url` to the `.select()` list. In `updateCloudProfile()`, handle `avatarUrl`:

```js
if (fields.avatarUrl !== undefined) updates.avatar_url = fields.avatarUrl;
```

- [ ] **Step 6: Commit**

```
git add supabase/migrations/006_avatar_storage.sql src/db.js src/lib/friends.js src/lib/friendActivity.js src/lib/cloudProfile.js
```
```
git commit -m "feat(avatars): add Storage bucket, avatar_url column, and RPC updates for custom photo avatars"
```

---

### Task 5: Avatar Upload Pipeline

**Files:**
- Create: `src/lib/avatarUpload.js`
- Test: `src/__tests__/avatarUpload.test.js`

Client-side compression using the existing `compressFromImageSrc` logic in `imageCompressor.js`, then upload to Supabase Storage, then update `profiles.avatar_url`. The Gemini doc recommends `browser-image-compression` but we already have a working canvas-based compressor — no new dependency needed.

- [ ] **Step 1: Write the upload module**

Create `src/lib/avatarUpload.js`:

```js
/**
 * Avatar upload pipeline — compress → upload to Supabase Storage → update profile.
 *
 * Uses the existing canvas compressor from imageCompressor.js (no new deps).
 * Target: 200x200 JPEG @ 0.8 quality → ~30-80KB per avatar.
 *
 * iOS notes:
 * - Safari doesn't support WebP canvas output — JPEG fallback is automatic
 *   via compressFromImageSrc's existing length guard.
 * - iOS photo picker preserves EXIF; modern WebKit auto-corrects orientation
 *   when drawing to canvas (Safari 13.1+), so no manual EXIF rotation needed.
 */
import { compressBlob } from '../imageCompressor';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { updateCloudProfile } from './cloudProfile';

const AVATAR_MAX_SIZE = 200;
const AVATAR_QUALITY = 0.8;
const AVATAR_FORMAT = 'image/jpeg'; // JPEG, not WebP — Safari compat

/**
 * Compress a File (from <input type="file">) to a small JPEG blob.
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, blob: Blob }>}
 */
export async function compressAvatarFile(file) {
  const dataUrl = await compressBlob(file, {
    maxWidth: AVATAR_MAX_SIZE,
    maxHeight: AVATAR_MAX_SIZE,
    quality: AVATAR_QUALITY,
    format: AVATAR_FORMAT,
  });
  if (!dataUrl) throw new Error('Image compression failed');

  // Convert data URL back to Blob for Storage upload
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return { dataUrl, blob };
}

/**
 * Upload a compressed avatar blob to Supabase Storage.
 * Path convention: avatars/{userId}/avatar.jpg
 * Returns the public URL on success.
 * @param {Blob} blob
 * @returns {Promise<string>} public URL
 */
export async function uploadAvatarToStorage(blob) {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Not signed in');

  const filePath = `${userId}/avatar.jpg`;

  // Upsert: if the file already exists, overwrite it.
  const { error } = await supabase.storage
    .from('avatars')
    .upload(filePath, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Get the public URL (bucket is public, so this never expires)
  const { data: urlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

/**
 * Full avatar update flow:
 * 1. Compress the file
 * 2. Upload to Storage
 * 3. Update profiles.avatar_url
 * Returns { dataUrl, publicUrl } for optimistic UI.
 * @param {File} file
 */
export async function updateAvatar(file) {
  const { dataUrl, blob } = await compressAvatarFile(file);
  const publicUrl = await uploadAvatarToStorage(blob);

  // Persist the public URL to the profile (+ propagate to home_group_members)
  await updateCloudProfile({ avatarUrl: publicUrl });

  return { dataUrl, publicUrl };
}

/**
 * Remove custom avatar — clears avatar_url from profile, falling back to
 * the pixel emoji avatar.
 */
export async function removeCustomAvatar() {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return;

  // Delete the file from Storage (best-effort)
  try {
    await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]);
  } catch { /* file may not exist */ }

  // Clear the URL from the profile
  await updateCloudProfile({ avatarUrl: null });
}
```

- [ ] **Step 2: Write unit tests**

Create `src/__tests__/avatarUpload.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock compressBlob
vi.mock('../imageCompressor', () => ({
  compressBlob: vi.fn().mockResolvedValue('data:image/jpeg;base64,/9j/FAKE'),
}));

// Mock fetch for data-url-to-blob conversion
const mockFetchBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(mockFetchBlob) }));

// Mock supabaseClient
const mockUpload = vi.fn().mockResolvedValue({ error: null });
const mockGetPublicUrl = vi.fn().mockReturnValue({
  data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/uid/avatar.jpg' },
});
const mockRemove = vi.fn().mockResolvedValue({ error: null });

vi.mock('../lib/supabaseClient', () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
        remove: mockRemove,
      }),
    },
  }),
  getCurrentUserId: vi.fn().mockResolvedValue('test-uid-123'),
}));

vi.mock('../lib/cloudProfile', () => ({
  updateCloudProfile: vi.fn().mockResolvedValue(undefined),
}));

import { compressAvatarFile, uploadAvatarToStorage, updateAvatar } from '../lib/avatarUpload';
import { compressBlob } from '../imageCompressor';
import { updateCloudProfile } from '../lib/cloudProfile';

describe('avatarUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('compressAvatarFile calls compressBlob with correct params', async () => {
    const fakeFile = new Blob(['test'], { type: 'image/png' });
    const result = await compressAvatarFile(fakeFile);

    expect(compressBlob).toHaveBeenCalledWith(fakeFile, {
      maxWidth: 200,
      maxHeight: 200,
      quality: 0.8,
      format: 'image/jpeg',
    });
    expect(result.dataUrl).toBe('data:image/jpeg;base64,/9j/FAKE');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('compressAvatarFile throws when compression returns null', async () => {
    compressBlob.mockResolvedValueOnce(null);
    const fakeFile = new Blob(['test'], { type: 'image/png' });
    await expect(compressAvatarFile(fakeFile)).rejects.toThrow('Image compression failed');
  });

  it('uploadAvatarToStorage uploads and returns public URL', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const url = await uploadAvatarToStorage(blob);

    expect(mockUpload).toHaveBeenCalledWith('test-uid-123/avatar.jpg', blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    expect(url).toContain('avatar.jpg');
  });

  it('uploadAvatarToStorage throws on upload error', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'Quota exceeded' } });
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    await expect(uploadAvatarToStorage(blob)).rejects.toThrow('Upload failed: Quota exceeded');
  });

  it('updateAvatar orchestrates compress → upload → profile update', async () => {
    const fakeFile = new Blob(['img'], { type: 'image/png' });
    const result = await updateAvatar(fakeFile);

    expect(compressBlob).toHaveBeenCalledOnce();
    expect(mockUpload).toHaveBeenCalledOnce();
    expect(updateCloudProfile).toHaveBeenCalledWith({
      avatarUrl: expect.stringContaining('avatar.jpg'),
    });
    expect(result.dataUrl).toBeTruthy();
    expect(result.publicUrl).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/avatarUpload.test.js`
Expected: 5 tests PASS

- [ ] **Step 4: Commit**

```
git add src/lib/avatarUpload.js src/__tests__/avatarUpload.test.js
```
```
git commit -m "feat(avatars): add client-side compress + upload pipeline for custom photo avatars"
```

---

## Package C: Avatar UI Polish

### Task 6: AvatarCircle Component

**Files:**
- Create: `src/components/AvatarCircle.jsx`
- Modify: `src/data/pixelAvatars.js` — add `getAvatarFallback()` export
- Test: `src/__tests__/avatarCircle.test.js`

A universal avatar renderer that handles the fallback chain: custom photo URL → pixel emoji → initials. Used across all 8 social surfaces. Touch-friendly (min 44px tap target for accessibility and iOS usability).

- [ ] **Step 1: Add getAvatarFallback helper**

In `src/data/pixelAvatars.js`, add:

```js
/**
 * Get the best available avatar display data.
 * Priority: avatarUrl (custom photo) > avatarId (pixel emoji) > initials.
 * @param {{ avatarUrl?: string, avatarId?: string, displayName?: string }} user
 * @returns {{ type: 'photo'|'emoji'|'initials', src?: string, emoji?: string, color?: string, initial?: string }}
 */
export function getAvatarFallback(user) {
  if (user?.avatarUrl) {
    return { type: 'photo', src: user.avatarUrl };
  }
  if (user?.avatarId) {
    const av = getAvatar(user.avatarId);
    return { type: 'emoji', emoji: av.emoji, color: av.color };
  }
  const initial = (user?.displayName || user?.username || 'M')[0].toUpperCase();
  return { type: 'initials', initial, color: 'var(--primary)' };
}
```

- [ ] **Step 2: Create AvatarCircle component**

Create `src/components/AvatarCircle.jsx`:

```jsx
/**
 * AvatarCircle — universal avatar renderer.
 * Fallback chain: custom photo URL → pixel emoji → initials letter.
 *
 * Props:
 *   avatarUrl   — custom photo URL (from Supabase Storage)
 *   avatarId    — pixel avatar ID (from pixelAvatars.js)
 *   displayName — used for initials fallback
 *   username    — used for initials fallback if no displayName
 *   size        — diameter in px (default 36, iOS min 44 for tap targets)
 *   showPresence — show green "online/recent" dot (default false)
 *   isRecent    — controls presence dot color (green if true)
 *   onClick     — optional click handler
 *   className   — optional extra class
 */
import { useState } from 'react';
import { getAvatarFallback } from '../data/pixelAvatars';

export default function AvatarCircle({
  avatarUrl, avatarId, displayName, username,
  size = 36, showPresence = false, isRecent = false,
  onClick, className = '',
}) {
  const [imgError, setImgError] = useState(false);

  // Recompute fallback when photo fails to load
  const user = {
    avatarUrl: imgError ? null : avatarUrl,
    avatarId,
    displayName,
    username,
  };
  const av = getAvatarFallback(user);

  const circleStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : undefined,
    background: av.type === 'photo' ? 'var(--surface-raised, #333)' : (av.color || 'var(--primary)'),
    border: '2px solid var(--border, rgba(255,255,255,0.1))',
  };

  const Tag = onClick ? 'button' : 'div';
  const interactiveProps = onClick ? {
    type: 'button',
    onClick,
    'aria-label': `${displayName || username || 'User'} avatar`,
    style: { ...circleStyle, padding: 0, borderStyle: 'solid' },
  } : { style: circleStyle };

  return (
    <Tag className={`avatar-circle ${className}`} {...interactiveProps}>
      {av.type === 'photo' ? (
        <img
          src={av.src}
          alt=""
          onError={() => setImgError(true)}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%',
          }}
        />
      ) : av.type === 'emoji' ? (
        <span style={{ fontSize: size * 0.55, lineHeight: 1 }} aria-hidden="true">
          {av.emoji}
        </span>
      ) : (
        <span style={{
          fontSize: size * 0.45,
          fontWeight: 700,
          color: '#fff',
          lineHeight: 1,
          userSelect: 'none',
        }}>
          {av.initial}
        </span>
      )}

      {showPresence && (
        <span
          className="avatar-presence-dot"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: Math.max(8, size * 0.25),
            height: Math.max(8, size * 0.25),
            borderRadius: '50%',
            background: isRecent ? '#4CAF50' : 'var(--text-muted)',
            border: '2px solid var(--bg, #1a1a1a)',
          }}
          aria-label={isRecent ? 'Recently active' : 'Inactive'}
        />
      )}
    </Tag>
  );
}
```

- [ ] **Step 3: Write tests**

Create `src/__tests__/avatarCircle.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { getAvatarFallback } from '../data/pixelAvatars';

describe('getAvatarFallback', () => {
  it('returns photo type when avatarUrl is present', () => {
    const result = getAvatarFallback({ avatarUrl: 'https://example.com/avatar.jpg' });
    expect(result.type).toBe('photo');
    expect(result.src).toBe('https://example.com/avatar.jpg');
  });

  it('returns emoji type when avatarId is present and no avatarUrl', () => {
    const result = getAvatarFallback({ avatarId: 'chef' });
    expect(result.type).toBe('emoji');
    expect(result.emoji).toBe('👨‍🍳');
    expect(result.color).toBe('#FF6B35');
  });

  it('returns initials type when neither avatarUrl nor avatarId', () => {
    const result = getAvatarFallback({ displayName: 'Brian' });
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('B');
  });

  it('uses username for initials when no displayName', () => {
    const result = getAvatarFallback({ username: 'gembaguru' });
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('G');
  });

  it('falls back to M when no user info at all', () => {
    const result = getAvatarFallback({});
    expect(result.type).toBe('initials');
    expect(result.initial).toBe('M');
  });

  it('avatarUrl takes priority over avatarId', () => {
    const result = getAvatarFallback({ avatarUrl: 'https://x.com/a.jpg', avatarId: 'cat' });
    expect(result.type).toBe('photo');
  });

  it('handles null/undefined user', () => {
    expect(getAvatarFallback(null).type).toBe('initials');
    expect(getAvatarFallback(undefined).type).toBe('initials');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/avatarCircle.test.js`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```
git add src/data/pixelAvatars.js src/components/AvatarCircle.jsx src/__tests__/avatarCircle.test.js
```
```
git commit -m "feat(avatars): add AvatarCircle component with photo/emoji/initials fallback chain"
```

---

### Task 7: Wire AvatarCircle into Social Surfaces

**Files:**
- Modify: `src/components/FriendsSection.jsx` — replace `avatar.emoji` with `<AvatarCircle>`
- Modify: `src/components/FriendActivityFeed.jsx` — replace `avatar.emoji` with `<AvatarCircle>`
- Modify: `src/components/ShareHistorySheet.jsx` — replace emoji avatars
- Modify: `src/components/SharedWithYouSection.jsx` — replace emoji avatars
- Modify: `src/components/SharePickerSheet.jsx` — replace emoji avatars
- Modify: `src/components/HomeGroupSection.jsx` — replace member dots

This is a search-and-replace task across 6 files. The pattern is the same in each:

**Before:**
```jsx
import { getAvatar } from '../data/pixelAvatars';
// ...
const avatar = getAvatar(item.otherAvatarId);
<span style={{ fontSize: 16 }}>{avatar.emoji}</span>
```

**After:**
```jsx
import AvatarCircle from './AvatarCircle';
// ...
<AvatarCircle
  avatarUrl={item.otherAvatarUrl || item.avatarUrl}
  avatarId={item.otherAvatarId || item.avatarId}
  displayName={item.otherDisplayName || item.displayName}
  username={item.otherUsername || item.username}
  size={28}
/>
```

- [ ] **Step 1: Update FriendActivityFeed.jsx**

In `src/components/FriendActivityFeed.jsx`:

Replace the avatar emoji span (~line 121-126):
```jsx
<span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden="true">
  {avatar.emoji}
</span>
```

With:
```jsx
<AvatarCircle
  avatarUrl={item.otherAvatarUrl}
  avatarId={item.otherAvatarId}
  displayName={item.otherDisplayName}
  username={item.otherUsername}
  size={24}
/>
```

Remove the `getAvatar` import and the `const avatar = getAvatar(...)` line. Add `import AvatarCircle from './AvatarCircle';`.

- [ ] **Step 2: Update FriendsSection.jsx**

In `src/components/FriendsSection.jsx`, find every place `getAvatar` is called for friend rows (in the friends list, search results, pending requests) and replace with `<AvatarCircle>`. Keep the `getAvatar` import for any non-avatar uses, or remove if fully replaced.

For friend rows, also add `showPresence={true}` and pass `isRecent` based on `isStatusFresh(friend.currentStatus)`:

```jsx
<AvatarCircle
  avatarUrl={friend.avatarUrl}
  avatarId={friend.avatarId}
  displayName={friend.displayName}
  username={friend.username}
  size={36}
  showPresence={true}
  isRecent={isStatusFresh(friend.currentStatus)}
/>
```

- [ ] **Step 3: Update ShareHistorySheet, SharedWithYouSection, SharePickerSheet**

Same pattern — replace emoji spans with `<AvatarCircle>` in each file. Size 28px for inline list contexts, 36px for standalone rows.

- [ ] **Step 4: Update HomeGroupSection.jsx member dots**

Replace the `pc-dot` spans with `<AvatarCircle size={28}>` for each member. This replaces the current single-character/emoji dots with the full fallback chain.

- [ ] **Step 5: Manual visual test**

Open the app → Friends sheet → verify: friend rows show photo avatars (for users who've uploaded one), pixel emoji (for users with an avatar_id), or initial letters (for users with neither). Verify the presence dot appears green for friends with a fresh "What's Cooking?" status.

Test on iOS Safari (or simulator): verify avatars render correctly, no broken image icons, presence dots positioned correctly with safe-area padding.

- [ ] **Step 6: Commit**

```
git add src/components/FriendsSection.jsx src/components/FriendActivityFeed.jsx src/components/ShareHistorySheet.jsx src/components/SharedWithYouSection.jsx src/components/SharePickerSheet.jsx src/components/HomeGroupSection.jsx
```
```
git commit -m "feat(avatars): replace emoji avatars with AvatarCircle across all social surfaces"
```

---

### Task 8: Photo Upload UX in ProfileCard

**Files:**
- Modify: `src/components/ProfileCard.jsx` — add camera icon overlay + file input

Adds a small camera icon overlay on the avatar circle in ProfileCard. Tapping it opens the native file picker (on iOS this shows Photos/Camera). The selected image is optimistically displayed via `URL.createObjectURL`, then compressed and uploaded in the background.

- [ ] **Step 1: Add photo upload to ProfileCard**

In `src/components/ProfileCard.jsx`, add the import and state:

```jsx
import { updateAvatar, removeCustomAvatar } from '../lib/avatarUpload';
import AvatarCircle from './AvatarCircle';
import { useRef, useState, useCallback } from 'react';
```

Add state for photo upload:

```jsx
const [uploading, setUploading] = useState(false);
const [optimisticUrl, setOptimisticUrl] = useState(null);
const fileInputRef = useRef(null);
```

Add the upload handler:

```jsx
const handlePhotoSelect = useCallback(async (e) => {
  const file = e.target.files?.[0];
  if (!file || !canSyncCloud) return;

  // Optimistic: show the photo immediately
  const localUrl = URL.createObjectURL(file);
  setOptimisticUrl(localUrl);
  setUploading(true);

  try {
    const { publicUrl } = await updateAvatar(file);
    setOptimisticUrl(publicUrl);
    showToast?.('Avatar updated!', 'success', 2000);
  } catch (err) {
    setOptimisticUrl(null);
    showToast?.(`Upload failed: ${err.message}`, 'error', 3000);
  } finally {
    setUploading(false);
    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
}, [canSyncCloud, showToast]);

const handleRemovePhoto = useCallback(async () => {
  if (!canSyncCloud) return;
  setOptimisticUrl(null);
  try {
    await removeCustomAvatar();
    showToast?.('Photo removed', 'info', 2000);
  } catch {
    showToast?.('Could not remove photo', 'error', 2500);
  }
}, [canSyncCloud, showToast]);
```

Replace the existing avatar button with:

```jsx
<div style={{ position: 'relative', display: 'inline-block' }}>
  <AvatarCircle
    avatarUrl={optimisticUrl || profile?.avatarUrl}
    avatarId={profile?.avatar}
    displayName={profile?.displayName}
    size={56}
    onClick={() => {
      if (canSyncCloud) {
        fileInputRef.current?.click();
      } else {
        setPickerOpen(v => !v);
      }
    }}
  />
  {canSyncCloud && (
    <span
      style={{
        position: 'absolute', bottom: -2, right: -2,
        width: 22, height: 22, borderRadius: '50%',
        background: 'var(--primary)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, border: '2px solid var(--bg)',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      {uploading ? '⏳' : '📷'}
    </span>
  )}
  {/* Hidden file input — iOS opens photo picker natively */}
  <input
    ref={fileInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp"
    onChange={handlePhotoSelect}
    style={{ display: 'none' }}
    aria-label="Upload avatar photo"
  />
</div>
```

Keep the existing pixel avatar picker as a fallback for users who aren't signed in (`!canSyncCloud`), and also show it below the photo avatar so signed-in users can still pick an emoji avatar as an alternative.

- [ ] **Step 2: iOS-specific input considerations**

Do NOT add `capture="environment"` to the file input — on iOS this forces camera-only and skips the Photo Library, which is the primary source for avatar photos. The `accept="image/*"` attribute is sufficient; iOS Safari shows a picker with Camera, Photo Library, and Browse options.

- [ ] **Step 3: Manual test on desktop + mobile**

Desktop: click avatar → file picker opens → select photo → see optimistic preview → photo uploads → toast confirms.

iOS Safari: tap avatar → iOS picker shows Camera/Photo Library/Browse → select photo → same flow. Verify no EXIF rotation issues (photo should appear right-side up).

Android Chrome: same flow, verify camera/gallery picker works.

- [ ] **Step 4: Commit**

```
git add src/components/ProfileCard.jsx
```
```
git commit -m "feat(avatars): add photo upload trigger with optimistic preview in ProfileCard"
```

---

### Task 9: Build Verification + iOS Audit

**Files:**
- (no new files — verification pass)

- [ ] **Step 1: Run full build**

```
npm run build
```

Expected: 0 errors. If `dist/` EPERM occurs, use `--outDir` to a scratch path per the known sandbox quirk (see feedback memory `sandbox_dist_eperm_quirk`).

- [ ] **Step 2: Run full test suite**

```
npx vitest run
```

Expected: all existing tests pass + new tests from this plan pass.

- [ ] **Step 3: iOS Safari audit checklist**

Manually verify on iOS Safari (device or Xcode simulator):

1. **Friends sheet opens** — no layout jump from safe-area-inset-bottom
2. **AvatarCircle renders** — photos display correctly (no broken images), emoji fallback works, initials fallback works
3. **Presence dot** — positioned correctly, doesn't clip
4. **Photo upload** — tap avatar in ProfileCard → iOS picker opens → select photo → optimistic preview appears → upload succeeds → toast confirms
5. **File input** — does NOT force camera-only (user sees Camera + Photo Library + Browse)
6. **EXIF orientation** — portrait photos display correctly (not rotated 90°)
7. **WebP fallback** — if user uploads a WebP photo, canvas compresses to JPEG (Safari < 16 doesn't support WebP canvas output)
8. **Touch targets** — avatar circles ≥ 44px in interactive contexts (ProfileCard), ≥ 28px in list contexts (acceptable for non-primary-action items per Apple HIG)
9. **Activity feed offline** — cached items render instantly when offline, no spinner

- [ ] **Step 4: Final commit (if any iOS fixes needed)**

```
git add -A
```
```
git commit -m "fix(ios): address Safari compatibility issues from avatar audit"
```

---

## Supabase Instructions Summary

### For the user to run manually (SQL Editor or `supabase db push`):

1. **First**: Apply `005_social_features_tier1.sql` if not yet done (it's been in the repo since 2026-08-06)
2. **Then**: Apply `006_avatar_storage.sql` (created in Task 4)

### What 006 does:
- Creates a public `avatars` Storage bucket (500KB file limit, JPEG/PNG/WebP only)
- Adds 4 RLS policies on `storage.objects` (read/insert/update/delete scoped to user's own folder)
- Adds `avatar_url` text column to `profiles`
- Drops and recreates `get_friends`, `get_friend_activity`, and `search_users` RPCs to include `avatar_url` in their return types

### Free-tier impact:
- Storage: avatars at ~50-80KB each, 5 users = ~400KB (negligible against 1GB quota)
- Egress: public bucket URLs are CDN-cached; Dexie caches the URL locally so repeat loads don't hit Supabase
- Realtime: channels now scoped to Friends sheet lifecycle (was: always on) — reduces concurrent connections by ~80% for typical usage patterns
