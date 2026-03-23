import { useState, useEffect, useRef, useCallback } from 'react';
import { extractRecipeFromDOM } from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl } from '../api';

/**
 * BrowserAssist — Interactive embedded view for Instagram/social media recipe extraction.
 *
 * Architecture:
 *   - Fetches the page HTML via CORS proxy (fetchHtmlViaProxy)
 *   - Writes it into an iframe using srcdoc (same-origin, so we CAN access contentDocument)
 *   - Injects a floating "Extract Recipe" button into the iframe DOM
 *   - User can scroll, tap "more" links (note: JS-driven "more" won't work since
 *     scripts are sandboxed, but static HTML "more" and pre-expanded content will)
 *   - On button click, extracts visible text + images from iframe DOM
 *   - Falls back to direct HTML parsing if interactive extraction fails
 *
 * Props:
 *   url                 - URL to show
 *   onRecipeExtracted   - callback(recipe) when extraction succeeds
 *   onFallbackToText    - callback() when user wants Paste Text instead
 */
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText }) {
  const [phase, setPhase] = useState('loading');   // 'loading' | 'ready' | 'extracting' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const iframeRef = useRef(null);
  const extractionRef = useRef(null); // store extraction handler for iframe button

  // ── Fetch the page HTML ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'loading') {
        setErrorMsg('Page took too long to load.');
        setPhase('error');
      }
    }, 20000); // 20s timeout

    (async () => {
      try {
        // Try the embed/captioned version first (lighter, often has caption visible)
        let embedUrl = url;
        const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (shortcodeMatch) {
          embedUrl = `https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`;
        }

        const html = await fetchHtmlViaProxy(embedUrl, 18000);

        if (cancelled) return;

        if (!html || html.length < 500) {
          // Try the original URL as fallback
          const fallbackHtml = await fetchHtmlViaProxy(url, 18000);
          if (cancelled) return;
          if (!fallbackHtml || fallbackHtml.length < 500) {
            setErrorMsg('Could not load the page. The site may be blocking access.');
            setPhase('error');
            return;
          }
          setHtmlContent(sanitizeHtmlForEmbed(fallbackHtml, url));
        } else {
          setHtmlContent(sanitizeHtmlForEmbed(html, embedUrl));
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[BrowserAssist] Fetch error:', err);
          setErrorMsg('Failed to load page: ' + err.message);
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [url]);

  // ── When HTML is ready, set phase to ready ──────────────────────────────────
  useEffect(() => {
    if (htmlContent) {
      setPhase('ready');
    }
  }, [htmlContent]);

  // ── After iframe renders with srcdoc, inject our extraction button ──────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc || !doc.body) return;

      // Remove any existing button (in case of re-injection)
      const existing = doc.getElementById('spicehub-extract-btn');
      if (existing) existing.remove();
      const existingHelper = doc.getElementById('spicehub-helper');
      if (existingHelper) existingHelper.remove();

      // Create floating "Extract Recipe" button
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
        // Call extraction handler on the React side via the ref
        if (extractionRef.current) extractionRef.current();
      });

      doc.body.appendChild(btn);

      // Helper text banner at top
      const helper = doc.createElement('div');
      helper.id = 'spicehub-helper';
      helper.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:rgba(0,0,0,0.85)', 'color:white', 'padding:10px 16px',
        'font-size:13px', 'font-family:system-ui,sans-serif',
        'text-align:center', 'line-height:1.4',
      ].join(';');
      helper.textContent = 'Scroll down to see the recipe. Tap the green button when ready.';
      doc.body.appendChild(helper);

      // Auto-dismiss the helper after 6 seconds
      setTimeout(() => {
        if (helper.parentNode) {
          helper.style.transition = 'opacity 0.5s';
          helper.style.opacity = '0';
          setTimeout(() => helper.remove(), 500);
        }
      }, 6000);

    } catch (err) {
      console.warn('[BrowserAssist] Could not inject into iframe:', err);
    }
  }, []);

  // ── Extraction handler (called when user clicks the green button) ───────────
  const handleExtraction = useCallback(() => {
    setPhase('extracting');

    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) {
        throw new Error('Cannot read page content');
      }

      // Extract all visible text from iframe DOM
      const visibleText = extractVisibleTextFromDoc(doc);

      // Extract image URLs
      const imageUrls = extractImageUrlsFromDoc(doc);

      // Try structured extraction first
      const recipe = extractRecipeFromDOM(visibleText, imageUrls);

      if (recipe) {
        // Set the source URL
        recipe.link = url;
        onRecipeExtracted(recipe);
        return;
      }

      // If extractRecipeFromDOM returned null, update the button in iframe
      try {
        const btn = doc.getElementById('spicehub-extract-btn');
        if (btn) {
          btn.textContent = '\u274C No recipe found \u2014 scroll down & try again';
          btn.style.background = '#f44336';
          setTimeout(() => {
            if (btn.parentNode) {
              btn.textContent = '\u{1F4E5} Extract Recipe';
              btn.style.background = '#4CAF50';
            }
          }, 3000);
        }
      } catch { /* iframe may have navigated */ }

      setPhase('ready');

    } catch (err) {
      console.error('[BrowserAssist] Extraction error:', err);
      setErrorMsg('Could not read page content. Try "Use Paste Text Instead".');
      setPhase('error');
    }
  }, [url, onRecipeExtracted]);

  // Keep extractionRef in sync so the iframe button click can call it
  useEffect(() => {
    extractionRef.current = handleExtraction;
  }, [handleExtraction]);

  // ── Also provide an "Extract" button outside the iframe ─────────────────────
  // (in case injection fails or user prefers the outer button)

  return (
    <div className="browser-assist-container">
      {/* Loading */}
      {phase === 'loading' && (
        <div className="browser-assist-loading">
          <div className="browser-spinner large" />
          <p>Loading Instagram post…</p>
          <button
            className="btn-secondary"
            onClick={onFallbackToText}
            style={{ marginTop: 12 }}
          >
            Skip — Use Paste Text Instead
          </button>
        </div>
      )}

      {/* Ready — show iframe + controls */}
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
            <button
              className="btn-primary"
              onClick={handleExtraction}
              disabled={phase === 'extracting'}
            >
              {phase === 'extracting' ? (
                <><span className="browser-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Analyzing…</>
              ) : (
                '\u{1F4E5} Extract Recipe'
              )}
            </button>
            <button
              className="btn-secondary"
              onClick={onFallbackToText}
              disabled={phase === 'extracting'}
            >
              Paste Text Instead
            </button>
          </div>
        </div>
      )}

      {/* Error */}
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

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Sanitize fetched HTML for safe embedding via srcdoc:
 *   - Strip <script> tags (prevent arbitrary JS execution)
 *   - Rewrite relative image/link URLs to absolute
 *   - Add base tag for remaining relative references
 *   - Inject minimal viewport meta for mobile rendering
 */
function sanitizeHtmlForEmbed(html, baseUrl) {
  let base = '';
  try {
    const u = new URL(baseUrl);
    base = u.origin;
  } catch { /* keep empty */ }

  return html
    // Remove all script tags (security + performance)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Remove noscript tags (show their content since JS is disabled)
    .replace(/<\/?noscript[^>]*>/gi, '')
    // Add base tag for relative URLs and viewport meta
    .replace(
      /<head([^>]*)>/i,
      `<head$1>
        <base href="${base}/" target="_blank">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif !important; }
          /* Make sure content is visible and scrollable */
          * { max-width: 100% !important; }
          img { height: auto !important; }
          /* Expand any truncated text by default */
          [style*="display: none"], [style*="display:none"],
          .hidden, [hidden] { display: block !important; visibility: visible !important; }
        </style>`
    );
}

/**
 * Walk the iframe DOM and extract all visible text.
 * Uses the iframe's own window for getComputedStyle (not the parent window).
 */
function extractVisibleTextFromDoc(doc) {
  const texts = [];
  const iframeWindow = doc.defaultView;

  const walk = (node) => {
    if (node.nodeType === 3) { // Text node
      const text = node.textContent?.trim();
      if (text && text.length > 1) {
        texts.push(text);
      }
    } else if (node.nodeType === 1) { // Element node
      const tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

      // Check visibility using the iframe's window, not parent
      try {
        const style = iframeWindow?.getComputedStyle?.(node);
        if (style?.display === 'none' || style?.visibility === 'hidden') return;
      } catch { /* cross-origin or unavailable — include the text anyway */ }

      for (const child of node.childNodes) {
        walk(child);
      }
    }
  };

  if (doc.body) walk(doc.body);
  return texts.join('\n');
}

/**
 * Extract image URLs from iframe document.
 * Prioritizes larger images and Instagram CDN images.
 */
function extractImageUrlsFromDoc(doc) {
  const urls = [];
  const seen = new Set();

  // Check og:image meta first (most reliable for the "hero" image)
  const ogImg = doc.querySelector('meta[property="og:image"]');
  if (ogImg?.content && ogImg.content.startsWith('http')) {
    urls.push(ogImg.content);
    seen.add(ogImg.content);
  }

  // Then all img tags
  for (const img of doc.querySelectorAll('img')) {
    const src = img.src || img.getAttribute('data-src') || '';
    if (!src || !src.startsWith('http') || seen.has(src)) continue;
    seen.add(src);

    // Prioritize Instagram CDN images (scontent) and larger images
    const isInstaCdn = src.includes('scontent') || src.includes('cdninstagram');
    const width = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);

    if (isInstaCdn || width > 200) {
      urls.unshift(src); // Front of list
    } else {
      urls.push(src);
    }
  }

  // Also check background-image CSS on key elements
  try {
    const iframeWindow = doc.defaultView;
    for (const el of doc.querySelectorAll('[style*="background"]')) {
      const style = iframeWindow?.getComputedStyle?.(el);
      const bg = style?.backgroundImage || '';
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        urls.push(m[1]);
      }
    }
  } catch { /* ignore */ }

  return urls.slice(0, 5);
}
