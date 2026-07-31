/**
 * FriendsSection — settings section for friend management.
 * Contains: username display, search + add, pending requests,
 * friends list, sent requests, blocked users.
 *
 * Lives inside the Settings sheet, below HomeGroupSection.
 * Only renders when isFriendsEnabled() is true.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §4
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isFriendsEnabled } from '../lib/supabaseClient';
import { getCloudProfile, searchUsers } from '../lib/cloudProfile';
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  cancelFriendRequest, unfriend, blockUser, unblockUser,
  syncFriendsToLocal, getLocalFriends, getLocalPendingInbound,
  getLocalPendingOutbound, getLocalBlocked,
} from '../lib/friends';
import { getAvatar } from '../data/pixelAvatars';
import SetUsernameSheet from './SetUsernameSheet';
import db from '../db';

const SORT_MODES = [
  { key: 'az', label: 'A–Z' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'recent', label: 'Recent' },
];

const SEARCH_DEBOUNCE_MS = 400;

/**
 * @param {{ isOnline: boolean, showToast: Function }} props
 */
export default function FriendsSection({ isOnline, showToast }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [cloudProfile, setCloudProfile] = useState(null);
  const [friends, setFriends] = useState([]);
  const [pendingIn, setPendingIn] = useState([]);
  const [pendingOut, setPendingOut] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [showUsernameSheet, setShowUsernameSheet] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  // Loading
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // friendshipId or userId being acted on

  // Sections
  const [showSent, setShowSent] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  // Overflow menu for friend rows
  const [overflowOpen, setOverflowOpen] = useState(null); // otherUserId or null

  // Sort mode
  const [sortMode, setSortMode] = useState('az');

  if (!isFriendsEnabled()) return null;

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getCloudProfile();
        if (!cancelled) setCloudProfile(profile);

        if (profile?.username) {
          await syncFriendsToLocal();
          await refreshLocal();
        }
      } catch (err) {
        console.warn('[FriendsSection] bootstrap error:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listen for Realtime friend updates
  useEffect(() => {
    const handler = () => refreshLocal();
    window.addEventListener('spicehub:friends-updated', handler);
    return () => window.removeEventListener('spicehub:friends-updated', handler);
  }, []);

  // Close overflow menu on outside tap
  useEffect(() => {
    if (!overflowOpen) return;
    const close = () => setOverflowOpen(null);
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [overflowOpen]);

  const refreshLocal = async () => {
    const [f, pi, po, b] = await Promise.all([
      getLocalFriends(),
      getLocalPendingInbound(),
      getLocalPendingOutbound(),
      getLocalBlocked(),
    ]);
    setFriends(f);
    setPendingIn(pi);
    setPendingOut(po);
    setBlocked(b);
  };

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback((e) => {
    const q = e.target.value;
    setSearchQuery(q);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!q || q.trim().length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(q.trim());
        setSearchResults(results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleAddFriend = async (userId) => {
    setActionLoading(userId);
    const result = await sendFriendRequest(userId);
    if (result.success) {
      showToast?.('Friend request sent', 'success', 2000);
      await refreshLocal();
      // Remove from search results
      setSearchResults(prev => prev.filter(r => r.user_id !== userId));
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleAccept = async (friendshipId) => {
    setActionLoading(friendshipId);
    const result = await acceptFriendRequest(friendshipId);
    if (result.success) {
      showToast?.('Friend added!', 'success', 2000);
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleDecline = async (friendshipId) => {
    setActionLoading(friendshipId);
    const result = await declineFriendRequest(friendshipId);
    if (result.success) {
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleCancel = async (friendshipId) => {
    setActionLoading(friendshipId);
    const result = await cancelFriendRequest(friendshipId);
    if (result.success) {
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleUnfriend = async (friendshipId, displayName) => {
    if (!window.confirm(`Remove ${displayName || 'this friend'}? You can re-add them later.`)) return;
    setOverflowOpen(null);
    setActionLoading(friendshipId);
    const result = await unfriend(friendshipId);
    if (result.success) {
      showToast?.('Removed from friends', 'info', 2000);
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleBlock = async (userId, displayName) => {
    if (!window.confirm(`Block ${displayName || 'this user'}? They won't be able to find or share with you.`)) return;
    setOverflowOpen(null);
    setActionLoading(userId);
    const result = await blockUser(userId);
    if (result.success) {
      showToast?.('User blocked', 'info', 2000);
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  const handleUnblock = async (userId) => {
    setActionLoading(userId);
    const result = await unblockUser(userId);
    if (result.success) {
      showToast?.('User unblocked', 'info', 2000);
      await refreshLocal();
    } else {
      showToast?.(result.error, 'error', 3000);
    }
    setActionLoading(null);
  };

  // ── Favorite toggle (Dexie-only) ───────────────────────────────────────────
  const toggleFavorite = async (friendId) => {
    try {
      const row = await db.friends.get(friendId);
      if (!row) return;
      await db.friends.update(friendId, { favorite: !row.favorite });
      await refreshLocal();
    } catch { /* best-effort */ }
  };

  // ── Sorted friends ────────────────────────────────────────────────────────
  const sortedFriends = useMemo(() => {
    const list = [...friends];
    if (sortMode === 'favorites') {
      list.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return (a.displayName || a.username || '').localeCompare(b.displayName || b.username || '');
      });
    } else if (sortMode === 'recent') {
      list.sort((a, b) => {
        const da = a.updatedAt || '';
        const db2 = b.updatedAt || '';
        return db2.localeCompare(da); // newest first
      });
    } else {
      list.sort((a, b) =>
        (a.displayName || a.username || '').localeCompare(b.displayName || b.username || ''),
      );
    }
    return list;
  }, [friends, sortMode]);

  const handleUsernameSet = async (username) => {
    setCloudProfile(prev => prev ? { ...prev, username } : prev);
    showToast?.(`Username set to @${username}`, 'success', 3000);
    // Post-set bootstrap: sync friends + shares
    await syncFriendsToLocal();
    await refreshLocal();
    window.dispatchEvent(new CustomEvent('spicehub:friends-bootstrap'));
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Check if a search result user is already in our friends/pending lists */
  const getRelationship = (userId) => {
    if (friends.find(f => f.otherUserId === userId)) return 'friends';
    if (pendingOut.find(f => f.otherUserId === userId)) return 'requested';
    if (pendingIn.find(f => f.otherUserId === userId)) return 'incoming';
    if (blocked.find(f => f.otherUserId === userId)) return 'blocked';
    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="st-section">
        <h3>Friends</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  // No username set — prompt to set one
  if (!cloudProfile?.username) {
    return (
      <div className="st-section">
        <h3>Friends</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 10px' }}>
          Set a username to connect with friends and share recipes directly.
        </p>
        <button className="st-install-btn" onClick={() => setShowUsernameSheet(true)} disabled={!isOnline}>
          <span className="st-install-icon">👤</span>
          <span>Set Username</span>
        </button>
        {!isOnline && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Connect to the internet to set a username
          </p>
        )}
        <SetUsernameSheet
          open={showUsernameSheet}
          onClose={() => setShowUsernameSheet(false)}
          currentUsername={null}
          onUsernameSet={handleUsernameSet}
        />
      </div>
    );
  }

  return (
    <div className="st-section">
      <h3>Friends</h3>

      {/* ── Username display ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{ color: 'var(--text)', fontSize: 15, fontWeight: 600 }}>
          @{cloudProfile.username}
        </span>
        <button
          onClick={() => setShowUsernameSheet(true)}
          disabled={!isOnline}
          style={{
            background: 'none', border: 'none', color: 'var(--primary)',
            fontSize: 13, cursor: 'pointer', padding: '4px 8px',
            opacity: isOnline ? 1 : 0.5,
          }}
        >
          Change
        </button>
      </div>

      {/* ── Search ── */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearch}
          placeholder="Search by username…"
          disabled={!isOnline}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          style={{
            width: '100%', padding: '10px 12px', fontSize: 15,
            border: '1.5px solid var(--border)', borderRadius: 10,
            background: 'var(--card)', color: 'var(--text)',
            outline: 'none', boxSizing: 'border-box',
            opacity: isOnline ? 1 : 0.6,
          }}
        />
        {searching && (
          <span style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14,
          }}>⏳</span>
        )}
      </div>

      {/* ── Search results ── */}
      <AnimatePresence>
        {searchResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginBottom: 12, overflow: 'hidden' }}
          >
            {searchResults.map(user => {
              const rel = getRelationship(user.user_id);
              const avatar = getAvatar(user.avatar_id);
              return (
                <div key={user.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.display_name || user.username}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{user.username}</div>
                  </div>
                  {rel === 'friends' ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Friends ✓</span>
                  ) : rel === 'requested' ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Requested</span>
                  ) : rel === 'incoming' ? (
                    <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>Accept?</span>
                  ) : rel === 'blocked' ? null : (
                    <button
                      onClick={() => handleAddFriend(user.user_id)}
                      disabled={actionLoading === user.user_id}
                      style={{
                        padding: '6px 12px', fontSize: 13, fontWeight: 600,
                        border: '1.5px solid var(--primary)', borderRadius: 8,
                        background: 'var(--primary)', color: '#fff',
                        cursor: 'pointer', whiteSpace: 'nowrap',
                        opacity: actionLoading === user.user_id ? 0.6 : 1,
                      }}
                    >
                      {actionLoading === user.user_id ? '…' : 'Add'}
                    </button>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pending inbound ── */}
      {pendingIn.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
            Friend Requests ({pendingIn.length})
          </h4>
          <AnimatePresence>
            {pendingIn.map(f => {
              const avatar = getAvatar(f.avatarId);
              return (
                <motion.div
                  key={f.id}
                  layout
                  layoutId={`friend-${f.id}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.displayName || f.username || 'User'}
                    </div>
                    {f.username && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{f.username}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleAccept(f.id)}
                      disabled={actionLoading === f.id}
                      style={{
                        padding: '5px 10px', fontSize: 13, fontWeight: 600,
                        border: '1.5px solid var(--primary)', borderRadius: 8,
                        background: 'var(--primary)', color: '#fff', cursor: 'pointer',
                        opacity: actionLoading === f.id ? 0.6 : 1,
                      }}
                    >Accept</button>
                    <button
                      onClick={() => handleDecline(f.id)}
                      disabled={actionLoading === f.id}
                      style={{
                        padding: '5px 10px', fontSize: 13, fontWeight: 600,
                        border: '1.5px solid var(--border)', borderRadius: 8,
                        background: 'var(--card)', color: 'var(--text-muted)', cursor: 'pointer',
                        opacity: actionLoading === f.id ? 0.6 : 1,
                      }}
                    >Decline</button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Friends list ── */}
      {friends.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 6px' }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              Friends ({friends.length})
            </h4>
            <div style={{ display: 'flex', gap: 4 }}>
              {SORT_MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setSortMode(m.key)}
                  style={{
                    padding: '3px 8px', fontSize: 11, fontWeight: 600,
                    borderRadius: 6,
                    border: `1px solid ${sortMode === m.key ? 'var(--primary)' : 'var(--border)'}`,
                    background: sortMode === m.key ? 'rgba(var(--primary-rgb, 255,107,53), 0.1)' : 'transparent',
                    color: sortMode === m.key ? 'var(--primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.25,1,0.5,1)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <AnimatePresence>
            {sortedFriends.map(f => {
              const avatar = getAvatar(f.avatarId);
              return (
                <motion.div
                  key={f.id}
                  layout
                  layoutId={`friend-${f.id}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.displayName || f.username || 'Friend'}
                    </div>
                    {f.username && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{f.username}</div>}
                  </div>
                  {/* Favorite star */}
                  <motion.button
                    onClick={() => toggleFavorite(f.id)}
                    whileTap={{ scale: 1.3 }}
                    style={{
                      background: 'none', border: 'none', padding: '2px 4px',
                      cursor: 'pointer', fontSize: 16, lineHeight: 1,
                      color: f.favorite ? '#FFD700' : 'var(--border)',
                      transition: 'color 0.2s',
                    }}
                    aria-label={f.favorite ? 'Unstar friend' : 'Star friend'}
                    title={f.favorite ? 'Favorited' : 'Add to favorites'}
                  >
                    {f.favorite ? '★' : '☆'}
                  </motion.button>
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOverflowOpen(prev => prev === f.otherUserId ? null : f.otherUserId)}
                      disabled={actionLoading === f.id || actionLoading === f.otherUserId}
                      style={{
                        padding: '4px 8px', fontSize: 16, lineHeight: 1,
                        border: '1px solid var(--border)', borderRadius: 8,
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                      }}
                      aria-label="More options"
                    >⋯</button>
                    {overflowOpen === f.otherUserId && (
                      <div style={{
                        position: 'absolute', right: 0, top: '100%', marginTop: 4,
                        background: 'var(--card)', border: '1.5px solid var(--border)',
                        borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                        zIndex: 20, minWidth: 140, overflow: 'hidden',
                      }}>
                        <button
                          onClick={() => handleUnfriend(f.id, f.displayName || f.username)}
                          style={{
                            display: 'block', width: '100%', padding: '10px 14px',
                            fontSize: 13, fontWeight: 600, textAlign: 'left',
                            border: 'none', background: 'transparent',
                            color: 'var(--text)', cursor: 'pointer',
                          }}
                        >Remove Friend</button>
                        <button
                          onClick={() => handleBlock(f.otherUserId, f.displayName || f.username)}
                          style={{
                            display: 'block', width: '100%', padding: '10px 14px',
                            fontSize: 13, fontWeight: 600, textAlign: 'left',
                            border: 'none', borderTop: '1px solid var(--border)',
                            background: 'transparent',
                            color: '#e53935', cursor: 'pointer',
                          }}
                        >Block</button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '24px 16px 20px', margin: '0 0 12px',
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 16,
          }}
        >
          {/* Pixel chef — subtle idle bob */}
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}
            aria-hidden="true"
          >
            👨‍🍳
          </motion.div>
          <p style={{
            color: 'var(--text)', fontSize: 14, fontWeight: 600,
            margin: '0 0 4px', textAlign: 'center',
          }}>
            No friends yet
          </p>
          <p style={{
            color: 'var(--text-muted)', fontSize: 13,
            margin: '0 0 12px', textAlign: 'center', maxWidth: 240,
          }}>
            Share your username so friends can find you, or search above to add someone.
          </p>
          {cloudProfile?.username && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                navigator.clipboard?.writeText(cloudProfile.username).then(() => {
                  showToast?.('Username copied!', 'success', 1500);
                }).catch(() => {});
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10,
                fontSize: 13, fontWeight: 600,
                border: '1.5px solid var(--primary)',
                background: 'rgba(var(--primary-rgb, 255,107,53), 0.08)',
                color: 'var(--primary)', cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              📋 Copy @{cloudProfile.username}
            </motion.button>
          )}
        </motion.div>
      )}

      {/* ── Sent requests (collapsed by default) ── */}
      {pendingOut.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowSent(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {showSent ? '▾' : '▸'} Sent Requests ({pendingOut.length})
          </button>
          <AnimatePresence>
            {showSent && pendingOut.map(f => {
              const avatar = getAvatar(f.avatarId);
              return (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    marginTop: 6, overflow: 'hidden',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.displayName || f.username || 'User'}
                    </div>
                    {f.username && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{f.username}</div>}
                  </div>
                  <button
                    onClick={() => handleCancel(f.id)}
                    disabled={actionLoading === f.id}
                    style={{
                      padding: '5px 10px', fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--border)', borderRadius: 8,
                      background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                      opacity: actionLoading === f.id ? 0.6 : 1,
                    }}
                  >Cancel</button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Blocked (collapsed by default) ── */}
      {blocked.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowBlocked(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {showBlocked ? '▾' : '▸'} Blocked ({blocked.length})
          </button>
          <AnimatePresence>
            {showBlocked && blocked.map(f => {
              const avatar = getAvatar(f.avatarId);
              return (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    marginTop: 6, overflow: 'hidden',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.displayName || f.username || 'User'}
                    </div>
                    {f.username && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{f.username}</div>}
                  </div>
                  <button
                    onClick={() => handleUnblock(f.otherUserId)}
                    disabled={actionLoading === f.otherUserId}
                    style={{
                      padding: '5px 10px', fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--border)', borderRadius: 8,
                      background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                      opacity: actionLoading === f.otherUserId ? 0.6 : 1,
                    }}
                  >Unblock</button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Username sheet portal ── */}
      <SetUsernameSheet
        open={showUsernameSheet}
        onClose={() => setShowUsernameSheet(false)}
        currentUsername={cloudProfile?.username}
        onUsernameSet={handleUsernameSet}
      />
    </div>
  );
}
