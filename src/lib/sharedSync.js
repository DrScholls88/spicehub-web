/**
 * Shared sync engine — queue, drain, cold-start, Realtime handler.
 * See spec Section 4 + Section 6.
 *
 * This module is the ONLY code that talks to Supabase for shared data.
 * WeekView and GroceryList read/write local Dexie; this module bridges.
 */
import db from '../db';
import { getSupabase } from './supabaseClient';
import { fromSlotData } from './slotMapper';
import { fromCloudGrocery } from './groceryMapper';

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
 *
 * NOTE: `homeGroupId` is not a Dexie-indexed field on sharedSyncQueue
 * (schema: '++id, table, status, createdAt, clientMutationId'), so this
 * uses Collection.filter() rather than .where('homeGroupId') — the latter
 * throws a Dexie SchemaError (KeyPath not indexed) at runtime.
 */
export async function discardQueueForGroup(homeGroupId) {
  // Collection.filter().delete() is unreliable with some IndexedDB shims
  // (fake-indexeddb); manual toArray→bulkDelete is safer and equally fast
  // on a small queue.
  const items = await db.sharedSyncQueue
    .filter(item => item.homeGroupId === homeGroupId)
    .toArray();
  if (items.length > 0) {
    await db.sharedSyncQueue.bulkDelete(items.map(i => i.id));
  }
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

  await enforceQueueCap();
  return { succeeded, failed };
}

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

  const stampMeta = () => {
    db.sharedMeta.put({
      homeGroupId,
      lastRealtimeEventAt: new Date().toISOString(),
    }).catch(() => {});
  };

  _channel = supabase
    .channel(`home:${homeGroupId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_week_plan',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      stampMeta();
      handlers.onWeekPlanChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_grocery_items',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      stampMeta();
      handlers.onGroceryChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'home_group_members',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      stampMeta();
      handlers.onMemberChange?.(payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'shared_recipe_transfers',
      filter: `home_group_id=eq.${homeGroupId}`,
    }, (payload) => {
      stampMeta();
      handlers.onTransferChange?.(payload);
    })
    .subscribe();

  return _channel;
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
