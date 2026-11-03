// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: VIDEO FILE — a saved Reel, TikTok download or screen recording the
// person uploads from their own device.
//
// This is the fallback for videos a link import can't reach (login walls,
// deleted posts, no signal). A local file has no CORS or bot wall, so both
// halves run in the browser:
//   1. Speech → on-device Whisper (transcriptionService.transcribeFromFile).
//      Works OFFLINE once the model and onnxruntime have been fetched once
//      (Transformers.js caches the model; sw.js caches the runtime).
//   2. On-screen text → a few frames sampled with <video> + <canvas>, read by
//      the online vision tiers only when speech left the recipe thin, exactly
//      like carousel slides and URL frames (readFrameImages).
// A middle frame becomes the hero photo. The engine structures the pack, and
// falls back to the on-device parser when /api/structure is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
import { transcribeFromFile } from '../../lib/transcriptionService.js';
import { createContextPack, addProvenance } from '../contextPack.js';
import { needsOnScreenText, readFrameImages, spokenToLines } from './videoFrames.js';

export const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // decodeAudioData holds the whole file in memory
const FRAME_COUNT = 9;          // + the final second = photoImportEngine MAX_PAGES (10)
const FRAME_MAX_WIDTH = 720;
const MIN_TRANSCRIPT_CHARS = 20;

/** True for a File the browser reports as video (or a common video extension). */
export function isVideoFile(file) {
  return !!file && (/^video\//.test(file.type || '') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name || ''));
}

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${event}-timeout`)); }, timeoutMs);
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('video-unreadable')); };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    }
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/**
 * Sample FRAME_COUNT frames spread evenly across a local video, plus one from
 * the final half-second (end cards often carry the whole ingredient list).
 * Best effort: returns [] when the browser can't decode or seek the file.
 *
 * @returns {Promise<string[]>} JPEG data URLs in time order
 */
export async function sampleVideoFileFrames(file, { signal, count = FRAME_COUNT } = {}) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return [];
  const src = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  try {
    await once(video, 'loadedmetadata', 15000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth) return [];
    const width = Math.min(FRAME_MAX_WIDTH, video.videoWidth);
    const height = Math.round(width * (video.videoHeight / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
    times.push(Math.max(0, duration - 0.5));
    const frames = [];
    for (const t of times) {
      if (signal?.aborted) break;
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      await once(video, 'seeked', 8000);
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    return frames;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(src);
  }
}

/** The pack's words as line-broken text, for the on-device (offline) parser. */
export function videoPackText(pack) {
  return [pack?.frameText, spokenToLines(pack?.transcript)].filter(Boolean).join('\n');
}

/**
 * Build a ContextPack from a local video file. Returns { pack, reason }; pack
 * is null when neither speech nor on-screen text produced anything.
 *
 * @param {File} file
 * @param {{ signal?: AbortSignal, onProgress?: (msg: string) => void, model?: string }} opts
 */
export async function acquireVideoFilePack(file, { signal, onProgress = () => {}, model } = {}) {
  if (!isVideoFile(file)) return { pack: null, reason: 'not-a-video' };
  if (file.size > MAX_VIDEO_BYTES) return { pack: null, reason: 'video-too-large' };
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  const pack = createContextPack({
    sourceType: 'video',
    title: String(file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(),
    acquiredVia: 'video-file',
    confidence: 0.5,
  });

  // 1) Speech — on-device, works offline once the model is cached.
  let whisperError = '';
  try {
    onProgress('Transcribing your video audio…');
    const result = await transcribeFromFile(file, {
      signal,
      model,
      onProgress: (_tier, msg) => onProgress(msg),
    });
    if (result?.transcript && result.transcript.trim().length >= MIN_TRANSCRIPT_CHARS) {
      pack.transcript = result.transcript.trim();
      addProvenance(pack, 'transcript', result.extractedVia || 'browser-whisper');
    }
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    whisperError = err?.message || 'whisper-failed';
  }

  // 2) Frames — the hero photo always; on-screen text only when speech was thin.
  const frames = await sampleVideoFileFrames(file, { signal });
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  if (frames.length) pack.images = [{ url: frames[Math.floor(frames.length / 2)], kind: 'frame' }];
  if (online && frames.length && needsOnScreenText(pack)) {
    onProgress('Reading the on-screen text in the video…');
    try {
      await readFrameImages(pack, frames, { signal });
    } catch (err) {
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
    }
  }

  if (!pack.transcript && !pack.frameText) {
    // Offline + Whisper not yet downloaded is the one case worth naming.
    return { pack: null, reason: !online && whisperError ? 'whisper-not-cached' : 'no-recipe-in-video' };
  }
  return { pack, reason: '' };
}
