import * as jobStore from './jobStore.js';
import { ExtractError } from './coordinator.js';

export function registerImportRoutes(app, deps) {
  app.get('/api/v2/ping', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/v2/import', (req, res) => {
    const { jobId, url, sourceHash } = req.body || {};
    if (!jobId || typeof url !== 'string' || !url) {
      return res.status(400).json({ error: 'jobId and url are required' });
    }

    const existing = jobStore.get(jobId);
    if (existing) {
      return res.status(409).json({ jobId, sourceHash, duplicate: true });
    }

    jobStore.put(jobId, { status: 'queued', url, sourceHash });
    Promise.resolve()
      .then(() => deps.runWaterfall({ jobId, url, sourceHash }))
      .catch((err) => jobStore.put(jobId, { status: 'failed', error: err.message }));

    return res.status(202).json({ jobId, sourceHash });
  });

  app.get('/api/v2/import/status/:jobId', (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not found' });
    return res.json(job);
  });

  app.post('/api/v2/import/sync', async (req, res) => {
    const { url } = req.body || {};
    if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'url is required' });
    try {
      const recipe = await deps.runWaterfallSync({ url });
      return res.json({ ok: true, recipe });
    } catch (err) {
      if (err instanceof ExtractError) {
        return res.status(422).json({
          ok: false,
          error: 'extraction_failed',
          partial: { capturedText: err.capturedText || '' },
        });
      }
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}
