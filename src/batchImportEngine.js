// Batch Import Engine — sequential background processor for `batchQueue`.
//
// Runs one extraction at a time (Apify/Gemini rate-limit friendly), driven
// from App.jsx on mount and on `online` events. Pauses automatically when
// `navigator.onLine` is false and resumes when connectivity returns.
import db, {
  getNextPendingBatchItem,
  updateBatchQueueItem,
  recoverStuckBatchItems,
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
      await updateBatchQueueItem(item.id, {
        status: 'ready',
        recipe: result,
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
