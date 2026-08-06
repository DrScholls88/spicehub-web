/**
 * Friend Activity Feed — Tier 2 pick from the 2026-08-05 brainstorm.
 * "A timeline of recent friend activity: shares sent/received, new friends
 * added." No new tables — derived server-side from `friendships` +
 * `recipe_shares` via the `get_friend_activity` RPC (see
 * supabase/migrations/005_social_features_tier1.sql).
 *
 * Online-only by design: this is a lightweight "what's been happening"
 * glance, not offline-critical state, so there's no Dexie cache for it —
 * keeps this additive and avoids yet another table to keep in sync.
 */
import { getSupabase } from './supabaseClient';

/**
 * @typedef {object} FriendActivityItem
 * @property {'friend_added'|'share_sent'|'share_received'} activityType
 * @property {string} occurredAt — ISO timestamp
 * @property {string} otherUserId
 * @property {string|null} otherUsername
 * @property {string|null} otherDisplayName
 * @property {string|null} otherAvatarId
 * @property {'meal'|'drink'|null} itemType
 * @property {string|null} recipeName
 */

/**
 * Fetch the current user's friend activity feed.
 * @param {{ limit?: number, offset?: number }} [opts]
 * @returns {Promise<FriendActivityItem[]>}
 */
export async function getFriendActivity({ limit = 20, offset = 0 } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_friend_activity', {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.warn('[FriendActivity] getFriendActivity error:', error.message);
    throw new Error("Couldn't load recent activity — try again.");
  }

  return (data || []).map(row => ({
    activityType: row.activity_type,
    occurredAt: row.occurred_at,
    otherUserId: row.other_user_id,
    otherUsername: row.other_username,
    otherDisplayName: row.other_display_name,
    otherAvatarId: row.other_avatar_id,
    itemType: row.item_type,
    recipeName: row.recipe_name,
  }));
}

/**
 * Build a short human-readable line for one activity item.
 * Kept here (not in the component) so the copy is easy to find/tweak in
 * one place and reusable if the feed ever needs a second surface.
 * @param {FriendActivityItem} item
 * @returns {{ emoji: string, text: string }}
 */
export function describeActivity(item) {
  const name = item.otherDisplayName || (item.otherUsername ? `@${item.otherUsername}` : 'Someone');
  switch (item.activityType) {
    case 'friend_added':
      return { emoji: '🤝', text: `You and ${name} became friends` };
    case 'share_sent':
      return { emoji: '📤', text: `You shared "${item.recipeName || 'a recipe'}" with ${name}` };
    case 'share_received':
      return { emoji: '📥', text: `${name} shared "${item.recipeName || 'a recipe'}" with you` };
    default:
      return { emoji: '✨', text: `Activity with ${name}` };
  }
}
