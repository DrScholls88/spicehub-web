// server/importRoutes.js
import * as jobStore from './jobStore.js';
import { runWaterfall as defaultRunWaterfall, runWaterfallSync as defaultRunWaterfallSync, ExtractError } from './coordinator.js';

export function registerImportRoutes(app, {
  runWaterfall = defaultRunWaterfall,
  runWaterfallSync = defaultRunWaterfallSync,
} = {}) {

  // ── Warmup ping (keeps Render alive) ────────────────────────────────────────
  app.get('/api/v2/ping', (_req, res) => res.json({ ok: true }));

  // ── Synchronous waterfall (new primary path) ─────────────────────────────────
  app.post('/api/v2/import/sync', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    try {
      const recipe = await runWaterfallSync({ url });
      return res.json({ recipe });
    } catch (err) {
      if (err instanceof ExtractError || err?.name === 'ExtractError') {
        return res.status(422).json({
          error: 'extraction_failed',
          message: err.message,
          partial: { capturedText: err.capturedText || '' },
        });
      }
      console.error('[sync import error]', err);
      return res.status(500).json({ error: 'internal_error', message: err.message });
    }
  });

  // ── Background async import (kept for compatibility) ────────────────────────
  app.post('/api/v2/import', async (req, res) => {
    const { jobId, url, sourceHash } = req.body || {};
    if (!jobId || !url) return res.status(400).json({ error: 'jobId and url required' });

    const existing = jobStore.get(jobId);
    if (existing) return res.status(202).json({ jobId, status: existing.status });

    jobStore.put(jobId, { status: 'queued', url, sourceHash });
    Promise.resolve()
      .then(() => runWaterfall({ jobId, url, sourceHash }))
      .catch((err) => jobStore.put(jobId, { status: 'failed', error: err.message || String(err) }));
    res.status(202).json({ jobId, status: 'queued' });
  });

  app.get('/api/v2/import/status/:jobId', (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'unknown job' });
    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress || '',
      result: job.status === 'done' ? job.result : undefined,
      error:  job.status === 'failed' ? job.error : undefined,
      updatedAt: job.updatedAt,
    });
  });
}
