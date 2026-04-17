import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistImage } from '../persistImage.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('persistImage', () => {
  it('returns empty string for empty input', async () => {
    expect(await persistImage('')).toBe('');
    expect(await persistImage(null)).toBe('');
  });

  it('passes through data: URLs untouched', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAA';
    expect(await persistImage(dataUrl)).toBe(dataUrl);
  });

  it('downloads and base64-encodes a remote image', async () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h) => h === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: async () => bytes.buffer,
    });
    const result = await persistImage('https://cdn.example/x.jpg');
    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(result).toContain(Buffer.from(bytes).toString('base64'));
  });

  it('returns original URL when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const url = 'https://cdn.example/y.jpg';
    expect(await persistImage(url)).toBe(url);
  });

  it('returns original URL for non-image content-type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h) => h === 'content-type' ? 'text/html' : null },
      arrayBuffer: async () => new ArrayBuffer(100),
    });
    const url = 'https://cdn.example/z.html';
    expect(await persistImage(url)).toBe(url);
  });

  it('returns original URL for >2MB payloads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h) => h === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: async () => new ArrayBuffer(3 * 1024 * 1024),
    });
    const url = 'https://cdn.example/huge.jpg';
    expect(await persistImage(url)).toBe(url);
  });
});
