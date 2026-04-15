import { useState, useEffect, useCallback } from 'react';
import useOnlineStatus, { onOnlineStatusChange } from '../hooks/useOnlineStatus';
import '../styles/OfflineIndicator.css';

/**
 * OfflineIndicator Component
 *
 * Non-intrusive indicator in top-right corner showing:
 * - Online: Hidden (no visual clutter)
 * - Offline: Red "🔌 Offline" with sync status
 * - Shows sync progress when operations are queued
 * - Expandable status panel on click
 *
 * Props:
 *   queuedOps - Number of pending operations to sync
 *   isSyncing - Whether sync is in progress
 *   onViewStatus - Callback when user clicks to view full status
 */

export default function OfflineIndicator({ queuedOps = 0, isSyncing = false, onViewStatus }) {
  const { isOnline } = useOnlineStatus();
  const [showPanel, setShowPanel] = useState(false);

  const handleClickIndicator = useCallback(() => {
    setShowPanel(!showPanel);
    if (onViewStatus && !showPanel) {
      onViewStatus();
    }
  }, [showPanel, onViewStatus]);

  // Auto-hide panel when coming back online
  useEffect(() => {
    if (isOnline && showPanel) {
      const t = setTimeout(() => setShowPanel(false), 1500);
      return () => clearTimeout(t);
    }
  }, [isOnline, showPanel]);

  // Don't show anything when online
  if (isOnline && queuedOps === 0) {
    return null;
  }

  const totalOps = queuedOps + (isSyncing ? 1 : 0);
  const syncText = isSyncing ? '⏱️ Syncing...' : queuedOps > 0 ? `⏳ ${queuedOps} queued` : '✓ All synced';

  return (
    <div className="offline-indicator-container">
      <button
        className={`offline-indicator ${!isOnline ? 'offline' : 'degraded'}`}
        onClick={handleClickIndicator}
        title={!isOnline ? 'Offline - Tap for details' : 'Low connectivity'}
        aria-label={!isOnline ? 'Offline indicator' : 'Network degraded'}
      >
        <span className={`offline-dot ${isSyncing ? 'pulsing' : ''}`} />
        <span className="offline-label">
          {!isOnline ? (
            <>
              <span className="offline-icon">🔌</span>
              <span className="offline-text">Offline</span>
            </>
          ) : (
            <>
              <span className="degraded-icon">📡</span>
              <span className="degraded-text">Degraded</span>
            </>
          )}
        </span>
        {(isSyncing || queuedOps > 0) && (
          <span className="sync-badge">{queuedOps}</span>
        )}
      </button>

      {showPanel && (
        <div className="offline-panel" onClick={e => e.stopPropagation()}>
          <div className="offline-panel-header">
            <h3>Sync Status</h3>
            <button className="panel-close" onClick={() => setShowPanel(false)}>✕</button>
          </div>

          <div className="offline-panel-content">
            <div className="status-item">
              <span className={`status-icon ${isOnline ? 'online' : 'offline'}`}>
                {isOnline ? '📡' : '🔌'}
              </span>
              <span className={`status-text ${isOnline ? 'online' : 'offline'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {(isSyncing || queuedOps > 0) && (
              <div className="status-item">
                <span className={`status-icon ${isSyncing ? 'syncing' : ''}`}>
                  {isSyncing ? '⏱️' : '📦'}
                </span>
                <span className={`status-text ${isSyncing ? 'syncing' : ''}`}>
                  {isSyncing
                    ? 'Syncing pending operations...'
                    : queuedOps === 1
                      ? '1 operation queued'
                      : `${queuedOps} operations queued`}
                </span>
              </div>
            )}

            {isOnline && queuedOps === 0 && !isSyncing && (
              <div className="status-item success">
                <span className="status-icon">✓</span>
                <span className="status-text">All synced</span>
              </div>
            )}

            <div className="panel-footer">
              <small>
                Data is saved locally. Changes will sync automatically when online.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* Overlay to close panel on click outside */}
      {showPanel && (
        <div
          className="offline-panel-overlay"
          onClick={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
