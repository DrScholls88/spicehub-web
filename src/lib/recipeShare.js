/**
 * Recipe sharing — send full recipe copies to friends.
 * Inserts via Supabase `send_recipe_share` RPC, local cache in Dexie `recipeShares`.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md
 */
import db from '../db';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { isPublicUrl } from './slotMapper';
import { getProfile } from './profile';

// ── Build recipe_data payload ──────────────────────────────────────────────

/**
 * Strip private fields and build a shareable recipe_data JSONB payload.
 * @param {object} meal — full Dexie meal or drink record
 * @param {'meal'|'drink'} itemType
 * @returns {object} recipe_data safe for sharing
 */
export function buildSharePayload(meal, itemType = 'meal') {
  const data = {
    name: meal.name || '',
    ingredients: Array.isArray(meal.ingredients)
      ? meal.ingredients.map(i => typeof i === 'string' ? i : (i && i.name) || '')
      : [],
    ingredientsStructured: Array.isArray(meal.ingredientsStructured) ? meal.ingredientsStructured : [],
    directions: Array.isArray(meal.directions) ? meal.directions : [],
    directionsStructured: Array.isArray(meal.directionsStructured) ? meal.directionsStructured : [],
    servings: meal.servings || undefined,
    prepTime: meal.prepTime || undefined,
    cookTime: meal.cookTime || undefined,
    source_url: meal.link || meal.source_url || undefined,
    tags: Array.isArray(meal.tags) ? meal.tags : [],
    notes: Array.isArray(meal.notes) ? meal.notes : [],
    nutrition: meal.nutrition || undefined,
    description: meal.description || undefined,
    recipeYield: meal.recipeYield || undefined,
  };

  // Public URLs only
  if (isPublicUrl(meal.imageUrl)) {
    data.imageUrl = meal.imageUrl;
  }

  // Drink-specific fields
  if (itemType === 'drink') {
    if (meal.spirit) data.spirit = meal.spirit;
    if (meal.glassware) data.glassware = meal.glassware;
    if (meal.garnish) data.garnish = meal.garnish;
    if (meal.method) data.method = meal.method;
  }

  // Strip undefined values for cleaner JSON
  return JSON.parse(JSON.stringify(data));
}

// ── Size guard ───────────────────────────────────────────────────────────

// Server enforces pg_column_size(p_recipe_data) > 100000 → 'Recipe data too
// large' (see supabase/migrations/002_friends_direct_share.sql). We check
// client-side first with a small safety margin so a recipe with huge
// directions/notes fails fast with a friendly message instead of round-
// tripping to the server for an opaque error.
const MAX_SHARE_PAYLOAD_BYTES = 95000;

/**
 * Estimate the serialized byte size of a recipe_data payload.
 * @param {object} recipeData
 * @returns {number} approximate UTF-8 byte length
 */
function estimatePayloadBytes(recipeData) {
  try {
    return new Blob([JSON.stringify(recipeData)]).size;
  } catch {
    return JSON.stringify(recipeData).length;
  }
}

/**
 * Check a recipe_data payload against the server's size cap before sending.
 * @param {object} recipeData
 * @returns {string|null} friendly error message, or null if within budget
 */
function checkPayloadSize(recipeData) {
  const bytes = estimatePayloadBytes(recipeData);
  if (bytes > MAX_SHARE_PAYLOAD_BYTES) {
    return 'This recipe is too large to share (its directions or notes are too long). Try trimming it down.';
  }
  return null;
}

// ── Send ───────────────────────────────────────────────────────────────────

/**
 * Share a recipe with one friend.
 * @param {string} toUserId — friend's user_id
 * @param {object} meal — full Dexie meal or drink record
 * @param {'meal'|'drink'} itemType
 * @param {string} [note=''] — optional message (max 280 chars)
 * @returns {{ success: boolean, shareId?: string, error?: string }}
 */
export async function sendRecipeShare(toUserId, meal, itemType = 'meal', note = '') {
  const recipeData = buildSharePayload(meal, itemType);

  const sizeError = checkPayloadSize(recipeData);
  if (sizeError) {
    return { success: false, error: sizeError };
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('send_recipe_share', {
    p_to_user_id: toUserId,
    p_item_type: itemType,
    p_recipe_data: recipeData,
    p_note: (note || '').slice(0, 280),
  });

  if (error) {
    return { success: false, error: mapShareError(error) };
  }

  return { success: true, shareId: data };
}

/**
 * Share a recipe with multiple friends.
 * Calls sendRecipeShare per friend, collects results.
 * @param {string[]} friendUserIds
 * @param {object} meal
 * @param {'meal'|'drink'} itemType
 * @param {string} [note='']
 * @returns {{ sent: number, failed: number, errors: Array<{ userId: string, error: string }> }}
 */
export async function sendRecipeShareToMany(friendUserIds, meal, itemType = 'meal', note = '') {
  let sent = 0;
  let failed = 0;
  let queued = 0;
  const errors = [];

  // If offline, queue everything for later
  if (!navigator.onLine) {
    const recipeData = buildSharePayload(meal, itemType);

    const sizeError = checkPayloadSize(recipeData);
    if (sizeError) {
      // Don't queue something guaranteed to fail once back online —
      // fail fast for every recipient with the same friendly message.
      return {
        sent: 0,
        failed: friendUserIds.length,
        queued: 0,
        errors: friendUserIds.map(userId => ({ userId, error: sizeError })),
      };
    }

    for (const userId of friendUserIds) {
      try {
        await db.sharedSyncQueue.add({
          table: 'recipe_shares',
          action: 'send_share',
          payload: { toUserId: userId, itemType, recipeData, note: (note || '').slice(0, 280) },
          homeGroupId: null,
          clientMutationId: crypto.randomUUID(),
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
        });
        queued++;
      } catch (err) {
        failed++;
        errors.push({ userId, error: err.message });
      }
    }
    return { sent: 0, failed, queued, errors };
  }

  for (const userId of friendUserIds) {
    const result = await sendRecipeShare(userId, meal, itemType, note);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push({ userId, error: result.error });
    }
  }

  return { sent, failed, queued: 0, errors };
}

// ── Receive / inbox ────────────────────────────────────────────────────────

/**
 * Fetch pending shares from Supabase and write to Dexie cache.
 * Called on sign-in bootstrap.
 *
 * Throws on fetch failure instead of swallowing it and returning [] —
 * a failed fetch (e.g. missing table GRANT, RLS misconfiguration, or a
 * network blip) previously looked identical to "no pending shares", so
 * the inbox silently showed empty even though shares existed server-side.
 * Callers should catch and surface this to the user.
 */
export async function syncPendingSharesToLocal() {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('recipe_shares')
    .select('*')
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[RecipeShare] syncPendingSharesToLocal error:', error.message);
    throw new Error('Could not load shared recipes — will retry next sync.');
  }

  // Clear existing pending shares in Dexie and repopulate
  await db.recipeShares.where('status').equals('pending').delete();

  const rows = (data || []).map(s => ({
    id: s.id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    itemType: s.item_type,
    status: s.status,
    createdAt: s.created_at,
    recipeData: s.recipe_data,
    note: s.note || '',
    reaction: s.reaction || null,
    fromUsername: s.recipe_data?.from_username || '',
    fromDisplayName: s.recipe_data?.from_display_name || '',
  }));

  if (rows.length > 0) {
    await db.recipeShares.bulkPut(rows);
  }

  return rows;
}

/**
 * Save a received share to the local library (meals or drinks).
 * @param {string} shareId — recipe_shares.id
 * @returns {{ success: boolean, localId?: number, error?: string }}
 */
export async function saveShareToLibrary(shareId) {
  const share = await db.recipeShares.get(shareId);
  if (!share) return { success: false, error: 'Share not found.' };

  const profile = await getProfile();
  if (!profile) return { success: false, error: 'No local profile.' };

  const { recipeData, itemType, fromUsername } = share;

  // Dedupe check: does a local meal/drink with same name + _sharedFrom already exist?
  const table = itemType === 'drink' ? db.drinks : db.meals;
  const existing = await table
    .where('name')
    .equals(recipeData.name || '')
    .toArray();
  const dupe = existing.find(m => m._sharedFrom === fromUsername);
  if (dupe) {
    // Already saved — just clean up the share
    await markShareStatus(shareId, 'saved');
    return { success: true, localId: dupe.id };
  }

  // Build local record from recipe_data
  const { from_username, from_display_name, ...cleanData } = recipeData;
  const localRecord = {
    ...cleanData,
    // Normalize field names (cloud uses source_url, local uses link)
    link: cleanData.source_url || cleanData.link,
    profileId: profile.id,
    importedAt: new Date().toISOString(),
    _sharedFrom: fromUsername,
    _sharedAt: share.createdAt || new Date().toISOString(),
  };
  // Remove cloud-only fields
  delete localRecord.source_url;

  const localId = await table.add(localRecord);

  // Update share status (best-effort, retries via queue if offline)
  await markShareStatus(shareId, 'saved');

  return { success: true, localId };
}

/**
 * Dismiss a received share.
 * @param {string} shareId
 */
export async function dismissShare(shareId) {
  await markShareStatus(shareId, 'dismissed');
}

/**
 * Bookmark a received share as "Want to Try" — unlike save/dismiss this
 * keeps the share visible locally (in a dedicated Try Soon list) instead of
 * fully importing it into the library or removing it from view.
 * @param {string} shareId
 */
export async function bookmarkShare(shareId) {
  await markShareStatus(shareId, 'bookmarked');
}

/**
 * Remove a bookmark, returning the share to the pending inbox.
 * @param {string} shareId
 */
export async function unbookmarkShare(shareId) {
  await markShareStatus(shareId, 'pending');
}

/**
 * Mark a share's status. Updates Supabase (or queues if offline).
 *
 * 'saved' and 'dismissed' are terminal from the local UI's point of view —
 * the recipe now lives in the meal/drink library (saved) or the user is
 * done with it (dismissed) — so the row is removed from the local Dexie
 * cache same as before. 'bookmarked' (and reverting to 'pending') keep the
 * row so it can still be listed locally (Try Soon / inbox).
 */
async function markShareStatus(shareId, status) {
  const keepLocally = status === 'bookmarked' || status === 'pending';

  if (keepLocally) {
    // Optimistic local update in place.
    const existing = await db.recipeShares.get(shareId);
    if (existing) {
      await db.recipeShares.update(shareId, { status });
    }
  } else {
    // Remove from local Dexie first (optimistic)
    await db.recipeShares.delete(shareId);
  }

  // Try to update Supabase
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('recipe_shares')
      .update({ status })
      .eq('id', shareId);

    if (error) throw error;
  } catch (err) {
    console.warn(`[RecipeShare] markShareStatus(${status}) failed, queuing:`, err.message);
    // Queue for retry (reuse sharedSyncQueue)
    try {
      await db.sharedSyncQueue.add({
        table: 'recipe_shares',
        action: 'update_status',
        payload: { id: shareId, status },
        homeGroupId: null,
        clientMutationId: crypto.randomUUID(),
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
    } catch { /* last resort: status will be stale on server */ }
  }
}

// ── Local queries ──────────────────────────────────────────────────────────

/**
 * Get pending received shares from Dexie (for inbox).
 */
export async function getLocalPendingShares() {
  return db.recipeShares
    .where('status')
    .equals('pending')
    .reverse()
    .sortBy('createdAt');
}

/**
 * Get count of pending received shares (for badge).
 */
export async function getPendingShareCount() {
  return db.recipeShares.where('status').equals('pending').count();
}

/**
 * Get bookmarked ("Want to Try") shares from Dexie, newest first.
 */
export async function getLocalBookmarkedShares() {
  return db.recipeShares
    .where('status')
    .equals('bookmarked')
    .reverse()
    .sortBy('createdAt');
}

// ── Share history ──────────────────────────────────────────────────────────

/**
 * Fetch the full exchange history (sent + received, any status) with one
 * friend, newest first. Online-only — Supabase retains the full history
 * (markShareStatus only ever deletes the *local* Dexie cache, never the
 * server row), so this always reflects the true history rather than
 * whatever happens to still be cached locally.
 * @param {string} otherUserId
 * @param {{ limit?: number }} [opts]
 * @returns {Array<object>} rows shaped like the Dexie recipeShares cache,
 *   plus a `direction` field ('sent' | 'received')
 */
export async function getShareHistoryWithFriend(otherUserId, { limit = 50 } = {}) {
  const supabase = getSupabase();
  const myUserId = await getCurrentUserId();
  if (!myUserId) return [];

  const { data, error } = await supabase
    .from('recipe_shares')
    .select('*')
    .or(`and(from_user_id.eq.${myUserId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${myUserId})`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[RecipeShare] getShareHistoryWithFriend error:', error.message);
    throw new Error('Could not load share history — try again.');
  }

  return (data || []).map(s => ({
    id: s.id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    direction: s.from_user_id === myUserId ? 'sent' : 'received',
    itemType: s.item_type,
    status: s.status,
    createdAt: s.created_at,
    recipeData: s.recipe_data,
    note: s.note || '',
    reaction: s.reaction || null,
  }));
}

// ── Realtime handler ───────────────────────────────────────────────────────

/**
 * Handle a Realtime INSERT on recipe_shares (incoming share).
 * Writes to Dexie and returns info for toast.
 * @param {object} payload — Supabase Realtime payload
 * @param {string} myUserId
 * @returns {{ recipeName: string, fromUsername: string, shareId: string } | null}
 */
export async function handleIncomingShareRealtime(payload, myUserId) {
  const row = payload.new;
  if (!row || row.to_user_id !== myUserId) return null;
  if (row.status !== 'pending') return null;

  // Check if already in Dexie (idempotent)
  const existing = await db.recipeShares.get(row.id);
  if (existing) return null;

  const dexieRow = {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    itemType: row.item_type,
    status: row.status,
    createdAt: row.created_at,
    recipeData: row.recipe_data,
    note: row.note || '',
    reaction: row.reaction || null,
    fromUsername: row.recipe_data?.from_username || '',
    fromDisplayName: row.recipe_data?.from_display_name || '',
  };

  await db.recipeShares.put(dexieRow);

  return {
    recipeName: row.recipe_data?.name || 'a recipe',
    fromUsername: row.recipe_data?.from_username || 'Someone',
    fromDisplayName: row.recipe_data?.from_display_name || '',
    shareId: row.id,
  };
}

/**
 * Handle a Realtime UPDATE on recipe_shares where I'm the sender — used to
 * detect when a friend reacts to a recipe I shared with them, so we can
 * pop a toast ("Sarah reacted 🔥 to your Pad Thai!") instead of the reaction
 * being invisible until the next time Share History happens to be opened.
 * @param {object} payload — Supabase Realtime payload
 * @param {string} myUserId
 * @returns {{ recipeName: string, reaction: string, reactorUserId: string } | null}
 */
export function handleShareReactionRealtime(payload, myUserId) {
  const row = payload.new;
  const oldRow = payload.old;
  if (!row || row.from_user_id !== myUserId) return null;
  if (!row.reaction || row.reaction === oldRow?.reaction) return null;

  return {
    recipeName: row.recipe_data?.name || 'your recipe',
    reaction: row.reaction,
    reactorUserId: row.to_user_id, // the recipient of the share is who reacted
  };
}

// ── Emoji reactions ───────────────────────────────────────────────────────

/**
 * Allowed reaction emojis. Must exactly match the CHECK constraint on
 * recipe_shares.reaction (see supabase/migrations/005_social_features_tier1.sql)
 * or the server will reject a reaction the UI just offered.
 */
export const SHARE_REACTIONS = ['❤️', '🔥', '😋', '👨‍🍳', '🤤', '👍', '💯', '🎉'];

/**
 * React to a received share (or remove reaction with null).
 * @param {string} shareId
 * @param {string|null} reaction — emoji or null to clear
 */
export async function reactToShare(shareId, reaction) {
  // Optimistic local update
  const existing = await db.recipeShares.get(shareId);
  if (existing) {
    await db.recipeShares.update(shareId, { reaction: reaction || null });
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('react_to_share', {
      p_share_id: shareId,
      p_reaction: reaction || null,
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[RecipeShare] reactToShare failed, queuing:', err.message);
    await db.sharedSyncQueue.add({
      table: 'recipe_shares',
      action: 'react',
      payload: { id: shareId, reaction: reaction || null },
      homeGroupId: null,
      clientMutationId: crypto.randomUUID(),
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });
  }
}

// ── Offline draft share queue drain ────────────────────────────────────────

/**
 * Drain queued outbound share sends (queued while offline).
 * Called when the app comes back online. Also drains status updates.
 * @returns {{ drained: number, failed: number }}
 */
export async function drainShareQueue() {
  const pending = await db.sharedSyncQueue
    .where('status')
    .equals('pending')
    .toArray();

  const shareSends = pending.filter(q => q.table === 'recipe_shares' && q.action === 'send_share');
  const statusUpdates = pending.filter(q => q.table === 'recipe_shares' && q.action === 'update_status');
  const reactions = pending.filter(q => q.table === 'recipe_shares' && q.action === 'react');

  let drained = 0;
  let failed = 0;

  for (const q of shareSends) {
    try {
      const { toUserId, itemType, recipeData, note } = q.payload;
      const supabase = getSupabase();
      const { error } = await supabase.rpc('send_recipe_share', {
        p_to_user_id: toUserId,
        p_item_type: itemType,
        p_recipe_data: recipeData,
        p_note: note || '',
      });
      if (error) throw error;
      await db.sharedSyncQueue.delete(q.id);
      drained++;
    } catch (err) {
      const attempts = (q.attempts || 0) + 1;
      if (attempts >= 3) {
        // Give up after 3 retries
        await db.sharedSyncQueue.update(q.id, { status: 'failed', attempts });
        failed++;
      } else {
        await db.sharedSyncQueue.update(q.id, { attempts });
        failed++;
      }
    }
  }

  for (const q of statusUpdates) {
    try {
      const { id, status } = q.payload;
      const supabase = getSupabase();
      const { error } = await supabase
        .from('recipe_shares')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      await db.sharedSyncQueue.delete(q.id);
      drained++;
    } catch {
      const attempts = (q.attempts || 0) + 1;
      if (attempts >= 3) {
        await db.sharedSyncQueue.update(q.id, { status: 'failed', attempts });
      } else {
        await db.sharedSyncQueue.update(q.id, { attempts });
      }
      failed++;
    }
  }

  for (const q of reactions) {
    try {
      const { id, reaction } = q.payload;
      const supabase = getSupabase();
      const { error } = await supabase.rpc('react_to_share', {
        p_share_id: id,
        p_reaction: reaction || null,
      });
      if (error) throw error;
      await db.sharedSyncQueue.delete(q.id);
      drained++;
    } catch {
      const attempts = (q.attempts || 0) + 1;
      if (attempts >= 3) {
        await db.sharedSyncQueue.update(q.id, { status: 'failed', attempts });
      } else {
        await db.sharedSyncQueue.update(q.id, { attempts });
      }
      failed++;
    }
  }

  return { drained, failed };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mapShareError(error) {
  const msg = error.message || '';
  if (msg.includes('Invalid item type')) return 'Invalid recipe type.';
  if (msg.includes('Recipe must have a name')) return 'Recipe must have a name.';
  if (msg.includes('Recipe data too large')) return 'Recipe is too large to share.';
  if (msg.includes('Note too long')) return 'Note is too long (max 280 characters).';
  if (msg.includes('Cannot share with yourself')) return 'Cannot share with yourself.';
  if (msg.includes('Not friends')) return 'You must be friends to share recipes.';
  if (msg.includes('Share limit reached')) return 'Share limit reached. Try again tomorrow.';
  return msg || 'Failed to share recipe.';
}
