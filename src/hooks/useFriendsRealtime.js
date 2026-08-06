/**
 * useFriendsRealtime — subscribes to Supabase Realtime channels for
 * friendships and recipe_shares when friends feature is enabled.
 *
 * Two channels:
 *   1. friends-graph:{userId} — friendships INSERT/UPDATE/DELETE
 *   2. incoming-shares:{userId} — recipe_shares INSERT (new shares for me)
 *
 * Dispatches custom events so other components (FriendsSection,
 * SharedWithYouSection, tab badge) refresh.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §5
 */
import { useEffect, useRef } from 'react';
import { isFriendsEnabled, getSupabase, getCurrentUserId } from '../lib/supabaseClient';
import { handleFriendshipRealtimeEvent } from '../lib/friends';
import { handleIncomingShareRealtime, handleShareReactionRealtime } from '../lib/recipeShare';
import db from '../db';

/**
 * @param {{ showToast?: Function, enabled?: boolean }} options
 */
export default function useFriendsRealtime({ showToast, enabled = true } = {}) {
  const channelsRef = useRef([]);
  const userIdRef = useRef(null);

  useEffect(() => {
    if (!enabled || !isFriendsEnabled()) return;

    let cancelled = false;

    (async () => {
      const userId = await getCurrentUserId();
      if (!userId || cancelled) return;
      userIdRef.current = userId;

      const supabase = getSupabase();

      // ── Channel 1: friendships ──────────────────────────────────────────
      const friendsCh = supabase
        .channel(`friends-graph:${userId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `requester_id=eq.${userId}`,
        }, async (payload) => {
          const result = await handleFriendshipRealtimeEvent(payload, userId);
          if (result) {
            window.dispatchEvent(new CustomEvent('spicehub:friends-updated'));
            if (result.action === 'new_request') {
              showToast?.(`${result.friendRow?.displayName || result.friendRow?.username || 'Someone'} sent you a friend request`, 'info', 4000);
            } else if (result.action === 'accepted') {
              showToast?.(`${result.friendRow?.displayName || result.friendRow?.username || 'Someone'} accepted your friend request!`, 'success', 3000);
            }
          }
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `addressee_id=eq.${userId}`,
        }, async (payload) => {
          const result = await handleFriendshipRealtimeEvent(payload, userId);
          if (result) {
            window.dispatchEvent(new CustomEvent('spicehub:friends-updated'));
            if (result.action === 'new_request') {
              showToast?.(`${result.friendRow?.displayName || result.friendRow?.username || 'Someone'} sent you a friend request`, 'info', 4000);
            } else if (result.action === 'accepted') {
              showToast?.(`${result.friendRow?.displayName || result.friendRow?.username || 'Someone'} accepted your friend request!`, 'success', 3000);
            }
          }
        })
        .subscribe();

      // ── Channel 2: incoming recipe shares ───────────────────────────────
      const sharesCh = supabase
        .channel(`incoming-shares:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'recipe_shares',
          filter: `to_user_id=eq.${userId}`,
        }, async (payload) => {
          const info = await handleIncomingShareRealtime(payload, userId);
          if (info) {
            window.dispatchEvent(new CustomEvent('spicehub:shares-updated'));
            const sender = info.fromDisplayName || info.fromUsername || 'Someone';
            showToast?.(`${sender} shared "${info.recipeName}" with you`, 'info', 4000);
          }
        })
        .subscribe();

      // ── Channel 3: reactions on shares I sent ───────────────────────────
      // Tier 1 "Reaction expansion": tell the sender when a friend reacts,
      // instead of the reaction only being visible if they happen to open
      // Share History later.
      const reactionsCh = supabase
        .channel(`sent-share-reactions:${userId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'recipe_shares',
          filter: `from_user_id=eq.${userId}`,
        }, async (payload) => {
          const info = handleShareReactionRealtime(payload, userId);
          if (info) {
            window.dispatchEvent(new CustomEvent('spicehub:shares-updated'));
            // Reactor's name isn't on the recipe_shares row itself — check
            // the local friends cache (already populated for anyone we'd
            // be sharing recipes with) rather than a second network round
            // trip just to label a toast.
            let name = 'Someone';
            try {
              const friend = await db.friends.where('otherUserId').equals(info.reactorUserId).first();
              name = friend?.displayName || (friend?.username ? `@${friend.username}` : 'Someone');
            } catch { /* fall back to "Someone" */ }
            showToast?.(`${name} reacted ${info.reaction} to "${info.recipeName}"`, 'info', 3500);
          }
        })
        .subscribe();

      channelsRef.current = [friendsCh, sharesCh, reactionsCh];
    })();

    return () => {
      cancelled = true;
      if (channelsRef.current.length > 0) {
        try {
          const supabase = getSupabase();
          for (const ch of channelsRef.current) {
            supabase.removeChannel(ch);
          }
        } catch { /* supabase may not be initialized */ }
        channelsRef.current = [];
      }
    };
  }, [enabled, showToast]);
}
