import { describe, it, expect } from 'vitest';
import { extractRecipeFromBlog } from '../../src/lib/blogLinkFollower.js';

describe('BlogLinkFollower', () => {
  it('continues past sparse JSON-LD and extracts the recipe card', async () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Miso-Maple Braised Tempeh</title>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Miso-Maple Braised Tempeh"
            }
          </script>
        </head>
        <body>
          <article>
            <h2 class="recipe-title">Miso-Maple Braised Tempeh</h2>
            <ul>
              <li class="ingredient">16 ounces tempeh, cut into triangles</li>
              <li class="ingredient">2 tablespoons white miso</li>
              <li class="ingredient">3 tablespoons maple syrup</li>
            </ul>
            <ol>
              <li class="instruction">Steam the tempeh for 10 minutes.</li>
              <li class="instruction">Whisk the glaze until smooth.</li>
              <li class="instruction">Braise until glossy and sticky.</li>
            </ol>
          </article>
        </body>
      </html>
    `;

    const recipe = await extractRecipeFromBlog(
      'https://sweetsimplevegan.example/miso-maple-braised-tempeh/',
      html,
    );

    expect(recipe).toMatchObject({
      name: 'Miso-Maple Braised Tempeh',
      _extractionMethod: 'heuristic',
    });
    expect(recipe.ingredients).toHaveLength(3);
    expect(recipe.directions).toHaveLength(3);
  });
});
