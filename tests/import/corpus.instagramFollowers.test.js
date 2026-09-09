// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — acquire/instagramFollowers.js
//
// Proves the exact scenario the 2026-09-09 fix targets: an Instagram caption
// that has NO ingredients/steps at all, only a pointer to a blog (or a
// pinned comment) — the importer must follow that link/comment and return
// the REAL recipe from the blog, not hand a weak caption to Gemini and hope,
// and not fabricate one. `fetchHtmlViaProxy` is mocked — no real network —
// so this is deterministic and fast, same pattern as
// corpus.blogLinkFollower.test.js's extractRecipeFromBlog test.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

const BLOG_URL = 'https://example-recipe-blog.test/miso-maple-tempeh-bowl/';

const BLOG_HTML = `
  <!doctype html>
  <html>
    <head>
      <title>Miso Maple Tempeh Bowl</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Miso Maple Tempeh Bowl",
          "image": "https://example-recipe-blog.test/img/hero.jpg",
          "recipeIngredient": [
            "16 oz tempeh, cut into triangles",
            "2 tbsp white miso",
            "3 tbsp maple syrup",
            "1 cup cooked jasmine rice",
            "1 cup shredded carrots"
          ],
          "recipeInstructions": [
            { "@type": "HowToStep", "text": "Steam the tempeh for 10 minutes." },
            { "@type": "HowToStep", "text": "Whisk the miso and maple into a glaze." },
            { "@type": "HowToStep", "text": "Braise the tempeh in the glaze until glossy." },
            { "@type": "HowToStep", "text": "Serve over rice with carrots." }
          ]
        }
      </script>
    </head>
    <body></body>
  </html>
`;

vi.mock('../../src/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchHtmlViaProxy: vi.fn(async (url) => (url === BLOG_URL ? BLOG_HTML : null)),
  };
});

const { tryInstagramFollowerEnrichment } = await import('../../src/import/acquire/instagramFollowers.js');

describe('acquire/instagramFollowers — grounded blog/comment fallback', () => {
  it('follows a blog link in the caption when the caption itself has no ingredients/steps', async () => {
    // Exactly the reported scenario: bait caption, zero recipe content,
    // just a pointer to the blog.
    const pack = {
      caption: `THE BEST MISO MAPLE TEMPEH BOWL 🍜 full recipe on the blog: ${BLOG_URL}`,
      images: [{ url: 'https://scontent.cdninstagram.com/ig-hero.jpg', kind: 'hero' }],
      latestComments: [],
      profileBioUrl: '',
      title: '',
    };

    const result = await tryInstagramFollowerEnrichment(pack, 'https://www.instagram.com/reel/DFakeReel1/', {});

    expect(result).not.toBeNull();
    expect(result.name).toBe('Miso Maple Tempeh Bowl');
    expect(result.ingredients).toHaveLength(5);
    expect(result.directions).toHaveLength(4);
    expect(result.ingredients[0]).toContain('tempeh');
    // Real blog page wins the link, not the IG post itself.
    expect(result.link).toBe(BLOG_URL);
    // Blog's own hero image wins over the bare IG display image.
    expect(result.imageUrl).toBe('https://example-recipe-blog.test/img/hero.jpg');
    expect(result._extractedVia).toBe('blog-link-follower');
  });

  it('follows a blog link surfaced only in the profile bio (no link in the caption text)', async () => {
    const pack = {
      caption: 'comment RECIPE and I will send you the details! 🧀',
      images: [],
      latestComments: ['love this!!', 'omg yum'],
      profileBioUrl: BLOG_URL,
      title: '',
    };

    const result = await tryInstagramFollowerEnrichment(pack, 'https://www.instagram.com/reel/DFakeReel2/', {});

    expect(result).not.toBeNull();
    expect(result.name).toBe('Miso Maple Tempeh Bowl');
    expect(result.link).toBe(BLOG_URL);
  });

  it('does not spend the follower budget on a caption that already has the full recipe', async () => {
    const { fetchHtmlViaProxy } = await import('../../src/api.js');
    fetchHtmlViaProxy.mockClear();

    const pack = {
      caption: `WEEKNIGHT PASTA. 12 oz pasta, 2 cups broccoli, 1 cup caesar dressing. Boil pasta, add broccoli last 3 minutes, drain, toss with dressing. Season and serve.`,
      images: [],
      latestComments: [],
      profileBioUrl: '',
      title: '',
    };

    const result = await tryInstagramFollowerEnrichment(pack, 'https://www.instagram.com/reel/DFakeReel3/', {});

    expect(result).toBeNull();
    expect(fetchHtmlViaProxy).not.toHaveBeenCalled();
  });

  it('returns null (never fabricates) when the caption is weak and no blog/comment source exists', async () => {
    const pack = {
      caption: 'comment RECIPE and I will send you the details! 🧀',
      images: [],
      latestComments: ['love this!!', 'so good'],
      profileBioUrl: '',
      title: '',
    };

    const result = await tryInstagramFollowerEnrichment(pack, 'https://www.instagram.com/reel/DFakeReel4/', {});

    expect(result).toBeNull();
    // pack.caption is untouched — no follower source found to merge in.
    expect(pack._followerSource).toBeUndefined();
  });
});
