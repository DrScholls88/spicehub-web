// src/importWorker.js
import { useEffect, useCallback } from 'react';
import db from './db.js';
import { sanitizeRecipeTitle } from './recipeParser.js';
import { compressImageUrl as defaultCompress } from './imageCompressor.js';

const API_BASE = import.meta.env?.VITE_API_BASE || '';

/**
 * useImportWorker — mounts at App root; polls Dexie for any meals whose
 * status === 'processing' (ghost rows created by the V2 optimistic path)
 * and hydrates them once the backend job finishes.
 *
 * @param {function} [onUpdate] — optional callback fired after any ghost row
 *   is hydrated or marked failed. Typically used to reload the meals list
 *   so the UI reflects the completed import without a manual refresh.
 */
export function useImportWorker(onUpdate) {
  // Stable reference so the effect deps don't change on every render
  const stableOnUpdate = useCallback(() => {
    if (typeof onUpdate === 'function') onUpdate();
  }, [onUpdate]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function tick() {
      if (cancelled) return;
      try {
        const processing = await db.meals.where('status').equals('processing').toArray();
        if (processing.length > 0) {
          const results = await Promise.allSettled(processing.map((m) => pollOne(db.meals, m, {
            apiBase: API_BASE,
            sanitize: sanitizeRecipeTitle,
            compress: defaultCompress,
          })));
          // If any row was updated (done or failed), trigger a UI refresh.
          const anyChanged = results.some(r => r.status === 'fulfilled' && r.value === true);
          if (anyChanged) stableOnUpdate();
        }
        timer = setTimeout(tick, processing.length > 0 ? 2000 : 15_000);
      } catch {
        timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [stableOnUpdate]);
}

/**
 * pollOne — polls the backend status endpoint for a single ghost row.
 * Returns true if the row's status changed (done/failed), false otherwise.
 * Exported for tests; works against anything with an async update(id, patch) method.
 */
export async function pollOne(table, meal, deps) {
  const { apiBase, sanitize, compress } = deps;
  try {
    const r = await fetch(`${apiBase}/api/v2/import/status/${meal.jobId}`);
    if (r.status === 404) {
      // Job unknown to server — resubmit and wait for next poll cycle.
      await fetch(`${apiBase}/api/v2/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: meal.jobId, url: meal.sourceUrl, sourceHash: meal.sourceHash,
        }),
      });
      return false; // no status change yet
    }
    const job = await r.json();
    if (job.status === 'done' && job.result) {
      const res = job.result;
      const compressedImg = res.imageUrl ? await safeCompress(compress, res.imageUrl) : '';
      await table.update(meal.id, {
        ...res,
        name: sanitize(res.name || ''),
        imageUrl: compressedImg,
        status: 'done',
        importProgress: '',
      });
      return true; // changed
    } else if (job.status === 'failed') {
      await table.update(meal.id, { status: 'failed', importError: job.error || 'Import failed.' });
      return true; // changed
    } else if (job.progress) {
      await table.update(meal.id, { importProgress: job.progress });
      return false; // progress update only, no major status change
    }
    return false;
  } catch {
    return false; /* next tick retries */
  }
}

async function safeCompress(compress, dataOrUrl) {
  try { return await compress(dataOrUrl); }
  catch { return dataOrUrl; }
}
