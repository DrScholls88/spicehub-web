/**
 * videoSource.js — detect a playable video platform from a recipe's source URL
 * and build a secure, embeddable iframe URL.
 *
 * Powers the Floating Picture-in-Picture player (Meal Library + Cook Mode).
 *
 * Supported platforms:
 *   • YouTube  — full embed control (autoplay, playsinline) via youtube.com/embed
 *   • Instagram — Reels / posts / IGTV via the public /embed shell (plays, but
 *                 locked: no programmatic seek/scrub — by design on IG's side)
 *   • TikTok   — video detection for ASR; embed available for /@user/video/ URLs
 *
 * Everything is pure + synchronous so it can run inside render and offline.
 */

// ── YouTube ──────────────────────────────────────────────────────────────────
// Matches watch?v=, youtu.be/, /embed/, /shorts/, /live/ forms.
const YT_PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/i,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/(?:embed|shorts|live|v)\/)([A-Za-z0-9_-]{11})/i,
];

function parseYouTubeId(url) {
  for (const rx of YT_PATTERNS) {
    const m = url.match(rx);
    if (m && m[1]) return m[1];
  }

  return null;
}

// ── Instagram ────────────────────────────────────────────────────────────────
// Matches /reel/{code}/, /reels/{code}/, /p/{code}/, /tv/{code}/.
// Capture group 1 = path type, group 2 = shortcode.
const IG_RX = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;

function parseInstagram(url) {
  const m = url.match(IG_RX);
  if (!m) return null;
  // IG's embed endpoint accepts /p/ and /reel/ — normalize "reels" → "reel".
  let type = m[1].toLowerCase();
  if (type === 'reels') type = 'reel';
  return { type, code: m[2] };
}


// ── TikTok ───────────────────────────────────────────────────────────────────
// Matches /@user/video/{id}, /t/{code}, and vm.tiktok.com/{code} short URLs.
// TikTok's embed endpoint requires the video ID, which short URLs don't carry
// without a redirect — embedUrl is best-effort (null for short-form URLs).
const TK_VIDEO_RX = /tiktok\.com\/@[^/]+\/video\/(\d+)/i;
const TK_SHORT_RX = /(?:vm\.tiktok\.com|tiktok\.com\/t)\/([A-Za-z0-9_-]+)/i;

function parseTikTok(url) {
  const vm = url.match(TK_VIDEO_RX);
  if (vm) return { id: vm[1], hasVideoId: true };
  const sm = url.match(TK_SHORT_RX);
  if (sm) return { id: sm[1], hasVideoId: false };
  return null;
}

/**
 * detectVideoSource(url) → null | {
 *   platform: 'youtube' | 'instagram' | 'tiktok',
 *   label: string,            // human label e.g. "YouTube"
 *   icon: string,             // emoji affordance
 *   id: string,               // platform-native id/shortcode
 *   embedUrl: string,         // iframe src (autoplay where allowed)
 *   originalUrl: string,      // canonical link to open externally
 *   canControl: boolean,      // true if we can seek/pause via API (YT only)
 * }
 */
export function detectVideoSource(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim();

  const ytId = parseYouTubeId(clean);
  if (ytId) {
    const params = new URLSearchParams({
      autoplay: '1',
      // Browsers block UNMUTED programmatic autoplay — without this the embed
      // renders as a tap-to-play thumbnail (which opens YouTube on tap). Muted
      // autoplay reliably plays inline; the user can unmute via the player.
      mute: '1',
      playsinline: '1',
      rel: '0',
      modestbranding: '1',
    });
    return {
      platform: 'youtube',
      label: 'YouTube',
      icon: '▶',
      id: ytId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}?${params.toString()}`,
      originalUrl: `https://www.youtube.com/watch?v=${ytId}`,
      canControl: true,
    };
  }

  const ig = parseInstagram(clean);
  if (ig) {
    return {
      platform: 'instagram',
      label: 'Instagram',
      icon: '▶',
      id: ig.code,
      // Public embed shell — autoplays muted, no scrub control exposed.
      embedUrl: `https://www.instagram.com/${ig.type}/${ig.code}/embed/`,
      originalUrl: `https://www.instagram.com/${ig.type}/${ig.code}/`,
      canControl: false,
    };
  }

  const tk = parseTikTok(clean);
  if (tk) {
    return {
      platform: 'tiktok',
      label: 'TikTok',
      icon: '▶',
      id: tk.id,
      // Embed requires the numeric video ID; short URLs only carry a redirect code.
      embedUrl: tk.hasVideoId
        ? `https://www.tiktok.com/embed/v2/${tk.id}`
        : null,
      originalUrl: clean,
      canControl: false,
    };
  }

  return null;
}

/**
 * getMealVideoSource(meal) — convenience wrapper that checks the fields a meal
 * actually stores its source link in. Prefers dedicated video URLs over generic
 * links so that blog-followed imports (where meal.link = blog canonical) still
 * surface the original Instagram Reel for PiP.
 *
 * Priority:
 *   1. meal.videoUrl                     — explicit video URL (set by blog link follower)
 *   2. meal._sources?.videoUrl           — dual-source metadata
 *   3. meal.sourceUrl if reel/tv path    — original IG import URL
 *   4. meal.link if IG/YouTube           — legacy: only if it's still a playable URL
 *   5. meal.url                          — fallback
 */
export function getMealVideoSource(meal) {
  if (!meal) return null;

  // Prefer explicit videoUrl (set by blog link follower for PiP preservation)
  if (meal.videoUrl) {
    const vs = detectVideoSource(meal.videoUrl);
    if (vs) return vs;
  }

  // Dual-source metadata
  if (meal._sources?.videoUrl) {
    const vs = detectVideoSource(meal._sources.videoUrl);
    if (vs) return vs;
  }

  // sourceUrl if it's an IG reel/tv (original import URL)
  if (meal.sourceUrl && /\/(reel|tv)\//i.test(meal.sourceUrl)) {
    const vs = detectVideoSource(meal.sourceUrl);
    if (vs) return vs;
  }

  // Legacy: meal.link — but only if it points to a playable platform,
  // not a recipe blog (blog link follower sets link = blog canonical)
  if (meal.link) {
    const vs = detectVideoSource(meal.link);
    if (vs) return vs;
  }

  return detectVideoSource(meal.sourceUrl || meal.url || '');
}

/** hasPlayableVideo(meal) — cheap boolean for conditional UI affordances. */
export function hasPlayableVideo(meal) {
  return getMealVideoSource(meal) !== null;
}

// ── Step timestamp parsing ─────────────────────────────────────────────────────
// Pull "jump to time" markers out of recipe captions/descriptions so a video
// player can map each direction step to a point in the clip.
//
// Recognized forms (the whole match must be a token, not part of a larger number):
//   m:ss        e.g. 0:15, 1:30, 12:05
//   mm:ss       e.g. 09:45
//   h:mm:ss     e.g. 1:02:30
//   (m:ss)      parenthesized variants are accepted (parens are stripped)
//
// Guards:
//   • seconds/minutes components must be 0–59 (a stray "1:75" is rejected)
//   • results > 6 hours are dropped (likely not a timestamp)
//   • deduped by total seconds, returned ascending

const MAX_TIMESTAMP_SECONDS = 6 * 60 * 60; // 6 hours

// Capture an optional hours group, then m:ss. \b boundaries keep us off larger
// numbers. We allow surrounding parens/brackets but don't require them.
const TIMESTAMP_RX = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;

/**
 * Convert a single raw "h:m:s" / "m:s" token to a total seconds count.
 * Returns null if the token is malformed or out of range.
 */
function timestampToSeconds(rawHours, rawMinutes, rawSeconds) {
  const hasHours = rawHours !== undefined && rawHours !== '';
  const h = hasHours ? parseInt(rawHours, 10) : 0;
  const m = parseInt(rawMinutes, 10);
  const s = parseInt(rawSeconds, 10);

  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  // seconds always 0–59. minutes 0–59 too (when an hours field is present, or as
  // the leading field for m:ss where larger minute counts are still plausible —
  // but we keep it strict to avoid false positives like ratios "90:00").
  if (s > 59) return null;
  if (m > 59) return null;
  if (h > 23) return null;

  const total = h * 3600 + m * 60 + s;
  if (total > MAX_TIMESTAMP_SECONDS) return null;
  return total;
}

/**
 * parseStepTimestamps(text, stepCount) →
 *   Array<{ seconds: number, raw: string }>   // ascending, deduped by seconds
 *
 * Scans free text for timestamp markers. `stepCount` is accepted for API
 * symmetry / future heuristics (e.g. capping) but is optional — parsing does not
 * require it. Pure + defensive: null/empty/non-string input yields [].
 */
export function parseStepTimestamps(text, stepCount) {
  if (!text || typeof text !== 'string') return [];

  const found = [];
  const seen = new Set();
  let match;
  // Reset lastIndex defensively (regex is module-level + /g).
  TIMESTAMP_RX.lastIndex = 0;
  while ((match = TIMESTAMP_RX.exec(text)) !== null) {
    const [whole, gHours, gMinutes, gSeconds] = match;
    const seconds = timestampToSeconds(gHours, gMinutes, gSeconds);
    if (seconds === null) continue;
    if (seen.has(seconds)) continue;
    seen.add(seconds);
    // raw = the matched token without surrounding whitespace.
    found.push({ seconds, raw: whole.trim() });
  }

  found.sort((a, b) => a.seconds - b.seconds);

  // Optional soft cap when a stepCount is provided and we somehow matched far
  // more than plausible — we never trim below stepCount, just dedupe noise.
  if (Number.isFinite(stepCount) && stepCount > 0 && found.length > stepCount * 4) {
    return found.slice(0, stepCount * 4);
  }

  return found;
}

/**
 * mapStepsToTimestamps(directions, timestamps) →
 *   Array<number | null>   // one entry per step: seconds to seek to, or null
 *
 * Alignment strategy, per step:
 *   1. If the step's own text contains a timestamp, use that step's first one.
 *   2. Otherwise, hand out the parsed `timestamps` in order to steps that still
 *      need one (steps that already matched in-text are skipped for distribution).
 *   3. If nothing remains / nothing parsed, that step gets null.
 *
 * Pure + defensive: non-array `directions` → []. `timestamps` may be the array
 * of { seconds } objects from parseStepTimestamps, an array of numbers, or null.
 */
export function mapStepsToTimestamps(directions, timestamps) {
  if (!Array.isArray(directions) || directions.length === 0) return [];

  // Normalize the timestamp pool to a plain ascending number[] of seconds.
  const pool = [];
  if (Array.isArray(timestamps)) {
    for (const t of timestamps) {
      if (typeof t === 'number' && Number.isFinite(t) && t >= 0) {
        pool.push(t);
      } else if (t && typeof t === 'object' && Number.isFinite(t.seconds) && t.seconds >= 0) {
        pool.push(t.seconds);
      }
    }
  }
  pool.sort((a, b) => a - b);

  // Pass 1 — in-text timestamps take priority and consume nothing from the pool.
  const result = directions.map((step) => {
    const text = typeof step === 'string' ? step : (step && step.text) || '';
    const inline = parseStepTimestamps(text);
    return inline.length > 0 ? inline[0].seconds : null;
  });

  // Pass 2 — distribute the pool, in order, to steps that still lack a time.
  let poolIdx = 0;
  for (let i = 0; i < result.length && poolIdx < pool.length; i += 1) {
    if (result[i] === null) {
      result[i] = pool[poolIdx];
      poolIdx += 1;
    }
  }

  return result;
}
