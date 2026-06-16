// Batch Import Engine — sequential background processor for `batchQueue`.
//
// Runs one extraction at a time (Apify/Gemini rate-limit friendly), driven
// from App.jsx on mount and on `online` events. Pauses automatically when
// `navigator.onLine` is false and resumes when connectivity returns.
import db, {
  getNextPendingBatchItem,
  updateBatchQueueItem,
  recoverStuckBatchItems,
  getBatchQueueItems,
} from './db';
import { importRecipeFromUrl, detectImportType } from './recipeParser';

let running = false;
let listenersAttached = false;

export function dispatchBatchQueueUpdate() {
  window.dispatchEvent(new CustomEvent('spicehub:batch-queue-updated'));
}

async function processOne(item) {
  await updateBatchQueueItem(item.id, { status: 'extracting' });
  dispatchBatchQueueUpdate();

  const controller = new AbortController();
  const detectedType = detectImportType(item.url, '');

  try {
    const result = await importRecipeFromUrl(item.url, () => {}, {
      type: detectedType,
      signal: controller.signal,
    });

    const hasRecipe = result && !result._needsBrowserAssist &&
      ((result.title || result.name) || (Array.isArray(result.ingredients) && result.ingredients.length > 0));

    if (hasRecipe) {
      const finalType = item.itemTypeUserOverride
        ? item.itemType
        : (result.itemType || result.type || detectedType || 'meal');
      // Ensure confidence is always a number so biq-confidence badges always render.
      // Gemini-scored results already have it; Apify-only extractions may not.
      const normalizedRecipe = {
        ...result,
        confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      };
      await updateBatchQueueItem(item.id, {
        status: 'ready',
        recipe: normalizedRecipe,
        itemType: finalType,
      });
    } else {
      await updateBatchQueueItem(item.id, {
        status: 'failed',
        error: result?._timeoutReason || 'Could not find a recipe at this link.',
      });
    }
  } catch (err) {
    await updateBatchQueueItem(item.id, {
      status: 'failed',
      error: err?.message || 'Import failed.',
    });
  }

  dispatchBatchQueueUpdate();
}

export async function runBatchImportEngine() {
  if (running) return;
  running = true;
  try {
    await recoverStuckBatchItems();
    dispatchBatchQueueUpdate();

    while (true) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const next = await getNextPendingBatchItem();
      if (!next) break;
      await processOne(next);
    }

    // ── Drain detection ──────────────────────────────────────────────────
    // After the loop exits naturally (no more pending), check if the queue
    // has items and ALL of them are now in terminal states. If so, fire a
    // completion event so the UI can notify the user.
    if (typeof window !== 'undefined') {
      try {
        const allItems = await getBatchQueueItems();
        if (allItems.length > 0) {
          const hasActive = allItems.some(i => i.status === 'pending' || i.status === 'extracting');
          if (!hasActive) {
            const readyCount  = allItems.filter(i => i.status === 'ready').length;
            const failedCount = allItems.filter(i => i.status === 'failed').length;
            const savedCount  = allItems.filter(i => i.status === 'saved').length;
            window.dispatchEvent(new CustomEvent('spicehub:batch-import-complete', {
              detail: { readyCount, failedCount, savedCount, total: allItems.length },
            }));
          }
        }
      } catch (e) {
        console.warn('[batchImportEngine] drain-check failed:', e);
      }
    }
  } finally {
    running = false;
  }
}

// Call once on app mount. Safe to call multiple times — listener registration
// is idempotent and `runBatchImportEngine` is reentrancy-guarded via `running`.
export function startBatchImportEngine() {
  runBatchImportEngine();

  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('online', () => {
    runBatchImportEngine();
  });
}

// Exported for table existence checks from BatchImportQueue without a
// second db.js import in callers that already import this module.
export { db };
