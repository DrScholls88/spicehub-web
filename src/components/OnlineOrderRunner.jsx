import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ExternalLink, Check, ChevronLeft, Copy } from 'lucide-react';
import { hapticLight, hapticSuccess } from '../haptics';
import './StoreMode.css';

// Guided online-order pass — the no-API substitute for a cart integration.
// One item card at a time: "Find on <store>" opens that store's own search in
// a new tab, the user adds it to their cart there, comes back and taps Added /
// Skip / move-to-another-store. "Added" checks the grocery row off, so the
// pass survives closing the app. Deep-link search only — no credentials, no
// automation (see groceryStores.js STORES).
//
// lines: [{ key, query, detail, tags, indices }] — snapshotted on open so
// checking or moving rows doesn't reshuffle the deck mid-pass.
export default function OnlineOrderRunner({ store, lines, otherStores, onSetChecked, onMove, onCopy, onExit }) {
  const [deck] = useState(() => lines);
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState({}); // key -> 'added' | 'skipped' | 'moved'
  const cardRef = useRef(null);

  const done = pos >= deck.length;
  const line = deck[pos];
  const status = line ? result[line.key] : null;

  useEffect(() => { cardRef.current?.focus(); }, [pos]);

  const advance = (key, value) => {
    setResult(r => ({ ...r, [key]: value }));
    setPos(p => p + 1);
  };

  const find = () => {
    hapticLight();
    window.open(store.searchUrl + encodeURIComponent(line.query), '_blank', 'noopener,noreferrer');
  };
  const added = () => { hapticSuccess(); onSetChecked(line.indices, true); advance(line.key, 'added'); };
  const skip = () => { hapticLight(); onSetChecked(line.indices, false); advance(line.key, 'skipped'); };
  const move = (s) => { hapticLight(); onMove(line.indices, s.id); advance(line.key, 'moved'); };

  const counts = Object.values(result).reduce((acc, v) => ({ ...acc, [v]: (acc[v] || 0) + 1 }), {});
  const skippedLines = deck.filter(l => result[l.key] === 'skipped');

  return (
    <motion.div className="sm-overlay oo-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label={`Order ${store.name} online`}>
      <div className="oo-header">
        <button type="button" className="oo-exit" onClick={onExit} aria-label="Close online order">
          <X size={20} aria-hidden="true" /> <span>Done</span>
        </button>
        <span className="oo-title">{store.name} online</span>
        <span className="oo-count" aria-live="polite">{Math.min(pos + 1, deck.length)} / {deck.length}</span>
      </div>
      <div className="oo-progress" aria-hidden="true">
        <div className="oo-progress-fill" style={{ width: `${deck.length ? (pos / deck.length) * 100 : 0}%` }} />
      </div>

      {!done ? (
        <div className="oo-body">
          <div className="oo-card" ref={cardRef} tabIndex={-1}>
            <div className="oo-query">{line.query}</div>
            {line.detail && line.detail.toLowerCase() !== line.query.toLowerCase() && (
              <div className="oo-detail">{line.detail}</div>
            )}
            {line.tags.length > 0 && <div className="oo-tags">{line.tags.join(' · ')}</div>}
            {status && <div className="oo-status">Marked {status}</div>}
          </div>

          <button type="button" className="oo-find" onClick={find}>
            Find on {store.name} <ExternalLink size={18} aria-hidden="true" />
          </button>

          <div className="oo-row">
            <button type="button" className="oo-added" onClick={added}>
              <Check size={20} aria-hidden="true" /> Added to cart
            </button>
            <button type="button" className="oo-skip" onClick={skip}>Skip</button>
          </div>

          {otherStores.length > 0 && (
            <div className="oo-move">
              <span className="oo-move-label">Not at {store.name}? Move to</span>
              <div className="oo-move-chips">
                {otherStores.map(s => (
                  <button type="button" key={s.id} className="oo-chip" onClick={() => move(s)}>{s.name}</button>
                ))}
              </div>
            </div>
          )}

          <button type="button" className="oo-prev" onClick={() => setPos(p => Math.max(0, p - 1))} disabled={pos === 0}>
            <ChevronLeft size={18} aria-hidden="true" /> Previous
          </button>
        </div>
      ) : (
        <div className="oo-body oo-done">
          <div className="oo-done-icon" aria-hidden="true"><Check size={36} strokeWidth={2.5} /></div>
          <p className="oo-done-title">Pass complete</p>
          <p className="oo-done-sub">
            {counts.added || 0} added · {counts.skipped || 0} skipped{counts.moved ? ` · ${counts.moved} moved` : ''}
          </p>
          {skippedLines.length > 0 && (
            <button type="button" className="oo-skip" onClick={() => onCopy(skippedLines)}>
              <Copy size={18} aria-hidden="true" /> Copy skipped items
            </button>
          )}
          <button type="button" className="oo-find" onClick={onExit}>Back to list</button>
          <button type="button" className="oo-prev" onClick={() => setPos(deck.length - 1)}>
            <ChevronLeft size={18} aria-hidden="true" /> Review last item
          </button>
        </div>
      )}
    </motion.div>
  );
}
