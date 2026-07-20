import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, MotionConfig, useDragControls } from 'framer-motion';
import { X, Sparkles, Check, ArrowLeft, Zap, Mic } from 'lucide-react';
import './ImportSheet.css';
import useBackHandler from '../hooks/useBackHandler';
import { hapticTap, hapticSuccess, hapticError } from '../haptics';
import {
  importRecipeFromUrl,
  captionToRecipe,
  scoreExtractionConfidence,
  isSocialMediaUrl,
  getSocialPlatform,
  detectImportType,
  transcribeVideoForRecipe,
} from '../recipeParser.js';
import { importRecipeFromPages, PhotoImportError } from '../lib/photoImportEngine.js';
import { detectVideoSource } from '../lib/videoSource.js';
import { cleanUrl } from '../api.js';
import { ENGINE_PROMPT_VERSION } from '../recipeSchema.js';
import { humanizeImportStatus } from '../importCopy.js';
import db, { queuePhotoUpgrade } from '../db.js';
import useOnlineStatus from '../hooks/useOnlineStatus';
import ImportInput from './ImportInput';
import ImportReview from './ImportReview';
import BrowserAssist from './BrowserAssist';
import ImportTimeline from './import/ImportTimeline.jsx';
import { advanceTimeline, INITIAL_TIMELINE } from '../import/progressMap.js';

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
export function computeReviewConfidence(recipe) {
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
  // Multi-page scan session — lives here (not in ImportInput) because the
  // original pages are needed again at review time for dish-photo re-cropping.
  const [scanPages, setScanPages] = useState([]);
  const [destination, setDestination] = useState('library');

  // Single source of truth for the IndexedDB draft key. Autosave, save-cleanup
  // and discard all derive the key the same way — so a draft can't be written
  // under one key and orphaned because another site computed a different one.
  const draftKey = useCallback(
    () => importUrl || (activeTab === 'photo' ? 'photo-import' : 'pasted-text'),
    [importUrl, activeTab],
  );

  // ── Modals & Banners state ──────────────────────────────────────────────
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [confirmImport, setConfirmImport] = useState(null);
  const [draftToResume, setDraftToResume] = useState(null);

  // ── Offline import queue badge ───────────────────────────────────────────
  const { isOnline } = useOnlineStatus();
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      db.importQueue?.where('status').anyOf(['pending', 'failed']).count()
        .then(n => { if (!cancelled) setPendingQueueCount(n || 0); })
        .catch(() => {});
    };
    refresh();
    // The event listener below is the primary update path; this interval is
    // just a rare fallback in case some queue mutation site fails to dispatch
    // the event, so it doesn't need to poll every 4s.
    const id = setInterval(refresh, 30000);
    window.addEventListener('spicehub:import-queue-updated', refresh);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('spicehub:import-queue-updated', refresh);
    };
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────
  const [elapsedTime, setElapsedTime] = useState(0);
  const [loadingImage, setLoadingImage] = useState('');
  // Unified three-stage timeline: { stage: 0..2, chip: string|null }.
  // Stages only advance forward within one import (progressMap.advanceTimeline).
  const [timeline, setTimeline] = useState(INITIAL_TIMELINE);

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
      const key = draftKey();
      db.importDrafts?.put({
        url: key,
        recipe,
        confidence,
        timestamp: Date.now()
      }).catch(e => console.warn(e));
    }
  }, [recipe, confidence, phase, importUrl, activeTab, draftKey]);

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

  // Track 2: stepped back — loading/review/assist step down before sheet closes.
  // App still owns the outer 'import' layer (closes sheet on input phase).
  const handleSteppedBack = useCallback(() => {
    if (backgrounded) {
      setBackgrounded(false);
      return;
    }
    if (showDiscardConfirm) {
      setShowDiscardConfirm(false);
      return;
    }
    if (phase === 'browserAssist') {
      setPhase('input');
      return;
    }
    if (phase === 'review') {
      setShowDiscardConfirm(false);
      setRecipe(null);
      setPhase('input');
      return;
    }
    if (phase === 'loading') {
      try { abortRef.current?.abort(); } catch { /* */ }
      setPhase('input');
      setError('');
      return;
    }
    onClose();
  }, [backgrounded, showDiscardConfirm, phase, onClose]);

  useBackHandler(
    !backgrounded && (phase === 'loading' || phase === 'review' || phase === 'browserAssist' || showDiscardConfirm),
    handleSteppedBack,
    showDiscardConfirm ? 'import-discard' : `import-${phase}`,
  );

  // ── Slide-down-to-dismiss: drag release handler ──────────────────────────
  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleCloseRequest();
    }
  }, [handleCloseRequest]);

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
    setTimeline(INITIAL_TIMELINE);

    try {
      const result = await importRecipeFromUrl(
        cleanU,
        (msg, metadata) => {
          if (controller.signal.aborted) return;
          setProgressMsg(humanizeImportStatus(msg));
          // One mapper for every source type — raw message → stage + tier chip.
          setTimeline(t => advanceTimeline(t, msg));
          if (metadata?.imageUrl) setLoadingImage(metadata.imageUrl);
        },
        { type: type || initialItemType, signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      // ── Video transcription fallback ────────────────────────────────────
      // When the standard caption/scrape pipeline fails on a video URL,
      // try speech-to-text transcription before falling through to
      // browserAssist or error. This catches recipe reels/shorts where the
      // recipe is spoken, not written in the caption.
      const isVideo = detectVideoSource(cleanU);
      const captionWeak =
        (result && result._needsBrowserAssist && result._emptyCaption) ||
        (!result || (!result.title && !result.name && !(result.ingredients || []).length));

      if (isVideo && captionWeak && !controller.signal.aborted) {
        setProgressMsg('No caption found — transcribing video audio…');
        setTimeline(t => ({ stage: Math.max(t.stage, 1), chip: 'Video audio' }));

        try {
          const transcribeResult = await transcribeVideoForRecipe(cleanU, {
            onProgress: (tier, msg) => {
              if (!controller.signal.aborted) setProgressMsg(msg);
            },
            signal: controller.signal,
            type: type || initialItemType,
            imageUrl: result?.capturedImageUrl || '',
          });

          if (controller.signal.aborted) return;

          if (transcribeResult) {
            const tNorm = normalizeRecipeForReview(transcribeResult, type || initialItemType);
            if (tNorm && (tNorm.title || tNorm.ingredients.length)) {
              setTimeline(t => ({ ...t, stage: 2 }));
              setRecipe(tNorm);
              setConfidence(computeReviewConfidence(tNorm));
              setPhase('review');
              return;
            }
          }
        } catch (tErr) {
          if (tErr.name === 'AbortError') return;
          console.warn('[ImportSheet] Transcription fallback failed:', tErr.message);
        }
        // Transcription didn't yield a recipe — fall through to normal fallback
      }

      // 2026-07-14: BrowserAssist (the in-app iframe "browser assist" fallback)
      // is disabled — commented out below, not deleted. It confused users as an
      // unexplained second import surface, and its own fallback is structurally
      // blocked for non-Instagram/YouTube sources by the app's CSP frame-src
      // allowlist, so it could never succeed there anyway. Route straight to
      // the same graceful "paste it yourself" recovery its own onError already
      // used, instead of opening a surface that's disabled.
      if (result && result._needsBrowserAssist) {
        hapticError();
        setError("We couldn't automatically read this post. Paste the recipe text below and we'll sort it for you.");
        setCapturedText(result.capturedCaption || '');
        setImportUrl(cleanU);
        setPhase('input');
        return;
      }

      const normalized = normalizeRecipeForReview(result, type || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        hapticError();
        setError("We couldn't find a recipe at that link. Try pasting the recipe text instead?");
        setPhase('input');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[ImportSheet] URL import error:', err);
      hapticError();
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  const handleUrlImport = useCallback(async (rawUrl, type) => {
    if (!navigator.onLine) {
      hapticError();
      // Link imports need a live connection to fetch the page — we can't queue a
      // bare URL for later (the offline queue only re-runs already-parsed recipes
      // and on-device photo scans). Point the user at the path that works offline.
      setError("You're offline — link imports need a connection. Paste the recipe text and we'll sort it right now.");
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
    setTimeline({ stage: 2, chip: null });
    setError('');
    setLoadingImage('');
    setProgressMsg('Sorting ingredients from instructions…');

    // The pasted text IS the caption — stash it so a re-extraction can re-run
    // it later from the saved recipe (I-5) without any re-scrape.
    setCapturedText(text);

    try {
      const result = await captionToRecipe(text, { type: type || initialItemType });
      const normalized = normalizeRecipeForReview(result, type || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        hapticError();
        setError("That text didn't look like a recipe to us. Add the ingredients or steps and try again.");
        setPhase('input');
      }
    } catch (err) {
      console.error('[ImportSheet] Paste import error:', err);
      hapticError();
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

  // ── Execute Photo Import (multi-page, tiered vision pipeline) ────────────
  const executePhotoImport = useCallback(async (pages, type) => {
    if (!Array.isArray(pages) || pages.length === 0) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveType = type || initialItemType;
    setItemType(effectiveType);
    setPhase('loading');
    setError('');
    setLoadingImage('');
    setProgressMsg(pages.length > 1 ? `Reading ${pages.length} pages…` : 'Reading your photo…');
    setTimeline({ stage: 0, chip: pages.length > 1 ? `${pages.length} pages` : 'Photo scan' });

    // Map engine stages onto the unified timeline:
    // prep/transcribe = Fetching(0)+Understanding(1), structure/photo = Polishing(2).
    const stageIndex = { prep: 0, transcribe: 1, structure: 2, photo: 2 };
    const onProgress = (stage, msg) => {
      if (controller.signal.aborted) return;
      setProgressMsg(msg);
      const idx = stageIndex[stage] ?? 0;
      setTimeline(t => ({ ...t, stage: Math.max(t.stage, idx) }));
    };

    try {
      const result = await importRecipeFromPages(pages, {
        type: effectiveType,
        onProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const normalized = normalizeRecipeForReview(result, effectiveType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setTimeline(t => ({ ...t, stage: 2 }));
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        hapticError();
        setError("We couldn't read a recipe in that scan. Try a brighter shot, or paste the text instead.");
        setPhase('input');
      }
    } catch (err) {
      if (err?.code === 'aborted' || err?.name === 'AbortError') return;
      console.error('[ImportSheet] Photo import error:', err);
      hapticError();
      setError(
        err instanceof PhotoImportError
          ? err.message
          : err.message || 'Photo import failed.',
      );
      setPhase('input');
    }
  }, [initialItemType]);

  // Accepts either the scan-session pages array or a single data URL (legacy
  // drop/paste and share paths) — normalizes to the pages shape.
  const handlePhotoImport = useCallback(async (pagesOrDataUrl, type) => {
    const pages = typeof pagesOrDataUrl === 'string'
      ? [{ id: `p-${Date.now()}`, dataUrl: pagesOrDataUrl, source: 'share' }]
      : pagesOrDataUrl;
    if (phase === 'review' || lastReviewRef.current) {
      setConfirmImport({
        fn: () => {
          lastReviewRef.current = null;
          setConfirmImport(null);
          executePhotoImport(pages, type);
        },
        message: "This will replace the recipe you're reviewing."
      });
    } else {
      executePhotoImport(pages, type);
    }
  }, [phase, executePhotoImport]);

  // ── Execute Transcribe Import (standalone, for retry/button) ────────────
  const executeTranscribeImport = useCallback(async (videoUrl, type) => {
    const cleanU = cleanUrl(videoUrl || importUrl);
    if (!cleanU) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setError('');
    setLoadingImage('');
    setProgressMsg('Transcribing video audio…');
    setTimeline({ stage: 0, chip: 'Video audio' });

    try {
      const result = await transcribeVideoForRecipe(cleanU, {
        onProgress: (tier, msg) => {
          if (controller.signal.aborted) return;
          setProgressMsg(msg);
          setTimeline(t => advanceTimeline(t, msg));
        },
        signal: controller.signal,
        type: type || itemType || initialItemType,
      });

      if (controller.signal.aborted) return;

      const normalized = normalizeRecipeForReview(result, type || itemType || initialItemType);
      if (normalized && (normalized.title || normalized.ingredients.length)) {
        setTimeline(t => ({ ...t, stage: 2 }));
        setRecipe(normalized);
        setConfidence(computeReviewConfidence(normalized));
        setPhase('review');
      } else {
        hapticError();
        setError('Transcription finished but no recipe was found in the audio. Try pasting the recipe text instead.');
        setPhase('input');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[ImportSheet] Transcribe import error:', err);
      hapticError();
      setError(err.message || 'Transcription failed.');
      setPhase('input');
    }
  }, [importUrl, itemType, initialItemType]);

  // ── BrowserAssist recipe callback ────────────────────────────────────────
  const handleBrowserAssistRecipe = useCallback((extractedRecipe) => {
    const normalized = normalizeRecipeForReview(extractedRecipe, itemType);
    if (normalized && (normalized.title || normalized.ingredients.length)) {
      setRecipe(normalized);
      setConfidence(computeReviewConfidence(normalized));
      setPhase('review');
    } else {
      hapticError();
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
    // ── I-5 self-healing stamp ──────────────────────────────────────────────
    // Persist the cached caption + the engine version + confidence so the Meal
    // Library can later re-run extraction on the stored caption (no re-scrape)
    // and honestly surface low-confidence imports for one-tap improvement.
    const storedCaption =
      (typeof finalRecipe.sourceCaption === 'string' && finalRecipe.sourceCaption) ||
      capturedText ||
      (activeTab === 'paste' ? pasteText : '') ||
      '';
    const finalConfidence =
      typeof confidence === 'number' ? confidence
      : typeof finalRecipe.confidence === 'number' ? finalRecipe.confidence
      : null;
    const out = {
      ...finalRecipe,
      name: (finalRecipe.title || '').trim() || finalRecipe.name || '',
      imageUrl: finalRecipe.imageUrl || finalRecipe.image || '',
      method: finalRecipe.technique || finalRecipe.method || '',
      sourceCaption: storedCaption,
      confidence: finalConfidence,
      needsReview:
        typeof finalRecipe.needsReview === 'boolean'
          ? finalRecipe.needsReview
          : (finalConfidence != null ? finalConfidence < 0.75 : false),
      engineVersion: ENGINE_PROMPT_VERSION,
      extractedAt: finalRecipe.extractedAt || new Date().toISOString(),
    };
    // Clear draft from IndexedDB
    const key = draftKey();
    db.importDrafts?.delete(key).catch(e => console.warn(e));

    // Offline OCR draft → queue a background vision upgrade with the scanned
    // pages. When connectivity returns, processImportQueue re-runs the online
    // tiers and merges the better extraction into the saved recipe.
    if (out._ocrDraft && scanPages.length > 0) {
      queuePhotoUpgrade(out, scanPages.map(p => p.dataUrl), out.itemType || itemType)
        .then(() => window.dispatchEvent(new Event('spicehub:import-queue-updated')))
        .catch(e => console.warn('[ImportSheet] queuePhotoUpgrade failed:', e));
    }

    hapticSuccess();
    onImport([out], destination);
  }, [onImport, importUrl, activeTab, destination, capturedText, pasteText, confidence, scanPages, itemType, draftKey]);

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
                        {detectVideoSource(importUrl) && (
                          <button
                            type="button"
                            className="import-sheet-btn import-sheet-btn-secondary"
                            onClick={() => executeTranscribeImport(importUrl, itemType)}
                          >
                            <Mic size={14} /> Transcribe Video
                          </button>
                        )}
                        {/* "Try in browser" (BrowserAssist) removed 2026-07-14 — see
                            the commented-out render block further down for why. */}
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
              scanPages={scanPages}
              setScanPages={setScanPages}
              onReExpand={handleReExpand}
              initialUrl={sharedContent?.url || ''}
              initialType={initialItemType}
              title={title}
            />

            {/* Offline / pending-import status banner */}
            <AnimatePresence initial={false}>
              {phase === 'input' && pendingQueueCount > 0 && (
                <motion.div
                  key="pending-queue-banner"
                  className={`import-sheet-queue-banner${isOnline ? ' syncing' : ' offline'}`}
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <span className="import-sheet-queue-icon" aria-hidden="true">
                    {isOnline ? '🔄' : '⏳'}
                  </span>
                  <span className="import-sheet-queue-text">
                    {pendingQueueCount} pending import{pendingQueueCount === 1 ? '' : 's'}
                    {isOnline ? ' · syncing…' : ' · waiting for connection'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

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
                  {/* Unified three-stage timeline: Fetching → Understanding → Polishing
                      + tier chip + crossfading status line (spec §10). */}
                  <ImportTimeline
                    stage={timeline.stage}
                    chip={timeline.chip}
                    statusMsg={progressMsg}
                    slow={elapsedTime >= 8}
                  />

                  {(
                    /* Shimmer skeleton of the review layout below the timeline */
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

                  {/* Backgrounding lives in the sticky footer during loading —
                      no duplicate in-body button (was shown after 25s). */}
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
                    scanPages={scanPages}
                  />
                </motion.div>
              )}

              {/* BrowserAssist disabled 2026-07-14 (2026-07-13 critique: unexplained
                  "secondary importer" that confused users, and whose own iframe
                  fallback is structurally blocked by CSP frame-src for anything
                  but Instagram/YouTube). The phase === 'browserAssist' transition
                  is no longer triggered anywhere (see handleUrlImport / the removed
                  "Try in browser" button above) — kept commented, not deleted, in
                  case it's worth reviving with a narrower, explained scope later.
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
                      hapticError();
                      setError('That page wouldn\'t cooperate. Paste the recipe text and we\'ll sort it for you.');
                      setPhase('input');
                    }}
                  />
                </motion.div>
              )}
              */}
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
                    db.importDrafts?.delete(draftKey()).catch(e => console.warn(e));
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
                      } else if (activeTab === 'photo') {
                        handlePhotoImport(scanPages, itemType);
                      }
                    }}
                    disabled={
                      (activeTab === 'url' && !url.trim()) ||
                      (activeTab === 'paste' && !pasteText.trim()) ||
                      (activeTab === 'photo' && scanPages.length === 0)
                    }
                  >
                    <Zap size={17} strokeWidth={2.5} aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-3px' }} />
                    {activeTab === 'photo'
                      ? `Extract Recipe${scanPages.length > 1 ? ` (${scanPages.length} pages)` : ''}`
                      : 'Auto-Parse & Import'}
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
