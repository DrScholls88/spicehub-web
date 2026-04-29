// server/importRoutes.js
import * as jobStore from './jobStore.js';
import { runWaterfall as defaultRunWaterfall, runWaterfallSync as defaultRunWaterfallSync, ExtractError } from './coordinator.js';
import { structureWithGemini } from './structurer.js';
import express from 'express';
const router = express.Router();

export function registerImportRoutes(app, {
  runWaterfall = defaultRunWaterfall,
  runWaterfallSync = defaultRunWaterfallSync,
} = {}) {

  // ── Warmup ping (keeps Render alive) ────────────────────────────────────────
  app.get('/api/v2/ping', (_req, res) => res.json({ ok: true }));

  // ── Synchronous waterfall (new primary path) ─────────────────────────────────
  app.post('/api/v2/import/sync', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    try {
      const recipe = await runWaterfallSync({ url });
      return res.json({ recipe });
    } catch (err) {
      if (err instanceof ExtractError || err?.name === 'ExtractError') {
        return res.status(422).json({
          error: 'extraction_failed',
          message: err.message,
          partial: { capturedText: err.capturedText || '' },
        });
      }
      console.error('[sync import error]', err);
      return res.status(500).json({ error: 'internal_error', message: err.message });
    }
  });

  // ── Visual parse (Paprika-style layout heuristics) ────────────────────────
  // Receives a visual JSON payload from BrowserAssist's DOM walker:
  //   { url, viewport: {width, height}, scrollY, nodes[] }
  // Each node: { text, tagName, rect: {x,y,width,height,top},
  //              style: {fontSize, fontWeight, color, backgroundColor, ...},
  //              depth, zIndex, src? }
  // Returns { recipe } in standard SpiceHub schema.
  app.post('/api/import/visual-parse', async (req, res) => {
    const visualJson = req.body;

    if (!visualJson || !Array.isArray(visualJson.nodes) || visualJson.nodes.length === 0) {
      return res.status(400).json({ error: 'nodes array required' });
    }

    try {
      const { recipe, blocks } = parseVisualPayload(visualJson);

      // Gemini enhancement: if visual confidence is low and GEMINI_API_KEY is set
      const visualConfidence = scoreVisualConfidence(recipe);
      let hybridUsed = false;
      let finalRecipe = recipe;

      if (visualConfidence < 0.75 && process.env.GEMINI_API_KEY) {
        try {
          // Build rawSources from visual blocks text for Gemini
          const capturedText = (visualJson.nodes || [])
            .filter(n => n.text && n.text.trim().length > 3 && n.tagName !== 'IMG')
            .map(n => n.text.trim())
            .join('\n');

          const geminiResult = await structureWithGemini(
            [{ kind: 'visibleText', text: capturedText }],
            { sourceUrl: visualJson.url || '' }
          );

          if (geminiResult && geminiResult.ok && geminiResult.recipe &&
              geminiResult.recipe.name && (geminiResult.recipe.ingredients?.length > 0)) {
            // Blend: prefer Gemini content, fall back to visual for missing fields
            finalRecipe = {
              ...recipe,
              name: geminiResult.recipe.name || recipe.name,
              ingredients: geminiResult.recipe.ingredients?.length ? geminiResult.recipe.ingredients : recipe.ingredients,
              directions: geminiResult.recipe.directions?.length ? geminiResult.recipe.directions : recipe.directions,
              image: recipe.image || geminiResult.recipe.image || null,
              sourceUrl: recipe.sourceUrl,
              _visualParsed: true,
            };
            hybridUsed = true;
          }
        } catch (geminiErr) {
          console.warn('[visual-parse] Gemini enhancement failed, using visual result:', geminiErr.message);
        }
      }

      return res.json({
        recipe: finalRecipe,
        blocks,
        hybridUsed,
        confidence: visualConfidence,
      });
    } catch (err) {
      console.error('[visual-parse error]', err.message);
      // Never 500 the client — return an error-flagged recipe so the
      // client can detect it with isWeakResult() and fall back gracefully.
      return res.json({ recipe: { _error: true, name: 'Imported Recipe', ingredients: [], directions: [] }, blocks: [], hybridUsed: false, confidence: 0 });
    }
  });

  // ── Background async import (kept for compatibility) ────────────────────────
  app.post('/api/v2/import', async (req, res) => {
    const { jobId, url, sourceHash } = req.body || {};
    if (!jobId || !url) return res.status(400).json({ error: 'jobId and url required' });

    const existing = jobStore.get(jobId);
    if (existing) return res.status(202).json({ jobId, status: existing.status });

    jobStore.put(jobId, { status: 'queued', url, sourceHash });
    Promise.resolve()
      .then(() => runWaterfall({ jobId, url, sourceHash }))
      .catch((err) => jobStore.put(jobId, { status: 'failed', error: err.message || String(err) }));
    res.status(202).json({ jobId, status: 'queued' });
  });

  app.get('/api/v2/import/status/:jobId', (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'unknown job' });
    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress || '',
      result: job.status === 'done' ? job.result : undefined,
      error:  job.status === 'failed' ? job.error : undefined,
      updatedAt: job.updatedAt,
    });
  });

  // ── Hybrid router alias /api/import ───────────────────────────────────────
  // Single seamless entry point that routes by `mode` in the request body:
  //   mode: 'visual'      → Paprika layout heuristics (requires nodes[])
  //   mode: 'deep' | 'sync' | undefined → Unified v2 synchronous waterfall
  //   mode: 'async' or with jobId       → Background async job + polling
  //
  // Callers that don't know which path they want can just hit /api/import —
  // if they send a visual payload (nodes[]) we parse visually, otherwise we
  // run the deep pipeline. This keeps the client side dead simple.
// ── Hybrid router alias /api/import ───────────────────────────────────────
app.post('/import', async (req, res) => {
    // 1. Extract everything from the request body at the start
    const { url, mode = 'visual', html, jobId, sourceHash } = req.body;

    if (!url) return res.status(400).json({ error: "url required" });

    try {
        // 2. Handle Async Mode / Background Jobs
        if (mode === 'async' || jobId) {
            if (!jobId) return res.status(400).json({ error: 'async mode requires jobId' });

            const existing = jobStore.get(jobId);
            if (existing) return res.status(202).json({ jobId, status: existing.status, path: 'async' });

            jobStore.put(jobId, { status: 'queued', url, sourceHash });
            
            Promise.resolve()
                .then(() => runWaterfall({ jobId, url, sourceHash }))
                .catch((err) => jobStore.put(jobId, { status: 'failed', error: err.message || String(err) }));

            return res.status(202).json({ jobId, status: 'queued', path: 'async' });
        }

        // 3. Handle Visual Mode (Paprika path)
        if (mode === 'visual' || html) {
            return visualParseHandler(req, res);
        }

        // 4. Handle Deep Mode (Synchronous waterfall)
        // This 'await' is now safely inside the 'async' function above
        const recipe = await runWaterfallSync({ url });
        return res.json({ recipe, path: 'deep' });

    } catch (err) {
        // Unified error handling
        if (err.name === 'ExtractError' || err.message?.includes('extraction')) {
            return res.status(422).json({ 
                error: 'extraction_failed', 
                message: err.message, 
                partial: { capturedText: err.capturedText || '' },
                path: 'deep'
            });
        }
        
        console.error('[hybrid /api/import error]', err);
        return res.status(500).json({ 
            error: "internal_error", 
            message: err.message 
        });
    }
});

  // ── Gemini Fallback (Phase 1 integration) ────────────────────────────────────
  // Called from browser when visual confidence is low (0.5-0.75).
  // Receives visual nodes + caption, returns Gemini-enhanced recipe.
  app.post('/api/gemini-fallback', async (req, res) => {
    const { visualNodes = [], caption = '', url = '' } = req.body || {};

    if (!Array.isArray(visualNodes) || visualNodes.length === 0) {
      return res.status(400).json({ ok: false, error: 'visualNodes array required' });
    }

    try {
      // Convert visual nodes to Gemini-friendly format
      const visualSummary = visualNodes.slice(0, 250).map(n => ({
        text: (n.text || '').substring(0, 120),
        type: n.tagName || 'div',
        fontSize: n.style?.fontSize || 'inherit',
        y: n.rect?.top || 0,
      }));

      // Call Gemini via structureWithGemini (expects structured sources)
      const sources = [
        {
          kind: 'visual',
          text: `Visual blocks from ${url || 'page'}:\n${JSON.stringify(visualSummary, null, 2)}`,
        },
      ];

      if (caption && caption.trim()) {
        sources.push({
          kind: 'caption',
          text: caption,
        });
      }

      const geminiResult = await structureWithGemini(sources, { sourceUrl: url });

      if (!geminiResult.ok) {
        return res.status(422).json({ ok: false, error: geminiResult.error || 'gemini_failed' });
      }

      // Enhance response with confidence score (simple heuristic)
      const recipe = geminiResult.recipe;
      const confidence = Math.min(
        0.3 * (recipe.name ? 1 : 0) +
        0.4 * Math.min((recipe.ingredients || []).length / 3, 1) +
        0.3 * Math.min((recipe.directions || []).length / 2, 1),
        1
      );

      return res.json({
        ok: true,
        result: {
          name: recipe.name || 'Imported Recipe',
          ingredients: recipe.ingredients || [],
          directions: recipe.directions || [],
          servings: recipe.yield ? parseInt(recipe.yield) : 1,
          time: recipe.cookTime || recipe.prepTime || '',
          confidence,
          reasoning: 'Gemini visual + caption analysis',
        },
      });
    } catch (err) {
      console.error('[gemini-fallback error]', err?.message || err);
      return res.status(500).json({ ok: false, error: err.message || 'internal_error' });
    }
  });

  // ── Photo-only re-import ─────────────────────────────────────────────────────
  // Lightweight endpoint: re-run the deep pipeline on a URL that already has a
  // recipe in the library but is missing (or has a bad) image.
  // Returns { ok, imageUrl } quickly — no full recipe re-parse exposed to client.
  app.post('/api/import/photo-only', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }
    try {
      const recipe = await runWaterfallSync({ url });
      const imageUrl = recipe.image || recipe.imageUrl || null;
      if (imageUrl) {
        return res.json({ ok: true, imageUrl });
      }
      return res.json({ ok: false, imageUrl: null, error: 'no_image_found' });
    } catch (err) {
      console.warn('[photo-only] extraction failed:', err.message);
      // Never 5xx the client — just report no image found
      return res.json({ ok: false, imageUrl: null, error: 'extraction_failed' });
    }
  });

// ── parseVisualPayload ────────────────────────────────────────────────────────
// Server-side visual layout heuristics — mirrors parseVisualJSON in recipeParser.js.
// Takes the DOM-walker visual JSON and returns a standard SpiceHub recipe object.
// Deterministic rules, no AI calls needed for basic extraction.
//
// Heuristic priorities:
//   Title: largest font-size + bold weight + near top of page + 5-120 chars
//   Ingredients: bullet/fraction/quantity pattern + medium weight + clustered
//   Instructions: numbered/paragraph blocks below ingredients
//   Captions: high z-index or non-white/non-transparent background (IG/TikTok)
/**
 * parseVisualPayload — Paprika-style layout heuristics over DOM-walker visual JSON.
 *
 * @param {object} visualJson - { url, viewport, scrollY, nodes[] }
 * @returns {{ recipe: object, blocks: Array<{text,rect,type,style}> }}
 *   recipe  — standard SpiceHub schema (name, ingredients, directions, image, sourceUrl)
 *   blocks  — every classified non-noisy node with its server-assigned type so the
 *             client can render color-coded overlays without re-running heuristics.
 *             type: 'title' | 'ingredient' | 'instruction' | 'caption' | 'other'
 */
function parseVisualPayload(visualJson) {
  const { nodes = [], viewport = { width: 390, height: 844 }, url: sourceUrl = '' } = visualJson;
  const vpH = viewport.height || 844;

  const parseFontSize = (s) => parseFloat(s) || 14;
  const parseFontWeight = (s) => {
    if (!s) return 400;
    if (s === 'bold') return 700;
    if (s === 'normal') return 400;
    return parseInt(s) || 400;
  };

  const INGREDIENT_RE = /^[\u2022\-\*\u00bc\u00bd\u00be\u2153\u2154\u215b\d]|^\s*(cup|tbsp|tsp|tablespoon|teaspoon|pound|lb|oz|gram|ml|clove|pinch|dash|handful|slice|piece)/i;
  const INSTRUCTION_RE = /^\d+[\.\)]\s|^Step\s+\d+/i;

  // Filter noise
  const isNoisy = (n) => {
    if (!n.text || n.text.trim().length < 3) return true;
    if (!n.rect || n.rect.width < 20 || n.rect.height < 8) return true;
    if (parseFontSize(n.style?.fontSize) < 10) return true;
    if (n.rect.top > vpH * 4) return true;
    return false;
  };

  // Caption/overlay nodes (social media video captions)
  const captionNodes = nodes.filter(n =>
    !isNoisy(n) &&
    (n.zIndex > 5 ||
      (n.style?.backgroundColor &&
       n.style.backgroundColor !== 'transparent' &&
       n.style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
       !n.style.backgroundColor.startsWith('rgb(255') &&
       !n.style.backgroundColor.startsWith('rgb(248') &&
       !n.style.backgroundColor.startsWith('rgb(250')))
  );
  const captionSet = new Set(captionNodes);

  const clean = nodes.filter(n => !isNoisy(n));

  // Visual weight score
  const score = (n) => {
    const fs = parseFontSize(n.style?.fontSize);
    const fw = parseFontWeight(n.style?.fontWeight);
    const topBias = 1 - Math.min((n.rect.top || 0) / (vpH * 3), 1);
    return fs * (fw / 400) * (1 + topBias * 0.5);
  };

  // 1. Title
  const titleCandidates = clean.filter(n => {
    const t = n.text.trim();
    return t.length >= 5 && t.length <= 120 &&
           (n.rect.top || 0) < vpH * 0.5 &&
           parseFontSize(n.style?.fontSize) >= 16 &&
           parseFontWeight(n.style?.fontWeight) >= 500;
  }).sort((a, b) => score(b) - score(a));
  const titleNode = titleCandidates[0] || null;
  const titleSet = titleNode ? new Set([titleNode]) : new Set();
  const name = titleNode ? titleNode.text.trim() : 'Imported Recipe';
  const titleTop = titleNode ? (titleNode.rect.top || 0) : -1;

  const belowTitle = clean.filter(n => (n.rect.top || 0) > titleTop + 20);

  // 2. Ingredients
  const directIng = belowTitle.filter(n => INGREDIENT_RE.test(n.text.trim()));
  let ingredientNodes = [...directIng];
  if (directIng.length >= 2) {
    const ingTops = directIng.map(n => n.rect.top || 0);
    const ingMinTop = Math.min(...ingTops) - 80;
    const ingMaxTop = Math.max(...ingTops) + 120;
    const avgFs = directIng.reduce((s, n) => s + parseFontSize(n.style?.fontSize), 0) / directIng.length;
    const avgFw = directIng.reduce((s, n) => s + parseFontWeight(n.style?.fontWeight), 0) / directIng.length;
    const proxNodes = belowTitle.filter(n =>
      !directIng.includes(n) &&
      (n.rect.top || 0) >= ingMinTop && (n.rect.top || 0) <= ingMaxTop &&
      Math.abs(parseFontSize(n.style?.fontSize) - avgFs) < 4 &&
      Math.abs(parseFontWeight(n.style?.fontWeight) - avgFw) < 150 &&
      n.text.trim().length > 3 && n.text.trim().length < 200
    );
    ingredientNodes = [...directIng, ...proxNodes];
  }
  ingredientNodes.sort((a, b) => (a.rect.top || 0) - (b.rect.top || 0));
  const ingredientSet = new Set(ingredientNodes);
  const ingredients = ingredientNodes.map(n => n.text.trim()).filter(Boolean);

  // 3. Instructions
  const ingMaxTopVal = ingredientNodes.length > 0
    ? Math.max(...ingredientNodes.map(n => n.rect.top || 0))
    : titleTop + 100;
  const directionNodes = belowTitle.filter(n => {
    if ((n.rect.top || 0) < ingMaxTopVal - 50) return false;
    const t = n.text.trim();
    if (t.length < 15) return false;
    if (INSTRUCTION_RE.test(t)) return true;
    if (t.length > 40 && parseFontWeight(n.style?.fontWeight) <= 500) return true;
    return false;
  }).sort((a, b) => (a.rect.top || 0) - (b.rect.top || 0));
  const directionSet = new Set(directionNodes);
  const directions = directionNodes.map(n => n.text.trim()).filter(Boolean);

  // 4. Caption fallback for social
  const effectiveIng = ingredients.length > 0 ? ingredients
    : captionNodes.filter(n => INGREDIENT_RE.test(n.text.trim())).map(n => n.text.trim());
  const effectiveDir = directions.length > 0 ? directions
    : captionNodes.filter(n => n.text.trim().length > 20).map(n => n.text.trim()).slice(0, 20);

  // 5. Image — pick the largest visible image node (Paprika hero-image approach)
  const IMG_NOISE_PATTERNS = ['profile_pic','s150x150','s320x320','favicon','logo',
                               'avatar','placeholder','banner','sprite','tracking','pixel','/icon','/badge'];
  const imgNodes = nodes.filter(n =>
    n.tagName === 'IMG' &&
    n.src &&
    n.rect?.width > 80 &&
    n.rect?.height > 60 &&
    !IMG_NOISE_PATTERNS.some(p => (n.src || '').toLowerCase().includes(p)) &&
    (n.rect?.top || 0) < (vpH * 4)
  );
  // Score by pixel area — biggest food photo wins
  const imgNode = imgNodes.reduce((best, n) => {
    const area = (n.rect?.width || 0) * (n.rect?.height || 0);
    const bestArea = (best?.rect?.width || 0) * (best?.rect?.height || 0);
    return area > bestArea ? n : best;
  }, null);
  const image = imgNode ? imgNode.src : null;

  // 6. Build classified blocks array — client renders overlays from this; no re-classification needed.
  //    Only include non-noisy text nodes (skip IMG nodes — no overlay needed for images).
  const blocks = clean.map(n => {
    let type = 'other';
    if (titleSet.has(n)) type = 'title';
    else if (ingredientSet.has(n)) type = 'ingredient';
    else if (directionSet.has(n)) type = 'instruction';
    else if (captionSet.has(n)) type = 'caption';
    return { text: n.text.trim(), rect: n.rect, type, style: n.style || {} };
  });

  const recipe = {
    name,
    ingredients: effectiveIng,
    directions: effectiveDir,
    image,
    sourceUrl,
    _visualParsed: true,
  };

  return { recipe, blocks };
}

// ── scoreVisualConfidence ─────────────────────────────────────────────────────
// Fast heuristic confidence for server-side visual parse.
// Mirrors calculateVisualConfidence() from client-side recipeParser.js.
// Returns 0-1 score.
function scoreVisualConfidence(recipe) {
  if (!recipe || recipe._error) return 0;
  let score = 0;
  const { name = '', ingredients = [], directions = [] } = recipe;
  if (name && name.length > 3 && name !== 'Imported Recipe') score += 0.30;
  const ingCount = Math.min((ingredients || []).length, 10);
  if (ingCount >= 3) score += 0.35;
  else if (ingCount >= 1) score += 0.15 * ingCount;
  const dirCount = Math.min((directions || []).length, 8);
  if (dirCount >= 2) score += 0.25;
  else if (dirCount >= 1) score += 0.12 * dirCount;
  if (recipe.image) score += 0.10;
  return Math.min(score, 1);
}}

export default router;