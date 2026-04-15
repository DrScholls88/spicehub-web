import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollOne } from '../importWorker.js';

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async update(id, patch) {
      const prev = rows.get(id) || {};
      rows.set(id, { ...prev, ...patch });
    },
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('pollOne', () => {
  it('updates Dexie with done result + sanitized name + compressed image', async () => {
    const db = fakeDb();
    db.rows.set(1, { id: 1, jobId: 'j1', sourceUrl: 'https://x' });

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j1', status: 'done', result: { name: 'Raw Title', ingredients: ['a'], directions: ['b'], imageUrl: 'data:image/jpeg;base64,AAA', link: 'https://x' } }),
    });

    const deps = {
      apiBase: 'http://srv',
      sanitize: (s) => s.replace('Raw ', ''),
      compress: async (u) => `COMPRESSED:${u}`,
    };
    await pollOne(db, db.rows.get(1), deps);

    const row = db.rows.get(1);
    expect(row.status).toBe('done');
    expect(row.name).toBe('Title');
    expect(row.imageUrl).toBe('COMPRESSED:data:image/jpeg;base64,AAA');
  });

  it('re-enqueues on 404 from status endpoint', async () => {
    const db = fakeDb();
    db.rows.set(2, { id: 2, jobId: 'j2', sourceUrl: 'https://x', sourceHash: 'h' });

    const calls = [];
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, method: opts?.method || 'GET' });
      if (url.endsWith('/status/j2')) return { status: 404, json: async () => ({ error: 'unknown' }) };
      return { status: 202, json: async () => ({ jobId: 'j2', status: 'queued' }) };
    });

    await pollOne(db, db.rows.get(2), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });

    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe('http://srv/api/v2/import');
  });

  it('marks row as failed when server reports failed', async () => {
    const db = fakeDb();
    db.rows.set(3, { id: 3, jobId: 'j3', sourceUrl: 'https://x' });
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j3', status: 'failed', error: 'nope' }),
    });
    await pollOne(db, db.rows.get(3), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });
    const row = db.rows.get(3);
    expect(row.status).toBe('failed');
    expect(row.importError).toBe('nope');
  });

  it('updates progress for still-processing jobs', async () => {
    const db = fakeDb();
    db.rows.set(4, { id: 4, jobId: 'j4', sourceUrl: 'https://x' });
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ jobId: 'j4', status: 'processing', progress: 'AI structuring…' }),
    });
    await pollOne(db, db.rows.get(4), { apiBase: 'http://srv', sanitize: (x) => x, compress: async (x) => x });
    expect(db.rows.get(4).importProgress).toBe('AI structuring…');
  });
});
