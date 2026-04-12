/**
 * SpiceHub — HTML → Markdown Converter (Blog Recipe Pipeline)
 *
 * Uses Turndown.js (already in package.json) to convert blog HTML into clean
 * Markdown before sending to Gemini or parseCaption. This is significantly
 * better than stripping all tags, because:
 *
 *   - Turndown preserves list structure (ul/ol → - / 1. bullets)
 *   - Numbered steps in <ol> become "1. Step one\n2. Step two" in Markdown
 *   - Ingredient lists in <ul> become "- ingredient" lines
 *   - Tables are converted to plain text rows
 *   - Headings become ## headings — helping parseCaption find section headers
 *   - Code blocks, images, nav links are cleanly stripped or converted
 *
 * Pipeline:
 *   1. stripBlogNoise(html)   → remove nav/header/footer/sidebar/ads
 *   2. focusRecipeSection(html) → narrow to main recipe content area if possible
 *   3. TurndownService.turndown(html) → Markdown string
 *   4. cleanMarkdown(md)      → strip Turndown artifacts, normalize whitespace
 *
 * The resulting Markdown is ~3–10x shorter than raw HTML (for a typical recipe
 * blog) and contains the actual recipe structure in a format Gemini handles well.
 */

import TurndownService from 'turndown';

// ─── Noise stripping ──────────────────────────────────────────────────────────

/**
 * Remove obvious blog noise from HTML before converting.
 * This targets the outer page chrome — nav, footer, sidebar, ads — that would
 * pollute the Markdown output with irrelevant links and text.
 *
 * Does NOT touch the recipe content area itself.
 */
export function stripBlogNoise(html) {
  if (!html || typeof html !== 'string') return '';

  let h = html;

  // Remove entire nav, header, footer, sidebar elements
  h = h.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  h = h.replace(/<header[\s\S]*?<\/header>/gi, '');
  h = h.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  h = h.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Remove script and style blocks
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '');
  h = h.replace(/<style[\s\S]*?<\/style>/gi, '');
  h = h.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove comments
  h = h.replace(/<!--[\s\S]*?-->/g, '');

  // Remove common ad containers by class/id patterns
  const adPatterns = [
    /class\s*=\s*["'][^"']*(?:ad-unit|advertisement|ads?-container|sidebar|newsletter|popup|modal|cookie|gdpr|banner|promo)[^"']*["'][^>]*>[\s\S]*?(?=<(?:div|section|article|main|p|h[1-6])|$)/gi,
    /id\s*=\s*["'][^"']*(?:sidebar|advertisement|ad-|newsletter|popup|modal|cookie)[^"']*["'][^>]*>[\s\S]*?(?=<(?:div|section|article|main|p|h[1-6])|$)/gi,
    // Remove social sharing bars
    /class\s*=\s*["'][^"']*(?:share|social-bar|sharing|follow-us)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|ul)>/gi,
    // Jump-to-recipe links (common on blog sites)
    /class\s*=\s*["'][^"']*jump-to-recipe[^"']*["'][^>]*>[\s\S]*?<\/(?:a|button|div)>/gi,
    // Print/save/rate buttons
    /class\s*=\s*["'][^"']*(?:wprm-recipe-print|recipe-print|print-recipe|tasty-recipes-buttons)[^"']*["'][^>]*>[\s\S]*?<\/(?:a|button|div)>/gi,
    // Nutrition label sections (keep recipe, drop nutrition tables)
    /class\s*=\s*["'][^"']*(?:wprm-nutrition|nutrition-info|nutrition-facts|tasty-recipes-nutrition)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|table)>/gi,
    // Rating widgets
    /class\s*=\s*["'][^"']*(?:wprm-recipe-rating|stars?-rating|review-rating)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|span)>/gi,
  ];
  for (const re of adPatterns) {
    try { h = h.replace(re, ''); } catch { /* skip malformed regex matches */ }
  }

  // Remove inline data attributes that bloat the text (wprm-data-*, data-recipe-*)
  h = h.replace(/\s+data-wprm[^=]*="[^"]*"/gi, '');
  h = h.replace(/\s+data-recipe[^=]*="[^"]*"/gi, '');

  return h;
}

/**
 * Try to narrow the HTML to just the recipe content area.
 * Returns the narrowed HTML string if a recognized recipe container is found,
 * otherwise returns the full (noise-stripped) HTML.
 *
 * Recognized containers (in priority order):
 *   1. WPRM recipe card: .wprm-recipe-container
 *   2. Tasty Recipes: .tasty-recipes
 *   3. Mediavine Create: .mv-create-card
 *   4. Feast Plugin: .recipe-card
 *   5. Generic recipe article/section by itemprop
 *   6. <main> element
 *   7. <article> element
 */
export function focusRecipeSection(html) {
  const RECIPE_CONTAINERS = [
    // WPRM
    /(<div[^>]*class\s*=\s*["'][^"']*wprm-recipe-container[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    /(<div[^>]*class\s*=\s*["'][^"']*wprm-recipe[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    // Tasty Recipes
    /(<div[^>]*class\s*=\s*["'][^"']*tasty-recipes[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    // Mediavine Create
    /(<div[^>]*class\s*=\s*["'][^"']*mv-create-card[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    // Feast Plugin
    /(<div[^>]*class\s*=\s*["'][^"']*feast-recipe-card[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    /(<div[^>]*class\s*=\s*["'][^"']*recipe-card[^"']*["'][^>]*>[\s\S]*?<\/div>)/i,
    // Schema.org itemtype
    /(<(?:div|article|section)[^>]*itemtype\s*=\s*["'][^"']*Recipe[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|section)>)/i,
    // Main content area
    /(<main[^>]*>[\s\S]*?<\/main>)/i,
    // Article element (most recipe blogs use <article> for content)
    /(<article[^>]*>[\s\S]*?<\/article>)/i,
  ];

  for (const re of RECIPE_CONTAINERS) {
    const m = re.exec(html);
    if (m && m[1] && m[1].length > 500) {
      // Sanity check: the matched section should contain recipe-like content
      const sectionText = m[1].replace(/<[^>]+>/g, ' ');
      const hasIngredientSignal = /\b(cup|tbsp|tsp|oz|gram|ml|ingredient)\b/i.test(sectionText);
      if (hasIngredientSignal || sectionText.length > 2000) {
        return m[1];
      }
    }
  }

  // No specific container found — return full HTML for Turndown to handle
  return html;
}

// ─── Turndown configuration ───────────────────────────────────────────────────

/**
 * Build a TurndownService instance optimized for recipe blog extraction.
 *
 * Custom rules:
 *   - Recipe plugin checkboxes → ignored (ingredient checkboxes in WPRM etc.)
 *   - Ingredient amounts in <span> → preserved inline
 *   - Numbered steps in <li> with class patterns → preserved as numbered list
 *   - Images → removed (we extract image separately via OG meta)
 *   - Links → text only (remove URLs to reduce Gemini token noise)
 *   - Tables → simple pipe-format (preserves nutrition-like tables as text)
 */
function buildTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',         // ## Heading style
    bulletListMarker: '-',       // Use - for unordered lists
    codeBlockStyle: 'fenced',
    strongDelimiter: '**',
    emDelimiter: '*',
  });

  // Rule: strip images (we handle images separately)
  td.addRule('strip-images', {
    filter: 'img',
    replacement: () => '',
  });

  // Rule: links → text only (removes noisy URLs from recipe step text)
  td.addRule('links-to-text', {
    filter: 'a',
    replacement: (content) => content,
  });

  // Rule: strip empty or whitespace-only table cells that bloat output
  td.addRule('clean-table-cells', {
    filter: ['td', 'th'],
    replacement: (content) => content.trim() ? ` ${content.trim()} |` : ' - |',
  });

  // Rule: input[type=checkbox] → ignore (WPRM ingredient checkboxes)
  td.addRule('strip-checkboxes', {
    filter: (node) =>
      node.nodeName === 'INPUT' &&
      (node.getAttribute('type') === 'checkbox' ||
       node.getAttribute('type') === 'radio'),
    replacement: () => '',
  });

  // Rule: <button> elements → ignore (print, save, etc.)
  td.addRule('strip-buttons', {
    filter: 'button',
    replacement: () => '',
  });

  // Rule: <svg>, <path>, <use> → ignore (icon elements)
  td.addRule('strip-svg', {
    filter: ['svg', 'path', 'use', 'symbol'],
    replacement: () => '',
  });

  // Rule: <video>, <audio>, <iframe> → ignore
  td.addRule('strip-media', {
    filter: ['video', 'audio', 'iframe', 'embed', 'object'],
    replacement: () => '',
  });

  // Rule: preserve <sup> fraction characters as text (½ → 1/2)
  td.addRule('sup-fractions', {
    filter: 'sup',
    replacement: (content) => content,
  });

  // Rule: <br> → newline
  td.addRule('br-to-newline', {
    filter: 'br',
    replacement: () => '\n',
  });

  return td;
}

// ─── Markdown cleanup ─────────────────────────────────────────────────────────

/**
 * Post-process Turndown output to remove common artifacts.
 */
function cleanMarkdown(md) {
  if (!md) return '';

  let text = md;

  // Remove reference-style link definitions Turndown sometimes leaves
  text = text.replace(/^\[[^\]]+\]:\s*https?:\/\/\S+\s*$/gm, '');

  // Remove image markdown that slipped through (![alt](url))
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Remove bare URLs
  text = text.replace(/\bhttps?:\/\/\S+/g, '');

  // Remove escape backslashes Turndown adds before certain punctuation
  text = text.replace(/\\([.*+?^${}()|[\]\\#\-_>~`])/g, '$1');

  // Normalize fraction characters to ASCII (Turndown sometimes leaves unicode)
  text = text
    .replace(/½/g, '1/2')
    .replace(/¼/g, '1/4')
    .replace(/¾/g, '3/4')
    .replace(/⅓/g, '1/3')
    .replace(/⅔/g, '2/3')
    .replace(/⅛/g, '1/8')
    .replace(/⅜/g, '3/8')
    .replace(/⅝/g, '5/8')
    .replace(/⅞/g, '7/8');

  // Collapse 3+ consecutive newlines to max 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // Remove lines that are ONLY whitespace, dashes, or pipe characters (table artifacts)
  text = text.replace(/^[\s\-|:]+$/gm, '');

  // Remove excessive leading/trailing whitespace per line
  text = text.replace(/[ \t]{3,}/g, '  ');

  // Remove HTML entities that Turndown didn't decode
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));

  return text.trim();
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Convert raw blog HTML to clean Markdown suitable for recipe parsing.
 *
 * Full pipeline:
 *   1. stripBlogNoise — remove nav/header/footer/ads
 *   2. focusRecipeSection — narrow to the recipe card area if possible
 *   3. TurndownService.turndown — convert to Markdown
 *   4. cleanMarkdown — remove artifacts
 *
 * @param {string} html - Raw HTML from CORS proxy fetch
 * @param {object} [options]
 * @param {boolean} [options.focusSection=true] - Try to narrow to recipe area
 * @param {number} [options.maxChars=8000] - Cap output length for Gemini
 * @returns {string} Clean Markdown, or empty string if conversion fails
 */
export function htmlToMarkdown(html, { focusSection = true, maxChars = 8000 } = {}) {
  if (!html || typeof html !== 'string' || html.length < 100) return '';

  try {
    // Step 1: strip obvious noise
    let cleaned = stripBlogNoise(html);

    // Step 2: focus on recipe section if requested
    if (focusSection) {
      cleaned = focusRecipeSection(cleaned);
    }

    // Step 3: Turndown conversion
    const td = buildTurndownService();
    let markdown = td.turndown(cleaned);

    // Step 4: cleanup
    markdown = cleanMarkdown(markdown);

    // Cap to maxChars for Gemini token budget
    if (markdown.length > maxChars) {
      // Prefer cutting at a paragraph boundary
      const cutAt = markdown.lastIndexOf('\n\n', maxChars);
      markdown = cutAt > maxChars * 0.5
        ? markdown.slice(0, cutAt)
        : markdown.slice(0, maxChars);
    }

    return markdown;
  } catch (e) {
    console.log(`[markdownConverter] Turndown error: ${e.message}`);
    return '';
  }
}

/**
 * Lightweight check: does the HTML page look like it contains a recipe?
 * Used to decide whether to run the full Turndown pipeline (expensive) vs
 * skip straight to meta-tag fallback.
 *
 * Returns true if the HTML has recipe-like signals.
 */
export function htmlLooksLikeRecipe(html) {
  if (!html) return false;
  // JSON-LD Recipe schema
  if (/"@type"\s*:\s*"Recipe"/i.test(html)) return true;
  // Common recipe plugin classes
  if (/class\s*=\s*["'][^"']*(wprm-recipe|tasty-recipes|mv-create-card|feast-recipe|recipe-card)[^"']*["']/i.test(html)) return true;
  // Schema.org itemtype
  if (/itemtype\s*=\s*["'][^"']*schema\.org\/Recipe["']/i.test(html)) return true;
  // itemprop recipeIngredient (microdata)
  if (/itemprop\s*=\s*["']recipeIngredient["']/i.test(html)) return true;
  // Heuristic: ingredient + measurement words in close proximity
  const sampleText = html.slice(0, 20000).replace(/<[^>]+>/g, ' ');
  const ingredientCount = (sampleText.match(/\b(cup|tbsp|tsp|tablespoon|teaspoon|ounce|oz|pound|gram|ingredient)\b/gi) || []).length;
  return ingredientCount >= 3;
}
