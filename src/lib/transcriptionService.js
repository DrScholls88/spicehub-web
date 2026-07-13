/**
 * transcriptionService.js — Hybrid audio/video transcription for SpiceHub.
 *
 * Two-tier zero-cost strategy, tried in order:
 *   1. SERVER  — /api/transcribe  (yt-dlp subs → audio download → local Whisper or ASR_ENDPOINT)
 *   2. BROWSER — Transformers.js Whisper in a Web Worker (free, offline, private)
 *
 * No paid cloud APIs. Everything runs on your own hardware.
 *
 * The service is stateless — call transcribeFromUrl() or transcribeFromFile()
 * and get back a plain string transcript. Progress is reported via an optional
 * onProgress(status, detail) callback.
 *
 * Integration: the transcript is fed into captionToRecipe() by the caller
 * (ImportSheet / importFromInstagram), which routes it through the existing
 * Grok/Gemini LLM structuring pipeline. No recipe-specific logic lives here.
 */

import { cleanUrl } from '../api.js';

// ── Constants ────────────────────────────────────────────────────────────────
const WHISPER_MODELS = {
  tiny:    { label: 'Tiny (~40 MB)',   size: 40,  id: 'tiny' },
  base:    { label: 'Base (~150 MB)',  size: 150, id: 'base' },
  small:   { label: 'Small (~500 MB)', size: 500, id: 'small' },
};
const DEFAULT_MODEL = 'base';
const AUDIO_SAMPLE_RATE = 16000; // Whisper expects 16 kHz mono

// ── Singleton worker management ─────────────────────────────────────────────
let _worker = null;
let _workerModelLoaded = false;
let _workerModelName = null;

function getWorker() {
  if (!_worker) {
    _worker = new Worker(
      new URL('../workers/whisperWorker.js', import.meta.url),
      { type: 'module' },
    );
  }
  return _worker;
}

/** Tear down the worker to free memory (e.g. when user navigates away). */
export function destroyWorker() {
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _workerModelLoaded = false;
    _workerModelName = null;
  }
}

// ── Audio extraction from video/audio files ─────────────────────────────────

/**
 * extractAudioFromFile(file) → Float32Array (16 kHz mono PCM)
 *
 * Uses the Web Audio API to decode any browser-supported audio/video format
 * (MP3, MP4, WebM, M4A, WAV, OGG, MOV) into raw PCM samples for Whisper.
 */
export async function extractAudioFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: AUDIO_SAMPLE_RATE,
  });

  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    // Take the first channel (mono)
    const pcm = decoded.getChannelData(0);
    // If the decoded sample rate differs from 16 kHz, resample
    if (decoded.sampleRate !== AUDIO_SAMPLE_RATE) {
      return resample(pcm, decoded.sampleRate, AUDIO_SAMPLE_RATE);
    }
    return pcm;
  } finally {
    await audioCtx.close();
  }
}

/**
 * extractAudioFromBlob(blob) → Float32Array (16 kHz mono PCM)
 * Same as extractAudioFromFile but takes a Blob (e.g. from fetch).
 */
export async function extractAudioFromBlob(blob) {
  const file = new File([blob], 'audio.webm', { type: blob.type || 'audio/webm' });
  return extractAudioFromFile(file);
}

/**
 * Simple linear-interpolation resampler. Not audiophile-grade but more than
 * sufficient for speech recognition. Avoids pulling in a heavy DSP library.
 */
function resample(pcm, fromRate, toRate) {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const outLength = Math.round(pcm.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, pcm.length - 1);
    const frac = srcIdx - lo;
    out[i] = pcm[lo] * (1 - frac) + pcm[hi] * frac;
  }
  return out;
}

// ── Server-side transcription ───────────────────────────────────────────────

/**
 * Try the SpiceHub resource server's /api/transcribe endpoint.
 * This uses yt-dlp for subtitle extraction or audio download + local Whisper / ASR.
 * Returns { ok, transcript, extractedVia } or null if server unreachable.
 */
async function tryServerTranscribe(url, onProgress, { signal } = {}) {
  // Detect server (same logic as recipeParser's detectServer). The localhost
  // fallback must be guarded the same way detectServer() guards it — otherwise
  // production HTTPS builds still queue it as a candidate, and the browser
  // blocks it via CSP (connect-src) after a wasted round trip. This drifted
  // out of sync with detectServer() at some point; keep both guards identical.
  const isLocalHost = typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(window.location.hostname);
  const serverUrls = [
    import.meta.env?.VITE_SERVER_URL,
    isLocalHost ? 'http://localhost:3001' : null,
  ].filter(Boolean);

  for (const serverUrl of serverUrls) {
    try {
      onProgress?.('server', `Checking server transcription…`);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000); // 90s for audio download + ASR

      // Cascade abort from caller
      if (signal) {
        signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }

      const resp = await fetch(`${serverUrl}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl(url) }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) return null;

      const data = await resp.json();
      if (data.ok && data.transcript && data.transcript.length > 20) {
        onProgress?.('server', `Server transcript: ${data.transcript.length} chars (${data.extractedVia || 'server'})`);
        return data;
      }
      // Server downloaded audio but has no ASR — pass audioUrl for browser Whisper
      if (data.audioUrl) {
        onProgress?.('server', 'Server prepared audio — handing off to browser Whisper…');
        return { ...data, audioUrl: `${serverUrl}${data.audioUrl}` };
      }
      return null;
    } catch {
      // Server unreachable or timeout — try next
    }
  }
  return null;
}

// ── Browser-local Whisper (Web Worker) ──────────────────────────────────────

/**
 * Run Whisper inference in the browser via Transformers.js Web Worker.
 * @param {Float32Array} audio - 16 kHz mono PCM
 * @param {object} opts
 * @param {string} [opts.model='base'] - Whisper model tier
 * @param {string} [opts.language] - Force language (or 'auto')
 * @param {function} [opts.onProgress] - (status, detail) callback
 * @param {AbortSignal} [opts.signal] - Abort signal
 * @returns {Promise<{ text: string, chunks?: Array, language?: string, duration?: number }>}
 */
export function transcribeWithBrowserWhisper(audio, opts = {}) {
  const { model = DEFAULT_MODEL, language, onProgress, signal } = opts;

  return new Promise((resolve, reject) => {
    const worker = getWorker();

    function cleanup() {
      worker.removeEventListener('message', handler);
    }

    function handler(e) {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          onProgress?.('browser-whisper', formatWorkerProgress(msg));
          break;

        case 'model-ready':
          _workerModelLoaded = true;
          _workerModelName = msg.model;
          onProgress?.('browser-whisper', 'Model loaded — transcribing…');
          break;

        case 'result':
          cleanup();
          resolve({
            text: msg.text || '',
            chunks: msg.chunks || [],
            language: msg.language,
            duration: msg.duration,
          });
          break;

        case 'error':
          cleanup();
          reject(new Error(msg.error));
          break;
      }
    }

    // Handle abort
    if (signal) {
      signal.addEventListener('abort', () => {
        cleanup();
        reject(new DOMException('Transcription aborted', 'AbortError'));
      }, { once: true });
    }

    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'transcribe', audio, model, language });
  });
}

/** Pre-load the Whisper model without transcribing anything. */
export function preloadWhisperModel(modelName = DEFAULT_MODEL) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();

    function handler(e) {
      if (e.data.type === 'model-ready') {
        worker.removeEventListener('message', handler);
        _workerModelLoaded = true;
        _workerModelName = e.data.model;
        resolve();
      } else if (e.data.type === 'error') {
        worker.removeEventListener('message', handler);
        reject(new Error(e.data.error));
      }
    }

    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'load', model: modelName });
  });
}

function formatWorkerProgress(msg) {
  switch (msg.status) {
    case 'loading-library':   return 'Loading Whisper library…';
    case 'loading-model':     return `Loading model: ${msg.file || ''}…`;
    case 'downloading':       return `Downloading model: ${Math.round(msg.progress || 0)}%`;
    case 'model-file-ready':  return `Downloaded: ${msg.file || 'model file'}`;
    case 'model-loaded':      return 'Model ready';
    case 'transcribing':      return 'Transcribing audio…';
    default:                  return msg.status || 'Processing…';
  }
}

// ── Orchestrator: URL-based transcription ───────────────────────────────────

/**
 * transcribeFromUrl(url, opts) — main entry point for URL-based video imports.
 *
 * Zero-cost two-tier strategy:
 *   1. Server /api/transcribe (yt-dlp subs → audio → local Whisper / ASR)
 *   2. If server returns audio blob but no transcript, run browser Whisper on it
 *
 * @param {string} url - Video URL (Instagram Reel, TikTok, YouTube, etc.)
 * @param {object} opts
 * @param {function} [opts.onProgress] - (tier, message) callback
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model] - Browser Whisper model tier
 * @returns {Promise<{ transcript: string, extractedVia: string } | null>}
 */
export async function transcribeFromUrl(url, opts = {}) {
  const { onProgress, signal, model } = opts;

  // Tier 1: Server-side (yt-dlp + local Whisper / ASR)
  const serverResult = await tryServerTranscribe(url, onProgress, { signal });
  if (serverResult?.ok && serverResult.transcript) {
    return {
      transcript: serverResult.transcript,
      extractedVia: serverResult.extractedVia || 'server-transcribe',
    };
  }

  // Tier 2: Server returned audio blob — run browser Whisper on it
  if (serverResult?.audioUrl) {
    try {
      onProgress?.('browser-whisper', 'Server provided audio — transcribing locally…');
      const audioResp = await fetch(serverResult.audioUrl, { signal });
      const audioBlob = await audioResp.blob();
      const pcm = await extractAudioFromBlob(audioBlob);
      const result = await transcribeWithBrowserWhisper(pcm, { model, onProgress, signal });
      if (result.text && result.text.length > 20) {
        return {
          transcript: result.text,
          extractedVia: `browser-whisper-${model || DEFAULT_MODEL}`,
        };
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('[transcription] Browser Whisper on server audio failed:', err.message);
    }
  }

  onProgress?.('fallback', 'No transcription available for this URL — try uploading the video file directly');
  return null;
}

// ── Orchestrator: File/Blob-based transcription ─────────────────────────────

/**
 * transcribeFromFile(file, opts) — transcribe a user-uploaded video/audio file.
 *
 * Fully offline, zero-cost path — extracts audio via Web Audio API, runs
 * Whisper in the browser Web Worker. No network, no API keys, no cost.
 *
 * @param {File} file - Video or audio file from user input/drag-drop
 * @param {object} opts
 * @param {function} [opts.onProgress] - (tier, message) callback
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model] - Whisper model tier ('tiny'|'base'|'small')
 * @param {string} [opts.language] - Force language or 'auto'
 * @returns {Promise<{ transcript: string, extractedVia: string, duration?: number }>}
 */
export async function transcribeFromFile(file, opts = {}) {
  const { onProgress, signal, model = DEFAULT_MODEL, language } = opts;

  onProgress?.('browser-whisper', 'Extracting audio from file…');
  const pcm = await extractAudioFromFile(file);

  onProgress?.('browser-whisper', `Audio extracted (${(pcm.length / AUDIO_SAMPLE_RATE).toFixed(0)}s) — loading Whisper…`);
  const result = await transcribeWithBrowserWhisper(pcm, {
    model,
    language,
    onProgress,
    signal,
  });

  if (result.text && result.text.length > 10) {
    return {
      transcript: result.text,
      extractedVia: `browser-whisper-${model}`,
      duration: result.duration,
      chunks: result.chunks,
      language: result.language,
    };
  }

  return null;
}

// ── Capability detection ────────────────────────────────────────────────────

/** Check which transcription tiers are available right now. */
export function getTranscriptionCapabilities() {
  return {
    server: Boolean(import.meta.env?.VITE_SERVER_URL),
    browserWhisper: typeof Worker !== 'undefined',
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    modelLoaded: _workerModelLoaded,
    currentModel: _workerModelName,
  };
}

/** Available model tiers with metadata. */
export { WHISPER_MODELS, DEFAULT_MODEL, AUDIO_SAMPLE_RATE };
