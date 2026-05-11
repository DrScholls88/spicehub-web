import * as jobStore from './jobStore.js';
import { firstImageUrl, isInstagramUrl } from './util.js';

export class ExtractError extends Error {
  constructor(message, capturedText = '') {
    super(message);
    this.name = 'ExtractError';
    this.capturedText = capturedText;
  }
}

function hasRecipeContent(recipe = {}) {
  return Boolean(recipe.name && (recipe.ingredients?.length || recipe.directions?.length));
}

function normalizeRecipe(recipe = {}, imageUrl = '') {
  return {
    name: recipe.name || recipe.title || 'Imported Recipe',
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    directions: Array.isArray(recipe.directions) ? recipe.directions : [],
    imageUrl: imageUrl || recipe.imageUrl || firstImageUrl(recipe),
    link: recipe.link || '',
    yield: recipe.yield || recipe.servings || '',
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
  };
}

export async function runWaterfall(payload, deps) {
  const { jobId, url } = payload;
  jobStore.put(jobId, { status: 'processing', url });

  try {
    const meta = await deps.runMetadata?.(payload);
    if (meta?.ok && meta.confidence >= 0.9 && hasRecipeContent(meta.recipe)) {
      const persisted = await deps.persistImage?.(firstImageUrl(meta.recipe));
      jobStore.put(jobId, { status: 'done', result: normalizeRecipe(meta.recipe, persisted) });
      return;
    }

    let rawSources = [];
    let imageUrl = firstImageUrl(meta?.recipe || {});
    if (meta?.ok && meta.recipe) rawSources.push(meta.recipe);

    if (isInstagramUrl(url)) {
      const stealth = await deps.runStealth?.(payload);
      if (stealth?.ok) {
        if (stealth.caption) rawSources.push(stealth.caption);
        imageUrl = firstImageUrl({ image: stealth.imageUrls }) || imageUrl;
      }
    }

    if (rawSources.length === 0) throw new ExtractError('No recipe data captured');

    const structured = await deps.structureWithGemini?.(rawSources, { sourceUrl: url });
    if (!structured?.ok || !hasRecipeContent(structured.recipe)) {
      throw new ExtractError(structured?.error || 'No recipe data captured', rawSources.join('\n'));
    }

    const persisted = await deps.persistImage?.(imageUrl);
    jobStore.put(jobId, { status: 'done', result: normalizeRecipe(structured.recipe, persisted || imageUrl) });
  } catch (err) {
    jobStore.put(jobId, { status: 'failed', error: err.message || 'import failed' });
  }
}

export async function runWaterfallSync(payload, deps = {}) {
  const jobId = payload.jobId || `sync-${Date.now()}`;
  await runWaterfall({ ...payload, jobId }, deps);
  const job = jobStore.get(jobId);
  if (job?.status === 'done') return job.result;
  throw new ExtractError(job?.error || 'extraction failed');
}
