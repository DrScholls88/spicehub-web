import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as jobStore from '../jobStore.js';
import { registerImportRoutes } from '../importRoutes.js';
import { ExtractError } from '../coordinator.js';

function mountApp(runWaterfallMock) {
  const app = express();
  app.use(express.json());
  registerImportRoutes(app, { runWaterfall: runWaterfallMock });
  return app;
}

function mountAppSync(runWaterfallSyncMock) {
  const app = express();
  app.use(express.json());
  registerImportRoutes(app, { runWaterfall: async () => {}, runWaterfallSync: runWaterfallSyncMock });
  return app;
}

beforeEach(() => jobStore._resetForTests());

describe('POST /api/v2/import', () => {
  it('returns 400 without jobId or url', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).post('/api/v2/import').send({ jobId: 'j' });
    expect(r.status).toBe(400);
  });

  it('enqueues a new job and returns 202', async () => {
    const ranWith = vi.fn();
    const app = mountApp(async (payload) => { ranWith(payload); jobStore.put(payload.jobId, { status: 'done', result: {} }); });
    const r = await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x', sourceHash: 'h' });
    expect(r.status).toBe(202);
    expect(r.body.jobId).toBe('j1');
    expect(ranWith).toHaveBeenCalled();
  });

  it('is idempotent — second POST does not re-run the waterfall', async () => {
    const ran = vi.fn();
    const app = mountApp(async () => { ran(); });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    expect(ran).toHaveBeenCalledOnce();
  });
});

describe('GET /api/v2/import/status/:jobId', () => {
  it('returns 404 for unknown job', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).get('/api/v2/import/status/unknown');
    expect(r.status).toBe(404);
  });

  it('returns status and result for a done job', async () => {
    const app = mountApp(async (p) => { jobStore.put(p.jobId, { status: 'done', result: { name: 'n', ingredients: [], directions: [], imageUrl: '', link: '', yield: '', prepTime: '', cookTime: '' } }); });
    await request(app).post('/api/v2/import').send({ jobId: 'j1', url: 'https://x' });
    // Give the async waterfall a microtask to complete
    await new Promise((r) => setImmediate(r));
    const r = await request(app).get('/api/v2/import/status/j1');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('done');
    expect(r.body.result.name).toBe('n');
  });
});

describe('GET /api/v2/ping', () => {
  it('returns 200 immediately', async () => {
    const app = mountApp(async () => {});
    const r = await request(app).get('/api/v2/ping');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('POST /api/v2/import/sync', () => {
  it('returns 400 when url is missing', async () => {
    const app = mountAppSync(async () => {});
    const r = await request(app).post('/api/v2/import/sync').send({});
    expect(r.status).toBe(400);
  });

  it('returns 200 with recipe on success', async () => {
    const recipe = { name: 'Tacos', ingredients: ['beef'], directions: ['cook'], imageUrl: '', link: 'https://x', yield: '', prepTime: '', cookTime: '' };
    const app = mountAppSync(async () => recipe);
    const r = await request(app).post('/api/v2/import/sync').send({ url: 'https://x.com/recipe' });
    expect(r.status).toBe(200);
    expect(r.body.recipe.name).toBe('Tacos');
  });

  it('returns 422 with partial text on ExtractError', async () => {
    const app = mountAppSync(async () => { throw new ExtractError('blocked', 'some captured text'); });
    const r = await request(app).post('/api/v2/import/sync').send({ url: 'https://instagram.com/p/x' });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('extraction_failed');
    expect(r.body.partial.capturedText).toBe('some captured text');
  });
});
