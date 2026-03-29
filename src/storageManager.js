import db from './db';

/**
 * Storage Quota Management System for SpiceHub
 * Handles storage limits, quota tracking, and cleanup operations
 */

// Default storage limits (50MB for IndexedDB)
const DEFAULT_QUOTA_MB = 50;

/**
 * Check current storage quota usage
 * @returns {Promise<{usedMB: number, totalMB: number, percentUsed: number, error?: string}>}
 */
export async function checkStorageQuota() {
  try {
    // Modern Storage API (Chrome, Edge, Firefox, Safari 16.4+)
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedMB = Math.round(estimate.usage / (1024 * 1024) * 10) / 10; // Round to 0.1 MB
      const totalMB = Math.round(estimate.quota / (1024 * 1024) * 10) / 10;
      const percentUsed = estimate.quota > 0 ? Math.round((estimate.usage / estimate.quota) * 1000) / 10 : 0;

      return {
        usedMB,
        totalMB,
        percentUsed,
      };
    }
  } catch (error) {
    console.warn('Storage API not available:', error);
  }

  // Fallback: estimate based on data size
  return estimateStorageFromData();
}

/**
 * Estimate storage usage by analyzing data
 * Fallback when StorageManager API is unavailable
 * @returns {Promise<{usedMB: number, totalMB: number, percentUsed: number}>}
 */
export async function estimateStorageFromData() {
  try {
    const stats = await getStorageStats();
    const totalBytes = Object.values(stats).reduce((sum, size) => sum + size, 0);
    const usedMB = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
    const totalMB = DEFAULT_QUOTA_MB;
    const percentUsed = (usedMB / totalMB) * 100;

    return {
      usedMB,
      totalMB,
      percentUsed: Math.round(percentUsed * 10) / 10,
    };
  } catch (error) {
    console.error('Failed to estimate storage:', error);
    return {
      usedMB: 0,
      totalMB: DEFAULT_QUOTA_MB,
      percentUsed: 0,
    };
  }
}

/**
 * Request persistent storage from browser
 * Prevents browser from automatically clearing data
 * @returns {Promise<boolean>} true if permission granted
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) {
      console.warn('Persistent storage API not available');
      return false;
    }

    const persisted = await navigator.storage.persist();
    if (persisted) {
      console.log('Persistent storage granted');
    } else {
      console.log('Persistent storage denied');
    }
    return persisted;
  } catch (error) {
    console.error('Error requesting persistent storage:', error);
    return false;
  }
}

/**
 * Check if storage is currently persistent
 * @returns {Promise<boolean>}
 */
export async function isPersistentStorageGranted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch (error) {
    console.error('Error checking persistent storage:', error);
  }
  return false;
}

/**
 * Get detailed storage breakdown by table
 * @returns {Promise<{meals: number, drinks: number, weekPlan: number, groceryItems: number, storeMemory: number, cookingLog: number, total: number}>}
 */
export async function getStorageStats() {
  const stats = {
    meals: 0,
    drinks: 0,
    weekPlan: 0,
    groceryItems: 0,
    storeMemory: 0,
    cookingLog: 0,
    storageMetadata: 0,
  };

  try {
    // Estimate size for each table
    const tables = ['meals', 'drinks', 'weekPlan', 'groceryItems', 'storeMemory', 'cookingLog', 'storageMetadata'];

    for (const tableName of tables) {
      if (!db[tableName]) continue;

      try {
        const items = await db[tableName].toArray();
        const jsonStr = JSON.stringify(items);
        // Rough estimate: 1 character ≈ 1 byte (UTF-8)
        stats[tableName] = new Blob([jsonStr]).size;
      } catch (error) {
        console.warn(`Failed to calculate size for ${tableName}:`, error);
      }
    }
  } catch (error) {
    console.error('Error getting storage stats:', error);
  }

  stats.total = Object.values(stats).reduce((sum, size) => sum + size, 0);
  return stats;
}

/**
 * Get detailed storage breakdown with human-readable format
 * @returns {Promise<{breakdown: {[key: string]: {bytes: number, mb: string}}, total: string}>}
 */
export async function getDetailedStorageBreakdown() {
  const stats = await getStorageStats();
  const breakdown = {};

  for (const [key, bytes] of Object.entries(stats)) {
    if (key === 'total') continue;
    breakdown[key] = {
      bytes,
      mb: (bytes / (1024 * 1024)).toFixed(2),
    };
  }

  return {
    breakdown,
    total: (stats.total / (1024 * 1024)).toFixed(2),
  };
}

/**
 * Estimate storage size for a recipe before adding it
 * @param {Object} recipe - Recipe object with ingredients and directions
 * @returns {number} Estimated size in bytes
 */
export function estimateRecipeSize(recipe) {
  const recipeStr = JSON.stringify(recipe);
  return new Blob([recipeStr]).size;
}

/**
 * Clean up cooking logs older than specified days
 * @param {number} olderThanDays - Delete logs older than this many days
 * @returns {Promise<{deleted: number, freedMB: number}>}
 */
export async function cleanupOldLogs(olderThanDays = 90) {
  if (olderThanDays < 1) {
    throw new Error('olderThanDays must be at least 1');
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Get all logs
    const allLogs = await db.cookingLog.toArray();
    const logsToDelete = allLogs.filter(log => {
      const logDate = new Date(log.cookedAt);
      return logDate < cutoffDate;
    });

    // Record size before deletion
    const beforeStats = await getStorageStats();
    const beforeMB = beforeStats.cookingLog / (1024 * 1024);

    // Delete logs
    const logIds = logsToDelete.map(log => log.id);
    if (logIds.length > 0) {
      await db.cookingLog.bulkDelete(logIds);
    }

    // Record size after deletion
    const afterStats = await getStorageStats();
    const afterMB = afterStats.cookingLog / (1024 * 1024);
    const freedMB = Math.max(0, beforeMB - afterMB);

    return {
      deleted: logsToDelete.length,
      freedMB: Math.round(freedMB * 100) / 100,
    };
  } catch (error) {
    console.error('Error cleaning up logs:', error);
    throw error;
  }
}

/**
 * Delete a recipe and all related cooking logs
 * @param {number} mealId - ID of the meal to delete
 * @param {string} mealName - Name of the meal (for logging)
 * @returns {Promise<{recipeDeleted: boolean, logsDeleted: number, freedMB: number}>}
 */
export async function deleteRecipeAndDependents(mealId, mealName) {
  if (!mealId) {
    throw new Error('mealId is required');
  }

  try {
    // Record size before deletion
    const beforeStats = await getStorageStats();
    const beforeMB = (beforeStats.meals + beforeStats.cookingLog) / (1024 * 1024);

    // Delete the meal
    await db.meals.delete(mealId);

    // Delete all cooking logs for this meal
    const logs = await db.cookingLog
      .where('mealId')
      .equals(mealId)
      .toArray();

    const logIds = logs.map(log => log.id);
    let deletedLogs = 0;
    if (logIds.length > 0) {
      await db.cookingLog.bulkDelete(logIds);
      deletedLogs = logIds.length;
    }

    // Record size after deletion
    const afterStats = await getStorageStats();
    const afterMB = (afterStats.meals + afterStats.cookingLog) / (1024 * 1024);
    const freedMB = Math.max(0, beforeMB - afterMB);

    console.log(`Deleted meal "${mealName}" and ${deletedLogs} cooking logs. Freed ${freedMB.toFixed(2)} MB`);

    return {
      recipeDeleted: true,
      logsDeleted: deletedLogs,
      freedMB: Math.round(freedMB * 100) / 100,
    };
  } catch (error) {
    console.error('Error deleting recipe and dependents:', error);
    throw error;
  }
}

/**
 * Export all data as JSON and optionally clear database
 * @param {boolean} clearAfterExport - Whether to clear all data after export
 * @returns {Promise<{data: Object, sizeKB: number, timestamp: string}>}
 */
export async function exportAllData(clearAfterExport = false) {
  try {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: 'v5',
      tables: {
        meals: await db.meals.toArray(),
        drinks: await db.drinks.toArray(),
        weekPlan: await db.weekPlan.toArray(),
        groceryItems: await db.groceryItems.toArray(),
        storeMemory: await db.storeMemory.toArray(),
        cookingLog: await db.cookingLog.toArray(),
      },
    };

    const jsonStr = JSON.stringify(exportData);
    const sizeKB = Math.round((new Blob([jsonStr]).size / 1024) * 10) / 10;

    if (clearAfterExport) {
      // Clear all tables
      await db.meals.clear();
      await db.drinks.clear();
      await db.weekPlan.clear();
      await db.groceryItems.clear();
      await db.storeMemory.clear();
      await db.cookingLog.clear();
      console.log('Database cleared after export');
    }

    return {
      data: exportData,
      sizeKB,
      timestamp: exportData.timestamp,
    };
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
}

/**
 * Import data from exported JSON backup
 * @param {Object} importData - Data object from exportAllData
 * @param {boolean} replaceExisting - Whether to clear existing data first
 * @returns {Promise<{imported: number, warnings: string[]}>}
 */
export async function importData(importData, replaceExisting = false) {
  const warnings = [];

  try {
    if (!importData || !importData.tables) {
      throw new Error('Invalid import data format');
    }

    if (replaceExisting) {
      // Clear all tables first
      await db.meals.clear();
      await db.drinks.clear();
      await db.weekPlan.clear();
      await db.groceryItems.clear();
      await db.storeMemory.clear();
      await db.cookingLog.clear();
    }

    // Import each table
    let totalImported = 0;

    const tables = {
      meals: db.meals,
      drinks: db.drinks,
      weekPlan: db.weekPlan,
      groceryItems: db.groceryItems,
      storeMemory: db.storeMemory,
      cookingLog: db.cookingLog,
    };

    for (const [tableName, tableData] of Object.entries(importData.tables)) {
      if (!Array.isArray(tableData) || tableData.length === 0) {
        continue;
      }

      try {
        const table = tables[tableName];
        if (!table) {
          warnings.push(`Unknown table: ${tableName}`);
          continue;
        }

        // For week plan, use put instead of add (it's not autoincrement)
        if (tableName === 'weekPlan') {
          await table.bulkPut(tableData);
        } else {
          // Remove id field to let DB auto-increment, then add
          const itemsWithoutId = tableData.map(item => {
            const { id, ...rest } = item;
            return rest;
          });
          await table.bulkAdd(itemsWithoutId);
        }

        totalImported += tableData.length;
      } catch (error) {
        warnings.push(`Error importing ${tableName}: ${error.message}`);
      }
    }

    return {
      imported: totalImported,
      warnings,
    };
  } catch (error) {
    console.error('Error importing data:', error);
    throw error;
  }
}

/**
 * Clear all user data from database
 * WARNING: This cannot be undone. Use exportAllData first!
 * @returns {Promise<boolean>}
 */
export async function clearAllData() {
  try {
    await db.meals.clear();
    await db.drinks.clear();
    await db.weekPlan.clear();
    await db.groceryItems.clear();
    await db.storeMemory.clear();
    await db.cookingLog.clear();

    // Also attempt to clear metadata if table exists
    if (db.storageMetadata) {
      await db.storageMetadata.clear();
    }

    console.log('All data cleared from database');
    return true;
  } catch (error) {
    console.error('Error clearing all data:', error);
    throw error;
  }
}

/**
 * Monitor storage quota and run cleanup if needed
 * Called after major operations like imports
 * @param {Object} options - Configuration options
 * @returns {Promise<{needsCleanup: boolean, recommendation?: string}>}
 */
export async function checkAndRecommendCleanup(options = {}) {
  const {
    warnThreshold = 0.80, // Warn at 80%
    autoCleanupThreshold = 0.90, // Suggest cleanup at 90%
  } = options;

  const quota = await checkStorageQuota();
  const percentDecimal = quota.percentUsed / 100;

  const result = {
    needsCleanup: false,
    recommendation: null,
  };

  if (percentDecimal >= autoCleanupThreshold) {
    result.needsCleanup = true;
    result.recommendation = `Storage critically high (${quota.percentUsed}% used). Consider clearing old cooking logs or exporting data.`;
  } else if (percentDecimal >= warnThreshold) {
    result.recommendation = `Storage usage moderate (${quota.percentUsed}% used). Monitor space.`;
  }

  return result;
}

/**
 * Proactive cleanup: automatically free space if quota > 80%.
 * Called on app startup. Non-destructive — only clears old logs and completed imports.
 * @returns {Promise<{cleaned: boolean, freedBytes: number, actions: string[]}>}
 */
export async function autoCleanupIfNeeded() {
  const quota = await checkStorageQuota();
  if (quota.percentUsed < 80) {
    return { cleaned: false, freedBytes: 0, actions: [] };
  }

  const actions = [];
  let freedBytes = 0;

  try {
    // 1. Clear completed import queue items
    const completed = await db.importQueue.where('status').equals('done').toArray();
    if (completed.length > 0) {
      const size = new Blob([JSON.stringify(completed)]).size;
      await db.importQueue.where('status').equals('done').delete();
      freedBytes += size;
      actions.push(`Cleared ${completed.length} completed imports`);
    }

    // 2. Trim cooking logs older than 90 days
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const oldLogs = await db.cookingLog.where('cookedAt').below(cutoff).toArray();
    if (oldLogs.length > 0) {
      const size = new Blob([JSON.stringify(oldLogs)]).size;
      await db.cookingLog.where('cookedAt').below(cutoff).delete();
      freedBytes += size;
      actions.push(`Trimmed ${oldLogs.length} cooking logs (>90 days)`);
    }

    // 3. Clear old storage metadata
    const oldMeta = await db.storageMetadata.where('key').startsWith('metric_').toArray();
    // Only clear if there are many entries
    if (oldMeta.length > 100) {
      await db.storageMetadata.where('key').startsWith('metric_').delete();
      freedBytes += new Blob([JSON.stringify(oldMeta)]).size;
      actions.push(`Cleared ${oldMeta.length} old storage metrics`);
    }
  } catch (error) {
    console.warn('[StorageManager] Auto-cleanup error:', error);
  }

  if (actions.length > 0) {
    console.log(`[StorageManager] Auto-cleanup freed ~${(freedBytes / 1024).toFixed(1)} KB:`, actions);
  }

  return { cleaned: actions.length > 0, freedBytes, actions };
}

/**
 * Wraps a database write function with quota checking.
 * If quota > 95%, throws with a user-friendly message instead of writing.
 * @param {Function} fn - async function to wrap
 * @returns {Function} wrapped function
 */
export function wrapWithQuotaCheck(fn) {
  return async function (...args) {
    const quota = await checkStorageQuota();
    if (quota.percentUsed > 95) {
      throw new Error(
        'Storage is almost full. Please free up space in Settings > Storage before adding more data.'
      );
    }
    return fn(...args);
  };
}
