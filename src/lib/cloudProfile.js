/**
 * Cloud profile operations — username, search, avatar sync.
 * Talks to the Supabase `profiles` table (1:1 with auth.users).
 * Local Dexie profile (displayName, avatar) stays for offline use;
 * cloud username is authoritative and cached in React context only.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md
 */
import { getSupabase, getCurrentUserId } from './supabaseClient';

/**
 * Fetch the cloud profile for the current user.
 * Returns null if no profile row exists (shouldn't happen — auth trigger creates it).
 */
export async function getCloudProfile() {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, avatar_id, is_searchable, username_changed_at, created_at, updated_at')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.warn('[CloudProfile] getCloudProfile error:', error.message);
    return null;
  }
  return data;
}

/**
 * Check if a desired username is available.
 * Returns true if available and valid, false otherwise.
 */
export async function checkUsernameAvailable(desired) {
  if (!desired || desired.trim().length < 3) return false;

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('check_username_available', {
    desired: desired.trim().toLowerCase(),
  });

  if (error) {
    console.warn('[CloudProfile] checkUsernameAvailable error:', error.message);
    return false;
  }
  return data === true;
}

/**
 * Set or change the user's username.
 * First set is free; subsequent changes enforce 30-day cooldown.
 * @param {string} username — lowercase, 3-20 chars, [a-z0-9_]
 * @returns {{ success: boolean, error?: string }}
 */
export async function setUsername(username) {
  const clean = username.trim().toLowerCase();

  // Client-side validation (server CHECK constraint is the real guard)
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    return { success: false, error: 'Username must be 3-20 characters: letters, numbers, underscores only.' };
  }

  // Check availability
  const available = await checkUsernameAvailable(clean);
  if (!available) {
    return { success: false, error: 'Username is unavailable or reserved.' };
  }

  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: 'Not signed in.' };

  // Check cooldown (if username was previously set)
  const profile = await getCloudProfile();
  if (profile && profile.username && profile.username_changed_at) {
    const changedAt = new Date(profile.username_changed_at);
    const cooldownEnd = new Date(changedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() < cooldownEnd) {
      const daysLeft = Math.ceil((cooldownEnd - new Date()) / (24 * 60 * 60 * 1000));
      return { success: false, error: `Username can be changed again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      username: clean,
      username_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Username is already taken.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Update cloud display name and/or avatar.
 * Also propagates to home_group_members rows if in a group.
 * @param {{ displayName?: string, avatarId?: string }} fields
 */
export async function updateCloudProfile(fields) {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return;

  const updates = { updated_at: new Date().toISOString() };
  if (fields.displayName !== undefined) updates.display_name = fields.displayName;
  if (fields.avatarId !== undefined) updates.avatar_id = fields.avatarId;

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', userId);

  if (error) {
    console.warn('[CloudProfile] updateCloudProfile error:', error.message);
    return;
  }

  // Propagate to home_group_members (profiles is source of truth)
  const memberUpdates = {};
  if (fields.displayName !== undefined) memberUpdates.display_name = fields.displayName;
  if (fields.avatarId !== undefined) memberUpdates.avatar = fields.avatarId;

  if (Object.keys(memberUpdates).length > 0) {
    const { error: memberErr } = await supabase
      .from('home_group_members')
      .update(memberUpdates)
      .eq('user_id', userId);

    if (memberErr) {
      console.warn('[CloudProfile] propagate to home_group_members error:', memberErr.message);
    }
  }
}

/**
 * Update searchability preference.
 * @param {boolean} isSearchable
 */
export async function setSearchable(isSearchable) {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from('profiles')
    .update({
      is_searchable: isSearchable,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    console.warn('[CloudProfile] setSearchable error:', error.message);
  }
}

/**
 * Search for users by username prefix.
 * Returns up to 20 results. Requires query >= 3 chars.
 * @param {string} query
 * @returns {Array<{ user_id: string, username: string, display_name: string, avatar_id: string }>}
 */
export async function searchUsers(query) {
  const clean = (query || '').trim().toLowerCase();
  if (clean.length < 3) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('search_users', { query: clean });

  if (error) {
    console.warn('[CloudProfile] searchUsers error:', error.message);
    return [];
  }
  return data || [];
}
