/**
 * SharedWithYouSection — inline section at top of MealLibrary showing
 * pending recipe shares from friends.
 *
 * Each card: recipe name, sender, note, Save / Dismiss actions.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §4
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isFriendsEnabled } from '../lib/supabaseClient';
import {
  getLocalPendingShares,
  saveShareToLibrary,
  dismissShare,
  reactToShare,
  SHARE_REACTIONS,
} from '../lib/recipeShare';
import { getAvatar } from '../data/pixelAvatars';

/**
 * @param {{ onToast?: Function, onReload?: Function }} props
 */
export default function SharedWithYouSection({ onToast, onReload }) {
  const [shares, setShares] = useState([]);
  const [actionLoading, setActionLoading] = useState(null); // shareId being acted on

  const refresh = useCallback(async () => {
    if (!isFriendsEnabled()) return;
    try {
      const s = await getLocalPendingShares();
      setShares(s || []);
    } catch {
      setShares([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('spicehub:shares-updated', refresh);
    window.addEventListener('spicehub:friends-bootstrap', refresh);
    return () => {
      window.removeEventListener('spicehub:shares-updated', refresh);
      window.removeEventListener('spicehub:friends-bootstrap', refresh);
    };
  }, [refresh]);

  const handleSave = async (shareId) => {
    setActionLoading(shareId);
    const result = await saveShareToLibrary(shareId);
    if (result.success) {
      onToast?.('Recipe saved to library!', 'success', 2500);
      onReload?.();
    } else {
      onToast?.(result.error || 'Failed to save', 'error', 3000);
    }
    await refresh();
    window.dispatchEvent(new CustomEvent('spicehub:shares-updated'));
    setActionLoading(null);
  };

  const handleDismiss = async (shareId) => {
    setActionLoading(shareId);
    await dismissShare(shareId);
    await refresh();
    window.dispatchEvent(new CustomEvent('spicehub:shares-updated'));
    setActionLoading(null);
  };

  if (!isFriendsEnabled() || shares.length === 0) return null;

  return (
    <div style={{ padding: '0 12px', marginBottom: 12 }}>
      <h4 style={{
        fontSize: 14, fontWeight: 700, color: 'var(--text)',
        margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        📬 Shared with you
        <span style={{
          fontSize: 11, fontWeight: 700, background: 'var(--primary)', color: '#fff',
          borderRadius: 8, padding: '1px 6px', lineHeight: '16px',
        }}>{shares.length}</span>
      </h4>
      <AnimatePresence>
        {shares.map(share => {
          const avatar = getAvatar(null); // sender avatar not stored locally; use default
          const isLoading = actionLoading === share.id;
          return (
            <motion.div
              key={share.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -30, height: 0, marginBottom: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '10px 12px', borderRadius: 12,
                background: 'var(--card)', border: '1.5px solid var(--primary)',
                marginBottom: 8,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {share.recipeData?.imageUrl && (
                  <img
                    src={share.recipeData.imageUrl}
                    alt=""
                    style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {share.recipeData?.name || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    from {share.fromDisplayName || share.fromUsername ? `@${share.fromUsername}` : 'a friend'}
                    {share.itemType === 'drink' ? ' · Drink' : ''}
                  </div>
                </div>
              </div>

              {/* Note */}
              {share.note && (
                <p style={{
                  fontSize: 13, color: 'var(--text-muted)', margin: 0,
                  fontStyle: 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  "{share.note}"
                </p>
              )}

              {/* Emoji reaction row */}
              <div style={{
                display: 'flex', gap: 4, alignItems: 'center',
                flexWrap: 'wrap',
              }}>
                {SHARE_REACTIONS.map(emoji => {
                  const isActive = share.reaction === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => reactToShare(share.id, isActive ? null : emoji).then(refresh)}
                      disabled={isLoading}
                      style={{
                        padding: '3px 6px', fontSize: 16, lineHeight: 1,
                        border: `1.5px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 8,
                        background: isActive ? 'rgba(var(--primary-rgb, 255,107,53), 0.1)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        transform: isActive ? 'scale(1.15)' : 'scale(1)',
                      }}
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleSave(share.id)}
                  disabled={isLoading}
                  style={{
                    flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 700,
                    border: '1.5px solid var(--primary)', borderRadius: 8,
                    background: 'var(--primary)', color: '#fff', cursor: 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  {isLoading ? '…' : 'Save to Library'}
                </button>
                <button
                  onClick={() => handleDismiss(share.id)}
                  disabled={isLoading}
                  style={{
                    padding: '8px 14px', fontSize: 13, fontWeight: 600,
                    border: '1px solid var(--border)', borderRadius: 8,
                    background: 'var(--card)', color: 'var(--text-muted)', cursor: 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
