import { describe, it, expect } from 'vitest';
import { extractMultipleUrls } from '../recipeParser.js';

describe('extractMultipleUrls', () => {
  it('returns [] for plain text with no URLs', () => {
    expect(extractMultipleUrls('just some text, no links here')).toEqual([]);
  });

  it('returns a single-item array for one social URL', () => {
    expect(extractMultipleUrls('check this out https://www.instagram.com/p/ABC123/'))
      .toEqual(['https://www.instagram.com/p/ABC123/']);
  });

  it('returns all URLs for newline-separated multi-share text', () => {
    const text = [
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
      'https://www.tiktok.com/@user/video/123456',
    ].join('\n');
    expect(extractMultipleUrls(text)).toEqual([
      'https://www.instagram.com/reel/AAA111/',
      'https://www.instagram.com/reel/BBB222/',
      'https://www.tiktok.com/@user/video/123456',
    ]);
  });

  it('dedupes repeated URLs', () => {
    const text = 'https://www.instagram.com/reel/AAA111/ https://www.instagram.com/reel/AAA111/';
    expect(extractMultipleUrls(text)).toEqual(['https://www.instagram.com/reel/AAA111/']);
  });

  it('ignores non-social-media URLs', () => {
    const text = 'https://www.instagram.com/reel/AAA111/ https://example.com/page';
    expect(extractMultipleUrls(text)).toEqual(['https://www.instagram.com/reel/AAA111/']);
  });

  it('strips trailing punctuation from space-separated URLs', () => {
    const text = 'Look at https://www.instagram.com/p/XYZ987/, and https://www.tiktok.com/@u/video/9.';
    expect(extractMultipleUrls(text)).toEqual([
      'https://www.instagram.com/p/XYZ987/',
      'https://www.tiktok.com/@u/video/9',
    ]);
  });

  it('returns [] for empty/non-string input', () => {
    expect(extractMultipleUrls('')).toEqual([]);
    expect(extractMultipleUrls(null)).toEqual([]);
    expect(extractMultipleUrls(undefined)).toEqual([]);
  });
});
