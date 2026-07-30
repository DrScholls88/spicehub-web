/**
 * SharePickerSheet — pick friends to share a recipe with.
 * Bottom sheet with friend list, multi-select, optional note, send.
 *
 * Opened from long-press quick-preview or MealDetail "Send to Friend".
 * Works for both meals and drinks.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §4
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getLocalFriends } from '../lib/friends';
import { sendRecipeShareToMany } from '../lib/recipeShare';
import { isFriendsEnabled } from '../lib/supabaseClient';
import { getAvatar } from '../data/pixelAvatars';

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   meal: object | null,
 *   itemType: 'meal' | 'drink',
 *   showToast?: Function,
 * }} props
 */
export default function SharePickerSheet({ open, onClose, meal, itemType = 'meal', showToast }) {
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load friends on open
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setNote('');
    setSending(false);
    setLoading(true);
    (async () => {
      try {
        const f = await getLocalFriends();
        setFriends(f || []);
      } catch {
        setFriends([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const toggleFriend = useCallback((userId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const handleSend = async () => {
    if (selected.size === 0 || !meal || sending) return;
    setSending(true);

    const result = await sendRecipeShareToMany(
      Array.from(selected), meal, itemType, note.trim(),
    );

    if (result.sent > 0) {
      const plural = result.sent > 1 ? `${result.sent} friends` : '1 friend';
      showToast?.(`Sent to ${plural}!`, 'success', 2500);
    }
    if (result.failed > 0) {
      const firstErr = result.errors[0]?.error || 'Some sends failed';
      showToast?.(firstErr, 'error', 3000);
    }

    setSending(false);
    onClose();
  };

  if (!open || !isFriendsEnabled()) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="st-overlay"
          style={{ zIndex: 1100 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="st-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: '70vh' }}
          >
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title" style={{ fontSize: '18px' }}>
                Send to Friends
              </h2>
              <button className="st-close" onClick={onClose}>✕</button>
            </div>

            <div className="st-content" style={{ padding: '0 16px 20px' }}>
              {/* Recipe name being shared */}
              {meal && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  marginBottom: 12,
                }}>
                  {meal.imageUrl && (
                    <img
                      src={meal.imageUrl}
                      alt=""
                      style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {meal.name || 'Untitled'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {itemType === 'drink' ? 'Drink' : 'Recipe'}
                    </div>
                  </div>
                </div>
              )}

              {/* Friend list */}
              {loading ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                  Loading friends…
                </p>
              ) : friends.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                  No friends yet — add friends in Settings to share recipes.
                </p>
              ) : (
                <div style={{ maxHeight: '35vh', overflowY: 'auto', marginBottom: 12 }}>
                  {friends.map(f => {
                    const avatar = getAvatar(f.avatarId);
                    const isSelected = selected.has(f.otherUserId);
                    return (
                      <button
                        key={f.otherUserId}
                        type="button"
                        onClick={() => toggleFriend(f.otherUserId)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          width: '100%', padding: '10px 12px',
                          border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                          borderRadius: 10,
                          background: isSelected ? 'rgba(var(--primary-rgb, 255,107,53), 0.08)' : 'var(--card)',
                          cursor: 'pointer', marginBottom: 6,
                          transition: 'border-color 0.15s, background 0.15s',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: 22 }}>{avatar.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14, fontWeight: 600, color: 'var(--text)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {f.displayName || f.username || 'Friend'}
                          </div>
                          {f.username && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{f.username}</div>
                          )}
                        </div>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          border: `2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                          background: isSelected ? 'var(--primary)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all 0.15s',
                        }}>
                          {isSelected && (
                            <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Note input */}
              {friends.length > 0 && (
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 280))}
                  placeholder="Add a note (optional)"
                  maxLength={280}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 14,
                    border: '1.5px solid var(--border)', borderRadius: 10,
                    background: 'var(--card)', color: 'var(--text)',
                    outline: 'none', boxSizing: 'border-box',
                    marginBottom: 12,
                  }}
                />
              )}

              {/* Send button */}
              <button
                className="st-install-btn"
                disabled={selected.size === 0 || sending}
                onClick={handleSend}
                style={{
                  justifyContent: 'center',
                  opacity: selected.size > 0 && !sending ? 1 : 0.5,
                  background: selected.size > 0 && !sending ? 'var(--primary)' : undefined,
                  color: selected.size > 0 && !sending ? '#fff' : undefined,
                  borderColor: selected.size > 0 && !sending ? 'var(--primary)' : undefined,
                }}
              >
                {sending
                  ? 'Sending…'
                  : selected.size === 0
                  ? 'Select friends'
                  : `Send to ${selected.size} friend${selected.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
