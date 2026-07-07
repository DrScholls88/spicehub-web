import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressImageUrl } from '../imageCompressor.js';

// imageCompressor.js drives the browser `Image` + `<canvas>` APIs. The
// project's vitest env is plain 'node' (vitest.config.js — kept lean for the
// existing Dexie/node-only import-pipeline tests, no jsdom dependency), so
// this file hand-stubs just the two primitives compressImageUrl touches,
// scoped to this file via vi.stubGlobal + afterEach cleanup.

class FakeImage {
  set src(value) {
    this._src = value;
    // Real <img> decode is async — queue onload for the next microtask so
    // the synchronous `img.onload = ...; img.src = ...` pattern in
    // compressFromImageSrc still observes it.
    queueMicrotask(() => {
      if (this._src === 'data:image/broken') { this.onerror?.(); return; }
      this.width = 800;
      this.height = 600;
      this.onload?.();
    });
  }
  get src() { return this._src; }
}

function stubBrowserImageApis() {
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        // Long enough to clear compressImageUrl's own "webp not supported"
        // fallback check (`dataUrl.length < 50` → retries as jpeg) — a real
        // encoded image is always well over 50 chars, so a short fake string
        // here would spuriously trigger that fallback and mask which format
        // was actually requested.
        toDataURL: (format) => `data:${format || 'image/webp'};base64,${'A'.repeat(80)}`,
      };
    },
  });
}

beforeEach(() => stubBrowserImageApis());
afterEach(() => vi.unstubAllGlobals());

describe('compressImageUrl', () => {
  it('decodes a data: URL directly, without calling fetch (CSP: connect-src forbids data:)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const input = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
    const out = await compressImageUrl(input);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toMatch(/^data:image\/webp/);
    expect(out.length).toBeLessThan(input.length);
  });

  it('decodes a blob: URL directly, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const out = await compressImageUrl('blob:http://localhost/abc-123');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toMatch(/^data:image\/webp/);
  });

  it('resolves null (not throw) when a data: URL fails to decode', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const out = await compressImageUrl('data:image/broken');
    expect(out).toBeNull();
  });

  it('still fetches http(s) URLs — that path is unchanged', async () => {
    const fakeBlob = { type: 'image/png' };
    const fetchSpy = vi.fn(async () => ({ ok: true, blob: async () => fakeBlob }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake-object-url', revokeObjectURL: () => {} });

    const out = await compressImageUrl('https://example.com/photo.jpg');

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/photo.jpg', { mode: 'cors' });
    expect(out).toMatch(/^data:image\/webp/);
  });

  it('returns null when the http(s) fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await compressImageUrl('https://example.com/missing.jpg')).toBeNull();
  });
});
