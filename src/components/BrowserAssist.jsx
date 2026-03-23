import { useState, useEffect, useRef } from 'react';
import { extractRecipeFromDOM, isInstagramUrl } from '../recipeParser';
import { fetchHtmlViaProxy } from '../api';

/**
 * BrowserAssist — Interactive iframe for Instagram/social media recipe extraction
 *
 * Flow:
 *   1. Show iframe with Instagram post (via CORS proxy)
 *   2. User taps "more" links, scrolls, expands content
 *   3. User clicks floating "Extract Recipe" button
 *   4. Extraction script analyzes visible DOM, extracts text + images
 *   5. Returns recipe or null to parent via onRecipeExtracted callback
 *
 * Props:
 *   url                 - URL to display in iframe
 *   onRecipeExtracted   - callback(recipe) when extraction succeeds or fails
 *   onFallbackToText    - callback() when user wants to use Paste Text instead
 */
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText }) {
  const [phase, setPhase] = useState('loading');     // 'loading' | 'ready' | 'extracting' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const iframeRef = useRef(null);

  // Load iframe content
  useEffect(() => {
    const loadIframe = async () => {
      try {
        // Fetch the page via CORS proxy to embed as iframe
        // We'll inject it as HTML content rather than setting src
        // This avoids X-Frame-Options restrictions
        setPhase('loading');

        // For Instagram, we can try embedding directly, but CSP may block
        // Instead, we'll show the iframe with src pointing to CORS proxy
        // and inject our extraction script

        if (iframeRef.current) {
          // Set iframe src to CORS proxy version of URL
          const corsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          iframeRef.current.src = corsUrl;

          // Set phase to ready after iframe loads
          iframeRef.current.onload = () => {
            injectExtractionScript();
            setPhase('ready');
          };

          iframeRef.current.onerror = () => {
            // If iframe fails to load, fall back to text
            setErrorMsg('Could not load the page. Try "Use Paste Text instead" below.');
            setPhase('error');
          };
        }
      } catch (err) {
        console.error('[BrowserAssist] Load error:', err);
        setErrorMsg('Failed to load browser assist. Try "Use Paste Text instead" below.');
        setPhase('error');
      }
    };

    loadIframe();
  }, [url]);

  // Inject extraction script into iframe
  const injectExtractionScript = () => {
    if (!iframeRef.current || !iframeRef.current.contentDocument) return;

    try {
      const doc = iframeRef.current.contentDocument;

      // Create floating button
      const button = doc.createElement('button');
      button.innerHTML = '📥 Extract Recipe';
      button.id = 'spicehub-extract-btn';
      button.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        padding: 12px 16px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      button.onmouseover = () => {
        button.style.background = '#45a049';
        button.style.transform = 'scale(1.05)';
      };
      button.onmouseout = () => {
        button.style.background = '#4CAF50';
        button.style.transform = 'scale(1)';
      };

      // Button click handler
      button.onclick = async (e) => {
        e.stopPropagation();
        await handleExtraction();
      };

      doc.body.appendChild(button);

      // Helper text
      const helper = doc.createElement('div');
      helper.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 2147483647;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 200px;
        text-align: center;
        line-height: 1.3;
      `;
      helper.innerHTML = 'Tap "more" to expand content, then click the green button ↙';
      doc.body.appendChild(helper);
    } catch (err) {
      console.warn('[BrowserAssist] Could not inject extraction script:', err);
    }
  };

  // Extract recipe from iframe DOM
  const handleExtraction = async () => {
    try {
      setPhase('extracting');

      if (!iframeRef.current || !iframeRef.current.contentDocument) {
        throw new Error('Cannot access iframe content');
      }

      const doc = iframeRef.current.contentDocument;

      // Extract all visible text
      const visibleText = extractVisibleText(doc.body);

      // Extract all image URLs
      const imageUrls = extractImageUrls(doc);

      // Use extractRecipeFromDOM to parse
      const recipe = extractRecipeFromDOM(visibleText, imageUrls);

      if (recipe) {
        setPhase('success');
        setTimeout(() => {
          onRecipeExtracted(recipe);
        }, 300);
      } else {
        // No recipe found
        const btn = doc.getElementById('spicehub-extract-btn');
        if (btn) {
          btn.innerHTML = '❌ No recipe found — try expanding more content';
          btn.style.background = '#f44336';
          setTimeout(() => {
            btn.innerHTML = '📥 Extract Recipe';
            btn.style.background = '#4CAF50';
          }, 3000);
        }
        setPhase('ready');
      }
    } catch (err) {
      console.error('[BrowserAssist] Extraction error:', err);
      setErrorMsg('Extraction failed: ' + err.message);
      setPhase('error');
    }
  };

  // Extract visible text from DOM (skip hidden elements)
  const extractVisibleText = (element) => {
    const texts = [];

    const walk = (node) => {
      if (node.nodeType === 3) { // Text node
        const text = node.textContent?.trim();
        if (text && text.length > 1) {
          texts.push(text);
        }
      } else if (node.nodeType === 1) { // Element node
        // Skip script, style, hidden elements
        const style = window.getComputedStyle?.(node);
        if (
          node.tagName.toLowerCase() !== 'script' &&
          node.tagName.toLowerCase() !== 'style' &&
          style?.display !== 'none' &&
          style?.visibility !== 'hidden'
        ) {
          for (let child of node.childNodes) {
            walk(child);
          }
        }
      }
    };

    walk(element);
    return texts.join('\n');
  };

  // Extract image URLs from DOM
  const extractImageUrls = (doc) => {
    const urls = [];
    const images = doc.querySelectorAll('img');

    for (const img of images) {
      if (img.src && img.src.startsWith('http')) {
        // Prefer images that look like food/recipe images (heuristic)
        const alt = img.alt?.toLowerCase() || '';
        const src = img.src.toLowerCase();

        // Give priority to images that look like recipe/food images
        if (alt.includes('recipe') || alt.includes('food') || alt.includes('dish') ||
            src.includes('recipe') || src.includes('food') || src.includes('image')) {
          urls.unshift(img.src); // Add to front
        } else {
          urls.push(img.src);
        }
      }
    }

    return urls.slice(0, 3); // Limit to 3 images
  };

  // Render based on phase
  return (
    <div className="browser-assist-container">
      {phase === 'loading' && (
        <div className="browser-assist-loading">
          <div className="browser-spinner large"></div>
          <p>Loading page…</p>
        </div>
      )}

      {phase === 'ready' && (
        <div className="browser-assist-ready">
          <p className="browser-assist-hint">
            👆 Tap "more" links to expand text, then click the green button to extract the recipe.
          </p>
          <div className="browser-assist-iframe-container">
            <iframe
              ref={iframeRef}
              title="Instagram Post"
              className="browser-assist-iframe"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          </div>
          <div className="browser-assist-actions">
            <button
              className="btn-secondary"
              onClick={onFallbackToText}
              disabled={phase === 'extracting'}
            >
              Use Paste Text Instead
            </button>
          </div>
        </div>
      )}

      {phase === 'extracting' && (
        <div className="browser-assist-loading">
          <div className="browser-spinner large"></div>
          <p>Analyzing page…</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="browser-assist-error">
          <p className="error-text">❌ {errorMsg}</p>
          <button
            className="btn-primary"
            onClick={onFallbackToText}
          >
            Use Paste Text Instead
          </button>
        </div>
      )}
    </div>
  );
}
