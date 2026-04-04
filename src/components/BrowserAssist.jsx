import { useState, useEffect, useRef, useCallback } from 'react';
import { extractRecipeFromDOM, parseCaption, extractWithBrowserAPI, detectRecipePlugins, isSocialMediaUrl, tryVideoExtraction, extractInstagramAgent, scoreExtractionConfidence, structureWithAI, captionToRecipe } from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl } from '../api';
import { queueRecipeImport } from '../db';
import useOnlineStatus from '../hooks/useOnlineStatus';

/**
 * BrowserAssist — Enhanced interactive embedded view for recipe extraction.
 *
 * Strategy (browser-first for social media):
 *   1. If ONLINE + social media URL: fetch page HTML and show the browser IMMEDIATELY
 *      so the user can scroll, zoom, and clear obstructions.
 *   2. Auto-extraction runs in background; if it finds a recipe it surfaces as a
 *      floating "Recipe found!" banner — user can accept or ignore it.
 *   3. "Extract Recipe" button grabs ALL visible text from the page → Google AI
 *      (Gemini) structures it into a clean, sorted recipe.
 *   4. "Clear Clutter" removes cookie banners, login walls, and sticky overlays
 *      so the user can see the actual post.
 *   5. For non-social URLs: auto-extraction first; iframe only on failure.
 *   6. If OFFLINE: show offline mode with manual paste option.
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
  const [bannerRecipe, setBannerRecipe] = useState(null); // auto-found recipe shown as banner in browser mode
  const [clearingClutter, setClearingClutter] = useState(false); // Clear Clutter animation state
  const [loadingDots, setLoadingDots] = useState('');
  const [queuedRecipe, setQueuedRecipe] = useState(null); // offline queued recipe
  const [iframeZoom, setIframeZoom] = useState(85); // zoom level percentage — start at 85% for mobile readability
  const iframeZoomRef = useRef(85); // mirror for use inside non-reactive event handlers
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

  // Keep zoom ref in sync with state (prevents stale closure in touch handlers)
  useEffect(() => { iframeZoomRef.current = iframeZoom; }, [iframeZoom]);

  // ── Pinch-to-zoom support for mobile ─────────────────────────────────────
  // Uses iframeZoomRef (not state) inside the handler to avoid stale closures —
  // the event listener is registered only once.
  useEffect(() => {
    const container = document.querySelector('.browser-assist-iframe-container');
    if (!container) return;

    let lastDistance = 0;
    let lastMidX = 0;
    let lastMidY = 0;

    const handleTouchMove = (e) => {
      if (e.touches.length !== 2) return;

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );
      const midX = (touch1.clientX + touch2.clientX) / 2;
      const midY = (touch1.clientY + touch2.clientY) / 2;

      // Only prevent default scroll if actually pinch-zooming
      if (lastDistance > 0 && Math.abs(distance - lastDistance) > 3) {
        e.preventDefault();
      }

      if (lastDistance > 0) {
        const scale = distance / lastDistance;
        const currentZoom = iframeZoomRef.current;
        const newZoom = Math.round(Math.max(40, Math.min(250, currentZoom * scale)));
        if (newZoom !== currentZoom) {
          iframeZoomRef.current = newZoom;
          setIframeZoom(newZoom);
        }
      }
      lastDistance = distance;
      lastMidX = midX;
      lastMidY = midY;
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
  }, []); // intentionally empty — uses ref for current zoom

  // ── Fetch, show browser, and auto-extract in background ──────────────────
  useEffect(() => {
    if (!isOnline) {
      setErrorMsg('You are offline. You can still paste recipe text manually.');
      setPhase('offline');
      return;
    }

    let cancelled = false;
    const isSocial = isSocialMediaUrl(url);

    const timeout = setTimeout(() => {
      if (!cancelled && (phase === 'loading')) {
        setErrorMsg('Page took too long to load. The site may be blocking the request.');
        setPhase('error');
      }
    }, 50000);

    (async () => {
      try {
        // ── Fast paths (social only): Agent Browser + Video extraction ─────────
        // These run BEFORE HTML fetch because they return quality results quickly.
        // If they succeed → go to preview directly. If not → browser-first mode.
        if (isSocial) {
          // Agent Browser
          setExtractionProgress({ step: 1, total: 4, message: 'Loading post…' });
          try {
            const agentResult = await extractInstagramAgent(url, (msg) => {
              if (cancelled) return;
              let step = 1;
              const lowerMsg = msg.toLowerCase();
              if (lowerMsg.includes('expand')) step = 2;
              else if (lowerMsg.includes('vision') || lowerMsg.includes('analyz')) step = 3;
              else if (lowerMsg.includes('recipe')) step = 4;
              setExtractionProgress({ step, total: 4, message: msg });
            });
            if (!cancelled && agentResult && hasRealContent(agentResult)) {
              const cleaned = cleanRecipe(agentResult);
              const conf = scoreExtractionConfidence(cleaned);
              if (conf >= 40) {
                setAutoRecipe({ ...cleaned, extractedVia: 'agent-browser', imageUrls: agentResult.imageUrls || [], imageUrl: agentResult.visionSelectedImage || agentResult.imageUrl });
                setPhase('preview');
                return;
              }
            }
          } catch (err) {
            console.log('[BrowserAssist] Agent Browser failed, continuing:', err?.message);
          }
          if (cancelled) return;

          // Video extraction (yt-dlp)
          setExtractionProgress({ step: 2, total: 4, message: 'Checking for video subtitles…' });
          try {
            const videoResult = await tryVideoExtraction(url);
            if (!cancelled && videoResult && !videoResult._error &&
                videoResult.ingredients?.[0] !== 'See original post for ingredients') {
              setAutoRecipe({ name: videoResult.name || 'Imported Recipe', ingredients: videoResult.ingredients || [], directions: videoResult.directions || [], imageUrl: videoResult.imageUrl || '', imageUrls: videoResult.imageUrls || [], link: videoResult.link || url });
              setPhase('preview');
              return;
            }
          } catch { /* continue */ }
          if (cancelled) return;
        }

        // ── Fetch page HTML ──────────────────────────────────────────────────
        setExtractionProgress({ step: 3, total: 5, message: 'Fetching page…' });
        const urls = [url];
        const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
        if (shortcodeMatch) {
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
            setErrorMsg('Could not load the page. Try "Paste Text" to add recipe content manually.');
            setPhase('error');
          }
          return;
        }

        setRawHtml(html);
        const sanitized = sanitizeHtmlForEmbed(html, url);
        setHtmlContent(sanitized);

        // ── BROWSER-FIRST for social media ───────────────────────────────────
        // Show the browser immediately so the user can see, scroll, and clear
        // obstructions. Auto-extraction results bubble up as a banner (bannerRecipe).
        if (isSocial && !cancelled) {
          setPhase('iframe');
        }

        // Helper: route extraction result — banner in browser mode, preview otherwise
        const applyResult = (recipe, via) => {
          if (cancelled || !recipe || !hasRealContent(recipe)) return false;
          const cleaned = cleanRecipe({ ...recipe, extractedVia: via || recipe.extractedVia });
          if (isSocial) {
            setBannerRecipe(cleaned); // surfaces as a floating "Recipe found!" banner
          } else {
            setAutoRecipe(cleaned);
            setPhase('preview');
          }
          return true;
        };

        setExtractionProgress({ step: 4, total: 5, message: 'Analyzing recipe content…' });

        // ── Pass A: Instagram og:description → Gemini AI ─────────────────────
        if (/instagram\.com/i.test(url)) {
          const ogMatch = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
            || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
          if (ogMatch?.[1]) {
            let ogCaption = ogMatch[1]
              .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            ogCaption = ogCaption.replace(/^[\d,.]+[kKmM]?\s+likes?,?\s*[\d,.]+[kKmM]?\s+comments?\s*[-–—]\s*[^:]+:\s*/i, '').trim();
            if (ogCaption.length > 30 && !/^log[ -]?in/i.test(ogCaption)) {
              const igImageUrls = extractImageUrlsFromHtml(html);
              setExtractionProgress({ step: 4, total: 5, message: '✨ AI reading caption…' });
              try {
                const igAiRecipe = await captionToRecipe(ogCaption, { imageUrl: igImageUrls[0] || '', sourceUrl: url });
                if (applyResult(igAiRecipe, 'ig-caption-ai') && !isSocial) return;
              } catch (e) {
                console.log('[BrowserAssist] og:description AI pass failed:', e?.message);
              }
              if (cancelled) return;
            }
          }
        }

        // ── Pass B: extractWithBrowserAPI (plugin + caption + classification) ─
        const visibleText = stripHtmlToText(html);
        const imageUrls = extractImageUrlsFromHtml(html);
        const browserApiResult = extractWithBrowserAPI({ html, visibleText, imageUrls, sourceUrl: url });
        if (applyResult(browserApiResult, 'browser-api') && !isSocial) return;

        // ── Pass C: Regex patterns on raw HTML ───────────────────────────────
        const regexRecipe = extractFromRawHtml(html, url);
        if (applyResult(regexRecipe, 'regex') && !isSocial) return;

        // ── Pass D: Merge partial results ─────────────────────────────────────
        const merged = pickBestRecipe(browserApiResult, regexRecipe);
        if (merged && (merged.ingredients?.length > 0 || merged.directions?.length > 0)) {
          if (applyResult(merged, 'partial-merge') && !isSocial) return;
        }

        // ── Pass E: Gemini AI on full visible text ────────────────────────────
        if (!cancelled) {
          setExtractionProgress({ step: 5, total: 5, message: '✨ AI analyzing full page…' });
          try {
            const aiRecipe = await structureWithAI(visibleText, { imageUrl: imageUrls[0] || '', sourceUrl: url });
            if (aiRecipe && aiRecipe.ingredients?.[0] !== 'See original post for ingredients') {
              if (applyResult(aiRecipe, 'ai-gemini') && !isSocial) return;
            }
          } catch {
            console.log('[BrowserAssist] Gemini AI pass unavailable');
          }
        }

        // ── Fallback for non-social: show iframe ──────────────────────────────
        if (!isSocial && !cancelled) {
          setPhase('iframe');
        }
        // For social: already in iframe mode. Extraction done; banner shown if anything found.

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

  // ── Clear Clutter: remove cookie banners, login walls, sticky overlays ──────
  const handleClearClutter = useCallback(() => {
    if (clearingClutter) return;
    setClearingClutter(true);

    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) { setTimeout(() => setClearingClutter(false), 800); return; }

      const CLUTTER_SELECTORS = [
        // Dialogs & modals
        '[role="dialog"]:not([id^="spicehub"])', '[aria-modal="true"]',
        '.modal', '.overlay', '.popup', '.modal-overlay', '.modal-backdrop',
        // Cookie / consent banners
        '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
        '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]', '[id*="onetrust"]',
        // Login walls & paywalls
        '[class*="login-wall"]', '[class*="paywall"]', '[class*="pay-wall"]',
        '[class*="signup-modal"]', '[class*="register-modal"]',
        '[class*="subscribe"]', '[class*="subscription-modal"]',
        '[class*="newsletter-popup"]', '[class*="email-popup"]',
        // Generic blockers
        '[class*="blocker"]', '[class*="gate"]', '[class*="interstitial"]',
        '[id*="paywall"]', '[id*="popup"]', '[id*="overlay"]', '[id*="modal"]',
        // Instagram-specific
        '.RnEpo', '._acam', // IG login overlay classes
      ];

      let removed = 0;
      CLUTTER_SELECTORS.forEach(sel => {
        try {
          doc.querySelectorAll(sel).forEach(el => {
            // Never remove the main content or the SpiceHub buttons
            if (['MAIN', 'ARTICLE', 'BODY', 'HTML'].includes(el.tagName)) return;
            if (el.id === 'spicehub-extract-btn' || el.id === 'spicehub-helper') return;
            el.remove();
            removed++;
          });
        } catch { /* ignore selector errors */ }
      });

      // Also remove large fixed/sticky elements that cover the page
      try {
        const docWin = iframeRef.current?.contentWindow;
        Array.from(doc.querySelectorAll('*')).forEach(el => {
          if (['MAIN', 'ARTICLE', 'BODY', 'HTML'].includes(el.tagName)) return;
          if (el.id === 'spicehub-extract-btn' || el.id === 'spicehub-helper') return;
          const style = docWin?.getComputedStyle(el);
          if (!style) return;
          const pos = style.position;
          const zi = parseInt(style.zIndex) || 0;
          if ((pos === 'fixed' || pos === 'absolute') && zi > 50) {
            const rect = el.getBoundingClientRect();
            if (rect.width > doc.body.offsetWidth * 0.55 && rect.height > 80) {
              el.remove(); removed++;
            }
          }
        });
      } catch { /* ignore */ }

      // Restore scroll if body was locked
      try {
        doc.body.style.overflow = '';
        doc.documentElement.style.overflow = '';
        doc.body.style.position = '';
        doc.body.style.height = '';
      } catch { /* ignore */ }

      console.log(`[BrowserAssist] Cleared ${removed} clutter element(s)`);
    } catch (err) {
      console.warn('[BrowserAssist] Could not clear clutter:', err);
    }

    setTimeout(() => setClearingClutter(false), 900);
  }, [clearingClutter]);

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

  // ── Manual extraction from iframe DOM + Gemini AI ─────────────────────────
  // Grabs ALL visible text from the page, runs multiple extraction passes,
  // sends to Google AI (Gemini) for robust auto-sorted parsing, shows preview.
  const handleExtraction = useCallback(async () => {
    setPhase('extracting');
    setBannerRecipe(null); // hide any banner while extracting
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) throw new Error('Cannot read page content');

      const visibleText = extractVisibleTextFromDoc(doc);
      const imageUrls = extractImageUrlsFromDoc(doc);
      const fullHtml = doc.documentElement?.outerHTML || '';

      // ── Step 1: heuristic passes (fast) ──────────────────────────────────
      setExtractionProgress({ step: 1, total: 3, message: 'Reading page content…' });

      const browserApiResult = extractWithBrowserAPI({ html: fullHtml, visibleText, imageUrls, sourceUrl: url });
      const regexRecipe = rawHtml ? extractFromRawHtml(rawHtml, url) : null;
      const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);
      const heuristicResult = pickBestRecipe(pickBestRecipe(browserApiResult, regexRecipe), domRecipe);

      // ── Step 2: Gemini AI structuring (robust, auto-sorted) ──────────────
      // Always run AI on the visible text — it auto-sorts ingredients vs directions,
      // strips Instagram chrome, and returns a clean recipe even from messy captions.
      setExtractionProgress({ step: 2, total: 3, message: '✨ Google AI parsing text…' });
      let aiRecipe = null;
      try {
        // Prefer og:description if available (cleanest text for Instagram)
        let textForAI = visibleText;
        if (rawHtml && /instagram\.com/i.test(url)) {
          const ogMatch = rawHtml.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
            || rawHtml.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
          if (ogMatch?.[1]) {
            const og = ogMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
            if (og.length > 30) textForAI = og + '\n\n' + visibleText; // prepend og for context
          }
        }
        aiRecipe = await captionToRecipe(textForAI.slice(0, 8000), { imageUrl: imageUrls[0] || '', sourceUrl: url });
      } catch (err) {
        console.log('[BrowserAssist] Gemini extraction failed:', err?.message);
      }

      // ── Step 3: Pick best result and show as editable preview ────────────
      setExtractionProgress({ step: 3, total: 3, message: 'Sorting results…' });

      const best = (aiRecipe && hasRealContent(aiRecipe)) ? aiRecipe : heuristicResult;

      if (best && hasRealContent(best)) {
        setAutoRecipe(cleanRecipe({ ...best, extractedVia: aiRecipe ? 'ai-gemini-manual' : 'heuristic-manual' }));
        setPhase('preview');
        return;
      }

      // Nothing found — stay in iframe and tell user
      setPhase('iframe');
      setExtractionProgress({ step: 0, total: 0, message: '' });
      try {
        const btn = doc.getElementById('spicehub-extract-btn');
        if (btn) {
          btn.textContent = '⚠️ No recipe found — try selecting text first';
          btn.style.background = '#f44336';
          setTimeout(() => {
            if (btn.parentNode) { btn.textContent = '📥 Extract Recipe'; btn.style.background = '#4CAF50'; }
          }, 3500);
        }
      } catch { /* ignore */ }

    } catch (err) {
      console.error('[BrowserAssist] Extraction error:', err);
      setErrorMsg('Could not read page content: ' + err.message);
      setPhase('error');
    }
  }, [url, rawHtml]);

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
          <div className="browser-assist-loading-icon">🔍</div>
          <p className="browser-assist-pulse-text" aria-live="polite" aria-atomic="true">
            {extractionProgress.message || 'Fetching page content'}
          </p>
          {extractionProgress.total > 0 && (
            <div className="extraction-progress-stepper" style={{ width: '100%', maxWidth: 260 }}>
              <div className="extraction-progress-dots">
                {Array.from({ length: extractionProgress.total }, (_, i) => (
                  <div key={i} className={`progress-step ${i + 1 < extractionProgress.step ? 'done' : i + 1 === extractionProgress.step ? 'active' : ''}`}>
                    <div className="step-dot" />
                    {i < extractionProgress.total - 1 && <div className="step-line" />}
                  </div>
                ))}
              </div>
              <div className="extraction-progress-bar">
                <div
                  className="extraction-progress-fill"
                  style={{ width: `${Math.round((extractionProgress.step / extractionProgress.total) * 100)}%` }}
                />
              </div>
              <p className="extraction-step-message">
                {extractionProgress.step} / {extractionProgress.total} — {extractionProgress.message || '…'}
              </p>
            </div>
          )}
          {!extractionProgress.total && (
            <p className="browser-assist-pulse-sub">This usually takes a few seconds…</p>
          )}
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
                    const enc = encodeURIComponent(autoRecipe.imageUrl);
                    const proxies = [
                      // weserv.nl first — reliable image CDN proxy that handles Instagram/TikTok
                      `https://images.weserv.nl/?url=${enc}&w=600&output=jpg&q=85`,
                      // corsproxy.io — correct URL format (url= param required)
                      `https://corsproxy.io/?url=${enc}`,
                      // allorigins last — sometimes returns HTML wrappers for binary data
                      `https://api.allorigins.win/raw?url=${enc}`,
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

      {/* ── Browser view: shown immediately for social media, as fallback for others ── */}
      {(phase === 'iframe' || phase === 'extracting') && (
        <div className="browser-assist-ready">

          {/* ── Auto-found recipe banner (from background extraction) ── */}
          {bannerRecipe && phase !== 'extracting' && (
            <div className="browser-assist-auto-banner">
              <span className="auto-banner-icon">✅</span>
              <div className="auto-banner-text">
                <strong>Recipe auto-detected!</strong>
                <span>{bannerRecipe.name || 'Recipe found'} — {bannerRecipe.ingredients?.length || 0} ingredients</span>
              </div>
              <div className="auto-banner-actions">
                <button
                  className="btn-primary auto-banner-accept"
                  onClick={() => { setAutoRecipe(bannerRecipe); setBannerRecipe(null); setPhase('preview'); }}
                >
                  Review →
                </button>
                <button
                  className="btn-icon auto-banner-dismiss"
                  onClick={() => setBannerRecipe(null)}
                  title="Dismiss — keep browsing"
                >✕</button>
              </div>
            </div>
          )}

          {/* ── Toolbar: hint + zoom + clear clutter ── */}
          <div className="browser-assist-toolbar">
            <div className="browser-assist-toolbar-hint">
              {phase === 'extracting'
                ? <span>⏳ {extractionProgress.message || 'Analyzing…'}</span>
                : <span>📜 Scroll · pinch to zoom · tap <strong>Extract ↓</strong></span>
              }
            </div>
            <div className="browser-assist-zoom-controls browser-assist-zoom-inline">
              <button className="browser-assist-zoom-btn" onClick={() => setIframeZoom(Math.max(40, iframeZoom - 15))} title="Zoom out" disabled={iframeZoom <= 40} aria-label="Zoom out">−</button>
              <button className="browser-assist-zoom-btn browser-assist-zoom-fit" onClick={() => setIframeZoom(85)} title="Fit to screen">Fit</button>
              <span className="browser-assist-zoom-display" aria-live="polite">{iframeZoom}%</span>
              <button className="browser-assist-zoom-btn browser-assist-zoom-full" onClick={() => setIframeZoom(100)} title="Full size (100%)">1:1</button>
              <button className="browser-assist-zoom-btn" onClick={() => setIframeZoom(Math.min(250, iframeZoom + 15))} title="Zoom in" disabled={iframeZoom >= 250} aria-label="Zoom in">+</button>
            </div>
            <button
              className={`browser-assist-clear-btn ${clearingClutter ? 'clearing' : ''}`}
              onClick={handleClearClutter}
              disabled={clearingClutter || phase === 'extracting'}
              title="Remove cookie banners, login popups, and overlays so you can read the page"
            >
              {clearingClutter ? '✓ Cleared!' : '🧹 Clear Clutter'}
            </button>
          </div>

          {/* ── The page iframe ── */}
          <div className="browser-assist-iframe-container" aria-label="Recipe page — scroll and pinch to zoom">
            <div style={{
              transform: `scale(${iframeZoom / 100})`,
              transformOrigin: 'top left',
              width: `${Math.round(10000 / iframeZoom)}%`,
              transition: 'transform 0.12s ease-out, width 0.12s ease-out',
              willChange: 'transform',
            }}>
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

          {/* ── Bottom action bar ── */}
          <div className="browser-assist-actions">
            <button
              className="btn-primary browser-assist-extract-btn"
              onClick={handleExtraction}
              disabled={phase === 'extracting'}
              title="Grab all visible text and use Google AI to extract the recipe"
            >
              {phase === 'extracting' ? '⏳ AI Reading…' : '📥 Extract Recipe'}
            </button>
            {bannerRecipe && (
              <button
                className="btn-accent"
                onClick={() => { setAutoRecipe(bannerRecipe); setBannerRecipe(null); setPhase('preview'); }}
                title="Use the auto-detected recipe"
              >
                ✅ Use Auto-Result
              </button>
            )}
            <button className="btn-secondary" onClick={onFallbackToText} disabled={phase === 'extracting'}>← Back</button>
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
  // Instagram UI chrome — navigation / profile elements that leak into full-page text extraction
  /^instagram\s+\w/i,                                     // "Instagram [username]…"
  /verified\s*[·•·]\s*(view\s+profile|follow)/i,          // "Verified · View profile"
  /^view profile$/i,                                       // standalone "View profile"
  /^play$/i,                                               // video player button text
  /^watch on instagram/i,                                  // "Watch on Instagram"
  /^(share|like|comment|save|explore|reels?)$/i,           // single-word nav buttons
  /^\d+\s*(likes?|followers?|following|comments?|views?)/i, // "1,234 likes"
  /^follow$/i,                                             // Follow button
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
 * Thresholds are intentionally permissive — better to show a partial preview
 * the user can fix than to silently fall back to iframe.
 */
function hasRealContent(recipe) {
  if (!recipe) return false;
  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];
  const realIngs = ings.filter(i => !isPlaceholderLine(i));
  const realDirs = dirs.filter(d => !isPlaceholderLine(d));
  // Accept if we have at least 1 real ingredient OR 1 real direction
  if (realIngs.length < 1 && realDirs.length < 1) return false;
  // Reject if title is a placeholder AND content is very thin (both < 2)
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
 * Test whether a URL looks like a real food/recipe image worth using.
 * Rejects tiny thumbnails, avatars, tracking pixels, and UI chrome.
 */
function isUsableImageUrl(u) {
  if (!u || !u.startsWith('http')) return false;
  if (/profile_pic|avatar|logo|icon|emoji|tracking|pixel|blank|1x1|spinner/i.test(u)) return false;
  if (/\/s\d{2,3}x\d{2,3}\//.test(u)) return false; // Instagram tiny thumbnails like /s150x150/
  if (/\.gif$/i.test(u)) return false; // animated gifs are rarely food photos
  return true;
}

/**
 * Extract image URLs from raw HTML string.
 * Accepts images from ANY CDN — Instagram, TikTok, YouTube, recipe blogs, etc.
 */
function extractImageUrlsFromHtml(html) {
  const urls = [];
  const seen = new Set();

  function addUrl(u) {
    const clean = u.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (isUsableImageUrl(clean) && !seen.has(clean)) {
      urls.push(clean);
      seen.add(clean);
    }
  }

  // 1. OG image — highest priority, works on all platforms
  const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogM?.[1]) addUrl(ogM[1]);

  // 2. Twitter image card (common on recipe blogs)
  const twM = html.match(/<meta[^>]+name\s*=\s*["']twitter:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']twitter:image["']/i);
  if (twM?.[1]) addUrl(twM[1]);

  // 3. JSON-LD / structured data image field
  for (const m of html.matchAll(/"image"\s*:\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*\[\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);

  // 4. Instagram-specific JSON fields (display_url, thumbnail_src, media_url)
  for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_src"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"media_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"cover_image_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"poster"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);

  // 5. EmbedImage class (Instagram embed page)
  const embedImgM = html.match(/<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*EmbedImage[^"]*"/i);
  if (embedImgM?.[1]) addUrl(embedImgM[1]);

  // 6. Large img tags (any CDN) — prefer ones with size hints
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/[^"]{20,})"/gi)) {
    const u = m[1].replace(/&amp;/g, '&');
    // Prefer images with size indicators suggesting they're content images
    if (/\d{3,4}[x_]\d{3,4}|\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) addUrl(u);
  }

  // 7. Background images in style attributes (some recipe sites use these)
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(['"]?(https:\/\/[^'")\s]{20,})['"]?\)/gi)) {
    addUrl(m[1]);
  }

  return urls.slice(0, 8);
}

/**
 * Regex-based extraction from raw HTML (works before sanitization strips data).
 * Targets Instagram embed page patterns: caption divs, JSON data, OG meta.
 */
function extractFromRawHtml(html, sourceUrl) {
  let caption = '';

  // Method 1: Caption div patterns — multiple Instagram embed class naming schemes
  const captionPatterns = [
    // Nested span inside caption div (most common current structure)
    /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    // Span inside any element with Caption in class
    /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    // Any <p> or <span> inside a data-caption element
    /data-caption[^>]*>([\s\S]*?)<\//i,
    // Article / section with caption content
    /<article[^>]*>([\s\S]{100,}?)<\/article>/i,
  ];
  for (const re of captionPatterns) {
    const m = re.exec(html);
    if (m && m[1]) {
      const text = stripHtml(m[1]);
      if (text.length > 30) { caption = text; break; }
    }
  }

  // Method 2: JSON data in scripts — covers window.__additionalData and newer structures
  if (!caption) {
    const dataPatterns = [
      // Instagram's edge_media_to_caption
      /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      // Generic caption.text
      /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      // Direct caption text field
      /"caption_text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
      // accessibility_caption
      /"accessibility_caption"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
      // Any "text" field that's long enough to be a recipe (avoid matching short UI strings)
      /"text"\s*:\s*"([^"]{80,}(?:\\.[^"]*)*)"/,
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

  // Method 3: OG description — works on all platforms when embed page is served
  if (!caption) {
    const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
    if (ogM && ogM[1] && ogM[1].length > 30) {
      caption = ogM[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
  }

  // Method 4: Meta description fallback
  if (!caption) {
    const metaM = html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i);
    if (metaM && metaM[1] && metaM[1].length > 30) {
      caption = metaM[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
  // Reuse extractImageUrlsFromHtml which now has comprehensive multi-CDN support.
  // Priority order: OG image > JSON display_url/thumbnail > EmbedImage > generic img tags.
  // extractImageUrlsFromHtml already returns them in that order.
  const urls = extractImageUrlsFromHtml(html);
  return urls.length > 0 ? urls[0] : '';
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
