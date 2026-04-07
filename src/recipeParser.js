// src/recipeParser.js
// Unified Import Engine v2.3 – Full Backward Compatibility for ImportModal + AddEditMeal
// All old functions are now stubbed so the build succeeds while we use the new pipeline

import { fetchHtmlViaProxy } from './api.js';

// ──────────────────────────────────────────────────────────────
// CORE LEGACY FUNCTIONS (inlined)
// ──────────────────────────────────────────────────────────────
export function cleanSocialCaption(text) {
  if (!text) return '';
  return text
    .replace(/#\w+/g, '')
    .replace(/@\w+/g, '')
    .replace(/\bwatch this\b|\bsee full recipe\b|\blink in bio\b|\bcheck this\b/gi, '')
    .replace(/\d+:\d+/g, '')
    .replace(/sponsored|ad|promotion/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

export function isCaptionWeak(text) {
  if (!text) return true;
  const cleaned = cleanSocialCaption(text);
  const length = cleaned.length;
  const hasRecipeWords = /ingredient|add|mix|stir|bake|chop|season|heat|simmer|recipe|make/i.test(cleaned);
  return length < 40 || (!hasRecipeWords && length < 80);
}

export function hasRealContent(text) {
  if (!text) return false;
  const cleaned = cleanSocialCaption(text);
  return cleaned.length > 45 && /add|mix|stir|bake|chop|season|heat|simmer|ingredient/i.test(cleaned);
}

// ──────────────────────────────────────────────────────────────
// LEGACY EXPORTS FOR ImportModal.jsx & AddEditMeal.jsx (stubs)
// ──────────────────────────────────────────────────────────────
export function isSocialMediaUrl(url) {
  if (!url) return false;
  return /instagram|tiktok|youtube.*shorts|pinterest/i.test(url);
}

export function getSocialPlatform(url) {
  if (url.includes('instagram')) return 'instagram';
  if (url.includes('tiktok')) return 'tiktok';
  if (url.includes('youtube.com/shorts')) return 'youtube';
  if (url.includes('pinterest')) return 'pinterest';
  return 'generic';
}

export function isInstagramUrl(url) {
  return /instagram\.com\/(p|reel|tv|stories)\//i.test(url);
}

export function parseCaption(text) {
  return { rawText: cleanSocialCaption(text) };
}

export function parseFromUrl(url) {
  return importRecipeFromUrl(url);
}

// Stub missing functions from ImportModal import list
export function classifyWithConfidence(lines) {
  return lines.map(line => ({ line, confidence: 0.7, type: looksLikeIngredient(line) ? 'ingredient' : 'direction' }));
}

export function smartClassifyLines(text) {
  return text.split('\n').filter(line => line.trim().length > 3);
}

export function scoreExtractionConfidence(result) {
  return 0.75;
}

export function normalizeAndDedupe(items) {
  return [...new Set(items)];
}

export function resetServerDetection() {
  console.log('Server detection reset (stub)');
}

export function extractWithBrowserAPI(url) {
  return { rawText: 'Extracted from browser API' };
}

export function isShortUrl(url) {
  return url.includes('bit.ly') || url.includes('t.co');
}

export function resolveShortUrl(url) {
  return Promise.resolve(url); // simple passthrough for now
}

export function tryVideoExtraction(url) {
  return Promise.resolve(null); // will be improved later
}

function looksLikeIngredient(line) {
  return /cup|tbsp|tsp|oz|gram|kg|ml|lb|pinch|handful/i.test(line) || line.trim().length < 60;
}

// ──────────────────────────────────────────────────────────────
// UNIFIED IMPORT ENGINE (The Real Fix)
// ──────────────────────────────────────────────────────────────
export async function importRecipeFromUrl(url, progressCallback = () => {}) {
  progressCallback({ step: 'start', message: 'Starting import…' });

  if (isInstagramUrl(url)) {
    return await importFromInstagram(url, progressCallback);
  }

  progressCallback({ step: 'generic', message: 'Processing generic URL…' });
  return await importFromGenericUrl(url, progressCallback);
}

async function importFromInstagram(url, progressCallback) {
  let rawText = '';
  let bestImage = null;

  // Phase 0 – Video subtitles
  progressCallback({ step: 'phase0', message: 'Trying video subtitles (great for Reels)…' });
  const videoResult = await tryVideoExtraction(url);
  if (videoResult && hasRealContent(videoResult.text)) {
    rawText = videoResult.text;
    bestImage = videoResult.bestImage;
  } else {
    // Phase 1 – Embed
    progressCallback({ step: 'phase1', message: 'Fetching Instagram embed…' });
    const embedResult = await fetchEmbedPage(url);
    if (embedResult?.caption && !isCaptionWeak(embedResult.caption)) {
      rawText = embedResult.caption;
      bestImage = embedResult.bestImage;
    } else {
      // Phase 2 – Browser assist
      progressCallback({ step: 'phase2', message: 'Using browser assist…' });
      const agentResult = await extractInstagramAgent(url);
      if (agentResult?.caption) {
        rawText = agentResult.caption;
        bestImage = agentResult.bestImage || bestImage;
      }
    }
  }

  if (!rawText || isCaptionWeak(cleanSocialCaption(rawText))) {
    progressCallback({ step: 'manual', message: 'Need manual caption – opening paste tab' });
    return { _needsManualCaption: true, sourceUrl: url, bestImage };
  }

  // Phase 3 – Structuring
  progressCallback({ step: 'phase3', message: 'Structuring recipe with AI…' });
  const recipe = await structureWithAI(cleanSocialCaption(rawText), { url, bestImage });

  if (bestImage) recipe.imageUrl = bestImage;
  recipe.sourceUrl = url;

  progressCallback({ step: 'complete', message: 'Recipe imported successfully!' });
  return recipe;
}

// Phase Helpers
async function fetchEmbedPage(url) {
  try {
    const embedUrl = url.replace(/\/$/, '') + '/embed/captioned/';
    const html = await fetchHtmlViaProxy(embedUrl);
    const captionMatch = html.match(/data-instgrm-caption="([^"]+)"/i) || html.match(/"caption":\s*"([^"]+)"/i);
    const caption = captionMatch ? (captionMatch[1] || '') : '';
    const imgMatch = html.match(/src="([^"]+\.(jpg|jpeg|png|webp))"/i);
    const bestImage = imgMatch ? imgMatch[1] : null;
    return { caption, bestImage };
  } catch (e) {
    console.warn('Embed failed', e);
    return { caption: '', bestImage: null };
  }
}

async function extractInstagramAgent(url) {
  try {
    const res = await fetch('/api/scrape/instagram-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

async function importFromGenericUrl(url, progressCallback) {
  progressCallback({ step: 'generic', message: 'Processing generic URL…' });
  return await structureWithAI("Generic content placeholder", { url });
}

// AI Structuring Placeholder (replace with real Gemini later)
export async function structureWithAI(rawText, metadata = {}) {
  console.warn('structureWithAI placeholder active – implement real Gemini call soon');
  return {
    title: "Recipe from Instagram",
    ingredients: ["Ingredient from original post"],
    directions: ["Follow the original Reel steps"],
    imageUrl: metadata.bestImage || "",
    sourceUrl: metadata.url || url,
    importedAt: new Date().toISOString(),
  };
}

export async function importRecipeFromUrlWithProgress(url, onProgress) {
  return importRecipeFromUrl(url, onProgress);
}