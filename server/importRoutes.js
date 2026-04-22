// server/importRoutes.js
import * as jobStore from './jobStore.js';
import { runWaterfall as defaultRunWaterfall, runWaterfallSync as defaultRunWaterfallSync, ExtractError } from './coordinator.js';

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
      const recipe = parseVisualPayload(visualJson);
      return res.json({ recipe });
    } catch (err) {
      console.error('[visual-parse error]', err.message);
      // Never 500 the client — return an error-flagged recipe so the
      // client can detect it with isWeakResult() and fall back gracefully.
      return res.json({ recipe: { _error: true, name: 'Imported Recipe', ingredients: [], directions: [] } });
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
}

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
  const ingredients = ingredientNodes.map(n => n.text.trim()).filter(Boolean);

  // 3. Instructions
  const ingMaxTop = ingredientNodes.length > 0
    ? Math.max(...ingredientNodes.map(n => n.rect.top || 0))
    : titleTop + 100;
  const directionNodes = belowTitle.filter(n => {
    if ((n.rect.top || 0) < ingMaxTop - 50) return false;
    const t = n.text.trim();
    if (t.length < 15) return false;
    if (INSTRUCTION_RE.test(t)) return true;
    if (t.length > 40 && parseFontWeight(n.style?.fontWeight) <= 500) return true;
    return false;
  }).sort((a, b) => (a.rect.top || 0) - (b.rect.top || 0));
  const directions = directionNodes.map(n => n.text.trim()).filter(Boolean);

  // 4. Caption fallback for social
  const effectiveIng = ingredients.length > 0 ? ingredients
    : captionNodes.filter(n => INGREDIENT_RE.test(n.text.trim())).map(n => n.text.trim());
  const effectiveDir = directions.length > 0 ? directions
    : captionNodes.filter(n => n.text.trim().length > 20).map(n => n.text.trim()).slice(0, 20);

  // 5. Image
  const imgNode = nodes.find(n => n.tagName === 'IMG' && n.src && n.rect?.width > 80);
  const image = imgNode ? imgNode.src : null;

  return {
    name,
    ingredients: effectiveIng,
    directions: effectiveDir,
    image,
    sourceUrl,
    _visualParsed: true,
  };
}
