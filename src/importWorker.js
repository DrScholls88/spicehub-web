// src/importWorker.js
import { useEffect, useCallback } from 'react';
import db from './db.js';
import { sanitizeRecipeTitle } from './recipeParser.js';
import { compressImageUrl as defaultCompress } from './imageCompressor.js';

const API_BASE = import.meta.env?.VITE_API_BASE || '';

// Any ghost row older than this is considered abandoned and gets evicted
// on the next worker tick — kills the "holds onto failed imports" complaint.
const STALE_GHOST_MS = 90_000;

/**
 * purgeStaleGhostRows — sweeps Dexie for rows stuck in status='processing'
 * older than STALE_GHOST_MS and marks them failed with a clear error message.
 * Returns the number of rows purged so callers can refresh UI.
 *
 * Exported standalone so App.jsx can run it once at startup, in addition
 * to the per-tick sweep done inside useImportWorker.
 */
export async function purgeStaleGhostRows(table = db.meals, now = Date.now(), maxAgeMs = STALE_GHOST_MS) {
  let purged = 0;
  try {
    const stuck = await table.where('status').equals('processing').toArray();
    for (const row of stuck) {
      // createdAt may be ISO string, Date, or number — normalize defensively.
      let createdAtMs = 0;
      if (typeof row.createdAt === 'number') createdAtMs = row.createdAt;
      else if (row.createdAt instanceof Date) createdAtMs = row.createdAt.getTime();
      else if (typeof row.createdAt === 'string') {
        const t = Date.parse(row.createdAt);
        if (!Number.isNaN(t)) createdAtMs = t;
      }
      // If we can't parse createdAt at all, treat the row as already stale —
      // legacy rows from before we tracked timestamps shouldn't pin the queue.
      const age = createdAtMs > 0 ? now - createdAtMs : Infinity;
      if (age > maxAgeMs) {
        await table.update(row.id, {
          status: 'failed',
          importError: 'Import timed out — please try again.',
          importProgress: '',
        });
        purged += 1;
      }
    }
  } catch (err) {
    // Never let a Dexie hiccup crash the poll loop.
    console.warn('[importWorker] purgeStaleGhostRows failed:', err?.message || err);
  }
  return purged;
}

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
        // Sweep stale ghosts first. Any row purged here won't be polled below,
        // and we trigger a UI refresh so failed imports drop out of the active
        // list immediately.
        const purged = await purgeStaleGhostRows(db.meals);
        if (purged > 0) stableOnUpdate();

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
    // One immediate sweep on mount kills any ghost rows left behind by a
    // previous session (closed mid-import, browser crash, etc.) before we
    // even start the regular poll cycle.
    purgeStaleGhostRows(db.meals).then((purged) => {
      if (purged > 0) stableOnUpdate();
    }).catch(() => {});
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
