// ─────────────────────────────────────────────────────────────────────────────
// ACQUIRE: INSTAGRAM FOLLOWERS — grounded blog/comment recipe discovery.
//
// Runs when an Instagram caption is weak/bait ("comment RECIPE and I'll send
// you the details!", "full recipe on the blog", etc.) and BEFORE handing that
// weak caption to Gemini. Two real, non-LLM sources, in priority order:
//
//   1. Phase 0.5B — blogLinkFollower: follows an outbound link (caption URL,
//      pinned comment, or profile bio) and extracts a real structured recipe
//      via JSON-LD / microdata / heuristic HTML parsing. Grounded fact, not
//      a guess — the same extraction engine the "paste a blog URL" import
//      path uses.
//   2. Phase 0.5C — commentRecipeFollower: when the caption says the recipe
//      is "in comments" and a comment actually contains one, merges it in.
//
// 2026-09-09: previously these only ran from a legacy recipeParser.js
// orchestrator that engine.js's live import path never called — so a weak
// caption went straight to Gemini, which either declined (correct, but shows
// the user a manual "couldn't turn it into a recipe" recovery screen) or,
// on a manual retry over the SAME weak caption, sometimes fabricated a
// plausible-looking recipe from the dish name alone with no real source
// behind it (non-deterministic LLM sampling, not an actual link follow).
// This module makes the grounded path run automatically on the first pass,
// so the honest recovery screen only shows when NO grounded source exists —
// never replaced by a blind Gemini re-guess.
// ─────────────────────────────────────────────────────────────────────────────
import { tryBlogLinkExtraction, assessCaptionQuality } from '../../lib/blogLinkFollower.js';
import { tryCommentRecipeExtraction, captionReferencesComments } from '../../lib/commentRecipeFollower.js';
import { fetchInstagramCommentsViaApify } from '../../api.js';

const noop = () => {};

/**
 * Try the grounded blog/comment followers for an Instagram pack.
 *
 * On a COMPLETE blog hit, returns a ready-to-gate recipe object directly
 * (skip Gemini — grounded fact beats a model guess). On a PARTIAL blog hit
 * or a qualifying comment, mutates `pack.caption` in place with the real
 * source text so the caller's normal Gemini structuring sees grounded
 * content instead of the weak caption. Returns null when neither source
 * has anything — caller falls through to its existing behavior unchanged.
 *
 * @param {object} pack — Instagram ContextPack (caption, images,
 *   latestComments, profileBioUrl — all set by acquireInstagramPack)
 * @param {string} url — the Instagram URL being imported (for videoUrl/PiP
 *   preservation and link provenance)
 * @param {{ signal?: AbortSignal, onProgress?: Function }} [opts]
 * @returns {Promise<object|null>} a complete recipe, or null
 */
export async function tryInstagramFollowerEnrichment(pack, url, { signal, onProgress = noop } = {}) {
  if (!pack?.caption) return null;

  const quality = assessCaptionQuality(pack.caption);
  const captionHasUrl = /https?:\/\/[^\s]+/i.test(pack.caption);
  // 2026-09-10: captionReferencesComments ("comment RECIPE and I'll send you
  // the details!") is its own signal — that caption has NO bio URL, NO
  // caption URL, and (live-verified) an always-empty pack.latestComments
  // from the primary acquire race. Without this, a pure comment-gated post
  // never even reached the blog/comment attempts below — it failed this
  // gate and returned null immediately, which is the "still whiffing" bug.
  const pointsToComments = captionReferencesComments(pack.caption);
  const hasFollowerSignal = !!(pack.profileBioUrl || pack.latestComments?.length || captionHasUrl || pointsToComments);
  if (quality.class === 'strong' && !captionHasUrl) return null; // caption's already good
  if (!hasFollowerSignal) return null; // nothing to follow — don't spend the budget

  try {
    onProgress('Checking for a linked recipe…');
    const blog = await tryBlogLinkExtraction(pack.caption, pack.images?.[0]?.url || '', {
      instagramUrl: url,
      comments: pack.latestComments || [],
      profileBioUrl: pack.profileBioUrl || '',
      carouselImages: (pack.images || []).map((im) => im.url).filter(Boolean),
      signal,
    });

    if (blog && !blog._isPartial && (blog.ingredients?.length || 0) >= 2 && (blog.directions?.length || 0) >= 1) {
      // Complete, grounded recipe straight from the blog page.
      return {
        ...blog,
        name: blog.name || pack.title || '',
        imageUrl: blog.image || pack.images?.[0]?.url || '',
        link: blog.link || url,
        confidence: 0.85,
        _extractedVia: 'blog-link-follower',
      };
    }

    if (blog?._isPartial && blog._articleText) {
      // Partial hit — merge the real article text into the caption so
      // Gemini structures the ACTUAL blog content, not the weak IG caption.
      pack.caption = `${pack.caption}\n\n${blog._articleText}`;
      if (!pack.images?.length && blog.image) {
        pack.images = [{ url: blog.image, kind: 'hero' }];
      }
      pack._followerSource = 'blog-partial:' + (blog._discoveredDomain || '');
      return null;
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Best-effort — fall through to comment follower / normal structuring.
  }

  // 2026-09-10: the primary acquire race never populates pack.latestComments
  // (Apify's default 'basicData' detail level omits the field entirely —
  // live-verified against the real actor). When the caption itself points
  // at a comment, pay for one targeted 'detailedData' Apify call — comments
  // only — instead of silently having nothing to search.
  if (!pack.latestComments?.length && pointsToComments) {
    try {
      const comments = await fetchInstagramCommentsViaApify(url, { signal });
      if (comments?.length) pack.latestComments = comments;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Best-effort — fall through with whatever comments (if any) we have.
    }
  }

  if (pack.latestComments?.length) {
    try {
      const match = tryCommentRecipeExtraction(pack.caption, pack.latestComments);
      if (match) {
        pack.caption = `${pack.caption}\n\n${match.commentText}`;
        pack._followerSource = 'comment-recipe';
      }
    } catch { /* best-effort */ }
  }

  return null;
}
