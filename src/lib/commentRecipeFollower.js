/**
 * SpiceHub — Comment Recipe Follower
 *
 * Phase 0.5C in the import pipeline, a sibling to blogLinkFollower.js.
 *
 * blogLinkFollower.js follows an OUTBOUND URL when the caption points to a
 * blog. This module handles the case where the caption instead points
 * INWARD — "recipe in comments", "full recipe in the comments", etc — and
 * the actual recipe text lives in one of the post's own comments, not a
 * link anywhere.
 *
 * Comments arrive from Apify as plain strings (api/proxy.js normalizes
 * them, capped at MAX_LATEST_COMMENTS = 5) with no author/pinned/like-count
 * metadata, so "best comment" selection is text-only: score each comment by
 * recipe-signal density (reusing blogLinkFollower's RECIPE_SIGNAL_WORDS) and
 * take the highest scorer above a minimum bar.
 *
 * This module does NOT extract structured recipe data itself — a comment is
 * plain text, not marked-up HTML like a blog page. It hands back merged text
 * so recipeParser.js can fold it into the caption and let Phase 3's Gemini
 * structuring do the actual parsing, the same way a partial blog match hands
 * off article text for Gemini to complete.
 */

import { RECIPE_SIGNAL_WORDS } from './blogLinkFollower.js';

const MIN_SIGNAL_COUNT = 3;    // same bar as blogLinkFollower's MIN_RECIPE_WORDS
const MIN_COMMENT_LENGTH = 30; // ignore "yum!!" / emoji-only comments

/**
 * Patterns meaning "the recipe is not (only) in the caption, it's in a
 * comment" — regexes rather than a fixed phrase list, so ordinary word-order
 * variation ("check comments for the recipe" vs. "check the comments for
 * the recipe") doesn't require enumerating every wording by hand.
 */
const COMMENT_REFERENCE_PATTERNS = [
  // "recipe [pinned/below/in] ... comment(s)"
  /\brecipe\b[^.!\n]{0,20}\b(pinned|below|in)\b[^.!\n]{0,10}\bcomments?\b/i,
  // "[full] recipe in ... comment(s)" (catches "recipe in comments", "recipe in the comment section")
  /\b(full\s+)?recipe\s+in\b[^.!\n]{0,20}\bcomments?\b/i,
  // "check/see ... comment(s) ... for ... recipe"
  /\b(check|see)\b[^.!\n]{0,15}\bcomments?\b[^.!\n]{0,20}\brecipe\b/i,
  // "comment(s) for [the] recipe" / "pinned comment for the recipe"
  /\bcomments?\b[^.!\n]{0,20}\bfor\b[^.!\n]{0,10}\brecipe\b/i,
  // "[pinned/first] comment [has/with] the recipe"
  /\b(pinned|first)\b[^.!\n]{0,5}\bcomment\b[^.!\n]{0,20}\brecipe\b/i,
];

/**
 * Does the caption tell the reader the recipe lives in a comment?
 * @param {string} caption
 * @returns {boolean}
 */
export function captionReferencesComments(caption) {
  if (!caption || typeof caption !== 'string') return false;
  return COMMENT_REFERENCE_PATTERNS.some((re) => re.test(caption));
}

/**
 * Score a single comment's recipe-signal density. Higher is better.
 * @param {string} text
 * @returns {number}
 */
function scoreComment(text) {
  if (!text || typeof text !== 'string') return 0;
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();
  if (clean.length < MIN_COMMENT_LENGTH) return 0;
  const lower = clean.toLowerCase();
  const signalCount = RECIPE_SIGNAL_WORDS.filter((w) => lower.includes(w)).length;
  // Small length bonus so a longer, denser comment edges out a short one with
  // the same raw signal count (e.g. a full ingredient list vs. one line).
  return signalCount + Math.min(clean.length / 200, 2);
}

/**
 * Pick the best recipe candidate out of the post's latest comments.
 * @param {string[]} comments  Plain-text comments (igPack.latestComments)
 * @returns {{ text: string, score: number } | null}
 */
export function pickBestRecipeComment(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  let best = null;
  for (const raw of comments) {
    const text = typeof raw === 'string' ? raw : (raw?.text || raw?.body || '');
    const score = scoreComment(text);
    if (score >= MIN_SIGNAL_COUNT && (!best || score > best.score)) {
      best = { text: text.trim(), score };
    }
  }
  return best;
}

/**
 * Phase 0.5C orchestrator — detect + pick in one call.
 *
 * @param {string} caption      Caption text (raw or cleaned — only checked
 *                               for the "recipe is in a comment" reference)
 * @param {string[]} comments   igPack.latestComments
 * @returns {{ commentText: string, score: number } | null}
 */
export function tryCommentRecipeExtraction(caption, comments) {
  if (!captionReferencesComments(caption)) return null;
  const best = pickBestRecipeComment(comments);
  if (!best) return null;
  return { commentText: best.text, score: best.score };
}
