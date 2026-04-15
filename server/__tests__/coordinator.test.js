import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jobStore from '../jobStore.js';
import { runWaterfall } from '../coordinator.js';

beforeEach(() => jobStore._resetForTests());

const fakeDeps = ({ meta, stealth, structured, persist }) => ({
  runMetadata: vi.fn(async () => meta),
  runStealth: vi.fn(async () => stealth),
  structureWithGemini: vi.fn(async () => structured),
  persistImage: vi.fn(async (url) => persist?.(url) ?? url),
});

describe('runWaterfall', () => {
  it('short-circuits when metadata confidence >= 0.9', async () => {
    const deps = fakeDeps({
      meta: { ok: true, confidence: 0.95, recipe: { name: 'r', ingredients: ['a'], directions: ['b'], image: 'https://x/1.jpg' } },
    });
    await runWaterfall({ jobId: 'j1', url: 'https://www.allrecipes.com/x' }, deps);

    expect(deps.runMetadata).toHaveBeenCalledOnce();
    expect(deps.runStealth).not.toHaveBeenCalled();
    expect(deps.structureWithGemini).not.toHaveBeenCalled();

    const j = jobStore.get('j1');
    expect(j.status).toBe('done');
    expect(j.result.name).toBe('r');
  });

  it('runs stealth then structurer when metadata is weak on an Instagram URL', async () => {
    const deps = fakeDeps({
      meta: { ok: false, error: 'no-data' },
      stealth: { ok: true, caption: 'Yummy recipe: 1 cup flour\nMix.', imageUrls: ['https://cdn/ig.jpg'] },
      structured: { ok: true, recipe: { name: 'Yummy', ingredients: ['1 cup flour'], directions: ['Mix.'] } },
    });
    await runWaterfall({ jobId: 'j2', url: 'https://www.instagram.com/reel/abc/' }, deps);

    expect(deps.runStealth).toHaveBeenCalledOnce();
    expect(deps.structureWithGemini).toHaveBeenCalledOnce();

    const j = jobStore.get('j2');
    expect(j.status).toBe('done');
    expect(j.result.name).toBe('Yummy');
    expect(j.result.ingredients).toEqual(['1 cup flour']);
  });

  it('skips stealth for non-Instagram URLs', async () => {
    const deps = fakeDeps({
      meta: { ok: false, error: 'no-data' },
      structured: { ok: false, error: 'no-data' },
    });
    await runWaterfall({ jobId: 'j3', url: 'https://someblog.com/r' }, deps);

    expect(deps.runStealth).not.toHaveBeenCalled();
    const j = jobStore.get('j3');
    expect(j.status).toBe('failed');
  });

  it('marks failed when no sources return data', async () => {
    const deps = fakeDeps({
      meta: { ok: false },
      stealth: { ok: false, error: 'login-wall' },
    });
    await runWaterfall({ jobId: 'j4', url: 'https://www.instagram.com/p/x/' }, deps);
    const j = jobStore.get('j4');
    expect(j.status).toBe('failed');
    expect(j.error).toMatch(/No recipe data/i);
  });

  it('marks failed when structurer errors', async () => {
    const deps = fakeDeps({
      meta: { ok: true, confidence: 0.5, recipe: { name: 'x', ingredients: [], directions: [] } },
      stealth: { ok: true, caption: 'stuff', imageUrls: [] },
      structured: { ok: false, error: 'gemini-timeout' },
    });
    await runWaterfall({ jobId: 'j5', url: 'https://www.instagram.com/reel/y/' }, deps);
    const j = jobStore.get('j5');
    expect(j.status).toBe('failed');
    expect(j.error).toBe('gemini-timeout');
  });

  it('prefers data-URL images from stealth video frames over CDN URLs', async () => {
    const deps = fakeDeps({
      meta: { ok: false },
      stealth: { ok: true, caption: 'c', imageUrls: ['data:image/jpeg;base64,AAAA', 'https://cdn/ig.jpg'] },
      structured: { ok: true, recipe: { name: 'N', ingredients: ['i'], directions: ['d'], image: 'data:image/jpeg;base64,AAAA' } },
      persist: (u) => u, // passthrough
    });
    await runWaterfall({ jobId: 'j6', url: 'https://www.instagram.com/reel/abc/' }, deps);
    const j = jobStore.get('j6');
    expect(j.status).toBe('done');
    expect(j.result.imageUrl.startsWith('data:image')).toBe(true);
  });
});
