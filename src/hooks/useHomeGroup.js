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
import { isHomeGroupEnabled, isFriendsEnabled, initSupabase, getSupabase, getSession,
         signInWithGoogle, signInWithMagicLink, signOut as supabaseSignOut,
         getCurrentUserId } from '../lib/supabaseClient';
import { getProfile, linkLocalProfile, clearHomeGroup as clearProfileGroup } from '../lib/profile';
import { createGroup, joinGroup, leaveGroup, getGroupInfo,
         regenerateInviteCode as regenCode, shareFullRecipe,
         claimRecipeTransfer } from '../lib/homeGroup';
import { fullFetch, drainQueue, subscribeRealtime, unsubscribeRealtime,
         reconnect, createInboundHandler, enqueueSync } from '../lib/sharedSync';
import { onOnlineStatusChange } from './useOnlineStatus';
import { syncFriendsToLocal } from '../lib/friends';
import { syncPendingSharesToLocal, drainShareQueue } from '../lib/recipeShare';

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
        // Pre-load the Supabase SDK (dynamic import, no-op if already loaded)
        await initSupabase();

        const session = await getSession();
        const profile = await getProfile();

        if (!session?.user) {
          setState('local');
          return;
        }

        // Link profile (idempotent)
        await linkLocalProfile(session.user.id);

        // Bootstrap friends + shares sync so badges show immediately
        if (isFriendsEnabled()) {
          try {
            await Promise.all([
              syncFriendsToLocal(),
              syncPendingSharesToLocal(),
            ]);
            window.dispatchEvent(new CustomEvent('spicehub:friends-bootstrap'));
          } catch (err) {
            console.warn('[useHomeGroup] friends bootstrap sync failed:', err.message);
            showToast?.("Couldn't load friends & shared recipes — will retry.", 'error', 3000);
          }
        }

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

  // ── Drain offline share queue when back online ────────────────────────────
  useEffect(() => {
    if (state === 'loading' || state === 'local') return;

    const cleanup = onOnlineStatusChange(({ isOnline }) => {
      if (!isOnline) return;
      drainShareQueue().then(({ drained }) => {
        if (drained > 0) {
          showToast?.(`Sent ${drained} queued share${drained > 1 ? 's' : ''}!`, 'success', 2000);
        }
      }).catch(() => {});
    });
    return cleanup;
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
      showToast?.(err.message || "Couldn't create the group — try again.", 'error', 4000);
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
      showToast?.(err.message || "Couldn't join the group — try again.", 'error', 4000);
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
