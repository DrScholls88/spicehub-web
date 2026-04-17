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
  // Pass sourceUrl origin so persistImage uses it as Referer (avoids hotlink blocks)
  let sourceOrigin = '';
  try { sourceOrigin = sourceUrl ? new URL(sourceUrl).origin + '/' : ''; } catch { /* ignore */ }
  const persistedImage = imgUrl ? await deps.persistImage(imgUrl, sourceOrigin) : '';
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

// ── Synchronous waterfall (no jobStore) ──────────────────────────────────────
// Returns the finalized recipe payload on success.
// Throws ExtractError with { message, capturedText } on failure.

export class ExtractError extends Error {
  constructor(message, capturedText = '') {
    super(message);
    this.name = 'ExtractError';
    this.capturedText = capturedText;
  }
}

export async function runWaterfallSync({ url }, deps = defaultDeps) {
  // STEP 1 — metadata_pass
  const meta = await deps.runMetadata({ url });
  if (meta.ok && (meta.confidence ?? 0) >= 0.9) {
    const result = await finalize(meta.recipe, { sourceUrl: url, deps });
    if (!result) throw new ExtractError('Metadata found but failed validation.');
    return result;
  }

  // STEP 2 — stealth fetch (Instagram only)
  let stealth = null;
  if (isInstagramUrl(url)) {
    stealth = await deps.runStealth({ url });
    if (stealth?.ok === false && stealth?.loginWall) {
      throw new ExtractError('Instagram login required. Try BrowserAssist.');
    }
  }

  // STEP 3 — build rawSources
  const rawSources = [
    meta.ok ? { kind: 'metadata', text: JSON.stringify(meta.recipe) } : null,
    stealth?.ok ? { kind: 'caption', text: stealth.caption || '', imageUrls: stealth.imageUrls || [] } : null,
  ].filter(Boolean);

  const capturedText = rawSources.map(s => s.text).join('\n');

  if (rawSources.length === 0) {
    throw new ExtractError('No recipe data could be extracted.', capturedText);
  }

  // STEP 4 — structure + persist image in parallel
  // Prefer Instagram stealth image, fall back to metadata_pass image (recipe-scrapers)
  const imageUrl = stealth?.imageUrls?.[0] ?? firstImageUrl(meta?.recipe) ?? '';
  let sourceOrigin = '';
  try { sourceOrigin = url ? new URL(url).origin + '/' : ''; } catch { /* ignore */ }
  const [structured, persistedImage] = await Promise.all([
    deps.structureWithGemini(rawSources, { sourceUrl: url }),
    imageUrl ? deps.persistImage(imageUrl, sourceOrigin) : Promise.resolve(''),
  ]);

  if (!structured.ok) {
    throw new ExtractError(structured.error || 'AI structuring failed.', capturedText);
  }

  const mergedRecipe = { ...structured.recipe };
  if (!firstImageUrl(mergedRecipe) && persistedImage) {
    mergedRecipe.image = persistedImage;
  }

  const payload = {
    name: (mergedRecipe.name || mergedRecipe.title || '').toString(),
    ingredients: asStringArray(mergedRecipe.ingredients),
    directions:  asStringArray(mergedRecipe.directions || mergedRecipe.instructions),
    imageUrl:    persistedImage || firstImageUrl(mergedRecipe) || '',
    link:        url,
    yield:       (mergedRecipe.yield || mergedRecipe.servings || '').toString(),
    prepTime:    (mergedRecipe.prepTime || '').toString(),
    cookTime:    (mergedRecipe.cookTime || '').toString(),
  };

  const { ok, value } = validateRecipePayload(payload);
  if (!ok) throw new ExtractError('Structured recipe failed validation.', capturedText);
  return value;
}
