import { describe, it, expect } from 'vitest';
import { isInstagramUrl, firstImageUrl, asStringArray } from '../util.js';

describe('isInstagramUrl', () => {
  it('true for instagram.com and www.instagram.com', () => {
    expect(isInstagramUrl('https://www.instagram.com/reel/abc/')).toBe(true);
    expect(isInstagramUrl('https://instagram.com/p/xyz/')).toBe(true);
  });
  it('false for non-ig hosts and bad input', () => {
    expect(isInstagramUrl('https://tiktok.com/@x/video/1')).toBe(false);
    expect(isInstagramUrl('')).toBe(false);
    expect(isInstagramUrl(null)).toBe(false);
  });
});

describe('firstImageUrl', () => {
  it('prefers data URLs over http', () => {
    const r = { image: ['https://cdn/y.jpg', 'data:image/jpeg;base64,AAA'] };
    expect(firstImageUrl(r)).toBe('data:image/jpeg;base64,AAA');
  });
  it('returns string image directly', () => {
    expect(firstImageUrl({ image: 'https://x/1.jpg' })).toBe('https://x/1.jpg');
  });
  it('falls back through image → imageUrl → images[]', () => {
    expect(firstImageUrl({ imageUrl: 'https://x/2.jpg' })).toBe('https://x/2.jpg');
    expect(firstImageUrl({ images: ['https://x/3.jpg'] })).toBe('https://x/3.jpg');
    expect(firstImageUrl({})).toBe('');
  });
});

describe('asStringArray', () => {
  it('preserves arrays of strings', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('splits newline-separated strings', () => {
    expect(asStringArray('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });
  it('unwraps {text:...} and {name:...} objects', () => {
    expect(asStringArray([{ text: 'a' }, { name: 'b' }])).toEqual(['a', 'b']);
  });
  it('filters empty strings', () => {
    expect(asStringArray(['a', '', '  ', 'b'])).toEqual(['a', 'b']);
  });
});
