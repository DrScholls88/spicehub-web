import { useState, useEffect, useRef, useCallback } from 'react';
import { extractRecipeFromDOM, parseCaption, extractWithBrowserAPI, detectRecipePlugins, isSocialMediaUrl, getSocialPlatform, tryVideoExtraction, extractInstagramAgent, scoreExtractionConfidence, structureWithAI, captionToRecipe } from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl } from '../api';
import { queueRecipeImport } from '../db';
import useOnlineStatus from '../hooks/useOnlineStatus';

/**
 * BrowserAssist — Smart recipe extraction with full pipeline UI.
 *
 * Strategy:
 *   SOCIAL MEDIA (Instagram, TikTok, YouTube, etc.):
 *     1. Instagram embed page (fast, server-side HTML, no Puppeteer)
 *     2. AI Browser (Puppeteer headless Chrome)
 *     3. Video subtitles (yt-dlp)
 *     4. Gemini AI structuring on any captured text
 *     → Success: preview
 *     → All fail: manual paste card (NO broken iframe)
 *
 *   RECIPE BLOGS / OTHER URLS:
 *     1. extractWithBrowserAPI (JSON-LD, microdata, heuristics)
 *     2. Gemini AI on full page text
 *     → Success: preview
 *     → Fail: iframe fallback (works for real HTML pages)
 *
 * Props:
 *   url                - Page URL
 *   onRecipeExtracted  - callback(recipe) on success
 *   onFallbackToText   - callback() when user wants Paste Text
 */
export default function BrowserAssist({ url, onRecipeExtracted, onFallbackToText }) {
  const { isOnline } = useOnlineStatus();

  // phases:
  //   'loading'    — fetching / running pipeline (shown during work)
  //   'preview'    — auto-extracted recipe ready for review
  //   'iframe'     — showing page in iframe (non-social fallback only)
  //   'manual'     — all social methods failed, show manual paste card
  //   'offline'    — device offline
  //   'queued'     — recipe queued for offline import
  //   'error'      — unrecoverable error
  //   'extracting' — manual extraction from iframe in progress
  const [phase, setPhase] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // ── Recipe extraction state ─────────────────────────────────────────────────
  const [autoRecipe, setAutoRecipe] = useState(null);
  const [queuedRecipe, setQueuedRecipe] = useState(null);

  // ── Pipeline progress (social media flow) ───────────────────────────────────
  // Each step: { label, status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' }
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [pipelineMessage, setPipelineMessage] = useState('');

  // ── Manual paste card state (fallback when pipeline fails) ─────────────────
  const [manualText, setManualText] = useState('');
  const [isParsingManual, setIsParsingManual] = useState(false);
  const [manualError, setManualError] = useState('');

  // ── iframe state (non-social recipe blogs only) ─────────────────────────────
  const [htmlContent, setHtmlContent] = useState('');
  const [rawHtml, setRawHtml] = useState('');
  const [bannerRecipe, setBannerRecipe] = useState(null);
  const [clearingClutter, setClearingClutter] = useState(false);
  const [iframeZoom, setIframeZoom] = useState(85);
  const iframeZoomRef = useRef(85);
  const [extractionProgress, setExtractionProgress] = useState({ step: 0, total: 0, message: '' });
  const [loadingDots, setLoadingDots] = useState('');
  const iframeRef = useRef(null);
  const extractionRef = useRef(null);

  const isSocial = isSocialMediaUrl(url);
  const platform = isSocial ? getSocialPlatform(url) : '';

  // ── Pulsing loading text animation (non-social loading phase) ────────────────
  useEffect(() => {
    if (phase !== 'loading' || isSocial) return;
    let dots = 0;
    const interval = setInterval(() => {
      dots = (dots + 1) % 4;
      const msg = extractionProgress.message || 'Fetching page content';
      setLoadingDots(msg + '.'.repeat(dots + 1));
    }, 500);
    return () => clearInterval(interval);
  }, [phase, extractionProgress.message, isSocial]);

  // Keep zoom ref in sync (prevents stale closure in touch handlers)
  useEffect(() => { iframeZoomRef.current = iframeZoom; }, [iframeZoom]);

  // ── Pinch-to-zoom support for mobile ─────────────────────────────────────
  useEffect(() => {
    const container = document.querySelector('.browser-assist-iframe-container');
    if (!container) return;
    let lastDistance = 0;
    const handleTouchMove = (e) => {
      if (e.touches.length !== 2) return;
      const t1 = e.touches[0], t2 = e.touches[1];
      const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (lastDistance > 0 && Math.abs(distance - lastDistance) > 3) e.preventDefault();
      if (lastDistance > 0) {
        const scale = distance / lastDistance;
        const cur = iframeZoomRef.current;
        const nz = Math.round(Math.max(40, Math.min(250, cur * scale)));
        if (nz !== cur) { iframeZoomRef.current = nz; setIframeZoom(nz); }
      }
      lastDistance = distance;
    };
    const handleTouchEnd = () => { lastDistance = 0; };
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    return () => {
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // intentionally empty — uses ref for current zoom

  // ── Helper: update a specific pipeline step ───────────────────────────────
  const stepUpdater = useRef(null);
  useEffect(() => {
    stepUpdater.current = (idx, status, msg) => {
      setPipelineSteps(prev => {
        const next = prev.map((s, i) => i === idx ? { ...s, status } : s);
        return next;
      });
      if (msg !== undefined) setPipelineMessage(msg);
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Main extraction effect
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isOnline) { setPhase('offline'); return; }

    let cancelled = false;

    // ── SOCIAL MEDIA PIPELINE ─────────────────────────────────────────────
    if (isSocial) {
      const isInstagram = /instagram\.com/i.test(url);

      const steps = [
        { label: isInstagram ? 'Reading Instagram post…' : `Reading ${platform} post…`, status: 'pending' },
        { label: 'AI browser extraction…', status: 'pending' },
        { label: 'Video subtitle scan…', status: 'pending' },
        { label: '✨ Google AI recipe parsing…', status: 'pending' },
      ];
      setPipelineSteps(steps);
      setPipelineMessage('Starting import pipeline…');
      setPhase('loading');

      // Track any raw caption/text found during steps 0-2
      let capturedCaption = '';
      let capturedImageUrl = '';

      (async () => {
        const update = (idx, status, msg) => {
          if (cancelled) return;
          if (stepUpdater.current) stepUpdater.current(idx, status, msg);
        };

        // ── Step 0: Instagram embed page (fast, server-side fetch via proxy) ─
        update(0, 'running', isInstagram ? 'Fetching embed page…' : `Fetching ${platform} post…`);
        try {
          let embedHtml = null;
          const shortcodeMatch = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
          if (shortcodeMatch) {
            const embedUrl = `https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`;
            try { embedHtml = await fetchHtmlViaProxy(embedUrl, 12000); } catch { /* try direct */ }
          }
          if (!embedHtml || embedHtml.length < 1000) {
            try { embedHtml = await fetchHtmlViaProxy(url, 15000); } catch { /* continue */ }
          }
          if (!cancelled && embedHtml && embedHtml.length > 500) {
            // Extract caption from the HTML (no JS needed — static parsing)
            const ogMatch = embedHtml.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
              || embedHtml.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
            if (ogMatch?.[1] && ogMatch[1].length > 30) {
              let ogCaption = ogMatch[1]
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
              // Strip Instagram engagement prefix (e.g. "13K likes, 213 comments - user on Jan 1, 2025: …")
              ogCaption = ogCaption.replace(/^[\d,.]+[kKmM]?\s*likes?,?\s*[\d,.]+[kKmM]?\s*comments?\s*[-–—]\s*[^:]+:\s*[""]?/i, '').replace(/[""]$/, '').trim();
              if (ogCaption.length > 30 && !/^log[ -]?in/i.test(ogCaption) && !/^\d+\s*likes/i.test(ogCaption)) {
                capturedCaption = ogCaption;
              }
            }
            // Also try data patterns in scripts
            if (!capturedCaption) {
              const dataPatterns = [
                /"edge_media_to_caption"\s*:\s*\{"edges"\s*:\s*\[\{"node"\s*:\s*\{"text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
                /"caption"\s*:\s*\{"text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
                /"caption_text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
                /"accessibility_caption"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
                /"text"\s*:\s*"([^"]{80,}(?:\\.[^"]*)*)"/,
              ];
              for (const re of dataPatterns) {
                const m = re.exec(embedHtml);
                if (m) {
                  try { capturedCaption = JSON.parse('"' + m[1] + '"'); } catch { capturedCaption = m[1]; }
                  capturedCaption = capturedCaption.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  if (capturedCaption.length > 30) break;
                  capturedCaption = '';
                }
              }
            }
            // Extract image
            const imgMatch = embedHtml.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
              || embedHtml.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
            if (imgMatch?.[1]) capturedImageUrl = imgMatch[1];

            update(0, capturedCaption ? 'done' : 'failed',
              capturedCaption ? `Caption found (${capturedCaption.length} chars)` : 'No caption in embed page');
          } else {
            update(0, 'failed', 'Embed page not accessible');
          }
        } catch (err) {
          if (!cancelled) update(0, 'failed', 'Embed fetch failed');
        }
        if (cancelled) return;

        // ── If we got a caption from step 0, try Gemini first ────────────────
        if (capturedCaption) {
          update(3, 'running', '✨ AI parsing caption…');
          try {
            const recipe = await captionToRecipe(capturedCaption, { imageUrl: capturedImageUrl, sourceUrl: url });
            if (!cancelled && recipe && hasRealContent(recipe)) {
              update(3, 'done', 'Recipe extracted!');
              setAutoRecipe(cleanRecipe({ ...recipe, imageUrl: capturedImageUrl || recipe.imageUrl }));
              setPhase('preview');
              return;
            }
          } catch { /* fall through */ }
          if (cancelled) return;
          update(3, 'pending', ''); // reset — will try again after agent
        }

        // ── Step 1: AI Browser (Puppeteer backend) ────────────────────────────
        update(1, 'running', 'Launching AI browser…');
        try {
          const agentResult = await extractInstagramAgent(url, (msg) => {
            if (!cancelled && stepUpdater.current) stepUpdater.current(1, 'running', msg);
          });
          if (!cancelled && agentResult) {
            // Update captured caption if we got better text
            const agentCaption = agentResult.caption || '';
            if (agentCaption.length > capturedCaption.length) {
              capturedCaption = agentCaption;
            }
            if (agentResult.imageUrl && !capturedImageUrl) capturedImageUrl = agentResult.imageUrl;

            if (hasRealContent(agentResult)) {
              update(1, 'done', 'AI browser succeeded');
              // Try Gemini AI on the result for better structuring
              update(3, 'running', '✨ AI parsing recipe…');
              try {
                const textForAI = capturedCaption || agentCaption;
                const aiRecipe = textForAI.length > 30
                  ? await captionToRecipe(textForAI, { imageUrl: capturedImageUrl || agentResult.imageUrl, sourceUrl: url })
                  : null;
                const best = (aiRecipe && hasRealContent(aiRecipe)) ? aiRecipe : agentResult;
                update(3, 'done', 'Recipe extracted!');
                setAutoRecipe(cleanRecipe({
                  ...best,
                  imageUrl: capturedImageUrl || agentResult.imageUrl || best.imageUrl,
                  extractedVia: 'agent-browser',
                }));
                setPhase('preview');
                return;
              } catch {
                // Use raw agent result without AI structuring
                update(3, 'skipped', 'Using raw extraction');
                setAutoRecipe(cleanRecipe(agentResult));
                setPhase('preview');
                return;
              }
            } else {
              update(1, 'failed', 'AI browser: no recipe content found');
            }
          } else {
            update(1, 'failed', 'AI browser unavailable (server may be starting up)');
          }
        } catch (err) {
          if (!cancelled) update(1, 'failed', `AI browser error: ${err?.message?.slice(0, 40)}`);
        }
        if (cancelled) return;

        // ── Step 2: Video subtitle extraction (yt-dlp) ───────────────────────
        update(2, 'running', 'Looking for video transcript…');
        try {
          const videoResult = await tryVideoExtraction(url);
          if (!cancelled && videoResult && !videoResult._error) {
            if (videoResult.ingredients?.[0] !== 'See original post for ingredients' && hasRealContent(videoResult)) {
              update(2, 'done', 'Video transcript found!');
              update(3, 'skipped');
              setAutoRecipe(cleanRecipe({ ...videoResult, extractedVia: 'yt-dlp' }));
              setPhase('preview');
              return;
            }
          }
          update(2, 'failed', 'No video transcript available');
        } catch {
          if (!cancelled) update(2, 'failed', 'Video extraction unavailable');
        }
        if (cancelled) return;

        // ── Step 3: Last-chance Gemini AI on any captured text ────────────────
        if (capturedCaption) {
          update(3, 'running', '✨ Google AI final attempt…');
          try {
            const recipe = await captionToRecipe(capturedCaption, { imageUrl: capturedImageUrl, sourceUrl: url });
            if (!cancelled && recipe && hasRealContent(recipe)) {
              update(3, 'done', 'Recipe extracted!');
              setAutoRecipe(cleanRecipe({ ...recipe, imageUrl: capturedImageUrl || recipe.imageUrl }));
              setPhase('preview');
              return;
            }
          } catch { /* fall through */ }
          if (!cancelled) update(3, 'failed', 'AI could not find a recipe');
        } else {
          update(3, 'failed', 'No text captured to analyze');
        }

        // ── All methods failed → manual mode ─────────────────────────────────
        if (!cancelled) {
          setPipelineMessage('Automatic extraction failed — paste the caption text below');
          setPhase('manual');
        }
      })();

      return () => { cancelled = true; };
    }

    // ── NON-SOCIAL: recipe blog / regular URL ────────────────────────────────
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'loading') {
        setErrorMsg('Page took too long to load.');
        setPhase('error');
      }
    }, 50000);

    (async () => {
      try {
        setExtractionProgress({ step: 1, total: 4, message: 'Fetching page…' });
        const html = await fetchHtmlViaProxy(url, 35000);
        if (cancelled) return;

        if (!html || html.length < 500) {
          setErrorMsg('Could not load the page. Try "Paste Text" to add recipe content manually.');
          setPhase('error');
          return;
        }

        setRawHtml(html);
        const sanitized = sanitizeHtmlForEmbed(html, url);
        setHtmlContent(sanitized);

        const visibleText = stripHtmlToText(html);
        const imageUrls = extractImageUrlsFromHtml(html);

        setExtractionProgress({ step: 2, total: 4, message: 'Analyzing recipe structure…' });
        const browserApiResult = extractWithBrowserAPI({ html, visibleText, imageUrls, sourceUrl: url });
        const regexRecipe = extractFromRawHtml(html, url);
        const merged = pickBestRecipe(browserApiResult, regexRecipe);

        if (merged && hasRealContent(merged)) {
          if (!cancelled) {
            setAutoRecipe(cleanRecipe(merged));
            setPhase('preview');
            return;
          }
        }

        setExtractionProgress({ step: 3, total: 4, message: '✨ AI analyzing full page…' });
        try {
          const aiRecipe = await structureWithAI(visibleText, { imageUrl: imageUrls[0] || '', sourceUrl: url });
          if (!cancelled && aiRecipe && hasRealContent(aiRecipe)) {
            setAutoRecipe(cleanRecipe(aiRecipe));
            setPhase('preview');
            return;
          }
        } catch { /* fall through to iframe */ }

        if (!cancelled) {
          setExtractionProgress({ step: 4, total: 4, message: 'Showing page for manual extraction' });
          setPhase('iframe');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg('Failed to load page: ' + err.message);
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isOnline]);

  // ── Manual paste → AI parse ────────────────────────────────────────────────
  const handleParseManual = useCallback(async () => {
    const text = manualText.trim();
    if (text.length < 20) {
      setManualError('Please paste more recipe text (at least a few ingredients or steps).');
      return;
    }
    setIsParsingManual(true);
    setManualError('');
    try {
      const recipe = await captionToRecipe(text, { sourceUrl: url });
      if (recipe && hasRealContent(recipe)) {
        setAutoRecipe(cleanRecipe(recipe));
        setPhase('preview');
      } else {
        setManualError('Could not find recipe content in the text. Make sure ingredients and steps are included.');
      }
    } catch (err) {
      setManualError('AI parsing failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsParsingManual(false);
    }
  }, [manualText, url]);

  // ── Retry pipeline ─────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setManualText('');
    setManualError('');
    setAutoRecipe(null);
    setBannerRecipe(null);
    setPhase('loading');
    // Force re-run of the useEffect by resetting state — component will reinitialize
    // (The parent should re-mount this component, but we can also trigger re-fetch)
    window.location.reload();
  }, []);

  // ── Clear Clutter (iframe only) ────────────────────────────────────────────
  const handleClearClutter = useCallback(() => {
    if (clearingClutter) return;
    setClearingClutter(true);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) { setTimeout(() => setClearingClutter(false), 800); return; }
      const CLUTTER_SELECTORS = [
        '[role="dialog"]:not([id^="spicehub"])', '[aria-modal="true"]',
        '.modal', '.overlay', '.popup', '.modal-overlay', '.modal-backdrop',
        '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
        '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]', '[id*="onetrust"]',
        '[class*="login-wall"]', '[class*="paywall"]', '[class*="pay-wall"]',
        '[class*="signup-modal"]', '[class*="register-modal"]',
        '[class*="subscribe"]', '[class*="subscription-modal"]',
        '[class*="newsletter-popup"]', '[class*="email-popup"]',
        '[class*="blocker"]', '[class*="gate"]', '[class*="interstitial"]',
        '[id*="paywall"]', '[id*="popup"]', '[id*="overlay"]', '[id*="modal"]',
      ];
      let removed = 0;
      CLUTTER_SELECTORS.forEach(sel => {
        try {
          doc.querySelectorAll(sel).forEach(el => {
            if (['MAIN', 'ARTICLE', 'BODY', 'HTML'].includes(el.tagName)) return;
            if (el.id === 'spicehub-extract-btn' || el.id === 'spicehub-helper') return;
            el.remove(); removed++;
          });
        } catch { /* ignore */ }
      });
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
            if (rect.width > doc.body.offsetWidth * 0.55 && rect.height > 80) { el.remove(); removed++; }
          }
        });
      } catch { /* ignore */ }
      try {
        doc.body.style.overflow = '';
        doc.documentElement.style.overflow = '';
        doc.body.style.position = '';
        doc.body.style.height = '';
      } catch { /* ignore */ }
    } catch (err) {
      console.warn('[BrowserAssist] Could not clear clutter:', err);
    }
    setTimeout(() => setClearingClutter(false), 900);
  }, [clearingClutter]);

  // ── iframe onLoad: inject Extract button ──────────────────────────────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc || !doc.body) return;
      doc.getElementById('spicehub-extract-btn')?.remove();
      doc.getElementById('spicehub-helper')?.remove();
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
      const helper = doc.createElement('div');
      helper.id = 'spicehub-helper';
      helper.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:rgba(0,0,0,0.85)', 'color:white', 'padding:10px 16px',
        'font-size:13px', 'font-family:system-ui,sans-serif',
        'text-align:center', 'line-height:1.4',
      ].join(';');
      helper.textContent = 'Scroll to read the full recipe, then tap the green Extract button.';
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

  // ── Manual extraction from iframe ──────────────────────────────────────────
  const handleExtraction = useCallback(async () => {
    setPhase('extracting');
    setBannerRecipe(null);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) throw new Error('Cannot read page content');
      const visibleText = extractVisibleTextFromDoc(doc);
      const imageUrls = extractImageUrlsFromDoc(doc);
      const fullHtml = doc.documentElement?.outerHTML || '';
      setExtractionProgress({ step: 1, total: 3, message: 'Reading page content…' });
      const browserApiResult = extractWithBrowserAPI({ html: fullHtml, visibleText, imageUrls, sourceUrl: url });
      const regexRecipe = rawHtml ? extractFromRawHtml(rawHtml, url) : null;
      const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);
      const heuristicResult = pickBestRecipe(pickBestRecipe(browserApiResult, regexRecipe), domRecipe);
      setExtractionProgress({ step: 2, total: 3, message: '✨ Google AI parsing text…' });
      let aiRecipe = null;
      try {
        aiRecipe = await captionToRecipe(visibleText.slice(0, 8000), { imageUrl: imageUrls[0] || '', sourceUrl: url });
      } catch { /* fall through */ }
      setExtractionProgress({ step: 3, total: 3, message: 'Sorting results…' });
      const best = (aiRecipe && hasRealContent(aiRecipe)) ? aiRecipe : heuristicResult;
      if (best && hasRealContent(best)) {
        setAutoRecipe(cleanRecipe({ ...best, extractedVia: aiRecipe ? 'ai-gemini-manual' : 'heuristic-manual' }));
        setPhase('preview');
        return;
      }
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
      setErrorMsg('Could not read page content: ' + err.message);
      setPhase('error');
    }
  }, [url, rawHtml]);

  useEffect(() => { extractionRef.current = handleExtraction; }, [handleExtraction]);

  // ── Preview actions ───────────────────────────────────────────────────────
  const handleAcceptPreview = useCallback(() => {
    if (autoRecipe) onRecipeExtracted(autoRecipe);
  }, [autoRecipe, onRecipeExtracted]);

  const handleTryManual = useCallback(() => {
    if (isSocial) {
      setPhase('manual');
    } else if (rawHtml) {
      setHtmlContent(sanitizeHtmlForEmbed(rawHtml, url));
      setPhase('iframe');
    } else {
      onFallbackToText();
    }
  }, [isSocial, rawHtml, url, onFallbackToText]);

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
    setAutoRecipe(prev => prev ? { ...prev, [field]: [...(prev[field] || []), ''] } : prev);
  }, []);

  // ── Offline queue ──────────────────────────────────────────────────────────
  const handleQueueOfflineRecipe = useCallback(async (recipe) => {
    try {
      const result = await queueRecipeImport(url, recipe);
      if (result.isDuplicate) {
        setErrorMsg('Recipe with this name already exists.');
        setPhase('error');
      } else {
        setQueuedRecipe(recipe);
        setPhase('queued');
        setTimeout(() => { if (onRecipeExtracted) onRecipeExtracted(recipe); }, 2500);
      }
    } catch (err) {
      setErrorMsg('Failed to queue recipe: ' + err.message);
      setPhase('error');
    }
  }, [url, onRecipeExtracted]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="browser-assist-container">

      {/* ── Offline ── */}
      {phase === 'offline' && (
        <div className="browser-assist-offline">
          <div className="offline-icon">🔌</div>
          <h3>Offline Mode</h3>
          <p>Cannot fetch recipe from the web while offline.</p>
          <p className="offline-help-text">
            Go back and use "Paste Text" to manually add recipe content.
          </p>
          <button className="btn-primary" onClick={onFallbackToText}>← Back to Import</button>
        </div>
      )}

      {/* ── Queued ── */}
      {phase === 'queued' && queuedRecipe && (
        <div className="browser-assist-queued">
          <div className="queued-icon">⏱️</div>
          <h3>Recipe Queued</h3>
          <p><strong>{queuedRecipe.name}</strong> will be imported when you're back online.</p>
          <button className="btn-primary" onClick={() => onRecipeExtracted && onRecipeExtracted(queuedRecipe)}>Close</button>
        </div>
      )}

      {/* ── Loading (Pipeline in progress) ── */}
      {phase === 'loading' && (
        <div className="browser-assist-loading">
          {isSocial ? (
            /* ── Social: beautiful pipeline steps UI ── */
            <div className="pipeline-container">
              <div className="pipeline-header">
                <span className="pipeline-platform-icon">
                  {platform === 'Instagram' ? '📸' : platform === 'TikTok' ? '🎵' : platform === 'YouTube' ? '▶️' : '🌐'}
                </span>
                <div>
                  <h3 className="pipeline-title">Importing from {platform}</h3>
                  <p className="pipeline-url">{url.length > 50 ? url.slice(0, 47) + '…' : url}</p>
                </div>
              </div>

              <div className="pipeline-steps">
                {pipelineSteps.map((step, i) => (
                  <div key={i} className={`pipeline-step pipeline-step--${step.status}`}>
                    <div className="pipeline-step-indicator">
                      {step.status === 'running' && <span className="pipeline-spinner" />}
                      {step.status === 'done' && <span className="pipeline-check">✓</span>}
                      {step.status === 'failed' && <span className="pipeline-x">✗</span>}
                      {step.status === 'skipped' && <span className="pipeline-skip">—</span>}
                      {step.status === 'pending' && <span className="pipeline-dot" />}
                    </div>
                    <div className="pipeline-step-label">{step.label}</div>
                  </div>
                ))}
              </div>

              {pipelineMessage && (
                <p className="pipeline-message">{pipelineMessage}</p>
              )}

              <button className="btn-secondary pipeline-skip-btn" onClick={onFallbackToText}>
                Skip — Enter Manually
              </button>
            </div>
          ) : (
            /* ── Non-social: simple loading indicator ── */
            <>
              <div className="browser-assist-loading-icon">🔍</div>
              <p className="browser-assist-pulse-text" aria-live="polite">
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
                    <div className="extraction-progress-fill" style={{ width: `${Math.round((extractionProgress.step / extractionProgress.total) * 100)}%` }} />
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
            </>
          )}
        </div>
      )}

      {/* ── Manual paste card (social fallback when all methods fail) ── */}
      {phase === 'manual' && (
        <div className="browser-assist-manual">
          <div className="manual-header">
            <span className="manual-icon">📋</span>
            <h3>Paste Recipe Text</h3>
            <p className="manual-subtitle">
              Auto-extraction couldn't read this {platform || 'social'} post. Open the post, copy the caption and ingredient list, then paste it here.
            </p>
          </div>

          <div className="manual-pipeline-summary">
            {pipelineSteps.map((step, i) => (
              <div key={i} className={`manual-step-badge manual-step-badge--${step.status}`}>
                {step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : '—'} {step.label}
              </div>
            ))}
          </div>

          <div className="manual-tips">
            <strong>How to get the recipe text:</strong>
            <ol>
              <li>Open the {platform || 'post'} link in your browser</li>
              <li>Tap <strong>… more</strong> to expand the full caption</li>
              <li>Copy the caption text</li>
              <li>Paste it below and tap <strong>Parse with AI →</strong></li>
            </ol>
          </div>

          <textarea
            className="manual-paste-area"
            placeholder="Paste recipe caption, ingredients, and steps here…"
            value={manualText}
            onChange={e => { setManualText(e.target.value); setManualError(''); }}
            rows={8}
          />

          {manualError && <p className="manual-error">{manualError}</p>}

          <div className="manual-actions">
            <button
              className="btn-primary manual-parse-btn"
              onClick={handleParseManual}
              disabled={isParsingManual || manualText.trim().length < 10}
            >
              {isParsingManual ? '⏳ Parsing…' : '✨ Parse with AI →'}
            </button>
            <button className="btn-secondary" onClick={onFallbackToText}>
              Enter manually instead
            </button>
          </div>
        </div>
      )}

      {/* ── Auto-extracted preview (editable) ── */}
      {phase === 'preview' && autoRecipe && (
        <div className="browser-assist-preview">
          <div className="browser-assist-preview-header">
            <span className="browser-assist-success-icon">&#10003;</span>
            <span>Recipe found{autoRecipe.extractedVia ? ` via ${autoRecipe.extractedVia}` : ''}</span>
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
                      `https://images.weserv.nl/?url=${enc}&w=600&output=jpg&q=85`,
                      `https://corsproxy.io/?url=${enc}`,
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
                    <button className="preview-remove-btn" onClick={() => removePreviewListItem('ingredients', i)} title="Remove">&#10005;</button>
                  </div>
                ))}
              </div>
            </div>

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
                    <button className="preview-remove-btn" onClick={() => removePreviewListItem('directions', i)} title="Remove">&#10005;</button>
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
              {isSocial ? 'Edit text instead' : 'Not right? Try manual extraction'}
            </button>
          </div>
        </div>
      )}

      {/* ── Browser view (non-social recipe blogs only) ── */}
      {(phase === 'iframe' || phase === 'extracting') && (
        <div className="browser-assist-ready">
          {bannerRecipe && phase !== 'extracting' && (
            <div className="browser-assist-auto-banner">
              <span className="auto-banner-icon">✅</span>
              <div className="auto-banner-text">
                <strong>Recipe auto-detected!</strong>
                <span>{bannerRecipe.name || 'Recipe found'} — {bannerRecipe.ingredients?.length || 0} ingredients</span>
              </div>
              <div className="auto-banner-actions">
                <button className="btn-primary auto-banner-accept" onClick={() => { setAutoRecipe(bannerRecipe); setBannerRecipe(null); setPhase('preview'); }}>
                  Review →
                </button>
                <button className="btn-icon auto-banner-dismiss" onClick={() => setBannerRecipe(null)} title="Dismiss">✕</button>
              </div>
            </div>
          )}

          <div className="browser-assist-toolbar">
            <div className="browser-assist-toolbar-hint">
              {phase === 'extracting'
                ? <span>⏳ {extractionProgress.message || 'Analyzing…'}</span>
                : <span>📜 Scroll · pinch to zoom · tap <strong>Extract ↓</strong></span>
              }
            </div>
            <div className="browser-assist-zoom-controls browser-assist-zoom-inline">
              <button className="browser-assist-zoom-btn" onClick={() => setIframeZoom(Math.max(40, iframeZoom - 15))} disabled={iframeZoom <= 40} aria-label="Zoom out">−</button>
              <button className="browser-assist-zoom-btn browser-assist-zoom-fit" onClick={() => setIframeZoom(85)}>Fit</button>
              <span className="browser-assist-zoom-display" aria-live="polite">{iframeZoom}%</span>
              <button className="browser-assist-zoom-btn browser-assist-zoom-full" onClick={() => setIframeZoom(100)}>1:1</button>
              <button className="browser-assist-zoom-btn" onClick={() => setIframeZoom(Math.min(250, iframeZoom + 15))} disabled={iframeZoom >= 250} aria-label="Zoom in">+</button>
            </div>
            <button
              className={`browser-assist-clear-btn ${clearingClutter ? 'clearing' : ''}`}
              onClick={handleClearClutter}
              disabled={clearingClutter || phase === 'extracting'}
            >
              {clearingClutter ? '✓ Cleared!' : '🧹 Clear Clutter'}
            </button>
          </div>

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

          <div className="browser-assist-actions">
            <button
              className="btn-primary browser-assist-extract-btn"
              onClick={handleExtraction}
              disabled={phase === 'extracting'}
            >
              {phase === 'extracting' ? '⏳ AI Reading…' : '📥 Extract Recipe'}
            </button>
            {bannerRecipe && (
              <button className="btn-accent" onClick={() => { setAutoRecipe(bannerRecipe); setBannerRecipe(null); setPhase('preview'); }}>
                ✅ Use Auto-Result
              </button>
            )}
            <button className="btn-secondary" onClick={onFallbackToText} disabled={phase === 'extracting'}>← Back</button>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {phase === 'error' && (
        <div className="browser-assist-error">
          <p className="error-text">{errorMsg}</p>
          <button className="btn-primary" onClick={onFallbackToText}>← Back to Import</button>
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
  /^instagram\s+\w/i,
  /verified\s*[·•·]\s*(view\s+profile|follow)/i,
  /^view profile$/i,
  /^play$/i,
  /^watch on instagram/i,
  /^(share|like|comment|save|explore|reels?)$/i,
  /^\d+\s*(likes?|followers?|following|comments?|views?)/i,
  /^follow$/i,
];

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

function hasRealContent(recipe) {
  if (!recipe) return false;
  const ings = recipe.ingredients || [];
  const dirs = recipe.directions || [];
  const realIngs = ings.filter(i => !isPlaceholderLine(i));
  const realDirs = dirs.filter(d => !isPlaceholderLine(d));
  if (realIngs.length < 1 && realDirs.length < 1) return false;
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

function isUsableImageUrl(u) {
  if (!u || !u.startsWith('http')) return false;
  if (/profile_pic|avatar|logo|icon|emoji|tracking|pixel|blank|1x1|spinner/i.test(u)) return false;
  if (/\/s\d{2,3}x\d{2,3}\//.test(u)) return false;
  if (/\.gif$/i.test(u)) return false;
  return true;
}

function extractImageUrlsFromHtml(html) {
  const urls = [];
  const seen = new Set();
  function addUrl(u) {
    const clean = u.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (isUsableImageUrl(clean) && !seen.has(clean)) { urls.push(clean); seen.add(clean); }
  }
  const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i);
  if (ogM?.[1]) addUrl(ogM[1]);
  const twM = html.match(/<meta[^>]+name\s*=\s*["']twitter:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']twitter:image["']/i);
  if (twM?.[1]) addUrl(twM[1]);
  for (const m of html.matchAll(/"image"\s*:\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*\[\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_src"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"media_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"cover_image_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"poster"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  const embedImgM = html.match(/<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*EmbedImage[^"]*"/i);
  if (embedImgM?.[1]) addUrl(embedImgM[1]);
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/[^"]{20,})"/gi)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/\d{3,4}[x_]\d{3,4}|\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) addUrl(u);
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(['"]?(https:\/\/[^'")\s]{20,})['"]?\)/gi)) {
    addUrl(m[1]);
  }
  return urls.slice(0, 8);
}

function extractFromRawHtml(html, sourceUrl) {
  let caption = '';
  const captionPatterns = [
    /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    /data-caption[^>]*>([\s\S]*?)<\//i,
    /<article[^>]*>([\s\S]{100,}?)<\/article>/i,
  ];
  for (const re of captionPatterns) {
    const m = re.exec(html);
    if (m && m[1]) {
      const text = stripHtml(m[1]);
      if (text.length > 30) { caption = text; break; }
    }
  }
  if (!caption) {
    const dataPatterns = [
      /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
      /"caption_text"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
      /"accessibility_caption"\s*:\s*"([^"]{30,}(?:\\.[^"]*)*)"/,
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
  if (!caption) {
    const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i);
    if (ogM && ogM[1] && ogM[1].length > 30) {
      caption = ogM[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
  }
  if (!caption) {
    const metaM = html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i);
    if (metaM && metaM[1] && metaM[1].length > 30) {
      caption = metaM[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
  }
  if (!caption || caption.length < 30) return null;
  if (/^\d+[\s,]*(likes?|comments?|views?)/i.test(caption)) return null;
  if (/^[\d,.]+\s*(Likes?|Comments?)/i.test(caption)) return null;
  const parsed = parseCaption(caption);
  if (!parsed) return null;
  let imageUrl = extractBestImageFromHtml(html);
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
  return cleanRecipe({ name, ingredients: parsed.ingredients.length ? parsed.ingredients : [], directions: parsed.directions.length ? parsed.directions : [], imageUrl, link: sourceUrl });
}

function extractBestImageFromHtml(html) {
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
    if (/profile_pic|avatar|logo|icon|s\d{2,3}x\d{2,3}/i.test(src)) continue;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    const priority = (w > 200 && h > 200) ? 2 : (w > 50 || h > 50) ? 1 : 0;
    candidates.push({ url: src, priority });
  }
  return candidates.sort((a, b) => b.priority - a.priority).map(c => c.url).slice(0, 5);
}
