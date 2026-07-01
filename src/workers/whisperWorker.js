/**
 * whisperWorker.js — Web Worker for browser-local Whisper transcription.
 *
 * Runs @huggingface/transformers (Transformers.js v3) in an isolated thread so
 * the main UI stays responsive during model download + inference. Communicates
 * via structured postMessage events:
 *
 *   Main → Worker:
 *     { type: 'transcribe', audio: Float32Array, language?: string, model?: string }
 *     { type: 'load',       model?: string }
 *
 *   Worker → Main:
 *     { type: 'progress',    status: string, progress?: number, file?: string }
 *     { type: 'result',      text: string, language?: string, duration?: number }
 *     { type: 'error',       error: string }
 *     { type: 'model-ready', model: string }
 *
 * Models are cached in IndexedDB by Transformers.js on first download —
 * subsequent loads are instant (no network).
 */

// Dynamic import so the worker boots fast even before the library is cached.
let pipeline = null;
let transcriber = null;
let currentModelId = null;

// Model tier map — maps user-facing names to HuggingFace model IDs.
// All models are ONNX-optimized by Xenova for browser inference.
const MODEL_MAP = {
  tiny:    'Xenova/whisper-tiny',
  'tiny.en': 'Xenova/whisper-tiny.en',
  base:    'Xenova/whisper-base',
  'base.en': 'Xenova/whisper-base.en',
  small:   'Xenova/whisper-small',
  'small.en': 'Xenova/whisper-small.en',
};

const DEFAULT_MODEL = 'base';

function resolveModelId(name) {
  if (!name) return MODEL_MAP[DEFAULT_MODEL];
  if (MODEL_MAP[name]) return MODEL_MAP[name];
  // Allow passing a full HuggingFace ID directly
  if (name.includes('/')) return name;
  return MODEL_MAP[DEFAULT_MODEL];
}

/**
 * Load or switch the Whisper model. Sends progress events during download.
 */
async function loadModel(modelName) {
  const modelId = resolveModelId(modelName);

  // Skip reload if same model is already warm
  if (transcriber && currentModelId === modelId) {
    self.postMessage({ type: 'model-ready', model: modelId });
    return;
  }

  self.postMessage({ type: 'progress', status: 'loading-library' });

  // Lazy-load the library on first use
  if (!pipeline) {
    const mod = await import(
      /* webpackIgnore: true */
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    );
    pipeline = mod.pipeline;
    // Prefer WebGPU when available, fall back to WASM
    if (mod.env) {
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
    }
  }

  self.postMessage({ type: 'progress', status: 'loading-model', file: modelId });

  transcriber = await pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',          // INT8 quantized — 2× smaller, fast on CPU
    device: 'wasm',       // 'webgpu' is faster but not universally supported yet
    progress_callback: (progressEvent) => {
      // Transformers.js fires { status, file, progress, loaded, total }
      if (progressEvent.status === 'progress') {
        self.postMessage({
          type: 'progress',
          status: 'downloading',
          progress: progressEvent.progress,
          file: progressEvent.file,
        });
      } else if (progressEvent.status === 'done') {
        self.postMessage({
          type: 'progress',
          status: 'model-file-ready',
          file: progressEvent.file,
        });
      } else if (progressEvent.status === 'ready') {
        self.postMessage({
          type: 'progress',
          status: 'model-loaded',
        });
      }
    },
  });

  currentModelId = modelId;
  self.postMessage({ type: 'model-ready', model: modelId });
}

/**
 * Transcribe a Float32Array of 16 kHz mono PCM audio.
 */
async function transcribe(audio, language, modelName) {
  const t0 = performance.now();

  // Ensure model is loaded
  if (!transcriber || currentModelId !== resolveModelId(modelName)) {
    await loadModel(modelName);
  }

  self.postMessage({ type: 'progress', status: 'transcribing' });

  const options = {
    chunk_length_s: 30,        // Process in 30-second windows
    stride_length_s: 5,        // 5-second overlap between windows
    return_timestamps: true,   // Get word-level timestamps for step mapping
  };

  // If a language is specified, force it; otherwise let Whisper auto-detect
  if (language && language !== 'auto') {
    options.language = language;
    options.task = 'transcribe';
  }

  const result = await transcriber(audio, options);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

  self.postMessage({
    type: 'result',
    text: result.text || '',
    chunks: result.chunks || [],
    language: result.language || language || 'auto',
    duration: parseFloat(elapsed),
  });
}

// ── Message handler ─────────────────────────────────────────────────────────
self.addEventListener('message', async (e) => {
  const { type, audio, language, model } = e.data || {};

  try {
    switch (type) {
      case 'load':
        await loadModel(model);
        break;

      case 'transcribe':
        if (!audio || !(audio instanceof Float32Array)) {
          throw new Error('Expected Float32Array audio data');
        }
        await transcribe(audio, language, model);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || String(err) });
  }
});
