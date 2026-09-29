import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildStarterPackZip, formatStarterBlock, starterSlug } from '../lib/starterPackExport.js';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const meal = {
  name: 'Crispy Mushroom Parm',
  category: 'Dinner',
  ingredients: ['1 demi baguette', '1 cup marinara'],
  directions: ['Toast the bread.', 'Layer and broil.'],
  sourceUrl: 'https://example.com/parm',
  imageUrl: 'https://scontent.cdninstagram.com/x.jpg',
  notes: [{ title: '', text: 'Great with a salad.' }],
};

describe('starter pack export', () => {
  it('formats a block that evaluates back to the same fields', () => {
    const block = formatStarterBlock(meal, '/starter-kit/crispy-mushroom-parm.png');
    const [parsed] = new Function(`return [\n${block}\n];`)();
    expect(parsed).toMatchObject({
      name: 'Crispy Mushroom Parm',
      category: 'Dinners',
      ingredients: meal.ingredients,
      directions: meal.directions,
      imageUrl: '/starter-kit/crispy-mushroom-parm.png',
      notes: ['Great with a salad.'],
    });
  });

  it('bundles the photo and points imageUrl at public/starter-kit', async () => {
    const { blob, photos } = await buildStarterPackZip([meal, { ...meal }], { fetchImage: async () => PNG });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(photos).toBe(2);
    expect(zip.file('public/starter-kit/crispy-mushroom-parm.png')).toBeTruthy();
    expect(zip.file('public/starter-kit/crispy-mushroom-parm-2.png')).toBeTruthy();
    const blocks = await zip.file('starter-pack-blocks.js').async('string');
    expect(blocks).toContain('imageUrl: "/starter-kit/crispy-mushroom-parm.png"');
    expect(blocks).not.toContain('cdninstagram');
  });

  it('keeps the original URL and warns when the photo cannot be fetched', async () => {
    const { blob, photos } = await buildStarterPackZip([meal], { fetchImage: async () => null });
    const blocks = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('starter-pack-blocks.js').async('string');
    expect(photos).toBe(0);
    expect(blocks).toContain('photo could not be downloaded');
  });

  it('slugs names safely', () => {
    expect(starterSlug('Bean & Cheese Enchiladas!')).toBe('bean-cheese-enchiladas');
  });
});
