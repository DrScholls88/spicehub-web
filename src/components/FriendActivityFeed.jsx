/**
 * FriendActivityFeed — Tier 2 pick from the 2026-08-05 brainstorm doc.
 * "A timeline of recent friend activity: shares sent/received, new friends
 * added." Renders as a lightweight collapsible feed at the top of the
 * Friends tab, above search — matches the doc's "lightweight feed on the
 * Friends tab" framing.
 *
 * Online-only (see src/lib/friendActivity.js for why there's no offline
 * cache for this). Silently renders nothing when offline or empty so it
 * never competes for space with the friends list itself.
 */
import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getFriendActivity, describeActivity } from '../lib/friendActivity';
import { getAvatar } from '../data/pixelAvatars';

const PAGE_SIZE = 15;

/** Compact relative time — "just now", "5m ago", "3h ago", "2d ago". */
function relativeTime(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * @param {{ isOnline: boolean }} props
 */
export default function FriendActivityFeed({ isOnline }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    setLoading(true);
    setErrored(false);
    try {
      const rows = await getFriendActivity({ limit: PAGE_SIZE });
      setItems(rows);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    load();
    // Refresh whenever friends/shares state changes elsewhere in the app —
    // new friend accepted, share sent/received, reaction landed.
    const handler = () => load();
    window.addEventListener('spicehub:friends-updated', handler);
    window.addEventListener('spicehub:shares-updated', handler);
    window.addEventListener('spicehub:friends-bootstrap', handler);
    return () => {
      window.removeEventListener('spicehub:friends-updated', handler);
      window.removeEventListener('spicehub:shares-updated', handler);
      window.removeEventListener('spicehub:friends-bootstrap', handler);
    };
  }, [load]);

  // Nothing to show and nothing wrong — don't take up space.
  if (!isOnline && items.length === 0) return null;
  if (!loading && !errored && items.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'none', border: 'none', padding: '0 0 6px', cursor: 'pointer',
          color: 'var(--text)', fontSize: 14, fontWeight: 700,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{expanded ? '▾' : '▸'}</span>
        Recent Activity
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            {loading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>Loading…</p>
            ) : errored ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>
                Couldn't load recent activity.
              </p>
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                marginBottom: 8,
              }}>
                {items.map((item, idx) => {
                  const { emoji, text } = describeActivity(item);
                  const avatar = getAvatar(item.otherAvatarId);
                  return (
                    <div
                      key={`${item.activityType}-${item.otherUserId}-${item.occurredAt}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 2px',
                      }}
                    >
                      <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>
                        {emoji}
                      </span>
                      <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden="true">
                        {avatar.emoji}
                      </span>
                      <span style={{
                        flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {text}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {relativeTime(item.occurredAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
