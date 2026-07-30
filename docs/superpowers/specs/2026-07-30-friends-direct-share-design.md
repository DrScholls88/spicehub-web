# Phase 2: Friends & Direct Meal/Drink Share — Design Spec

**Date:** 2026-07-30
**Status:** Approved
**Scope:** Phase 2 — Username search, friend graph, direct recipe share (meals + drinks)
**Depends on:** Phase 1 (User Profiles & Home Group, spec 2026-07-28)
**Approach:** Supabase-native (Approach A) — friend graph and share transport as Postgres tables with RLS, search via RPC function

## Overview

SpiceHub gains a social layer that lets users find friends by username and share full recipes directly — without compromising offline sovereignty. Personal libraries stay on-device. Sharing is explicit, friendship-gated, and one-shot (no automatic sync). This layer coexists cleanly with Phase 1 Home Groups: groups are household coordination, friends are one-off recipe handoffs.

**Primary use case:** Share a recipe you imported with a friend so they can save it to their own library.
**Secondary:** Build a lightweight friends list for repeated sharing.

### Non-goals (out of scope)

- Public feed / discovery of strangers' recipes
- Stories, likes, comments
- Automatic library sync between friends
- Replacing Home Groups
- Push notifications (badge + in-app toast only)
- Link-based or anonymous sharing

### Feature flag

```javascript
// Requires VITE_HOME_GROUP_ENABLED as prerequisite (Supabase Auth)
export function isFriendsEnabled() {
  return isHomeGroupEnabled() && import.meta.env.VITE_FRIENDS_ENABLED === 'true';
}
```

| Flag combo | Behavior |
|-----------|----------|
| Both off | Pure local app, no Supabase |
| Home Group on, Friends off | Phase 1 only — groups, shared plan, grocery |
| Both on | Full Phase 1 + Phase 2 friends/share |
| Friends on, Home Group off | Invalid — treated as friends-off |

All friends UI, Dexie reads, Realtime subscriptions, and share RPCs are gated behind `isFriendsEnabled()`.

---

## Section 1: Identity — Cloud Profiles & Username

### Supabase `profiles` table

```sql
create table public.profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  username            text unique
                        check (
                          username is null or (
                            username = lower(username)
                            and username ~ '^[a-z0-9_]{3,20}$'
                          )
                        ),
  display_name        text not null default '',
  avatar_id           text,
  is_searchable       boolean not null default true,
  username_changed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_profiles_username_pattern
  on public.profiles (username text_pattern_ops);
```

### Profile creation

Trigger-based — every `auth.users` row gets a `profiles` row automatically:

```sql
-- on_auth_user_created trigger → insert into profiles
-- (user_id, display_name from raw_user_meta_data)
```

Client only **updates** username, avatar, `is_searchable`. No direct client INSERT policy.

### Username rules

- `NULL` until user explicitly sets it (progressive — no username required for Home Group)
- First set is free (no cooldown)
- Subsequent changes require `username_changed_at IS NULL OR username_changed_at < now() - interval '30 days'`
- Reserved names blocked: `admin`, `support`, `spicehub`, `null`, `system`, `mod`, `moderator` (enforced in `check_username_available` RPC + CHECK or trigger)
- Username is cloud-authoritative. Local Dexie `displayName` stays for offline display. On sign-in, cloud `username` is hydrated into React context (not persisted to Dexie).

### Username availability check

Dedicated RPC (not `search_users`):

```sql
create or replace function public.check_username_available(desired text)
returns boolean
language sql security definer set search_path = public
as $$
  select not exists (
    select 1 from profiles where username = lower(trim(desired))
  )
  and lower(trim(desired)) not in (
    'admin', 'support', 'spicehub', 'null', 'system', 'mod', 'moderator'
  )
  and lower(trim(desired)) ~ '^[a-z0-9_]{3,20}$';
$$;

revoke all on function public.check_username_available(text) from public;
grant execute on function public.check_username_available(text) to authenticated;
```

Client debounces 500ms. Rate limit: 60 checks/hour per user.

### User search RPC

```sql
create or replace function public.search_users(query text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_id text
)
language sql security definer set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_id
  from public.profiles p
  where p.is_searchable = true
    and p.username is not null
    and p.user_id <> auth.uid()
    and length(trim(query)) >= 3
    and p.username ilike lower(trim(query)) || '%'
    and not exists (
      select 1 from friendships f
      where f.status = 'blocked'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = p.user_id)
          or (f.requester_id = p.user_id and f.addressee_id = auth.uid())
        )
    )
  order by
    case when p.username = lower(trim(query)) then 0 else 1 end,
    p.username
  limit 20;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;
```

Username prefix only for launch. Display-name substring search deferred behind a flag if product needs it later.

Rate limit: 30 searches/hour per user.

### RLS on `profiles`

```sql
alter table public.profiles enable row level security;

create policy "read_searchable_profiles"
  on public.profiles for select to authenticated
  using (is_searchable = true and username is not null);

create policy "read_own_profile"
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

create policy "update_own_profile"
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

Inserts come only from the auth trigger (or service role).

### Source of truth: `profiles` vs `home_group_members`

`profiles` is the source of truth for display name and avatar. When a user updates either, propagate to their `home_group_members` rows (or read via join). Two editable sources of truth must not drift.

---

## Section 2: Friend Graph

### `friendships` table

```sql
create table public.friendships (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references auth.users(id) on delete cascade,
  addressee_id   uuid not null references auth.users(id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'blocked')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

-- Enforce one row per unordered pair at DB level
create unique index idx_friendships_pair_canonical
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index idx_friendships_addressee on friendships (addressee_id, status);
create index idx_friendships_requester on friendships (requester_id, status);
```

### Mutation RPCs (all mutations go through RPCs, not direct table policies)

| RPC | Who | Does |
|-----|-----|------|
| `send_friend_request(to_user uuid)` | Me | Validate: not self, not blocked either direction, no existing row either direction, under rate limit (20/hr), `to_user` has username → insert pending |
| `accept_friend_request(friendship_id uuid)` | Addressee only | pending → accepted |
| `decline_friend_request(friendship_id uuid)` | Addressee only | Delete pending row |
| `unfriend(friendship_id uuid)` | Either party | Delete accepted row |
| `block_user(target uuid)` | Me | Delete any friendship row between pair; insert block with me as `requester_id`; auto-dismiss pending `recipe_shares` in both directions |
| `unblock_user(target uuid)` | Me | Delete block where `requester_id = me` and `addressee_id = target` |

All RPCs: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM public`, `GRANT EXECUTE TO authenticated`.

### Block semantics

- Blocker is always `requester_id` in the block row
- `block_user` auto-dismisses pending `recipe_shares`:
  ```sql
  UPDATE recipe_shares SET status = 'dismissed'
  WHERE status = 'pending'
    AND (
      (from_user_id = target AND to_user_id = auth.uid())
      OR (from_user_id = auth.uid() AND to_user_id = target)
    );
  ```
- Also delete matching Dexie rows on the blocker's device
- Settings → Blocked shows only `requester_id = me` rows (people I blocked)
- `addressee_id = me` block rows (people who blocked me) are hidden from UI
- Blocked users excluded from `search_users` (both directions)
- `send_friend_request` rejects if block exists in either direction
- Re-request after decline: allowed (row was deleted). Re-request after block: fails.

### Query RPCs

**Friends list:**

```sql
create or replace function public.get_friends(for_status text default 'accepted')
returns table (
  friendship_id uuid,
  friend_id uuid,
  username text,
  display_name text,
  avatar_id text,
  status text,
  created_at timestamptz
)
language sql security definer set search_path = public
as $$
  select f.id, p.user_id, p.username, p.display_name, p.avatar_id, f.status, f.created_at
  from friendships f
  join profiles p on p.user_id = case
    when f.requester_id = auth.uid() then f.addressee_id
    else f.requester_id
  end
  where (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and f.status = for_status
    and (
      for_status <> 'blocked' or f.requester_id = auth.uid()
    )
  order by p.display_name;
$$;
```

Note: `get_friends('blocked')` filters to `requester_id = auth.uid()` so users don't see "who blocked me."

**Pending requests (inbound):**

```sql
create or replace function public.get_pending_requests()
returns table (
  friendship_id uuid,
  from_user_id uuid,
  username text,
  display_name text,
  avatar_id text,
  created_at timestamptz
)
language sql security definer set search_path = public
as $$
  select f.id, f.requester_id, p.username, p.display_name, p.avatar_id, f.created_at
  from friendships f
  join profiles p on p.user_id = f.requester_id
  where f.addressee_id = auth.uid()
    and f.status = 'pending'
  order by f.created_at desc;
$$;
```

**Outgoing requests:** `get_friends('pending')` returns rows where `requester_id = me` (friend_id will be the addressee).

### RLS on `friendships`

No direct INSERT or UPDATE from the client role. All mutations go through `SECURITY DEFINER` RPCs that enforce rate limits, block checks, and username requirements.

```sql
alter table public.friendships enable row level security;

-- SELECT: users can read their own friendship rows
create policy "read_own_friendships"
  on friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- No INSERT policy — inserts only via send_friend_request RPC
-- No UPDATE policy — updates only via accept_friend_request / block_user RPCs
-- No DELETE policy — deletes only via decline_friend_request / unfriend / block_user RPCs
```

Block goes through `block_user()` RPC only — not through the update policy.

### Local Dexie cache

```javascript
// v23 migration
friends: 'id, otherUserId, username, displayName, avatarId, status, updatedAt'
```

Row shape:
```javascript
{
  id,             // friendships.id
  otherUserId,    // the other person's user_id
  username,       // their username
  displayName,    // their display_name
  avatarId,       // their avatar_id
  status,         // 'pending' | 'accepted' | 'blocked'
  updatedAt       // friendships.updated_at
}
```

Populated on sign-in via `get_friends()` + `get_pending_requests()`. Kept current via Realtime.

---

## Section 3: Recipe Sharing

### `recipe_shares` table

```sql
create table public.recipe_shares (
  id             uuid primary key default gen_random_uuid(),
  from_user_id   uuid not null references auth.users(id) on delete cascade,
  to_user_id     uuid not null references auth.users(id) on delete cascade,
  item_type      text not null default 'meal'
                   check (item_type in ('meal', 'drink')),
  recipe_data    jsonb not null,
  note           text default ''
                   check (length(note) <= 280),
  status         text not null default 'pending'
                   check (status in ('pending', 'saved', 'dismissed')),
  created_at     timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create index idx_recipe_shares_to_user on recipe_shares (to_user_id, status);
create index idx_recipe_shares_from_user on recipe_shares (from_user_id, created_at desc);
```

### `recipe_data` contract (full recipe copy)

Everything except private fields:

```typescript
{
  // Common
  name: string                        // required, non-empty
  imageUrl?: string                   // public URL only (isPublicUrl check)
  ingredients: string[]               // plain text list
  ingredientsStructured?: array       // Mealia-style structured ingredients
  directions?: string[]
  directionsStructured?: array        // structured directions with ingredientRefs
  servings?: number
  prepTime?: string
  cookTime?: string
  source_url?: string
  tags?: string[]
  notes?: object[]                    // [{title, text}] — recipe notes, not private annotations
  nutrition?: object
  description?: string
  recipeYield?: string

  // Attribution (set server-side, never trust client)
  from_username: string
  from_display_name: string

  // Drink-specific (when item_type = 'drink')
  spirit?: string
  glassware?: string
  garnish?: string
  method?: string                     // 'shaken', 'stirred', 'built', etc.
}
```

**Excluded from `recipe_data`:** `id` (autoincrement), `profileId`, `cookCount`, `lastCooked`, `importedAt`, `status`, `sourceHash`, `jobId`, local-only images (`data:` / `blob:` URLs filtered by `isPublicUrl`).

**Empty arrays not null:** Structured fields are `[]` when absent, not `null`, for simpler client mapping.

### Send RPC

```sql
create or replace function public.send_recipe_share(
  p_to_user_id uuid,
  p_item_type text,
  p_recipe_data jsonb,
  p_note text default ''
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  share_id uuid;
  v_username text;
  v_display_name text;
begin
  -- Validate item_type
  if p_item_type not in ('meal', 'drink') then
    raise exception 'Invalid item type';
  end if;

  -- Validate recipe_data
  if not (p_recipe_data ? 'name')
     or length(trim(p_recipe_data->>'name')) = 0 then
    raise exception 'Recipe must have a name';
  end if;

  if pg_column_size(p_recipe_data) > 100000 then
    raise exception 'Recipe data too large';
  end if;

  -- Validate note length
  if length(p_note) > 280 then
    raise exception 'Note too long (max 280 characters)';
  end if;

  -- Must be friends (accepted)
  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and (
        (requester_id = auth.uid() and addressee_id = p_to_user_id)
        or (requester_id = p_to_user_id and addressee_id = auth.uid())
      )
  ) then
    raise exception 'Not friends with this user';
  end if;

  -- Rate limit: max 50 shares per user per day
  if (
    select count(*) from recipe_shares
    where from_user_id = auth.uid()
      and created_at > now() - interval '1 day'
  ) >= 50 then
    raise exception 'Share limit reached. Try again tomorrow.';
  end if;

  -- Server-side attribution (never trust client)
  select username, display_name into v_username, v_display_name
  from profiles where user_id = auth.uid();

  p_recipe_data := p_recipe_data
    - 'from_username'
    - 'from_display_name'
    || jsonb_build_object(
         'from_username', coalesce(v_username, ''),
         'from_display_name', coalesce(v_display_name, '')
       );

  insert into recipe_shares (from_user_id, to_user_id, item_type, recipe_data, note)
  values (auth.uid(), p_to_user_id, p_item_type, p_recipe_data, p_note)
  returning id into share_id;

  return share_id;
end;
$$;

revoke all on function public.send_recipe_share(uuid, text, jsonb, text) from public;
grant execute on function public.send_recipe_share(uuid, text, jsonb, text) to authenticated;
```

### Multi-friend share

Client calls `send_recipe_share` once per selected friend. Separate rows — each recipient independently saves or dismisses. UI shows success count: "Shared with 2 of 3" on partial failure. Don't abort the whole sheet on one failure.

### Receiving side

**Save to library:**
1. Read `recipe_data` from Dexie `recipeShares` row
2. Strip attribution fields (`from_username`, `from_display_name`)
3. Add `profileId` (local), `importedAt`, `_sharedFrom: fromUsername`
4. Write to `db.meals` or `db.drinks` based on `itemType`
5. Update share row `status = 'saved'` (network call)
6. Delete local Dexie `recipeShares` row

**Save failure handling:** If network fails on step 5, keep the local meal/drink (it's already saved). Retry the status update on next online via `sharedSyncQueue` (see Section 5c). On next app open, dedupe by checking if a local meal/drink with matching `_sharedFrom` + `name` already exists before re-saving.

**Dismiss:** Update `status = 'dismissed'`. If offline, mark local Dexie row as dismissed + enqueue status update retry.

**Auto-cleanup:** pg_cron or scheduled Edge Function deletes `recipe_shares` rows older than 30 days regardless of status. Documented as Phase 2 deliverable.

### RLS on `recipe_shares`

```sql
alter table public.recipe_shares enable row level security;

create policy "read_own_shares"
  on recipe_shares for select to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "update_as_recipient"
  on recipe_shares for update to authenticated
  using (to_user_id = auth.uid())
  with check (status in ('saved', 'dismissed'));
```

Inserts go through `send_recipe_share` RPC only.

### Local Dexie cache

```javascript
// v23 migration
recipeShares: 'id, fromUserId, toUserId, itemType, status, createdAt'
```

Full row shape (includes non-indexed fields):
```javascript
{
  id,               // recipe_shares.id
  fromUserId,
  toUserId,
  itemType,         // 'meal' | 'drink'
  status,           // 'pending' | 'saved' | 'dismissed'
  createdAt,
  recipeData,       // full jsonb (for offline Save)
  note,             // sender's note
  fromUsername,      // sender's username
  fromDisplayName   // sender's display name
}
```

Populated on sign-in for `to_user_id = me AND status = 'pending'`. Badge count: `recipeShares.where({status: 'pending'}).count()`.

### Sender "Sent" history

RLS allows `from_user_id = me` reads. UI can optionally list sent shares from Supabase — no extra table needed. Note: rows are purged after 30 days.

---

## Section 4: UX

### 4a. Long-press → "Share with…" sheet

**Trigger surfaces:**
- MealLibrary tile (long-press)
- BarLibrary tile (long-press, passes `item_type: 'drink'`)
- MealDetail overflow menu (⋯)
- Expandable card overflow

**Long-press behavior change:** When `isFriendsEnabled()`, long-press opens a context menu sheet instead of immediately entering select/rearrange mode:

```
┌─────────────────────────────────────┐
│  Chicken Tikka Masala               │
│  ───────────────────────────────    │
│  📤  Share with friend…             │
│  ✏️  Select / Rearrange             │
│  🗑️  Delete                         │
│  ───────────────────────────────    │
│  Cancel                             │
└─────────────────────────────────────┘
```

When `isFriendsEnabled()` is false, long-press behavior stays exactly as today (straight into select mode). MealLibrary retains its existing non-long-press path into select/rearrange (⋯ / edit-mode button) so rearrange isn't buried behind the new context menu.

**Context menu sheet:** Framer Motion `AnimatePresence` bottom sheet, `spring` transition (`stiffness: 300, damping: 30`). Items are `motion.button` with `whileTap={{ scale: 0.97 }}`. Uses `var(--card)` background, `var(--border)` outline.

**"Share with…" picker sheet:**

```
┌─────────────────────────────────────┐
│  Share Chicken Tikka Masala         │
│  ───────────────────────────────    │
│  🔍 Search friends                  │  ← client-side filter on Dexie cache
│  ───────────────────────────────    │
│  ○ Alex          @alexcooks         │  ← pixel avatar + name + username
│  ○ Sam           @sammyeats         │  ← tap toggles checkmark
│  ───────────────────────────────    │
│  📝 Add a note (optional)  0/280    │  ← textarea with counter
│  ───────────────────────────────    │
│  [ Share (2) ]                      │  ← primary CTA, disabled when 0 selected
│  Cancel                             │
└─────────────────────────────────────┘
```

- Friend list reads from local Dexie `friends` cache (instant, offline-capable render)
- Multi-select: tap toggles checkmark. CTA updates count live.
- Search bar filters the local friends list (client-side, no RPC)
- Note field: plain text, 280 char max, counter `0/280`
- CTA disabled when 0 selected. Double-submit prevented during spinner.
- Success: checkmark scales in (`scale: [0, 1.2, 1]`, 400ms), auto-dismiss after 800ms
- Partial failure: "Shared with 2 of 3" + Retry button for failed
- **Offline:** CTA disabled, muted text "Connect to share". Sheet still opens (friends list visible).

**Empty states:**

| State | UI |
|-------|-----|
| No friends yet | "Add friends in Settings to share recipes" + link to Settings → Friends |
| All filtered out by search | "No matches" |
| No avatar for friend | Colored initial circle (same as Phase 1) |

**Framer Motion:**
- Sheet: `initial={{ y: '100%' }} animate={{ y: 0 }}` spring
- Friend rows stagger: `staggerChildren: 0.04`, each `{ opacity: 0, y: 12 } → { opacity: 1, y: 0 }`
- Checkmark toggle: `layoutId` morph on circle → check icon
- Success: checkmark `scale: [0, 1.2, 1]` over 400ms

### Design tokens (aligned to `design.md`)

| Element | Token |
|---------|-------|
| Sheet background | `var(--card)` |
| Borders | `var(--border)` |
| Primary CTA | `var(--primary)` |
| Body text | `var(--text)` |
| Muted text (username, note) | `var(--text-muted)` / `var(--text-light)` |
| Badge dot | `var(--primary)` |

### 4b. Friends section in Settings

Lives inside the existing Settings sheet, below Home Group section. Collapsed when user has no username set.

**States:**

| State | Settings content |
|-------|-----------------|
| No username set | "Set a username to connect with friends" + Set Username button |
| Username set, no friends | Search bar + "Find friends by username" prompt |
| Has friends | Search bar + Pending requests (if any) + Sent Requests (if any) + Friends list + Blocked (collapsed) |

**Set Username flow:**
- Bottom sheet with input field, live validation (3–20 chars, `[a-z0-9_]`, auto-lowercase)
- Availability check: debounced 500ms, calls `check_username_available` RPC
- Green checkmark when available, red X when taken, error for reserved names
- Confirm button disabled until valid + available
- On confirm: `UPDATE profiles SET username = ..., username_changed_at = now()`
- **Post-set bootstrap:** Immediately run friends bootstrap (fetch friends/shares + subscribe Realtime) — not deferred to next cold start

**Search + Add friend:**
- Search input at top of Friends section
- Debounced 400ms, calls `search_users` RPC
- Results: pixel avatar, display name, @username, "Add Friend" button
- "Add Friend" → `send_friend_request` → button changes to "Requested" (disabled)
- Already-friends show "Friends ✓"

**Pending requests (inbound):**
- Header: "Friend Requests (N)"
- Each card: pixel avatar, display name, @username, Accept / Decline buttons
- Accept → `accept_friend_request` → card morphs into friends list with `layoutId`
- Decline → `decline_friend_request` → card exits `{ opacity: 0, x: -20 }`

**Sent Requests (outgoing):**
- Header: "Sent Requests"
- Each card: pixel avatar, display name, @username, "Cancel" button
- Cancel deletes the pending row

**Friends list:**
- Sorted by display name
- Each row: pixel avatar, display name, @username
- Swipe-to-reveal "Unfriend" + ⋯ overflow for accessibility → Unfriend / Block
- Unfriend: confirm dialog → `unfriend()`
- Block: confirm dialog ("They won't be able to find or share with you") → `block_user()`

**Blocked (collapsed section):**
- Shows only people I blocked
- Each row: pixel avatar, @username, "Unblock" button
- Unblock → `unblock_user()` → removes row

### 4c. Inbox — MealLibrary badge + "Shared with you" section

**Badge:**
- Notification dot on MealLibrary tab icon (bottom nav)
- Color: `var(--primary)`
- Shows when `recipeShares.where({status: 'pending'}).count() > 0`
- `motion.div` with `initial={{ scale: 0 }} animate={{ scale: 1 }}` spring

**"Shared with you" section:**
- Top of MealLibrary, above category/tag bar, only when pending shares exist
- Collapsible horizontal scroll strip (existing carousel pattern)
- Cap: show 10 cards + "View all (N)" if more accumulate. Badge shows full count.

Each card:
```
┌──────────────────┐
│  [recipe image]  │
│  Chicken Tikka   │
│  from @alexcooks │
│  "Try this one!" │  ← note, if any
│  ───────────     │
│  [Save]  [✕]    │
└──────────────────┘
```

- **Save** → writes to `db.meals` / `db.drinks`, updates share status, card exits `{ opacity: 0, scale: 0.9 }`
- **Dismiss (✕)** → updates share status (or queues offline), card exits same animation
- When last card saved/dismissed → section collapses `animate={{ height: 0, opacity: 0 }}`
- Uses `var(--card)` background, `var(--border)` outline, `var(--text)` / `var(--text-muted)` tokens

**In-app toast (on Realtime INSERT):**
- Toast slides from top: "**Alex** shared **Chicken Tikka** with you"
- Pixel avatar on left, text on right
- Auto-dismiss 4s. Tap target = whole toast → navigates to MealLibrary
- `motion.div` with `initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}`, exit reverse

### 4d. Offline behavior

| Action | Online | Offline |
|--------|--------|---------|
| Search username | RPC | Disabled + "Connect to search" |
| Friend request / accept / decline / cancel | RPC | Disabled + message |
| Open Share sheet | Dexie friends | Opens (friends list visible) |
| Send share | RPC | CTA disabled + "Connect to share" |
| Save share | Local meal + status update | Local meal always; status retries online |
| Dismiss share | Status update | Local dismiss + retry online |
| Badge / inbox list | Dexie | Works |

---

## Section 5: Realtime, Sync, Migration & Safety

### 5a. Realtime subscriptions

Two channels, separate from Home Group:

```javascript
// Channel 1: Friend graph changes
supabase
  .channel('friends-graph')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'friendships',
    filter: `requester_id=eq.${userId}`,
  }, handleFriendshipChange)
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'friendships',
    filter: `addressee_id=eq.${userId}`,
  }, handleFriendshipChange)
  .subscribe();

// Channel 2: Incoming shares
supabase
  .channel('incoming-shares')
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'recipe_shares',
    filter: `to_user_id=eq.${userId}`,
  }, handleIncomingShare)
  .subscribe();
```

**`handleFriendshipChange`:**
- Idempotent apply: check if Dexie already has same `id` + `status` before writing. No naive "skip if requester is me" (breaks on inbound accepts).
- INSERT (pending, addressee = me): new inbound request → add to Dexie, toast "**Alex** sent you a friend request"
- UPDATE (accepted): friendship confirmed → update Dexie row, toast "You and **Alex** are now friends"
- DELETE: unfriend or declined → remove Dexie row, no toast (silent)

**`handleIncomingShare`:**
- Write full share row (including `recipeData`) to Dexie `recipeShares`
- Refresh badge count
- Toast: "**Alex** shared **Chicken Tikka** with you" — tap → MealLibrary

**Subscription lifecycle:**
- Subscribe when: signed in AND `isFriendsEnabled()` AND username is set
- After first username set in-session: immediately run bootstrap + subscribe (not deferred to cold start)
- Unsubscribe when: sign out or app teardown
- Independent of home group channel

### 5b. Dexie v23 migration

```javascript
db.version(23).stores({
  friends: 'id, otherUserId, username, displayName, avatarId, status, updatedAt',
  recipeShares: 'id, fromUserId, toUserId, itemType, status, createdAt',
});
// No upgrade function — tables start empty, populated on sign-in
```

Additive. All existing v22 tables unchanged. New tables exist even when flag is off but stay empty (reads gated by `isFriendsEnabled()`).

### 5c. Outbound sync for offline dismiss

Friend mutations (send, accept, decline, unfriend, block, share) require network — fail immediately with user message. Not queued offline.

**Exception: dismiss while offline.** Reuses `sharedSyncQueue`:

```javascript
{
  table: 'recipe_shares',
  action: 'update_status',
  payload: { id: shareId, status: 'dismissed' },
  homeGroupId: null,
  status: 'pending',
  // ... standard queue fields
}
```

Drain path for `recipe_shares` rows only runs when `isFriendsEnabled()` and signed in. Home Group reconnect logic must not assume every queue row is plan/grocery.

### 5d. Sign-in bootstrap (extended)

```
On successful auth:
1. linkLocalProfile(supabaseUid)              // Phase 1
2. loadMembershipAndSubscribe()               // Phase 1 (home group)
3. if isFriendsEnabled():
   a. Fetch cloud profiles row → hydrate username into React context
   b. If no username set → surface "Set username" prompt (non-blocking)
   c. If username set:
      i.  Fetch friends (get_friends + get_pending_requests) → write to Dexie
      ii. Fetch pending shares (recipe_shares, to_user_id=me, status=pending) → write to Dexie recipeShares
      iii. Subscribe to friends-graph + incoming-shares channels
```

Steps 3a–3c are additive and non-blocking on Home Group. If friends fetch fails, UI shows empty with "Refresh" option — no impact on personal library or home group.

### 5e. Rate limits (server-side, in RPCs)

| Action | Limit |
|--------|-------|
| Username search | 30/hour per user |
| Username availability check | 60/hour per user |
| Friend requests sent | 20/hour per user |
| Recipe shares sent | 50/day per user |
| Username changes | 1 per 30 days |

Map Postgres exceptions to stable client error strings for consistent UI messaging.

### 5f. Privacy and safety

**Block (end-to-end):**
1. `block_user(target)` deletes friendship row, inserts block, auto-dismisses pending shares
2. Blocked user disappears from blocker's friends list + Dexie
3. Blocker disappears from blocked user's search results (`search_users` excludes)
4. `send_friend_request` rejects if block exists either direction
5. `send_recipe_share` rejects (friendship check fails)
6. Pending shares from blocked user auto-dismissed in `block_user` RPC

**Data minimization:**
- `recipe_data` never contains `profileId`, `cookCount`, `lastCooked`, or local-only images
- Cloud `profiles` has no email, phone, or PII beyond chosen display name and username
- `is_searchable = false` removes user from search entirely
- 30-day auto-cleanup of `recipe_shares` (pg_cron or scheduled Edge Function — Phase 2 deliverable)

**RLS summary:**

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `profiles` | Own + searchable | Trigger only | Own only | — |
| `friendships` | Own rows | Via RPC | Via RPC | Via RPC |
| `recipe_shares` | Own rows (from or to) | Via RPC | Recipient only (status) | — |

### 5g. Testing requirements

1. **Friend flow:** Search → request → accept → appears in both users' lists
2. **Block:** Block a friend → disappears from list and search, can't re-request, pending shares dismissed
3. **Share meal:** Long-press → select friends → send → recipient sees badge + toast → save → appears in library as meal
4. **Share drink:** Same flow from BarLibrary → saved to `db.drinks` with drink fields
5. **Offline save:** Receive share online → go offline → Save works (local write) → come online → status updates
6. **Offline dismiss:** Dismiss offline → local Dexie updated → come online → status syncs via queue
7. **Partial failure:** Share to 3 friends, 1 fails → "Shared with 2 of 3" + retry
8. **Feature flag off:** `VITE_FRIENDS_ENABLED` absent → no friends section, no share option, no badge, no Realtime channels, no v23 table reads, no friends Realtime channels opened
9. **No username:** Signed in but no username → "Set username" prompt, can't search or be found
10. **Post-set-username:** Set username → friends bootstrap + Realtime subscribe immediately, no cold start needed
11. **Rate limits:** Exceed search/request/share limits → clear error message, no silent failure
12. **Home Group unchanged:** All Home Group Realtime + sharedSyncQueue behavior unchanged under friends flag on/off

### 5h. Acceptance criteria

1. Personal recipe libraries never leave the device unless the user explicitly taps Share
2. Sharing requires an accepted friendship — no anonymous or link-based shares
3. All friend/share mutations fail gracefully offline with clear messaging
4. Save always writes locally first (offline-safe), status update retries
5. Block is comprehensive: search, requests, shares all blocked + pending auto-dismissed
6. Feature flag off = zero friends code paths execute, zero Supabase calls, zero UI changes
7. Phase 1 Home Group Realtime, sharedSyncQueue, and all personal features are completely unchanged by Phase 2 code
8. Server-side attribution — `from_username` / `from_display_name` always set from `profiles` table, never trusted from client

---

## Coexistence with Home Groups

| Concept | Home Group (Phase 1) | Friends (Phase 2) |
|---------|----------------------|-------------------|
| Purpose | Household week plan + grocery | One-off recipe handoff |
| Discovery | Invite code | Username search |
| Data shared | Plan slot snapshots + grocery rows | Full recipe copy |
| Ongoing sync | Yes (Realtime, bidirectional) | No (one-shot share) |
| Who | Small fixed group | Explicit friend list |
| Offline mutations | Queued (sharedSyncQueue) | Not queued (except dismiss) |

A user can be in a home group **and** have friends. Sharing a meal to a friend does not put it on the group plan unless they also assign it locally.

---

## Implementation order

1. Dexie v23 migration + `isFriendsEnabled()` feature flag wiring
2. Cloud `profiles` table + auth trigger + `check_username_available` + `search_users` RPCs
3. Set Username UI (Settings)
4. `friendships` table + all 6 mutation RPCs + query RPCs
5. Friends Settings section (search, request/accept/decline, friends list, block)
6. `recipe_shares` table + `send_recipe_share` RPC
7. Long-press context menu + Share picker sheet
8. Inbox badge + "Shared with you" section in MealLibrary
9. Realtime subscriptions + toast notifications
10. Rate limits, block polish, 30-day cleanup cron
11. Testing + edge cases

---

## Out of scope (future)

- Display-name substring search (launch with username prefix only)
- Push notifications (PWA push API)
- Public recipe URLs / link-based sharing
- Social feed / discovery
- Automatic library sync between friends
- Shared bar inventory / pantry between friends
- Group recipe libraries
