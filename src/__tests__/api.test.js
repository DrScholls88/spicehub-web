import { describe, expect, it } from 'vitest';
import { cleanUrl } from '../api.js';

describe('cleanUrl', () => {
  it('keeps the fully qualified Instagram URL from a concatenated paste', () => {
    const pasted = 'instagram.com/reel/DCaQkFNytrh/?igsh=xhttps://www.instagram.com/reel/DCaQkFNytrh/?igsh=x';
    expect(cleanUrl(pasted)).toBe('https://www.instagram.com/reel/DCaQkFNytrh/?igsh=x');
  });

  it('adds https to schemeless social URLs', () => {
    expect(cleanUrl('instagram.com/reel/abc/')).toBe('https://instagram.com/reel/abc');
  });
});
