/**
 * Background Sync module for SpiceHub.
 * Handles Background Sync API registration and fallback for offline recipe imports.
 */

import db, { processImportQueue } from './db';

/**
 * Check if Background Sync API is supported.
 */
export function isBackgroundSyncSupported() {
  return (
    'serviceWorker' in navigator &&
    'SyncManager' in window
  );
}

/**
 * Register background sync for 'sync-recipe-imports' tag.
 * This tells the service worker to sync when the device comes online.
 */
export async function registerBackgroundSync() {
  if (!isBackgroundSyncSupported()) {
    console.log('[BackgroundSync] Background Sync API not supported, using online listener fallback');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration.sync) {
      await registration.sync.register('sync-recipe-imports');
      console.log('[BackgroundSync] Registered sync-recipe-imports');
    }
  } catch (err) {
    console.warn('[BackgroundSync] Failed to register sync:', err);
  }
}

/**
 * Manually trigger import queue processing (for "Sync Now" button).
 * Supports exponential backoff on failure.
 * Returns { succeeded, failed, total, retriesUsed }.
 */
export async function syncOnDemand(config = {}) {
  const {
    maxRetries = 4,
    initialDelayMs = 1000,
  } = config;

  let lastError;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const result = await processImportQueue();
      // Transform db.js result shape { processed, succeeded, failed } to { succeeded, failed, total, retriesUsed }
      const transformed = {
        succeeded: result.succeeded,
        failed: result.failed,
        total: result.processed,
        retriesUsed: attempt,
      };
      console.log(`[BackgroundSync] Manual sync complete (attempt ${attempt + 1}):`, transformed);
      return transformed;
    } catch (err) {
      lastError = err;
      attempt++;
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s, 8s, capped at 30s
        const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), 30000);
        console.warn(`[BackgroundSync] Sync attempt ${attempt} failed, retrying in ${delayMs}ms:`, err);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  console.error(`[BackgroundSync] Manual sync failed after ${maxRetries} attempts:`, lastError);
  throw lastError;
}

/**
 * Setup fallback online listener for Background Sync if not natively supported.
 * Automatically triggers sync when device comes online.
 */
export function setupOnlineListener() {
  if (isBackgroundSyncSupported()) {
    // Let Background Sync API handle it
    return;
  }

  // Fallback: listen for online event
  const handleOnline = async () => {
    console.log('[BackgroundSync] Device came online, processing queue...');
    try {
      await processImportQueue();
    } catch (err) {
      console.error('[BackgroundSync] Error processing queue on online:', err);
    }
  };

  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
}

/**
 * Get dead letter items — imports that failed 3+ times and need manual intervention.
 */
export async function getDeadLetterItems() {
  return db.importQueue.where('status').equals('failed')
    .filter(item => (item.attemptCount || 0) >= 3)
    .toArray();
}

/**
 * Manually trigger sync when coming online.
 * Alias for syncOnDemand - can be called from online event listeners.
 */
export async function triggerSync() {
  return syncOnDemand();
}

/**
 * Initialize background sync (called from App mount).
 * Registers the sync event and sets up fallback listener.
 */
export async function initializeBackgroundSync() {
  // Register sync event
  await registerBackgroundSync();

  // Setup online listener fallback
  setupOnlineListener();

  // If online now, try to sync immediately
  if (navigator.onLine) {
    try {
      await processImportQueue();
    } catch (err) {
      console.warn('[BackgroundSync] Initial sync failed:', err);
    }
  }
}
