// server/coordinator.js
import * as jobStore from './jobStore.js';
import { runPython } from './runPython.js';
import { isInstagramUrl, firstImageUrl, asStringArray } from './util.js';
import { persistImage as defaultPersistImage } from './persistImage.js';
import { structureWithGemini as defaultStructureWithGemini } from './structurer.js';
import { validateRecipePayload } from './schema.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METADATA_SCRIPT = join(__dirname, 'python', 'metadata_pass.py');
const STEALTH_SCRIPT  = join(__dirname, 'python', 'instagram_stealth_fetch.py');

// Default deps shell out to Python; tests inject fakes.
const defaultDeps = {
  runMetadata:          (input) => runPython(METADATA_SCRIPT, input, { timeoutMs: 15_000 }),
  runStealth:           (input) => runPython(STEALTH_SCRIPT,  input, {
    timeoutMs: 45_000,
    env: { IG_COOKIES_JSON_B64: process.env.IG_COOKIES_JSON_B64 || '' },
  }),
  structureWithGemini:  defaultStructureWithGemini,
  persistImage:         defaultPersistImage,
};

export async function runWaterfall({ jobId, url, sourceHash }, deps = defaultDeps) {
  const update = (patch) => jobStore.put(jobId, patch);
  update({ status: 'processing', progress: 'Starting…', url, sourceHash });

  // STEP 1 — metadata_pass
  update({ progress: 'Checking for structured recipe data…' });
  const meta = await deps.runMetadata({ url });
  if (meta.ok && (meta.confidence ?? 0) >= 0.9) {
    const result = await finalize(meta.recipe, { sourceUrl: url, deps });
    if (!result) return update({ status: 'failed', error: 'Invalid metadata payload.' });
    return update({ status: 'done', progress: '', result });
  }

  // STEP 2 — instagram_stealth_fetch (only for IG)
  let stealth = null;
  if (isInstagramUrl(url)) {
    update({ progress: 'Fetching Instagram caption…' });
    stealth = await deps.runStealth({ url });
  }

  // STEP 3 — structurer
  const rawSources = [
    meta.ok ? { kind: 'metadata', text: JSON.stringify(meta.recipe) } : null,
    stealth?.ok ? { kind: 'caption', text: stealth.caption || '', imageUrls: stealth.imageUrls || [] } : null,
  ].filter(Boolean);

  if (rawSources.length === 0) {
    return update({ status: 'failed', error: 'No recipe data could be extracted.' });
  }

  update({ progress: 'AI structuring…' });
  const structured = await deps.structureWithGemini(rawSources, { sourceUrl: url });
  if (!structured.ok) {
    return update({ status: 'failed', error: structured.error || 'Structuring failed.' });
  }

  // If stealth contributed images and structurer didn't pick one, inject the preferred (data URL first)
  const mergedRecipe = { ...structured.recipe };
  if (!firstImageUrl(mergedRecipe) && stealth?.ok && stealth.imageUrls?.length) {
    mergedRecipe.image = stealth.imageUrls[0];
  }

  const finalResult = await finalize(mergedRecipe, { sourceUrl: url, deps });
  if (!finalResult) return update({ status: 'failed', error: 'Structured recipe failed validation.' });
  update({ status: 'done', progress: '', result: finalResult });
}

async function finalize(recipe, { sourceUrl, deps }) {
  const imgUrl = firstImageUrl(recipe);
  const persistedImage = imgUrl ? await deps.persistImage(imgUrl) : '';
  const payload = {
    name: (recipe.name || recipe.title || '').toString(),
    ingredients: asStringArray(recipe.ingredients),
    directions:  asStringArray(recipe.directions || recipe.instructions),
    imageUrl:    persistedImage,
    link:        sourceUrl || '',
    yield:       (recipe.yield || recipe.servings || '').toString(),
    prepTime:    (recipe.prepTime || '').toString(),
    cookTime:    (recipe.cookTime || '').toString(),
  };
  const { ok, value } = validateRecipePayload(payload);
  return ok ? value : null;
}
