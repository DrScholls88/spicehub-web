import { useState, useEffect, useCallback } from 'react';
import {
  checkStorageQuota,
  getStorageStats,
  getDetailedStorageBreakdown,
  cleanupOldLogs,
  requestPersistentStorage,
  isPersistentStorageGranted,
  exportAllData,
  importData,
  clearAllData,
} from '../storageManager';

export default function StorageManager({ onClose, onToast }) {
  const [quota, setQuota] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [isPersistent, setIsPersistent] = useState(false);
  const [daysToClean, setDaysToClean] = useState(90);
  const [isLoading, setIsLoading] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [exportData, setExportData] = useState(null);

  // Load storage info on mount
  useEffect(() => {
    loadStorageInfo();
  }, []);

  const loadStorageInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      const quotaData = await checkStorageQuota();
      setQuota(quotaData);

      const breakdownData = await getDetailedStorageBreakdown();
      setBreakdown(breakdownData);

      const persistent = await isPersistentStorageGranted();
      setIsPersistent(persistent);
    } catch (error) {
      console.error('Error loading storage info:', error);
      onToast?.('Failed to load storage information', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [onToast]);

  const getProgressColor = (percent) => {
    if (percent < 50) return '#10b981'; // green
    if (percent < 75) return '#f59e0b'; // yellow/amber
    return '#ef4444'; // red
  };

  const handleRequestPersistent = async () => {
    try {
      setIsLoading(true);
      const granted = await requestPersistentStorage();
      setIsPersistent(granted);
      onToast?.(
        granted
          ? 'Persistent storage granted! Your data won\'t be cleared by the browser.'
          : 'Persistent storage request denied',
        granted ? 'success' : 'info'
      );
    } catch (error) {
      console.error('Error requesting persistent storage:', error);
      onToast?.('Failed to request persistent storage', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCleanupLogs = async () => {
    if (daysToClean < 1) {
      onToast?.('Please enter a valid number of days', 'error');
      return;
    }

    try {
      setIsLoading(true);
      const result = await cleanupOldLogs(daysToClean);
      onToast?.(
        `Deleted ${result.deleted} old logs and freed ${result.freedMB} MB`,
        'success'
      );
      await loadStorageInfo();
    } catch (error) {
      console.error('Error cleaning up logs:', error);
      onToast?.('Failed to clean up logs', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportData = async () => {
    try {
      setIsLoading(true);
      const data = await exportAllData(false);
      setExportData(data);
      setShowExportConfirm(true);
      onToast?.('Data exported successfully', 'success');
    } catch (error) {
      console.error('Error exporting data:', error);
      onToast?.('Failed to export data', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportAndDownload = async () => {
    if (!exportData) return;

    try {
      const dataStr = JSON.stringify(exportData.data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spicehub-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onToast?.('Backup downloaded successfully', 'success');
      setShowExportConfirm(false);
      setExportData(null);
    } catch (error) {
      console.error('Error downloading backup:', error);
      onToast?.('Failed to download backup', 'error');
    }
  };

  const handleExportAndClear = async () => {
    if (!exportData) return;

    if (!confirm('Are you sure? This will delete all data after downloading the backup.')) {
      return;
    }

    try {
      setIsLoading(true);

      // First download the backup
      const dataStr = JSON.stringify(exportData.data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spicehub-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Then clear the database
      await clearAllData();
      onToast?.('All data cleared. Backup downloaded.', 'success');

      setShowExportConfirm(false);
      setExportData(null);
      await loadStorageInfo();

      // Reload page to reset app state
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error exporting and clearing:', error);
      onToast?.('Failed to export and clear data', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (!quota) {
    return (
      <div className="storage-manager">
        <h2>Storage Manager</h2>
        <div className="storage-loading">Loading storage information...</div>
      </div>
    );
  }

  const isHighUsage = quota.percentUsed > 75;
  const isCriticalUsage = quota.percentUsed > 90;

  return (
    <div className="storage-manager">
      <div className="storage-header">
        <h2>Storage Manager</h2>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Warning Messages */}
      {isCriticalUsage && (
        <div className="storage-warning critical">
          <strong>Critical Storage!</strong> Your storage is over 90% full. Consider cleaning up old logs or exporting data.
        </div>
      )}
      {isHighUsage && !isCriticalUsage && (
        <div className="storage-warning high">
          <strong>Storage Getting Full!</strong> You're using more than 75% of available space.
        </div>
      )}

      {/* Storage Usage Overview */}
      <div className="storage-overview">
        <div className="storage-stat">
          <label>Storage Usage</label>
          <div className="storage-value">{quota.usedMB} MB / {quota.totalMB} MB</div>
          <div className="storage-percent">{quota.percentUsed}% used</div>
        </div>

        {/* Progress Bar */}
        <div className="storage-progress-container">
          <div
            className="storage-progress-bar"
            style={{
              width: `${Math.min(quota.percentUsed, 100)}%`,
              backgroundColor: getProgressColor(quota.percentUsed),
            }}
          />
        </div>

        {/* Color Legend */}
        <div className="storage-legend">
          <div className="legend-item">
            <span className="legend-box" style={{ backgroundColor: '#10b981' }} />
            <span>Safe (&lt;50%)</span>
          </div>
          <div className="legend-item">
            <span className="legend-box" style={{ backgroundColor: '#f59e0b' }} />
            <span>Caution (50-75%)</span>
          </div>
          <div className="legend-item">
            <span className="legend-box" style={{ backgroundColor: '#ef4444' }} />
            <span>Critical (&gt;75%)</span>
          </div>
        </div>
      </div>

      {/* Persistent Storage Status */}
      <div className="storage-section">
        <h3>Persistent Storage</h3>
        <div className="persistent-status">
          <div className="status-info">
            <p>
              {isPersistent
                ? '✓ Your data is protected from automatic browser cache clearing.'
                : '⚠ Your data may be cleared if browser storage is full.'}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleRequestPersistent}
            disabled={isLoading || isPersistent}
          >
            {isPersistent ? 'Persistent Storage Enabled' : 'Request Persistent Storage'}
          </button>
        </div>
      </div>

      {/* Storage Breakdown */}
      {breakdown && (
        <div className="storage-section">
          <h3>Storage Breakdown</h3>
          <div className="storage-breakdown">
            {Object.entries(breakdown.breakdown).map(([key, data]) => (
              <div key={key} className="breakdown-item">
                <span className="breakdown-label">{key}</span>
                <span className="breakdown-size">{data.mb} MB</span>
              </div>
            ))}
            <div className="breakdown-item total">
              <span className="breakdown-label">Total</span>
              <span className="breakdown-size">{breakdown.total} MB</span>
            </div>
          </div>
        </div>
      )}

      {/* Clean Old Logs */}
      <div className="storage-section">
        <h3>Clear Old Cooking Logs</h3>
        <p className="section-description">
          Remove cooking logs older than a specified number of days to free up space.
        </p>
        <div className="cleanup-form">
          <label>
            Delete logs older than
            <input
              type="number"
              min="1"
              max="3650"
              value={daysToClean}
              onChange={(e) => setDaysToClean(parseInt(e.target.value) || 1)}
              disabled={isLoading}
            />
            days
          </label>
          <button
            className="btn btn-secondary"
            onClick={handleCleanupLogs}
            disabled={isLoading}
          >
            {isLoading ? 'Cleaning...' : 'Clean Old Logs'}
          </button>
        </div>
      </div>

      {/* Export & Clear */}
      <div className="storage-section">
        <h3>Backup & Clear</h3>
        <p className="section-description">
          Download a complete backup of all your recipes, meals, and data, then optionally clear everything.
        </p>
        {!showExportConfirm ? (
          <button
            className="btn btn-warning"
            onClick={handleExportData}
            disabled={isLoading}
          >
            {isLoading ? 'Exporting...' : 'Export Data'}
          </button>
        ) : (
          <div className="export-confirm">
            <p className="export-info">
              Data exported: {exportData?.sizeKB} KB ({new Date(exportData?.timestamp).toLocaleString()})
            </p>
            <div className="export-actions">
              <button
                className="btn btn-primary"
                onClick={handleExportAndDownload}
                disabled={isLoading}
              >
                {isLoading ? 'Downloading...' : 'Download Backup Only'}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleExportAndClear}
                disabled={isLoading}
              >
                {isLoading ? 'Processing...' : 'Download & Clear All Data'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowExportConfirm(false);
                  setExportData(null);
                }}
                disabled={isLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .storage-manager {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          padding: 1.5rem;
          background: var(--bg-secondary, #f9fafb);
          border-radius: 0.5rem;
          max-width: 600px;
          margin: 0 auto;
        }

        .storage-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .storage-header h2 {
          margin: 0;
          font-size: 1.5rem;
          color: var(--text-primary, #111827);
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--text-secondary, #6b7280);
          padding: 0;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .close-btn:hover {
          color: var(--text-primary, #111827);
        }

        .storage-loading {
          padding: 2rem;
          text-align: center;
          color: var(--text-secondary, #6b7280);
        }

        .storage-warning {
          padding: 1rem;
          border-radius: 0.5rem;
          border-left: 4px solid;
          background-color: #fef3c7;
          border-color: #f59e0b;
          color: #92400e;
        }

        .storage-warning.critical {
          background-color: #fee2e2;
          border-color: #ef4444;
          color: #7f1d1d;
        }

        .storage-overview {
          background: white;
          padding: 1.5rem;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
        }

        .storage-stat {
          margin-bottom: 1rem;
        }

        .storage-stat label {
          display: block;
          font-weight: 600;
          color: var(--text-secondary, #6b7280);
          font-size: 0.875rem;
          margin-bottom: 0.25rem;
        }

        .storage-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary, #111827);
          margin-bottom: 0.25rem;
        }

        .storage-percent {
          font-size: 0.875rem;
          color: var(--text-secondary, #6b7280);
        }

        .storage-progress-container {
          width: 100%;
          height: 1rem;
          background-color: #e5e7eb;
          border-radius: 0.5rem;
          overflow: hidden;
          margin-bottom: 1rem;
        }

        .storage-progress-bar {
          height: 100%;
          transition: width 0.3s ease, background-color 0.3s ease;
          border-radius: 0.5rem;
        }

        .storage-legend {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--text-secondary, #6b7280);
        }

        .legend-box {
          display: inline-block;
          width: 1rem;
          height: 1rem;
          border-radius: 0.25rem;
        }

        .storage-section {
          background: white;
          padding: 1.5rem;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
        }

        .storage-section h3 {
          margin: 0 0 0.75rem 0;
          font-size: 1.125rem;
          color: var(--text-primary, #111827);
        }

        .section-description {
          margin: 0 0 1rem 0;
          font-size: 0.875rem;
          color: var(--text-secondary, #6b7280);
        }

        .persistent-status {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .status-info p {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary, #6b7280);
        }

        .storage-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .breakdown-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          background-color: #f3f4f6;
          border-radius: 0.375rem;
          font-size: 0.875rem;
        }

        .breakdown-item.total {
          background-color: #e0e7ff;
          font-weight: 600;
          border: 1px solid #c7d2fe;
        }

        .breakdown-label {
          color: var(--text-primary, #111827);
          text-transform: capitalize;
        }

        .breakdown-size {
          color: var(--text-secondary, #6b7280);
          font-weight: 500;
        }

        .cleanup-form {
          display: flex;
          gap: 1rem;
          align-items: flex-end;
          flex-wrap: wrap;
        }

        .cleanup-form label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--text-primary, #111827);
        }

        .cleanup-form input {
          width: 4rem;
          padding: 0.5rem;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          font-size: 0.875rem;
        }

        .cleanup-form input:disabled {
          background-color: #f3f4f6;
          cursor: not-allowed;
        }

        .export-confirm {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .export-info {
          margin: 0;
          padding: 0.75rem;
          background-color: #dbeafe;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          color: #0c4a6e;
          border-left: 3px solid #0284c7;
        }

        .export-actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .btn {
          padding: 0.625rem 1rem;
          border: none;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-primary {
          background-color: #3b82f6;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background-color: #2563eb;
        }

        .btn-secondary {
          background-color: #6b7280;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background-color: #4b5563;
        }

        .btn-warning {
          background-color: #f59e0b;
          color: white;
        }

        .btn-warning:hover:not(:disabled) {
          background-color: #d97706;
        }

        .btn-danger {
          background-color: #ef4444;
          color: white;
        }

        .btn-danger:hover:not(:disabled) {
          background-color: #dc2626;
        }

        @media (max-width: 640px) {
          .storage-manager {
            padding: 1rem;
            gap: 1rem;
          }

          .storage-section {
            padding: 1rem;
          }

          .cleanup-form {
            flex-direction: column;
            align-items: stretch;
          }

          .cleanup-form label {
            flex-direction: column;
            align-items: flex-start;
          }

          .export-actions {
            flex-direction: column;
          }

          .export-actions .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
