/**
 * importCopy.js — display-layer humanizer for import engine status messages.
 *
 * The engine (recipeParser.js / api.js) emits developer-facing progress strings
 * ("Trying server browser extraction...", "AI structuring", etc). Per the
 * 2026-06-09 CX review, users should see culinary-themed copy instead.
 * Raw messages are preserved in console logs for debugging — this module only
 * affects what's rendered.
 */

/** Ordered regex → friendly copy. First match wins. */
const STATUS_MAP = [
  [/subtitle|transcript|asr|audio|whisper/i, 'Not much written down \u2014 having a listen'],
  [/photo|vision|ocr|analyzing image/i,      'Reading your photo\u2026'],
  [/structur|gemini|\bai\b|markdown|parse/i, 'Sorting ingredients from steps\u2026'],
  [/multiple extraction|deeper|another method|retry/i, 'Trying another way in\u2026'],
  [/comment/i,                               'Reading the caption, comments and all'],
  [/caption|embed|oembed|instagram|reel|tiktok|scanning/i, 'Got the post \u2014 lifting the words out'],
  [/browser|server|yt-dlp|puppeteer|headless|proxy|fetching page|page text|page content/i, 'Reading the recipe page\u2026'],
  [/json|endpoint|structured data|schema|metadata/i, 'Looking for the recipe\u2026'],
  [/start|import/i,                          'Sniffing out the recipe\u2026'],
];

const DEFAULT_STATUS = 'Working on your recipe\u2026';

/**
 * Translate a raw engine progress message into user-friendly copy.
 * Logs the raw message to the console so debugging info isn't lost.
 * @param {string} msg raw engine message
 * @returns {string} humanized status line
 */
export function humanizeImportStatus(msg) {
  if (!msg || typeof msg !== 'string') return DEFAULT_STATUS;
  console.debug('[Import]', msg);
  for (const [re, friendly] of STATUS_MAP) {
    if (re.test(msg)) return friendly;
  }
  return DEFAULT_STATUS;
}

/** Friendly labels for the BrowserAssist Instagram pipeline checklist. */
export const PIPELINE_STEP_LABELS = [
  'Checking the video',
  'Grabbing the caption',
  'Reading the page',
  'Organizing the recipe',
];
