import { describe, it, expect } from 'vitest';
import { extractCaptionFromApifyDescription } from '../../api/proxy.js';

describe('extractCaptionFromApifyDescription (restricted_page Apify fallback)', () => {
  it('pulls the caption out of the real restricted_page description shape', () => {
    // Captured live 2026-08-09 from apify/instagram-post-scraper for a
    // paid-partnership post (error: "restricted_page") — the exact case that
    // was breaking drink imports.
    const description =
      '44 likes, 9 comments - cocktailswithmenyc on December 29, 2025: "Let’s celebrate with this New Year’s Cranberry Tequila Spritz using @donjuliotequila. It’s bright, bubbly, and perfect for midnight toasts! 🎊✨AD\n\n🥂 New Year’s Cranberry Tequila Spritz\nIngredients (single serve):\n▪️ 1½ oz blanco tequila @donjuliotequila\n▪️ 2 oz cranberry juice\n▪️ ½ oz fresh lime juice\n▪️ Top with prosecco\n▪️ 1 tsp of edible glitter\n\nGarnish:\n▪️Fresh cranberries + lime twist\n\nSip responsibly. Don’t share w/ under 21.". ';

    const caption = extractCaptionFromApifyDescription(description);
    expect(caption).toContain('New Year');
    expect(caption).toContain('Cranberry Tequila Spritz');
    expect(caption).toContain('1½ oz blanco tequila');
    expect(caption).toContain('2 oz cranberry juice');
    // The "N likes, N comments - user on date:" wrapper must be stripped,
    // and so must the wrapper's own surrounding quote marks.
    expect(caption).not.toMatch(/^\d+ likes/);
    expect(caption.startsWith('"')).toBe(false);
    expect(caption.endsWith('"')).toBe(false);
    // The caption's own final sentence legitimately ends in a period
    // ("...under 21.") — that's real content, not wrapper syntax.
    expect(caption.endsWith('under 21.')).toBe(true);
  });

  it('handles a caption containing internal quotes without truncating early', () => {
    const description = '3 likes, 1 comment - chef on Jan 1, 2026: "She said "yum" and I agreed. Full recipe below.".';
    const caption = extractCaptionFromApifyDescription(description);
    expect(caption).toBe('She said "yum" and I agreed. Full recipe below.');
  });

  it('falls back to the raw description when the wrapper pattern is not recognized', () => {
    const description = 'Just a plain description with no stats-and-quote wrapper, long enough to pass the length floor.';
    expect(extractCaptionFromApifyDescription(description)).toBe(description);
  });

  it('returns empty string for empty/short/missing input', () => {
    expect(extractCaptionFromApifyDescription('')).toBe('');
    expect(extractCaptionFromApifyDescription(undefined)).toBe('');
    expect(extractCaptionFromApifyDescription('short')).toBe('');
  });
});
