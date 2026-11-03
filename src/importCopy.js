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
  [/carousel slide|\bslides?\b/i,          'Reading the slides\u2026'],
  [/on-screen text/i,                       'Reading the text on screen\u2026'],
  // On-device Whisper. Only a real download is "first time only"; loading a
  // cached model happens on every session's first video.
  [/downloading model/i, (m) => {
    const pct = /(\d+)%/.exec(m);
    return `Fetching the listening model, first time only${pct ? ` (${pct[1]}%)` : ''}\u2026`;
  }],
  [/your video audio|extracting audio from file|audio extracted|loading whisper|loading model|^transcribing audio/i, 'Having a listen to the video\u2026'],
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
    if (re.test(msg)) return typeof friendly === 'function' ? friendly(msg) : friendly;
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

/**
 * Honest Miss copy for a link that never reached a recipe. `reasons` are the
 * engine's gate reasons; the first one is the acquire miss reason when the
 * fetch itself failed (acquire/website.js extractMissReason).
 *
 * `actions` lists what the Miss line should offer next:
 *   'browser'    — open the page in the native in-app browser (canBrowse only)
 *   'paste'      — clear the link and focus the field for pasted recipe text
 *   'screenshot' — open the upload picker for a screenshot of the recipe
 *
 * @param {string[]} reasons
 * @param {string} [url]
 * @param {{ canBrowse?: boolean }} [opts] canBrowse: native app with the in-app browser
 * @returns {{ text: string, actions: string[] } | null} null when no reason applies
 */
export function missMessage(reasons = [], url = '', { canBrowse = false } = {}) {
  let host = 'This site';
  try { host = new URL(url).hostname.replace(/^www\./, '') || host; } catch { /* keep generic */ }
  // The site itself refused or had nothing: reading it as a visitor may work.
  const manual = canBrowse ? ['browser', 'paste', 'screenshot'] : ['paste', 'screenshot'];
  switch (reasons[0]) {
    case 'site-publisher-block':
      return {
        text: canBrowse
          ? `${host} blocks recipe apps. Open it in the SpiceHub browser and tap import, or paste the recipe text or upload a screenshot.`
          : `${host} blocks recipe apps. Open the page in your browser, then paste the recipe text here or upload a screenshot.`,
        actions: manual,
      };
    case 'site-bot-challenge':
      return { text: `${host} asked for a robot check we can't pass. Paste the recipe text here or upload a screenshot instead.`, actions: manual };
    case 'site-page-not-found':
      return { text: `${host} says that page doesn't exist. Check the link, or paste the recipe text.`, actions: ['paste'] };
    case 'site-timeout':
      return { text: `${host} took too long to answer. Try again in a moment, or paste the recipe text.`, actions: manual };
    case 'site-unreachable':
      return { text: "We couldn't reach the import server. Check your connection, or paste the recipe text.", actions: ['paste'] };
    case 'no-recipe-on-page':
      return { text: `We couldn't find a recipe on that ${host} page. Paste the recipe text or upload a screenshot.`, actions: manual };
    case 'rate-limited':
      return { text: 'That was a lot of imports in a row. Wait a minute and try again.', actions: [] };
    default:
      return null;
  }
}
