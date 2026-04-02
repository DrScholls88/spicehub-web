import { useState, useEffect, useRef, useCallback } from 'react';
import { extractRecipeFromDOM, parseCaption, extractWithBrowserAPI, detectRecipePlugins, isSocialMediaUrl, tryVideoExtraction, scoreExtractionConfidence } from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl } from '../api';
import { queueRecipeImport } from '../db';
import useOnlineStatus from '../hooks/useOnlineStatus';

/**
 * BrowserAssist — Enhanced interactive embedded view for recipe extraction.
 *
 * Strategy (fully automatic, iframe as last resort):
 *   1. If ONLINE: Fetch the page HTML via CORS proxy
 *   2. Run extractWithBrowserAPI() — tries plugin detection, caption parsing, smart classification
 *   3. Also try regex extraction on raw HTML (caption, image, title)
 *   4. If auto-extraction finds a recipe → show editable preview (no iframe needed)
 *   5. If auto-extraction fails → show iframe with manual "Extract Recipe" button
 *   6. User scrolls, reads the content, clicks "Extract Recipe"
 *   7. If OFFLINE: Show message and offer manual paste (can still add to queue)
 *   8. Fallback: "Paste Text Instead" switches to manual paste tab
 *
 * Props:
 *   url                 - Page URL (Instagram or any recipe URL)
 *   onRecipeExtracted   - callback(recipe) on success
 *   onFallbackToText    - callback() when user wants Paste Text
 */
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText }) {
  const { isOnline } = useOnlineStatus();
  const [phase, setPhase] = useState('loading');     // 'loading' | 'preview' | 'iframe' | 'extracting' | 'error' | 'offline' | 'queued'
  const [errorMsg, setErrorMsg] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [rawHtml, setRawHtml] = useState('');
  const [autoRecipe, setAutoRecipe] = useState(null); // auto-extracted recipe for preview
  const [loadingDots, setLoadingDots] = useState('');
  const [queuedRecipe, setQueuedRecipe] = useState(null); // offline queued recipe
  const [iframeZoom, setIframeZoom] = useState(70); // zoom level percentage — zoomed out more for mobile readability
  const [extractionProgress, setExtractionProgress] = useState({ step: 0, total: 0, message: '' });
  const iframeRef = useRef(null);
  const extractionRef = useRef(null);

  // ── Pulsing loading text animation ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'loading') return;
    let dots = 0;
    const interval = setInterval(() => {
      dots = (dots + 1) % 4;
      const msg = extractionProgress.message || 'Fetching page content';
      setLoadingDots(msg + '.'.repeat(dots + 1));
    }, 500);
    return () => clearInterval(interval);
  }, [phase, extractionProgress.message]);

  // ── Pinch-to-zoom support for mobile ─────────────────────────────────────
  useEffect(() => {
    const container = document.querySelector('.browser-assist-iframe-container');
    if (!container) return;

    let lastDistance = 0;

    const handleTouchMove = (e) => {
      if (e.touches.length !== 2) return;

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );

      // Only prevent default scroll if actually pinch-zooming
      if (lastDistance > 0 && Math.abs(distance - lastDistance) > 5) {
        e.preventDefault();
      }

      if (lastDistance > 0) {
        const scale = distance / lastDistance;
        const newZoom = Math.round(Math.max(50, Math.min(200, iframeZoom * scale)));
        if (newZoom !== iframeZoom) {
          setIframeZoom(newZoom);
        }
      }
      lastDistance = distance;
    };

    const handleTouchEnd = () => {
      lastDistance = 0;
    };

    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [iframeZoom]);

  // ── Fetch and auto-extract ─────────────────────────────────────────────────
  useEffect(() => {
    // Check offline status immediately
    if (!isOnline) {
      setErrorMsg('You are offline. You can still paste recipe text manually.');
      setPhase('offline');
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'loading') {
        setErrorMsg('Page took too long to load. The site may be blocking the request.');
        setPhase('error');
      }
    }, 45000);

    (async () => {
      try {
        // ── NEW: Try dedicated video extraction endpoint first for social/video URLs ──
        // This is faster than HTML fetch + parsing for platforms yt-dlp supports
        setExtractionProgress({ step: 1, total: 3, message: 'Checking for video subtitles' });
        if (isSocialMediaUrl(url)) {
          try {
            const videoResult = await tryVideoExtraction(url);
            if (!cancelled && videoResult && !videoResult._error) {
              // If we got real ingredients (not just "See original post"), use it
              if (videoResult.ingredients?.[0] !== 'See original post for ingredients') {
                setAutoRecipe({
                  name: videoResult.name || 'Imported Recipe',
                  ingredients: videoResult.ingredients || [],
                  directions: videoResult.directions || [],
                  imageUrl: videoResult.imageUrl || '',
                  link: videoResult.link || url,
                });
                setPhase('preview');
                return;
              }
              // Partial result — continue to HTML extraction but keep video data as fallback
            }
          } catch {
            // Video endpoint not available or failed — continue to HTML extraction
            console.log('[BrowserAssist] Video extraction unavailable, falling back to HTML fetch');
          }
          if (cancelled) return;
        }

        setExtractionProgress({ step: 2, total: 3, message: 'Fetching page content' });

        // Build URL variants to try
        const urls = [url];
        const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (shortcodeMatch) {
          // Instagram: try embed/captioned first (more text visible)
          urls.unshift(`https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`);
        }

        let html = null;
        for (const tryUrl of urls) {
          try {
            const fetched = await fetchHtmlViaProxy(tryUrl, 40000);
            if (fetched && fetched.length > 500) { html = fetched; break; }
          } catch { /* try next */ }
          if (cancelled) return;
        }

        if (!html || html.length < 500) {
          if (!cancelled) {
            setErrorMsg('Could not load the page. Go back and try another method.');
            setPhase('error');
          }
          return;
        }

        // Store raw HTML
        setRawHtml(html);

        setExtractionProgress({ step: 3, total: 3, message: 'Analyzing recipe content' });

        // ── AUTO-EXTRACTION PIPELINE ──

        // Pass 1: extractWithBrowserAPI — plugin detection + caption parsing + smart classification
        const browserApiResult = extractWithBrowserAPI({
          html,
          visibleText: stripHtmlToText(html),
          imageUrls: extractImageUrlsFromHtml(html),
          sourceUrl: url,
        });

        if (browserApiResult && hasRealContent(browserApiResult)) {
          if (!cancelled) {
            setAutoRecipe(cleanRecipe(browserApiResult));
            setPhase('preview');
          }
          return;
        }

        // Pass 2: Regex extraction on raw HTML (Instagram-specific patterns)
        const regexRecipe = extractFromRawHtml(html, url);
        if (regexRecipe && hasRealContent(regexRecipe)) {
          if (!cancelled) {
            setAutoRecipe(cleanRecipe(regexRecipe));
            setPhase('preview');
          }
          return;
        }

        // Pass 3: Try merging partial results from both attempts
        if (!cancelled) {
          const merged = pickBestRecipe(browserApiResult, regexRecipe);
          if (merged && (merged.ingredients?.length > 0 || merged.directions?.length > 0)) {
            // We have partial data — show it as a low-confidence preview instead of iframe
            const cleaned = cleanRecipe(merged);
            if (cleaned.ingredients?.length > 0 || cleaned.directions?.length > 0) {
              setAutoRecipe({ ...cleaned, extractedVia: 'partial-merge' });
              setPhase('preview');
              return;
            }
          }
          // Fall back to iframe view
          setHtmlContent(sanitizeHtmlForEmbed(html, url));
          setPhase('iframe');
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
  }, [url, isOnline]);

  // ── After iframe renders, inject extraction button ───────────────────────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc || !doc.body) return;

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
      helper.textContent = 'Auto-extraction couldn\'t find the recipe. Scroll to see the full content, then tap the green button.';
      doc.body.appendChild(helper);

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

  // ── Manual extraction from iframe DOM ──────────────────────────────────────
  const handleExtraction = useCallback(() => {
    setPhase('extracting');
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) throw new Error('Cannot read page content');

      // Extract visible text from iframe
      const visibleText = extractVisibleTextFromDoc(doc);
      const imageUrls = extractImageUrlsFromDoc(doc);

      // Try extractWithBrowserAPI on iframe content
      const fullHtml = doc.documentElement?.outerHTML || '';
      const browserApiResult = extractWithBrowserAPI({
        html: fullHtml,
        visibleText,
        imageUrls,
        sourceUrl: url,
      });

      if (browserApiResult && hasRealContent(browserApiResult)) {
        onRecipeExtracted(cleanRecipe(browserApiResult));
        return;
      }

      // Also try regex on raw HTML
      const regexRecipe = rawHtml ? extractFromRawHtml(rawHtml, url) : null;

      // Try DOM-based extraction
      const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);

      // Pick the best result
      const recipe = pickBestRecipe(regexRecipe, domRecipe);

      if (recipe && hasRealContent(recipe)) {
        onRecipeExtracted(cleanRecipe(recipe));
        return;
      }

      // No recipe found
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

      setPhase('iframe');
    } catch (err) {
      console.error('[BrowserAssist] Extraction error:', err);
      setErrorMsg('Could not read page content. Go back and try another method.');
      setPhase('error');
    }
  }, [url, rawHtml, onRecipeExtracted]);

  // Keep extractionRef in sync
  useEffect(() => { extractionRef.current = handleExtraction; }, [handleExtraction]);

  // ── Accept auto-extracted recipe from preview ──────────────────────────────
  const handleAcceptPreview = useCallback(() => {
    if (autoRecipe) {
      onRecipeExtracted(autoRecipe);
    }
  }, [autoRecipe, onRecipeExtracted]);

  // ── Switch from preview to iframe for manual extraction ────────────────────
  const handleTryManual = useCallback(() => {
    if (rawHtml) {
      setHtmlContent(sanitizeHtmlForEmbed(rawHtml, url));
      setPhase('iframe');
    } else {
      onFallbackToText();
    }
  }, [rawHtml, url, onFallbackToText]);

  // ── Update a field in the auto-extracted recipe preview ────────────────────
  const updatePreviewField = useCallback((field, value) => {
    setAutoRecipe(prev => prev ? { ...prev, [field]: value } : prev);
  }, []);

  const updatePreviewListItem = useCallback((field, index, value) => {
    setAutoRecipe(prev => {
      if (!prev) return prev;
      const list = [...(prev[field] || [])];
      list[index] = value;
      return { ...prev, [field]: list };
    });
  }, []);

  const removePreviewListItem = useCallback((field, index) => {
    setAutoRecipe(prev => {
      if (!prev) return prev;
      const list = [...(prev[field] || [])];
      list.splice(index, 1);
      return { ...prev, [field]: list };
    });
  }, []);

  const addPreviewListItem = useCallback((field) => {
    setAutoRecipe(prev => {
      if (!prev) return prev;
      return { ...prev, [field]: [...(prev[field] || []), ''] };
    });
  }, []);

  // ── Queue recipe for offline import ────────────────────────────────────────
  const handleQueueOfflineRecipe = useCallback(async (recipe) => {
    try {
      const result = await queueRecipeImport(url, recipe);
      if (result.isDuplicate) {
        setErrorMsg('Recipe with this name already exists. Not queuing.');
        setPhase('error');
      } else {
        setQueuedRecipe(recipe);
        setPhase('queued');
        // Auto-close after 3 seconds
        setTimeout(() => {
          if (onRecipeExtracted) {
            onRecipeExtracted(recipe);
          }
        }, 2500);
      }
    } catch (err) {
      console.error('[BrowserAssist] Queue error:', err);
      setErrorMsg('Failed to queue recipe: ' + err.message);
      setPhase('error');
    }
  }, [url, onRecipeExtracted]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="browser-assist-container">
      {/* ── Offline state ── */}
      {phase === 'offline' && (
        <div className="browser-assist-offline">
          <div className="offline-icon">🔌</div>
          <h3>Offline Mode</h3>
          <p>Cannot fetch recipe from the web while offline.</p>
          <p className="offline-help-text">
            Go back and use "Paste Text" to manually add recipe content. It will be saved locally and imported when you're back online.
          </p>
          <button className="btn-primary" onClick={onFallbackToText}>
            ← Back to Import
          </button>
        </div>
      )}

      {/* ── Queued for offline import ── */}
      {phase === 'queued' && queuedRecipe && (
        <div className="browser-assist-queued">
          <div className="queued-icon">⏱️</div>
          <h3>Recipe Queued</h3>
          <p><strong>{queuedRecipe.name}</strong> will be imported when you're back online.</p>
          <p className="queued-help-text">
            You can view the import queue in Settings → Queued Imports
          </p>
          <button className="btn-primary" onClick={() => onRecipeExtracted && onRecipeExtracted(queuedRecipe)}>
            Close
          </button>
        </div>
      )}

      {/* ── Loading state ── */}
      {isOnline && phase === 'loading' && (
        <div className="browser-assist-loading">
          <div className="browser-spinner large" />
          {extractionProgress.total > 0 && (
            <div className="extraction-progress-stepper">
              {Array.from({ length: extractionProgress.total }, (_, i) => (
                <div key={i} className={`progress-step ${i + 1 < extractionProgress.step ? 'done' : i + 1 === extractionProgress.step ? 'active' : ''}`}>
                  <div className="step-dot" />
                  {i < extractionProgress.total - 1 && <div className="step-line" />}
                </div>
              ))}
            </div>
          )}
          <p className="browser-assist-pulse-text">{loadingDots || 'Fetching page content...'}</p>
          <button className="btn-secondary" onClick={onFallbackToText} style={{ marginTop: 12 }}>
            Skip — Enter Manually
          </button>
        </div>
      )}

      {/* ── Auto-extracted preview (editable) ── */}
      {phase === 'preview' && autoRecipe && (
        <div className="browser-assist-preview">
          <div className="browser-assist-preview-header">
            <span className="browser-assist-success-icon">&#10003;</span>
            <span>Recipe found automatically{autoRecipe.extractedVia ? ` (${autoRecipe.extractedVia})` : ''}</span>
            {(() => {
              const conf = scoreExtractionConfidence(autoRecipe);
              const level = conf >= 70 ? 'high' : conf >= 40 ? 'medium' : 'low';
              return (
                <span className={`confidence-badge confidence-${level}`}>
                  {conf >= 70 ? 'High' : conf >= 40 ? 'Good' : 'Low'} confidence
                </span>
              );
            })()}
          </div>

          <div className="browser-assist-preview-card">
            {/* Image + Title header */}
            <div className="preview-detail-header">
              {autoRecipe.imageUrl ? (
                <img
                  src={autoRecipe.imageUrl}
                  alt=""
                  className="preview-detail-thumb"
                  onError={e => {
                    const attempt = parseInt(e.target.dataset.proxied || '0');
                    const proxies = [
                      `https://api.allorigins.win/raw?url=${encodeURIComponent(autoRecipe.imageUrl)}`,
                      `https://corsproxy.io/?${encodeURIComponent(autoRecipe.imageUrl)}`,
                      `https://images.weserv.nl/?url=${encodeURIComponent(autoRecipe.imageUrl)}&default=placeholder`,
                    ];
                    if (attempt < proxies.length) {
                      e.target.dataset.proxied = String(attempt + 1);
                      e.target.src = proxies[attempt];
                    } else {
                      e.target.style.display = 'none';
                    }
                  }}
                />
              ) : null}
              <div className="preview-detail-title-zone">
                <label className="preview-label">Recipe Name</label>
                <input
                  type="text"
                  className="preview-title-input"
                  value={autoRecipe.name || ''}
                  onChange={e => updatePreviewField('name', e.target.value)}
                />
              </div>
            </div>

            {/* Ingredients */}
            <div className="preview-detail-section">
              <label className="preview-label">
                Ingredients ({autoRecipe.ingredients?.length || 0})
                <button className="preview-add-btn" onClick={() => addPreviewListItem('ingredients')}>+ Add</button>
              </label>
              <div className="preview-editable-list">
                {(autoRecipe.ingredients || []).map((ing, i) => (
                  <div key={i} className="preview-editable-row">
                    <input
                      type="text"
                      value={ing}
                      placeholder="e.g. 2 cups flour"
                      onChange={e => updatePreviewListItem('ingredients', i, e.target.value)}
                    />
                    <button
                      className="preview-remove-btn"
                      onClick={() => removePreviewListItem('ingredients', i)}
                      title="Remove"
                    >&#10005;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Directions */}
            <div className="preview-detail-section">
              <label className="preview-label">
                Steps ({autoRecipe.directions?.length || 0})
                <button className="preview-add-btn" onClick={() => addPreviewListItem('directions')}>+ Add</button>
              </label>
              <div className="preview-editable-list">
                {(autoRecipe.directions || []).map((step, i) => (
                  <div key={i} className="preview-editable-row preview-step-row">
                    <span className="preview-step-num">{i + 1}</span>
                    <textarea
                      value={step}
                      placeholder="Describe this step..."
                      rows={2}
                      onChange={e => updatePreviewListItem('directions', i, e.target.value)}
                    />
                    <button
                      className="preview-remove-btn"
                      onClick={() => removePreviewListItem('directions', i)}
                      title="Remove"
                    >&#10005;</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="browser-assist-preview-actions">
            <button className="btn-primary" onClick={handleAcceptPreview}>
              Use This Recipe
            </button>
            <button className="btn-secondary" onClick={handleTryManual}>
              Not right? Try manual extraction
            </button>
          </div>
        </div>
      )}

      {/* ── Iframe fallback (manual extraction) ── */}
      {(phase === 'iframe' || phase === 'extracting') && (
        <div className="browser-assist-ready">
          <div className="browser-assist-fallback-banner">
            <span className="fallback-banner-icon">👆</span>
            <div>
              <strong>Scroll the page below</strong>
              <p>Find the recipe content, then tap the green Extract button. Pinch to zoom.</p>
            </div>
          </div>
          <div className="browser-assist-zoom-controls">
            <button
              className="browser-assist-zoom-btn"
              onClick={() => setIframeZoom(Math.max(40, iframeZoom - 10))}
              title="Zoom out"
              disabled={iframeZoom <= 40}
            >
              −
            </button>
            <span className="browser-assist-zoom-display">{iframeZoom}%</span>
            <button
              className="browser-assist-zoom-btn"
              onClick={() => setIframeZoom(Math.min(200, iframeZoom + 10))}
              title="Zoom in"
              disabled={iframeZoom >= 200}
            >
              +
            </button>
            <button
              className="browser-assist-zoom-btn"
              onClick={() => setIframeZoom(100)}
              title="Reset zoom"
            >
              1:1
            </button>
          </div>
          <div className="browser-assist-iframe-container">
            <div style={{ transform: `scale(${iframeZoom / 100})`, transformOrigin: 'top left', width: `${10000 / iframeZoom}%`, transition: 'transform 0.15s ease-out, width 0.15s ease-out', willChange: 'transform' }}>
              <iframe
                ref={iframeRef}
                title="Recipe Page"
                className="browser-assist-iframe"
                srcDoc={htmlContent}
                sandbox="allow-same-origin"
                onLoad={handleIframeLoad}
              />
            </div>
          </div>
          <div className="browser-assist-actions">
            <button className="btn-primary browser-assist-extract-btn" onClick={handleExtraction} disabled={phase === 'extracting'}>
              {phase === 'extracting'
                ? '\u23F3 Analyzing…'
                : '\u{1F4E5} Extract Recipe'}
            </button>
            <button className="btn-secondary" onClick={onFallbackToText} disabled={phase === 'extracting'}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {phase === 'error' && (
        <div className="browser-assist-error">
          <p className="error-text">{errorMsg}</p>
          <button className="btn-primary" onClick={onFallbackToText}>
            ← Back to Import
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

function isPlaceholderLine(line) {
  if (!line || typeof line !== 'string') return true;
  const trimmed = line.trim();
  if (trimmed.length < 2) return true;
  return PLACEHOLDER_PATTERNS.some(re => re.test(trimmed));
}

function isPlaceholderTitle(title) {
  if (!title || typeof title !== 'string') return true;
  return PLACEHOLDER_TITLE_PATTERNS.some(re => re.test(title.trim()));
}

/**
 * Check if a recipe has real content (not just placeholders).
 */
function hasRealContent(recipe) {
  if (!recipe) return false;
  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];
  const realIngs = ings.filter(i => !isPlaceholderLine(i));
  const realDirs = dirs.filter(d => !isPlaceholderLine(d));
  // Accept if we have at least 1 real ingredient OR 2 real directions
  if (realIngs.length < 1 && realDirs.length < 2) return false;
  if (isPlaceholderTitle(recipe.name) && realIngs.length < 2 && realDirs.length < 2) return false;
  return true;
}

function pickBestRecipe(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const realA = (a.ingredients?.filter(i => !isPlaceholderLine(i))?.length || 0)
    + (a.directions?.filter(d => !isPlaceholderLine(d))?.length || 0);
  const realB = (b.ingredients?.filter(i => !isPlaceholderLine(i))?.length || 0)
    + (b.directions?.filter(d => !isPlaceholderLine(d))?.length || 0);
  return realA >= realB ? a : b;
}

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
 * Strip HTML to plain text (for visible text extraction from raw HTML string).
 */
function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract image URLs from raw HTML string.
 */
function extractImageUrlsFromHtml(html) {
  const urls = [];
  const seen = new Set();

  // OG image
  const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogM && ogM[1]) {
    const u = ogM[1].replace(/&amp;/g, '&');
    if (u.startsWith('http')) { urls.push(u); seen.add(u); }
  }

  // JSON display_url
  for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) {
    const u = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (!seen.has(u) && u.includes('scontent')) { urls.push(u); seen.add(u); }
  }

  // img tags with scontent
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/[^"]*scontent[^"]*)"/gi)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (!seen.has(u) && !/\/s\d{2,3}x\d{2,3}\//.test(u) && !/profile_pic/i.test(u)) {
      urls.push(u); seen.add(u);
    }
  }

  return urls.slice(0, 5);
}

/**
 * Regex-based extraction from raw HTML (works before sanitization strips data).
 * Targets Instagram embed page patterns: caption divs, JSON data, OG meta.
 */
function extractFromRawHtml(html, sourceUrl) {
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

  // Reject known Instagram OG placeholder captions
  if (/^\d+[\s,]*(likes?|comments?|views?)/i.test(caption)) return null;
  if (/^[\d,.]+\s*(Likes?|Comments?)/i.test(caption)) return null;

  // Parse caption into recipe
  const parsed = parseCaption(caption);
  if (!parsed) return null;

  // Extract images
  let imageUrl = extractBestImageFromHtml(html);

  // Extract title
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

  return cleanRecipe({
    name,
    ingredients: parsed.ingredients.length ? parsed.ingredients : [],
    directions: parsed.directions.length ? parsed.directions : [],
    imageUrl,
    link: sourceUrl,
  });
}

function extractBestImageFromHtml(html) {
  const candidates = [];

  const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g);
  for (const m of displayUrlMatches) {
    const url = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (url.includes('scontent')) candidates.push({ url, priority: 1 });
  }

  const thumbMatches = html.matchAll(/"thumbnail_src"\s*:\s*"(https:[^"]+)"/g);
  for (const m of thumbMatches) {
    const url = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (url.includes('scontent')) candidates.push({ url, priority: 2 });
  }

  const ogImgM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogImgM) {
    const url = ogImgM[1].replace(/&amp;/g, '&');
    if (url.startsWith('http')) candidates.push({ url, priority: 3 });
  }

  const imgTagMatches = html.matchAll(/<img[^>]+src="(https:\/\/[^"]*scontent[^"]*)"/gi);
  for (const m of imgTagMatches) {
    const url = m[1].replace(/&amp;/g, '&');
    candidates.push({ url, priority: 4 });
  }

  const embedImgM = html.match(/<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i);
  if (embedImgM) {
    candidates.push({ url: embedImgM[1].replace(/&amp;/g, '&'), priority: 2 });
  }

  const filtered = candidates.filter(c => {
    const url = c.url;
    if (/\/s\d{2,3}x\d{2,3}\//.test(url)) return false;
    if (/profile_pic/i.test(url)) return false;
    if (url.includes('1x1') || url.includes('blank')) return false;
    return true;
  });

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
          [style*="display: none"], [style*="display:none"],
          .hidden, [hidden] { display: block !important; visibility: visible !important; }
          .Caption, .EmbedCaption, [class*="Caption"] {
            max-height: none !important;
            overflow: visible !important;
            -webkit-line-clamp: unset !important;
          }
        </style>`
    );
}

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

function extractImageUrlsFromDoc(doc) {
  const candidates = [];
  const seen = new Set();

  const ogImg = doc.querySelector('meta[property="og:image"]');
  if (ogImg?.content?.startsWith('http')) {
    candidates.push({ url: ogImg.content, priority: 3 });
    seen.add(ogImg.content);
  }

  for (const img of doc.querySelectorAll('img')) {
    const src = img.src || img.getAttribute('data-src') || '';
    if (!src || !src.startsWith('http') || seen.has(src)) continue;
    seen.add(src);

    if (/\/s\d{2,3}x\d{2,3}\//.test(src)) continue;
    if (/profile_pic/i.test(src)) continue;
    if (src.includes('1x1') || src.includes('blank')) continue;

    const isInstaCdn = src.includes('scontent') || src.includes('cdninstagram');
    const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
    const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
    const isLarge = (w > 200 || h > 200);

    if (isInstaCdn && isLarge) candidates.push({ url: src, priority: 1 });
    else if (isInstaCdn) candidates.push({ url: src, priority: 2 });
    else if (isLarge) candidates.push({ url: src, priority: 4 });
    else candidates.push({ url: src, priority: 5 });
  }

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

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, 5).map(c => c.url);
}
