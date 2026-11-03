// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — importing an uploaded video FILE (saved Reel, screen recording)
// ─────────────────────────────────────────────────────────────────────────────
// The fallback for videos a link can't reach. Speech goes through on-device
// Whisper (works offline once cached); frames are sampled in the browser and
// read by the vision tiers only when speech left the recipe thin. Offline, the
// engine shapes the text on-device instead of calling /api/structure.
// Also pins the structure() fix: a pack with no caption but frame text or a
// transcript must still reach Gemini (a captionless Reel used to return null).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const transcribeFromFile = vi.fn();
vi.mock('../../src/lib/transcriptionService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transcribeFromFile: (...a) => transcribeFromFile(...a),
}));

const transcribePagesOnline = vi.fn();
vi.mock('../../src/lib/photoImportEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transcribePagesOnline: (...a) => transcribePagesOnline(...a),
}));

const structurePack = vi.fn();
vi.mock('../../src/import/structure/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  structurePack: (...a) => structurePack(...a),
}));

let acquiredPack = null;
vi.mock('../../src/import/acquire/instagram.js', () => ({
  acquireInstagramPack: async () => structuredClone(acquiredPack),
  instagramShortcode: () => 'abc',
}));
vi.mock('../../src/import/acquire/instagramFollowers.js', () => ({
  tryInstagramFollowerEnrichment: async () => null,
}));
vi.mock('../../src/import/acquire/videoAudio.js', () => ({
  acquireVideoAudio: async () => ({ transcript: null, attempted: true, via: null }),
}));

const { importRequest } = await import('../../src/import/engine.js');
const { detectSource } = await import('../../src/import/detectSource.js');
const { sampleVideoFileFrames, isVideoFile } = await import('../../src/import/acquire/videoFile.js');

// ── A just-enough <video>/<canvas> for the in-browser sampler ──────────────
let lastVideo;
class FakeVideo extends EventTarget {
  constructor() { super(); this.duration = 30; this.videoWidth = 1080; this.videoHeight = 1920; this.seeks = []; this._src = ''; }
  set src(v) { this._src = v; if (v) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
  get src() { return this._src; }
  set currentTime(t) { this._t = t; this.seeks.push(t); queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
  get currentTime() { return this._t; }
  removeAttribute() { this._src = ''; }
  load() {}
}
const fakeDocument = {
  createElement: (tag) => {
    if (tag === 'video') { lastVideo = new FakeVideo(); return lastVideo; }
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/FRAME' };
  },
};

const reelFile = () => new File([new Uint8Array(64)], 'garlic_pasta-reel.mp4', { type: 'video/mp4' });
const SPOKEN = 'Garlic pasta. You need 200 g spaghetti, 3 cloves garlic and 2 tbsp butter. Toss and serve.';
const FRAME_PAGES = [{ transcript: 'Garlic pasta' }, { transcript: '200 g spaghetti\n3 cloves garlic\n2 tbsp butter' }];

const run = (file = reelFile()) => importRequest({ videoFile: file, kind: 'meal' });

describe('video file import', () => {
  beforeEach(() => {
    vi.stubGlobal('document', fakeDocument);
    transcribeFromFile.mockReset().mockResolvedValue({ transcript: SPOKEN, extractedVia: 'browser-whisper-base' });
    transcribePagesOnline.mockReset().mockResolvedValue({ pages: FRAME_PAGES, contentType: 'recipe', engine: 'gemini' });
    structurePack.mockReset().mockResolvedValue({ isRecipe: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('routes an uploaded video to the video source', () => {
    expect(detectSource({ videoFile: reelFile() })).toBe('video');
    expect(isVideoFile({ name: 'clip.MOV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'card.jpg', type: 'image/jpeg' })).toBe(false);
  });

  it('structures the spoken recipe without a vision call, with a frame as the photo', async () => {
    await run();
    expect(transcribeFromFile).toHaveBeenCalledTimes(1);
    expect(transcribePagesOnline).not.toHaveBeenCalled();
    const sent = structurePack.mock.calls[0][0];
    expect(sent.sourceType).toBe('video');
    expect(sent.caption ?? null).toBeNull();
    expect(sent.transcript).toBe(SPOKEN);
    expect(sent.title).toBe('garlic pasta reel');
    expect(sent.images[0]).toEqual({ url: 'data:image/jpeg;base64,/9j/FRAME', kind: 'frame' });
    expect(sent.provenance).toContainEqual({ field: 'transcript', via: 'browser-whisper-base' });
  });

  it('reads on-screen text when the video has no speech (music-only Reel)', async () => {
    transcribeFromFile.mockResolvedValue(null);
    await run();
    // 9 evenly spread frames + the final half-second, all seeked inside the video.
    expect(transcribePagesOnline.mock.calls[0][0]).toHaveLength(10);
    expect(lastVideo.seeks.at(-1)).toBeCloseTo(29.5);
    expect(lastVideo.seeks.every((t) => t >= 0 && t < 30)).toBe(true);
    const sent = structurePack.mock.calls[0][0];
    expect(sent.frameText).toContain('200 g spaghetti');
    expect(sent.transcript ?? null).toBeNull();
  });

  it('works offline: on-device Whisper, then the on-device parser', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    structurePack.mockRejectedValue(new TypeError('Failed to fetch'));
    const { recipe, pack } = await run();
    expect(transcribePagesOnline).not.toHaveBeenCalled();
    expect(pack.transcript).toBe(SPOKEN);
    expect(recipe.ingredients).toEqual(expect.arrayContaining(['200 g spaghetti', '2 tbsp butter']));
  });

  it('names the missing speech model when offline Whisper has never been downloaded', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    transcribeFromFile.mockRejectedValue(new Error('Failed to fetch model'));
    const result = await run();
    expect(result.gate).toBe('empty');
    expect(result.reasons).toEqual(['whisper-not-cached']);
    expect(structurePack).not.toHaveBeenCalled();
  });

  it('refuses videos too large to decode in memory, before any work', async () => {
    const result = await run({ name: 'long.mp4', type: 'video/mp4', size: 300 * 1024 * 1024 });
    expect(result.reasons).toEqual(['video-too-large']);
    expect(transcribeFromFile).not.toHaveBeenCalled();
  });

  it('the sampler gives up quietly when the browser cannot decode the file', async () => {
    class UndecodableVideo extends FakeVideo {
      set src(v) { if (v) queueMicrotask(() => this.dispatchEvent(new Event('error'))); }
      get src() { return ''; }
    }
    vi.stubGlobal('document', { createElement: (tag) => (tag === 'video' ? new UndecodableVideo() : fakeDocument.createElement(tag)) });
    expect(await sampleVideoFileFrames(reelFile())).toEqual([]);
  });
});

describe('captionless Reel', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SERVER_URL', 'https://resource.test');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, frames: ['data:image/jpeg;base64,/9j/A'] }) })));
    transcribePagesOnline.mockReset().mockResolvedValue({ pages: FRAME_PAGES, contentType: 'recipe', engine: 'gemini' });
    structurePack.mockReset().mockResolvedValue({ isRecipe: false });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('still sends frame text to Gemini when the caption is empty', async () => {
    acquiredPack = {
      sourceUrl: 'https://www.instagram.com/reel/abc/', sourceType: 'instagram', title: '', author: 'chef',
      caption: '', transcript: null, markdown: null, jsonLd: null, candidate: null,
      images: [], provenance: [], acquiredVia: 'apify', confidence: 0.6, isVideo: true,
    };
    await importRequest({ url: 'https://www.instagram.com/reel/abc/', kind: 'meal' });
    expect(structurePack).toHaveBeenCalledTimes(1);
    expect(structurePack.mock.calls[0][0].frameText).toContain('3 cloves garlic');
  });
});
