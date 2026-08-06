/**
 * Friends graph operations — send/accept/decline/unfriend/block/unblock.
 * All mutations go through Supabase SECURITY DEFINER RPCs.
 * Local Dexie `friends` table is the offline cache for the UI.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md
 */
import db from '../db';
import { getSupabase, getCurrentUserId } from './supabaseClient';

// ── Supabase RPC wrappers ──────────────────────────────────────────────────

/**
 * Send a friend request.
 * @param {string} toUserId — target user's auth.users.id
 * @returns {{ success: boolean, friendshipId?: string, error?: string }}
 */
export async function sendFriendRequest(toUserId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('send_friend_request', {
    to_user: toUserId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  // Optimistically add to local Dexie cache
  const myId = await getCurrentUserId();
  try {
    await db.friends.put({
      id: data,
      otherUserId: toUserId,
      username: null, // will be populated on next sync
      displayName: null,
      avatarId: null,
      status: 'pending',
      updatedAt: new Date().toISOString(),
    });
  } catch { /* non-critical */ }

  return { success: true, friendshipId: data };
}

/**
 * Accept a pending friend request (addressee only).
 * @param {string} friendshipId
 */
export async function acceptFriendRequest(friendshipId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('accept_friend_request', {
    p_friendship_id: friendshipId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  // Update local cache
  try {
    await db.friends.update(friendshipId, {
      status: 'accepted',
      updatedAt: new Date().toISOString(),
    });
  } catch { /* non-critical */ }

  return { success: true };
}

/**
 * Decline a pending friend request (addressee only).
 * @param {string} friendshipId
 */
export async function declineFriendRequest(friendshipId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('decline_friend_request', {
    p_friendship_id: friendshipId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  // Remove from local cache
  try {
    await db.friends.delete(friendshipId);
  } catch { /* non-critical */ }

  return { success: true };
}

/**
 * Remove an accepted friend (either party).
 * @param {string} friendshipId
 */
export async function unfriend(friendshipId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('unfriend', {
    p_friendship_id: friendshipId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  try {
    await db.friends.delete(friendshipId);
  } catch { /* non-critical */ }

  return { success: true };
}

/**
 * Block a user. Deletes any existing friendship, inserts block row,
 * auto-dismisses pending recipe shares.
 * @param {string} targetUserId
 */
export async function blockUser(targetUserId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('block_user', {
    target: targetUserId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  // Clean up local Dexie
  try {
    // Remove any friendship row with this user
    const existing = await db.friends
      .where('otherUserId')
      .equals(targetUserId)
      .toArray();
    for (const f of existing) {
      await db.friends.delete(f.id);
    }

    // Auto-dismiss local pending shares from/to this user
    const shares = await db.recipeShares
      .where('status')
      .equals('pending')
      .toArray();
    for (const s of shares) {
      if (s.fromUserId === targetUserId || s.toUserId === targetUserId) {
        await db.recipeShares.delete(s.id);
      }
    }
  } catch { /* non-critical */ }

  return { success: true };
}

/**
 * Unblock a previously blocked user.
 * @param {string} targetUserId
 */
export async function unblockUser(targetUserId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('unblock_user', {
    target: targetUserId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  // Remove block row from local cache
  try {
    const existing = await db.friends
      .where('otherUserId')
      .equals(targetUserId)
      .toArray();
    for (const f of existing) {
      if (f.status === 'blocked') {
        await db.friends.delete(f.id);
      }
    }
  } catch { /* non-critical */ }

  return { success: true };
}

/**
 * Cancel an outgoing pending friend request (requester only).
 * @param {string} friendshipId
 */
export async function cancelFriendRequest(friendshipId) {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('cancel_friend_request', {
    p_friendship_id: friendshipId,
  });

  if (error) {
    return { success: false, error: mapRpcError(error) };
  }

  try {
    await db.friends.delete(friendshipId);
  } catch { /* non-critical */ }

  return { success: true };
}

// ── Fetch + cache ──────────────────────────────────────────────────────────

let syncFriendsInFlight = null;

/**
 * Fetch all friends (accepted) + pending requests from Supabase
 * and write them to local Dexie cache. Called on sign-in bootstrap.
 *
 * Coordinated via a singleton in-flight promise: useHomeGroup and
 * FriendsSection both call this independently on mount. Without this
 * guard, both fire their own RPC round trips + a Dexie clear/refill,
 * and whichever finishes last silently wins. Concurrent callers now
 * share the same in-flight request.
 */
export async function syncFriendsToLocal() {
  if (syncFriendsInFlight) return syncFriendsInFlight;
  syncFriendsInFlight = doSyncFriendsToLocal().finally(() => {
    syncFriendsInFlight = null;
  });
  return syncFriendsInFlight;
}

async function doSyncFriendsToLocal() {
  const supabase = getSupabase();

  // Accepted friends
  const { data: accepted, error: accErr } = await supabase.rpc('get_friends', {
    for_status: 'accepted',
  });
  if (accErr) {
    console.warn('[Friends] syncFriendsToLocal accepted error:', accErr.message);
  }

  // Pending inbound
  const { data: pendingIn, error: pendErr } = await supabase.rpc('get_pending_requests');
  if (pendErr) {
    console.warn('[Friends] syncFriendsToLocal pending error:', pendErr.message);
  }

  // Pending outbound (my sent requests)
  // NOTE: get_friends('pending') returns ALL pending friendships (both inbound
  // AND outbound). We must exclude IDs already captured by get_pending_requests
  // to avoid overwriting pending_inbound rows with pending_outbound in bulkPut.
  const { data: pendingOut, error: outErr } = await supabase.rpc('get_friends', {
    for_status: 'pending',
  });
  if (outErr) {
    console.warn('[Friends] syncFriendsToLocal outbound error:', outErr.message);
  }
  const pendingInIds = new Set((pendingIn || []).map(f => f.friendship_id));

  // Blocked (my blocks only — RPC filters requester_id = me)
  const { data: blocked, error: blockErr } = await supabase.rpc('get_friends', {
    for_status: 'blocked',
  });
  if (blockErr) {
    console.warn('[Friends] syncFriendsToLocal blocked error:', blockErr.message);
  }

  // Clear and repopulate
  await db.friends.clear();

  const rows = [];

  if (accepted) {
    for (const f of accepted) {
      rows.push({
        id: f.friendship_id,
        otherUserId: f.friend_id,
        username: f.username,
        displayName: f.display_name,
        avatarId: f.avatar_id,
        status: 'accepted',
        updatedAt: f.created_at,
        // "What's Cooking?" ambient status — { emoji, recipeName, itemType,
        // setAt } or null. Only meaningful for actual friends (accepted).
        currentStatus: f.current_status || null,
      });
    }
  }

  if (pendingIn) {
    for (const f of pendingIn) {
      rows.push({
        id: f.friendship_id,
        otherUserId: f.from_user_id,
        username: f.username,
        displayName: f.display_name,
        avatarId: f.avatar_id,
        status: 'pending_inbound',
        updatedAt: f.created_at,
      });
    }
  }

  if (pendingOut) {
    for (const f of pendingOut) {
      // Skip inbound requests already captured above — get_friends('pending')
      // returns both directions; without this guard, bulkPut overwrites
      // the pending_inbound row with pending_outbound (same friendship ID).
      if (pendingInIds.has(f.friendship_id)) continue;
      rows.push({
        id: f.friendship_id,
        otherUserId: f.friend_id,
        username: f.username,
        displayName: f.display_name,
        avatarId: f.avatar_id,
        status: 'pending_outbound',
        updatedAt: f.created_at,
      });
    }
  }

  if (blocked) {
    for (const f of blocked) {
      rows.push({
        id: f.friendship_id,
        otherUserId: f.friend_id,
        username: f.username,
        displayName: f.display_name,
        avatarId: f.avatar_id,
        status: 'blocked',
        updatedAt: f.created_at,
      });
    }
  }

  if (rows.length > 0) {
    await db.friends.bulkPut(rows);
  }

  return rows;
}

// ── Local queries ──────────────────────────────────────────────────────────

/**
 * Get accepted friends from Dexie cache (instant, offline-safe).
 */
export async function getLocalFriends() {
  return db.friends.where('status').equals('accepted').sortBy('displayName');
}

/**
 * Get inbound pending requests from Dexie cache.
 */
export async function getLocalPendingInbound() {
  return db.friends.where('status').equals('pending_inbound').toArray();
}

/**
 * Get outbound pending requests from Dexie cache.
 */
export async function getLocalPendingOutbound() {
  return db.friends.where('status').equals('pending_outbound').toArray();
}

/**
 * Get blocked users from Dexie cache.
 */
export async function getLocalBlocked() {
  return db.friends.where('status').equals('blocked').toArray();
}

/**
 * Get count of inbound pending requests (for badge).
 */
export async function getPendingInboundCount() {
  return db.friends.where('status').equals('pending_inbound').count();
}

// ── Realtime handler ───────────────────────────────────────────────────────

/**
 * Handle a Realtime event on the friendships table.
 * Idempotent: checks if Dexie already has the same id + status before writing.
 * @param {object} payload — Supabase Realtime payload
 * @param {string} myUserId — current user's auth id
 * @returns {{ action: string, friendRow?: object } | null} — for toast/UI
 */
export async function handleFriendshipRealtimeEvent(payload, myUserId) {
  const { eventType, new: row, old: oldRow } = payload;

  if (eventType === 'DELETE') {
    const deletedId = (oldRow || row)?.id;
    if (deletedId) {
      const existing = await db.friends.get(deletedId);
      if (existing) {
        await db.friends.delete(deletedId);
        return { action: 'removed', friendRow: existing };
      }
    }
    return null;
  }

  if (!row) return null;

  // Determine which user is the "other" person
  const otherUserId = row.requester_id === myUserId ? row.addressee_id : row.requester_id;

  // Idempotent check: skip if already have same id + status
  const existing = await db.friends.get(row.id);
  if (existing && existing.status === mapServerStatus(row, myUserId)) {
    return null;
  }

  // Fetch the other user's profile info for the Dexie row
  let username = existing?.username || null;
  let displayName = existing?.displayName || null;
  let avatarId = existing?.avatarId || null;

  if (!username) {
    const profile = await fetchProfileWithRetry(otherUserId);
    if (profile) {
      username = profile.username;
      displayName = profile.display_name;
      avatarId = profile.avatar_id;
    }
  }

  const localStatus = mapServerStatus(row, myUserId);
  const friendRow = {
    id: row.id,
    otherUserId,
    username,
    displayName,
    avatarId,
    status: localStatus,
    updatedAt: row.updated_at,
    // This is a friendships-table event, not a profiles-table event, so it
    // never carries current_status — preserve whatever we already had
    // rather than clobbering it back to null on every friendship change.
    currentStatus: existing?.currentStatus || null,
  };

  await db.friends.put(friendRow);

  if (eventType === 'INSERT' && row.status === 'pending' && row.addressee_id === myUserId) {
    return { action: 'new_request', friendRow };
  }
  if (eventType === 'UPDATE' && row.status === 'accepted') {
    return { action: 'accepted', friendRow };
  }

  return { action: 'updated', friendRow };
}

/**
 * Fetch a user's profile for the Dexie friend row, with one retry.
 * Previously this swallowed all errors silently (`catch { /* best-effort *\/ }`),
 * so a missing GRANT or a transient network blip left the friend row stuck
 * showing "User" forever with no trace in the console. Now: retry once after
 * a short delay (covers transient network/RLS timing issues), then log a
 * clear warning so a real permissions problem (e.g. migration 004 not
 * applied) is actually discoverable instead of silently swallowed.
 * @param {string} otherUserId
 * @returns {{ username: string, display_name: string, avatar_id: string } | null}
 */
async function fetchProfileWithRetry(otherUserId) {
  const supabase = getSupabase();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('username, display_name, avatar_id')
        .eq('user_id', otherUserId)
        .single();
      if (error) throw error;
      return profile || null;
    } catch (err) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }
      console.warn(
        `[Friends] profile lookup failed for ${otherUserId} — friend will show as "User" until next full sync:`,
        err.message || err,
      );
      return null;
    }
  }
  return null;
}

/**
 * Map server-side friendship status to local Dexie status.
 * Distinguishes pending_inbound vs pending_outbound.
 */
function mapServerStatus(row, myUserId) {
  if (row.status === 'pending') {
    return row.requester_id === myUserId ? 'pending_outbound' : 'pending_inbound';
  }
  return row.status; // 'accepted' or 'blocked'
}

/**
 * Map Supabase RPC errors to user-friendly strings.
 */
function mapRpcError(error) {
  const msg = error.message || '';
  if (msg.includes('Set a username')) return 'Set a username before adding friends.';
  if (msg.includes('User not found')) return 'User not found.';
  if (msg.includes('Cannot send a friend request to yourself')) return 'Cannot add yourself.';
  if (msg.includes('Cannot send request to this user')) return 'Cannot send request to this user.';
  if (msg.includes('A request already exists')) return 'A request already exists with this user.';
  if (msg.includes('Too many friend requests')) return 'Too many requests. Try again later.';
  if (msg.includes('Friend request not found')) return 'Request not found or already handled.';
  if (msg.includes('Friendship not found')) return 'Friendship not found.';
  if (msg.includes('Cannot block yourself')) return 'Cannot block yourself.';
  if (msg.includes('Block not found')) return 'Block not found.';
  if (msg.includes('Cannot cancel')) return 'Cannot cancel this request.';
  return msg || 'Something went wrong.';
}
