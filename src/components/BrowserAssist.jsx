import { useState, useEffect, useRef, useCallback } from 'react';
import { extractRecipeFromDOM, parseCaption } from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl } from '../api';

/**
 * BrowserAssist — Interactive embedded view for Instagram recipe extraction.
 *
 * Strategy:
 *   1. Fetch the Instagram embed/captioned page via CORS proxy
 *   2. Try regex extraction on the raw HTML first (caption, image, title)
 *   3. If regex finds a real recipe (not placeholders), return it immediately
 *   4. If not, render the HTML in an srcdoc iframe for user to view
 *   5. User scrolls, reads the content, clicks "Extract Recipe"
 *   6. Extract visible text from iframe DOM, parse with extractRecipeFromDOM
 *   7. Fallback: "Paste Text Instead" switches to manual paste tab
 *
 * Props:
 *   url                 - Instagram URL
 *   onRecipeExtracted   - callback(recipe) on success
 *   onFallbackToText    - callback() when user wants Paste Text
 */
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText }) {
  const [phase, setPhase] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [rawHtml, setRawHtml] = useState('');       // unsanitized, for regex extraction
  const [loadingDots, setLoadingDots] = useState(''); // animated dots
  const iframeRef = useRef(null);
  const extractionRef = useRef(null);

  // ── Pulsing loading text animation ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'loading') return;
    const messages = [
      'Fetching Instagram post',
      'Loading page content',
      'Scanning for recipe data',
      'Almost there',
    ];
    let idx = 0;
    let dots = 0;
    const interval = setInterval(() => {
      dots = (dots + 1) % 4;
      if (dots === 0) idx = (idx + 1) % messages.length;
      setLoadingDots(messages[idx] + '.'.repeat(dots + 1));
    }, 600);
    return () => clearInterval(interval);
  }, [phase]);

  // ── Fetch the page HTML ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'loading') {
        setErrorMsg('Page took too long to load. Instagram may be blocking the request.');
        setPhase('error');
      }
    }, 45000); // Extended from 20s to 45s

    (async () => {
      try {
        // Build the embed/captioned URL (has more caption text visible)
        const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        const embedUrl = shortcodeMatch
          ? `https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`
          : url;

        let html = await fetchHtmlViaProxy(embedUrl, 40000);
        if (cancelled) return;

        // Fallback to the original URL if embed didn't work
        if (!html || html.length < 500) {
          html = await fetchHtmlViaProxy(url, 40000);
          if (cancelled) return;
        }

        if (!html || html.length < 500) {
          setErrorMsg('Could not load the Instagram post. Try "Paste Text Instead".');
          setPhase('error');
          return;
        }

        // Store raw HTML for regex extraction
        setRawHtml(html);

        // ── Try regex-based extraction on raw HTML first ──
        const regexRecipe = extractFromRawHtml(html, url);
        if (regexRecipe && hasRealContent(regexRecipe)) {
          // Got a real recipe with actual ingredients/directions — return immediately
          if (!cancelled) onRecipeExtracted(regexRecipe);
          return;
        }

        // Regex didn't find a full recipe — show the iframe for manual extraction
        setHtmlContent(sanitizeHtmlForEmbed(html, embedUrl));

      } catch (err) {
        if (!cancelled) {
          console.error('[BrowserAssist] Fetch error:', err);
          setErrorMsg('Failed to load page: ' + err.message);
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [url, onRecipeExtracted]);

  // ── When HTML is ready, show the iframe ──────────────────────────────────────
  useEffect(() => {
    if (htmlContent) setPhase('ready');
  }, [htmlContent]);

  // ── After iframe renders, inject extraction button ───────────────────────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc || !doc.body) return;

      // Remove existing injected elements
      doc.getElementById('spicehub-extract-btn')?.remove();
      doc.getElementById('spicehub-helper')?.remove();

      // Floating "Extract Recipe" button inside iframe
      const btn = doc.createElement('button');
      btn.id = 'spicehub-extract-btn';
      btn.textContent = '\u{1F4E5} Extract Recipe';
      btn.style.cssText = [
        'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
        'padding:14px 20px', 'background:#4CAF50', 'color:white', 'border:none',
        'border-radius:12px', 'font-size:15px', 'font-weight:700', 'cursor:pointer',
        'box-shadow:0 4px 16px rgba(0,0,0,0.35)', 'font-family:system-ui,sans-serif',
        'touch-action:manipulation', '-webkit-tap-highlight-color:transparent',
      ].join(';');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (extractionRef.current) extractionRef.current();
      });
      doc.body.appendChild(btn);

      // Helper banner at top
      const helper = doc.createElement('div');
      helper.id = 'spicehub-helper';
      helper.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:rgba(0,0,0,0.85)', 'color:white', 'padding:10px 16px',
        'font-size:13px', 'font-family:system-ui,sans-serif',
        'text-align:center', 'line-height:1.4',
      ].join(';');
      helper.textContent = 'Scroll to see the full recipe caption, then tap the green button below.';
      doc.body.appendChild(helper);

      // Auto-dismiss helper after 5s
      setTimeout(() => {
        if (helper.parentNode) {
          helper.style.transition = 'opacity 0.5s';
          helper.style.opacity = '0';
          setTimeout(() => helper.remove(), 500);
        }
      }, 5000);
    } catch (err) {
      console.warn('[BrowserAssist] Could not inject into iframe:', err);
    }
  }, []);

  // ── Extraction from iframe DOM ───────────────────────────────────────────────
  const handleExtraction = useCallback(() => {
    setPhase('extracting');
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) throw new Error('Cannot read page content');

      // Extract visible text from iframe
      const visibleText = extractVisibleTextFromDoc(doc);
      const imageUrls = extractImageUrlsFromDoc(doc);

      // Also try regex on raw HTML again (may have different results)
      const regexRecipe = rawHtml ? extractFromRawHtml(rawHtml, url) : null;

      // Try DOM-based extraction
      const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);

      // Pick the best result — prefer the one with more ingredients
      const recipe = pickBestRecipe(regexRecipe, domRecipe);

      if (recipe && hasRealContent(recipe)) {
        onRecipeExtracted(recipe);
        return;
      }

      // No real recipe found — flash error on the iframe button
      try {
        const btn = doc.getElementById('spicehub-extract-btn');
        if (btn) {
          btn.textContent = '\u274C No recipe found — try Paste Text';
          btn.style.background = '#f44336';
          setTimeout(() => {
            if (btn.parentNode) {
              btn.textContent = '\u{1F4E5} Extract Recipe';
              btn.style.background = '#4CAF50';
            }
          }, 3000);
        }
      } catch { /* ignore */ }

      setPhase('ready');
    } catch (err) {
      console.error('[BrowserAssist] Extraction error:', err);
      setErrorMsg('Could not read page content. Try "Paste Text Instead".');
      setPhase('error');
    }
  }, [url, rawHtml, onRecipeExtracted]);

  // Keep extractionRef in sync
  useEffect(() => { extractionRef.current = handleExtraction; }, [handleExtraction]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="browser-assist-container">
      {phase === 'loading' && (
        <div className="browser-assist-loading">
          <div className="browser-spinner large" />
          <p className="browser-assist-pulse-text">{loadingDots || 'Fetching Instagram post...'}</p>
          <button className="btn-secondary" onClick={onFallbackToText} style={{ marginTop: 12 }}>
            Skip — Paste Text Instead
          </button>
        </div>
      )}

      {(phase === 'ready' || phase === 'extracting') && (
        <div className="browser-assist-ready">
          <div className="browser-assist-iframe-container">
            <iframe
              ref={iframeRef}
              title="Recipe Page"
              className="browser-assist-iframe"
              srcDoc={htmlContent}
              sandbox="allow-same-origin"
              onLoad={handleIframeLoad}
            />
          </div>
          <div className="browser-assist-actions">
            <button className="btn-primary" onClick={handleExtraction} disabled={phase === 'extracting'}>
              {phase === 'extracting'
                ? '\u23F3 Analyzing…'
                : '\u{1F4E5} Extract Recipe'}
            </button>
            <button className="btn-secondary" onClick={onFallbackToText} disabled={phase === 'extracting'}>
              Paste Text Instead
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="browser-assist-error">
          <p className="error-text">{errorMsg}</p>
          <button className="btn-primary" onClick={onFallbackToText}>
            Use Paste Text Instead
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Instagram placeholder patterns that should NEVER pass as real content */
const PLACEHOLDER_PATTERNS = [
  /^see (the )?(original|recipe|full|complete)\s*(post|recipe|page|link|caption|video|content|for)/i,
  /^(view|check|visit|go to|open|click|tap)\s*(the )?(original|recipe|full|link|post|caption)/i,
  /^no (ingredients|directions|instructions|steps|recipe)\s*(found|available|listed|provided)?/i,
  /^imported recipe$/i,
  /^instagram recipe$/i,
  /^recipe from instagram$/i,
  /^see original post for/i,
  /^see recipe for/i,
  /^(ingredients|directions|instructions) (not |un)?(available|found|provided)/i,
  /^this (video|post|reel|content|recipe) is/i,
  /^log ?in to see/i,
  /^sign up to see/i,
  /^content (is )?not available/i,
  /^(sorry|oops),?\s*(this )?(content|page|post|recipe)/i,
];

/** Title patterns that indicate a placeholder, not a real recipe name */
const PLACEHOLDER_TITLE_PATTERNS = [
  /^imported recipe$/i,
  /^instagram recipe$/i,
  /^recipe from instagram$/i,
  /^instagram$/i,
  /^recipe$/i,
  /^untitled$/i,
  /on instagram$/i,
  /^\s*$/,
];

/**
 * Check if a single line is placeholder text.
 */
function isPlaceholderLine(line) {
  if (!line || typeof line !== 'string') return true;
  const trimmed = line.trim();
  if (trimmed.length < 4) return true;
  return PLACEHOLDER_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Check if a recipe title is a placeholder.
 */
function isPlaceholderTitle(title) {
  if (!title || typeof title !== 'string') return true;
  return PLACEHOLDER_TITLE_PATTERNS.some(re => re.test(title.trim()));
}

/**
 * Check if a recipe has real content (not just placeholders).
 * This is the primary gate — nothing passes without real ingredients OR directions.
 */
function hasRealContent(recipe) {
  if (!recipe) return false;

  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];

  // Filter out placeholder lines
  const realIngs = ings.filter(i => !isPlaceholderLine(i));
  const realDirs = dirs.filter(d => !isPlaceholderLine(d));

  // Require at least 2 real ingredients OR 2 real directions
  if (realIngs.length < 2 && realDirs.length < 2) return false;

  // Reject if title is a known placeholder and we barely have content
  if (isPlaceholderTitle(recipe.name) && realIngs.length < 3 && realDirs.length < 3) return false;

  return true;
}

/**
 * Pick the recipe with more actual content. Filter placeholders before scoring.
 */
function pickBestRecipe(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  // Score by real content count
  const realA = (a.ingredients?.filter(i => !isPlaceholderLine(i))?.length || 0)
    + (a.directions?.filter(d => !isPlaceholderLine(d))?.length || 0);
  const realB = (b.ingredients?.filter(i => !isPlaceholderLine(i))?.length || 0)
    + (b.directions?.filter(d => !isPlaceholderLine(d))?.length || 0);
  return realA >= realB ? a : b;
}

/**
 * Clean a recipe — strip out any placeholder lines that snuck in.
 */
function cleanRecipe(recipe) {
  if (!recipe) return recipe;
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).filter(i => !isPlaceholderLine(i)),
    directions: (recipe.directions || []).filter(d => !isPlaceholderLine(d)),
    name: isPlaceholderTitle(recipe.name) ? '' : recipe.name,
  };
}

/**
 * Regex-based extraction from raw HTML (works before sanitization strips data).
 * Targets Instagram embed page patterns: caption divs, JSON data, OG meta.
 */
function extractFromRawHtml(html, sourceUrl) {
  // ── Extract caption text ──
  let caption = '';

  // Method 1: Caption div patterns
  const captionPatterns = [
    /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
  ];
  for (const re of captionPatterns) {
    const m = re.exec(html);
    if (m && m[1]) {
      const text = stripHtml(m[1]);
      if (text.length > 30) { caption = text; break; }
    }
  }

  // Method 2: JSON data in scripts
  if (!caption) {
    const dataPatterns = [
      /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      /"text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
    ];
    for (const re of dataPatterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        try { caption = JSON.parse('"' + m[1] + '"'); } catch { caption = m[1]; }
        if (caption.length > 30) break;
        caption = '';
      }
    }
  }

  // Method 3: OG description
  if (!caption) {
    const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
    if (ogM && ogM[1] && ogM[1].length > 30) {
      caption = ogM[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
  }

  if (!caption || caption.length < 30) return null;

  // ── Reject known Instagram OG placeholder captions ──
  if (/^\d+[\s,]*(likes?|comments?|views?)/i.test(caption)) return null;
  if (/^[\d,.]+\s*(Likes?|Comments?)/i.test(caption)) return null;

  // ── Parse caption into recipe ──
  const parsed = parseCaption(caption);
  if (!parsed) return null;

  // ── Extract images — prioritize actual content photos ──
  let imageUrl = '';
  imageUrl = extractBestImageFromHtml(html);

  // ── Extract title ──
  let name = parsed.title || '';
  if (!name) {
    const ogTitleM = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']*)["']/i);
    if (ogTitleM) {
      name = ogTitleM[1]
        .replace(/\s*on\s+Instagram\s*$/i, '')
        .replace(/\s*\(@[\w.]+\)\s*$/i, '')
        .replace(/#\w[\w.]*/g, '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .trim();
    }
  }
  if (!name || isPlaceholderTitle(name)) name = '';

  const recipe = cleanRecipe({
    name,
    ingredients: parsed.ingredients.length ? parsed.ingredients : [],
    directions: parsed.directions.length ? parsed.directions : [],
    imageUrl,
    link: sourceUrl,
  });

  return recipe;
}

/**
 * Extract the best image URL from raw HTML.
 * Prioritizes: display_url > thumbnail_src > scontent CDN images > OG image.
 * Filters out tiny icons, profile pics, and tracking pixels.
 */
function extractBestImageFromHtml(html) {
  const candidates = [];

  // 1. JSON display_url (highest res, usually the actual post image/video thumbnail)
  const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g);
  for (const m of displayUrlMatches) {
    const url = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (url.includes('scontent')) candidates.push({ url, priority: 1 });
  }

  // 2. JSON thumbnail_src
  const thumbMatches = html.matchAll(/"thumbnail_src"\s*:\s*"(https:[^"]+)"/g);
  for (const m of thumbMatches) {
    const url = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (url.includes('scontent')) candidates.push({ url, priority: 2 });
  }

  // 3. OG image
  const ogImgM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogImgM) {
    const url = ogImgM[1].replace(/&amp;/g, '&');
    if (url.startsWith('http')) candidates.push({ url, priority: 3 });
  }

  // 4. Instagram CDN images from <img> tags (scontent URLs)
  const imgTagMatches = html.matchAll(/<img[^>]+src="(https:\/\/[^"]*scontent[^"]*)"/gi);
  for (const m of imgTagMatches) {
    const url = m[1].replace(/&amp;/g, '&');
    candidates.push({ url, priority: 4 });
  }

  // 5. EmbedImage class
  const embedImgM = html.match(/<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i);
  if (embedImgM) {
    candidates.push({ url: embedImgM[1].replace(/&amp;/g, '&'), priority: 2 });
  }

  // Filter out tiny images (profile pics, icons) — look for dimension hints
  const filtered = candidates.filter(c => {
    const url = c.url;
    // Skip profile pics
    if (/\/s\d{2,3}x\d{2,3}\//.test(url)) return false;  // e.g., /s150x150/
    if (/profile_pic/i.test(url)) return false;
    // Skip tracking/blank pixels
    if (url.includes('1x1') || url.includes('blank')) return false;
    return true;
  });

  // Sort by priority and return best
  filtered.sort((a, b) => a.priority - b.priority);
  return filtered.length > 0 ? filtered[0].url : '';
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitize fetched HTML for safe embedding via srcdoc.
 */
function sanitizeHtmlForEmbed(html, baseUrl) {
  let base = '';
  try { base = new URL(baseUrl).origin; } catch { /* ignore */ }

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?noscript[^>]*>/gi, '')
    .replace(
      /<head([^>]*)>/i,
      `<head$1>
        <base href="${base}/" target="_blank">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif !important; overflow-y: auto !important; }
          * { max-width: 100% !important; }
          img { height: auto !important; }
          /* Force-expand any truncated/hidden content */
          [style*="display: none"], [style*="display:none"],
          .hidden, [hidden] { display: block !important; visibility: visible !important; }
          /* Instagram-specific: expand truncated captions */
          .Caption, .EmbedCaption, [class*="Caption"] {
            max-height: none !important;
            overflow: visible !important;
            -webkit-line-clamp: unset !important;
          }
        </style>`
    );
}

/**
 * Extract visible text from iframe document.
 */
function extractVisibleTextFromDoc(doc) {
  const texts = [];
  const iframeWindow = doc.defaultView;

  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = node.textContent?.trim();
      if (text && text.length > 1) texts.push(text);
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
      try {
        const style = iframeWindow?.getComputedStyle?.(node);
        if (style?.display === 'none' || style?.visibility === 'hidden') return;
      } catch { /* include text anyway */ }
      for (const child of node.childNodes) walk(child);
    }
  };

  if (doc.body) walk(doc.body);
  return texts.join('\n');
}

/**
 * Extract image URLs from iframe document.
 * Prioritizes Instagram CDN images, filters out profile pics and tiny icons.
 */
function extractImageUrlsFromDoc(doc) {
  const candidates = [];
  const seen = new Set();

  // OG image first
  const ogImg = doc.querySelector('meta[property="og:image"]');
  if (ogImg?.content?.startsWith('http')) {
    candidates.push({ url: ogImg.content, priority: 3 });
    seen.add(ogImg.content);
  }

  // All img tags — score by likely relevance
  for (const img of doc.querySelectorAll('img')) {
    const src = img.src || img.getAttribute('data-src') || '';
    if (!src || !src.startsWith('http') || seen.has(src)) continue;
    seen.add(src);

    // Skip profile pics and tiny images
    if (/\/s\d{2,3}x\d{2,3}\//.test(src)) continue;
    if (/profile_pic/i.test(src)) continue;
    if (src.includes('1x1') || src.includes('blank')) continue;

    const isInstaCdn = src.includes('scontent') || src.includes('cdninstagram');
    // Check if image is large (likely content, not icon)
    const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
    const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
    const isLarge = (w > 200 || h > 200);

    if (isInstaCdn && isLarge) candidates.push({ url: src, priority: 1 });
    else if (isInstaCdn) candidates.push({ url: src, priority: 2 });
    else if (isLarge) candidates.push({ url: src, priority: 4 });
    else candidates.push({ url: src, priority: 5 });
  }

  // Background images
  try {
    const iframeWindow = doc.defaultView;
    for (const el of doc.querySelectorAll('[style*="background"]')) {
      const bg = iframeWindow?.getComputedStyle?.(el)?.backgroundImage || '';
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        candidates.push({ url: m[1], priority: 4 });
      }
    }
  } catch { /* ignore */ }

  // Sort by priority, return URLs only
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, 5).map(c => c.url);
}
