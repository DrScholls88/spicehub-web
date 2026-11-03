// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: VIDEO FRAMES — read recipe text shown ON SCREEN in a short video.
//
// Music-only Reels often put the whole recipe in text overlays: the caption is
// a hook line and there is no speech for Whisper, so neither ever sees the
// recipe. When a short video's caption (plus any transcript) has fewer than two
// quantity lines, the resource server's /api/frames samples ~10 stills (scene
// cuts, or an even spread across the video, plus the final second, where many
// Reels show the full ingredient card). They go through the photo engine's
// ONLINE vision tiers, exactly like carousel slides (acquire/instagramSlides.js),
// and the text lands on pack.frameText, its own labelled section in
// buildPackSections.
//
// Short-form only (Reels, TikTok, YouTube Shorts). A long YouTube video has a
// description, and would hit the server's 80 MB download cap anyway.
// Online only, and any failure returns false so the import carries on as before.
// ─────────────────────────────────────────────────────────────────────────────
import { transcribePagesOnline, joinPageTranscripts } from '../../lib/photoImportEngine.js';
import { addProvenance } from '../contextPack.js';
import { countQuantityLines } from '../junk.js';
import { cleanSocialCaption } from '../clean/socialCaption.js';

const MIN_FRAME_CHARS = 40;          // less than this is a title card, not a recipe
const FRAMES_TIMEOUT_MS = 100_000;   // server: 90 s download cap + ffmpeg passes

/** Resource server base URL — same resolution as transcriptionService.js. */
function resourceServer() {
  const configured = import.meta.env?.VITE_SERVER_URL;
  if (configured) return configured;
  const isLocalHost = typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(window.location.hostname);
  return isLocalHost ? 'http://localhost:3001' : '';
}

/** True for short-form video posts. Instagram /p/ posts count only when the pack says isVideo. */
export function isShortVideo(pack, url = pack?.sourceUrl || '') {
  if (/instagram\.com/i.test(url)) return !!pack?.isVideo || /\/(reels?|tv)\//i.test(url);
  if (/tiktok\.com/i.test(url)) return true;
  return /youtube\.com\/shorts\//i.test(url);
}

/**
 * A speech transcript is one long line. Break it at clause boundaries ("200 g
 * spaghetti, and 2 tbsp butter" → two lines) and drop spoken lead-ins, so the
 * line-based heuristics (countQuantityLines, the offline parser) can read it.
 */
export function spokenToLines(text) {
  return String(text || '')
    .replace(/[.;!?]\s+|,\s+|\s+and\s+/gi, '\n')
    .split('\n')
    .map((l) => l.trim().replace(/^(?:so\s+|now\s+)?(?:you(?:'ll| will)? need|grab|get yourself)\s+/i, ''))
    .filter(Boolean)
    .join('\n');
}

/** True when a pack's caption and transcript hold fewer than two measured ingredients. */
export function needsOnScreenText(pack) {
  if (!pack || pack.frameText || pack.slideText) return false;
  const text = cleanSocialCaption([pack.caption, spokenToLines(pack.transcript)].filter(Boolean).join('\n'));
  return countQuantityLines(text) < 2;
}

/** True when a short video's caption and transcript are too thin to hold the recipe. */
export function shouldReadFrames(pack, url = pack?.sourceUrl || '') {
  return isShortVideo(pack, url) && needsOnScreenText(pack);
}

/**
 * The same overlay sits on screen across several sampled frames, so vision
 * reads it several times. Keep the first copy of each line (case/punctuation
 * insensitive); page-break separators and blank lines drop out too.
 */
export function dedupeFrameLines(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const key = line.toLowerCase().replace(/[^a-z0-9½¼¾⅓⅔]+/g, ' ').trim();
    if (!key || key === 'page break' || seen.has(key)) continue;
    seen.add(key);
    out.push(line.trim());
  }
  return out.join('\n');
}

async function fetchFrames(url, signal) {
  const base = resourceServer();
  if (!base) return [];
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FRAMES_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/api/frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Trust boundary: only JPEG/PNG/WebP data URLs reach the vision tiers.
    return Array.isArray(data?.frames)
      ? data.frames.filter((f) => typeof f === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(f))
      : [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Read on-screen video text into pack.frameText. Mutates the pack; returns
 * true when frame text was added.
 *
 * @param {object} pack — ContextPack from any acquire fork
 * @param {{ url?: string, signal?: AbortSignal, onProgress?: (msg: string) => void }} opts
 * @returns {Promise<boolean>}
 */
export async function readVideoFrames(pack, { url = pack?.sourceUrl || '', signal, onProgress = () => {} } = {}) {
  if (!shouldReadFrames(pack, url)) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    onProgress('Reading the on-screen text in the video…');
    const frames = await fetchFrames(url, signal);
    if (frames.length === 0 || signal?.aborted) return false;
    return await readFrameImages(pack, frames, { signal });
  } catch (err) {
    // The caller cancelled → propagate. Our own timeout or a server/vision
    // failure → carry on without frame text.
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return false;
  }
}

/**
 * Read already-sampled frames (JPEG data URLs) into pack.frameText with the
 * online vision tiers. Shared by the URL path above and acquire/videoFile.js,
 * which samples a local video in the browser. Throws on vision failure; the
 * callers decide whether that is fatal.
 *
 * @returns {Promise<boolean>} true when frame text was added
 */
export async function readFrameImages(pack, frames, { signal } = {}) {
  const contract = await transcribePagesOnline(frames, { signal });
  if (contract?.contentType === 'dish-photo') return false;
  const text = dedupeFrameLines(joinPageTranscripts(contract?.pages));
  if (text.length < MIN_FRAME_CHARS) return false;

  pack.frameText = text;
  addProvenance(pack, 'frameText', 'vision-frames:' + (contract.engine || 'unknown'));
  return true;
}
