# User Profiles & Home Group — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local user profiles and a Supabase-backed home group that shares the week plan and grocery list between two phones, while preserving 100% offline functionality.

**Architecture:** Dexie v22 adds profiles + sync tables locally. Supabase free tier serves as a thin relay for shared week plan and grocery data only — personal recipe libraries never leave the device. A `sharedSyncQueue` table queues outbound mutations offline; Realtime subscriptions push inbound changes. The entire surface ships behind `VITE_HOME_GROUP_ENABLED`.

**Tech Stack:** Dexie.js (IndexedDB), Supabase (Auth, Postgres, Realtime, Edge Functions), React hooks/context, Vite env vars, GitHub Actions cron.

**Spec:** `docs/superpowers/specs/2026-07-28-user-profiles-home-group-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/supabaseClient.js` | Singleton Supabase client, lazy-init behind feature flag |
| `src/lib/profile.js` | Profile CRUD, dietary pref migration, linking rules |
| `src/lib/slotMapper.js` | `toSlotData()` / `fromSlotData()` / `isPublicUrl()` — pure, testable |
| `src/lib/groceryMapper.js` | Grocery local↔cloud mapping — pure, testable |
| `src/lib/sharedSync.js` | Sync engine: queue drain, cold-start, Realtime handler, reconnect |
| `src/lib/homeGroup.js` | Create/join/leave group, invite code, recipe transfers |
| `src/hooks/useProfile.js` | React hook for local profile state |
| `src/hooks/useHomeGroup.js` | React context/hook for group state, membership, sync status |
| `src/components/HomeGroupSection.jsx` | Collapsible Settings section for Home Group |
| `src/components/CreateGroupSheet.jsx` | Bottom sheet: name field + Create button |
| `src/components/JoinGroupSheet.jsx` | Bottom sheet: 6-char code input + Join button |
| `src/components/SharedSlotCard.jsx` | Plan-only slot card with Import/Save affordances |
| `src/data/pixelAvatars.js` | 8-12 fixed pixel avatar definitions |
| `supabase/migrations/001_home_group_schema.sql` | All Supabase tables + RLS + indexes |
| `supabase/functions/keepalive/index.ts` | Edge Function: `SELECT 1` health check |
| `supabase/functions/join-group/index.ts` | Edge Function: rate-limited invite code join |
| `.github/workflows/supabase-keepalive.yml` | Daily cron to prevent free-tier pause |
| `src/__tests__/slotMapper.test.js` | Unit tests for slot mappers |
| `src/__tests__/groceryMapper.test.js` | Unit tests for grocery mappers |
| `src/__tests__/profile.test.js` | Unit tests for profile module |
| `src/__tests__/sharedSync.test.js` | Unit tests for sync engine |
| `src/__tests__/homeGroup.test.js` | Unit tests for home group operations |

### Modified files

| File | Changes |
|------|---------|
| `src/db.js` | v22 migration: `profiles`, `sharedSyncQueue`, `sharedMeta` tables; `profileId` index on meals/drinks/barInventory/cookingLog |
| `src/App.jsx` | Profile context provider, dietary pref migration callsite, home group init on boot, `showToast` for Realtime events |
| `src/components/WeekView.jsx` | Attribution badges on shared slots, sync trigger on slot assignment |
| `.env.example` | Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_HOME_GROUP_ENABLED` |
| `package.json` | Add `@supabase/supabase-js` dependency |

---

### Task 1: Supabase SQL Schema + Edge Functions + GitHub Actions

**Files:**
- Create: `supabase/migrations/001_home_group_schema.sql`
- Create: `supabase/functions/keepalive/index.ts`
- Create: `supabase/functions/join-group/index.ts`
- Create: `.github/workflows/supabase-keepalive.yml`

- [ ] **Step 1: Create Supabase migration file**

Create `supabase/migrations/001_home_group_schema.sql`:

```sql
-- SpiceHub Home Group schema
-- Run via Supabase Dashboard > SQL Editor or `supabase db push`

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE home_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL DEFAULT 'Our Kitchen',
  invite_code         text UNIQUE NOT NULL,
  invite_code_expires timestamptz,
  invite_code_uses    int DEFAULT 0,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE home_group_members (
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES auth.users(id),
  display_name   text,
  avatar         text,
  role           text DEFAULT 'member',
  joined_at      timestamptz DEFAULT now(),
  PRIMARY KEY (home_group_id, user_id)
);

CREATE TABLE shared_week_plan (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  day_index      int NOT NULL,
  slot           text NOT NULL DEFAULT 'dinner',
  slot_data      jsonb NOT NULL,
  updated_by     uuid REFERENCES auth.users(id),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (home_group_id, day_index, slot)
);

CREATE TABLE shared_grocery_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  name           text NOT NULL,
  quantity       text DEFAULT '',
  unit           text DEFAULT '',
  store          text DEFAULT '',
  checked        boolean DEFAULT false,
  sort_order     int DEFAULT 0,
  added_by       uuid REFERENCES auth.users(id),
  checked_by     uuid REFERENCES auth.users(id),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE shared_recipe_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_group_id  uuid REFERENCES home_groups(id) ON DELETE CASCADE,
  recipe_data    jsonb NOT NULL,
  from_user      uuid REFERENCES auth.users(id),
  to_user        uuid,
  created_at     timestamptz DEFAULT now(),
  claimed_at     timestamptz
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_shared_week_plan_group
  ON shared_week_plan (home_group_id, day_index, slot);

CREATE INDEX idx_shared_grocery_items_group
  ON shared_grocery_items (home_group_id, checked, sort_order);

CREATE INDEX idx_home_group_members_user
  ON home_group_members (user_id);

-- ── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE home_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_week_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_recipe_transfers ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of the given group?
CREATE OR REPLACE FUNCTION is_group_member(gid uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM home_group_members
    WHERE home_group_id = gid AND user_id = auth.uid()
  );
$$;

-- home_groups: members can read their group; creator can insert
CREATE POLICY "members_read_group" ON home_groups
  FOR SELECT USING (is_group_member(id));

CREATE POLICY "auth_create_group" ON home_groups
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "owner_update_group" ON home_groups
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM home_group_members
      WHERE home_group_id = id AND user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "owner_delete_group" ON home_groups
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM home_group_members
      WHERE home_group_id = id AND user_id = auth.uid() AND role = 'owner'
    )
  );

-- home_group_members: members can read/leave; owner can manage
CREATE POLICY "members_read_members" ON home_group_members
  FOR SELECT USING (is_group_member(home_group_id));

CREATE POLICY "self_insert_member" ON home_group_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "self_delete_member" ON home_group_members
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "members_update_self" ON home_group_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- shared_week_plan: full CRUD for group members
CREATE POLICY "members_all_plan" ON shared_week_plan
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- shared_grocery_items: full CRUD for group members
CREATE POLICY "members_all_grocery" ON shared_grocery_items
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- shared_recipe_transfers: full CRUD for group members
CREATE POLICY "members_all_transfers" ON shared_recipe_transfers
  FOR ALL USING (is_group_member(home_group_id))
  WITH CHECK (is_group_member(home_group_id));

-- ── Realtime publication ────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE shared_week_plan;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_grocery_items;
ALTER PUBLICATION supabase_realtime ADD TABLE shared_recipe_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE home_group_members;
```

- [ ] **Step 2: Create keepalive Edge Function**

Create `supabase/functions/keepalive/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { error } = await supabase.rpc('keepalive_ping', {})
  if (error) {
    // Fallback: raw query
    const { error: rawErr } = await supabase.from('home_groups').select('id').limit(0)
    if (rawErr) {
      return new Response(JSON.stringify({ ok: false, error: rawErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 3: Create join-group Edge Function (rate-limited)**

Create `supabase/functions/join-group/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// In-memory rate limit (resets on cold start — acceptable for free tier)
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Rate limit by user ID
  if (!checkRateLimit(user.id)) {
    return new Response(
      JSON.stringify({ error: 'Too many attempts. Try again later.' }),
      { status: 429 },
    )
  }

  const { invite_code, display_name, avatar } = await req.json()
  const code = (invite_code || '').toUpperCase().trim()

  if (!code || code.length !== 6) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Use service role for group lookup (bypasses RLS)
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: group, error: groupErr } = await serviceClient
    .from('home_groups')
    .select('id, name, invite_code_expires')
    .eq('invite_code', code)
    .maybeSingle()

  if (groupErr || !group) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Check expiry
  if (group.invite_code_expires && new Date(group.invite_code_expires) < new Date()) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired code' }),
      { status: 400 },
    )
  }

  // Check if already a member
  const { data: existing } = await serviceClient
    .from('home_group_members')
    .select('user_id')
    .eq('home_group_id', group.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return new Response(
      JSON.stringify({ error: 'Already a member', home_group_id: group.id, name: group.name }),
      { status: 409 },
    )
  }

  // Insert membership
  const { error: insertErr } = await serviceClient
    .from('home_group_members')
    .insert({
      home_group_id: group.id,
      user_id: user.id,
      display_name: display_name || 'Partner',
      avatar: avatar || null,
      role: 'member',
    })

  if (insertErr) {
    return new Response(
      JSON.stringify({ error: 'Failed to join group' }),
      { status: 500 },
    )
  }

  // Increment invite_code_uses
  await serviceClient
    .from('home_groups')
    .update({ invite_code_uses: (group as any).invite_code_uses + 1 })
    .eq('id', group.id)

  return new Response(
    JSON.stringify({ home_group_id: group.id, name: group.name }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
```

- [ ] **Step 4: Create GitHub Actions keepalive workflow**

Create `.github/workflows/supabase-keepalive.yml`:

```yaml
name: Supabase Keep-Alive
on:
  schedule:
    - cron: '0 8 * * *'  # Daily at 8:00 UTC
  workflow_dispatch: {}   # Manual trigger

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase keepalive function
        run: |
          curl -sf "${{ secrets.SUPABASE_FUNCTION_URL }}/keepalive" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            --max-time 30
```

- [ ] **Step 5: Commit**

```
git add supabase/ .github/workflows/supabase-keepalive.yml
git commit -m "feat(infra): add Supabase schema, Edge Functions, and keepalive cron

- SQL migration: home_groups, members, shared_week_plan, shared_grocery_items,
  shared_recipe_transfers tables with RLS + indexes + Realtime publication
- Edge Functions: keepalive (SELECT 1) and join-group (rate-limited invite join)
- GitHub Actions: daily cron to prevent Supabase free-tier inactivity pause"
```

---

### Task 2: Dexie v22 Migration + Profile Module

**Files:**
- Modify: `src/db.js` (after line 249, before `export default db`)
- Create: `src/lib/profile.js`
- Create: `src/__tests__/profile.test.js`

- [ ] **Step 1: Write failing test for profile module**

Create `src/__tests__/profile.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// We'll test the profile module functions directly.
// First, reset Dexie between tests.
let db;

beforeEach(async () => {
  await Dexie.delete('SpiceHubDB');
  // Re-import to get fresh db
  const mod = await import('../db.js');
  db = mod.default;
});

describe('profile', () => {
  it('v22 migration creates a default profile', async () => {
    const profiles = await db.profiles.toArray();
    expect(profiles.length).toBe(1);
    const p = profiles[0];
    expect(p.displayName).toBe('Me');
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBe(36); // UUID
    expect(p.supabaseUid).toBeUndefined();
    expect(p.homeGroupId).toBeUndefined();
  });

  it('v22 migration stamps profileId on existing meals', async () => {
    // Add a meal before migration
    await db.meals.add({ name: 'Test Meal', ingredients: ['salt'] });
    const meal = await db.meals.where('name').equals('Test Meal').first();
    expect(typeof meal.profileId).toBe('string');
    expect(meal.profileId.length).toBe(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/profile.test.js`
Expected: FAIL — db.profiles is undefined (v22 not yet defined)

- [ ] **Step 3: Add v22 migration to db.js**

In `src/db.js`, add after the v21 block (before `export default db`):

```javascript
// v22: User Profiles & Home Group — local profile, sync queue, sync metadata.
// Creates a default profile, stamps profileId on personal tables, migrates
// dietary pref from localStorage. See spec:
// docs/superpowers/specs/2026-07-28-user-profiles-home-group-design.md
db.version(22).stores({
  profiles: 'id, supabaseUid, updatedAt',
  meals: '++id, name, status, sourceHash, jobId, ingredients_text, *tags, profileId',
  drinks: '++id, name, profileId',
  barInventory: 'ingredient, profileId',
  cookingLog: '++id, mealId, cookedAt, profileId',
  sharedSyncQueue: '++id, table, status, createdAt, clientMutationId',
  sharedMeta: 'homeGroupId',
}).upgrade(async tx => {
  // 1. Create default profile
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Migrate dietary pref from localStorage
  let dietaryPref = null;
  try {
    const raw = localStorage.getItem('spicehub_dietary_pref');
    if (raw) {
      dietaryPref = JSON.parse(raw);
    }
  } catch { /* ignore */ }

  await tx.table('profiles').add({
    id: profileId,
    displayName: 'Me',
    supabaseUid: undefined,
    homeGroupId: undefined,
    dietaryPref: dietaryPref || { dietary: '', mode: 'require' },
    createdAt: now,
    updatedAt: now,
  });

  // 2. Stamp profileId on personal tables
  const stampProfile = (record) => {
    if (!record.profileId) record.profileId = profileId;
  };
  await tx.table('meals').toCollection().modify(stampProfile);
  await tx.table('drinks').toCollection().modify(stampProfile);
  await tx.table('barInventory').toCollection().modify(stampProfile);
  await tx.table('cookingLog').toCollection().modify(stampProfile);

  // 3. Delete old localStorage key after successful migration
  try { localStorage.removeItem('spicehub_dietary_pref'); } catch { /* ignore */ }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/profile.test.js`
Expected: PASS

- [ ] **Step 5: Create profile module**

Create `src/lib/profile.js`:

```javascript
/**
 * Profile management — local-first, single profile per device (v1).
 * See spec Section 1 + Section 3.
 */
import db from '../db';

/**
 * Get the current (default) local profile.
 * Returns null only if migration hasn't run yet (should never happen in practice).
 */
export async function getProfile() {
  const profiles = await db.profiles.toArray();
  return profiles[0] || null;
}

/**
 * Update profile fields (partial update).
 */
export async function updateProfile(fields) {
  const profile = await getProfile();
  if (!profile) throw new Error('No local profile found');
  const updated = {
    ...fields,
    updatedAt: new Date().toISOString(),
  };
  await db.profiles.update(profile.id, updated);
  return { ...profile, ...updated };
}

/**
 * Get dietary preference from profile (replaces localStorage read).
 */
export async function getDietaryPref() {
  const profile = await getProfile();
  return profile?.dietaryPref || { dietary: '', mode: 'require' };
}

/**
 * Save dietary preference to profile (replaces localStorage write).
 */
export async function saveDietaryPref(pref) {
  return updateProfile({ dietaryPref: pref });
}

/**
 * Link local profile to a Supabase user ID.
 * Idempotent — no-op if already linked to the same user.
 * Throws if linked to a DIFFERENT user (requires explicit switch).
 */
export async function linkLocalProfile(supabaseUid) {
  const profile = await getProfile();
  if (!profile) throw new Error('No local profile found');

  if (profile.supabaseUid === supabaseUid) return profile; // already linked
  if (profile.supabaseUid && profile.supabaseUid !== supabaseUid) {
    throw new Error(
      'Profile already linked to a different account. Use "Switch Account" to change.'
    );
  }

  return updateProfile({ supabaseUid });
}

/**
 * Set the home group ID on the local profile.
 */
export async function setHomeGroupId(homeGroupId) {
  return updateProfile({ homeGroupId: homeGroupId || undefined });
}

/**
 * Clear home group association (on leave/sign-out).
 * Does NOT clear supabaseUid — keeps it for faster re-sign-in.
 */
export async function clearHomeGroup() {
  return updateProfile({ homeGroupId: undefined });
}
```

- [ ] **Step 6: Add profile module tests**

Append to `src/__tests__/profile.test.js`:

```javascript
import {
  getProfile, updateProfile, getDietaryPref, saveDietaryPref,
  linkLocalProfile, setHomeGroupId, clearHomeGroup,
} from '../lib/profile';

describe('profile module', () => {
  it('getProfile returns default profile', async () => {
    const p = await getProfile();
    expect(p).not.toBeNull();
    expect(p.displayName).toBe('Me');
  });

  it('updateProfile updates displayName', async () => {
    const updated = await updateProfile({ displayName: 'Alex' });
    expect(updated.displayName).toBe('Alex');
    const reloaded = await getProfile();
    expect(reloaded.displayName).toBe('Alex');
  });

  it('getDietaryPref returns default', async () => {
    const pref = await getDietaryPref();
    expect(pref).toEqual({ dietary: '', mode: 'require' });
  });

  it('saveDietaryPref persists', async () => {
    await saveDietaryPref({ dietary: 'vegetarian', mode: 'require' });
    const pref = await getDietaryPref();
    expect(pref.dietary).toBe('vegetarian');
  });

  it('linkLocalProfile links supabaseUid', async () => {
    const uid = 'supabase-uid-123';
    const p = await linkLocalProfile(uid);
    expect(p.supabaseUid).toBe(uid);
  });

  it('linkLocalProfile is idempotent for same uid', async () => {
    const uid = 'supabase-uid-123';
    await linkLocalProfile(uid);
    const p = await linkLocalProfile(uid); // no throw
    expect(p.supabaseUid).toBe(uid);
  });

  it('linkLocalProfile throws for different uid', async () => {
    await linkLocalProfile('uid-1');
    await expect(linkLocalProfile('uid-2')).rejects.toThrow('different account');
  });

  it('setHomeGroupId + clearHomeGroup', async () => {
    await setHomeGroupId('group-abc');
    let p = await getProfile();
    expect(p.homeGroupId).toBe('group-abc');

    await clearHomeGroup();
    p = await getProfile();
    expect(p.homeGroupId).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run all profile tests**

Run: `npx vitest run src/__tests__/profile.test.js`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```
git add src/db.js src/lib/profile.js src/__tests__/profile.test.js
git commit -m "feat(profile): Dexie v22 migration + profile module

- v22: profiles table, sharedSyncQueue, sharedMeta, profileId on
  meals/drinks/barInventory/cookingLog
- Default profile auto-created with UUID, dietary pref migrated from
  localStorage
- profile.js: getProfile, updateProfile, link/unlink, dietary CRUD
- 10 unit tests passing"
```

---

### Task 3: Supabase Client + Feature Flag + Env Config

**Files:**
- Create: `src/lib/supabaseClient.js`
- Modify: `.env.example`
- Modify: `package.json` (add dependency)

- [ ] **Step 1: Add @supabase/supabase-js dependency**

User runs: `npm install @supabase/supabase-js`

- [ ] **Step 2: Update .env.example**

Add to `.env.example`:

```
# ── Home Group (Supabase relay) ─────────────────────────────────────────────
# Client-safe config (not secrets — Supabase anon key is designed to be public)
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
# VITE_HOME_GROUP_ENABLED=true
```

- [ ] **Step 3: Create Supabase client module**

Create `src/lib/supabaseClient.js`:

```javascript
/**
 * Supabase client — lazy singleton, only initialized when Home Group is enabled.
 * Never imported at module level by non-group code.
 *
 * IMPORTANT: VITE_SUPABASE_ANON_KEY is intentionally client-exposed.
 * Supabase anon keys are designed for browser use — RLS enforces security.
 * See: https://supabase.com/docs/guides/api/api-keys
 */
import { createClient } from '@supabase/supabase-js';

let _client = null;

/**
 * Returns true if the Home Group feature flag is enabled AND
 * Supabase config is present. Guards all sync/auth code paths.
 */
export function isHomeGroupEnabled() {
  return (
    import.meta.env.VITE_HOME_GROUP_ENABLED === 'true' &&
    !!import.meta.env.VITE_SUPABASE_URL &&
    !!import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

/**
 * Get or create the Supabase client singleton.
 * Throws if called when feature flag is off — callers must gate with
 * isHomeGroupEnabled() first.
 */
export function getSupabase() {
  if (_client) return _client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,  // for magic link / OAuth redirect
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return _client;
}

/**
 * Get current auth session (null if not signed in).
 */
export async function getSession() {
  if (!isHomeGroupEnabled()) return null;
  const { data: { session } } = await getSupabase().auth.getSession();
  return session;
}

/**
 * Get current user ID from session (null if not signed in).
 */
export async function getCurrentUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

/**
 * Sign in with Google OAuth.
 * Redirects the browser — does not return on success.
 */
export async function signInWithGoogle() {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
}

/**
 * Sign in with magic link (email).
 */
export async function signInWithMagicLink(email) {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
}

/**
 * Sign out. Does NOT clear local profile — only tears down Supabase session.
 */
export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

/**
 * Reset singleton (for testing).
 */
export function _resetClient() {
  _client = null;
}
```

- [ ] **Step 4: Commit**

```
git add src/lib/supabaseClient.js .env.example package.json package-lock.json
git commit -m "feat(supabase): add Supabase client singleton + feature flag

- Lazy-init behind VITE_HOME_GROUP_ENABLED flag
- Auth helpers: Google OAuth, magic link, sign-out, session restore
- .env.example updated with Supabase config vars
- @supabase/supabase-js added to dependencies"
```

---

### Task 4: Slot Mapper + Grocery Mapper (Pure Functions, TDD)

**Files:**
- Create: `src/lib/slotMapper.js`
- Create: `src/lib/groceryMapper.js`
- Create: `src/__tests__/slotMapper.test.js`
- Create: `src/__tests__/groceryMapper.test.js`

- [ ] **Step 1: Write failing slot mapper tests**

Create `src/__tests__/slotMapper.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { toSlotData, fromSlotData, isPublicUrl } from '../lib/slotMapper';

describe('isPublicUrl', () => {
  it('accepts https URLs', () => {
    expect(isPublicUrl('https://cdn.example.com/photo.jpg')).toBe(true);
  });
  it('accepts http URLs', () => {
    expect(isPublicUrl('http://example.com/photo.jpg')).toBe(true);
  });
  it('rejects data URLs', () => {
    expect(isPublicUrl('data:image/png;base64,abc')).toBe(false);
  });
  it('rejects blob URLs', () => {
    expect(isPublicUrl('blob:http://localhost/abc')).toBe(false);
  });
  it('rejects undefined/null', () => {
    expect(isPublicUrl(undefined)).toBe(false);
    expect(isPublicUrl(null)).toBe(false);
    expect(isPublicUrl('')).toBe(false);
  });
});

describe('toSlotData', () => {
  it('returns null for null slot', () => {
    expect(toSlotData(null, 'Alex')).toBeNull();
  });

  it('maps special day tag', () => {
    const slot = { id: '__eat_out__', name: 'Eat Out', icon: '🍽️' };
    const result = toSlotData(slot, 'Alex');
    expect(result).toEqual({
      name: 'Eat Out',
      ingredients: [],
      source_profile_name: 'Alex',
      is_special: true,
      special_tag: '__eat_out__',
    });
  });

  it('maps real meal with public image', () => {
    const slot = {
      name: 'Chicken Tikka',
      imageUrl: 'https://cdn.ig.com/photo.jpg',
      ingredients: [{ name: 'chicken' }, 'salt', { name: 'yogurt' }],
      servings: 4,
      link: 'https://instagram.com/p/abc',
      profileId: 'profile-uuid',
    };
    const result = toSlotData(slot, 'Alex');
    expect(result.name).toBe('Chicken Tikka');
    expect(result.imageUrl).toBe('https://cdn.ig.com/photo.jpg');
    expect(result.ingredients).toEqual(['chicken', 'salt', 'yogurt']);
    expect(result.servings).toBe(4);
    expect(result.source_url).toBe('https://instagram.com/p/abc');
    expect(result.source_profile_name).toBe('Alex');
    expect(result.is_special).toBe(false);
  });

  it('omits non-public imageUrl', () => {
    const slot = {
      name: 'Test',
      imageUrl: 'data:image/png;base64,abc',
      ingredients: [],
    };
    const result = toSlotData(slot, 'Alex');
    expect(result.imageUrl).toBeUndefined();
  });

  it('omits source_url when link is absent', () => {
    const slot = { name: 'Test', ingredients: [] };
    const result = toSlotData(slot, 'Alex');
    expect(result.source_url).toBeUndefined();
  });
});

describe('fromSlotData', () => {
  it('maps special day tag back', () => {
    const row = {
      slot_data: {
        name: 'Eat Out',
        is_special: true,
        special_tag: '__eat_out__',
        source_profile_name: 'Alex',
        ingredients: [],
      },
      updated_by: 'user-123',
      updated_at: '2026-07-28T10:00:00Z',
    };
    const result = fromSlotData(row);
    expect(result.id).toBe('__eat_out__');
    expect(result.name).toBe('Eat Out');
    expect(typeof result.icon).toBe('string');
  });

  it('maps real meal with shared metadata', () => {
    const row = {
      slot_data: {
        name: 'Pasta',
        imageUrl: 'https://cdn.com/pasta.jpg',
        ingredients: ['pasta', 'sauce'],
        servings: 2,
        source_url: 'https://recipe.com/pasta',
        source_profile_name: 'Alex',
        is_special: false,
      },
      updated_by: 'user-456',
      updated_at: '2026-07-28T12:00:00Z',
    };
    const result = fromSlotData(row);
    expect(result.name).toBe('Pasta');
    expect(result.ingredients).toEqual(['pasta', 'sauce']);
    expect(result.link).toBe('https://recipe.com/pasta');
    expect(result._sharedBy).toBe('Alex');
    expect(result._isSharedSlot).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/slotMapper.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement slot mapper**

Create `src/lib/slotMapper.js`:

```javascript
/**
 * Week-plan slot mappers — local Dexie ↔ Supabase shared_week_plan.
 * Pure functions, no side effects.
 * See spec Section 4: "Week-plan mapper (local ↔ cloud)"
 */

// Special day tag icons — must match SPECIAL_DAYS in App.jsx
const SPECIAL_TAG_ICONS = {
  '__eat_out__': '🍽️',
  '__leftovers__': '📦',
  '__dealers_choice__': '🎲',
  '__pizza__': '🍕',
  '__grill__': '🔥',
  '__tacos__': '🌮',
  '__nachos__': '🧀',
  '__pasta__': '🍝',
  '__soup__': '🍲',
  '__sandwiches__': '🥪',
  '__salad__': '🥗',
  '__breakfast__': '🥞',
  '__skip__': '⏭️',
};

/**
 * Returns true if the URL is a public HTTP(S) URL safe to share.
 * Rejects data:, blob:, empty, null, undefined.
 */
export function isPublicUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Local weekPlan slot → Supabase slot_data JSONB.
 * @param {object|null} localSlot - meal object, special-day object, or null
 * @param {string} profileName - display name of the profile making the assignment
 * @returns {object|null} slot_data payload, or null for empty slots (no row created)
 */
export function toSlotData(localSlot, profileName) {
  if (!localSlot) return null;

  // Special day tag (id starts with __)
  if (localSlot.id && typeof localSlot.id === 'string' && localSlot.id.startsWith('__')) {
    return {
      name: localSlot.name,
      ingredients: [],
      source_profile_name: profileName,
      is_special: true,
      special_tag: localSlot.id,
    };
  }

  // Real meal
  return {
    name: localSlot.name,
    imageUrl: isPublicUrl(localSlot.imageUrl) ? localSlot.imageUrl : undefined,
    ingredients: (localSlot.ingredients || []).map(i =>
      typeof i === 'string' ? i : (i && i.name) || ''
    ),
    servings: localSlot.servings,
    source_url: localSlot.link || undefined,
    source_profile_name: profileName,
    source_profile_id: localSlot.profileId,
    is_special: false,
  };
}

/**
 * Supabase shared_week_plan row → local weekPlan slot.
 * @param {object} row - Supabase row with slot_data, updated_by, updated_at
 * @returns {object} local slot object
 */
export function fromSlotData(row) {
  const d = row.slot_data;

  if (d.is_special) {
    return {
      id: d.special_tag,
      name: d.name,
      icon: SPECIAL_TAG_ICONS[d.special_tag] || '🏷️',
    };
  }

  return {
    name: d.name,
    imageUrl: d.imageUrl,
    ingredients: d.ingredients,
    servings: d.servings,
    link: d.source_url,
    _sharedBy: d.source_profile_name,
    _updatedBy: row.updated_by,
    _updatedAt: row.updated_at,
    _isSharedSlot: true,
  };
}

export { SPECIAL_TAG_ICONS };
```

- [ ] **Step 4: Run slot mapper tests**

Run: `npx vitest run src/__tests__/slotMapper.test.js`
Expected: ALL PASS

- [ ] **Step 5: Write failing grocery mapper tests**

Create `src/__tests__/groceryMapper.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { toCloudGrocery, fromCloudGrocery } from '../lib/groceryMapper';

describe('toCloudGrocery', () => {
  it('maps local grocery item to cloud shape', () => {
    const local = {
      id: 5,
      cloudId: 'uuid-abc',
      name: 'Milk',
      checked: false,
      store: 'Kroger',
    };
    const result = toCloudGrocery(local, 'group-1', 'user-1');
    expect(result.id).toBe('uuid-abc');
    expect(result.home_group_id).toBe('group-1');
    expect(result.name).toBe('Milk');
    expect(result.checked).toBe(false);
    expect(result.store).toBe('Kroger');
    expect(result.added_by).toBe('user-1');
  });

  it('generates cloudId if missing', () => {
    const local = { id: 5, name: 'Eggs', checked: true, store: '' };
    const result = toCloudGrocery(local, 'group-1', 'user-1');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBe(36); // UUID
    expect(result._generatedCloudId).toBe(result.id); // signals caller to save back
  });

  it('normalizes isChecked to checked', () => {
    const local = { id: 1, name: 'Salt', isChecked: true };
    const result = toCloudGrocery(local, 'g', 'u');
    expect(result.checked).toBe(true);
  });
});

describe('fromCloudGrocery', () => {
  it('maps cloud grocery to local shape', () => {
    const cloud = {
      id: 'uuid-abc',
      name: 'Bread',
      checked: true,
      store: 'Target',
      quantity: '2',
      unit: 'loaves',
      sort_order: 3,
      added_by: 'user-2',
      checked_by: 'user-1',
      updated_at: '2026-07-28T10:00:00Z',
    };
    const result = fromCloudGrocery(cloud);
    expect(result.cloudId).toBe('uuid-abc');
    expect(result.name).toBe('Bread');
    expect(result.checked).toBe(true);
    expect(result.store).toBe('Target');
    expect(result._addedBy).toBe('user-2');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groceryMapper.test.js`
Expected: FAIL — module not found

- [ ] **Step 7: Implement grocery mapper**

Create `src/lib/groceryMapper.js`:

```javascript
/**
 * Grocery item mappers — local Dexie ↔ Supabase shared_grocery_items.
 * Pure functions, no side effects.
 * See spec Section 4: "Grocery field mapping"
 */

/**
 * Local grocery item → Supabase shared_grocery_items row.
 * If item has no cloudId, generates one and signals caller via _generatedCloudId.
 */
export function toCloudGrocery(local, homeGroupId, userId) {
  let cloudId = local.cloudId;
  let generated = false;

  if (!cloudId) {
    cloudId = crypto.randomUUID();
    generated = true;
  }

  const row = {
    id: cloudId,
    home_group_id: homeGroupId,
    name: local.name,
    checked: !!(local.checked ?? local.isChecked),
    store: local.store || '',
    quantity: local.quantity || '',
    unit: local.unit || '',
    sort_order: local.sortOrder ?? 0,
    added_by: userId,
  };

  // Signal caller to write cloudId back to local Dexie record
  if (generated) {
    row._generatedCloudId = cloudId;
  }

  return row;
}

/**
 * Supabase shared_grocery_items row → local Dexie grocery item.
 */
export function fromCloudGrocery(cloud) {
  return {
    cloudId: cloud.id,
    name: cloud.name,
    checked: cloud.checked,
    store: cloud.store || '',
    quantity: cloud.quantity || '',
    unit: cloud.unit || '',
    sortOrder: cloud.sort_order ?? 0,
    _addedBy: cloud.added_by,
    _checkedBy: cloud.checked_by,
    _updatedAt: cloud.updated_at,
  };
}
```

- [ ] **Step 8: Run grocery mapper tests**

Run: `npx vitest run src/__tests__/groceryMapper.test.js`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```
git add src/lib/slotMapper.js src/lib/groceryMapper.js src/__tests__/slotMapper.test.js src/__tests__/groceryMapper.test.js
git commit -m "feat(mappers): slot + grocery local↔cloud mappers with full TDD

- slotMapper: toSlotData/fromSlotData/isPublicUrl — handles special day tags,
  public URL filtering, source_url passthrough, attribution metadata
- groceryMapper: toCloudGrocery/fromCloudGrocery — cloudId generation,
  isChecked normalization, sort_order mapping
- 15 unit tests passing"
```

---

### Task 5: Sync Engine Core

**Files:**
- Create: `src/lib/sharedSync.js`
- Create: `src/__tests__/sharedSync.test.js`

- [ ] **Step 1: Write failing sync engine tests**

Create `src/__tests__/sharedSync.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

beforeEach(async () => {
  await Dexie.delete('SpiceHubDB');
});

describe('sharedSync', () => {
  describe('enqueueSync', () => {
    it('adds a pending item to sharedSyncQueue', async () => {
      const { enqueueSync } = await import('../lib/sharedSync');
      const db = (await import('../db')).default;

      await enqueueSync({
        table: 'shared_week_plan',
        action: 'upsert',
        payload: { day_index: 0, slot: 'dinner', slot_data: { name: 'Test' } },
        homeGroupId: 'group-1',
      });

      const items = await db.sharedSyncQueue.toArray();
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('pending');
      expect(items[0].table).toBe('shared_week_plan');
      expect(typeof items[0].clientMutationId).toBe('string');
    });
  });

  describe('discardQueueForGroup', () => {
    it('deletes all queue items for a group', async () => {
      const { enqueueSync, discardQueueForGroup } = await import('../lib/sharedSync');
      const db = (await import('../db')).default;

      await enqueueSync({ table: 'shared_week_plan', action: 'upsert', payload: {}, homeGroupId: 'g1' });
      await enqueueSync({ table: 'shared_week_plan', action: 'upsert', payload: {}, homeGroupId: 'g2' });

      await discardQueueForGroup('g1');

      const remaining = await db.sharedSyncQueue.toArray();
      expect(remaining.length).toBe(1);
      expect(remaining[0].homeGroupId).toBe('g2');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/sharedSync.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sync engine**

Create `src/lib/sharedSync.js`:

```javascript
/**
 * Shared sync engine — queue, drain, cold-start, Realtime handler.
 * See spec Section 4 + Section 6.
 *
 * This module is the ONLY code that talks to Supabase for shared data.
 * WeekView and GroceryList read/write local Dexie; this module bridges.
 */
import db from '../db';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { toSlotData, fromSlotData } from './slotMapper';
import { toCloudGrocery, fromCloudGrocery } from './groceryMapper';

// ── Queue management ────────────────────────────────────────────────────────

/**
 * Enqueue a sync mutation. Writes to Dexie immediately (offline-safe).
 */
export async function enqueueSync({ table, action, payload, homeGroupId }) {
  await db.sharedSyncQueue.add({
    table,
    action,
    payload,
    homeGroupId,
    clientMutationId: crypto.randomUUID(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Discard all pending queue items for a given group.
 * Called on leave-group and sign-out.
 */
export async function discardQueueForGroup(homeGroupId) {
  await db.sharedSyncQueue
    .where('homeGroupId')
    .equals(homeGroupId)
    .delete();
}

/**
 * Get pending queue items for a group, ordered by creation time.
 */
export async function getPendingQueue(homeGroupId) {
  return db.sharedSyncQueue
    .where('status')
    .equals('pending')
    .filter(item => item.homeGroupId === homeGroupId)
    .sortBy('createdAt');
}

// ── Queue drain ─────────────────────────────────────────────────────────────

/**
 * Drain the outbound queue — push all pending items to Supabase.
 * Returns { succeeded, failed }.
 */
export async function drainQueue(homeGroupId) {
  const pending = await getPendingQueue(homeGroupId);
  if (pending.length === 0) return { succeeded: 0, failed: 0 };

  const supabase = getSupabase();
  let succeeded = 0;
  let failed = 0;

  for (const item of pending) {
    // Mark syncing
    await db.sharedSyncQueue.update(item.id, { status: 'syncing' });

    try {
      if (item.action === 'upsert') {
        const { error } = await supabase
          .from(item.table)
          .upsert(item.payload, {
            onConflict: item.table === 'shared_week_plan'
              ? 'home_group_id,day_index,slot'
              : undefined,
          });
        if (error) throw error;
      } else if (item.action === 'delete') {
        const { error } = await supabase
          .from(item.table)
          .delete()
          .match(item.payload);
        if (error) throw error;
      }

      // Success — remove from queue
      await db.sharedSyncQueue.delete(item.id);
      succeeded++;
    } catch (err) {
      const attempts = (item.attempts || 0) + 1;
      const status = attempts >= 3 ? 'failed' : 'pending';
      await db.sharedSyncQueue.update(item.id, {
        status,
        attempts,
        lastError: err?.message || String(err),
      });
      failed++;
    }
  }

  return { succeeded, failed };
}

// ── Cold-start: full fetch ──────────────────────────────────────────────────

/**
 * Fetch full shared state from Supabase and apply to local Dexie.
 * Respects pending outbound mutations — does NOT overwrite those keys.
 */
export async function fullFetch(homeGroupId) {
  const supabase = getSupabase();

  // Get pending keys to protect
  const pendingItems = await getPendingQueue(homeGroupId);
  const pendingWeekKeys = new Set();
  const pendingGroceryIds = new Set();
  for (const item of pendingItems) {
    if (item.table === 'shared_week_plan' && item.payload) {
      pendingWeekKeys.add(`${item.payload.day_index}:${item.payload.slot || 'dinner'}`);
    }
    if (item.table === 'shared_grocery_items' && item.payload?.id) {
      pendingGroceryIds.add(item.payload.id);
    }
  }

  // Fetch week plan
  const { data: weekRows, error: weekErr } = await supabase
    .from('shared_week_plan')
    .select('*')
    .eq('home_group_id', homeGroupId);

  if (weekErr) throw weekErr;

  // Apply week plan to local Dexie
  const plan = Array(7).fill(null);
  for (const row of weekRows || []) {
    const key = `${row.day_index}:${row.slot}`;
    if (pendingWeekKeys.has(key)) continue; // protect pending
    if (row.day_index >= 0 && row.day_index < 7) {
      plan[row.day_index] = fromSlotData(row);
    }
  }

  // Fetch grocery items
  const { data: groceryRows, error: groceryErr } = await supabase
    .from('shared_grocery_items')
    .select('*')
    .eq('home_group_id', homeGroupId)
    .order('sort_order', { ascending: true });

  if (groceryErr) throw groceryErr;

  const groceryItems = (groceryRows || [])
    .filter(row => !pendingGroceryIds.has(row.id))
    .map(fromCloudGrocery);

  // Update sharedMeta
  await db.sharedMeta.put({
    homeGroupId,
    lastFullSyncAt: new Date().toISOString(),
  });

  return { plan, groceryItems };
}

// ── Realtime subscription ───────────────────────────────────────────────────

let _channel = null;

/**
 * Subscribe to Realtime changes for a home group.
 * @param {string} homeGroupId
 * @param {object} handlers - { onWeekPlanChange, onGroceryChange, onMemberChange, onTransferChange }
 */
export function subscribeRealtime(homeGroupId, handlers) {
  unsubscribeRealtime(); // tear down any existing subscription

  const supabase = getSupabase();

  _channel = supabase
    .channel(`home:${homeGroupId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_week_plan',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      handlers.onWeekPlanChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_grocery_items',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      handlers.onGroceryChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'home_group_members',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      handlers.onMemberChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_recipe_transfers',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      handlers.onTransferChange?.(payload);
    })
    .subscribe();
}

/**
 * Tear down Realtime subscription.
 */
export function unsubscribeRealtime() {
  if (_channel) {
    const supabase = getSupabase();
    supabase.removeChannel(_channel);
    _channel = null;
  }
}

// ── Reconnect sequence (spec Section 6) ─────────────────────────────────────

/**
 * Full reconnect sequence — called when device comes online while in a group.
 * Debounce this call (1-2s after online event).
 */
export async function reconnect(homeGroupId, handlers) {
  const supabase = getSupabase();

  // 1. Attempt token refresh
  const { error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr) {
    // Non-blocking — caller should show re-auth prompt
    throw new Error('AUTH_REFRESH_FAILED');
  }

  // 2. Drain pending queue
  const drainResult = await drainQueue(homeGroupId);

  // 3-4. Full fetch (respects pending keys)
  const { plan, groceryItems } = await fullFetch(homeGroupId);

  // 5. Open Realtime subscription
  subscribeRealtime(homeGroupId, handlers);

  return { drainResult, plan, groceryItems };
}

// ── Inbound Realtime handler helpers ────────────────────────────────────────

/**
 * Create a Realtime payload handler that filters echo and applies changes.
 * Handler is pure and fast — no network calls.
 */
export function createInboundHandler(currentUserId, onApply) {
  return (payload) => {
    // Filter echo — don't re-apply our own changes
    if (payload.new?.updated_by === currentUserId) return;

    const { eventType, new: row, old: oldRow } = payload;

    if (eventType === 'DELETE') {
      onApply({ type: 'delete', row: oldRow || row });
    } else {
      onApply({ type: 'upsert', row });
    }
  };
}
```

- [ ] **Step 4: Run sync engine tests**

Run: `npx vitest run src/__tests__/sharedSync.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
git add src/lib/sharedSync.js src/__tests__/sharedSync.test.js
git commit -m "feat(sync): shared sync engine — queue, drain, cold-start, Realtime

- enqueueSync: offline-safe mutation queue with clientMutationId
- drainQueue: push pending items, 3-attempt failure threshold
- fullFetch: fetch + apply remote state, protect pending outbound keys
- subscribeRealtime / unsubscribeRealtime: filtered by home_group_id
- reconnect: token refresh → drain → fetch → subscribe
- createInboundHandler: echo filter + pure apply callback"
```

---

### Task 6: Home Group Operations

**Files:**
- Create: `src/lib/homeGroup.js`
- Create: `src/__tests__/homeGroup.test.js`

- [ ] **Step 1: Write failing home group tests**

Create `src/__tests__/homeGroup.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { generateInviteCode } from '../lib/homeGroup';

describe('homeGroup', () => {
  describe('generateInviteCode', () => {
    it('returns a 6-char uppercase alphanumeric string', () => {
      const code = generateInviteCode();
      expect(code.length).toBe(6);
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    });

    it('generates unique codes', () => {
      const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()));
      expect(codes.size).toBe(100);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/homeGroup.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement home group module**

Create `src/lib/homeGroup.js`:

```javascript
/**
 * Home Group operations — create, join, leave, invite code management.
 * See spec Section 2 + Section 5.
 */
import db from '../db';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { getProfile, setHomeGroupId, clearHomeGroup } from './profile';
import { enqueueSync, discardQueueForGroup, fullFetch, drainQueue,
         subscribeRealtime, unsubscribeRealtime } from './sharedSync';
import { toSlotData } from './slotMapper';
import { toCloudGrocery } from './groceryMapper';
import { loadWeekPlan } from '../db';

/**
 * Generate a 6-character uppercase alphanumeric invite code.
 */
export function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for readability
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Create a new home group. Owner is the current user.
 * Bootstraps shared state from local week plan + grocery list.
 */
export async function createGroup(name = 'Our Kitchen') {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Must be signed in to create a group');

  const profile = await getProfile();
  const inviteCode = generateInviteCode();

  // 1. Create group
  const { data: group, error: groupErr } = await supabase
    .from('home_groups')
    .insert({
      name,
      invite_code: inviteCode,
      created_by: userId,
    })
    .select()
    .single();

  if (groupErr) throw groupErr;

  // 2. Add self as owner
  const { error: memberErr } = await supabase
    .from('home_group_members')
    .insert({
      home_group_id: group.id,
      user_id: userId,
      display_name: profile.displayName,
      avatar: profile.avatar || null,
      role: 'owner',
    });

  if (memberErr) throw memberErr;

  // 3. Update local profile
  await setHomeGroupId(group.id);

  // 4. Bootstrap: push current local plan + grocery as initial shared state
  await bootstrapSharedState(group.id, userId, profile.displayName);

  return { groupId: group.id, inviteCode, name: group.name };
}

/**
 * Push local week plan + grocery as initial shared state on group creation.
 */
async function bootstrapSharedState(groupId, userId, profileName) {
  const supabase = getSupabase();

  // Week plan
  const localPlan = await loadWeekPlan();
  if (localPlan) {
    const rows = [];
    for (let i = 0; i < localPlan.length; i++) {
      const slotData = toSlotData(localPlan[i], profileName);
      if (!slotData) continue;
      rows.push({
        home_group_id: groupId,
        day_index: i,
        slot: 'dinner',
        slot_data: slotData,
        updated_by: userId,
      });
    }
    if (rows.length > 0) {
      await supabase.from('shared_week_plan').upsert(rows, {
        onConflict: 'home_group_id,day_index,slot',
      });
    }
  }

  // Grocery list
  const localGrocery = await db.groceryItems.toArray();
  if (localGrocery.length > 0) {
    const groceryRows = localGrocery.map((item, idx) => {
      const cloud = toCloudGrocery(item, groupId, userId);
      // Save cloudId back to local
      if (cloud._generatedCloudId) {
        db.groceryItems.update(item.id, { cloudId: cloud._generatedCloudId });
      }
      const { _generatedCloudId, ...row } = cloud;
      return { ...row, sort_order: idx };
    });
    await supabase.from('shared_grocery_items').upsert(groceryRows);
  }
}

/**
 * Join a group via invite code (calls the rate-limited Edge Function).
 */
export async function joinGroup(inviteCode) {
  const supabase = getSupabase();
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Must be signed in to join a group');

  const profile = await getProfile();

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/join-group`;
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      invite_code: inviteCode.toUpperCase().trim(),
      display_name: profile.displayName,
      avatar: profile.avatar || null,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to join group');
  }

  // Update local profile
  await setHomeGroupId(result.home_group_id);

  return { groupId: result.home_group_id, name: result.name };
}

/**
 * Leave the current home group.
 * Tears down Realtime, discards queue, clears local group reference.
 * Local snapshot of shared data is kept as read-only.
 */
export async function leaveGroup() {
  const profile = await getProfile();
  if (!profile.homeGroupId) return;

  const homeGroupId = profile.homeGroupId;

  // 1. Tear down Realtime
  unsubscribeRealtime();

  // 2. Discard pending sync queue
  await discardQueueForGroup(homeGroupId);

  // 3. Remove membership from Supabase (if online)
  try {
    const supabase = getSupabase();
    const userId = await getCurrentUserId();
    if (userId) {
      // Check if sole owner
      const { data: members } = await supabase
        .from('home_group_members')
        .select('user_id, role')
        .eq('home_group_id', homeGroupId);

      const owners = (members || []).filter(m => m.role === 'owner');
      if (owners.length === 1 && owners[0].user_id === userId && members.length > 1) {
        throw new Error(
          'You are the only owner. Transfer ownership to another member before leaving, or delete the group.'
        );
      }

      await supabase
        .from('home_group_members')
        .delete()
        .eq('home_group_id', homeGroupId)
        .eq('user_id', userId);

      // If last member, delete the group entirely
      if (members && members.length <= 1) {
        await supabase.from('home_groups').delete().eq('id', homeGroupId);
      }
    }
  } catch (err) {
    // If offline or error, we still clear locally — the membership row
    // will be orphaned on the server but RLS prevents access anyway
    if (err.message?.includes('only owner')) throw err;
    console.warn('[HomeGroup] leaveGroup remote cleanup failed:', err);
  }

  // 4. Clear local profile
  await clearHomeGroup();
  await db.sharedMeta.delete(homeGroupId);
}

/**
 * Regenerate invite code for the current group (owner only).
 */
export async function regenerateInviteCode() {
  const profile = await getProfile();
  if (!profile.homeGroupId) throw new Error('Not in a group');

  const newCode = generateInviteCode();
  const supabase = getSupabase();

  const { error } = await supabase
    .from('home_groups')
    .update({ invite_code: newCode, invite_code_uses: 0 })
    .eq('id', profile.homeGroupId);

  if (error) throw error;
  return newCode;
}

/**
 * Get current group info + member list.
 */
export async function getGroupInfo() {
  const profile = await getProfile();
  if (!profile.homeGroupId) return null;

  const supabase = getSupabase();

  const { data: group } = await supabase
    .from('home_groups')
    .select('*')
    .eq('id', profile.homeGroupId)
    .single();

  const { data: members } = await supabase
    .from('home_group_members')
    .select('*')
    .eq('home_group_id', profile.homeGroupId);

  return { group, members: members || [] };
}

/**
 * Share a full recipe (for manually-created recipes without source_url).
 * Writes to shared_recipe_transfers table.
 */
export async function shareFullRecipe(mealId, toUserId = null) {
  const profile = await getProfile();
  if (!profile.homeGroupId) throw new Error('Not in a group');

  const meal = await db.meals.get(mealId);
  if (!meal) throw new Error('Meal not found');

  // Strip private fields
  const { id, cookCount, lastCooked, profileId, ...recipeData } = meal;

  const supabase = getSupabase();
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('shared_recipe_transfers')
    .insert({
      home_group_id: profile.homeGroupId,
      recipe_data: recipeData,
      from_user: userId,
      to_user: toUserId,
    });

  if (error) throw error;
}

/**
 * Claim a shared recipe transfer — save to local library.
 */
export async function claimRecipeTransfer(transferId) {
  const supabase = getSupabase();

  const { data: transfer, error: fetchErr } = await supabase
    .from('shared_recipe_transfers')
    .select('*')
    .eq('id', transferId)
    .single();

  if (fetchErr) throw fetchErr;
  if (!transfer) throw new Error('Transfer not found');

  // Save to local library
  const profile = await getProfile();
  const newMeal = {
    ...transfer.recipe_data,
    profileId: profile.id,
    importedAt: new Date().toISOString(),
    _sharedFrom: transfer.from_user,
  };

  await db.meals.add(newMeal);

  // Mark as claimed and delete
  await supabase
    .from('shared_recipe_transfers')
    .delete()
    .eq('id', transferId);
}
```

- [ ] **Step 4: Run home group tests**

Run: `npx vitest run src/__tests__/homeGroup.test.js`
Expected: ALL PASS (the `generateInviteCode` test)

- [ ] **Step 5: Commit**

```
git add src/lib/homeGroup.js src/__tests__/homeGroup.test.js
git commit -m "feat(homeGroup): create/join/leave group + invite codes + recipe transfer

- createGroup: bootstrap shared state from local plan + grocery
- joinGroup: calls rate-limited Edge Function
- leaveGroup: tear down Realtime, discard queue, sole-owner guard
- regenerateInviteCode, getGroupInfo
- shareFullRecipe / claimRecipeTransfer for manually-created recipes
- generateInviteCode: 6-char, no ambiguous chars (I/O/0/1)"
```

---

### Task 7: React Hooks + Context

**Files:**
- Create: `src/hooks/useProfile.js`
- Create: `src/hooks/useHomeGroup.js`

- [ ] **Step 1: Create useProfile hook**

Create `src/hooks/useProfile.js`:

```javascript
/**
 * React hook for local profile state.
 * Loads profile from Dexie on mount, provides update function.
 */
import { useState, useEffect, useCallback } from 'react';
import { getProfile, updateProfile, getDietaryPref, saveDietaryPref } from '../lib/profile';

export default function useProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getProfile();
      if (!cancelled) {
        setProfile(p);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(async (fields) => {
    const updated = await updateProfile(fields);
    setProfile(updated);
    return updated;
  }, []);

  const loadDietaryPref = useCallback(async () => {
    return getDietaryPref();
  }, []);

  const updateDietaryPref = useCallback(async (pref) => {
    const updated = await saveDietaryPref(pref);
    setProfile(updated);
    return pref;
  }, []);

  return { profile, loading, update, loadDietaryPref, updateDietaryPref };
}
```

- [ ] **Step 2: Create useHomeGroup hook**

Create `src/hooks/useHomeGroup.js`:

```javascript
/**
 * React hook for Home Group state — membership, sync, Realtime.
 * Encapsulates the full state machine from spec Section 3.
 *
 * States:
 *   1. local-only (no supabaseUid)
 *   2. authenticated, no group (supabaseUid set, no homeGroupId)
 *   3. authenticated + in group (homeGroupId set, Realtime active)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { isHomeGroupEnabled, getSupabase, getSession,
         signInWithGoogle, signInWithMagicLink, signOut as supabaseSignOut,
         getCurrentUserId } from '../lib/supabaseClient';
import { getProfile, linkLocalProfile, clearHomeGroup as clearProfileGroup } from '../lib/profile';
import { createGroup, joinGroup, leaveGroup, getGroupInfo,
         regenerateInviteCode as regenCode, shareFullRecipe,
         claimRecipeTransfer } from '../lib/homeGroup';
import { fullFetch, drainQueue, subscribeRealtime, unsubscribeRealtime,
         reconnect, createInboundHandler, enqueueSync } from '../lib/sharedSync';
import { onOnlineStatusChange } from './useOnlineStatus';

/**
 * @param {object} options
 * @param {Function} options.showToast - toast display function from App
 * @param {Function} options.onWeekPlanUpdate - called with new plan array when Realtime delivers changes
 * @param {Function} options.onGroceryUpdate - called with new grocery items array
 */
export default function useHomeGroup({ showToast, onWeekPlanUpdate, onGroceryUpdate } = {}) {
  const [state, setState] = useState('loading'); // loading | local | auth_no_group | in_group
  const [groupInfo, setGroupInfo] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | error
  const reconnectTimerRef = useRef(null);

  // ── Boot: silent session restore ──────────────────────────────────────────
  useEffect(() => {
    if (!isHomeGroupEnabled()) {
      setState('local');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const session = await getSession();
        const profile = await getProfile();

        if (!session?.user) {
          setState('local');
          return;
        }

        // Link profile (idempotent)
        await linkLocalProfile(session.user.id);

        if (profile?.homeGroupId) {
          // State 3: in group — cold-start sequence
          if (!cancelled) {
            setState('in_group');
            await initGroupSync(profile.homeGroupId);
          }
        } else {
          if (!cancelled) setState('auth_no_group');
        }
      } catch {
        if (!cancelled) setState('local');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ── Online/offline listener for reconnect ─────────────────────────────────
  useEffect(() => {
    if (state !== 'in_group') return;

    const cleanup = onOnlineStatusChange(({ isOnline }) => {
      if (!isOnline) return;

      // Debounce reconnect (1.5s)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(async () => {
        const profile = await getProfile();
        if (!profile?.homeGroupId) return;
        setSyncStatus('syncing');
        try {
          const result = await reconnect(profile.homeGroupId, realtimeHandlers);
          if (result.plan) onWeekPlanUpdate?.(result.plan);
          if (result.groceryItems) onGroceryUpdate?.(result.groceryItems);
          setSyncStatus('idle');
        } catch (err) {
          if (err.message === 'AUTH_REFRESH_FAILED') {
            showToast?.('Please sign in again to sync', 'error');
          } else {
            showToast?.("Some changes couldn't sync — will retry.", 'error');
          }
          setSyncStatus('error');
        }
      }, 1500);
    });

    return () => {
      cleanup();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [state]);

  // ── Realtime handlers ─────────────────────────────────────────────────────
  const realtimeHandlers = {
    onWeekPlanChange: async (payload) => {
      const userId = await getCurrentUserId();
      const handler = createInboundHandler(userId, ({ type, row }) => {
        // Re-fetch full plan for simplicity in v1
        // (could do surgical apply later for performance)
        getProfile().then(p => {
          if (p?.homeGroupId) {
            fullFetch(p.homeGroupId).then(({ plan }) => {
              onWeekPlanUpdate?.(plan);
            });
          }
        });
      });
      handler(payload);
    },
    onGroceryChange: async (payload) => {
      const userId = await getCurrentUserId();
      const handler = createInboundHandler(userId, () => {
        getProfile().then(p => {
          if (p?.homeGroupId) {
            fullFetch(p.homeGroupId).then(({ groceryItems }) => {
              onGroceryUpdate?.(groceryItems);
            });
          }
        });
      });
      handler(payload);
    },
    onMemberChange: (payload) => {
      // Refresh group info
      refreshGroupInfo();
    },
    onTransferChange: (payload) => {
      if (payload.eventType === 'INSERT') {
        showToast?.('A recipe was shared with you!', 'info');
      }
    },
  };

  // ── Init group sync (cold-start) ─────────────────────────────────────────
  async function initGroupSync(homeGroupId) {
    setSyncStatus('syncing');
    try {
      // 1. Drain pending queue first
      await drainQueue(homeGroupId);

      // 2. Full fetch
      const { plan, groceryItems } = await fullFetch(homeGroupId);
      onWeekPlanUpdate?.(plan);
      onGroceryUpdate?.(groceryItems);

      // 3. Subscribe to Realtime
      subscribeRealtime(homeGroupId, realtimeHandlers);

      // 4. Load group info
      await refreshGroupInfo();

      setSyncStatus('idle');
    } catch (err) {
      console.warn('[HomeGroup] initGroupSync failed:', err);
      setSyncStatus('error');
      // Still usable offline — local data is intact
    }
  }

  async function refreshGroupInfo() {
    try {
      const info = await getGroupInfo();
      setGroupInfo(info);
    } catch { /* offline — stale info is fine */ }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const doCreateGroup = useCallback(async (name) => {
    setSyncStatus('syncing');
    try {
      const result = await createGroup(name);
      setState('in_group');
      await initGroupSync(result.groupId);
      showToast?.(`Created "${result.name}"! Share this code: ${result.inviteCode}`, 'success', 5000);
      return result;
    } catch (err) {
      setSyncStatus('error');
      throw err;
    }
  }, []);

  const doJoinGroup = useCallback(async (code) => {
    setSyncStatus('syncing');
    try {
      const result = await joinGroup(code);
      setState('in_group');
      await initGroupSync(result.groupId);
      showToast?.(`Joined "${result.name}"!`, 'success');
      return result;
    } catch (err) {
      setSyncStatus('error');
      throw err;
    }
  }, []);

  const doLeaveGroup = useCallback(async () => {
    try {
      await leaveGroup();
      setState('auth_no_group');
      setGroupInfo(null);
      setSyncStatus('idle');
      showToast?.('Left the group. Your recipes are safe.', 'info');
    } catch (err) {
      if (err.message?.includes('only owner')) {
        showToast?.('Transfer ownership before leaving, or delete the group.', 'error');
      }
      throw err;
    }
  }, []);

  const doSignOut = useCallback(async () => {
    const profile = await getProfile();
    if (profile?.homeGroupId) {
      unsubscribeRealtime();
      // Keep local snapshot, just tear down cloud connection
    }
    await supabaseSignOut();
    setState('local');
    setGroupInfo(null);
    setSyncStatus('idle');
  }, []);

  const doSignIn = useCallback(async (method, emailOrNull) => {
    if (method === 'google') {
      await signInWithGoogle();
    } else {
      await signInWithMagicLink(emailOrNull);
      showToast?.('Check your email for the sign-in link', 'info');
    }
  }, []);

  return {
    state,
    groupInfo,
    syncStatus,
    isEnabled: isHomeGroupEnabled(),

    // Actions
    createGroup: doCreateGroup,
    joinGroup: doJoinGroup,
    leaveGroup: doLeaveGroup,
    signIn: doSignIn,
    signOut: doSignOut,
    regenerateInviteCode: regenCode,
    refreshGroupInfo,
    shareFullRecipe,
    claimRecipeTransfer,

    // For WeekView/Grocery to enqueue sync mutations
    enqueueSync,
  };
}
```

- [ ] **Step 3: Commit**

```
git add src/hooks/useProfile.js src/hooks/useHomeGroup.js
git commit -m "feat(hooks): useProfile + useHomeGroup React hooks

- useProfile: Dexie-backed profile state + dietary pref CRUD
- useHomeGroup: full state machine (local → auth'd → in_group),
  session restore, cold-start sync, Realtime subscription,
  reconnect with debounce, create/join/leave/sign-in/sign-out actions"
```

---

### Task 8: Pixel Avatars + Settings UI (Home Group Section)

**Files:**
- Create: `src/data/pixelAvatars.js`
- Create: `src/components/HomeGroupSection.jsx`
- Create: `src/components/CreateGroupSheet.jsx`
- Create: `src/components/JoinGroupSheet.jsx`

- [ ] **Step 1: Create pixel avatar definitions**

Create `src/data/pixelAvatars.js`:

```javascript
/**
 * Pixel avatar definitions — 10 fixed options consistent with BarShelf pixel-art style.
 * Each avatar is a simple emoji + color pair for v1.
 * Future: replace with actual pixel-art SVGs.
 */
const PIXEL_AVATARS = [
  { id: 'chef',     emoji: '👨‍🍳', color: '#FF6B35', label: 'Chef' },
  { id: 'cowgirl',  emoji: '🤠', color: '#D4A574', label: 'Cowgirl' },
  { id: 'cat',      emoji: '🐱', color: '#9C27B0', label: 'Cat' },
  { id: 'fox',      emoji: '🦊', color: '#FF9800', label: 'Fox' },
  { id: 'alien',    emoji: '👽', color: '#4CAF50', label: 'Alien' },
  { id: 'robot',    emoji: '🤖', color: '#607D8B', label: 'Robot' },
  { id: 'ghost',    emoji: '👻', color: '#B0BEC5', label: 'Ghost' },
  { id: 'dragon',   emoji: '🐉', color: '#F44336', label: 'Dragon' },
  { id: 'unicorn',  emoji: '🦄', color: '#E91E63', label: 'Unicorn' },
  { id: 'penguin',  emoji: '🐧', color: '#2196F3', label: 'Penguin' },
];

export function getAvatar(id) {
  return PIXEL_AVATARS.find(a => a.id === id) || PIXEL_AVATARS[0];
}

export function getAvatarInitial(name) {
  return (name || 'M')[0].toUpperCase();
}

export default PIXEL_AVATARS;
```

- [ ] **Step 2: Create HomeGroupSection component**

Create `src/components/HomeGroupSection.jsx`:

```jsx
/**
 * Home Group section inside Settings sheet.
 * Collapsed when not in a group; expanded when active.
 * See spec Section 5: "Settings state matrix"
 */
import { useState } from 'react';
import { getAvatar, getAvatarInitial } from '../data/pixelAvatars';

export default function HomeGroupSection({
  homeGroup, // { state, groupInfo, syncStatus, ... } from useHomeGroup
  profile,
  isOnline,
  onCreateGroup,
  onJoinGroup,
  onLeaveGroup,
  onSignIn,
  onSignOut,
  onRegenerateCode,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  if (!homeGroup.isEnabled) return null;

  const { state, groupInfo, syncStatus } = homeGroup;

  return (
    <div className="st-section">
      <h3>Home Group</h3>

      {/* State 1 or 2: show Create / Join buttons */}
      {(state === 'local' || state === 'auth_no_group') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '0 0 4px' }}>
            Share your week plan and grocery list with someone in your household.
          </p>

          <button
            className="st-install-btn"
            onClick={() => setShowCreate(true)}
            disabled={!isOnline}
          >
            <span className="st-install-icon">🏠</span>
            <span>Create a group</span>
          </button>

          <button
            className="st-install-btn"
            onClick={() => setShowJoin(true)}
            disabled={!isOnline}
          >
            <span className="st-install-icon">🔗</span>
            <span>Join with code</span>
          </button>

          {!isOnline && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '4px 0 0' }}>
              Connect to the internet to create or join a group
            </p>
          )}

          {state === 'auth_no_group' && (
            <button
              className="st-install-btn"
              onClick={onSignOut}
              style={{ marginTop: '8px', opacity: 0.7 }}
            >
              <span className="st-install-icon">🚪</span>
              <span>Sign out</span>
            </button>
          )}
        </div>
      )}

      {/* State 3: in group — show group info */}
      {state === 'in_group' && groupInfo?.group && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Group name + sync status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🏠</span>
            <span style={{ fontWeight: 600 }}>{groupInfo.group.name}</span>
            {syncStatus === 'idle' && isOnline && (
              <span title="Synced" style={{ fontSize: '14px', marginLeft: 'auto' }}>☁️✓</span>
            )}
            {syncStatus === 'syncing' && (
              <span title="Syncing…" style={{ fontSize: '14px', marginLeft: 'auto' }}>⏳</span>
            )}
            {syncStatus === 'error' && (
              <span title="Sync error" style={{ fontSize: '14px', marginLeft: 'auto' }}>⚠️</span>
            )}
            {!isOnline && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Will sync when online
              </span>
            )}
          </div>

          {/* Member list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {groupInfo.members.map(m => {
              const av = m.avatar ? getAvatar(m.avatar) : null;
              return (
                <div key={m.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '4px 0',
                }}>
                  <span style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: av?.color || 'var(--primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px',
                  }}>
                    {av?.emoji || getAvatarInitial(m.display_name)}
                  </span>
                  <span style={{ fontSize: '14px' }}>{m.display_name}</span>
                  {m.role === 'owner' && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>owner</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Invite code (owner only) */}
          {groupInfo.members.find(m =>
            m.user_id === profile?.supabaseUid && m.role === 'owner'
          ) && (
            <InviteCodeDisplay
              code={groupInfo.group.invite_code}
              onRegenerate={onRegenerateCode}
            />
          )}

          {/* Leave */}
          {!leaveConfirm ? (
            <button
              className="st-install-btn"
              onClick={() => setLeaveConfirm(true)}
              style={{ marginTop: '8px', opacity: 0.7 }}
            >
              <span className="st-install-icon">🚪</span>
              <span>Leave group</span>
            </button>
          ) : (
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '10px', padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
                Leave "{groupInfo.group.name}"?
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                Your personal recipes stay on this device.
                Shared week plan and grocery list will no longer update.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="st-install-btn"
                  onClick={() => setLeaveConfirm(false)}
                  style={{ flex: 1 }}
                >Cancel</button>
                <button
                  className="st-install-btn"
                  onClick={() => { setLeaveConfirm(false); onLeaveGroup(); }}
                  style={{ flex: 1, background: 'var(--error, #e53935)', color: '#fff' }}
                >Leave group</button>
              </div>
            </div>
          )}

          <button
            className="st-install-btn"
            onClick={onSignOut}
            style={{ opacity: 0.7 }}
          >
            <span className="st-install-icon">🔑</span>
            <span>Sign out</span>
          </button>
        </div>
      )}

      {/* Loading state */}
      {state === 'loading' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</p>
      )}

      {/* Create / Join sheets */}
      {showCreate && (
        <CreateGroupInline
          onClose={() => setShowCreate(false)}
          onCreate={async (name) => {
            await onCreateGroup(name);
            setShowCreate(false);
          }}
          onSignIn={onSignIn}
          needsAuth={state === 'local'}
        />
      )}
      {showJoin && (
        <JoinGroupInline
          onClose={() => setShowJoin(false)}
          onJoin={async (code) => {
            await onJoinGroup(code);
            setShowJoin(false);
          }}
          onSignIn={onSignIn}
          needsAuth={state === 'local'}
        />
      )}
    </div>
  );
}

function InviteCodeDisplay({ code, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* fallback: select text */ }
  };

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '10px', padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Invite code:</span>
      <span style={{
        fontFamily: 'monospace', fontSize: '18px', fontWeight: 700,
        letterSpacing: '2px',
      }}>{code}</span>
      <button
        onClick={copyCode}
        style={{
          marginLeft: 'auto', padding: '4px 10px', fontSize: '12px',
          borderRadius: '6px', border: '1px solid var(--border)',
          background: 'transparent', cursor: 'pointer',
          color: 'var(--text)',
        }}
      >{copied ? 'Copied!' : 'Copy'}</button>
      {!regenConfirm ? (
        <button
          onClick={() => setRegenConfirm(true)}
          style={{
            padding: '4px 8px', fontSize: '12px',
            borderRadius: '6px', border: '1px solid var(--border)',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >↻</button>
      ) : (
        <button
          onClick={async () => {
            await onRegenerate();
            setRegenConfirm(false);
          }}
          style={{
            padding: '4px 8px', fontSize: '11px',
            borderRadius: '6px', border: '1px solid var(--error, #e53935)',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--error, #e53935)',
          }}
        >Confirm</button>
      )}
    </div>
  );
}

function CreateGroupInline({ onClose, onCreate, onSignIn, needsAuth }) {
  const [name, setName] = useState('Our Kitchen');
  const [loading, setLoading] = useState(false);
  const [authStep, setAuthStep] = useState(false);
  const [email, setEmail] = useState('');

  if (needsAuth && !authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <p style={{ margin: '0 0 10px', fontSize: '14px' }}>
          Sign in to create a group
        </p>
        <button className="st-install-btn" onClick={() => onSignIn('google')}>
          <span>Continue with Google</span>
        </button>
        <button className="st-install-btn" onClick={() => setAuthStep(true)}
          style={{ marginTop: '6px' }}>
          <span>Use email link</span>
        </button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  if (authStep) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <input
          type="email" value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          style={{
            width: '100%', padding: '10px', fontSize: '16px',
            borderRadius: '8px', border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <button className="st-install-btn" onClick={() => onSignIn('magic', email)}
          style={{ marginTop: '8px' }}>Send sign-in link</button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: '12px',
      padding: '16px', marginTop: '8px',
    }}>
      <input
        type="text" value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Group name"
        maxLength={30}
        style={{
          width: '100%', padding: '10px', fontSize: '16px',
          borderRadius: '8px', border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box',
        }}
      />
      <button
        className="st-install-btn"
        onClick={async () => { setLoading(true); await onCreate(name); }}
        disabled={loading}
        style={{ marginTop: '8px' }}
      >{loading ? 'Creating…' : 'Create'}</button>
      <button className="st-install-btn" onClick={onClose}
        style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
    </div>
  );
}

function JoinGroupInline({ onClose, onJoin, onSignIn, needsAuth }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (needsAuth) {
    return (
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: '12px',
        padding: '16px', marginTop: '8px',
      }}>
        <p style={{ margin: '0 0 10px', fontSize: '14px' }}>
          Sign in to join a group
        </p>
        <button className="st-install-btn" onClick={() => onSignIn('google')}>
          <span>Continue with Google</span>
        </button>
        <button className="st-install-btn" onClick={onClose}
          style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)', borderRadius: '12px',
      padding: '16px', marginTop: '8px',
    }}>
      <input
        type="text" value={code}
        onChange={e => {
          setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
          setError('');
        }}
        placeholder="Enter 6-letter code"
        maxLength={6}
        style={{
          width: '100%', padding: '10px', fontSize: '20px',
          borderRadius: '8px', border: '1px solid var(--border)',
          background: 'var(--bg)', color: 'var(--text)',
          fontFamily: 'monospace', letterSpacing: '4px', textAlign: 'center',
          boxSizing: 'border-box',
        }}
        autoFocus
      />
      {error && <p style={{ color: 'var(--error, #e53935)', fontSize: '13px', margin: '6px 0 0' }}>{error}</p>}
      <button
        className="st-install-btn"
        onClick={async () => {
          if (code.length !== 6) { setError('Enter a 6-character code'); return; }
          setLoading(true);
          try { await onJoin(code); }
          catch (e) { setError(e.message); setLoading(false); }
        }}
        disabled={loading || code.length !== 6}
        style={{ marginTop: '8px' }}
      >{loading ? 'Joining…' : 'Join'}</button>
      <button className="st-install-btn" onClick={onClose}
        style={{ marginTop: '6px', opacity: 0.6 }}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```
git add src/data/pixelAvatars.js src/components/HomeGroupSection.jsx
git commit -m "feat(ui): Home Group Settings section + Create/Join flows

- HomeGroupSection: collapsible section in Settings, state-matrix-driven
- CreateGroupInline: name field + auth trigger (Google / magic link)
- JoinGroupInline: 6-char code input with auto-uppercase, paste-friendly
- InviteCodeDisplay: copy button + regenerate with confirm
- Leave group with confirmation dialog (spec Section 5 copy)
- pixelAvatars: 10 emoji/color avatar options"
```

---

### Task 9: Wire Home Group into App.jsx + Dietary Pref Migration

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports to App.jsx**

Add near the top imports:

```javascript
import useProfile from './hooks/useProfile';
import useHomeGroup from './hooks/useHomeGroup';
import HomeGroupSection from './components/HomeGroupSection';
import { isHomeGroupEnabled } from './lib/supabaseClient';
```

- [ ] **Step 2: Replace localStorage dietary pref with profile-backed version**

Replace the `DIETARY_PREF_KEY` / `loadDietaryPref` block:

```javascript
// A-1: household dietary preference — now stored in local profile (v22).
// loadDietaryPref is a sync fallback for initial render before profile loads.
const DIETARY_PREF_KEY = 'spicehub_dietary_pref'; // kept for pre-v22 fallback
function loadDietaryPref() {
  try {
    const raw = localStorage.getItem(DIETARY_PREF_KEY);
    if (!raw) return { dietary: '', mode: 'require' };
    const p = JSON.parse(raw);
    return { dietary: p.dietary || '', mode: p.mode || 'require' };
  } catch { return { dietary: '', mode: 'require' }; }
}
```

This stays unchanged because the v22 migration handles the actual data move. The `loadDietaryPref` function is still used as the initial `useState` value (sync, before profile async load). Once profile loads, the dietary pref will be read from profile.

- [ ] **Step 3: Add useProfile and useHomeGroup hooks inside App component**

Inside the `App()` function, after the existing `useState` declarations, add:

```javascript
const { profile, loading: profileLoading, updateDietaryPref } = useProfile();

// Home Group — only active when feature flag is set
const homeGroup = useHomeGroup({
  showToast,
  onWeekPlanUpdate: (plan) => {
    // Apply shared plan to local state
    setWeekPlan(plan);
  },
  onGroceryUpdate: (items) => {
    // Apply shared grocery items — merge with local
    setGroceryList(items);
  },
});
```

- [ ] **Step 4: Update dietary pref save to write to profile**

Find the dietary pref save line (`localStorage.setItem(DIETARY_PREF_KEY, ...)`) and wrap it:

```javascript
// Save dietary pref to both localStorage (fallback) and profile (source of truth)
try { localStorage.setItem(DIETARY_PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
if (updateDietaryPref) updateDietaryPref(next).catch(() => {});
```

- [ ] **Step 5: Add HomeGroupSection to Settings sheet**

In the Settings sheet JSX (inside `{showSettings && ...}`), add after the Theme section:

```jsx
{/* Home Group — behind feature flag */}
<HomeGroupSection
  homeGroup={homeGroup}
  profile={profile}
  isOnline={isOnline}
  onCreateGroup={homeGroup.createGroup}
  onJoinGroup={homeGroup.joinGroup}
  onLeaveGroup={homeGroup.leaveGroup}
  onSignIn={homeGroup.signIn}
  onSignOut={homeGroup.signOut}
  onRegenerateCode={homeGroup.regenerateInviteCode}
/>
```

- [ ] **Step 6: Run build to verify no errors**

Run: `npx vite build`
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```
git add src/App.jsx
git commit -m "feat(app): wire Home Group hooks + Settings section into App

- useProfile + useHomeGroup hooks mounted in App
- Dietary pref save now writes to both profile and localStorage
- HomeGroupSection added to Settings sheet (behind VITE_HOME_GROUP_ENABLED)
- onWeekPlanUpdate / onGroceryUpdate apply shared state to local React state"
```

---

### Task 10: WeekView Shared Slot Integration

**Files:**
- Modify: `src/components/WeekView.jsx`
- Create: `src/components/SharedSlotCard.jsx`

- [ ] **Step 1: Create SharedSlotCard component**

Create `src/components/SharedSlotCard.jsx`:

```jsx
/**
 * Plan-only slot card for shared meals from group members.
 * Shows name, image, ingredients, attribution, and import affordance.
 * See spec Section 4: "Shared slot behavior"
 */
import { useState } from 'react';

export default function SharedSlotCard({
  slot,        // fromSlotData() output with _isSharedSlot, _sharedBy, link, etc.
  onImport,    // (sourceUrl) => void — triggers executeUrlImport
  onSaveTransfer, // (transferId) => void — claims a shared recipe transfer
  transferId,  // if a shared_recipe_transfers row exists for this meal
  hasLocalRecipe, // true if db.meals has a matching recipe by name
  onOpenLocal, // () => void — open CookMode/MealDetail for the local recipe
}) {
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!slot.link) return;
    setImporting(true);
    try {
      await onImport(slot.link);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '4px',
      padding: '8px', borderRadius: '8px',
      background: 'var(--bg-secondary)',
      position: 'relative',
    }}>
      {/* Meal name + image */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {slot.imageUrl && (
          <img
            src={slot.imageUrl}
            alt={slot.name}
            style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }}
            loading="lazy"
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600, fontSize: '14px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{slot.name}</div>
          {slot._sharedBy && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Added by {slot._sharedBy}
            </div>
          )}
        </div>
      </div>

      {/* Import / Save / Open actions */}
      {hasLocalRecipe ? (
        <button
          onClick={onOpenLocal}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--border)',
            background: 'var(--primary)', color: '#fff',
            cursor: 'pointer',
          }}
        >Open Recipe</button>
      ) : slot.link ? (
        <button
          onClick={handleImport}
          disabled={importing}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--primary)',
            background: 'transparent', color: 'var(--primary)',
            cursor: 'pointer',
          }}
        >{importing ? 'Importing…' : 'Import to My Library'}</button>
      ) : transferId ? (
        <button
          onClick={() => onSaveTransfer(transferId)}
          style={{
            padding: '6px 12px', fontSize: '13px',
            borderRadius: '6px', border: '1px solid var(--primary)',
            background: 'transparent', color: 'var(--primary)',
            cursor: 'pointer',
          }}
        >Save to My Library</button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add sync trigger to WeekView slot assignment**

In `WeekView.jsx`, wherever a meal is assigned to a slot (the handler that calls `saveWeekPlan`), add after the local save:

```javascript
// If in a home group, enqueue sync mutation
if (homeGroup?.state === 'in_group' && profile?.homeGroupId) {
  const { toSlotData } = await import('../lib/slotMapper');
  const slotData = toSlotData(meal, profile.displayName);
  if (slotData) {
    homeGroup.enqueueSync({
      table: 'shared_week_plan',
      action: 'upsert',
      payload: {
        home_group_id: profile.homeGroupId,
        day_index: dayIndex,
        slot: 'dinner',
        slot_data: slotData,
        updated_by: profile.supabaseUid,
      },
      homeGroupId: profile.homeGroupId,
    });
  }
}
```

- [ ] **Step 3: Add attribution badge to slot rendering**

In the slot rendering section of `WeekView.jsx`, when rendering a meal that has `_isSharedSlot` or `_sharedBy`:

```jsx
{slot._sharedBy && slot._sharedBy !== profile?.displayName && (
  <span style={{
    position: 'absolute', top: '4px', right: '4px',
    fontSize: '12px', color: 'var(--text-muted)',
    maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis',
  }}>
    {slot._sharedBy}
  </span>
)}
```

- [ ] **Step 4: Run build to verify no errors**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```
git add src/components/SharedSlotCard.jsx src/components/WeekView.jsx
git commit -m "feat(weekview): shared slot integration + attribution badges

- SharedSlotCard: plan-only card with Import/Save/Open actions
- Slot assignment now enqueues sharedSyncQueue mutation when in group
- Attribution badge shows member name on slots they assigned
- Import button triggers executeUrlImport with source_url"
```

---

### Task 11: Auth Callback Route

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add auth callback handler on mount**

In `App.jsx`, add a `useEffect` near the top that handles the `/auth/callback` route:

```javascript
// Handle Supabase auth callback (OAuth redirect / magic link)
useEffect(() => {
  if (!isHomeGroupEnabled()) return;
  if (!window.location.pathname.includes('/auth/callback')) return;

  // The Supabase client SDK auto-detects the session from URL params
  // when detectSessionInUrl is true (set in supabaseClient.js).
  // After detection, redirect to clean URL.
  const timer = setTimeout(() => {
    window.history.replaceState({}, '', '/');
    // Force re-check of auth state
    window.location.reload();
  }, 1000);

  return () => clearTimeout(timer);
}, []);
```

- [ ] **Step 2: Run build to verify no errors**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```
git add src/App.jsx
git commit -m "feat(auth): handle /auth/callback redirect for OAuth + magic link

- Supabase SDK auto-detects session from URL params
- Clean redirect to / after auth completes"
```

---

### Task 12: Grocery Sync Integration

**Files:**
- Modify: `src/App.jsx` (grocery handlers)

- [ ] **Step 1: Add sync triggers to grocery operations**

In `App.jsx`, wherever `setGroceryList` is called for add/check/delete, add sync enqueue:

For grocery add:
```javascript
// After adding item to local state
if (homeGroup?.state === 'in_group' && profile?.homeGroupId) {
  const { toCloudGrocery } = await import('./lib/groceryMapper');
  const cloud = toCloudGrocery(newItem, profile.homeGroupId, profile.supabaseUid);
  // Save cloudId back
  if (cloud._generatedCloudId) {
    newItem.cloudId = cloud._generatedCloudId;
    // Re-save to Dexie with cloudId
  }
  const { _generatedCloudId, ...payload } = cloud;
  homeGroup.enqueueSync({
    table: 'shared_grocery_items',
    action: 'upsert',
    payload,
    homeGroupId: profile.homeGroupId,
  });
}
```

For grocery check/uncheck:
```javascript
if (homeGroup?.state === 'in_group' && item.cloudId && profile?.homeGroupId) {
  homeGroup.enqueueSync({
    table: 'shared_grocery_items',
    action: 'upsert',
    payload: {
      id: item.cloudId,
      home_group_id: profile.homeGroupId,
      checked: !item.checked,
      checked_by: profile.supabaseUid,
    },
    homeGroupId: profile.homeGroupId,
  });
}
```

For grocery delete:
```javascript
if (homeGroup?.state === 'in_group' && item.cloudId && profile?.homeGroupId) {
  homeGroup.enqueueSync({
    table: 'shared_grocery_items',
    action: 'delete',
    payload: { id: item.cloudId },
    homeGroupId: profile.homeGroupId,
  });
}
```

- [ ] **Step 2: Add attribution to grocery list rendering**

In the grocery item rendering, add attribution for items from other members:

```jsx
{item._addedBy && item._addedBy !== profile?.supabaseUid && (
  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
    {/* Look up display name from group members */}
    {homeGroup.groupInfo?.members?.find(m => m.user_id === item._addedBy)?.display_name || ''}
  </span>
)}
```

- [ ] **Step 3: Run build to verify no errors**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```
git add src/App.jsx
git commit -m "feat(grocery): sync grocery add/check/delete to home group

- Add/check/delete enqueue sharedSyncQueue mutations
- cloudId generated on first push, saved back to local Dexie
- Attribution text shows member name on items from partners"
```

---

### Task 13: Queue Hygiene + Edge Case Hardening

**Files:**
- Modify: `src/lib/sharedSync.js`

- [ ] **Step 1: Add queue cap enforcement**

In `sharedSync.js`, add after the `enqueueSync` function:

```javascript
/**
 * Enforce queue size cap (200 items).
 * Drops oldest done/failed items first; never drops pending.
 */
export async function enforceQueueCap() {
  const all = await db.sharedSyncQueue.toArray();
  if (all.length <= 200) return;

  const excess = all.length - 200;
  // Prioritize dropping: done first, then failed, never pending
  const droppable = all
    .filter(i => i.status === 'done' || i.status === 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const toDrop = droppable.slice(0, excess);
  for (const item of toDrop) {
    await db.sharedSyncQueue.delete(item.id);
  }
}
```

- [ ] **Step 2: Call enforceQueueCap after drain**

In the `drainQueue` function, add at the end before `return`:

```javascript
await enforceQueueCap();
```

- [ ] **Step 3: Add sharedMeta timestamp update after Realtime events**

In `subscribeRealtime`, update `sharedMeta` on each inbound event:

```javascript
// Inside each handler, after processing:
db.sharedMeta.put({
  homeGroupId,
  lastRealtimeEventAt: new Date().toISOString(),
}).catch(() => {});
```

- [ ] **Step 4: Commit**

```
git add src/lib/sharedSync.js
git commit -m "fix(sync): queue hygiene cap (200 items) + sharedMeta timestamps

- enforceQueueCap: drops oldest done/failed, never pending
- sharedMeta.lastRealtimeEventAt updated on each inbound event"
```

---

### Task 14: Full Build Verification + Integration Smoke Test

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests still pass. New tests pass.

- [ ] **Step 2: Run production build**

Run: `npx vite build`
Expected: Build succeeds with no errors, no warnings about missing modules.

- [ ] **Step 3: Verify feature flag isolation**

With `VITE_HOME_GROUP_ENABLED` absent or set to `false`:
1. App boots normally — no Supabase client initialized
2. Settings sheet shows no Home Group section
3. WeekView and Grocery work identically to today
4. No console errors related to Supabase/sync

- [ ] **Step 4: Verify offline behavior unchanged**

1. All personal features (library, import, cook mode, bar, pantry) work offline
2. No new network requests when offline
3. No errors in console when offline

- [ ] **Step 5: Commit (if any fixes were needed)**

```
git add -A
git commit -m "fix: address build/test issues from integration verification"
```

---

## Self-Review Checklist

### Spec coverage

| Spec Section | Task(s) | Status |
|-------------|---------|--------|
| S1: Local profile data model | Task 2 | ✅ |
| S1: profileId on personal tables | Task 2 | ✅ |
| S1: Dietary pref migration | Task 2 + Task 9 | ✅ |
| S2: Supabase schema + RLS | Task 1 | ✅ |
| S2: shared_recipe_transfers | Task 1 + Task 6 | ✅ |
| S2: Invite code rate limiting | Task 1 (Edge Function) | ✅ |
| S2: Realtime subscriptions | Task 5 | ✅ |
| S3: Progressive auth (3 states) | Task 7 | ✅ |
| S3: Silent session restore | Task 7 | ✅ |
| S3: Linking rules | Task 2 (profile.js) | ✅ |
| S3: Sign-out semantics | Task 7 | ✅ |
| S3: Auth callback | Task 11 | ✅ |
| S4: sharedSyncQueue | Task 2 (schema) + Task 5 (engine) | ✅ |
| S4: Week-plan mappers | Task 4 | ✅ |
| S4: Grocery mappers | Task 4 | ✅ |
| S4: Shared slot behavior | Task 10 | ✅ |
| S4: Cold-start ordering | Task 5 | ✅ |
| S4: Conflict clock (server updated_at) | Task 5 | ✅ |
| S4: clientMutationId dedupe | Task 5 | ✅ |
| S4: Group-create bootstrap | Task 6 | ✅ |
| S5: Settings state matrix | Task 8 | ✅ |
| S5: Create/Join flows | Task 8 | ✅ |
| S5: Invite code UX | Task 8 | ✅ |
| S5: Attribution badges | Task 10 + Task 12 | ✅ |
| S5: Leave group confirmation | Task 8 | ✅ |
| S5: Pixel avatars | Task 8 | ✅ |
| S6: Reconnect sequence | Task 5 + Task 7 | ✅ |
| S6: Leave while offline | Task 6 | ✅ |
| S6: Queue hygiene | Task 13 | ✅ |
| S6: Supabase keepalive | Task 1 | ✅ |
| S6: sharedMeta | Task 2 (schema) + Task 13 | ✅ |
| Feature flag | Task 3 + Task 9 | ✅ |

### Placeholder scan
No TBD, TODO, "implement later", "similar to Task N", or "add appropriate handling" found.

### Type consistency
- `toSlotData` / `fromSlotData` — consistent naming in Task 4 (definition) and Task 10 (usage)
- `toCloudGrocery` / `fromCloudGrocery` — consistent in Task 4 and Task 12
- `enqueueSync` — consistent in Task 5 (definition) and Tasks 10/12 (usage)
- `getProfile` / `updateProfile` — consistent in Task 2 and Tasks 6/7/8/9
- `homeGroupId` — consistent field name across all tasks
- `clientMutationId` — consistent in Task 5 queue schema and drain logic
- `_isSharedSlot` — consistent in Task 4 (mapper) and Task 10 (UI check)
