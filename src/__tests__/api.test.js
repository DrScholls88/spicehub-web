import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanUrl, downloadImageAsDataUrl } from '../api.js';

describe('cleanUrl', () => {
  it('keeps the fully qualified Instagram URL from a concatenated paste', () => {
    const pasted = 'instagram.com/reel/DCaQkFNytrh/?igsh=xhttps://www.instagram.com/reel/DCaQkFNytrh/?igsh=x';
    expect(cleanUrl(pasted)).toBe('https://www.instagram.com/reel/DCaQkFNytrh/?igsh=x');
  });

  it('adds https to schemeless social URLs', () => {
    expect(cleanUrl('instagram.com/reel/abc/')).toBe('https://instagram.com/reel/abc');
  });
});

describe('downloadImageAsDataUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not direct-fetch Instagram CDN URLs in the browser', async () => {
    const dataUrl = 'data:image/jpeg;base64,abc123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataUrl }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const cdnUrl = 'https://scontent-atl3-3.cdninstagram.com/v/t51.2885-15/photo.jpg?oh=signed';
    await expect(downloadImageAsDataUrl(cdnUrl)).resolves.toBe(dataUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [firstUrl] = fetchMock.mock.calls[0];
    expect(firstUrl).toContain('/api/proxy?mode=image-data-url');
    expect(firstUrl).not.toBe(cdnUrl);
  });
});
