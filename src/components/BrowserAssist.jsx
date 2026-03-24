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
  const iframeRef = useRef(null);
  const extractionRef = useRef(null);

  // ── Fetch the page HTML ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'loading') {
        setErrorMsg('Page took too long to load.');
        setPhase('error');
      }
    }, 20000);

    (async () => {
      try {
        // Build the embed/captioned URL (has more caption text visible)
        const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        const embedUrl = shortcodeMatch
          ? `https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`
          : url;

        let html = await fetchHtmlViaProxy(embedUrl, 18000);
        if (cancelled) return;

        // Fallback to the original URL if embed didn't work
        if (!html || html.length < 500) {
          html = await fetchHtmlViaProxy(url, 18000);
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
          <p>Loading Instagram post…</p>
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

/**
 * Check if a recipe has real content (not just placeholders).
 */
function hasRealContent(recipe) {
  if (!recipe) return false;
  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];
  // Reject if only placeholder text
  const placeholders = /^(see (original|recipe)|no (ingredients|directions))/i;
  const realIngs = ings.filter(i => i.length > 3 && !placeholders.test(i));
  const realDirs = dirs.filter(d => d.length > 3 && !placeholders.test(d));
  return realIngs.length >= 2 || realDirs.length >= 2;
}

/**
 * Pick the recipe with more actual content.
 */
function pickBestRecipe(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const scoreA = (a.ingredients?.length || 0) + (a.directions?.length || 0);
  const scoreB = (b.ingredients?.length || 0) + (b.directions?.length || 0);
  return scoreA >= scoreB ? a : b;
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

  // ── Parse caption into recipe ──
  const parsed = parseCaption(caption);
  if (!parsed) return null;

  // ── Extract image ──
  let imageUrl = '';
  const ogImgM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogImgM) imageUrl = ogImgM[1].replace(/&amp;/g, '&');

  if (!imageUrl) {
    const imgPatterns = [
      /<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i,
      /<img[^>]+src="(https:\/\/[^"]*scontent[^"]*)"/i,
      /"display_url"\s*:\s*"(https:[^"]+)"/i,
      /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
    ];
    for (const re of imgPatterns) {
      const m = re.exec(html);
      if (m) {
        imageUrl = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
        if (imageUrl.startsWith('http')) break;
        imageUrl = '';
      }
    }
  }

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
  if (!name) name = 'Instagram Recipe';

  return {
    name,
    ingredients: parsed.ingredients.length ? parsed.ingredients : [],
    directions: parsed.directions.length ? parsed.directions : [],
    imageUrl,
    link: sourceUrl,
  };
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
 */
function extractImageUrlsFromDoc(doc) {
  const urls = [];
  const seen = new Set();

  // OG image first
  const ogImg = doc.querySelector('meta[property="og:image"]');
  if (ogImg?.content?.startsWith('http')) {
    urls.push(ogImg.content);
    seen.add(ogImg.content);
  }

  // All img tags
  for (const img of doc.querySelectorAll('img')) {
    const src = img.src || img.getAttribute('data-src') || '';
    if (!src || !src.startsWith('http') || seen.has(src)) continue;
    seen.add(src);
    const isInstaCdn = src.includes('scontent') || src.includes('cdninstagram');
    if (isInstaCdn) urls.unshift(src);
    else urls.push(src);
  }

  // Background images
  try {
    const iframeWindow = doc.defaultView;
    for (const el of doc.querySelectorAll('[style*="background"]')) {
      const bg = iframeWindow?.getComputedStyle?.(el)?.backgroundImage || '';
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
      if (m && !seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
    }
  } catch { /* ignore */ }

  return urls.slice(0, 5);
}
