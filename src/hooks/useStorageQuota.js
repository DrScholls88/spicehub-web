import { useState, useEffect, useCallback } from 'react';
import db from '../db';

/**
 * useStorageQuota Hook
 *
 * Monitors IndexedDB storage quota using navigator.storage.estimate()
 * with graceful fallback for unsupported browsers.
 *
 * Returns:
 * {
 *   quota: { usedMB, totalMB, percentUsed },
 *   warning: null | 'warning' | 'critical',
 *   checkQuota: () => Promise<void>,
 *   requestPersistent: () => Promise<bool>,
 *   isPersisted: bool
 * }
 */

export default function useStorageQuota() {
  const [quota, setQuota] = useState({ usedMB: 0, totalMB: 0, percentUsed: 0 });
  const [warning, setWarning] = useState(null);
  const [isPersisted, setIsPersisted] = useState(false);

  const checkQuota = useCallback(async () => {
    try {
      if (!navigator.storage?.estimate) {
        // Fallback: estimate from table sizes
        const { getTableStats } = await import('../db');
        const stats = await getTableStats();
        const usedBytes = Object.values(stats).reduce((a, b) => a + b, 0);
        const usedMB = Math.round((usedBytes / 1024 / 1024) * 100) / 100;
        const totalMB = 50; // Conservative estimate for fallback
        const percentUsed = Math.round((usedMB / totalMB) * 100);

        setQuota({ usedMB, totalMB, percentUsed });
        setWarning(percentUsed >= 90 ? 'critical' : percentUsed >= 75 ? 'warning' : null);
        return;
      }

      const estimate = await navigator.storage.estimate();
      const usedMB = Math.round((estimate.usage / 1024 / 1024) * 100) / 100;
      const totalMB = Math.round((estimate.quota / 1024 / 1024) * 100) / 100;
      const percentUsed = Math.round((estimate.usage / estimate.quota) * 100);

      setQuota({ usedMB, totalMB, percentUsed });
      setWarning(percentUsed >= 90 ? 'critical' : percentUsed >= 75 ? 'warning' : null);
    } catch (error) {
      console.warn('Failed to check storage quota:', error);
    }
  }, []);

  const requestPersistent = useCallback(async () => {
    try {
      if (!navigator.storage?.persist) return false;
      const persisted = await navigator.storage.persist();
      setIsPersisted(persisted);
      return persisted;
    } catch (error) {
      console.warn('Failed to request persistent storage:', error);
      return false;
    }
  }, []);

  // Check quota on mount
  useEffect(() => {
    checkQuota();
    // Check for persistent storage permission
    if (navigator.storage?.persisted) {
      navigator.storage.persisted().then(setIsPersisted).catch(() => {});
    }
  }, [checkQuota]);

  // Periodic quota check (every 60 seconds)
  useEffect(() => {
    const interval = setInterval(checkQuota, 60000);
    return () => clearInterval(interval);
  }, [checkQuota]);

  return {
    quota,
    warning,
    checkQuota,
    requestPersistent,
    isPersisted,
  };
}
