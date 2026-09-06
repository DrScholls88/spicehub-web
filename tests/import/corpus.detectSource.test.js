import { describe, it, expect } from 'vitest';
import { detectSource } from '../../src/import/detectSource.js';

describe('detectSource', () => {
  // ── One case per return value ──────────────────────────────────────────────

  it('Instagram URL → instagram', () => {
    expect(detectSource({ url: 'https://www.instagram.com/reel/ABC123/' })).toBe('instagram');
    expect(detectSource({ url: 'https://instagram.com/p/XYZ789/' })).toBe('instagram');
  });

  it('YouTube URL → youtube', () => {
    expect(detectSource({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBe('youtube');
    expect(detectSource({ url: 'https://youtu.be/dQw4w9WgXcQ' })).toBe('youtube');
  });

  it('TikTok URL → tiktok', () => {
    expect(detectSource({ url: 'https://www.tiktok.com/@user/video/1234567890' })).toBe('tiktok');
    expect(detectSource({ url: 'https://vm.tiktok.com/ZMd5r/' })).toBe('tiktok');
  });

  it('generic social (Facebook, X) → social', () => {
    expect(detectSource({ url: 'https://www.facebook.com/reel/123456' })).toBe('social');
    expect(detectSource({ url: 'https://fb.watch/abc123/' })).toBe('social');
    expect(detectSource({ url: 'https://x.com/user/status/123456' })).toBe('social');
    expect(detectSource({ url: 'https://twitter.com/user/status/123456' })).toBe('social');
  });

  it('recipe blog / generic website → website', () => {
    expect(detectSource({ url: 'https://www.seriouseats.com/best-chili-recipe' })).toBe('website');
    expect(detectSource({ url: 'https://example.com/my-recipe' })).toBe('website');
  });

  it('plain text with no URL → text', () => {
    expect(detectSource({ text: 'Mix flour, sugar, and eggs.' })).toBe('text');
    expect(detectSource({ text: '' })).toBe('text');
    expect(detectSource({})).toBe('text');
  });

  it('photo pages → photo', () => {
    expect(detectSource({ pages: [{ id: 'p1', dataUrl: 'data:image/png;base64,...' }] })).toBe('photo');
  });

  // ── The three cases the brief's three-enum detect would miss ──────────────

  it('Pinterest URL → pinterest (not just website)', () => {
    expect(detectSource({ url: 'https://www.pinterest.com/pin/12345/' })).toBe('pinterest');
    expect(detectSource({ url: 'https://pin.it/abc123' })).toBe('pinterest');
  });

  it('Reddit URL → reddit (not just website)', () => {
    expect(detectSource({ url: 'https://www.reddit.com/r/recipes/comments/abc123/best_chili/' })).toBe('reddit');
    expect(detectSource({ url: 'https://old.reddit.com/r/Cooking/comments/xyz/post/' })).toBe('reddit');
    expect(detectSource({ url: 'https://redd.it/abc123' })).toBe('reddit');
  });

  it('pasted text containing a URL → detects the URL source, not text', () => {
    // Blog URL inside pasted text → website
    expect(detectSource({
      text: 'Check out this recipe https://www.seriouseats.com/best-chili-recipe so good!'
    })).toBe('website');

    // Social URL inside pasted text → the platform
    expect(detectSource({
      text: 'Made this last night https://www.instagram.com/reel/ABC123/ amazing'
    })).toBe('instagram');

    // Reddit URL inside pasted text → reddit
    expect(detectSource({
      text: 'Found this on reddit https://www.reddit.com/r/recipes/comments/abc123/post/'
    })).toBe('reddit');
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('explicit url takes priority over text', () => {
    expect(detectSource({
      url: 'https://www.instagram.com/reel/ABC123/',
      text: 'some recipe text here'
    })).toBe('instagram');
  });

  it('empty pages array → falls through to url/text', () => {
    expect(detectSource({ pages: [], url: 'https://example.com/recipe' })).toBe('website');
    expect(detectSource({ pages: [], text: 'Mix ingredients' })).toBe('text');
  });

  it('null/undefined input → text', () => {
    expect(detectSource(null)).toBe('text');
    expect(detectSource(undefined)).toBe('text');
  });
});
