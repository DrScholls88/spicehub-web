/**
 * SharePickerSheet — pick friends to share a recipe with.
 * Bottom sheet with friend list, multi-select, optional note, send.
 *
 * Opened from long-press quick-preview or MealDetail "Send to Friend".
 * Works for both meals and drinks.
 *
 * T0-1 upgrades: random quips, success confetti burst, friend-row
 * entrance stagger + selection spring, offline draft queueing.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §4
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getLocalFriends } from '../lib/friends';
import { sendRecipeShareToMany } from '../lib/recipeShare';
import { isFriendsEnabled } from '../lib/supabaseClient';
import { getAvatar } from '../data/pixelAvatars';
import useOnlineStatus from '../hooks/useOnlineStatus';

// ── Quips that rotate on each open ──────────────────────────────────────────
const SHARE_QUIPS = [
  'Ship it to the kitchen',
  'Pass the recipe',
  'Spread the flavor',
  'Drop it in their inbox',
  'Serve it up',
  'Send the goods',
  'Share the secret',
];

const DRINK_QUIPS = [
  'Pour one for a friend',
  'Round on the house',
  'Mix it their way',
  'Cheers, coming through',
  'Slide it down the bar',
];

function pickQuip(isDrink) {
  const list = isDrink ? DRINK_QUIPS : SHARE_QUIPS;
  return list[Math.floor(Math.random() * list.length)];
}

// ── Confetti burst (lightweight, CSS-only particles) ────────────────────────
function ConfettiBurst({ active }) {
  const particles = useMemo(() => {
    if (!active) return [];
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 220,
      y: -(40 + Math.random() * 120),
      r: Math.random() * 360,
      s: 0.5 + Math.random() * 0.6,
      color: ['var(--primary)', '#FFD700', '#4CAF50', '#2196F3', '#E91E63', '#FF9800'][i % 6],
      delay: Math.random() * 0.15,
    }));
  }, [active]);

  if (!active) return null;

  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%',
      pointerEvents: 'none', zIndex: 30,
    }}>
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, scale: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: p.x, y: p.y, scale: p.s,
            rotate: p.r, opacity: 0,
          }}
          transition={{
            duration: 0.7 + Math.random() * 0.3,
            delay: p.delay,
            ease: [0.25, 1, 0.5, 1],
          }}
          style={{
            position: 'absolute',
            width: 8, height: 8,
            borderRadius: Math.random() > 0.5 ? '50%' : 2,
            background: p.color,
          }}
        />
      ))}
    </div>
  );
}

// ── Friend row spring animation variants ────────────────────────────────────
const friendRowVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.96 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: {
      delay: i * 0.04,
      duration: 0.35,
      ease: [0.25, 1, 0.5, 1],
    },
  }),
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
};

const checkVariants = {
  unchecked: { scale: 1, borderColor: 'var(--border)' },
  checked: {
    scale: [1, 1.25, 1],
    transition: { duration: 0.25, ease: [0.25, 1, 0.5, 1] },
  },
};

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   meal: object | null,
 *   itemType: 'meal' | 'drink',
 *   showToast?: Function,
 *   isOnline?: boolean,
 * }} props
 */
export default function SharePickerSheet({ open, onClose, meal, itemType = 'meal', showToast, isOnline: isOnlineProp }) {
  const { isOnline: hookOnline } = useOnlineStatus();
  const isOnline = isOnlineProp !== undefined ? isOnlineProp : hookOnline;
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const quipRef = useRef('');

  // Pick a fresh quip each time the sheet opens
  useEffect(() => {
    if (open) quipRef.current = pickQuip(itemType === 'drink');
  }, [open, itemType]);

  // Load friends on open
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setNote('');
    setSending(false);
    setLoading(true);
    setShowConfetti(false);
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

    const names = friends
      .filter(f => selected.has(f.otherUserId))
      .map(f => f.displayName || f.username || 'a friend');
    const nameStr = names.length <= 2 ? names.join(' & ') : `${names.length} friends`;

    if (result.sent > 0) {
      // Fire confetti
      setShowConfetti(true);
      showToast?.(`Sent to ${nameStr}!`, 'success', 2500);
      setTimeout(() => {
        setSending(false);
        setShowConfetti(false);
        onClose();
      }, 600);
      return;
    }
    if (result.queued > 0) {
      showToast?.(`Queued for ${nameStr} — will send when online`, 'info', 3000);
      setSending(false);
      onClose();
      return;
    }
    if (result.failed > 0) {
      const firstErr = result.errors[0]?.error || 'Some sends failed';
      showToast?.(firstErr, 'error', 3000);
    }

    setSending(false);
    onClose();
  };

  // Build personalized CTA text with first selected friend name
  const ctaText = useMemo(() => {
    if (sending) return 'Sending…';
    if (selected.size === 0) return 'Select friends';
    if (!isOnline) {
      return selected.size === 1 ? 'Queue for later' : `Queue ${selected.size} for later`;
    }
    if (selected.size === 1) {
      const f = friends.find(fr => selected.has(fr.otherUserId));
      const name = f?.displayName || f?.username || 'friend';
      return `Send to ${name}`;
    }
    return `Send to ${selected.size} friends`;
  }, [sending, isOnline, selected, friends]);

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
            style={{ maxHeight: '70vh', position: 'relative', overflow: 'hidden' }}
          >
            <ConfettiBurst active={showConfetti} />
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title" style={{ fontSize: '18px' }}>
                {quipRef.current || 'Send to Friends'}
              </h2>
              <button className="st-close" onClick={onClose}>✕</button>
            </div>

            <div className="st-content" style={{ padding: '0 16px 20px', overflowY: 'auto' }}>
              {/* Recipe preview card */}
              {meal && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 12,
                    background: 'var(--surface-2, var(--card))',
                    border: '1px solid var(--border)',
                    marginBottom: 12,
                  }}
                >
                  {meal.imageUrl && (
                    <img
                      src={meal.imageUrl}
                      alt=""
                      style={{
                        width: 44, height: 44, borderRadius: 10,
                        objectFit: 'cover', flexShrink: 0,
                      }}
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
                </motion.div>
              )}

              {/* Friend list with staggered entrance */}
              {loading ? (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      border: '2.5px solid var(--border)',
                      borderTopColor: 'var(--primary)',
                      margin: '0 auto 8px',
                    }}
                  />
                  <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
                    Loading friends…
                  </p>
                </div>
              ) : friends.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                  No friends yet — add friends in Settings to share recipes.
                </p>
              ) : (
                <div style={{ maxHeight: '35vh', overflowY: 'auto', marginBottom: 12 }}>
                  <AnimatePresence>
                    {friends.map((f, i) => {
                      const avatar = getAvatar(f.avatarId);
                      const isSelected = selected.has(f.otherUserId);
                      return (
                        <motion.button
                          key={f.otherUserId}
                          type="button"
                          custom={i}
                          variants={friendRowVariants}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          onClick={() => toggleFriend(f.otherUserId)}
                          whileTap={{ scale: 0.97 }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            width: '100%', padding: '10px 12px',
                            border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                            borderRadius: 12,
                            background: isSelected ? 'rgba(var(--primary-rgb, 255,107,53), 0.08)' : 'var(--card)',
                            cursor: 'pointer', marginBottom: 6,
                            transition: 'border-color 0.2s cubic-bezier(0.25,1,0.5,1), background 0.2s cubic-bezier(0.25,1,0.5,1)',
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
                          <motion.div
                            animate={isSelected ? 'checked' : 'unchecked'}
                            variants={checkVariants}
                            style={{
                              width: 22, height: 22, borderRadius: '50%',
                              border: `2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                              background: isSelected ? 'var(--primary)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                              transition: 'border-color 0.2s, background 0.2s',
                            }}
                          >
                            <AnimatePresence>
                              {isSelected && (
                                <motion.span
                                  initial={{ scale: 0, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0, opacity: 0 }}
                                  transition={{ duration: 0.15 }}
                                  style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}
                                >
                                  ✓
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        </motion.button>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Note input */}
              {friends.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value.slice(0, 280))}
                    placeholder="Add a note (optional)"
                    maxLength={280}
                    rows={2}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: 14,
                      border: '1.5px solid var(--border)', borderRadius: 10,
                      background: 'var(--card)', color: 'var(--text)',
                      outline: 'none', boxSizing: 'border-box',
                      resize: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <div style={{
                    textAlign: 'right', fontSize: 12,
                    color: note.length > 260 ? 'var(--primary)' : 'var(--text-muted)',
                    marginTop: 2,
                  }}>
                    {note.length}/280
                  </div>
                </div>
              )}

              {/* Send button */}
              {!isOnline && selected.size > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', margin: '0 0 6px' }}>
                  Offline — shares will be sent when you reconnect
                </p>
              )}
              <motion.button
                className="st-install-btn"
                disabled={selected.size === 0 || sending}
                onClick={handleSend}
                whileTap={{ scale: 0.97 }}
                style={{
                  justifyContent: 'center',
                  opacity: selected.size > 0 && !sending ? 1 : 0.5,
                  background: selected.size > 0 && !sending ? 'var(--primary)' : undefined,
                  color: selected.size > 0 && !sending ? '#fff' : undefined,
                  borderColor: selected.size > 0 && !sending ? 'var(--primary)' : undefined,
                  transition: 'all 0.25s cubic-bezier(0.25,1,0.5,1)',
                }}
              >
                {ctaText}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
