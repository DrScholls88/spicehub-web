/**
 * acquire/videoAudio.js — single Whisper pass, host-agnostic.
 *
 * Attach a transcript to a pack-like object if — and only if — it still
 * needs one. Never structures. Never sets a UI phase. Idempotent: safe to
 * call from both the parser's pre-exit and the sheet's fallback.
 *
 * @param {{ sourceUrl?: string, transcript?: string, _asrAttempted?: boolean }} pack
 * @param {{ signal?: AbortSignal, model?: string, onProgress?: Function, budgetMs?: number }} opts
 * @returns {Promise<{ transcript: string|null, attempted: boolean, via: string|null }>}
 */
import { detectVideoSource } from '../../lib/videoSource.js';
import { transcribeFromUrl } from '../../lib/transcriptionService.js';

export async function acquireVideoAudio(
  pack,
  { signal, model, onProgress, budgetMs = 40_000 } = {},
) {
  // ── Idempotence guard ─────────────────────────────────────────────────────
  // If a transcript is already present or a prior pass already attempted ASR,
  // there is nothing to do — a second attempt on the same URL won't yield a
  // different result, just double the wait.
  if (pack?.transcript || pack?._asrAttempted) {
    return { transcript: null, attempted: false, via: null };
  }

  const url = pack?.sourceUrl || '';
  if (!detectVideoSource(url)) {
    return { transcript: null, attempted: false, via: null };
  }

  // ── Abort wiring (verbatim from recipeParser.js Phase E.3) ────────────────
  const asrController = new AbortController();
  if (signal) {
    if (signal.aborted) asrController.abort();
    else signal.addEventListener('abort', () => asrController.abort(), { once: true });
  }
  const asrTimer = setTimeout(() => asrController.abort(), budgetMs);

  try {
    const transcription = await transcribeFromUrl(url, {
      onProgress: onProgress || undefined,
      signal: asrController.signal,
      model,
    });
    if (transcription?.transcript && transcription.transcript.trim().length >= 20) {
      return {
        transcript: transcription.transcript.trim(),
        attempted: true,
        via: transcription.extractedVia || 'whisper',
      };
    }
    return { transcript: null, attempted: true, via: null };
  } catch (e) {
    console.log('[SpiceHub] ASR attempt failed:', e?.message || e);
    return { transcript: null, attempted: true, via: null };
  } finally {
    clearTimeout(asrTimer);
  }
}
