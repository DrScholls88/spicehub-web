import fs from 'fs';

const filePath = 'src/recipeParser.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Strategy comment
content = content.replace(/ \* Strategy \(mirrors Paprika 3\):[\s\S]*?\*   3\. CAPTION TEXT  ?" 4-pass heuristic parser \(used internally on extracted captions\)/, ` * Strategy:
 *   1. CLIENT-SIDE FIRST — All extraction runs in the browser via CORS proxies.
 *   2. VISUAL HEURISTICS — Layout-based detection (Paprika-style) for complex pages.
 *   3. GEMINI AI — Direct client-side structuring of captured text and layout blocks.
 *   4. ZERO SERVER — No headless browser, yt-dlp, or scraping logic on the backend.`);

// 2. extractInstagramAgent stub
content = content.replace(/export async function extractInstagramAgent\(url, onProgress, \{ type = 'meal' \} = \{\}\) \{[\s\S]*?async function tryServerExtraction\(url, onProgress\) \{[\s\S]*?signal: ctrl\.signal,\s*\}\);/, `export async function extractInstagramAgent(url, onProgress, { type = 'meal' } = {}) {
  // Server-side agents decommissioned. Use BrowserAssist visual mode instead.
  return null;
}

/**
 * tryServerExtraction — Decommissioned (formerly yt-dlp + headless Chrome).
 */
async function tryServerExtraction(url, onProgress) {
  return null;
}

const DUMMY_API = async (url) => {`);

// 3. parseVisualJSON return
content = content.replace(/  return \{[\s\S]*?_visualConfidence: confidence,\s*\};\s*\}/, `  // 6. Build classified blocks array — client renders overlays from this
  const blocks = clean.map(n => {
    let type = 'other';
    if (n === titleNode) type = 'title';
    else if (ingredientNodes.includes(n)) type = 'ingredient';
    else if (instructionNodes.includes(n)) type = 'instruction';
    else if (captionNodes.includes(n)) type = 'caption';
    return { text: n.text.trim(), rect: n.rect, type, style: n.style || {} };
  });

  return {
    recipe: {
      name: title,
      ingredients: effectiveIngredients,
      directions: effectiveDirections,
      ...buildStructuredFields(effectiveIngredients, effectiveDirections),
      image,
      sourceUrl,
      _visualParsed: true,
      _visualConfidence: confidence,
    },
    blocks,
    confidence
  };
}`);

// 4. parseRecipeHybrid
content = content.replace(/export async function parseRecipeHybrid\(visualNodes = \[\], caption = '', url = ''\) \{[\s\S]*?return data\.resolvedUrl \|\| url;[\s\S]*?\} catch \{[\s\S]*?return url;[\s\S]*?\}[\s\S]*?\}/, `export async function parseRecipeHybrid(visualNodes = [], caption = '', url = '') {
  const visualThresholdHigh = 0.75; // Strong visual signal +' ship immediately

  // Step 1: Run visual parser (now returns blocks + recipe)
  const { recipe: visualResult, blocks, confidence: visualConfidence } = parseVisualJSON({ nodes: visualNodes }, url);

  // Step 2: If visual is strong, return it immediately
  if (visualConfidence >= visualThresholdHigh && !visualResult._error) {
    return {
      ...visualResult,
      _blocks: blocks,
      _source: 'visual-only',
      _hybridConfidence: visualConfidence,
      _hybridUsed: false,
    };
  }

  // Step 3: Visual weak or missing +' call Gemini directly from client
  console.log(\`[Hybrid] Low visual confidence (\${(visualConfidence * 100).toFixed(0)}%), calling Gemini...\`);

  let geminiResult = null;
  try {
    // Build a summary of visual blocks for Gemini context
    const visualSummary = (visualNodes || []).slice(0, 250).map(n => ({
      text: (n.text || '').substring(0, 120),
      type: n.tagName || 'div',
      fontSize: n.style?.fontSize || 'inherit',
      y: n.rect?.top || 0,
    }));

    const textToStructure = \`Visual blocks from \${url || 'page'}:\\n\${JSON.stringify(visualSummary, null, 2)}\\n\\nCaption:\\n\${caption || ''}\`;

    geminiResult = await captionToRecipe(textToStructure, { sourceUrl: url });
  } catch (err) {
    console.error('[Gemini hybrid] failed:', err?.message || err);
  }

  // Step 4: No Gemini result +' return visual as-is
  if (!geminiResult || isWeakResult(geminiResult)) {
    return {
      ...visualResult,
      _blocks: blocks,
      _source: 'visual-fallback',
      _hybridConfidence: visualConfidence,
      _hybridUsed: false,
    };
  }

  // Step 5: Merge Gemini content with visual metadata (image, url)
  return {
    ...geminiResult,
    image: visualResult.image || geminiResult.image || null,
    sourceUrl: url,
    _blocks: blocks,
    _source: 'visual+gemini-hybrid',
    _hybridConfidence: (visualConfidence * 0.4) + 0.6, // heavily weighted toward Gemini's intelligence
    _hybridUsed: true,
  };
}

/**
 * resolveShortUrl — Client-side redirect following is limited.
 * Returns the original URL.
 */
export async function resolveShortUrl(url) {
  return url;
}
`);

fs.writeFileSync(filePath, content);
console.log('Successfully updated recipeParser.js');
