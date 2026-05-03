import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { 
  extractRecipeFromDOM, 
  parseCaption, 
  extractWithBrowserAPI, 
  detectRecipePlugins, 
  isSocialMediaUrl, 
  getSocialPlatform, 
  scoreExtractionConfidence, 
  structureWithAI, 
  captionToRecipe, 
  cleanSocialCaption, 
  isCaptionWeak, 
  smartClassifyLines, 
  isWeakResult, 
  parseRecipeHybrid, 
  parseVisualJSON,
  importRecipeFromUrl,
  importFromInstagram,
  parseHtml
} from '../recipeParser';
import { fetchHtmlViaProxy, proxyImageUrl, cleanUrl } from '../api';
import { queueRecipeImport } from '../db';
import useOnlineStatus from '../hooks/useOnlineStatus';


/**
 * BrowserAssist â€” Smart recipe extraction with full pipeline UI.
 *
 * Strategy:
 *   SOCIAL MEDIA (Instagram, TikTok, YouTube, etc.):
 *     1. Instagram embed page (fast, server-side HTML, no Puppeteer)
 *     2. AI Browser (Puppeteer headless Chrome)
 *     3. Video subtitles (yt-dlp)
 *     4. Gemini AI structuring on any captured text
 *     â†’ Success: preview
 *     â†’ All fail: manual paste card (NO broken iframe)
 *
 *   RECIPE BLOGS / OTHER URLS:
 *     1. extractWithBrowserAPI (JSON-LD, microdata, heuristics)
 *     2. Gemini AI on full page text
 *     â†’ Success: preview
 *     â†’ Fail: iframe fallback (works for real HTML pages)
 *
 * Props:
 *   url                - Page URL
 *   onRecipeExtracted  - callback(recipe) on success
 *   onFallbackToText   - callback() when user wants Paste Text
 *   onError            - callback({ message, originalError }) when visual scrape fails
 *   onBlocksSelected   - callback(selectedIds: string[]) when user changes block selection
 *
 * Ref (via forwardRef):
 *   triggerVisualScrape() â€” kick off visual scrape from parent without requiring a button click
 */
const BrowserAssist = forwardRef(function BrowserAssist({ url, onRecipeExtracted, onFallbackToText, initialCapturedText = '', seedRecipe = null, type = 'meal', defaultVisualMode = false, onError, onBlocksSelected }, ref) {
  const API_BASE = import.meta.env.VITE_API_BASE || '';
  const { isOnline } = useOnlineStatus();

  // phases:
  //   'loading'    â€” fetching / running pipeline (shown during work)
  //   'preview'    â€” auto-extracted recipe ready for review
  //   'iframe'     â€” showing page in iframe (non-social fallback only)
  //   'manual'     â€” all social methods failed, show manual paste card
  //   'offline'    â€” device offline
  //   'queued'     â€” recipe queued for offline import
  //   'error'      â€” unrecoverable error
  //   'extracting' â€” manual extraction from iframe in progress
  const [phase, setPhase] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  // Incrementing this re-triggers the extraction effect without a page reload
  const [retryCount, setRetryCount] = useState(0);

  // â”€â”€ Recipe extraction state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [autoRecipe, setAutoRecipe] = useState(null);
  const [queuedRecipe, setQueuedRecipe] = useState(null);

  // â”€â”€ Pipeline progress (social media flow) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each step: { label, status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' }
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [pipelineMessage, setPipelineMessage] = useState('');

  // â”€â”€ Manual paste card state (fallback when pipeline fails) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [manualText, setManualText] = useState(initialCapturedText);
  const [isParsingManual, setIsParsingManual] = useState(false);
  const [manualError, setManualError] = useState('');

  // â”€â”€ iframe state (non-social recipe blogs only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Paprika-style aim-the-parser state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // aimMode: when true, a tap inside the iframe routes that element's text
  // straight to the parser instead of navigating the page.
  const [aimMode, setAimMode] = useState(false);
  const aimModeRef = useRef(false);
  useEffect(() => { aimModeRef.current = aimMode; }, [aimMode]);
  // The bin the next tap will drop into: 'auto' | 'title' | 'ingredients' | 'directions'
  const [aimTarget, setAimTarget] = useState('auto');
  const aimTargetRef = useRef('auto');
  useEffect(() => { aimTargetRef.current = aimTarget; }, [aimTarget]);
  // A running partial recipe built up from tap-to-aim actions. Merged with
  // whatever the page scraper produces when the user hits Extract.
  const [aimRecipe, setAimRecipe] = useState(null);
  // Toast shown briefly after a successful aim-tap, e.g. "Added 3 ingredients".
  const [aimToast, setAimToast] = useState('');
  const [deepModeToggle, setDeepModeToggle] = useState(false); // for Purple V manual override
// Purple V click handler (already exists from Paprika)
const toggleDeepMode = () => {
  setDeepModeToggle(!deepModeToggle);
  // Optionally trigger import immediately in deep mode
};

  // â”€â”€ Visual scrape mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // defaultVisualMode prop auto-enables visual parse for social URLs (IG/TikTok)
  // since those sites need layout-based detection most.
  const [visualScrapeMode, setVisualScrapeMode] = useState(defaultVisualMode);
  const [visualScrapeRunning, setVisualScrapeRunning] = useState(false);
  // Classified blocks returned by the server's parseVisualPayload â€” used to
  // render color-coded overlays inside the iframe scale wrapper. Client trusts
  // the server's type field and never re-classifies.
  // type: 'title' (yellow) | 'ingredient' (green) | 'instruction' (purple) | 'caption' (orange) | 'other'
  const [visualBlocks, setVisualBlocks] = useState([]);
  // IDs of blocks the user has clicked to select (format: block array index as string)
  const [selectedBlockIds, setSelectedBlockIds] = useState([]);

  const isSocial = isSocialMediaUrl(url);
  const platform = isSocial ? getSocialPlatform(url) : '';

  // â”€â”€ Pulsing loading text animation (non-social loading phase) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Pinch-to-zoom support for mobile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  }, []); // intentionally empty â€” uses ref for current zoom

  // â”€â”€ Aim-parser: parent â†” iframe message bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Receives spicehub:aim-pick messages (the user tapped a region in the iframe)
  // and routes that text through the heuristic parser to build up aimRecipe.
  useEffect(() => {
    const handleMessage = (evt) => {
      const data = evt?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'spicehub:aim-mode') {
        setAimMode(!!data.on);
        return;
      }
      if (data.type !== 'spicehub:aim-pick') return;
      const text = (data.text || '').trim();
      if (!text || text.length < 4) return;
      // Route the captured text into the current aim target bin.
      // 'auto' mode lets parseCaption + smartClassifyLines decide ing vs dir.
      setAimRecipe(prev => mergeAimedText(prev || {}, text, aimTargetRef.current, url));
      // Quick toast so user knows the tap registered
      setAimToast(`Added to ${aimTargetRef.current === 'auto' ? 'recipe' : aimTargetRef.current}`);
      setTimeout(() => setAimToast(''), 1600);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [url]);

  // â”€â”€ Sync React aim-mode state INTO the iframe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // When the user toggles aim mode from the OUTER React toolbar, we need to
  // tell the injected handler so its capture-phase listener starts firing.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;
    win.__spicehubAimOn = aimMode;
    doc.documentElement?.setAttribute('data-spicehub-aim', aimMode ? '1' : '0');
    if (doc.documentElement) doc.documentElement.style.cursor = aimMode ? 'crosshair' : '';
    // Also update the inner toolbar's aim button label
    const aimBtn = doc.querySelector('[data-spicehub-btn="aim"]');
    if (aimBtn) {
      aimBtn.textContent = aimMode ? 'âœ– Stop aim' : 'ðŸŽ¯ Aim parser';
      aimBtn.style.background = aimMode ? '#E53935' : '#2196F3';
    }
  }, [aimMode, htmlContent]);

  // â”€â”€ Notify parent when block selection changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Parent can store selected block IDs for future "refine selected blocks" UX.
  useEffect(() => {
    if (typeof onBlocksSelected === 'function') {
      onBlocksSelected(selectedBlockIds);
    }
  }, [selectedBlockIds, onBlocksSelected]);

  // â”€â”€ Helper: update a specific pipeline step â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stepUpdater = useRef(null);
  useEffect(() => {
    stepUpdater.current = (idx, status, msg) => {
      setPipelineSteps(prev => {
        const next = prev.map((s, i) => i === idx ? { ...s, status, message: msg || '' } : s);
        return next;
      });
      if (msg !== undefined) setPipelineMessage(msg);
    };
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Main extraction effect
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  useEffect(() => {
    if (!isOnline) { setPhase('offline'); return; }

    let cancelled = false;

    (async () => {
      try {
        setPhase('loading');

        const isInsta = /instagram\.com/i.test(url);

        // ── Instagram: use the unified importFromInstagram engine ──────────────────
        // This engine tries both /p/ and /reel/ embed URL patterns, extracts rawPageText
        // as Gemini fallback, and runs Phase 3 (Gemini AI) on any captured text.
        // Pipeline steps map to: Phase 0 = video subs (skipped), Phase 1 = embed,
        // Phase 2 = AI browser (skipped), Phase 3 = Gemini structuring.
        if (isInsta) {
          // Initialise pipeline steps for display (Phase 0 and 2 are known-skipped)
          setPipelineSteps([
            { label: 'Video subtitles', status: 'skipped', message: 'Server unavailable' },
            { label: 'Caption fetch',   status: 'pending',  message: '' },
            { label: 'AI browser',      status: 'pending',  message: '' },
            { label: 'AI structuring',  status: 'pending',  message: '' },
          ]);
          setPipelineMessage('Scanning Instagram post...');

          const result = await importFromInstagram(url,
            (phase, status, msg) => {
              if (cancelled) return;
              setPipelineSteps(prev => {
                const next = [...prev];
                if (next[phase]) next[phase] = { ...next[phase], status, message: msg || '' };
                return next;
              });
              if (msg) setPipelineMessage(msg);
            },
            { type }
          );

          if (cancelled) return;

          if (result && !result._needsManualCaption && !result._error) {
            setAutoRecipe(cleanRecipe(result));
            setPhase('preview');
            return;
          }

          // All phases exhausted — show manual paste fallback
          setPipelineMessage('Could not extract recipe — please paste the caption manually.');
          setPhase('manual');
          return;
        }

        // ── Non-Instagram: fetch HTML via CORS proxy, run AI, show iframe ──────────
        let fetchUrl = cleanUrl(url);
        setExtractionProgress({ step: 1, total: 3, message: 'Fetching page content...' });

        let html = '';
        try {
          html = await fetchHtmlViaProxy(fetchUrl, 35000);
        } catch (err) {
          console.warn('[BrowserAssist] Proxy fetch failed:', err);
        }

        if (cancelled) return;

        // If proxy failed or returned garbage, fall back to direct iframe source
        // (might be blocked by X-Frame-Options, but better than nothing)
        if (!html || html.length < 500) {
          console.log('[BrowserAssist] Proxy failed, falling back to direct iframe source');
          setHtmlContent('');
          setPhase('iframe');
          return;
        }

        setRawHtml(html);
        const sanitized = sanitizeHtmlForEmbed(html, fetchUrl);
        setHtmlContent(sanitized);

        const visibleText = stripHtmlToText(html);
        const imageUrls = extractImageUrlsFromHtml(html);

        // If seedRecipe was provided (from ImportModal's synchronous JSON-LD parse),
        // skip re-parsing and go straight to the iframe for visual review.
        if (!seedRecipe) {
          // JSON-LD short-circuit: try structured data first (fast, no AI cost).
          // If we get a strong result with ≥3 ingredients, use it directly.
          try {
            const jsonLdRecipe = parseHtml(html, url);
            if (!cancelled && jsonLdRecipe && !isWeakResult(jsonLdRecipe)) {
              setAutoRecipe(cleanRecipe(jsonLdRecipe));
              setPhase('preview');
              return;
            }
          } catch { /* fall through to AI */ }

          setExtractionProgress({ step: 2, total: 3, message: '✨ AI analyzing full page...' });
          try {
            const aiRecipe = await structureWithAI(visibleText, { imageUrl: imageUrls[0] || '', sourceUrl: url });
            if (!cancelled && aiRecipe && hasRealContent(aiRecipe)) {
              setAutoRecipe(cleanRecipe(aiRecipe));
              setPhase('preview');
              return;
            }
          } catch { /* fall through to iframe */ }
        }

        if (!cancelled) {
          if (visibleText.length < 50) {
            setErrorMsg('The website blocked access or requires JavaScript to load. Please use the "Paste Text" tab.');
            setPhase('error');
          } else {
            setExtractionProgress({ step: 3, total: 3, message: 'Showing page for manual extraction' });
            setPhase('iframe');
          }
        }

      } catch (err) {
        if (!cancelled) {
          setErrorMsg('Failed to load page: ' + err.message);
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isOnline, retryCount]);

  // â”€â”€ Manual paste â†’ AI parse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleParseManual = useCallback(async () => {
    const text = manualText.trim();
    if (text.length < 20) {
      setManualError('Please paste more recipe text (at least a few ingredients or steps).');
      return;
    }
    setIsParsingManual(true);
    setManualError('');
    try {
      const recipe = await captionToRecipe(text, { sourceUrl: url, type });
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

  // â”€â”€ Retry pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Increments retryCount to re-trigger the extraction useEffect cleanly â€”
  // no page reload, full waterfall restarts from step 1 (subtitle scan first).
  const handleRetry = useCallback(() => {
    setManualText('');
    setManualError('');
    setAutoRecipe(null);
    setBannerRecipe(null);
    setHtmlContent('');
    setRawHtml('');
    setErrorMsg('');
    setPipelineSteps([]);
    setPipelineMessage('');
    setExtractionProgress({ step: 0, total: 0, message: '' });
    setPhase('loading');
    setRetryCount(c => c + 1); // triggers extraction useEffect
  }, []);

  // â”€â”€ Clear Clutter (iframe only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // ——— Expand captions from outer React toolbar —————————————————————————————————
  // Runs the caption-expander on the iframe document. We also kick it on a
  // short timer in case the site lazy-renders the "more" button after a beat.
  const [expandedCount, setExpandedCount] = useState(null);
  const handleExpandCaptions = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    let total = 0;
    try { total += runCaptionExpander(doc); } catch { /* ignore */ }
    // Second pass after 400ms — some sites defer render
    setTimeout(() => {
      try {
        const d2 = iframeRef.current?.contentDocument;
        if (d2) total += runCaptionExpander(d2);
      } catch { /* ignore */ }
      setExpandedCount(total);
      setTimeout(() => setExpandedCount(null), 2000);
    }, 400);
  }, []);

  // ——— Aim-mode toggle from outer React toolbar ————————————————————————————————
  const handleToggleAim = useCallback(() => {
    setAimMode(prev => !prev);
  }, []);

  // ——— Clear the running aim-recipe draft ——————————————————————————————————————
  const handleResetAim = useCallback(() => {
    setAimRecipe(null);
    setAimToast('Cleared');
    setTimeout(() => setAimToast(''), 1400);
    // Also clear any highlighted elements inside the iframe
    try {
      const doc = iframeRef.current?.contentDocument;
      doc?.querySelectorAll('[data-spicehub-aimed]').forEach(el => {
        el.removeAttribute('data-spicehub-aimed');
      });
    } catch { /* ignore */ }
  }, []);

  // ——— iframe onLoad: inject floating toolbar + aim-capture bridge —————————————
  // The srcDoc iframe is same-origin from the parent's perspective, so we can
  // inject scripts and DOM freely. We add THREE interactive overlays:
  //
  //   1. Floating toolbar   — Extract / Expand / Aim buttons (touch-friendly,
  //                            always visible, min 56px hit targets).
  //   2. Expand-caption JS  — auto-taps 'more' / '...' / 'read more' buttons
  //                            commonly used on IG/TikTok/FB/YT to unfurl long
  //                            captions. Runs a few passes over ~3s.
  //   3. Aim-parser bridge  — installs a capture-phase click listener that,
  //                            when aim mode is active, intercepts taps and
  //                            postMessage()s the tapped element's text to
  //                            the parent React tree instead of navigating.
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc || !doc.body) return;

      // Clean up previous injections (onLoad fires on every srcDoc swap)
      ['spicehub-toolbar', 'spicehub-helper', 'spicehub-aim-style', 'spicehub-extract-btn']
        .forEach(id => doc.getElementById(id)?.remove());

      // ——— 1. Inject floating toolbar ——————————————————————————————————————————
      const tb = doc.createElement('div');
      tb.id = 'spicehub-toolbar';
      tb.style.cssText = [
        'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'display:flex', 'gap:8px', 'padding:8px',
        'background:rgba(20,20,20,0.92)', 'border-radius:16px',
        'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
        'font-family:-apple-system,system-ui,sans-serif',
        'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
        'max-width:calc(100vw - 16px)', 'flex-wrap:wrap', 'justify-content:center',
      ].join(';');
      const makeBtn = (label, bg, onClick, testId) => {
        const b = doc.createElement('button');
        b.textContent = label;
        b.dataset.spicehubBtn = testId || label;
        b.style.cssText = [
          'min-width:56px', 'min-height:56px', 'padding:0 16px',
          `background:${bg}`, 'color:white', 'border:none', 'border-radius:12px',
          'font-size:14px', 'font-weight:700', 'cursor:pointer',
          'touch-action:manipulation', '-webkit-tap-highlight-color:transparent',
          'white-space:nowrap',
        ].join(';');
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick(b);
        });
        return b;
      };
      const extractBtn = makeBtn('📥 Download Recipe', '#4CAF50', () => {
        if (extractionRef.current) extractionRef.current();
      }, 'extract');
      const expandBtn = makeBtn('⬇ Expand captions', '#FF9800', (btn) => {
        // Visual feedback while we hunt for "more" buttons
        btn.textContent = '⏳ Expanding...';
        const results = runCaptionExpander(doc);
        btn.textContent = results > 0 ? `✓ Expanded ${results}` : '⚠ None found';
        setTimeout(() => { btn.textContent = '⬇ Expand captions'; }, 2200);
      }, 'expand');
      const aimBtn = makeBtn('🎯 Aim parser', '#2196F3', (btn) => {
        // Toggle aim mode. Communicate both ways via window.__spicehubAimOn flag.
        const on = !doc.defaultView.__spicehubAimOn;
        doc.defaultView.__spicehubAimOn = on;
        btn.textContent = on ? '✖ Stop aim' : '🎯 Aim parser';
        btn.style.background = on ? '#E53935' : '#2196F3';
        try {
          window.postMessage({ type: 'spicehub:aim-mode', on }, '*');
        } catch { /* non-fatal */ }
        // Visual highlight of aim mode on the page
        doc.documentElement.style.cursor = on ? 'crosshair' : '';
      }, 'aim');
      tb.appendChild(extractBtn);
      tb.appendChild(expandBtn);
      tb.appendChild(aimBtn);
      doc.body.appendChild(tb);

      // ——— 2. Ephemeral hint banner ——————————————————————————————————————————
      const helper = doc.createElement('div');
      helper.id = 'spicehub-helper';
      helper.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
        'background:rgba(33,150,243,0.96)', 'color:white',
        'padding:10px 16px', 'font-size:13px',
        'font-family:-apple-system,system-ui,sans-serif',
        'text-align:center', 'line-height:1.4',
      ].join(';');
      helper.textContent = '💡 Tap ⬇ to unfurl captions, 🎯 to point at a recipe block, then 📥 Extract.';
      doc.body.appendChild(helper);
      setTimeout(() => {
        if (helper.parentNode) {
          helper.style.transition = 'opacity 0.5s';
          helper.style.opacity = '0';
          setTimeout(() => helper.remove(), 500);
        }
      }, 5500);

      // ——— 3. Aim-parser style (highlights hoverable blocks in aim mode) ————————
      const style = doc.createElement('style');
      style.id = 'spicehub-aim-style';
      style.textContent = `
        html[data-spicehub-aim="1"] *:hover {
          outline: 3px solid #2196F3 !important;
          outline-offset: 2px !important;
          background-color: rgba(33,150,243,0.08) !important;
        }
        [data-spicehub-aimed="1"] {
          outline: 3px solid #4CAF50 !important;
          outline-offset: 2px !important;
        }
      `;
      doc.head?.appendChild(style);

      // ——— 4. Capture-phase click interceptor for aim mode —————————————————————
      // Installed ONCE per iframe load. Reads window.__spicehubAimOn flag
      // so toggling aim mode doesn't require re-injecting.
      const aimHandler = (e) => {
        const win = doc.defaultView;
        if (!win || !win.__spicehubAimOn) return;
        // Ignore taps on our own toolbar/helper
        let el = e.target;
        while (el && el !== doc.body) {
          if (el.id === 'spicehub-toolbar' || el.id === 'spicehub-helper') return;
          el = el.parentElement;
        }
        e.preventDefault();
        e.stopPropagation();
        const target = e.target?.closest?.('li,p,div,span,h1,h2,h3,h4,article,section,ul,ol,figcaption') || e.target;
        if (!target) return;
        target.setAttribute('data-spicehub-aimed', '1');
        // Collect text — prefer innerText for rendered order, fall back to textContent
        const text = (target.innerText || target.textContent || '').trim();
        const html = target.outerHTML || '';
        try {
          window.postMessage({
            type: 'spicehub:aim-pick',
            text: text.slice(0, 8000),
            html: html.slice(0, 16000),
            tag: target.tagName,
          }, '*');
        } catch { /* non-fatal */ }
      };
      doc.addEventListener('click', aimHandler, true);
      // Also catch touchend for better mobile responsiveness
      doc.addEventListener('touchend', aimHandler, true);
      // Update html[data-spicehub-aim] for the CSS highlight
      const aimObserver = new ((doc.defaultView?.MutationObserver) || window.MutationObserver)(() => {});
      doc.defaultView?.addEventListener('message', (evt) => {
        if (evt.data?.type === 'spicehub:aim-mode-sync') {
          doc.documentElement.setAttribute('data-spicehub-aim', evt.data.on ? '1' : '0');
        }
      });

      // ——— 5. Auto-run caption expander on first load for social media ————————
      // (One pass only — user can hit the Expand button to run again)
      if (isSocial) setTimeout(() => runCaptionExpander(doc), 900);
    } catch (err) {
      console.warn('[BrowserAssist] Could not inject into iframe:', err);
    }
  }, [isSocial]);

  // ——— Visual scrape — Paprika-style DOM walker ————————————————————————————————
  // Walks the iframe's DOM, captures text nodes with computed styles + bounding
  // rects, then POSTs to /api/import/visual-parse for server-side layout-based
  // extraction. The server returns { recipe, blocks } — blocks already have a
  // `type` field set by the server's heuristics. The client NEVER re-classifies;
  // it only renders overlays based on server types. Falls back silently to the
  // existing extraction flow on any failure.
  //
  // Visual scrape contract:
  //   POST /api/import/visual-parse  ←  { url, viewport, scrollY, nodes[] }
  //   Response                       → { recipe, blocks: [{text, rect, type, style}] }
  //   block.type: 'title' | 'ingredient' | 'instruction' | 'caption' | 'other'
  const runVisualScrape = useCallback(async () => {
    setVisualScrapeRunning(true);




    // For social URLs, show visual-mode toast immediately — layout detection is
    // the primary strategy for IG/TikTok/Reels where CSS selectors fail.
    const isSocial = isSocialMediaUrl(url);
    setAimToast(isSocial
      ? 'Visual parse active — detecting structure by layout'
      : 'Scanning page layout...');
    setTimeout(() => setAimToast(''), 3000);

    try {
      const iframe = iframeRef.current;
      if (!iframe) throw new Error('No iframe');

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error('Cannot access iframe document');

      // DOM walker — injected as a string and eval'd via iframe.contentWindow
      // (allowed because sandbox has allow-same-origin + allow-scripts).
      // Captures text nodes with computed styles + bounding rects.
      const walkerScript = `(function() {
        var nodes = [];
        var viewport = { width: window.innerWidth, height: window.innerHeight };
        var SKIP = {'SCRIPT':1,'STYLE':1,'NOSCRIPT':1,'HEAD':1,'META':1,'LINK':1,'TITLE':1,'SVG':1,'PATH':1};
        function walk(el, depth) {
          if (!el || SKIP[el.tagName]) return;
          var childNodes = el.childNodes;
          for (var i = 0; i < childNodes.length; i++) {
            var child = childNodes[i];
            if (child.nodeType === 3) { // TEXT_NODE
              var text = child.textContent ? child.textContent.trim() : '';
              if (text.length < 3) continue;
              var rect = el.getBoundingClientRect();
              if (rect.width < 20 || rect.height < 8) continue;
              var style = window.getComputedStyle(el);
              var fs = parseFloat(style.fontSize) || 14;
              if (fs < 10) continue;
              nodes.push({
                text: text,
                tagName: el.tagName,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) },
                style: {
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  color: style.color,
                  backgroundColor: style.backgroundColor,
                  lineHeight: style.lineHeight,
                },
                depth: depth,
                zIndex: parseInt(style.zIndex) || 0
              });
            }
          }
          if (el.tagName === 'IMG' && el.src) {
            var r = el.getBoundingClientRect();
            if (r.width > 80 && r.height > 80) {
              nodes.push({ text: el.alt || '', tagName: 'IMG', src: el.src, rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) }, style: {}, depth: depth, zIndex: 0 });
            }
          }
          var children = el.children;
          for (var j = 0; j < children.length; j++) walk(children[j], depth + 1);
        }
        walk(document.body, 0);
        // Cap at 800 nodes for < 50ms latency
        var visible = nodes.filter(function(n) { return n.rect.top < viewport.height * 4; }).slice(0, 800);
        return JSON.stringify({ url: window.location.href, viewport: viewport, scrollY: Math.round(window.scrollY), nodes: visible });
      })()`;

      let visualJson;
      try {
        const result = iframe.contentWindow.eval(walkerScript);
        visualJson = JSON.parse(result);
      } catch (evalErr) {
        throw new Error('DOM walker failed: ' + evalErr.message);
      }

      if (!visualJson?.nodes?.length) throw new Error('No text nodes captured');

      // Payload size guard — trim if > 400KB to keep latency low
      if (JSON.stringify(visualJson).length > 400000) {
        visualJson = { ...visualJson, nodes: visualJson.nodes.slice(0, 400) };
      }

      // Step 2: Run the client-side visual parser (replaces server/visual-parse)
      const { recipe, blocks: serverBlocks, confidence } = parseVisualJSON(visualJson, url);

      // Store classified blocks so the iframe overlay layer can render them.
      if (Array.isArray(serverBlocks) && serverBlocks.length > 0) {
        setVisualBlocks(serverBlocks);
        setSelectedBlockIds([]); 
      }

      // Step 3: If confident, return immediately
      if (recipe && confidence >= 0.75) {
        setVisualScrapeRunning(false);
        onRecipeExtracted(recipe);
        return;
      }

      // Step 4: Low confidence -> try Hybrid (Gemini) directly from client
      setAimToast('Low layout confidence — calling Gemini AI to assist...');
      const hybridResult = await parseRecipeHybrid(visualJson.nodes, '', url);

      if (hybridResult && !isWeakResult(hybridResult)) {
        setVisualScrapeRunning(false);
        onRecipeExtracted(hybridResult);
        return;
      }

      // Weak result — show overlays so user can aim at what the parser missed
      setAimToast('Partial result — overlays highlight detected blocks; tap 🎯 to fill gaps');
      setTimeout(() => setAimToast(''), 4000);
    } catch (err) {
      console.warn('[BrowserAssist] Visual scrape failed, falling back:', err.message);
      // Notify parent so it can show a retry toast
      if (typeof onError === 'function') {
        onError({ message: 'Visual parse failed — falling back to text extraction', originalError: err });
      }
      setAimToast('Visual parse unavailable — using standard mode');
      setTimeout(() => setAimToast(''), 2500);
    }

    setVisualScrapeRunning(false);
    // Fall through: continue with existing extraction flow
    extractionRef.current?.();
  }, [url, type, onRecipeExtracted, onError, API_BASE]);

  // ——— Expose triggerVisualScrape to parent via ref ———————————————————————
  // ImportModal calls browserAssistRef.current.triggerVisualScrape() when the
  // user clicks "Analyze Visually" — no prop-drilling of a callback needed.
  useImperativeHandle(ref, () => ({
    triggerVisualScrape: () => runVisualScrape(),
  }), [runVisualScrape, ref]);


  // ——— Manual extraction from iframe ——————————————————————————————————————————
  const handleExtraction = useCallback(async () => {
    setPhase('extracting');
    setBannerRecipe(null);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.body) throw new Error('Cannot read page content');
      const visibleText = extractVisibleTextFromDoc(doc);
      const imageUrls = extractImageUrlsFromDoc(doc);
      const fullHtml = doc.documentElement?.outerHTML || '';
      setExtractionProgress({ step: 1, total: 3, message: 'Reading page content...' });
      const browserApiResult = extractWithBrowserAPI({ html: fullHtml, visibleText, imageUrls, sourceUrl: url });
      const regexRecipe = rawHtml ? extractFromRawHtml(rawHtml, url) : null;
      const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);
      const heuristicResult = pickBestRecipe(pickBestRecipe(browserApiResult, regexRecipe), domRecipe);
      setExtractionProgress({ step: 2, total: 3, message: '✨ Google AI parsing text...' });
      let aiRecipe = null;
      try {
        aiRecipe = await captionToRecipe(visibleText.slice(0, 8000), { imageUrl: imageUrls[0] || '', sourceUrl: url, type });
      } catch { /* fall through */ }
      setExtractionProgress({ step: 3, total: 3, message: 'Sorting results...' });
      const best = (aiRecipe && hasRealContent(aiRecipe)) ? aiRecipe : heuristicResult;

      // Merge order (highest trust last):
      //   seedRecipe (auto-import partial)  →  heuristic/AI page scrape  →  aim-tapped text
      // User-tapped content always wins because it's explicit intent.
      const merged = mergeRecipeLayers(
        seedRecipe,
        best && hasRealContent(best) ? best : null,
        aimRecipe,
        url,
        aiRecipe ? 'ai-gemini-manual' : 'heuristic-manual',
      );
      if (merged && hasRealContent(merged)) {
        setAutoRecipe(cleanRecipe(merged));
        setPhase('preview');
        return;
      }

      // Truly nothing — keep user on the browser so they can tap-to-aim
      setPhase('iframe');
      setExtractionProgress({ step: 0, total: 0, message: '' });
      try {
        const tb = doc.getElementById('spicehub-toolbar');
        const extractBtnEl = tb?.querySelector('[data-spicehub-btn="extract"]');
        if (extractBtnEl) {
          extractBtnEl.textContent = '⚠ Nothing yet — tap 🎯 to aim';
          extractBtnEl.style.background = '#f44336';
          setTimeout(() => {
            if (extractBtnEl.parentNode) {
              extractBtnEl.textContent = '📥 Download Recipe';
              extractBtnEl.style.background = '#4CAF50';
            }
          }, 3500);
        }
      } catch { /* ignore */ }
    } catch (err) {
      setErrorMsg('Could not read page content: ' + err.message);
      setPhase('error');
    }
  }, [url, rawHtml, seedRecipe, aimRecipe]);

  useEffect(() => { extractionRef.current = handleExtraction; }, [handleExtraction]);

  // ——— Preview actions ——————————————————————————————————————————————————————————
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

  // ——— Offline queue ————————————————————————————————————————————————————————————
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

  // ════════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div className="browser-assist-container">

      {/* ——— Offline ——— */}
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

      {/* ——— Queued ——— */}
      {phase === 'queued' && queuedRecipe && (
        <div className="browser-assist-queued">
          <div className="queued-icon">⏳</div>
          <h3>Recipe Queued</h3>
          <p><strong>{queuedRecipe.name}</strong> will be imported when you're back online.</p>
          <button className="btn-primary" onClick={() => onRecipeExtracted && onRecipeExtracted(queuedRecipe)}>Close</button>
        </div>
      )}

      {/* ——— Loading (Pipeline in progress) ——— */}
      {phase === 'loading' && (
        <div className="browser-assist-loading">
          {isSocial ? (
            /* ——— Social: beautiful pipeline steps UI ——— */
            <div className="pipeline-container">
              <div className="pipeline-header">
                <span className="pipeline-platform-icon">
                  {platform === 'Instagram' ? '📸' : platform === 'TikTok' ? '🎵' : platform === 'YouTube' ? '▶️' : '🌐'}
                </span>
                <div>
                  <h3 className="pipeline-title">Importing from {platform}</h3>
                  <p className="pipeline-url">{url.length > 50 ? url.slice(0, 47) + '...' : url}</p>
                </div>
              </div>

              <div className="pipeline-steps">
                {pipelineSteps.map((step, i) => (
                  <div key={i} className={`pipeline-step pipeline-step--${step.status}`}>
                    <div className="pipeline-step-indicator">
                      {step.status === 'running' && <span className="pipeline-spinner" />}
                      {step.status === 'done' && <span className="pipeline-check">✓</span>}
                      {step.status === 'failed' && <span className="pipeline-x">✖</span>}
                      {step.status === 'skipped' && <span className="pipeline-skip">—</span>}
                      {step.status === 'pending' && <span className="pipeline-dot" />}
                    </div>
                    <div className="pipeline-step-content">
                      <div className="pipeline-step-label">{step.label}</div>
                      {step.message && <div className="pipeline-step-message">{step.message}</div>}
                    </div>
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
            /* ——— Non-social: simple loading indicator ——— */
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
                    {extractionProgress.step} / {extractionProgress.total} — {extractionProgress.message || '...'}
                  </p>
                </div>
              )}
              {!extractionProgress.total && (
                <p className="browser-assist-pulse-sub">This usually takes a few seconds...</p>
              )}
              <button className="btn-secondary" onClick={onFallbackToText} style={{ marginTop: 12 }}>
                Skip — Enter Manually
              </button>
            </>
          )}
        </div>
      )}

      {/* ——— Manual paste card (social fallback when all methods fail) ——— */}
      {phase === 'manual' && (
        <div className="browser-assist-manual">
          <div className="manual-header">
            <span className="manual-icon">📋</span>
            <h3>Paste Recipe Text</h3>
            <p className="manual-subtitle">
              Auto-extraction couldn't read this {platform || 'social'} post — open the post, copy the caption, then paste it below.
            </p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="manual-open-link"
              >
                🔗 Open {platform || 'post'} in browser →
              </a>
            )}
          </div>

          {pipelineSteps.length > 0 && (
            <details className="manual-pipeline-summary-details">
              <summary className="manual-pipeline-summary-toggle">What was tried</summary>
              <div className="manual-pipeline-summary">
                {pipelineSteps.map((step, i) => (
                  <div key={i} className={`manual-step-badge manual-step-badge--${step.status}`}>
                    {step.status === 'done' ? '✓' : step.status === 'failed' ? '✖' : '—'} {step.label}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="manual-tips">
            <ol>
              <li>Open the link above in your browser</li>
              <li>Tap <strong>… more</strong> to expand the full caption</li>
              <li>Long-press → <strong>Select All</strong> → Copy</li>
              <li>Paste below and tap <strong>Parse with AI →</strong></li>
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

      {/* ——— Auto-extracted preview (editable) ——— */}
      {phase === 'preview' && autoRecipe && (
        <div className="browser-assist-preview">
          <div className="browser-assist-preview-header">
            <span className="browser-assist-success-icon">✓</span>
            <span>Recipe found{autoRecipe.extractedVia ? ` via ${autoRecipe.extractedVia}` : ''}</span>
            {(() => {
              if (autoRecipe._hybridUsed === true && autoRecipe._hybridConfidence != null) {
                const pct = Math.round(autoRecipe._hybridConfidence * 100);
                return (
                  <span className="confidence-badge confidence-high">
                    ✦ Enhanced with Gemini • {pct}%
                  </span>
                );
              } else if (autoRecipe._hybridUsed === false && autoRecipe._hybridConfidence != null) {
                const pct = Math.round(autoRecipe._hybridConfidence * 100);
                const level = pct >= 75 ? 'high' : pct >= 50 ? 'medium' : 'low';
                return (
                  <span className={`confidence-badge confidence-${level}`}>
                    ⚡ Visual Parse • {pct}%
                  </span>
                );
              } else {
                const conf = scoreExtractionConfidence(autoRecipe);
                const level = conf >= 70 ? 'high' : conf >= 40 ? 'medium' : 'low';
                return (
                  <span className={`confidence-badge confidence-${level}`}>
                    {conf >= 70 ? 'High' : conf >= 40 ? 'Good' : 'Low'} confidence
                  </span>
                );
              }
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
                    <button className="preview-remove-btn" onClick={() => removePreviewListItem('ingredients', i)} title="Remove">✖</button>
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
                    <button className="preview-remove-btn" onClick={() => removePreviewListItem('directions', i)} title="Remove">✖</button>
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

      {/* ——— Browser view (non-social recipe blogs only) ——— */}
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
                <button className="btn-icon auto-banner-dismiss" onClick={() => setBannerRecipe(null)} title="Dismiss">✖</button>
              </div>
            </div>
          )}

          <div className="browser-assist-toolbar">
            <div className="browser-assist-toolbar-hint">
              {phase === 'extracting'
                ? <span>⏳ {extractionProgress.message || 'Analyzing...'}</span>
                : aimMode
                  ? <span>🎯 <strong>Aim mode on</strong> — tap the {aimTarget === 'auto' ? 'ingredients or directions' : aimTarget} on the page</span>
                  : <span>📜 Scroll · pinch to zoom · tap <strong>Download Recipe ↓</strong> or 🎯 Aim</span>
              }
            </div>
            <div className="browser-assist-zoom-controls browser-assist-zoom-inline">
              <button className="browser-assist-zoom-btn" onClick={() => setIframeZoom(Math.max(40, iframeZoom - 15))} disabled={iframeZoom <= 40} aria-label="Zoom out">－</button>
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

          {/* ——— Paprika-style power row: Expand captions + Aim parser ———————
              These are the controls the user specifically asked for. They mirror
              the floating buttons injected inside the iframe, but are bigger
              and always-visible in the parent UI so they can't be covered by
              the page's own overlays. */}
          <div className="browser-assist-power-row" style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '8px 12px',
            background: 'linear-gradient(180deg, rgba(33,150,243,0.08) 0%, rgba(33,150,243,0.03) 100%)',
            borderTop: '1px solid rgba(33,150,243,0.15)',
            borderBottom: '1px solid rgba(33,150,243,0.15)',
            alignItems: 'center',
          }}>
            <button
              type="button"
              onClick={handleExpandCaptions}
              disabled={phase === 'extracting'}
              style={{
                flex: '1 1 140px',
                minHeight: '48px',
                padding: '10px 14px',
                fontSize: '15px',
                fontWeight: 600,
                background: expandedCount != null ? '#43A047' : '#1976D2',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                transition: 'all 0.15s ease',
              }}
              aria-label="Expand all truncated captions on the page"
            >
              {expandedCount != null
                ? (expandedCount > 0 ? `✓ Expanded ${expandedCount}` : '✓ Already expanded')
                : '⬇ Expand captions'}
            </button>

            <button
              type="button"
              onClick={handleToggleAim}
              disabled={phase === 'extracting'}
              style={{
                flex: '1 1 140px',
                minHeight: '48px',
                padding: '10px 14px',
                fontSize: '15px',
                fontWeight: 700,
                background: aimMode ? '#E53935' : '#FB8C00',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: aimMode
                  ? '0 0 0 3px rgba(229,57,53,0.25), 0 2px 6px rgba(0,0,0,0.18)'
                  : '0 2px 6px rgba(0,0,0,0.12)',
                transition: 'all 0.15s ease',
              }}
              aria-pressed={aimMode}
              aria-label={aimMode ? 'Stop aiming the parser' : 'Start aiming the parser at specific parts of the page'}
            >
              {aimMode ? '✖ Stop aim' : '🎯 Aim parser'}
            </button>

            {/* Visual scrape mode toggle — Paprika-style layout detection */}
            <button
              type="button"
              onClick={() => setVisualScrapeMode(v => !v)}
              disabled={phase === 'extracting' || visualScrapeRunning}
              title={visualScrapeMode ? 'Visual parse mode active (click to disable)' : 'Enable visual parse mode (Paprika-style)'}
              aria-pressed={visualScrapeMode}
              aria-label="Toggle visual parse mode"
              style={{
                minWidth: '48px',
                minHeight: '48px',
                padding: '10px 12px',
                fontSize: '15px',
                fontWeight: 700,
                background: visualScrapeMode ? '#7B1FA2' : 'rgba(123,31,162,0.12)',
                color: visualScrapeMode ? 'white' : '#7B1FA2',
                border: visualScrapeMode ? 'none' : '2px solid #7B1FA2',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: visualScrapeMode ? '0 0 0 3px rgba(123,31,162,0.25), 0 2px 6px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {visualScrapeRunning ? '⏳' : 'V'}
            </button>

            {/* Aim target segmented control — only shown when aim mode is active */}
            {aimMode && (
              <div
                role="radiogroup"
                aria-label="Aim target"
                style={{
                  flex: '2 1 260px',
                  display: 'flex',
                  gap: '4px',
                  padding: '4px',
                  background: 'rgba(255,255,255,0.7)',
                  borderRadius: '10px',
                  border: '1px solid rgba(0,0,0,0.12)',
                }}
              >
                {[
                  { key: 'auto', label: 'Auto', title: 'Let the parser decide' },
                  { key: 'title', label: 'Title', title: 'Treat the tap as the recipe name' },
                  { key: 'ingredients', label: 'Ingredients', title: 'Send to ingredients list' },
                  { key: 'directions', label: 'Directions', title: 'Send to directions list' },
                ].map(opt => {
                  const active = aimTarget === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={opt.title}
                      onClick={() => setAimTarget(opt.key)}
                      style={{
                        flex: 1,
                        minHeight: '40px',
                        padding: '6px 8px',
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                        background: active ? '#1976D2' : 'transparent',
                        color: active ? 'white' : '#333',
                        border: 'none',
                        borderRadius: '7px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Aim progress badge — shows how much content the user has tapped */}
            {aimRecipe && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  background: 'white',
                  border: '1px solid #43A047',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#2E7D32',
                  fontWeight: 600,
                }}
              >
                <span>
                  {(aimRecipe.ingredients?.length || 0)} ing · {(aimRecipe.directions?.length || 0)} dir
                  {aimRecipe.name ? ' · title ✓' : ''}
                </span>
                <button
                  type="button"
                  onClick={handleResetAim}
                  title="Clear aim-tapped content"
                  aria-label="Clear aim-tapped content"
                  style={{
                    minWidth: '32px',
                    minHeight: '32px',
                    padding: '0 8px',
                    fontSize: '13px',
                    background: '#EF5350',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  ✖
                </button>
              </div>
            )}
          </div>

          {/* Aim toast — brief confirmation after a successful tap */}
          {aimToast && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                top: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 50,
                padding: '10px 18px',
                background: 'rgba(46,125,50,0.95)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '20px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
                animation: 'fadeInOut 1.6s ease-out forwards',
              }}
            >
              ✓ {aimToast}
            </div>
          )}

          <div className="browser-assist-iframe-container" aria-label="Recipe page — scroll and pinch to zoom">
            <div style={{
              transform: `scale(${iframeZoom / 100})`,
              transformOrigin: 'top left',
              width: `${Math.round(10000 / iframeZoom)}%`,
              transition: 'transform 0.12s ease-out, width 0.12s ease-out',
              willChange: 'transform',
              position: 'relative',
            }}>
              <iframe
                ref={iframeRef}
                title="Recipe Page"
                className="browser-assist-iframe"
                src={!htmlContent ? cleanUrl(url) : undefined}
                srcDoc={htmlContent || undefined}
                /* allow-scripts is intentional: sanitizeHtmlForEmbed strips ALL
                    <script> tags before content reaches here, so no recipe-site JS
                    runs. allow-scripts is required so Chrome 111+ loads external CSS
                    correctly inside srcDoc iframes and so our parent-injected
                    toolbar/aim-bridge event handlers actually fire. */
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={handleIframeLoad}
              />
              {/* Fallback help overlay for iframe blocks (e.g. SAMEORIGIN) */}
              {phase === 'iframe' && !htmlContent && (
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.9)',
                  padding: '40px 20px',
                  textAlign: 'center',
                  zIndex: 5,
                  pointerEvents: 'none', // Allow clicking iframe underneath
                  animation: 'fadeIn 0.5s ease-out 5s forwards', // Show after 5s
                  opacity: 0,
                }}>
                  <div style={{ pointerEvents: 'auto', maxWidth: 400 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
                    <h3 style={{ marginBottom: 12 }}>Site blocked direct view</h3>
                    <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
                      This recipe site prevents itself from being shown in other apps.
                      Use <b>Manual Paste</b> or try <b>Download Recipe</b> anyway.
                    </p>
                    <button 
                      onClick={onFallbackToText}
                      style={{
                        padding: '12px 24px',
                        background: '#1976D2',
                        color: 'white',
                        border: 'none',
                        borderRadius: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Use Manual Paste
                    </button>
                  </div>
                </div>
              )}

              {/* ——— Visual-scrape block overlays ——————————————————————————————
                  Rendered inside the scale wrapper so they use the same unscaled
                  coordinate space as the DOM walker rects (raw iframe CSS pixels).
                  Colors: title=yellow, ingredient=green, instruction=purple, caption=orange.
                  Clicking a block toggles its selection (tracked in selectedBlockIds). */}
              {visualBlocks.length > 0 && visualBlocks.map((block, idx) => {
                if (!block.rect || block.type === 'other') return null;
                const idStr = String(idx);
                const isSelected = selectedBlockIds.includes(idStr);
                const COLOR_MAP = {
                  title:       { bg: 'rgba(255,215,0,0.30)',  border: 'rgba(255,200,0,0.85)'  },
                  ingredient:  { bg: 'rgba(76,175,80,0.25)',  border: 'rgba(56,142,60,0.85)'  },
                  instruction: { bg: 'rgba(156,39,176,0.20)', border: 'rgba(123,31,162,0.85)' },
                  caption:     { bg: 'rgba(255,152,0,0.28)',  border: 'rgba(230,120,0,0.85)'  },
                };
                const colors = COLOR_MAP[block.type] || { bg: 'rgba(100,100,100,0.15)', border: 'rgba(100,100,100,0.5)' };
                return (
                  <div
                    key={idx}
                    title={`${block.type}: ${block.text}`}
                    onClick={() => {
                      setSelectedBlockIds(prev =>
                        prev.includes(idStr)
                          ? prev.filter(id => id !== idStr)
                          : [...prev, idStr]
                      );
                    }}
                    style={{
                      position: 'absolute',
                      left:   block.rect.x,
                      top:    block.rect.top,
                      width:  block.rect.width,
                      height: block.rect.height,
                      backgroundColor: isSelected ? colors.border.replace('0.85', '0.45') : colors.bg,
                      border: `2px solid ${colors.border}`,
                      boxSizing: 'border-box',
                      borderRadius: 4,
                      cursor: 'pointer',
                      zIndex: 10,
                      transition: 'background-color 0.15s',
                      pointerEvents: 'auto',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="browser-assist-actions">
            <button
              className="btn-primary browser-assist-extract-btn"
              onClick={visualScrapeMode ? runVisualScrape : handleExtraction}
              disabled={phase === 'extracting' || visualScrapeRunning}
            >
              {phase === 'extracting' ? '⏳ AI Reading...' : '📥 Download Recipe'}
            </button>
            {bannerRecipe && (
              <button className="btn-accent" onClick={() => { setAutoRecipe(bannerRecipe); setBannerRecipe(null); setPhase('preview'); }}>
                ✅ Use Auto-Result
              </button>
            )}
            <button className="btn-secondary" onClick={onFallbackToText} disabled={phase === 'extracting'}>â† Back</button>
          </div>
        </div>
      )}

      {/* â”€â”€ Error â”€â”€ */}
      {phase === 'error' && (
        <div className="browser-assist-error">
          <p className="error-text">{errorMsg}</p>
          <button className="btn-primary" onClick={onFallbackToText}>â† Back to Import</button>
        </div>
      )}
    </div>
  );
}); // â† closes forwardRef(function BrowserAssist(...) {

export default BrowserAssist;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Helpers
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * mergeRecipeLayers â€” combines up to 3 recipe sources into one.
 * Lower layers fill gaps in higher layers but never overwrite them.
 * Layer priority (highest first): aim > scraped > seed.
 *
 *   seed    â€” partial data auto-import scraped (title/image often reliable here)
 *   scraped â€” what the page heuristic+AI produced inside the internal browser
 *   aim     â€” text the user tapped to aim at (most explicit intent; wins)
 *
 * Returns a cleaned recipe object or null if nothing usable.
 */
export function mergeRecipeLayers(seed, scraped, aim, sourceUrl, extractedVia) {
  const isPlaceholder = (x) => typeof x === 'string' &&
    /^see (original|recipe|full)/i.test(x.trim());
  const clean = (arr) => Array.isArray(arr)
    ? arr.map(x => (x || '').trim()).filter(x => x && !isPlaceholder(x))
    : [];
  const src = [seed, scraped, aim].filter(Boolean);
  if (src.length === 0) return null;

  // Name: aim > scraped > seed (prefer non-empty, non-generic)
  const pickName = () => {
    for (const s of [aim, scraped, seed]) {
      const n = (s?.name || '').trim();
      if (n && n !== 'Imported Recipe') return n;
    }
    return seed?.name || scraped?.name || aim?.name || '';
  };

  // For ingredients/directions, UNION all layers but keep order:
  // scraped first (usually canonical ordering from JSON-LD/DOM), then aim
  // additions (user's targeted picks), with seed as fallback if empty.
  const unionList = (field) => {
    const out = [];
    const seen = new Set();
    const push = (arr) => {
      for (const it of clean(arr)) {
        const k = it.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(it); }
      }
    };
    push(scraped?.[field]);
    push(aim?.[field]);
    if (out.length === 0) push(seed?.[field]);
    return out;
  };

  return {
    name: pickName(),
    ingredients: unionList('ingredients'),
    directions: unionList('directions'),
    imageUrl: scraped?.imageUrl || seed?.imageUrl || aim?.imageUrl || '',
    link: seed?.link || sourceUrl || '',
    extractedVia: aim ? `${extractedVia}+aim` : extractedVia,
    importedAt: new Date().toISOString(),
  };
}

/**
 * mergeAimedText â€” merges newly-tapped text into an aim-recipe draft.
 * Routes lines by target:
 *   'title'       â†’ recipe.name (first non-trivial line wins)
 *   'ingredients' â†’ forced into ingredients[] (uses smartClassifyLines to split)
 *   'directions'  â†’ forced into directions[]
 *   'auto'        â†’ use smartClassifyLines to decide per-line
 */
export function mergeAimedText(prev, rawText, target, sourceUrl) {
  const next = {
    name: prev.name || '',
    ingredients: Array.isArray(prev.ingredients) ? [...prev.ingredients] : [],
    directions: Array.isArray(prev.directions) ? [...prev.directions] : [],
    imageUrl: prev.imageUrl || '',
    link: prev.link || sourceUrl || '',
    _aimed: true,
  };
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 2 && l.length < 400);
  if (lines.length === 0) return next;

  if (target === 'title') {
    const pick = lines.find(l => l.length < 100) || lines[0];
    if (pick && (!next.name || next.name.length < pick.length)) next.name = pick;
    return next;
  }
  if (target === 'ingredients') {
    for (const l of lines) {
      if (!next.ingredients.includes(l)) next.ingredients.push(l);
    }
    return next;
  }
  if (target === 'directions') {
    for (const l of lines) {
      if (!next.directions.includes(l)) next.directions.push(l);
    }
    return next;
  }
  // 'auto' â€” use the heuristic line classifier imported at module scope
  try {
    const classified = smartClassifyLines(lines) || {};
    for (const ing of (classified.ingredients || [])) {
      if (!next.ingredients.includes(ing)) next.ingredients.push(ing);
    }
    for (const dir of (classified.directions || [])) {
      if (!next.directions.includes(dir)) next.directions.push(dir);
    }
  } catch {
    // Classifier unavailable â€” dump to directions (safer default)
    for (const l of lines) {
      if (!next.directions.includes(l)) next.directions.push(l);
    }
  }
  return next;
}

/**
 * runCaptionExpander â€” auto-clicks 'more' / '...' / 'read more' buttons that
 * Instagram, TikTok, YouTube, Facebook, and Pinterest use to truncate long
 * captions. Returns the number of elements we clicked so the UI can give
 * feedback like "Expanded 3".
 *
 * The targeting is intentionally broad: we try selectors first, then fall
 * back to textContent matching on small clickable elements. We skip anchors
 * that would navigate away and anything inside our own toolbar.
 */
export function runCaptionExpander(doc) {
  if (!doc || !doc.body) return 0;
  const clicked = new Set();
  // Selector-based pass â€” works on most modern social sites
  const SELECTORS = [
    // Instagram embed + web: "more" button inside caption
    'button[aria-label="more" i]',
    'button[aria-label="expand" i]',
    'span[role="button"][aria-label*="more" i]',
    // Generic "read more" patterns
    '[data-testid*="readmore" i]',
    '[data-testid*="expand" i]',
    'button[class*="expand" i]',
    'button[class*="readmore" i]',
    'button[class*="more" i]',
    // TikTok truncation
    '[data-e2e="video-desc-seemore"]',
    '[data-e2e*="seemore" i]',
    // Facebook
    'div[role="button"][tabindex="0"]',
  ];
  for (const sel of SELECTORS) {
    try {
      doc.querySelectorAll(sel).forEach(el => {
        if (clicked.has(el)) return;
        // Skip toolbar + anchors that would navigate away
        if (el.closest('#spicehub-toolbar') || el.closest('#spicehub-helper')) return;
        if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript:')) return;
        const text = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
        // If textContent is set, only click things that look like expand controls
        if (text && text.length > 80) return; // big blocks are not expand buttons
        if (text && !/^(\.\.\.|â€¦|more|read more|see more|show more|see all|expand|view more|continue reading)$/i.test(text)) {
          // For generic role=button div fallback, require the expand-ish text
          if (sel === 'div[role="button"][tabindex="0"]') return;
        }
        try { el.click(); clicked.add(el); } catch { /* ignore */ }
      });
    } catch { /* skip this selector */ }
  }
  // Text-content pass â€” find small clickable elements whose text is exactly
  // one of the expand phrases. Catches sites that don't use aria-labels.
  const EXPAND_TEXT = /^(\.\.\.|â€¦|more|read more|see more|show more|see all|expand|view more|continue reading)$/i;
  doc.querySelectorAll('button, span[role="button"], a[role="button"]').forEach(el => {
    if (clicked.has(el)) return;
    if (el.closest('#spicehub-toolbar') || el.closest('#spicehub-helper')) return;
    const txt = (el.textContent || '').trim();
    if (txt.length > 40) return;
    if (!EXPAND_TEXT.test(txt)) return;
    try { el.click(); clicked.add(el); } catch { /* ignore */ }
  });
  return clicked.size;
}

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
  /verified\s*[Â·â€¢Â·]\s*(view\s+profile|follow)/i,
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
    if (!u) return;
    const clean = u.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (isUsableImageUrl(clean) && !seen.has(clean)) { urls.push(clean); seen.add(clean); }
  }
  // og:image â€” try all attribute orderings (property=â€¦ content=â€¦ or reversed)
  const ogM = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:image["']/i)
    || html.match(/<meta[^>]+property=og:image[^>]+content\s*=\s*["']([^"']*)["']/i);
  if (ogM?.[1]) addUrl(ogM[1]);
  const twM = html.match(/<meta[^>]+name\s*=\s*["']twitter:image["'][^>]+content\s*=\s*["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']twitter:image["']/i);
  if (twM?.[1]) addUrl(twM[1]);
  // JSON-LD image fields
  for (const m of html.matchAll(/"image"\s*:\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*\[\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  // JSON-LD ImageObject url / contentUrl (AllRecipes, many schema.org sites)
  for (const m of html.matchAll(/"url"\s*:\s*"(https:[^"]{10,}\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)) addUrl(m[1]);
  for (const m of html.matchAll(/"contentUrl"\s*:\s*"(https:[^"]{10,})"/g)) addUrl(m[1]);
  // Social media specific
  for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_src"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"thumbnail_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"media_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"cover_image_url"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  for (const m of html.matchAll(/"poster"\s*:\s*"(https:[^"]+)"/g)) addUrl(m[1]);
  const embedImgM = html.match(/<img[^>]+class="[^"]*EmbedImage[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*EmbedImage[^"]*"/i);
  if (embedImgM?.[1]) addUrl(embedImgM[1]);
  // <img src="â€¦"> â€” only large images (explicit size in URL or image extension)
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/[^"]{20,})"/gi)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/\d{3,4}[x_]\d{3,4}|\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) addUrl(u);
  }
  // Lazy-loaded images â€” data-src, data-lazy-src, data-lazy (very common on recipe blogs)
  for (const m of html.matchAll(/data-(?:src|lazy-src|lazy|original)="(https:\/\/[^"]{20,})"/gi)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/\.(jpg|jpeg|png|webp)|\d{3,4}[x_]\d{3,4}/i.test(u)) addUrl(u);
  }
  // <source srcset="url 1200w, url2 800w"> â€” pick largest
  for (const m of html.matchAll(/<source[^>]+srcset="([^"]+)"/gi)) {
    const srcset = m[1];
    // Pick the URL with the largest width descriptor
    const parts = srcset.split(',').map(s => s.trim());
    let bestW = 0; let bestUrl = '';
    for (const part of parts) {
      const [u, w] = part.split(/\s+/);
      const width = parseInt(w) || 0;
      if (width > bestW) { bestW = width; bestUrl = u; }
    }
    if (!bestUrl && parts[0]) bestUrl = parts[0].split(/\s+/)[0];
    if (bestUrl) addUrl(bestUrl.replace(/&amp;/g, '&'));
  }
  // CSS background images
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
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'") // Fixed single quote entity
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtmlForEmbed(html, baseUrl) {
  if (!html) return '';
  
  let origin = '';
  try {
    origin = new URL(baseUrl).origin;
  } catch (e) {
    /* ignore invalid base URLs */
  }

  return html
    // 1. Remove dangerous tags
    .replace(/<(script|iframe|object|embed|style)[^>]*>([\s\S]*?)<\/\1>/gi, '')
    // 2. Remove inline event handlers (onclick, etc)
    .replace(/\son\w+="[^"]*"/g, '')
    // 3. Fix relative URLs for images and links if origin exists
    .replace(/(src|href)="\/([^"]+)"/g, (match, attr, path) => {
      return origin ? `${attr}="${origin}/${path}"` : match;
    });
}