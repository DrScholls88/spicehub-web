// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — single Whisper pass, host-agnostic.
// Asserts acquireVideoAudio is idempotent, covers all three video hosts
// (Instagram, TikTok, YouTube Shorts), and never transcribes twice.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectVideoSource } from '../../src/lib/videoSource.js';

// ── Mock transcription ──────────────────────────────────────────────────────
const mockTranscribeFromUrl = vi.fn(async () => ({
  transcript: 'Two ounces of gin, four ounces of tonic water, pour over ice and garnish with lime.',
  extractedVia: 'mock-whisper',
}));
vi.mock('../../src/lib/transcriptionService.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    transcribeFromUrl: mockTranscribeFromUrl,
    getPreferredWhisperModel: () => 'whisper-1',
  };
});

beforeEach(() => {
  mockTranscribeFromUrl.mockClear();
});

describe('detectVideoSource covers all video hosts', () => {
  it('recognizes Instagram reel URLs', () => {
    expect(detectVideoSource('https://www.instagram.com/reel/ABC123/')).toMatchObject({
      platform: 'instagram',
    });
  });

  it('recognizes Instagram TV URLs', () => {
    expect(detectVideoSource('https://www.instagram.com/tv/XYZ789/')).toMatchObject({
      platform: 'instagram',
    });
  });

  it('recognizes TikTok video URLs', () => {
    expect(detectVideoSource('https://www.tiktok.com/@chef/video/1234567890')).toMatchObject({
      platform: 'tiktok',
    });
  });

  it('recognizes TikTok short URLs (vm.tiktok.com)', () => {
    expect(detectVideoSource('https://vm.tiktok.com/ZMrAbCd/')).toMatchObject({
      platform: 'tiktok',
    });
  });

  it('recognizes TikTok /t/ short URLs', () => {
    expect(detectVideoSource('https://www.tiktok.com/t/ZTRab123/')).toMatchObject({
      platform: 'tiktok',
    });
  });

  it('recognizes YouTube Shorts URLs', () => {
    expect(detectVideoSource('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({
      platform: 'youtube',
    });
  });

  it('returns null for non-video URLs', () => {
    expect(detectVideoSource('https://www.allrecipes.com/recipe/12345')).toBeNull();
  });
});

describe('acquireVideoAudio', () => {
  let acquireVideoAudio;

  beforeEach(async () => {
    const mod = await import('../../src/import/acquire/videoAudio.js');
    acquireVideoAudio = mod.acquireVideoAudio;
  });

  it('transcribes an Instagram reel URL', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.instagram.com/reel/ABC123/' },
    );
    expect(result.transcript).toBeTruthy();
    expect(result.attempted).toBe(true);
    expect(result.via).toBe('mock-whisper');
    expect(mockTranscribeFromUrl).toHaveBeenCalledTimes(1);
  });

  it('transcribes a TikTok URL', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.tiktok.com/@chef/video/1234567890' },
    );
    expect(result.transcript).toBeTruthy();
    expect(result.attempted).toBe(true);
    expect(mockTranscribeFromUrl).toHaveBeenCalledTimes(1);
  });

  it('transcribes a YouTube Shorts URL', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' },
    );
    expect(result.transcript).toBeTruthy();
    expect(result.attempted).toBe(true);
    expect(mockTranscribeFromUrl).toHaveBeenCalledTimes(1);
  });

  it('no-ops when transcript already present (idempotence)', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.instagram.com/reel/ABC123/', transcript: 'existing transcript' },
    );
    expect(result.transcript).toBeNull();
    expect(result.attempted).toBe(false);
    expect(mockTranscribeFromUrl).not.toHaveBeenCalled();
  });

  it('no-ops when _asrAttempted is already set (idempotence)', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.instagram.com/reel/ABC123/', _asrAttempted: true },
    );
    expect(result.transcript).toBeNull();
    expect(result.attempted).toBe(false);
    expect(mockTranscribeFromUrl).not.toHaveBeenCalled();
  });

  it('no-ops for non-video URLs', async () => {
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.allrecipes.com/recipe/12345' },
    );
    expect(result.transcript).toBeNull();
    expect(result.attempted).toBe(false);
    expect(mockTranscribeFromUrl).not.toHaveBeenCalled();
  });

  it('returns attempted=true even when transcript is too short', async () => {
    mockTranscribeFromUrl.mockResolvedValueOnce({
      transcript: 'short',
      extractedVia: 'mock-whisper',
    });
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.instagram.com/reel/ABC123/' },
    );
    expect(result.transcript).toBeNull();
    expect(result.attempted).toBe(true);
    expect(result.via).toBeNull();
  });

  it('returns attempted=true on transcription error', async () => {
    mockTranscribeFromUrl.mockRejectedValueOnce(new Error('network failure'));
    const result = await acquireVideoAudio(
      { sourceUrl: 'https://www.tiktok.com/@chef/video/1234567890' },
    );
    expect(result.transcript).toBeNull();
    expect(result.attempted).toBe(true);
    expect(result.via).toBeNull();
  });

  it('parser sets _asrAttempted for all video hosts via detectVideoSource', async () => {
    // Verify the source code uses detectVideoSource instead of the old /(reel|tv)/ regex
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/recipeParser.js', 'utf8');
    // The old regex-based check should be gone
    expect(src).not.toMatch(/isVideoPostForAsr\s*=\s*wouldExitEmpty\s*&&\s*\/\\\//);
    // The new detectVideoSource-based check should be present
    expect(src).toMatch(/isVideoPostForAsr\s*=\s*wouldExitEmpty\s*&&\s*!!detectVideoSource\(url\)/);
    // acquireVideoAudio should be called in the parser
    expect(src).toContain('acquireVideoAudio(');
  });

  it('engine video fallback uses acquireVideoAudio instead of transcribeVideoForRecipe', async () => {
    const fs = await import('node:fs');
    // Video fallback logic moved from ImportSheet to engine.js (Task 5).
    const src = fs.readFileSync('src/import/engine.js', 'utf8');
    // The tryVideoFallback helper should use acquireVideoAudio
    expect(src).toContain('acquireVideoAudio(');
    // The engine's URL path calls tryVideoFallback when detectVideoSource matches
    expect(src).toContain('detectVideoSource(');
    expect(src).toContain('tryVideoFallback(');
  });
});
