# User Profiles & Home Group System — Design Spec

**Date:** 2026-07-28  
**Status:** Approved  
**Scope:** Phase 1 — Local profiles + home group with shared week plan and grocery list  

## Overview

SpiceHub gains a user profile system that preserves its offline-first sovereignty while enabling household meal-plan coordination. Each person owns their recipe library locally. The week plan and grocery list become shared via a lightweight Supabase cloud relay, with per-slot last-write-wins conflict resolution and live Realtime subscriptions.

**Primary use case:** A married couple sharing a meal plan for the week on separate phones.  
**Secondary (future):** Same profile across multiple devices (multi-device sign-in).

### Architectural decision

Supabase (free tier) as thin relay for shared data only. Auth, Realtime, and Postgres included on the free tier. Personal data never leaves the device. The app remains 100% functional without internet — cloud sync is strictly additive.

### Feature flag

The entire Home Group surface ships behind `VITE_HOME_GROUP_ENABLED`. When falsy (or absent), the Settings sheet shows no Home Group section, no Supabase client is initialized, and no sync code runs. This allows the profile data model (v22 migration) to ship and stabilize before the sharing UI is exposed.

---

## Section 1: Local Profile Data Model

### New Dexie table — `profiles` (v22)

```javascript
// profiles: 'id, supabaseUid, updatedAt'
{
  id: string,               // local UUID v4, generated once on first launch
  displayName: string,      // editable, defaults to "Me"
  avatar?: string,          // local data URL or later a Supabase Storage URL
  supabaseUid?: string,     // null until first successful sign-in
  homeGroupId?: string,     // null until joined
  dietaryPref?: object,     // migrated from localStorage (spicehub_dietary_pref)
  createdAt: string,
  updatedAt: string,
}
```

Single-row for v1. Table is keyed so multi-profile extends later without migration rework.

### Ownership stamp on existing tables

Every record in `meals`, `drinks`, `barInventory`, `cookingLog` gains a `profileId` field.

New Dexie index on meals/drinks:

```javascript
meals: '++id, name, status, sourceHash, jobId, ingredients_text, *tags, profileId'
drinks: '++id, name, profileId'
```

### Shared-data tables stay profile-agnostic

`weekPlan`, `groceryItems`, `storeMemory` do NOT get a `profileId`. They represent the household coordination layer and sync to Supabase.

### profileId coverage note (multi-profile future)

v1 stamps `profileId` on `meals`, `drinks`, `barInventory`, `cookingLog` only. The following tables remain unscoped and will require a follow-up migration if multi-profile is added later: `userTags`, `customDayTags`, `weekHistory`, `importQueue`, `batchQueue`, `importDrafts`, `ingredientAliases`, `ingredientFoods`, `ingredientUnits`. This is intentional for v1 (single local profile).

### Migration (v22)

1. Auto-create a default profile with `isDefault: true`, random UUID, `displayName: "Me"`
2. Stamp all existing meals/drinks/barInventory/cookingLog with that profile's UUID
3. Move `spicehub_dietary_pref` from localStorage into the profile record
4. **Update read/write paths:** `App.jsx`'s `loadDietaryPref()` and the dietary save in spin constraints must be updated to read from / write to the profile record instead of `localStorage.getItem('spicehub_dietary_pref')`. The old localStorage key should be deleted after successful migration to avoid stale shadow state.
5. Zero user action required — existing single-user experience is unchanged

---

## Section 2: Home Group & Supabase Schema

### `home_groups`

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
name                text NOT NULL DEFAULT 'Our Kitchen'
invite_code         text UNIQUE NOT NULL       -- 6-char UPPERCASE alphanumeric
invite_code_expires timestamptz                -- optional, e.g. now() + interval '30 days'
invite_code_uses    int DEFAULT 0
created_by          uuid REFERENCES auth.users(id)
created_at          timestamptz DEFAULT now()
```

Code stored uppercase, input normalized on join. Owner can regenerate (old code invalidated). Rate-limit join attempts via Edge Function: **10 join attempts per code per hour, 5 failed attempts per IP per hour.** Return generic "Invalid or expired code" on failure (do not leak whether the code exists).

### `home_group_members`

```sql
home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE
user_id        uuid REFERENCES auth.users(id)
display_name   text
avatar         text
role           text DEFAULT 'member'  -- 'owner' | 'member'
joined_at      timestamptz DEFAULT now()
PRIMARY KEY (home_group_id, user_id)
```

Only `role = 'owner'` can delete group or regenerate invite code. **If sole owner attempts to leave: blocked.** Must either transfer ownership to another member first, or delete the group entirely. Auto-promote is surprising for household v1.

### `shared_week_plan`

```sql
id             uuid PRIMARY KEY DEFAULT gen_random_uuid()
home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE
day_index      int NOT NULL           -- 0-6 (Mon-Sun)
slot           text NOT NULL DEFAULT 'dinner'  -- 'dinner' now; 'breakfast'/'lunch' later
slot_data      jsonb NOT NULL
updated_by     uuid REFERENCES auth.users(id)
updated_at     timestamptz DEFAULT now()
UNIQUE (home_group_id, day_index, slot)
```

### Upsert semantics

All week-plan writes use `ON CONFLICT (home_group_id, day_index, slot) DO UPDATE`. The `id` column is stable once created — the client does NOT generate a new UUID on every edit. If a row for that `(group, day, slot)` already exists, it is updated in place. This prevents duplicate logical slots.

### `slot_data` contract (strict)

```typescript
{
  name: string
  imageUrl?: string           // durable public URL only — never blob: or data:
  ingredients: string[]       // plain list for grocery generation on other devices
  servings?: number
  source_url?: string         // original import link (IG post, recipe site, etc.)
  source_profile_name: string
  source_profile_id?: string  // local UUID of owner (attribution)
  is_special?: boolean        // true for day tags
  special_tag?: string        // '__eat_out__', '__custom_12__', etc.
  // NO directions, notes, full nutrition, or private fields
}
```

**Image strategy (v1 — deferred Storage upload):** If the recipe's only image is a local `data:` URL or `blob:` URL, **omit `imageUrl` from `slot_data`** entirely. The receiving device sees the meal name and ingredients but no photo. Supabase Storage upload is deferred to a future phase — it introduces bucket setup, RLS, compression, and failure handling that would bloat Phase 1. Public URLs (e.g., from Instagram CDN or recipe sites) are passed through as-is.

### `shared_grocery_items`

```sql
id             uuid PRIMARY KEY DEFAULT gen_random_uuid()
home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE
name           text NOT NULL
quantity       text DEFAULT ''       -- "2", "1 lb", etc. (flexible string)
unit           text DEFAULT ''
store          text DEFAULT ''
checked        boolean DEFAULT false
sort_order     int DEFAULT 0
added_by       uuid REFERENCES auth.users(id)
checked_by     uuid REFERENCES auth.users(id)
updated_at     timestamptz DEFAULT now()
```

Index: `(home_group_id, checked, sort_order)` for fast list rendering.

### `shared_recipe_transfers`

```sql
id             uuid PRIMARY KEY DEFAULT gen_random_uuid()
home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE
recipe_data    jsonb NOT NULL          -- full recipe minus private fields (cookCount, lastCooked)
from_user      uuid REFERENCES auth.users(id)
to_user        uuid                    -- null = available to any group member
created_at     timestamptz DEFAULT now()
claimed_at     timestamptz             -- set when receiver saves; row deleted after
```

RLS: same membership gate as other shared tables. Ephemeral — claimed rows are deleted immediately; unclaimed rows are deleted after 7 days (Supabase cron or edge function).

### Cascade deletes

`ON DELETE CASCADE` from `home_groups` → members, week plan, grocery, recipe transfers. Group deletion wipes all shared data.

### Row-Level Security (all shared tables)

```sql
CREATE POLICY "members_read_plan"
  ON shared_week_plan FOR SELECT
  USING (home_group_id IN (
    SELECT home_group_id FROM home_group_members
    WHERE user_id = auth.uid()
  ));

CREATE POLICY "members_write_plan"
  ON shared_week_plan FOR ALL
  USING (home_group_id IN (
    SELECT home_group_id FROM home_group_members
    WHERE user_id = auth.uid()
  ))
  WITH CHECK (home_group_id IN (
    SELECT home_group_id FROM home_group_members
    WHERE user_id = auth.uid()
  ));
```

Same pattern for `shared_grocery_items` and `home_group_members`. Test the "user leaves group → immediately loses access" path.

### Realtime subscriptions

```javascript
supabase
  .channel(`home:${homeGroupId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'shared_week_plan',
    filter: `home_group_id=eq.${homeGroupId}`
  }, handler)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'shared_grocery_items',
    filter: `home_group_id=eq.${homeGroupId}`
  }, handler)
  .subscribe()
```

Never subscribe to the whole table — always filter by `home_group_id`.

### Invite flow

Owner creates group → gets a 6-char code → shares it (text, verbally). Second person enters code → joins group. Auto-join for household v1; approval flow can be added later.

---

## Section 3: Auth Flow & Profile Lifecycle

### Progressive auth — three states

1. **Unauthenticated (default):** App boots into a local-only profile. No Supabase connection. All features work exactly as today.
2. **Authenticated, no group:** User signed in via Supabase Auth (Google or magic link) when they tapped Create/Join. Local profile's `supabaseUid` is now populated. App still functions identically offline.
3. **Authenticated + in group:** Shared tables sync bidirectionally with Supabase. Realtime subscription is active. Local Dexie copies serve as the offline cache.

### State machine

```
App launch
  └─ has valid Supabase session?
        ├─ no  → State 1 (local only)
        └─ yes → link profile (idempotent) → has membership?
                      ├─ no  → State 2 (auth'd, no group)
                      └─ yes → State 3 + subscribe to Realtime

User taps Create / Join
  └─ if State 1 → trigger Auth → on success → State 2 → proceed with action
```

### Silent session restore on cold start

```javascript
// On app boot (after Dexie is ready)
const { data: { session } } = await supabase.auth.getSession()
if (session?.user) {
  await linkLocalProfile(session.user.id)     // idempotent
  await loadMembershipAndSubscribe()           // if in a group → state 3
}
```

Users who signed in last week should not re-authenticate on tab reopen.

### Linking rules (local UUID ↔ supabaseUid)

- First successful sign-in writes `supabaseUid` onto the existing local profile
- Subsequent sign-ins with the same Supabase user are no-ops (already linked)
- Sign-in with a different Supabase account: blocked, requires explicit "Switch account"
- Cross-device: local UUID is device-scoped. `auth.users.id` is the stable cloud identity. Membership lookup always uses `auth.users.id`, never local UUID

### Sign-out semantics

| Data | On sign-out |
|------|-------------|
| Local profile + personal library | Untouched |
| Local copy of shared week plan / grocery | Kept as read-only snapshot |
| Realtime subscription | Torn down |
| `supabaseUid` on local profile | Kept (makes re-sign-in faster) |
| Ability to push changes | Disabled until re-auth |

### Reconciliation after re-sign-in

- Pull latest shared week plan + grocery from Supabase
- Compare `updated_at` with local snapshot
- Last-write-wins for v1 — no three-way merges
- Lightweight toast if remote data is newer: "Updated shared plan from [member name]"

### Network failure during auth

- Create / Join buttons show clear offline state when `!isOnline`
- Disabled with messaging: "Connect to the internet to create a group"
- Never leave profile in half-linked state — write `supabaseUid` only after successful Auth response

### Magic link / deep-link handling

- Pure PWA: magic links land on a URL, standard browser flow
- Capacitor builds: must claim the link via Universal Links (iOS) / App Links (Android)
- Test full flow on iOS home-screen PWA and Capacitor builds

### Auth redirect URLs (must be configured in Supabase dashboard)

| Context | Redirect URL |
|---------|-------------|
| Local dev | `http://localhost:5173/auth/callback` |
| Vercel production | `https://<your-domain>/auth/callback` |
| Vercel preview | `https://<project>-*.vercel.app/auth/callback` |
| Capacitor iOS | `com.spicehub.app://auth/callback` (Universal Link) |
| Capacitor Android | `com.spicehub.app://auth/callback` (App Link) |

The `/auth/callback` route must be handled client-side: parse the token from the URL hash/query, call `supabase.auth.exchangeCodeForSession()` (for PKCE) or let the SDK auto-handle (for implicit), then redirect to the Settings sheet. For Capacitor, register the custom scheme in `capacitor.config.ts` and the native deep-link handlers.

### Sign-in trigger points

Auth never triggers on app launch. Appears only when user takes an action requiring cloud identity: creating a group, joining via invite code, or (future) enabling multi-device sync.

### Security checklist (non-negotiable)

- RLS enforces membership even if a malicious client forges `supabaseUid`
- Never trust local profile's `supabaseUid` for server-side auth — always `auth.uid()`
- Invite-code join rate-limited (Edge Function or Supabase rate limits)
- After leave/sign-out, Realtime channels fully unsubscribed

---

## Section 4: Sync Engine

### New Dexie tables (v22)

```javascript
// Distinct from importQueue / batchQueue
sharedSyncQueue: '++id, table, status, createdAt, clientMutationId'
// {
//   id: autoincrement,
//   table: 'shared_week_plan' | 'shared_grocery_items',
//   action: 'upsert' | 'delete',
//   payload: object,
//   clientMutationId: string,   // UUID at write time — critical for dedupe
//   homeGroupId: string,        // for multi-group future + leave-group cleanup
//   status: 'pending' | 'syncing' | 'failed' | 'done',
//   attempts: number,
//   lastError?: string,
//   createdAt: string,
// }

// Lightweight sync metadata for debugging + "last synced" UI
sharedMeta: 'homeGroupId'
// { homeGroupId, lastFullSyncAt, lastRealtimeEventAt }
```

### Group-create bootstrap

When the owner creates a home group, the current local week plan and grocery list are pushed as the initial shared state. This prevents the partner from joining an empty plan.

1. On successful group creation, read local `weekPlan` (Array(7)) and `groceryItems`
2. Map each non-null week slot to a `shared_week_plan` row using the week-plan mapper (below)
3. Map each grocery item to a `shared_grocery_items` row using the grocery mapper (below)
4. Push all rows to Supabase in a single batch
5. Subscribe to Realtime

If the local plan is empty, that's fine — the shared plan starts empty too.

### Week-plan mapper (local ↔ cloud)

**Local → cloud (outbound):**

```javascript
// Local weekPlan[dayIndex] is one of: meal object, special-day object, or null
function toSlotData(localSlot, profileName) {
  if (!localSlot) return null  // no row for empty slots
  
  // Special day tag
  if (localSlot.id && localSlot.id.startsWith('__')) {
    return {
      name: localSlot.name,
      ingredients: [],
      source_profile_name: profileName,
      is_special: true,
      special_tag: localSlot.id,
    }
  }
  
  // Real meal
  return {
    name: localSlot.name,
    imageUrl: isPublicUrl(localSlot.imageUrl) ? localSlot.imageUrl : undefined,
    ingredients: (localSlot.ingredients || []).map(i => typeof i === 'string' ? i : i.name || ''),
    servings: localSlot.servings,
    source_url: localSlot.link || undefined,  // original import URL if available
    source_profile_name: profileName,
    source_profile_id: localSlot.profileId,
    is_special: false,
  }
}
```

**Cloud → local (inbound):**

```javascript
// Supabase row → local weekPlan slot
function fromSlotData(row) {
  if (row.slot_data.is_special) {
    return {
      id: row.slot_data.special_tag,
      name: row.slot_data.name,
      icon: SPECIAL_TAG_ICONS[row.slot_data.special_tag] || '🏷️',
    }
  }
  return {
    name: row.slot_data.name,
    imageUrl: row.slot_data.imageUrl,
    ingredients: row.slot_data.ingredients,
    servings: row.slot_data.servings,
    link: row.slot_data.source_url,             // for "Import to my library"
    _sharedBy: row.slot_data.source_profile_name,
    _updatedBy: row.updated_by,
    _updatedAt: row.updated_at,
    _isSharedSlot: true,                         // marks as plan-only until imported
  }
}
```

WeekView continues to read/write the local `weekPlan` array. The sync layer is the only code that talks to Supabase.

### Shared slot behavior (plan-only vs. full recipe)

**A shared slot does NOT create a meal in the receiver's library.** The slot_data snapshot is plan-only: name, ingredients list, image, and attribution. CookMode / MealDetail only open if a matching local recipe exists (by name lookup in `db.meals`); otherwise the slot renders as a read-only plan card.

**Two ways for a group member to get the full recipe into their own library:**

1. **Linked import (source_url present):** If the original recipe was imported from a URL (Instagram, recipe site, etc.), the slot card shows an "Import to My Library" button. Tapping it kicks off the existing import engine (`executeUrlImport`) with the `source_url` — the receiver gets their own full copy with directions, notes, nutrition, and all structured data. Once imported, the slot automatically links to the local recipe and CookMode / MealDetail become available.

2. **Full share (no link / manually created recipe):** If the recipe has no `source_url` (it was manually entered or the link was lost), the assigning user can explicitly "Share full recipe" from the slot's overflow menu. This serializes the complete local recipe (including directions, notes, structured ingredients — everything except private fields like cookCount/lastCooked) into a one-time payload pushed to a `shared_recipe_transfers` row in Supabase. The receiver sees a "Save to My Library" prompt; on accept, the full recipe is written to their local `db.meals` and the transfer row is deleted.

The `shared_recipe_transfers` Supabase table (defined in Section 2 schema) stores these one-time payloads. Transfer rows are ephemeral — deleted after claim or after 7 days.

**UX on the receiving device:**

- Slot card shows meal name, image (if public URL), ingredients list, and "Added by [name]"
- If `source_url` exists: "Import to My Library" button (runs import engine)
- If a full-share transfer exists for this recipe: "Save to My Library" button (instant local save)
- If neither: plan-only card with ingredients list (still useful for grocery generation)
- Once the recipe exists in the local library (by either path): CookMode, MealDetail, and all local features work normally

### Assign-to-slot behavior

When a user assigns a meal to a week-plan slot (existing WeekView UX):
1. Local `weekPlan[dayIndex]` is updated (existing behavior, unchanged)
2. `saveWeekPlan()` writes to Dexie (existing behavior, unchanged)
3. **New:** If in a group, `toSlotData()` creates the snapshot and enqueues a `sharedSyncQueue` upsert for `shared_week_plan` with key `(homeGroupId, dayIndex, 'dinner')`
4. Queue drains immediately if online, or on reconnect

### Grocery field mapping (local ↔ cloud)

| Local (Dexie `groceryItems`) | Cloud (`shared_grocery_items`) | Notes |
|------------------------------|-------------------------------|-------|
| `id` (autoincrement) | — | Local only |
| `cloudId` (UUID, new field) | `id` (UUID PK) | Generated client-side on first push |
| `name` | `name` | Direct |
| `checked` / `isChecked` | `checked` | Normalize to `checked` |
| `store` | `store` | Direct |
| — | `quantity` | New cloud field; local can adopt or derive from name |
| — | `unit` | New cloud field; same |
| — | `sort_order` | Reordering pushes updated `sort_order` values |
| — | `added_by` | Set to `auth.uid()` on push |
| — | `checked_by` | Set to `auth.uid()` on check |
| — | `updated_at` | Server-managed |

Inbound items from other members are inserted into local Dexie with a `cloudId` for future correlation. Reorder operations push `sort_order` changes for all affected items (debounced 500ms).

### Grocery ID mapping (local autoincrement ↔ cloud UUID)

- On first push of a new grocery item, generate a UUID client-side, store on local record as `cloudId`, send as Supabase row `id`
- All subsequent updates/deletes use `cloudId`
- Inbound Realtime events applied by matching `cloudId` (or create local row if missing)
- Never let Supabase generate the ID for locally-originated items

### Outbound sync (local → cloud)

1. Write to Dexie immediately (UI updates instantly)
2. Enqueue a `sharedSyncQueue` item with a fresh `clientMutationId`
3. If online, drain queue:
   - Week plan: push per-slot upserts (small table, immediate)
   - Grocery check/uncheck: debounce 300ms, then push
   - Grocery add/delete: push immediately
4. If offline, queue accumulates. On reconnect, drain in order
5. `clientMutationId` dedupes rapid taps or double online events

### Cold-start ordering (critical)

```
On entering State 3 (or app boot while in group):
1. Inspect sharedSyncQueue for pending items
2. If queue has pending items for this group:
   - Push them first
3. Fetch full cloud state (shared_week_plan + shared_grocery_items)
4. Apply cloud state to local Dexie, but do NOT overwrite
   any row that still has a pending outbound mutation for the same key
5. Open the Realtime subscription for incremental updates
```

### Conflict clock

- Server `updated_at` is the sole conflict clock (no client `Date.now()` comparison)
- Overwrite local only if `remote.updated_at > local.updated_at`
- Identical timestamps: prefer remote version (deterministic)

### Inbound Realtime handler

```typescript
onPayload(payload) {
  if (payload.new?.updated_by === currentUserId) return  // echo
  const { eventType, new: row, old } = payload
  if (eventType === 'DELETE') {
    applyLocalDelete(row || old)
  } else {
    applyLocalUpsert(row)  // respects updated_at rule
  }
  // Notify React (context/event/setState)
}
```

Handler must be pure and fast — no network calls inside it.

### Failure surface

After 3 failed attempts:
- Mark queue item `failed`
- Non-blocking toast: "Some changes couldn't sync — will retry."
- Local change preserved
- Manual "Retry sync" in Home Group section of Settings
- Never block UI or force conflict resolution

### Sign-out / leave-group queue disposition

Discard all pending `sharedSyncQueue` items for that group on leave/sign-out. The user left; unsent changes should not surprise remaining members later.

### Sync invariants (non-negotiable)

1. Local Dexie is always readable and writable, even when queue is full or Supabase is down
2. Personal tables never appear in `sharedSyncQueue` or Realtime filters
3. Every outbound mutation carries a `clientMutationId`
4. Inbound events never overwrite a row with a pending outbound mutation for the same key
5. After sign-out, queue for that group is discarded

---

## Section 5: UI/UX

### Settings state matrix

| State | Settings content |
|-------|-----------------|
| Local only (never signed in) | Create / Join buttons |
| Signed in, no group | Create / Join + "Signed in as [email]" + Sign out |
| In group | Group name + role, invite code, member list, Leave, Sign out |
| Offline + in group | Same as in-group + muted "Changes will sync when online" |

Create/Join buttons are never hidden behind a sign-in wall. Tapping them triggers Auth only if needed.

### Create flow (bottom sheet inside Settings)

1. Optional name field (default "Our Kitchen")
2. Tap Create → Auth if needed → group appears with invite code
3. Immediate "Copy invite code" affordance + "Share this code with anyone in your household"

### Join flow (bottom sheet inside Settings)

1. 6-character input (auto-uppercase, auto-advance, paste-friendly)
2. Tap Join → Auth if needed → success toast + member list updates

Both flows stay inside the Settings sheet context.

### Invite code UX

- Display as `XK9P2M` (no dashes for 6 chars)
- Copy button shows 1.5s "Copied" state
- Regenerate requires confirm: "Old code will stop working"
- After regenerate, auto-copy new code

### Attribution (non-intrusive)

- Week plan: 16-20px pixel avatar or colored initial in slot corner. Only shown when `updated_by !== current user`
- Grocery: muted "Alex" text on trailing side, matching existing store label style
- Uses `--text-muted` / `--text-light` tokens, size ≤ 18px
- Must not compete with meal image/title

### Status indicator (single region)

| Condition | Display |
|-----------|---------|
| Offline | Existing offline treatment + "Will sync when online" |
| Online + Realtime connected | Small cloud-check icon |
| Online + Realtime disconnected / reconnecting | Subtle amber cloud or spinner |

### Leave group (destructive)

Confirmation sheet:

```
Leave "Our Kitchen"?

Your personal recipes stay on this device.
Shared week plan and grocery list will no longer update.

[Cancel]  [Leave group]
```

On leave: tear down Realtime, discard pending `sharedSyncQueue` items, keep last local snapshot as read-only.

### Pixel avatars

- Ship 8-12 fixed pixel faces/heads, consistent with BarShelf pixel-art style
- Stored as avatar id on local profile and `home_group_members`
- Fallback: colored initial circle

### Realtime toast copy

- "Alex updated Wednesday"
- "Alex checked off milk"
- "Alex added 4 items to the list"
- Never technical language

### Unchanged screens (confirmed)

MealLibrary, BarLibrary, PantryMode, BarShelf, CookMode, MixMode, ImportSheet, Discover, Landing, MealSpinner, StoreMode. No profile avatar or "switch profile" in any of these in v1.

### UX risks

| Risk | Mitigation |
|------|-----------|
| User creates group, never shares code | Surface code prominently post-create, offer "Copy & share" |
| Two members with same display name | Show role or short suffix only if needed |
| Attribution badge reduces meal card contrast | Use `--text-muted`, ≤ 18px, test both themes |
| Settings sheet becomes long | Home Group as collapsible section, collapsed when not in a group |

---

## Section 6: Offline Behavior & Edge Cases

### Reconnect sequence (ironclad order)

```
When useOnlineStatus flips to online while in a group (debounced 1-2s):
1. Attempt token refresh (Supabase SDK)
2. If refresh fails → non-blocking re-auth prompt, stop
3. Drain sharedSyncQueue (respecting clientMutationId / attempts)
4. Full fetch of shared_week_plan + shared_grocery_items
5. Apply remote state without clobbering any still-pending local keys
6. Open Realtime subscription
7. Clear "will sync when online" badge
```

### Leave group while offline

- User may Leave while offline
- On Leave: tear down local Realtime state, discard all `sharedSyncQueue` items for that `homeGroupId`, keep last local snapshot as read-only for the current session
- When device comes online: do NOT push discarded items
- Personal library untouched

### Partial queue drain failures

- Successful items → `done`, deleted after push (or 24h grace for debugging)
- Failed items → increment attempts, keep in queue
- Single toast: "Some changes couldn't sync — will retry."
- Never roll back local Dexie writes that already succeeded

### Rapid online/offline flapping

- `useOnlineStatus` already debounces offline by 2s
- Debounce drain + resubscribe work (1-2s after online event) to prevent hammering Supabase

### Clock skew

- Server `updated_at` is the sole conflict clock
- Overwrite local only if `remote.updated_at > local.updated_at`
- Never compare against client `Date.now()`

### Auth token revoked / user deleted while offline

- Local profile and personal library remain fully usable forever
- Only group features stay paused until the user signs in again

### Supabase free-tier pause

- Keep-alive via GitHub Actions scheduled workflow (cron: `0 8 * * *`): one `curl` to a Supabase Edge Function that runs `SELECT 1` and returns 200
- The workflow file (`.github/workflows/supabase-keepalive.yml`) and the Edge Function are part of Phase 1 deliverables — not tribal knowledge
- Cold-start UX: loading treatment on shared surfaces only; personal screens stay instant

### Storage & queue hygiene

- `sharedSyncQueue` items marked `done`: deleted after successful push (or 24h grace)
- Queue length capped at 200 items. If exceeded: drop oldest `done`/`failed` first; never drop `pending`
- Existing `storageManager` / quota checks remain sufficient

### Two devices, same user (out of scope, documented)

v1 is single local profile per device. If the same Supabase user signs in on a second device, each has its own local library. Shared week/grocery syncs; personal recipes do not. Intentional for v1.

### Testing requirements

1. Airplane mode: create/edit shared plan → reconnect → verify sync
2. Kill app while offline with pending queue → reopen → verify queue drains
3. Two devices offline editing same slot → reconnect both → verify last-write-wins
4. Token expiry while offline → reconnect → verify re-auth prompt
5. Supabase cold start → verify loading state, no error
6. Leave group while offline with pending queue → come online → confirm nothing pushed, no errors
7. Online → edit → immediately offline → kill app → reopen offline → reopen online → queue drains correctly
8. Realtime connected → airplane mode → edit → back online → single drain, no duplicate toasts
9. Supabase project manually paused → shared surfaces show brief loading, personal library instant, then recover

### Acceptance criteria

1. With network disabled, every personal feature works exactly as today
2. Shared week plan and grocery remain editable offline; changes appear after reconnect without user intervention
3. Create / Join are impossible offline and explain why
4. No code path clears or overwrites personal Dexie tables because of a sync event
5. After Leave (online or offline), the user's personal library is byte-for-byte unchanged

---

## Out of Scope (Future Phases)

- Multi-device sign-in (same profile across devices)
- Multi-profile on a single device (profile switcher)
- Selective recipe sharing (contributing specific recipes to group)
- E2E encryption for shared data
- P2P / local network sync (WebRTC, QR codes)
- Real-time collaborative editing (beyond last-write-wins)
- Shared bar inventory / pantry
- Role-based permissions beyond owner/member
- Supabase Storage for recipe image upload (v1 omits non-public images from slot_data)
- QR-code invite flow
- Presence indicators (who's viewing the plan right now)
- Multi-slot days (breakfast/lunch/dinner) — schema supports it, UI deferred
- `profileId` on `userTags`, `customDayTags`, `weekHistory`, `importQueue`, `batchQueue`, etc. (needed for multi-profile only)
