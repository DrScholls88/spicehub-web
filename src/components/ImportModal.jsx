import { useState, useRef, useEffect, useCallback } from 'react';
import {
  importRecipeFromUrl,
  isSocialMediaUrl, getSocialPlatform,
  isInstagramUrl, isShortUrl, resolveShortUrl,
  parseFromUrl, parseCaption,
  classifyWithConfidence, smartClassifyLines, normalizeAndDedupe,
  scoreExtractionConfidence, tryVideoExtraction,
  isWeakResult,
} from '../recipeParser.js';
import BrowserAssist from './BrowserAssist';
import { normalizeInstagramUrl } from '../api.js';

// Module-level flag — persists for the browser tab session so we only pay the
// Render spin-up cost once per session, not on every import.
let _serverWarm = false;

/**
 * ImportModal — four import paths:
 *   1. From URL (recipe blogs, Instagram, TikTok)
 *   2. From Image (screenshot, photo of index card/cookbook — OCR)
 *   3. Paste Text (recipe instructions/ingredients)
 *   4. Spreadsheet (CSV / Excel)
 *   5. Paprika (.paprikarecipes bundle)
 *
 * Props:
 *   onImport(recipes[])    — called with parsed recipe array; caller decides where to save
 *   onClose()
 *   title                  — optional modal title (e.g. "Import Recipe" vs "Import Drink")
 *   sharedContent          — optional { mode, url, text, title } from share-target
 */
export default function ImportModal({ onImport, onClose, title = 'Import Recipe', sharedContent = null }) {
  const [mode, setMode] = useState('url');         // 'url' | 'image' | 'paste' | 'spreadsheet' | 'paprika'
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);  // null = not yet, [] would mean "checked, found nothing"
  const [socialDetected, setSocialDetected] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteLink, setPasteLink] = useState('');
  const [progress, setProgress] = useState([
    { label: 'Video subtitles', status: 'pending', message: '' },
    { label: 'Caption fetch', status: 'pending', message: '' },
    { label: 'AI browser', status: 'pending', message: '' },
    { label: 'AI structuring', status: 'pending', message: '' },
  ]);
  const [bestImage, setBestImage] = useState(null);
  const [manualUrl, setManualUrl] = useState('');
  // Browser Assist state
  const [browserAssistUrl, setBrowserAssistUrl] = useState(null);
  const [browserAssistMode, setBrowserAssistMode] = useState('off'); // 'off' | 'showing'
  // When the auto-pipeline gives us something partial (title, hero image, one ingredient),
  // we hand those to BrowserAssist as a "seed" so the user can keep what worked and
  // only aim the parser at what's missing.
  const [browserAssistSeed, setBrowserAssistSeed] = useState(null);
  const fileRef = useRef(null);
  const paprikaRef = useRef(null);
  const imageRef = useRef(null);
  const cameraRef = useRef(null);

  // ── Drag and drop state for reorganizing ingredients/directions ────────────
  const [dragSource, setDragSource] = useState(null); // { field, index, recipeIdx }
  const [dragOverField, setDragOverField] = useState(null); // { field, recipeIdx } — shows which field is drop target
  const [touchDrag, setTouchDrag] = useState(null); // { field, index, recipeIdx, el, startY, currentY }
  const [autoSorting, setAutoSorting] = useState(false);

  // ── Sync import progress ───────────────────────────────────────────────────
  const API_BASE = import.meta.env.VITE_API_BASE || '';
  // Stage labels only — timing is now driven by real fetch events, not wall-clock.
  // Stages advance as:
  //   0 → immediately on request start
  //   1 → after 700ms if still waiting (slow network / cold server)
  //   2 → after 3500ms if still waiting (Gemini AI call in progress)
  //   3 → immediately when the response body arrives (always event-driven)
  const STAGES = [
    { key: 'scraping',    label: 'Reading the recipe…'     },
    { key: 'fetching',    label: 'Extracting content…'     },
    { key: 'structuring', label: 'Structuring with AI…'    },
    { key: 'saving',      label: 'Almost done…'            },
  ];
  const [syncPhase, setSyncPhase] = useState('idle'); // 'idle'|'running'|'success'|'failed'
  const [syncStageIdx, setSyncStageIdx] = useState(0);
  const [syncSuccessName, setSyncSuccessName] = useState('');
  const abortRef = useRef(null);
  const stageTimersRef = useRef([]);
  const capturedTextRef = useRef('');
  const autoImportTriggeredRef = useRef(null);

  // ── Inline misclassification suggestion using classifyWithConfidence ────────
  const getMisplacedHint = useCallback((text, currentField) => {
    if (!text || !text.trim()) return null;
    const [result] = classifyWithConfidence([text]);
    if (!result || result.category === 'skip') return null;
    const expectedField = result.category === 'ingredient' ? 'ingredients' : 'directions';
    // Only suggest if item is in the wrong section AND confidence is meaningful
    if (expectedField !== currentField && result.confidence >= 60) {
      return {
        suggestedField: expectedField,
        confidence: result.confidence,
        reason: result.reason,
        label: expectedField === 'ingredients' ? 'Ingredient?' : 'Step?',
      };
    }
    return null;
  }, []);

  // ── Move item between ingredients ↔ directions ─────────────────────────────
  const moveItemBetweenSections = useCallback((fromField, index, recipeIdx) => {
    if (!preview) return;
    const toField = fromField === 'ingredients' ? 'directions' : 'ingredients';
    const updated = [...preview];
    const sourceList = [...(updated[recipeIdx][fromField] || [])];
    const [item] = sourceList.splice(index, 1);
    const targetList = [...(updated[recipeIdx][toField] || []), item];
    updated[recipeIdx] = { ...updated[recipeIdx], [fromField]: sourceList, [toField]: targetList };
    setPreview(updated);
  }, [preview]);

  // ── Auto-expand textarea / input on focus & input ─────────────────────────
  const handleAutoExpand = useCallback((e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 40) + 'px';
  }, []);

  // ── Update a field on a specific recipe in preview ─────────────────────────
  const updateRecipeField = useCallback((recipeIdx, field, value) => {
    setPreview(prev => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[recipeIdx] = { ...updated[recipeIdx], [field]: value };
      return updated;
    });
  }, []);

  // ── Auto-sort: re-classify all items using smartClassifyLines ──────────────
  const handleAutoSort = useCallback((recipeIdx) => {
    if (!preview) return;
    setAutoSorting(true);
    const recipe = preview[recipeIdx];
    const allItems = [
      ...(recipe.ingredients || []),
      ...(recipe.directions || []),
    ].filter(item => item.trim());

    if (allItems.length === 0) { setAutoSorting(false); return; }

    // Use the parser's classification
    const classified = smartClassifyLines(allItems);
    const cleanIngs = normalizeAndDedupe(classified.ingredients);
    const cleanDirs = normalizeAndDedupe(classified.directions);

    const updated = [...preview];
    updated[recipeIdx] = {
      ...updated[recipeIdx],
      ingredients: cleanIngs.length > 0 ? cleanIngs : recipe.ingredients,
      directions: cleanDirs.length > 0 ? cleanDirs : recipe.directions,
    };
    setPreview(updated);
    requestAnimationFrame(() => setTimeout(() => setAutoSorting(false), 400));
  }, [preview]);

  // ── Touch-based drag for mobile ───────────────────────────────────────────
  const handleTouchDragStart = useCallback((e, field, index, recipeIdx) => {
    const touch = e.touches[0];
    const el = e.currentTarget.closest('.preview-editable-row');
    if (el) {
      el.style.opacity = '0.6';
      el.style.transform = 'scale(0.97)';
    }
    setTouchDrag({ field, index, recipeIdx, el, startY: touch.clientY, currentY: touch.clientY });
    setDragSource({ field, index, recipeIdx });
  }, []);

  const handleTouchDragMove = useCallback((e) => {
    if (!touchDrag) return;
    const touch = e.touches[0];
    setTouchDrag(prev => prev ? { ...prev, currentY: touch.clientY } : null);
    // Determine which section we're over
    const els = document.querySelectorAll('.preview-detail-section');
    els.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        const field = section.dataset.field;
        const recipeIdx = parseInt(section.dataset.recipeIdx || '0');
        if (field) setDragOverField({ field, recipeIdx });
      }
    });
  }, [touchDrag]);

  const handleTouchDragEnd = useCallback(() => {
    if (!touchDrag) return;
    if (touchDrag.el) {
      touchDrag.el.style.opacity = '';
      touchDrag.el.style.transform = '';
    }
    // If dragged to a different section, move the item
    if (dragOverField && dragSource && dragOverField.field !== dragSource.field) {
      moveItemBetweenSections(dragSource.field, dragSource.index, dragSource.recipeIdx);
    }
    setTouchDrag(null);
    setDragSource(null);
    setDragOverField(null);
  }, [touchDrag, dragOverField, dragSource, moveItemBetweenSections]);

  // ── Lock body scroll while modal is open ────────────────────────────────────
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = origOverflow; };
  }, []);

  // Abort any in-flight sync fetch when the modal is closed mid-import.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stageTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Warmup Render on modal open so it's ready when user clicks Import.
  // Always fires — empty API_BASE uses relative URL proxied by Vite in dev.
  useEffect(() => {
    fetch(`${API_BASE}/api/v2/ping`, { method: 'GET' }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle shared content from share-target (Android/iOS share sheet) ────────
  useEffect(() => {
    if (sharedContent) {
      if (sharedContent.mode === 'url' && sharedContent.url) {
        setMode('url');
        setUrl(sharedContent.url);
        setError('');
        // Auto-detect social media if applicable
        if (isSocialMediaUrl(sharedContent.url)) {
          setSocialDetected({ platform: getSocialPlatform(sharedContent.url) });
        }
      } else if (sharedContent.mode === 'paste' && sharedContent.text) {
        setMode('paste');
        setPasteText(sharedContent.text);
        setError('');
      }
    }
  }, [sharedContent]);

  // ── Auto-extract when shared URL is set and modal opens ──
  useEffect(() => {
    if (sharedContent?.mode === 'url' && sharedContent?.url && !preview && !importing) {
      if (autoImportTriggeredRef.current === sharedContent.url) return;
      autoImportTriggeredRef.current = sharedContent.url;
      const sharedUrl = sharedContent.url;
      setUrl(sharedUrl);
      if (isSocialMediaUrl(sharedUrl)) {
        setSocialDetected({ platform: getSocialPlatform(sharedUrl) });
        // For social media URLs (Instagram, TikTok, YouTube, etc.) skip the
        // slow 3-pass chain in performUrlExtraction and go straight to
        // BrowserAssist, which runs its own optimised extraction pipeline
        // with live step-by-step progress feedback.
        const timer = setTimeout(() => {
          setBrowserAssistUrl(sharedUrl);
          setBrowserAssistMode('showing');
        }, 80);
        return () => clearTimeout(timer);
      }
      // For non-social shared URLs (recipe blogs, etc.) use the normal path
      setImporting(true);
      setImportProgress('Extracting recipe...');
      const timer = setTimeout(() => {
        performUrlExtraction(sharedUrl);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sharedContent?.url, preview, importing]);

  // ── URL field change ──────────────────────────────────────────────────────────
  const handleUrlChange = (e) => {
    const val = e.target.value;
    setUrl(val);
    setError('');
    if (isSocialMediaUrl(val)) {
      setSocialDetected({ platform: getSocialPlatform(val) });
    } else {
      setSocialDetected(null);
    }
  };

  // ── Synchronous import handler ────────────────────────────────────────────
  // Stage advancement is event-driven, not wall-clock:
  //   Stage 0 — immediately on start ("Reading the recipe…")
  //   Stage 1 — after 700ms if still in flight ("Extracting content…")
  //   Stage 2 — after 3500ms if still in flight ("Structuring with AI…")
  //   Stage 3 — the moment response arrives ("Almost done…"), then brief pause → close
  async function handleUrlImportSync(trimmedUrl) {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];

    // Clear stale captured text from any previous failed attempt so it never
    // bleeds into BrowserAssist when a different URL is tried in the same session.
    capturedTextRef.current = '';

    setSyncPhase('running');
    setSyncStageIdx(0);

    // Patience timers — fire only if the request is slow; cancelled on response.
    const t1 = setTimeout(() => setSyncStageIdx(1), 700);
    const t2 = setTimeout(() => setSyncStageIdx(2), 3500);
    stageTimersRef.current = [t1, t2];

    const controller = abortRef.current || new AbortController();
    abortRef.current = controller;

    const cancelTimers = () => {
      stageTimersRef.current.forEach(clearTimeout);
      stageTimersRef.current = [];
    };

    // One transparent retry on transient failures (5xx / network drop).
    // 422 = intentional extraction failure → skip retry, go straight to BrowserAssist.
    const attemptFetch = () => fetch(`${API_BASE}/api/v2/import/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmedUrl }),
      signal: controller.signal,
    });

    // Called when the server responds — cancels patience timers, flashes stage 3.
    const onResponseArrived = async () => {
      cancelTimers();
      setSyncStageIdx(3); // "Almost done…" — real event, not fake
      // Brief visual pause so the user sees the final stage before modal closes
      await new Promise(r => setTimeout(r, 220));
    };

    try {
      let resp = await attemptFetch();

      // Transient server error — show "Retrying…" in current stage, retry once
      if (resp.status >= 500) {
        // Don't cancel timers yet — retry is still in flight
        if (controller.signal.aborted) { cancelTimers(); setSyncPhase('idle'); return; }
        resp = await attemptFetch();
      }

      await onResponseArrived();

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        capturedTextRef.current = errBody?.partial?.capturedText ?? '';
        setSyncPhase('failed');
        setBrowserAssistUrl(trimmedUrl);
        setBrowserAssistMode('showing');
        return;
      }

      const { recipe } = await resp.json();

      // If the backend returned a partial/weak recipe (missing ingredients or
      // directions), route to BrowserAssist so the user can aim the parser
      // instead of silently saving an incomplete record.
      if (isWeakResult(recipe)) {
        setSyncPhase('idle');
        setBrowserAssistUrl(trimmedUrl);
        setBrowserAssistSeed(recipe && !recipe._error ? recipe : null);
        setBrowserAssistMode('showing');
        return;
      }

      // Show success flash, then hand off to App.jsx
      setSyncSuccessName(recipe?.name || 'Recipe');
      setSyncPhase('success');
      await new Promise(r => setTimeout(r, 700));
      setSyncPhase('idle');
      onImport([recipe]);
      onClose();

    } catch (err) {
      cancelTimers();
      if (err.name === 'AbortError') {
        setSyncPhase('idle');
        return;
      }
      // Network error — retry once silently
      try {
        if (controller.signal.aborted) { setSyncPhase('idle'); return; }
        await new Promise(r => setTimeout(r, 1200));
        const resp2 = await attemptFetch();
        await onResponseArrived();
        if (resp2.ok) {
          const { recipe } = await resp2.json();
          // Same weak-result check as the primary path
          if (isWeakResult(recipe)) {
            setSyncPhase('idle');
            setBrowserAssistUrl(trimmedUrl);
            setBrowserAssistSeed(recipe && !recipe._error ? recipe : null);
            setBrowserAssistMode('showing');
            return;
          }
          setSyncSuccessName(recipe?.name || 'Recipe');
          setSyncPhase('success');
          await new Promise(r => setTimeout(r, 700));
          setSyncPhase('idle');
          onImport([recipe]);
          onClose();
          return;
        }
        const errBody2 = await resp2.json().catch(() => ({}));
        capturedTextRef.current = errBody2?.partial?.capturedText ?? '';
      } catch {
        capturedTextRef.current = '';
      }
      setSyncPhase('failed');
      setBrowserAssistUrl(trimmedUrl);
      setBrowserAssistMode('showing');
    }
  }

  function handleCancelImport() {
    abortRef.current?.abort();
    stageTimersRef.current.forEach(clearTimeout);
    // If cancelled during warmup, mark server warm anyway so the next attempt
    // skips warmup (the ping already woke Render up).
    if (syncPhase === 'warmup') _serverWarm = true;
    setSyncPhase('idle');
    setSyncStageIdx(0);
  }

  // ── Import from ANY URL ─────────────────────────────────────────────────────
  // Called by the Import button and Enter-key handler.
  // Routes single URLs through performUrlExtraction (which handles Instagram →
  // BrowserAssist, short URL resolution, social fallback, etc.) and multi-URL
  // pastes through handleBatchImport.
  const handleUrlImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('Please enter a URL.');
      return;
    }
    setError('');

    // Detect multiple URLs pasted as newline/space-separated list
    const detectedUrls = trimmedUrl.split(/[\s\n]+/).filter(s => /^https?:\/\//i.test(s));

    if (detectedUrls.length > 1) {
      // Batch mode
      handleBatchImport(detectedUrls);
      return;
    }

    // Single URL — warmup then synchronous import
    await handleUrlImportWithWarmup(trimmedUrl);
  };

  // ── Render warmup ─────────────────────────────────────────────────────────
  // On Render's free tier the instance spins down after inactivity. The first
  // request gets stuck waiting for spin-up (5-30s) and times out. To mask
  // this, we send a cheap ping immediately and show a branded gradient
  // animation for the duration. Once the instance responds (or 5.5s max),
  // we proceed with the real import — the server is now warm.
  //
  // _serverWarm is module-level so repeated imports in the same tab skip
  // the warmup entirely (server stays warm between imports).
  //
  // Min 2s animation prevents a flash when the server is already warm.
  async function handleUrlImportWithWarmup(trimmedUrl) {
    const WARMUP_MIN_MS = 2000;
    const WARMUP_MAX_MS = 5500;

    const controller = new AbortController();
    abortRef.current = controller;

    if (!_serverWarm) {
      setSyncPhase('warmup');

      const t0 = Date.now();
      // Fire ping — wakes Render, don't block on error
      const pingPromise = fetch(`${API_BASE}/api/v2/ping`, { method: 'GET' })
        .catch(() => {});
      // Wait for ping OR max timeout, whichever is sooner
      await Promise.race([pingPromise, new Promise(r => setTimeout(r, WARMUP_MAX_MS))]);

      // Enforce minimum animation time so a fast warm-server doesn't flash
      const elapsed = Date.now() - t0;
      if (elapsed < WARMUP_MIN_MS) {
        await new Promise(r => setTimeout(r, WARMUP_MIN_MS - elapsed));
      }

      _serverWarm = true;

      // User may have cancelled during warmup — bail if so
      if (controller.signal.aborted) {
        setSyncPhase('idle');
        return;
      }
    }

    await handleUrlImportSync(trimmedUrl);
  }

  // ── Extract URL (reusable for auto-extraction on share-target) ──────────────────
  const performUrlExtraction = async (urlToExtract) => {
    if (!urlToExtract?.trim()) {
      setImporting(false);
      setImportProgress('');
      return;
    }
    let trimmedUrl = urlToExtract.trim();

    try {
      // ── URL shortener resolution ──
      if (isShortUrl(trimmedUrl)) {
        setImportProgress('Resolving shortened URL...');
        try {
          const resolved = await resolveShortUrl(trimmedUrl);
          if (resolved !== trimmedUrl) {
            trimmedUrl = resolved;
            setUrl(resolved);
            if (isSocialMediaUrl(resolved)) {
              setSocialDetected({ platform: getSocialPlatform(resolved) });
            }
          }
        } catch { /* continue with original URL */ }
      }

      // ── Instagram: route directly to BrowserAssist (unified 4-phase engine) ──
      // importRecipeFromUrl() in recipeParser.js now owns the full pipeline:
      //   Phase 0: yt-dlp video subtitles (Reels narration)
      //   Phase 1: Fast embed page fetch
      //   Phase 2: AI browser / Puppeteer agent
      //   Phase 3: Gemini AI structuring
      // BrowserAssist shows live step-by-step progress and handles graceful fallback.
      if (isInstagramUrl(trimmedUrl)) {
        setImporting(false);
        setImportProgress('');
        setBrowserAssistUrl(trimmedUrl);
        setBrowserAssistMode('showing');
        return;
      }

      // ── Non-Instagram URLs: unified import engine ──
      // Single source of truth — importRecipeFromUrl() routes to:
      //   • Video-first flow for TikTok / YT Shorts / FB Reels (yt-dlp first)
      //   • Generic blog pipeline for recipe blogs (JSON-LD → Markdown → Gemini)
      // Always returns either a finalized recipe or {_needsManualCaption: true}.
      setError('');
      setBrowserAssistMode('off');
      setImportProgress('Extracting recipe…');

      const result = await importRecipeFromUrl(trimmedUrl, (_phase, _status, msg) => {
        if (msg) setImportProgress(msg);
      });

      // Paprika-style fallback: ANY weak/empty/partial result routes to the
      // internal browser so the user can aim the parser themselves. No more
      // dead-end 'paste text' error cards as the primary fallback.
      if (isWeakResult(result)) {
        setImporting(false);
        setImportProgress('');
        setBrowserAssistUrl(trimmedUrl);
        // Hand anything we DID scrape (title, image, partial ingredients) to the
        // browser as a seed — the user keeps what worked, adds what didn't.
        setBrowserAssistSeed(result && !result._error ? result : null);
        setBrowserAssistMode('showing');
        return;
      }

      setPreview([result]);
    } catch (e) {
      setError('Import failed: ' + e.message);
    }
    setImporting(false);
    setImportProgress('');
  };

  // ── Browser Assist callbacks ───────────────────────────────────────────────────
  const handleBrowserAssistRecipe = (recipe) => {
    if (recipe) {
      // Recipe successfully extracted from visible page
      setPreview([recipe]);
      setBrowserAssistMode('off');
      setSyncPhase('idle');
    }
  };

  const handleBrowserAssistFallback = () => {
    // User backed out of BrowserAssist — clear pipeline state fully so a second
    // import attempt doesn't carry stale URL / importing flags.
    setBrowserAssistMode('off');
    setBrowserAssistUrl(null);
    setBrowserAssistSeed(null);
    setSyncPhase('idle');
    setSyncStageIdx(0);
    setImporting(false);
    setImportProgress('');
    setSocialDetected(null);
    // Switch to Paste Text and pre-fill the source URL for manual entry
    setMode('paste');
    setPasteLink(url);
    setUrl(''); // clear URL field so user must re-enter to try again
    setError('');
  };

  // ── Multi-URL batch import ──────────────────────────────────────────────────
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, results[] }

  const handleBatchImport = async (urls) => {
    setError('');
    setImporting(true);
    setBatchProgress({ current: 0, total: urls.length, results: [] });

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
      setImportProgress(`Importing ${i + 1} of ${urls.length}...`);

      try {
        // Resolve short URLs first
        let resolvedUrl = urls[i];
        if (isShortUrl(resolvedUrl)) {
          try { resolvedUrl = await resolveShortUrl(resolvedUrl); } catch {}
        }

        const result = await parseFromUrl(resolvedUrl, () => {});
        if (result && !result._error) {
          results.push(result);
        }
      } catch { /* skip failed URLs */ }

      // Small delay between requests to avoid rate limiting
      if (i < urls.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    setBatchProgress(null);
    setImporting(false);
    setImportProgress('');

    if (results.length > 0) {
      setPreview(results);
    } else {
      setError(`Could not extract recipes from any of the ${urls.length} URLs. Try pasting recipe text instead.`);
    }
  };

  // ── Clipboard paste auto-detection ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'url') return;
    const handlePaste = (e) => {
      const pasted = e.clipboardData?.getData('text')?.trim();
      if (!pasted) return;

      // Auto-detect pasted URLs (split on whitespace/newlines, keep only http/https)
      const pastedUrls = pasted.split(/[\s\n]+/).filter(s => /^https?:\/\//i.test(s));
      if (pastedUrls.length === 1) {
        // Single URL pasted — auto-fill and start import
        setUrl(pastedUrls[0]);
        if (isSocialMediaUrl(pastedUrls[0])) {
          setSocialDetected({ platform: getSocialPlatform(pastedUrls[0]) });
        }
      } else if (pastedUrls.length > 1) {
        // Multiple URLs pasted — set the raw text and let handleUrlImport detect batch
        setUrl(pasted);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [mode]);

  // ── Paste caption/text import (Mealie-style fallback) ────────────────────────
  const handlePasteImport = () => {
    if (!pasteText.trim()) return;
    setError('');
    const parsed = parseCaption(pasteText.trim());
    const recipe = {
      name: parsed.title || 'Pasted Recipe',
      ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
      directions: parsed.directions.length > 0 ? parsed.directions : [],
      imageUrl: '',
      link: pasteLink.trim() || '',
    };
    // If parser couldn't split, put everything in directions
    if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
      const lines = pasteText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 1);
      recipe.directions = lines.length > 0 ? lines : ['See pasted text for details'];
    }
    setPreview([recipe]);
  };

  // ── Image OCR import ────────────────────────────────────────────────────────
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setImportProgress('Loading OCR engine...');
    try {
      // Always capture the original photo as the recipe image
      setImportProgress('Processing image...');
      const imageDataUrl = await fileToDataUrl(file);

      // Preprocess image for better OCR quality
      const processedImage = await preprocessImageForOCR(file);

      // Dynamic import of Tesseract.js (lazy-loaded, ~3MB)
      setImportProgress('Loading text recognition...');
      const Tesseract = await import('tesseract.js');

      setImportProgress('Reading text from image...');
      const result = await Tesseract.recognize(
        processedImage,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              const pct = Math.round((m.progress || 0) * 100);
              setImportProgress(`Reading text... ${pct}%`);
            }
          },
        }
      );

      const ocrText = result.data.text?.trim();
      if (!ocrText || ocrText.length < 10) {
        setError('Could not read any text from this image. Try a clearer photo with good lighting and more contrast.');
        setImporting(false);
        setImportProgress('');
        e.target.value = '';
        return;
      }

      // Clean OCR artifacts before parsing
      const cleanedText = cleanOcrText(ocrText);

      // Parse the OCR text through the recipe caption parser
      setImportProgress('Parsing recipe...');
      const parsed = parseCaption(cleanedText);

      // Build recipe object — ALWAYS keep the original photo
      const recipe = {
        name: parsed.title || 'Recipe from Photo',
        ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
        directions: parsed.directions.length > 0 ? parsed.directions : [],
        imageUrl: imageDataUrl, // Always store original photo
        link: '',
      };

      // If the caption parser couldn't split into ingredients/directions,
      // use improved heuristics that consider cooking verbs and measurements
      if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
        const lines = cleanedText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        if (lines.length > 0) {
          classifyOcrLines(lines, recipe);
        }
        // If still nothing, dump everything into directions
        if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
          recipe.directions = lines.length > 0 ? lines : ['See photo for recipe details'];
        }
      }

      setPreview([recipe]);
    } catch (err) {
      console.error('[SpiceHub] OCR error:', err);
      setError('Could not process image: ' + (err.message || 'Unknown error'));
    }
    setImporting(false);
    setImportProgress('');
    e.target.value = '';
  };

  // ── Spreadsheet upload ────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const meals = [];
      if (file.name.match(/\.xlsx?$/i)) {
        try {
          const XLSX = await import('xlsx');
          const data = new Uint8Array(await file.arrayBuffer());
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r[0]?.toString().trim()) {
              meals.push({
                name: r[0].toString().trim(),
                ingredients: splitSemicolon(r[1]),
                directions: splitSemicolon(r[2]),
                link: r[3]?.toString().trim() || '',
                imageUrl: r[4]?.toString().trim() || '',
              });
            }
          }
        } catch {
          setError('Excel import error. Please use CSV format instead.');
          setImporting(false); return;
        }
      } else {
        const sep = file.name.endsWith('.tsv') ? '\t' : ',';
        const lines = text.split('\n').filter(l => l.trim());
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i], sep);
          if (cols[0]?.trim()) {
            meals.push({
              name: cols[0].trim(),
              ingredients: splitSemicolon(cols[1]),
              directions: splitSemicolon(cols[2]),
              link: cols[3]?.trim() || '',
              imageUrl: cols[4]?.trim() || '',
            });
          }
        }
      }
      if (meals.length === 0) {
        setError('No recipes found. Expected columns: Name | Ingredients (;-separated) | Directions (;-separated) | Link | Image URL');
      } else {
        setPreview(meals);
      }
    } catch (e) {
      setError('File read failed: ' + e.message);
    }
    setImporting(false);
  };

  // ── Paprika .paprikarecipes import ────────────────────────────────────────────
  const handlePaprikaUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      const recipes = [];
      const entries = Object.values(zip.files).filter(f =>
        !f.dir && f.name.endsWith('.paprikarecipe')
      );

      if (entries.length === 0) {
        throw new Error('No .paprikarecipe files found inside this archive.');
      }

      for (const entry of entries) {
        try {
          // Each .paprikarecipe is gzip-compressed JSON
          const compressed = await entry.async('uint8array');
          const json = await decompressGzip(compressed);
          const rec = JSON.parse(json);
          recipes.push(parsePaprikaRecipe(rec));
        } catch (err) {
          console.warn('Skipped a Paprika recipe entry:', err.message);
        }
      }

      if (recipes.length === 0) {
        throw new Error('Could not parse any recipes from the Paprika file.');
      }
      setPreview(recipes);
    } catch (err) {
      setError('Paprika import failed: ' + err.message);
    }
    setImporting(false);
    e.target.value = '';
  };

  const confirmImport = () => {
    if (!preview) return;
    // Accept any recipe that has a name, real content, or is a side-dish addendum.
    // Empty name is fine — we fall back to "Untitled Recipe" below.
    // This prevents cleanRecipe()'s placeholder-title stripping from silently dropping valid recipes.
    const valid = preview.filter(m =>
      m && (m.name || m._isAddendum || (m.ingredients?.length > 0) || (m.directions?.length > 0))
    );
    if (!valid.length) return;
    onImport(valid.map(m => ({
      ...m,
      name: m.name || (m._isAddendum ? (m._addendumLabel || 'Side Dish') : 'Untitled Recipe'),
      // For drinks: directions are optional (a simple cocktail may just have ingredients)
      // Use generic fallbacks only when truly empty so the DB never gets undefined fields
      ingredients: m.ingredients?.length ? m.ingredients : [],
      directions: m.directions?.length ? m.directions : [],
      notes: m.notes || '',
      importedAt: m.importedAt || new Date().toISOString(),
    })));
  };

  // ── Drag and drop handlers for reordering ingredients/directions ────────────
  const handleDragStart = (field, index, recipeIdx, e) => {
    setDragSource({ field, index, recipeIdx });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragOver = (field, recipeIdx, e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverField({ field, recipeIdx });
  };

  const handleDrop = (field, index, recipeIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSource) return;

    const { field: srcField, index: srcIdx, recipeIdx: srcRecipeIdx } = dragSource;
    const updated = [...preview];

    // Move between different fields or within same field
    const sourceItems = [...(updated[srcRecipeIdx][srcField] || [])];
    const [movedItem] = sourceItems.splice(srcIdx, 1);
    updated[srcRecipeIdx] = { ...updated[srcRecipeIdx], [srcField]: sourceItems };

    // Insert into target field
    const targetItems = [...(updated[recipeIdx][field] || [])];
    targetItems.splice(index, 0, movedItem);
    updated[recipeIdx] = { ...updated[recipeIdx], [field]: targetItems };

    setPreview(updated);
    setDragSource(null);
    setDragOverField(null);
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDragSource(null);
    setDragOverField(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div className="error-bar">
            {error}
            <button className="btn-icon small" onClick={() => setError('')} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
        )}

        {browserAssistMode === 'showing' ? (
          <>
            {/* Fallback breadcrumb — shown when BrowserAssist is a fallback after a failed sync import */}
            <div className="ba-fallback-header">
              <button
                className="ba-back-btn"
                onClick={() => {
                  setBrowserAssistMode('off');
                  setBrowserAssistUrl(null);
                  setSyncPhase('idle');
                  setSyncStageIdx(0);
                  capturedTextRef.current = '';
                }}
              >
                ← Try a different URL
              </button>
              <span className="ba-fallback-reason">Trying deeper extraction…</span>
            </div>
            <BrowserAssist
              url={browserAssistUrl}
              onRecipeExtracted={handleBrowserAssistRecipe}
              onFallbackToText={handleBrowserAssistFallback}
              initialCapturedText={capturedTextRef.current}
              seedRecipe={browserAssistSeed}
            />
          </>
        ) : /* ── Preview screen (full detail + editable) ──────────────────────── */
        preview ? (
          <div className="import-preview">
            <div className="preview-header-bar">
              <h3>
                Preview — {preview.length} recipe{preview.length !== 1 ? 's' : ''} found
                {preview.some(m => m._hasSubtitles) && (
                  <span className="subtitle-badge" title="Recipe extracted from video subtitles">CC</span>
                )}
                {preview.some(m => m._extractedVia?.startsWith('yt-dlp')) && (
                  <span className="extraction-badge" title="Extracted via video metadata">Video</span>
                )}
              </h3>
              {preview.length === 1 && (
                <>
                  <button
                    className={`btn-auto-sort ${autoSorting ? 'sorting' : ''}`}
                    onClick={() => handleAutoSort(0)}
                    disabled={autoSorting}
                    title="Re-classify items into ingredients vs. directions"
                  >
                    {autoSorting ? '✓ Sorted!' : '⚡ Auto-Sort'}
                  </button>
                  {(() => {
                    const conf = scoreExtractionConfidence(preview[0]);
                    const level = conf >= 70 ? 'high' : conf >= 40 ? 'medium' : 'low';
                    return (
                      <span className={`confidence-badge confidence-${level}`} title={`Extraction confidence: ${conf}%`}>
                        {conf >= 70 ? '✓ High' : conf >= 40 ? '✓ Good' : '⚠ Low'} match
                      </span>
                    );
                  })()}
                </>
              )}
            </div>
            <div className="preview-detail-list">
              {preview.map((m, idx) => (
                <div key={idx} className="preview-detail-card">
                  {m._isAddendum && (
                    <div className="addendum-badge">＋ {m._addendumLabel || 'Side / Sauce'}</div>
                  )}
                  {/* Header: image + title */}
                  <div className="preview-detail-header">
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt=""
                        className="preview-detail-thumb"
                        onError={e => {
                          const attempt = parseInt(e.target.dataset.proxied || '0');
                          const enc = encodeURIComponent(m.imageUrl);
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
                            e.target.nextElementSibling?.classList?.remove('hidden');
                          }
                        }}
                      />
                    ) : null}
                    {!m.imageUrl && (
                      <div className="preview-detail-no-img">🍽️</div>
                    )}
                    <div className="preview-detail-title-zone">
                      <label className="preview-label">Recipe Name</label>
                      <input
                        type="text"
                        className="preview-title-input"
                        value={m.name}
                        onChange={e => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setPreview(updated);
                        }}
                      />
                    </div>
                  </div>

                  {/* Carousel image picker — shown when multiple images were extracted */}
                  {m.imageUrls && m.imageUrls.length > 1 && (
                    <div className="carousel-picker">
                      <label className="preview-label">
                        <span className="preview-label-icon">🖼</span>
                        Choose Photo ({m.imageUrls.length} found)
                      </label>
                      <div className="carousel-picker-strip">
                        {m.imageUrls.map((imgUrl, imgIdx) => (
                          <button
                            key={imgIdx}
                            className={`carousel-picker-thumb ${m.imageUrl === imgUrl ? 'selected' : ''}`}
                            onClick={() => {
                              const updated = [...preview];
                              updated[idx] = { ...updated[idx], imageUrl: imgUrl };
                              setPreview(updated);
                            }}
                            title={`Select photo ${imgIdx + 1}`}
                          >
                            <img
                              src={`https://images.weserv.nl/?url=${encodeURIComponent(imgUrl)}&w=80&h=80&fit=cover&output=jpg`}
                              alt={`Slide ${imgIdx + 1}`}
                              onError={e => { e.target.src = ''; e.target.closest('button')?.classList.add('broken'); }}
                            />
                            {m.imageUrl === imgUrl && <span className="carousel-check">✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ingredients (editable list with move buttons) */}
                  <div
                    className={`preview-detail-section ${dragOverField?.field === 'ingredients' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                    data-field="ingredients"
                    data-recipe-idx={idx}
                    onDragOver={(e) => handleDragOver('ingredients', idx, e)}
                    onDrop={(e) => handleDrop('ingredients', (m.ingredients || []).length, idx, e)}
                    onDragLeave={() => setDragOverField(null)}
                  >
                    <label className="preview-label">
                      <span className="preview-label-icon">🥕</span>
                      Ingredients ({m.ingredients?.length ?? 0})
                      <button
                        className="preview-add-btn"
                        onClick={() => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], ingredients: [...(updated[idx].ingredients || []), ''] };
                          setPreview(updated);
                        }}
                      >+ Add</button>
                    </label>
                    <div className="preview-editable-list">
                      {(m.ingredients || []).map((ing, ingIdx) => (
                        <div
                          key={ingIdx}
                          className="preview-editable-row"
                          draggable
                          onDragStart={(e) => handleDragStart('ingredients', ingIdx, idx, e)}
                          onDragOver={(e) => handleDragOver('ingredients', idx, e)}
                          onDrop={(e) => handleDrop('ingredients', ingIdx, idx, e)}
                          onDragEnd={handleDragEnd}
                          style={{
                            opacity: dragSource?.field === 'ingredients' && dragSource?.recipeIdx === idx && dragSource?.index === ingIdx ? 0.4 : 1
                          }}
                        >
                          <span
                            className="drag-handle"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                            role="button"
                            onTouchStart={(e) => handleTouchDragStart(e, 'ingredients', ingIdx, idx)}
                            onTouchMove={handleTouchDragMove}
                            onTouchEnd={handleTouchDragEnd}
                          />
                          <input
                            type="text"
                            value={ing}
                            placeholder="e.g. 2 cups flour"
                            onChange={e => {
                              const updated = [...preview];
                              const ings = [...(updated[idx].ingredients || [])];
                              ings[ingIdx] = e.target.value;
                              updated[idx] = { ...updated[idx], ingredients: ings };
                              setPreview(updated);
                            }}
                          />
                          {(() => {
                            const hint = getMisplacedHint(ing, 'ingredients');
                            if (!hint) return null;
                            return (
                              <button
                                className={`misplaced-hint misplaced-hint-${hint.confidence >= 80 ? 'high' : 'medium'}`}
                                title={`${hint.reason} (${hint.confidence}% confidence)`}
                                onClick={() => moveItemBetweenSections('ingredients', ingIdx, idx)}
                              >{hint.label} ↓</button>
                            );
                          })()}
                          <button
                            className="preview-move-btn"
                            onClick={() => moveItemBetweenSections('ingredients', ingIdx, idx)}
                            title="Move to Steps"
                          >↓</button>
                          <button
                            className="preview-remove-btn"
                            onClick={() => {
                              const updated = [...preview];
                              const ings = [...(updated[idx].ingredients || [])];
                              ings.splice(ingIdx, 1);
                              updated[idx] = { ...updated[idx], ingredients: ings };
                              setPreview(updated);
                            }}
                            title="Remove"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    {(m.ingredients || []).length === 0 && (
                      <div className="preview-empty-drop">⬇ Drop ingredients here · or tap <strong>+ Add</strong></div>
                    )}
                  </div>

                  {/* Directions (editable list with move buttons) */}
                  <div
                    className={`preview-detail-section ${dragOverField?.field === 'directions' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                    data-field="directions"
                    data-recipe-idx={idx}
                    onDragOver={(e) => handleDragOver('directions', idx, e)}
                    onDrop={(e) => handleDrop('directions', (m.directions || []).length, idx, e)}
                    onDragLeave={() => setDragOverField(null)}
                  >
                    <label className="preview-label">
                      <span className="preview-label-icon">📝</span>
                      Steps ({m.directions?.length ?? 0})
                      <button
                        className="preview-add-btn"
                        onClick={() => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], directions: [...(updated[idx].directions || []), ''] };
                          setPreview(updated);
                        }}
                      >+ Add</button>
                    </label>
                    <div className="preview-editable-list">
                      {(m.directions || []).map((step, stepIdx) => (
                        <div
                          key={stepIdx}
                          className="preview-editable-row preview-step-row"
                          draggable
                          onDragStart={(e) => handleDragStart('directions', stepIdx, idx, e)}
                          onDragOver={(e) => handleDragOver('directions', idx, e)}
                          onDrop={(e) => handleDrop('directions', stepIdx, idx, e)}
                          onDragEnd={handleDragEnd}
                          style={{
                            opacity: dragSource?.field === 'directions' && dragSource?.recipeIdx === idx && dragSource?.index === stepIdx ? 0.4 : 1
                          }}
                        >
                          <span
                            className="drag-handle"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                            role="button"
                            onTouchStart={(e) => handleTouchDragStart(e, 'directions', stepIdx, idx)}
                            onTouchMove={handleTouchDragMove}
                            onTouchEnd={handleTouchDragEnd}
                          />
                          <span className="preview-step-num">{stepIdx + 1}</span>
                          <textarea
                            value={step}
                            placeholder="Describe this step..."
                            rows={2}
                            onFocus={handleAutoExpand}
                            onInput={handleAutoExpand}
                            onChange={e => {
                              const updated = [...preview];
                              const dirs = [...(updated[idx].directions || [])];
                              dirs[stepIdx] = e.target.value;
                              updated[idx] = { ...updated[idx], directions: dirs };
                              setPreview(updated);
                            }}
                          />
                          {(() => {
                            const hint = getMisplacedHint(step, 'directions');
                            if (!hint) return null;
                            return (
                              <button
                                className={`misplaced-hint misplaced-hint-${hint.confidence >= 80 ? 'high' : 'medium'}`}
                                title={`${hint.reason} (${hint.confidence}% confidence)`}
                                onClick={() => moveItemBetweenSections('directions', stepIdx, idx)}
                              >{hint.label} ↑</button>
                            );
                          })()}
                          <button
                            className="preview-move-btn"
                            onClick={() => moveItemBetweenSections('directions', stepIdx, idx)}
                            title="Move to Ingredients"
                          >↑</button>
                          <button
                            className="preview-remove-btn"
                            onClick={() => {
                              const updated = [...preview];
                              const dirs = [...(updated[idx].directions || [])];
                              dirs.splice(stepIdx, 1);
                              updated[idx] = { ...updated[idx], directions: dirs };
                              setPreview(updated);
                            }}
                            title="Remove"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    {(m.directions || []).length === 0 && (
                      <div className="preview-empty-drop">⬇ Drop steps here · or tap <strong>+ Add</strong></div>
                    )}
                  </div>

                  {/* Source URL (editable) */}
                  {m.link && (
                    <div className="preview-detail-section">
                      <label className="preview-label">Source</label>
                      <input
                        type="url"
                        className="preview-source-input"
                        value={m.link}
                        onChange={e => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], link: e.target.value };
                          setPreview(updated);
                        }}
                      />
                    </div>
                  )}

                  {/* Notes — auto-expand on tap, drag items in, free-form extras */}
                  <div
                    className={`preview-detail-section preview-notes-section ${dragOverField?.field === 'notes' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                    data-field="notes"
                    data-recipe-idx={idx}
                    onDragOver={(e) => handleDragOver('notes', idx, e)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!dragSource) return;
                      const { field: srcField, index: srcIdx, recipeIdx: srcRecipeIdx } = dragSource;
                      const updated = [...preview];
                      const sourceItems = [...(updated[srcRecipeIdx][srcField] || [])];
                      const [movedItem] = sourceItems.splice(srcIdx, 1);
                      updated[srcRecipeIdx] = { ...updated[srcRecipeIdx], [srcField]: sourceItems };
                      const currentNotes = updated[idx].notes || '';
                      updated[idx] = { ...updated[idx], notes: currentNotes ? `${currentNotes}\n${movedItem}` : movedItem };
                      setPreview(updated);
                      setDragSource(null);
                      setDragOverField(null);
                    }}
                    onDragLeave={() => setDragOverField(null)}
                  >
                    <label className="preview-label">
                      <span className="preview-label-icon">📋</span>
                      Notes
                      <span className="preview-notes-hint">— tap to expand · drag items here</span>
                    </label>
                    <textarea
                      className="preview-notes-textarea"
                      value={m.notes || ''}
                      placeholder="Extra info, chef's tips, variations, or anything that didn't fit above…"
                      rows={1}
                      onFocus={handleAutoExpand}
                      onInput={handleAutoExpand}
                      onChange={e => updateRecipeField(idx, 'notes', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="preview-addendum-bar">
              <button
                className="btn-add-addendum"
                title="Add a linked side dish, sauce, or sub-recipe"
                onClick={() => {
                  setPreview(prev => [
                    ...(prev || []),
                    {
                      name: '',
                      ingredients: [],
                      directions: [],
                      notes: '',
                      imageUrl: '',
                      link: prev?.[0]?.link || '',
                      _isAddendum: true,
                      _addendumLabel: 'Side / Sauce',
                    },
                  ]);
                }}
              >
                ＋ Add Side / Sauce Recipe
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => {
                setPreview(null);
                setUrl('');
                setImporting(false);
                setImportProgress('');
                setBrowserAssistMode('off');
                setBrowserAssistUrl(null);
                setSocialDetected(null);
                setError('');
              }}>← Back</button>
              <button className="btn-primary" onClick={confirmImport}>
                Add {preview.length} {title.toLowerCase().includes('drink') ? (preview.length !== 1 ? 'Drinks' : 'Drink') : (preview.length !== 1 ? 'Recipes' : 'Recipe')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Tab bar — 3 primary + overflow ───────────────────────────── */}
            <div className="import-tabs">
              <button
                className={mode === 'url' ? 'active' : ''}
                onClick={() => { setMode('url'); setSocialDetected(null); setError(''); }}
              >
                From URL
              </button>
              <button
                className={mode === 'paste' ? 'active' : ''}
                onClick={() => { setMode('paste'); setSocialDetected(null); setError(''); }}
              >
                Paste Text
              </button>
              <button
                className={mode === 'image' ? 'active' : ''}
                onClick={() => { setMode('image'); setError(''); }}
              >
                From Photo
              </button>
              {/* ⋯ overflow — reveals Spreadsheet and Paprika on demand */}
              <button
                className={['spreadsheet', 'paprika'].includes(mode) ? 'active import-tabs-more' : 'import-tabs-more'}
                onClick={() => {
                  const next = mode === 'spreadsheet' ? 'paprika' : 'spreadsheet';
                  setMode(next);
                  setSocialDetected(null);
                  setError('');
                }}
                title="More import options (Spreadsheet, Paprika)"
              >
                {mode === 'spreadsheet' ? 'Spreadsheet' : mode === 'paprika' ? 'Paprika' : '⋯ More'}
              </button>
            </div>

            {/* ── URL tab ─────────────────────────────────────────────────────── */}
            {mode === 'url' && (
              <div className="import-section">
                <input
                  type="url"
                  placeholder="Paste recipe URL — Instagram, TikTok, AllRecipes, etc."
                  value={url}
                  onChange={handleUrlChange}
                  className="full-width"
                  onKeyDown={e => e.key === 'Enter' && handleUrlImport()}
                  autoFocus
                />

                {socialDetected && (
                  <div className="social-detected-bar">
                    <span className="social-badge">{socialDetected.platform}</span>
                    <span>
                      {socialDetected.platform === 'YouTube'
                        ? 'SpiceHub will extract the description and subtitles automatically.'
                        : 'Tap Import to extract the recipe automatically.'}
                    </span>
                  </div>
                )}

                {!socialDetected && (
                  <p className="help-text">
                    Paste any recipe URL — blogs, YouTube, Instagram, TikTok, and more.
                    Shortened links (bit.ly, t.co, etc.) are auto-resolved.
                    Paste multiple URLs to batch-import several recipes at once.
                  </p>
                )}

                {/* Batch progress indicator */}
                {batchProgress && (
                  <div className="batch-progress">
                    <div className="batch-progress-header">
                      <span>Importing {batchProgress.current} of {batchProgress.total} recipes…</span>
                    </div>
                    <div className="batch-progress-bar">
                      <div
                        className="batch-progress-fill"
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Render warmup animation */}
                {syncPhase === 'warmup' && (
                  <div className="warmup-phase">
                    <span className="warmup-label">Preparing your recipe…</span>
                    <button className="sync-cancel-btn warmup-cancel-btn" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Sync import progress */}
                {syncPhase === 'running' && (
                  <div className="sync-import-progress">
                    <div className="sync-import-stages">
                      {STAGES.map((stage, idx) => (
                        <div
                          key={stage.key}
                          className={`sync-stage${idx < syncStageIdx ? ' sync-stage--done' : ''}${idx === syncStageIdx ? ' sync-stage--active' : ''}`}
                        >
                          <span className="sync-stage-dot">
                            {idx < syncStageIdx ? '✓' : idx === syncStageIdx ? '●' : '○'}
                          </span>
                          <span className="sync-stage-label">{stage.label}</span>
                        </div>
                      ))}
                    </div>
                    <button className="sync-cancel-btn" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Success flash */}
                {syncPhase === 'success' && (
                  <div className="sync-import-success">
                    <span className="sync-success-check">✓</span>
                    <span className="sync-success-label">
                      {syncSuccessName ? `"${syncSuccessName}" saved!` : 'Recipe saved!'}
                    </span>
                  </div>
                )}

                <button
                  className="btn-primary"
                  onClick={handleUrlImport}
                  disabled={importing || syncPhase === 'running' || syncPhase === 'warmup' || !url.trim()}
                >
                  {importing ? (
                    <><span className="browser-spinner" /> {importProgress || 'Extracting recipe…'}</>
                  ) : 'Import Recipe'}
                </button>
              </div>
            )}

            {/* ── Paste Text tab (Mealie-style fallback) ────────────────────── */}
            {mode === 'paste' && (
              <div className="import-section">
                <div className="paste-import-banner">
                  <div className="paste-import-icon">📋</div>
                  <div>
                    <strong>Paste Recipe Text</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      Copy the recipe caption from Instagram, TikTok, or any source and paste it below.
                      SpiceHub will detect ingredients and directions automatically.
                    </p>
                  </div>
                </div>

                <textarea
                  className="paste-textarea full-width"
                  placeholder={"Paste recipe text here…\n\nExample:\nChicken Stir Fry\n\nIngredients:\n2 chicken breasts, diced\n1 tbsp soy sauce\n...\n\nDirections:\n1. Heat oil in a pan\n2. Cook chicken until golden\n..."}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  rows={10}
                />

                <input
                  type="url"
                  placeholder="Source URL (optional — for your reference)"
                  value={pasteLink}
                  onChange={e => setPasteLink(e.target.value)}
                  className="full-width"
                  style={{ marginTop: 8 }}
                />

                <button
                  className="btn-primary"
                  onClick={handlePasteImport}
                  disabled={!pasteText.trim()}
                  style={{ marginTop: 12 }}
                >
                  Parse Recipe
                </button>

                <p className="help-text" style={{ marginTop: 8 }}>
                  Tip: Include section headers like "Ingredients:" and "Directions:" for best results.
                  You can always edit the recipe after importing.
                </p>
              </div>
            )}

            {/* ── Image/Photo OCR tab ─────────────────────────────────────────── */}
            {mode === 'image' && (
              <div className="import-section">
                <div className="image-import-banner">
                  <div className="image-import-icon">📸</div>
                  <div>
                    <strong>Import from Photo</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      Take a photo of a recipe card, cookbook page, or screenshot. SpiceHub will read the text and extract the recipe.
                    </p>
                  </div>
                </div>

                {/* Hidden file inputs */}
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="file-input"
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="file-input"
                />

                {importing ? (
                  <div className="image-import-progress">
                    <span className="browser-spinner large" />
                    <p className="import-progress-text">{importProgress || 'Processing...'}</p>
                  </div>
                ) : (
                  <div className="image-import-buttons">
                    <button
                      className="btn-primary"
                      onClick={() => cameraRef.current?.click()}
                    >
                      Take Photo
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => imageRef.current?.click()}
                    >
                      Choose from Gallery
                    </button>
                  </div>
                )}

                <p className="help-text" style={{ marginTop: 12 }}>
                  Works with: recipe index cards, cookbook pages, screenshots of recipes, handwritten recipes (clear print works best).
                </p>
              </div>
            )}

            {/* ── Spreadsheet tab ──────────────────────────────────────────────── */}
            {mode === 'spreadsheet' && (
              <div className="import-section">
                <p className="help-text">
                  Upload a <strong>CSV</strong> or <strong>Excel</strong> file.
                  Columns: <code>Name | Ingredients (;-separated) | Directions (;-separated) | Link | Image URL</code>
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="file-input"
                />
                <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? 'Reading…' : 'Choose File (CSV / Excel)'}
                </button>
                <p className="help-text">First row is treated as a header and skipped.</p>
              </div>
            )}

            {/* ── Paprika tab ───────────────────────────────────────────────────── */}
            {mode === 'paprika' && (
              <div className="import-section paprika-section">
                <div className="paprika-banner">
                  <span className="paprika-logo">🌶️</span>
                  <div>
                    <strong>Import from Paprika 3</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      In Paprika 3, go to <strong>Settings → Export</strong> and choose
                      <em> Export All Recipes</em> to generate a <code>.paprikarecipes</code> file.
                      Then choose that file here.
                    </p>
                  </div>
                </div>
                <input
                  ref={paprikaRef}
                  type="file"
                  accept=".paprikarecipes"
                  onChange={handlePaprikaUpload}
                  className="file-input"
                />
                <button className="btn-primary paprika-btn" onClick={() => paprikaRef.current?.click()} disabled={importing}>
                  {importing ? (
                    <><span className="browser-spinner" /> Parsing Paprika file…</>
                  ) : (
                    'Choose .paprikarecipes File'
                  )}
                </button>
                <p className="help-text">
                  All recipes from the export will be previewed before import. Your existing library is not affected.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Preprocess image for better OCR quality:
 *   - Resize to optimal width (Tesseract works best around 2000-3000px wide)
 *   - Increase contrast
 *   - Convert to grayscale
 *   - Sharpen text edges
 * Returns a canvas element that Tesseract can accept.
 */
async function preprocessImageForOCR(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Scale to optimal OCR width (2500px) if larger or much smaller
      const TARGET_WIDTH = 2500;
      let w = img.width;
      let h = img.height;
      if (w > TARGET_WIDTH || w < 800) {
        const scale = TARGET_WIDTH / w;
        w = TARGET_WIDTH;
        h = Math.round(h * scale);
      }

      canvas.width = w;
      canvas.height = h;

      // Draw original
      ctx.drawImage(img, 0, 0, w, h);

      // Apply contrast enhancement and grayscale
      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          // Convert to grayscale using luminance formula
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

          // Increase contrast (stretch histogram)
          // Factor of 1.5 with midpoint at 128
          const contrast = 1.5;
          const adjusted = Math.max(0, Math.min(255, ((gray - 128) * contrast) + 128));

          data[i] = adjusted;     // R
          data[i + 1] = adjusted; // G
          data[i + 2] = adjusted; // B
          // Alpha stays the same
        }

        ctx.putImageData(imageData, 0, 0);
      } catch {
        // Canvas tainted (e.g. cross-origin image) — use original
      }

      resolve(canvas);
    };
    img.onerror = () => resolve(file); // Fallback to original file
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Clean common OCR artifacts and noise from recognized text.
 */
function cleanOcrText(text) {
  return text
    // Fix common OCR misreadings
    .replace(/\bl\b(?=\s*cup)/gi, '1')     // "l cup" → "1 cup"
    .replace(/\bO\b(?=\s*tbsp)/gi, '0')     // "O tbsp" → "0 tbsp"
    .replace(/\|/g, 'l')                     // pipe → l (common OCR error)
    // Remove stray single characters that aren't meaningful
    .replace(/^[|\\\/~`]{1,3}$/gm, '')
    // Fix doubled spaces
    .replace(/  +/g, ' ')
    // Remove lines that are just noise (single chars, symbols)
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length < 2) return false;
      // Skip lines that are mostly symbols/noise
      const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
      return alphaCount > trimmed.length * 0.3; // At least 30% alphabetic
    })
    .join('\n');
}

/**
 * Classify OCR lines into ingredients vs directions using cooking heuristics.
 * Much better than the naive "short = ingredient" approach.
 */
function classifyOcrLines(lines, recipe) {
  // Measurement units that strongly indicate ingredients
  const UNIT_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|cloves?|cans?|packages?|sticks?|slices?|bunch)\b/i;
  // Fractions at start of line strongly indicate ingredients
  const STARTS_WITH_NUM = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/;
  // Cooking action verbs strongly indicate directions
  const COOKING_VERB = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|melt|beat|cream|knead|roll|shape|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|top|finish|reduce|brown|sear|steam|in a)\b/i;
  // Numbered step at start
  const STEP_NUM = /^\d+[.):\s-]\s*/;

  let inIngredients = false;
  let inDirections = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section headers
    const lower = trimmed.toLowerCase();
    if (/^ingredients?:?\s*$/i.test(lower) || lower === 'you will need' || lower === "what you'll need") {
      inIngredients = true;
      inDirections = false;
      continue;
    }
    if (/^(directions?|instructions?|method|steps?|preparation):?\s*$/i.test(lower)) {
      inIngredients = false;
      inDirections = true;
      continue;
    }

    // If we're in a detected section, use that
    if (inIngredients) {
      recipe.ingredients.push(trimmed);
      continue;
    }
    if (inDirections) {
      recipe.directions.push(trimmed);
      continue;
    }

    // Heuristic classification
    const hasUnit = UNIT_RE.test(trimmed);
    const startsWithNum = STARTS_WITH_NUM.test(trimmed);
    const hasCookingVerb = COOKING_VERB.test(trimmed);
    const hasStepNum = STEP_NUM.test(trimmed);
    const isShort = trimmed.length < 50;

    // Strong ingredient signals
    if ((startsWithNum && hasUnit) || (isShort && hasUnit && !hasCookingVerb)) {
      recipe.ingredients.push(trimmed);
    }
    // Strong direction signals
    else if (hasCookingVerb || hasStepNum || trimmed.length > 80) {
      recipe.directions.push(trimmed);
    }
    // Moderate: starts with number + short = ingredient
    else if (startsWithNum && isShort) {
      recipe.ingredients.push(trimmed);
    }
    // Default: longer lines are more likely directions
    else if (trimmed.length > 40) {
      recipe.directions.push(trimmed);
    }
    // Short lines without clear signal — guess ingredient
    else {
      recipe.ingredients.push(trimmed);
    }
  }
}

// ── Paprika helpers ────────────────────────────────────────────────────────────

/**
 * Decompress a gzip-compressed Uint8Array to a UTF-8 string.
 * Uses the native browser DecompressionStream API (Chrome 80+, Safari 16+, FF 113+).
 */
async function decompressGzip(compressed) {
  const ds = new DecompressionStream("gzip");
  const decompressedStream = new Response(compressed).body.pipeThrough(ds);
  return await new Response(decompressedStream).text();
}

function splitSemicolon(str) {
  if (!str) return [];
  return str.split(';').map(s => s.trim()).filter(Boolean);
}

function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let inQuotes = false;
  let word = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      word += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(word);
      word = '';
    } else {
      word += char;
    }
  }
  result.push(word);
  return result;
}

function parsePaprikaRecipe(rec) {
  return {
    name: rec.name || 'Paprika Recipe',
    ingredients: (rec.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean),
    directions: (rec.directions || '').split('\n').map(s => s.trim()).filter(Boolean),
    notes: rec.notes || '',
    link: rec.source_url || '',
    imageUrl: rec.photo_url || ''
  };
}