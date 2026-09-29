// starterPackExport.js — "Starter ZIP" admin tool (Meals → Select, when the
// sh_admin flag is on; open the app once with ?admin=1 to turn it on).
//
// Turns recipes imported and reviewed in the app into ready-to-paste
// starterKitData.js blocks, and bundles each photo so it can live in
// public/starter-kit/ — a stable, offline-precached URL instead of an
// Instagram/TikTok CDN link that expires and fails the starter gate.
//
// ZIP layout (unzip at the repo root):
//   starter-pack-blocks.js          paste the blocks into STARTER_KIT_RAW
//   public/starter-kit/<slug>.jpg   photos, referenced as /starter-kit/<slug>.jpg
//   README.txt
import JSZip from 'jszip';
import { downloadImageAsDataUrl } from '../api.js';
import { normalizeMealCategory } from '../recipeSchema.js';

export function starterSlug(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recipe';
}

const s = (v) => JSON.stringify(v);
const list = (key, arr) => {
  const items = (Array.isArray(arr) ? arr : []).map((x) => String(x ?? '').trim()).filter(Boolean);
  return items.length ? [`    ${key}: [`, ...items.map((x) => `      ${s(x)},`), '    ],'].join('\n') : `    ${key}: [],`;
};

/** One recipe in starterKitData.js's hand-edited block format. */
export function formatStarterBlock(meal, imageUrl = meal?.imageUrl || '', warning = '') {
  const category = normalizeMealCategory(meal?.category || 'Dinners') || 'Dinners';
  const notes = (Array.isArray(meal?.notes) ? meal.notes : meal?.notes ? [meal.notes] : [])
    .map((n) => (typeof n === 'string' ? n : n?.title ? { title: n.title, text: n.text || '' } : n?.text || ''))
    .filter(Boolean);
  const L = [];
  if (category !== 'Dinners') L.push(`  // ${meal?.name}: category "${category}" is not a dinner, so the starter gate will skip it.`);
  if (warning) L.push(`  // ${meal?.name}: ${warning}`);
  L.push('  {');
  L.push(`    name: ${s(meal?.name || 'Untitled Recipe')},`);
  L.push(`    category: ${s(category)},`);
  if (meal?.cuisine) L.push(`    cuisine: ${s(meal.cuisine)},`);
  if (meal?.dishType) L.push(`    dishType: ${s(meal.dishType)},`);
  if (meal?.dietaryTags?.length) L.push(`    dietaryTags: ${s(meal.dietaryTags)},`);
  for (const k of ['servings', 'prepTime', 'cookTime', 'totalTime']) if (meal?.[k]) L.push(`    ${k}: ${s(String(meal[k]))},`);
  if (meal?.description) L.push(`    description: ${s(meal.description)},`);
  L.push(`    sourceUrl: ${s(meal?.sourceUrl || meal?.link || '')},`);
  L.push(`    imageUrl: ${s(imageUrl)},`);
  L.push(list('ingredients', meal?.ingredients));
  L.push(list('directions', meal?.directions));
  if (notes.length) L.push(`    notes: ${s(notes)},`);
  L.push('  },');
  return L.join('\n');
}

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function dataUrlToFile(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m || !EXT[m[1]]) return null;
  return { ext: EXT[m[1]], data: m[3], base64: !!m[2] };
}

/**
 * @param {object[]} meals
 * @param {{ fetchImage?: (url: string) => Promise<string|null> }} [opts]
 * @returns {Promise<{ blob: Blob, count: number, photos: number }>}
 */
export async function buildStarterPackZip(meals, { fetchImage = downloadImageAsDataUrl } = {}) {
  const zip = new JSZip();
  const used = new Set();
  const blocks = [];
  let photos = 0;
  for (const meal of meals) {
    let slug = starterSlug(meal.name);
    for (let i = 2; used.has(slug); i++) slug = `${starterSlug(meal.name)}-${i}`;
    used.add(slug);

    const original = meal.imageUrl || '';
    let dataUrl = null;
    if (original.startsWith('data:')) dataUrl = original;
    else if (original) dataUrl = await fetchImage(original).catch(() => null);
    const file = dataUrl ? dataUrlToFile(dataUrl) : null;

    let imageUrl = original;
    let warning = original ? '' : 'no photo — add an imageUrl before it can pass the gate.';
    if (file) {
      zip.file(`public/starter-kit/${slug}.${file.ext}`, file.data, { base64: file.base64 });
      imageUrl = `/starter-kit/${slug}.${file.ext}`;
      photos++;
    } else if (original) {
      warning = 'photo could not be downloaded — save it to public/starter-kit/ yourself and point imageUrl at it.';
      if (original.startsWith('data:')) imageUrl = '';
    }
    blocks.push(formatStarterBlock(meal, imageUrl, warning));
  }

  zip.file('starter-pack-blocks.js', [
    '// Paste these blocks into STARTER_KIT_RAW in src/data/starterKitData.js,',
    '// then run: npm test -- StarterKitMeals',
    '',
    blocks.join('\n\n'),
    '',
  ].join('\n'));
  zip.file('README.txt', [
    'SpiceHub starter pack export',
    '',
    '1. Unzip this at the root of spicehub-web. Photos land in public/starter-kit/.',
    '2. Paste the blocks from starter-pack-blocks.js into STARTER_KIT_RAW in src/data/starterKitData.js.',
    '3. Tidy anything the import got wrong (quantities, a step filed as an ingredient).',
    '4. Run: npm test -- StarterKitMeals',
    '',
  ].join('\n'));

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, count: meals.length, photos };
}
