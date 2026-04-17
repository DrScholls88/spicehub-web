// tests/e2e/unified-import.spec.js
// End-to-end smoke tests for the Unified Import Engine (v2).
//
// These tests hit the real Express server (no mocking) and require:
//   ENABLE_V2_IMPORT=true
//   GEMINI_API_KEY=<any non-empty string for basic route tests>
//
// Run with:
//   npm run test:e2e
//
// Full Instagram tests require IG_COOKIES_JSON_B64 to be set and are
// skipped automatically when the env var is absent.

import { test, expect, request } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Start the Express server on a random port; returns { baseUrl, close }. */
async function startServer() {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn(
      process.execPath,
      ['server/index.js'],
      {
        cwd: new URL('../../', import.meta.url).pathname,
        env: {
          ...process.env,
          ENABLE_V2_IMPORT: 'true',
          PORT: '0', // random port
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let output = '';
    serverProcess.stdout.on('data', (chunk) => {
      output += chunk.toString();
      // Server logs "Listening on port XXXXX"
      const m = output.match(/Listening on port (\d+)/i);
      if (m) resolve({ baseUrl: `http://localhost:${m[1]}`, close: () => serverProcess.kill() });
    });
    serverProcess.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    serverProcess.on('error', reject);
    setTimeout(() => reject(new Error(`Server did not start in time.\n${output}`)), 15_000);
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('POST /api/v2/import', () => {
  let server;
  let apiContext;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer();
    apiContext = await playwright.request.newContext({ baseURL: server.baseUrl });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
    server.close();
  });

  test('returns 400 when url is missing', async () => {
    const resp = await apiContext.post('/api/v2/import', { data: {} });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 when url is not a string', async () => {
    const resp = await apiContext.post('/api/v2/import', { data: { url: 42 } });
    expect(resp.status()).toBe(400);
  });

  test('returns 202 with jobId for a valid public URL', async () => {
    // Uses a known-public recipe page so no cookies required
    const resp = await apiContext.post('/api/v2/import', {
      data: { url: 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/' },
    });
    // 202 = accepted; 409 = duplicate (if test runs twice). Both are valid.
    expect([202, 409]).toContain(resp.status());
    const body = await resp.json();
    expect(body).toHaveProperty('jobId');
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
    expect(body).toHaveProperty('sourceHash');
  });

  test('returns 409 (duplicate) on second identical request within TTL', async () => {
    const url = 'https://www.allrecipes.com/recipe/25080/mmmmm-brownies/';
    const first = await apiContext.post('/api/v2/import', { data: { url } });
    expect([202, 409]).toContain(first.status());
    const firstBody = await first.json();

    const second = await apiContext.post('/api/v2/import', { data: { url } });
    // Same sourceHash → 409 duplicate
    expect(second.status()).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.jobId).toBe(firstBody.jobId);
    expect(secondBody.duplicate).toBe(true);
  });
});

test.describe('GET /api/v2/import/status/:jobId', () => {
  let server;
  let apiContext;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer();
    apiContext = await playwright.request.newContext({ baseURL: server.baseUrl });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
    server.close();
  });

  test('returns 404 for unknown jobId', async () => {
    const resp = await apiContext.get('/api/v2/import/status/no-such-job-xyz');
    expect(resp.status()).toBe(404);
  });

  test('returns status for a known job', async () => {
    // Create a job first
    const postResp = await apiContext.post('/api/v2/import', {
      data: { url: 'https://www.allrecipes.com/recipe/16354/easy-meatloaf/' },
    });
    expect([202, 409]).toContain(postResp.status());
    const { jobId } = await postResp.json();

    const statusResp = await apiContext.get(`/api/v2/import/status/${jobId}`);
    expect(statusResp.status()).toBe(200);
    const body = await statusResp.json();
    expect(['processing', 'done', 'failed']).toContain(body.status);
  });

  test('job eventually reaches done or failed (30s timeout)', async () => {
    test.setTimeout(40_000); // extra time for network + Gemini

    const postResp = await apiContext.post('/api/v2/import', {
      data: { url: 'https://www.allrecipes.com/recipe/158968/spinach-and-feta-turkey-burgers/' },
    });
    expect([202, 409]).toContain(postResp.status());
    const { jobId } = await postResp.json();

    const deadline = Date.now() + 30_000;
    let finalStatus = 'processing';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const resp = await apiContext.get(`/api/v2/import/status/${jobId}`);
      const body = await resp.json();
      finalStatus = body.status;
      if (finalStatus !== 'processing') break;
    }
    expect(['done', 'failed']).toContain(finalStatus);
  });
});

test.describe('Instagram import (requires IG_COOKIES_JSON_B64)', () => {
  test.skip(!process.env.IG_COOKIES_JSON_B64, 'IG_COOKIES_JSON_B64 not set — skipping Instagram tests');

  let server;
  let apiContext;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer();
    apiContext = await playwright.request.newContext({ baseURL: server.baseUrl });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
    server.close();
  });

  test('imports a real Instagram reel URL and reaches done or failed', async () => {
    test.setTimeout(90_000);

    // A public cooking reel — change if this post is deleted
    const url = 'https://www.instagram.com/p/C5example/'; // placeholder; swap for a real reel

    const postResp = await apiContext.post('/api/v2/import', { data: { url } });
    expect([202, 409]).toContain(postResp.status());
    const { jobId } = await postResp.json();

    const deadline = Date.now() + 75_000;
    let body = { status: 'processing' };
    while (Date.now() < deadline && body.status === 'processing') {
      await new Promise((r) => setTimeout(r, 3_000));
      const resp = await apiContext.get(`/api/v2/import/status/${jobId}`);
      body = await resp.json();
    }

    expect(['done', 'failed']).toContain(body.status);
    if (body.status === 'done') {
      expect(body.recipe).toHaveProperty('name');
      expect(Array.isArray(body.recipe.ingredients)).toBe(true);
    }
  });
});
