import { useState, useEffect, useCallback } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, RefreshCw, AlertTriangle, CheckCircle2, ChevronRight, Loader2, Inbox } from 'lucide-react';
import { getBatchQueueItems, deleteBatchQueueItem, setBatchItemType, clearFinishedBatchItems } from '../db';

const STATUS_LABELS = {
  pending: 'Queued',
  extracting: 'Extracting…',
  ready: 'Ready to review',
  failed: 'Failed',
  saved: 'Saved',
};

function confidenceBand(recipe) {
  const c = typeof recipe?.confidence === 'number' ? recipe.confidence : null;
  if (c == null) return null;
  if (c >= 0.7) return 'high';
  if (c >= 0.4) return 'medium';
  return 'low';
}

/**
 * BatchImportQueue — full-screen slide-up modal showing live progress for a
 * multi-share batch import. Live-reads `batchQueue` via Dexie + refreshes on
 * the `spicehub:batch-queue-updated` CustomEvent (dispatched by
 * batchImportEngine and by this component's own mutations).
 *
 * Props:
 *   onReview(item) — open ImportSheet in review phase for a 'ready' item
 *   onRetry(item)  — open ImportSheet in input phase, pre-filled with item.url
 *   onClose()
 */
export default function BatchImportQueue({ onReview, onRetry, onClose }) {
  const [items, setItems] = useState([]);
  const dragControls = useDragControls();

  const refresh = useCallback(() => {
    getBatchQueueItems().then(setItems).catch(err => console.warn('[BatchImportQueue] refresh failed:', err));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('spicehub:batch-queue-updated', refresh);
    return () => window.removeEventListener('spicehub:batch-queue-updated', refresh);
  }, [refresh]);

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }, [onClose]);

  const handleTypeToggle = useCallback(async (item) => {
    const next = item.itemType === 'drink' ? 'meal' : 'drink';
    await setBatchItemType(item.id, next);
    refresh();
  }, [refresh]);

  const handleDismiss = useCallback(async (item) => {
    await deleteBatchQueueItem(item.id);
    refresh();
    window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
  }, [refresh]);

  const handleClearAll = useCallback(async () => {
    await clearFinishedBatchItems();
    const remaining = items.filter(i => i.status !== 'saved' && i.status !== 'extracting');
    for (const item of remaining) {
      await deleteBatchQueueItem(item.id);
    }
    refresh();
    window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
  }, [items, refresh]);

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'extracting').length;
  const readyCount = items.filter(i => i.status === 'ready').length;

  return (
    <div className="biq-overlay" onClick={onClose}>
      <motion.div className="biq-sheet" onClick={e => e.stopPropagation()}
        drag="y" dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
        <div className="biq-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />

        <div className="biq-header">
          <div>
            <h2 className="biq-title">Importing {items.length} recipe{items.length !== 1 ? 's' : ''}</h2>
            <p className="biq-subtitle">
              {pendingCount > 0 ? `${pendingCount} in progress` : 'All done'}
              {readyCount > 0 ? ` · ${readyCount} ready to review` : ''}
            </p>
          </div>
          <button className="biq-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="biq-list">
          {items.length === 0 ? (
            <div className="biq-empty">
              <Inbox size={32} strokeWidth={1.5} className="biq-empty-icon" />
              <p>No imports queued.</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className={`biq-row biq-row-${item.status}`}>
                <div className="biq-row-main">
                  {item.status === 'extracting' && <Loader2 size={18} strokeWidth={1.75} className="biq-spin" />}
                  {item.status === 'ready' && <CheckCircle2 size={18} strokeWidth={1.75} className="biq-icon-ready" />}
                  {item.status === 'failed' && <AlertTriangle size={18} strokeWidth={1.75} className="biq-icon-failed" />}
                  {item.status === 'saved' && <CheckCircle2 size={18} strokeWidth={1.75} className="biq-icon-saved" />}
                  <div className="biq-row-text">
                    <span className="biq-row-title">
                      {item.recipe?.title || item.recipe?.name || item.url}
                    </span>
                    <span className="biq-row-status">{STATUS_LABELS[item.status] || item.status}</span>
                    {item.status === 'failed' && item.error && (
                      <span className="biq-row-error">{item.error}</span>
                    )}
                  </div>
                </div>
                <div className="biq-row-actions">
                  {item.status === 'ready' && (
                    <>
                      <button className={`biq-type-pill biq-type-${item.itemType}`} onClick={() => handleTypeToggle(item)}>
                        {item.itemType === 'drink' ? 'Drink' : 'Meal'}
                      </button>
                      {confidenceBand(item.recipe) && (
                        <span className={`biq-confidence biq-confidence-${confidenceBand(item.recipe)}`}>
                          {Math.round((item.recipe.confidence || 0) * 100)}%
                        </span>
                      )}
                      <button className="biq-action-btn" onClick={() => onReview(item)}>
                        Review <ChevronRight size={16} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                  {item.status === 'failed' && (
                    <button className="biq-action-btn biq-retry-btn" onClick={() => onRetry(item)}>
                      <RefreshCw size={16} strokeWidth={1.75} /> Retry
                    </button>
                  )}
                  {(item.status === 'failed' || item.status === 'pending' || item.status === 'saved') && (
                    <button className="biq-dismiss-btn" onClick={() => handleDismiss(item)} aria-label="Remove">
                      <X size={16} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="biq-footer">
            <button className="biq-clear-btn" onClick={handleClearAll}>Clear all</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * BatchQueuePill — floating re-entry pill shown when BatchImportQueue is
 * closed but pending/ready items remain. Positioned bottom-right, clear of
 * existing FABs (which anchor bottom-left / center).
 */
export function BatchQueuePill({ count, onClick }) {
  if (!count) return null;
  return (
    <motion.button
      className="biq-pill"
      onClick={onClick}
      initial={{ opacity: 0, y: 16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.9 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      <Loader2 size={16} strokeWidth={1.75} className="biq-spin" />
      <span>{count} importing</span>
    </motion.button>
  );
}
