/**
 * ShareHistorySheet — Tier 1 "Share History View" from the 2026-08-05
 * brainstorm doc: "Recipes I've exchanged with Sarah." Opens when a friend
 * row is tapped in FriendsSection. Shows the full sent + received history
 * with that friend, newest first, regardless of status.
 *
 * Online-only: queries Supabase directly (see getShareHistoryWithFriend in
 * lib/recipeShare.js) rather than a local cache, since the local Dexie
 * recipeShares table only ever holds pending/bookmarked shares — saved and
 * dismissed shares are already gone from the local cache by design.
 *
 * Reuses the same st-sheet/st-overlay chrome as FriendsSheet/Settings for
 * visual consistency instead of inventing new sheet styling.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import { getShareHistoryWithFriend } from '../lib/recipeShare';
import AvatarCircle from './AvatarCircle';

const sheetVariants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { type: 'spring', damping: 30, stiffness: 300 } },
  exit: { y: '100%', transition: { duration: 0.25 } },
};

const STATUS_LABEL = {
  pending: 'Pending',
  saved: 'Saved',
  dismissed: 'Dismissed',
  bookmarked: 'Want to Try',
};

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: Function,
 *   friend: { otherUserId: string, displayName?: string, username?: string, avatarId?: string } | null,
 *   isOnline: boolean,
 * }} props
 */
export default function ShareHistorySheet({ open, onClose, friend, isOnline }) {
  const swipe = useSwipeDismiss(onClose);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!friend?.otherUserId || !isOnline) return;
    setLoading(true);
    setError('');
    try {
      const rows = await getShareHistoryWithFriend(friend.otherUserId);
      setHistory(rows);
    } catch (err) {
      setError(err.message || "Couldn't load share history.");
    } finally {
      setLoading(false);
    }
  }, [friend?.otherUserId, isOnline]);

  useEffect(() => {
    if (open) load();
    if (!open) { setHistory([]); setError(''); }
  }, [open, load]);

  const friendLabel = friend?.displayName || (friend?.username ? `@${friend.username}` : 'this friend');

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="st-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="st-sheet"
            ref={swipe.sheetRef}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onTouchStart={swipe.handleTouchStart}
            onTouchMove={swipe.handleTouchMove}
            onTouchEnd={swipe.handleTouchEnd}
          >
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AvatarCircle
                  avatarUrl={friend?.avatarUrl}
                  avatarId={friend?.avatarId}
                  displayName={friend?.displayName}
                  username={friend?.username}
                  size={28}
                />
                {friendLabel}
              </h2>
              <button className="st-close" onClick={onClose}>✕</button>
            </div>
            <div className="st-content">
              {!isOnline ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 4px' }}>
                  Connect to the internet to view share history.
                </p>
              ) : loading ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 4px' }}>Loading…</p>
              ) : error ? (
                <div style={{ padding: '8px 4px' }}>
                  <p style={{ color: 'var(--error, #e53935)', fontSize: 14, margin: '0 0 8px' }}>{error}</p>
                  <button className="st-install-btn" onClick={load}>Try again</button>
                </div>
              ) : history.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 4px', textAlign: 'center' }}>
                  No recipes exchanged with {friendLabel} yet. Share one from a recipe's detail page!
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                  {history.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 12,
                        background: 'var(--card)', border: '1px solid var(--border)',
                      }}
                    >
                      {item.recipeData?.imageUrl ? (
                        <img
                          src={item.recipeData.imageUrl}
                          alt=""
                          style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : (
                        <span style={{ fontSize: 22, width: 40, textAlign: 'center', flexShrink: 0 }} aria-hidden="true">
                          {item.itemType === 'drink' ? '🍸' : '🍽️'}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 600, color: 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {item.recipeData?.name || 'Untitled'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{item.direction === 'sent' ? `📤 You → ${friendLabel}` : `📥 ${friendLabel} → You`}</span>
                          <span>·</span>
                          <span>{formatDate(item.createdAt)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                          border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px',
                        }}>
                          {STATUS_LABEL[item.status] || item.status}
                        </span>
                        {item.reaction && <span style={{ fontSize: 16 }}>{item.reaction}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
