/**
 * StorageSummaryBar — inline storage snapshot row for Settings > App Health
 * (SettingsPlan.md PKG C). Reuses the existing checkStorageQuota() data
 * layer (no new storage API) and hands off to the full StorageManager on
 * tap. checkStorageQuota() already falls back to a Dexie-record-count
 * estimate when navigator.storage.estimate() is unusable (fixed 2026-08-07
 * for the iOS zero-quota case — see storageManager.js), so this component
 * doesn't need its own zero-quota special-casing beyond a defensive guard.
 */
import { useState, useEffect } from 'react';
import { checkStorageQuota } from '../storageManager';
import { getUserTags } from '../db';

export default function StorageSummaryBar({ meals, onOpenFull }) {
  const [quota, setQuota] = useState(null);
  const [tagCount, setTagCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [q, tags] = await Promise.all([checkStorageQuota(), getUserTags()]);
        if (cancelled) return;
        setQuota(q);
        setTagCount(Array.isArray(tags) ? tags.length : 0);
      } catch {
        // Leave quota/tagCount at their defaults — stats line below just
        // shows the recipe count and skips the % bar.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const recipeCount = meals?.length || 0;
  const hasPercent = !!(quota && quota.totalMB > 0);

  return (
    <button type="button" className="stg-row stg-storage-row" onClick={onOpenFull}>
      <span className="stg-row-icon">💾</span>
      <span className="stg-row-body">
        <span className="stg-storage-title">Storage</span>
        <span className="stg-storage-stats">
          {loaded
            ? `${recipeCount} Recipe${recipeCount === 1 ? '' : 's'} · ${tagCount} Tag${tagCount === 1 ? '' : 's'}${quota ? ` · ${quota.usedMB} MB used` : ''}`
            : 'Loading…'}
        </span>
        {hasPercent && (
          <span className="stg-storage-track">
            <span
              className="stg-storage-fill"
              style={{
                width: `${Math.min(quota.percentUsed, 100)}%`,
                background: quota.percentUsed < 50 ? 'var(--success)' : quota.percentUsed < 75 ? 'var(--warning)' : 'var(--danger)',
              }}
            />
          </span>
        )}
      </span>
      <span className="stg-row-chevron">›</span>
    </button>
  );
}
