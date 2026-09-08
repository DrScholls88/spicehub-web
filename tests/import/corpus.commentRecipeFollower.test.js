import { describe, it, expect } from 'vitest';
import {
  captionReferencesComments,
  pickBestRecipeComment,
  tryCommentRecipeExtraction,
} from '../../src/lib/commentRecipeFollower.js';

describe('CommentRecipeFollower', () => {
  describe('captionReferencesComments', () => {
    it('detects a direct "recipe in comments" callout', () => {
      expect(captionReferencesComments('So good! Recipe in comments 👇')).toBe(true);
    });

    it('detects "full recipe in the comments"', () => {
      expect(captionReferencesComments('Weeknight dinner idea. Full recipe in the comments!')).toBe(true);
    });

    it('detects "check comments for the recipe"', () => {
      expect(captionReferencesComments('Made this last night — check comments for the recipe.')).toBe(true);
    });

    it('does not flag an ordinary caption with no comment reference', () => {
      expect(captionReferencesComments('2 cups flour, 1 cup sugar. Mix and bake at 350.')).toBe(false);
    });

    it('does not flag generic engagement bait ("comment below") as a recipe pointer', () => {
      expect(captionReferencesComments('Comment below if you tried this!')).toBe(false);
    });

    it('returns false for empty or non-string input', () => {
      expect(captionReferencesComments('')).toBe(false);
      expect(captionReferencesComments(null)).toBe(false);
    });
  });

  describe('pickBestRecipeComment', () => {
    it('picks the comment with the most recipe signal over plain reactions', () => {
      const comments = [
        'love this!!',
        'Ingredients: 2 cups flour, 1 tsp baking soda, 1/2 cup sugar. Directions: preheat oven to 350, mix, bake 20 minutes.',
        'omg yum 😍',
      ];
      const best = pickBestRecipeComment(comments);
      expect(best).not.toBeNull();
      expect(best.text).toContain('Ingredients');
    });

    it('returns null when no comment clears the minimum signal bar', () => {
      const comments = ['love this!!', 'omg yum', 'following now'];
      expect(pickBestRecipeComment(comments)).toBeNull();
    });

    it('returns null for an empty or missing comment list', () => {
      expect(pickBestRecipeComment([])).toBeNull();
      expect(pickBestRecipeComment(undefined)).toBeNull();
    });

    it('accepts object-shaped comments with a text/body field', () => {
      const comments = [
        { text: 'Ingredients: 2 cups flour, 1 tsp baking soda. Directions: preheat, mix, bake at 350 for 20 minutes.' },
      ];
      const best = pickBestRecipeComment(comments);
      expect(best).not.toBeNull();
    });
  });

  describe('tryCommentRecipeExtraction', () => {
    const recipeComment =
      'Ingredients: 2 cups flour, 1 cup sugar, 1 tsp baking soda, 2 eggs. ' +
      'Directions: preheat oven to 350, mix dry ingredients, fold in eggs, bake 25 minutes.';

    it('merges caption + comment when the caption points to comments and a comment qualifies', () => {
      const result = tryCommentRecipeExtraction('So good! Full recipe in comments 👇', [
        'love this!!',
        recipeComment,
      ]);
      expect(result).not.toBeNull();
      expect(result.commentText).toContain('Ingredients');
    });

    it('returns null when the caption does not reference comments, even if a comment has a full recipe', () => {
      const result = tryCommentRecipeExtraction('Weeknight dinner idea.', [recipeComment]);
      expect(result).toBeNull();
    });

    it('returns null when the caption references comments but none qualify', () => {
      const result = tryCommentRecipeExtraction('Recipe in comments!', ['love this!!', 'yum']);
      expect(result).toBeNull();
    });
  });
});
