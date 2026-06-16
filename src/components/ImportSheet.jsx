import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, MotionConfig, useDragControls } from 'framer-motion';
import { X, Sparkles, Check, ArrowLeft, Zap } from 'lucide-react';
import './ImportSheet.css';
import { hapticTap } from '../haptics';
import {
  importRecipeFromUrl,
  captionToRecipe,
  structureRecipeFromImage,
  scoreExtractionConfidence,
  isSocialMediaUrl,
  getSocialPlatform,
  detectImportType,
} from '../recipeParser.js';
import { cleanUrl } from '../api.js';
import { humanizeImportStatus } from '../importCopy.js';
import db from '../db.js';
import ImportInput from './ImportInput';
import ImportReview from './ImportReview';
import BrowserAssist from './BrowserAssist';

/**
 * normalizeRecipeForReview — single contract adapter between the import
 * engine's many return shapes and the ImportReview UI.
 *
 * The engine paths disagree on field names:
 *   - Instagram/Apify, captionToRecipe and BrowserAssist paths return
 *     `name` + `imageUrl` (the db shape); `title` may be missing or empty.
 *   - The Gemini structured path (thinFromStructured) returns `title`,
 *     `method` (drinks) and `_type`.
 *   - ImportReview reads `title`, `image`, `technique`, and `type`/`itemType`.
 * This maps everything onto one superset shape, keeping both aliases so the
 * review UI AND the downstream save path (which keys off `name`/`imageUrl`)
 * both work.
 *
 * @param {object|null} result        raw engine result
 * @param {string}      fallbackType  'meal' | 'drink' when the result carries no type
 */
export function normalizeRecipeForReview(result, fallbackType = 'meal') {
  if (!result) return null;
  const title = (result.title || result.name || '').trim();
  const image = result.image || result.imageUrl || result.capturedImageUrl || '';
  const technique = result.technique || result.method || '';
  const itemType =
    result.itemType || result.type || result._type
    || (result.kind === 'drink' ? 'drink' : '')
    || fallbackType || 'meal';
  return {
    ...result,
    title,
    name: result.name || title,
    image,
    imageUrl: result.imageUrl || image,
    ingredients: Array.isArray(result.ingredients) ? result.ingredients.filter(Boolean) : [],
    directions: Array.isArray(result.directions) ? result.directions.filter(Boolean) : [],
    notes: typeof result.notes === 'string' ? result.notes : '',
    technique,
    method: result.method || technique,
    itemType,
    type: result.type || itemType,
  };
}

/**
 * computeReviewConfidence — honest 0..1 value for the review badge.
 * ImportReview treats `confidence` as 0..1 (it renders Math.round(c * 100)%),
 * while scoreExtractionConfidence returns 0–100 — so the raw score must be
 * rescaled. When the model self-rated its extraction (thinFromStructured
 * passes `confidence` through as 0..1) we prefer that, blended with the
 * structural heuristic as a sanity check so an overconfident model can't
 * claim 95% on a two-line extraction (or a shy one bury a clean result).
 */
function computeReviewConfidence(recipe) {
  if (!recipe) return 0;
  const heuristic = scoreExtractionConfidence(recipe) / 100; // engine scores 0–100
  const model =
    typeof recipe.confidence === 'number' && recipe.confidence >= 0 && recipe.confidence <= 1
      ? recipe.confidence
      : null;
  if (model == null) return heuristic;
  return Math.max(0, Math.min(1, 0.6 * model + 0.4 * heuristic));
}

/**
 * ImportSheet — top-level orchestrator for the Collapse & Reveal import flow.
 *
 * Manages a phase state machine:
 *   input    → user picks URL / paste / photo
 *   loading  → engine running, progress shown
 *   review   → parsed recipe displayed for editing before save
 *   browserAssist → fallback visual extraction
 *
 * Props:
 *   onImport(recipes[])   — called with final recipe array
 *   onClose()
 *   title                 — modal title string
 *   sharedContent         — optional { mode, url, text, title } from share-target
 *   initialItemType       — 'meal' | 'drink'
 */
export default function ImportSheet({
  onImport,
  onClose,
  title = 'Import Recipe',
  sharedContent = null,
  initialItemType = 'meal',
  initialRecipe = null,
  initialPhase = null,
}) {
  // ── Phase state machine ──────────────────────────────────────────────────
  const [phase, setPhase] = useState('input'); // 'input' | 'loading' | 'review' | 'browserAssist'
  // E.4: backgrounded — sheet collapses to a floating toast while the import
  // keeps running (component stays mounted, so the in-flight promise survives)
  const [backgrounded, setBackgrounded] = useState(false);
  const [recipe, setRecipe] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [itemType, setItemType] = useState(initialItemType);
  const [browserAssistSeed, setBrowserAssistSeed] = useState(null);
  const [capturedText, setCapturedText] = useState('');

  // ── Input and review state lifted for single CTA ────────────────────────
  const [url, setUrl] = useState(sharedContent?.url || '');
  const [pasteText, setPasteText] = useState('');
  const [activeTab, setActiveTab] = useState('url');
  const [destination, setDestination] = useState('library');

  // ── Modals & Banners state ──────────────────────────────────────────────
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [confirmImport, setConfirmImport] = useState(null);
  const [draftToResume, setDraftToResume] = useState(null);

  // ── Loading state ────────────────────────────────────────────────────────
  const [elapsedTime, setElapsedTime] = useState(0);
  const [loadingImage, setLoadingImage] = useState('');
  const [pipelineSteps, setPipelineSteps] = useState([]);

  const abortRef = useRef(null);
  const browserAssistRef = useRef(null);
  const lastReviewRef = useRef(null);
  const sheetRef = useRef(null);

  // ── Slide-down-to-dismiss drag handle ────────────────────────────────────
  const sheetDragControls = useDragControls();

  // ── Save/Restore focus on mount/unmount ──────────────────────────────────
  useEffect(() => {
    const activeBefore = document.activeElement;
    return () => {
      if (activeBefore && typeof activeBefore.focus === 'function') {
        activeBefore.focus();
      }
    };
  }, []);

  // ── Dialog focus trap ────────────────────────────────────────────────────
  useEffect(() => {
    if (backgrounded) return;
    const handleFocusTrap = (e) => {
      if (e.key !== 'Tab' || !sheetRef.current) return;
      
      const focusableElements = Array.from(
        sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabIndex]:not([tabIndex="-1"])'
        )
      ).filter((el) => {
        return !el.disabled && el.offsetParent !== null;
      });

      if (focusableElements.length === 0) return;
      const firstEl = focusableElements[0];
      const lastEl = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          lastEl.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastEl) {
          firstEl.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleFocusTrap);
    return () => window.removeEventListener('keydown', handleFocusTrap);
  }, [backgrounded]);

  // ── Manage initial focus ─────────────────────────────────────────────────
  useEffect(() => {
    if (backgrounded) return;
    const focusTimer = setTimeout(() => {
      if (!sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabIndex]:not([tabIndex="-1"])'
        )
      ).filter((el) => !el.disabled && el.offsetParent !== null);
      
      if (focusable.length > 0) {
        const closeBtn = focusable.find(el => el.classList.contains('import-sheet-close'));
        if (closeBtn) {
          closeBtn.focus();
        } else {
          focusable[0].focus();
        }
      }
    }, 100);
    return () => clearTimeout(focusTimer);
  }, [backgrounded, phase]);

  // ── Abort any in-flight import on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Auto-import from share target ────────────────────────────────────────
  useEffect(() => {
    if (sharedContent && sharedContent.url) {
      handleUrlImport(sharedContent.url, initialItemType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Batch review: open directly into review with a pre-extracted recipe ──
  // Used by BatchImportQueue when the user taps a "ready" row — skips
  // re-extraction entirely and reuses the existing review/save UI.
  useEffect(() => {
    if (initialRecipe && initialPhase === 'review') {
      const fallbackType = initialRecipe.itemType || initialRecipe.type || initialItemType;
      const normalized = normalizeRecipeForReview(initialRecipe, fallbackType);
      setRecipe(normalized);
      setConfidence(computeReviewConfidence(normalized));
      setItemType(normalized.itemType);
      setPhase('review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load persisted drafts on mount ───────────────────────────────────────
  useEffect(() => {
    db.importDrafts?.toArray().then(drafts => {
      if (drafts && drafts.length > 0) {
        const sorted = drafts.sort((a, b) => b.timestamp - a.timestamp);
        setDraftToResume(sorted[0]);
      }
    }).catch(err => console.warn('[ImportSheet] Failed to load drafts:', err));
  }, []);

  // ── Auto-save draft on review changes ─────────────────────────────────────
  useEffect(() => {
    if (phase === 'review' && recipe) {
      const key = importUrl || (activeTab === 'paste' ? 'pasted-text' : activeTab === 'photo' ? 'photo-import' : 'pasted-text');
      db.importDrafts?.put({
        url: key,
        recipe,
        confidence,
        timestamp: Date.now()
      }).catch(e => console.warn(e));
    }
  }, [recipe, confidence, phase, importUrl, activeTab]);

  // ── Loading Timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'loading') {
      setElapsedTime(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ── Discard / Close Handling ─────────────────────────────────────────────
  const handleCloseRequest = useCallback(() => {
    if (phase === 'review') {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [phase, onClose]);

  // ── Slide-down-to-dismiss: drag release handler ──────────────────────────
  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleCloseRequest();
    }
  }, [handleCloseRequest]);

  // ── Escape Key Scrim Handler ──────────────────────────────────────────────
  useEffect(() => {
    if (backgrounded) return;
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [backgrounded, handleCloseRequest]);

  // ── Execute URL Import ───────────────────────────────────────────────────
  const executeUrlImport = useCallback(async (rawUrl, type) => {
    const cleanU = cleanUrl(rawUrl);
    if (!cleanU) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setImportUrl(cleanU);
    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setLoadingImage('');
    setProgressMsg('Getting your recipe…');
    if (isSocialMediaUrl(cleanU)) {
      setPipelineSteps([
        { label: 'Checking the video',     status: 'pending' },
        { label: 'Grabbing the caption',   status: 'pending' },
        { label: 'Reading the page',       status: 'pending' },
        { label: 'Organizing the recipe',  status: 'pending' },
      ]);
    } else {
      setPipelineSteps([]);
    }

    try {
      const result = await importRecipeFromUrl(
        cleanU,
        (msg, metadata) => {
          if (controller.signal.aborted) return;
          setProgressMsg(humanizeImportStatus(msg));
          if (metadata) {
            if (metadata.imageUrl) setLoadingImage(metadata.imageUrl);
            setPipelineSteps(prev => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              let activeIndex = -1;
              if (/subtitle|transcript|asr|audio/i.test(msg)) activeIndex = 0;
              else if (/caption|embed|oembed|instagram|reel|tiktok/i.test(msg)) activeIndex = 1;
              else if (/browser|server|yt-dlp|puppeteer|headless|proxy|fetching page|page text/i.test(msg)) activeIndex = 2;
              else if (/structur|gemini|\bai\b|markdown|parse/i.test(msg)) activeIndex = 3;

              if (activeIndex !== -1) {
                for (let j = 0; j < activeIndex; j++) {
                  if (next[j].status === 'pending' || next[j].status === 'running') next[j].status = 'done';
                }
                next[activeIndex].status = 'running';
              }
              return next;
            });
          }
        },
        { type: type || initialItemType, signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      if (result && result._needsBrowserAssist) {
        if (result._emptyCaption) {
          setError("We couldn't find recipe text in this post. Paste it below and we'll sort it for you.");
        }
        setBrowserAssistSeed(result.seed || null);
        setCapturedText(result.capturedCaption || '');
        setImportUrl(cleanU);
        setPhase('browserAssist');
        return;
      }

      const normalized = normalizeRecipeForReview(result, type || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        setError("We couldn't find a recipe at that link. Try pasting the recipe text instead?");
        setPhase('input');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[ImportSheet] URL import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  const handleUrlImport = useCallback(async (rawUrl, type) => {
    if (!navigator.onLine) {
      setError("You're offline. We'll import this as soon as you're back — or paste the recipe text now.");
      return;
    }
    if (phase === 'review' || lastReviewRef.current) {
      setConfirmImport({
        fn: () => {
          lastReviewRef.current = null;
          setConfirmImport(null);
          executeUrlImport(rawUrl, type);
        },
        message: "This will replace the recipe you're reviewing."
      });
    } else {
      executeUrlImport(rawUrl, type);
    }
  }, [phase, executeUrlImport]);

  // ── Execute Paste Import ──────────────────────────────────────────────────
  const executePasteImport = useCallback(async (text, type) => {
    if (!text || !text.trim()) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;

    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setLoadingImage('');
    setProgressMsg('Sorting ingredients from instructions…');

    try {
      const result = await captionToRecipe(text, { type: type || initialItemType });
      const normalized = normalizeRecipeForReview(result, type || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        setError("That text didn't look like a recipe to us. Add the ingredients or steps and try again.");
        setPhase('input');
      }
    } catch (err) {
      console.error('[ImportSheet] Paste import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  const handlePasteImport = useCallback(async (text, type) => {
    if (phase === 'review' || lastReviewRef.current) {
      setConfirmImport({
        fn: () => {
          lastReviewRef.current = null;
          setConfirmImport(null);
          executePasteImport(text, type);
        },
        message: "This will replace the recipe you're reviewing."
      });
    } else {
      executePasteImport(text, type);
    }
  }, [phase, executePasteImport]);

  // ── Execute Photo Import ──────────────────────────────────────────────────
  const executePhotoImport = useCallback(async (imageDataUrl, type) => {
    if (!imageDataUrl) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;

    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setLoadingImage('');
    setProgressMsg('Reading your photo…');

    try {
      const result = await structureRecipeFromImage(imageDataUrl, { type: type || initialItemType });
      const normalized = normalizeRecipeForReview(result, type || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        setError("We couldn't read a recipe in that photo. Try a brighter shot, or paste the text instead.");
        setPhase('input');
      }
    } catch (err) {
      console.error('[ImportSheet] Photo import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  const handlePhotoImport = useCallback(async (imageDataUrl, type) => {
    if (phase === 'review' || lastReviewRef.current) {
      setConfirmImport({
        fn: () => {
          lastReviewRef.current = null;
          setConfirmImport(null);
          executePhotoImport(imageDataUrl, type);
        },
        message: "This will replace the recipe you're reviewing."
      });
    } else {
      executePhotoImport(imageDataUrl, type);
    }
  }, [phase, executePhotoImport]);

  // ── BrowserAssist recipe callback ────────────────────────────────────────
  const handleBrowserAssistRecipe = useCallback((extractedRecipe) => {
    const normalized = normalizeRecipeForReview(extractedRecipe, itemType);
    if (normalized && (normalized.title || normalized.ingredients.length)) {
      setRecipe(normalized);
      setConfidence(computeReviewConfidence(normalized));
      setPhase('review');
    } else {
      setError('Browser assist could not extract a recipe.');
      setPhase('input');
    }
  }, [itemType]);

  const handleBrowserAssistFallback = useCallback((fallbackText) => {
    setCapturedText(fallbackText || '');
    setPhase('input');
  }, []);

  // ── Save from review ─────────────────────────────────────────────────────
  const handleSave = useCallback((finalRecipe) => {
    if (!finalRecipe) return;
    const out = {
      ...finalRecipe,
      name: (finalRecipe.title || '').trim() || finalRecipe.name || '',
      imageUrl: finalRecipe.imageUrl || finalRecipe.image || '',
      method: finalRecipe.technique || finalRecipe.method || '',
    };
    // Clear draft from IndexedDB
    const key = importUrl || (activeTab === 'paste' ? 'pasted-text' : activeTab === 'photo' ? 'photo-import' : 'pasted-text');
    db.importDrafts?.delete(key).catch(e => console.warn(e));
    onImport([out], destination);
  }, [onImport, importUrl, activeTab, destination]);

  // ── Re-expand input from collapsed state ─────────────────────────────────
  const handleReExpand = useCallback(() => {
    if (phase === 'review') {
      lastReviewRef.current = { recipe, confidence };
    }
    if (abortRef.current) abortRef.current.abort();
    setPhase('input');
    setError('');
    setProgressMsg('');
  }, [phase, recipe, confidence]);

  // ── E.4: gentle haptic when a backgrounded import becomes ready ──────────
  useEffect(() => {
    if (backgrounded && (phase === 'review' || phase === 'browserAssist')) {
      try { navigator.vibrate?.(12); } catch { /* no haptics — fine */ }
    }
  }, [backgrounded, phase]);

  // ── E.4: backgrounded — render only the floating status toast ────────────
  if (backgrounded) {
    return (
      <motion.button
        className={`import-sheet-toast${phase === 'review' ? ' ready' : ''}`}
        onClick={() => setBackgrounded(false)}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        aria-live="polite"
      >
        {phase === 'loading' && (
          <>
            <span className="import-sheet-progress-dot" aria-hidden="true" />
            <span>Importing recipe… tap to view</span>
          </>
        )}
        {phase === 'review' && (
          <>
            <Check size={16} aria-hidden="true" />
            <span>Recipe ready — tap to review</span>
          </>
        )}
        {(phase === 'input' || phase === 'browserAssist') && (
          <span>Import needs your help — tap to continue</span>
        )}
      </motion.button>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <MotionConfig reducedMotion="user">
      <div
        className="import-sheet-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCloseRequest();
        }}
      >
        <motion.div
          className="import-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-sheet-title"
          ref={sheetRef}
          drag="y"
          dragListener={false}
          dragControls={sheetDragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
          onDragEnd={handleSheetDragEnd}
        >
          {/* Grab handle — drag-down to dismiss */}
          <div
            className="import-sheet-grab"
            onPointerDown={(e) => sheetDragControls.start(e)}
          />

          {/* Header */}
          <div className="import-sheet-header">
            <h2 id="import-sheet-title">{title}</h2>
            <button
              className="import-sheet-close"
              onClick={handleCloseRequest}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>

          {/* Body */}
          <div className="import-sheet-body">
            {/* Resume last draft banner */}
            {phase === 'input' && draftToResume && (
              <div className="import-sheet-resume-card">
                <div className="resume-head">
                  <span className="resume-icon"><Sparkles size={14} /></span>
                  <div className="resume-content">
                    <strong>Resume your last import?</strong>
                    <span className="resume-sub">We saved your edits for "{draftToResume.recipe.title || 'Untitled Recipe'}"</span>
                  </div>
                </div>
                <div className="resume-actions">
                  <button
                    type="button"
                    className="import-sheet-btn import-sheet-btn-secondary"
                    onClick={() => {
                      setRecipe(draftToResume.recipe);
                      setConfidence(draftToResume.confidence);
                      if (draftToResume.url && draftToResume.url !== 'pasted-text' && draftToResume.url !== 'photo-import') {
                        setUrl(draftToResume.url);
                        setImportUrl(draftToResume.url);
                      } else if (draftToResume.url === 'pasted-text') {
                        setPasteText(draftToResume.recipe.notes || '');
                      }
                      setPhase('review');
                      setDraftToResume(null);
                    }}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="import-sheet-btn import-sheet-btn-ghost"
                    onClick={() => {
                      db.importDrafts?.delete(draftToResume.url).catch(e => console.warn(e));
                      setDraftToResume(null);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Error banner */}
            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  className="import-sheet-error"
                  initial={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 8, marginBottom: 8 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                  transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <p>{error}</p>
                  <div className="import-sheet-error-actions">
                    {importUrl && (
                      <>
                        <button
                          type="button"
                          className="import-sheet-btn import-sheet-btn-secondary"
                          onClick={() => handleUrlImport(importUrl, itemType)}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="import-sheet-btn import-sheet-btn-ghost"
                          onClick={() => setPhase('browserAssist')}
                        >
                          Try in browser
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="import-sheet-btn import-sheet-btn-ghost"
                      onClick={() => {
                        setActiveTab('paste');
                        setError('');
                      }}
                    >
                      Paste instead
                    </button>
                    <button
                      type="button"
                      className="import-sheet-btn import-sheet-btn-ghost import-sheet-btn-dismiss"
                      onClick={() => setError('')}
                    >
                      Dismiss
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ImportInput — full or collapsed */}
            <ImportInput
              collapsed={phase !== 'input'}
              status={error ? 'error' : phase === 'loading' ? 'loading' : phase === 'review' ? 'ready' : 'idle'}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              url={url}
              setUrl={setUrl}
              pasteText={pasteText}
              setPasteText={setPasteText}
              itemType={itemType}
              setItemType={setItemType}
              onImport={handleUrlImport}
              onPasteImport={handlePasteImport}
              onPhotoImport={handlePhotoImport}
              onReExpand={handleReExpand}
              initialUrl={sharedContent?.url || ''}
              initialType={initialItemType}
              title={title}
            />

            {/* Back to review option (Fix 3) */}
            {phase === 'input' && lastReviewRef.current && (
              <button
                type="button"
                className="import-sheet-back-to-review-btn"
                onClick={() => {
                  const snapshot = lastReviewRef.current;
                  if (snapshot) {
                    setRecipe(snapshot.recipe);
                    setConfidence(snapshot.confidence);
                    setPhase('review');
                  }
                }}
              >
                <ArrowLeft size={16} /> Back to review
              </button>
            )}

            {/* Phase content — animated transitions (spec §1 collapse animation) */}
            <AnimatePresence mode="popLayout" initial={false}>
              {phase === 'loading' && (
                <motion.div
                  key="loading"
                  className="import-sheet-loading-container"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Single progress vector: pulsing dot + humanized status line */}
                  <div className="import-sheet-loading-status">
                    <span className="import-sheet-progress-dot" aria-hidden="true" />
                    <div className="import-sheet-loading-status-text">
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.p
                          key={progressMsg}
                          className="import-sheet-progress-text"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}
                        >
                          {progressMsg}
                        </motion.p>
                      </AnimatePresence>
                      {elapsedTime >= 8 && (
                        <span className="import-sheet-progress-subtext">
                          Still working — some sites are slow to share…
                        </span>
                      )}
                    </div>
                  </div>

                  {isSocialMediaUrl(importUrl) && pipelineSteps.length > 0 ? (
                    /* Social: Adopt BrowserAssist steps checklist for shared social loading component (Fix 10) */
                    <div className="import-sheet-pipeline">
                      <div className="import-sheet-steps">
                        {pipelineSteps.map((step, i) => (
                          <div key={i} className={`import-sheet-step import-sheet-step--${step.status}`}>
                            <div className="import-sheet-step-node">
                              {step.status === 'done' && <Check size={12} className="import-sheet-step-check" aria-hidden="true" />}
                              {step.status === 'running' && <span className="import-sheet-step-spinner" />}
                              {step.status === 'pending' && <span className="import-sheet-step-dot" />}
                            </div>
                            <span className="import-sheet-step-label">
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Non-social / Blog: Shimmer skeleton of review layout (Fix 4) */
                    <div className="import-sheet-skeleton">
                      {/* Hero skeleton */}
                      <div className="review-hero skeleton">
                        {loadingImage ? (
                          <div className="review-hero-image" style={{ backgroundImage: `url(${loadingImage})` }} />
                        ) : (
                          <div className="review-hero-placeholder shimmer" />
                        )}
                        <div className="review-hero-gradient" />
                        <div className="review-hero-title-wrap skeleton">
                          <div className="review-hero-title skeleton-title shimmer" />
                        </div>
                      </div>

                      {/* Tab skeleton */}
                      <div className="review-tabs skeleton">
                        <div className="review-tab skeleton shimmer" />
                        <div className="review-tab skeleton shimmer" />
                      </div>

                      {/* Rows skeleton */}
                      <div className="review-list skeleton">
                        {Array(5).fill(null).map((_, i) => (
                          <div key={i} className="review-row skeleton">
                            <div className="review-row-handle skeleton shimmer" />
                            <div className="skeleton-line shimmer" style={{ width: `${85 - (i % 3) * 10}%` }} />
                            <div className="review-row-more skeleton shimmer" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Continue in background inline button */}
                  {elapsedTime >= 25 && (
                    <motion.button
                      type="button"
                      className="import-sheet-btn-in-body-background"
                      onClick={() => setBackgrounded(true)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <Zap size={16} /> Continue in background
                  </motion.button>
                  )}
                </motion.div>
              )}

              {phase === 'review' && recipe && (
                <motion.div
                  key="review"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                >
                  <ImportReview
                    recipe={recipe}
                    onChange={setRecipe}
                    onSave={handleSave}
                    confidence={confidence}
                    destination={destination}
                    setDestination={setDestination}
                  />
                </motion.div>
              )}

              {phase === 'browserAssist' && (
                <motion.div
                  key="browserAssist"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                >
                  <BrowserAssist
                    ref={browserAssistRef}
                    url={importUrl}
                    onRecipeExtracted={handleBrowserAssistRecipe}
                    onFallbackToText={handleBrowserAssistFallback}
                    initialCapturedText={capturedText}
                    seedRecipe={browserAssistSeed}
                    type={itemType}
                    inline={true}
                    onError={(err) => {
                      console.warn('[ImportSheet] BrowserAssist error:', err);
                      setError('That page wouldn\'t cooperate. Paste the recipe text and we\'ll sort it for you.');
                      setPhase('input');
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sticky footer */}
          <div className="import-sheet-footer">
            {showDiscardConfirm ? (
              <div className="import-sheet-confirm-footer">
                <span className="confirm-text">Discard recipe?</span>
                <button
                  className="import-sheet-btn import-sheet-btn-ghost"
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  Keep editing
                </button>
                <button
                  className="import-sheet-btn import-sheet-btn-danger"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    const key = importUrl || (activeTab === 'paste' ? 'pasted-text' : activeTab === 'photo' ? 'photo-import' : 'pasted-text');
                    db.importDrafts?.delete(key).catch(e => console.warn(e));
                    onClose();
                  }}
                >
                  Discard
                </button>
              </div>
            ) : confirmImport ? (
              <div className="import-sheet-confirm-footer">
                <span className="confirm-text">{confirmImport.message}</span>
                <button
                  className="import-sheet-btn import-sheet-btn-ghost"
                  onClick={() => setConfirmImport(null)}
                >
                  Keep review
                </button>
                <button
                  className="import-sheet-btn import-sheet-btn-danger import-sheet-btn-replace"
                  onClick={() => {
                    confirmImport.fn();
                  }}
                >
                  Replace
                </button>
              </div>
            ) : (
              <>
                {phase === 'input' && (
                  <button
                    className="import-sheet-btn import-sheet-btn-primary"
                    onClick={() => {
                      if (activeTab === 'url') {
                        handleUrlImport(url, itemType);
                      } else if (activeTab === 'paste') {
                        handlePasteImport(pasteText, itemType);
                      }
                    }}
                    disabled={
                      (activeTab === 'url' && !url.trim()) ||
                      (activeTab === 'paste' && !pasteText.trim()) ||
                      activeTab === 'photo'
                    }
                  >
                    Import {itemType === 'drink' ? 'drink' : 'recipe'}
                  </button>
                )}
                {phase === 'loading' && (
                  <>
                    <button
                      className="import-sheet-btn import-sheet-btn-ghost"
                      onClick={() => {
                        if (abortRef.current) abortRef.current.abort();
                        setPhase('input');
                        setProgressMsg('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="import-sheet-btn import-sheet-btn-secondary"
                      onClick={() => setBackgrounded(true)}
                    >
                      Continue in background
                    </button>
                  </>
                )}
                {phase === 'review' && (
                  <button
                    className="import-sheet-btn import-sheet-btn-primary"
                    onClick={() => { hapticTap(); handleSave(recipe); }}
                  >
                    Save to {destination === 'library' ? 'Library' : destination === 'week' ? 'This Week' : destination === 'grocery' ? 'Grocery' : 'Bar'}
                  </button>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
