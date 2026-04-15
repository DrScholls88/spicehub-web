import { useState, useEffect } from 'react';
import { getQueuedRecipes, clearQueueItem, retryFailedImports, clearCompletedImports } from '../db';
import { syncOnDemand } from '../backgroundSync';

/**
 * SyncQueue — Display and manage offline recipe imports.
 * Shows pending/failed recipes and allows manual sync.
 *
 * Props:
 *   onSyncComplete  - callback() when sync finishes
 */
export default function SyncQueue({ onSyncComplete }) {
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null); // "Syncing 2 of 5..."
  const [expandedId, setExpandedId] = useState(null);

  // Load queue items
  const loadQueue = async () => {
    const items = await getQueuedRecipes();
    setQueue(items);
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, []);

  // Handle manual sync
  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncStatus('Starting sync...');
    try {
      const result = await syncOnDemand();
      setSyncStatus(`✓ Synced: ${result.succeeded} imported, ${result.failed} failed`);
      await loadQueue();
      if (onSyncComplete) onSyncComplete(result);
      setTimeout(() => setSyncStatus(null), 3000);
    } catch (err) {
      setSyncStatus(`✗ Sync failed: ${err.message}`);
      setTimeout(() => setSyncStatus(null), 3000);
    } finally {
      setSyncing(false);
    }
  };

  // Handle retry failed
  const handleRetryFailed = async () => {
    const count = await retryFailedImports();
    setSyncStatus(`Retrying ${count} failed imports...`);
    await loadQueue();
    setTimeout(() => setSyncStatus(null), 2000);
  };

  // Handle remove from queue
  const handleRemove = async (id) => {
    await clearQueueItem(id);
    await loadQueue();
  };

  // Handle clear completed
  const handleClearCompleted = async () => {
    await clearCompletedImports();
    await loadQueue();
  };

  const pending = queue.filter(q => q.status === 'pending');
  const failed = queue.filter(q => q.status === 'failed');
  const completed = queue.filter(q => q.status === 'done');

  return (
    <div className="sync-queue-container">
      <div className="sync-queue-header">
        <h3>📥 Queued Recipe Imports</h3>
        {queue.length > 0 && (
          <span className="queue-badge">{pending.length} pending</span>
        )}
      </div>

      {/* Status message */}
      {syncStatus && (
        <div className="sync-status-message">
          {syncing ? <span className="sync-spinner" /> : null}
          {syncStatus}
        </div>
      )}

      {/* No items */}
      {queue.length === 0 && (
        <div className="sync-queue-empty">
          <p>No recipes queued for import</p>
        </div>
      )}

      {/* Pending recipes */}
      {pending.length > 0 && (
        <div className="sync-queue-section">
          <h4 className="sync-section-title">⏱️ Waiting to Import ({pending.length})</h4>
          <div className="sync-queue-list">
            {pending.map(item => (
              <div key={item.id} className="sync-queue-item pending">
                <div className="sync-item-header" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                  <span className="sync-item-icon">📋</span>
                  <div className="sync-item-info">
                    <div className="sync-item-name">{item.recipeData?.name || 'Untitled'}</div>
                    <div className="sync-item-date">
                      {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    className="sync-item-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(item.id);
                    }}
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
                {expandedId === item.id && (
                  <div className="sync-item-details">
                    <p><strong>Ingredients:</strong> {item.recipeData?.ingredients?.length || 0}</p>
                    <p><strong>Steps:</strong> {item.recipeData?.directions?.length || 0}</p>
                    <p><strong>URL:</strong> {item.url}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed recipes */}
      {failed.length > 0 && (
        <div className="sync-queue-section">
          <h4 className="sync-section-title sync-section-failed">❌ Failed to Import ({failed.length})</h4>
          <div className="sync-queue-list">
            {failed.map(item => (
              <div key={item.id} className="sync-queue-item failed">
                <div className="sync-item-header" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                  <span className="sync-item-icon">⚠️</span>
                  <div className="sync-item-info">
                    <div className="sync-item-name">{item.recipeData?.name || 'Untitled'}</div>
                    <div className="sync-item-error">{item.error || 'Unknown error'}</div>
                  </div>
                  <button
                    className="sync-item-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(item.id);
                    }}
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
                {expandedId === item.id && (
                  <div className="sync-item-details">
                    <p><strong>Attempts:</strong> {item.attemptCount || 0}</p>
                    <p><strong>Ingredients:</strong> {item.recipeData?.ingredients?.length || 0}</p>
                    <p><strong>URL:</strong> {item.url}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed recipes */}
      {completed.length > 0 && (
        <div className="sync-queue-section sync-completed">
          <h4 className="sync-section-title sync-section-completed">
            ✓ Imported ({completed.length})
            <button className="sync-clear-btn" onClick={handleClearCompleted}>Clear</button>
          </h4>
          <div className="sync-queue-list">
            {completed.slice(0, 3).map(item => (
              <div key={item.id} className="sync-queue-item completed">
                <div className="sync-item-header">
                  <span className="sync-item-icon">✓</span>
                  <div className="sync-item-info">
                    <div className="sync-item-name">{item.recipeData?.name || 'Untitled'}</div>
                  </div>
                </div>
              </div>
            ))}
            {completed.length > 3 && (
              <div className="sync-item-collapsed">+{completed.length - 3} more</div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="sync-queue-actions">
        <button
          className="btn-primary"
          onClick={handleSyncNow}
          disabled={syncing || pending.length === 0}
        >
          {syncing ? '⏳ Syncing...' : `🔄 Sync Now (${pending.length})`}
        </button>
        {failed.length > 0 && (
          <button
            className="btn-secondary"
            onClick={handleRetryFailed}
            disabled={syncing}
          >
            🔁 Retry Failed ({failed.length})
          </button>
        )}
      </div>
    </div>
  );
}
