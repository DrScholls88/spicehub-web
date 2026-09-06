import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, MotionConfig, useDragControls } from 'framer-motion';
import { X, Sparkles, Check, ArrowLeft } from 'lucide-react';
import './ImportSheet.css';
import useBackHandler from '../hooks/useBackHandler';
import { hapticTap, hapticSuccess, hapticError } from '../haptics';
import {
  importRequest,
  scoreExtractionConfidence,
  detectSource,
} from '../import/index.js';
import { getPreferredWhisperModel, setPreferredWhisperModel } from '../lib/transcriptionService.js';
import { cleanUrl } from '../api.js';
import { ENGINE_PROMPT_VERSION } from '../recipeSchema.js';
import { humanizeImportStatus } from '../importCopy.js';
import db, { queuePhotoUpgrade } from '../db.js';
import useOnlineStatus from '../hooks/useOnlineStatus';
import ImportInput from './ImportInput';
import ImportReview from './ImportReview';
import BrowserAssist from './BrowserAssist';
import SourcePill from './SourcePill.jsx';
import { advanceTimeline, INITIAL_TIMELINE } from '../import/progressMap.js';
import ImportTimeline from './import/ImportTimeline.jsx';

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
 * @param {object}      opts
 * @param {boolean}     opts.userChose  true when fallbackType came from an explicit
 *   user action (Bar tab entry point, or a manual Meal/Drink chip tap) rather than
 *   just being the generic 'meal' default. When true, the user's intent outranks
 *   the parser's kind guess outright instead of only filling a gap the model left
 *   empty (2026-08-08 Phase 1 fix — see bar-library-parity-plan-2026-08-07.md I-1).
 */
export function normalizeRecipeForReview(result, fallbackType = 'meal', { userChose = false } = {}) {
  if (!result) return null;
  const title = (result.title || result.name || '').trim();
  const image = result.image || result.imageUrl || result.capturedImageUrl || '';
  const technique = result.technique || result.method || '';
  const modelGuess =
    result.itemType || result.type || result._type
    || (result.kind === 'drink' ? 'drink' : '')
    || '';
  const itemType = userChose
    ? (fallbackType || 'meal')                          // explicit intent wins outright
    : (modelGuess || fallbackType || 'meal');
  // Surface the disagreement instead of silently overriding it — see I-1/1.2.
  const typeDisagreement =
    (userChose && modelGuess && modelGuess !== (fallbackType || 'meal'))
      ? { userChose: fallbackType || 'meal', modelGuess }
      : null;
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
    _typeDisagreement: typeDisagreement,
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
 *   recovery → captured text shown for manual edit/retry when extraction
 *              captured text but couldn't structure a recipe from it
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
  const [phase, setPhase] = useState('input'); // 'input' | 'loading' | 'review' | 'browserAssist' | 'recovery'
  // E.4: backgrounded — sheet collapses to a floating toast while the import
  // keeps running (component stays mounted, so the in-flight promise survives)
  const [backgrounded, setBackgrounded] = useState(false);
  const [recipe, setRecipe] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [gateVerdict, setGateVerdict] = useState(null);
  const [gateReasons, setGateReasons] = useState([]);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [itemType, setItemType] = useState(initialItemType);
  // Tracks an explicit Meal/Drink chip tap in ImportInput, lifted here so the
  // footer "Smart Import" CTA (which calls execute*Import directly,
  // bypassing ImportInput's own submit handler) can also honour it. Reset
  // whenever the input source changes so a stale override doesn't leak into
  // an unrelated import (1.2, bar-library-parity-plan-2026-08-07.md).
  const [manualTypeOverride, setManualTypeOverride] = useState(false);
  // 2026-08-14: draftKey() used to hand out the literal 'pasted-text' or
  // 'photo-import' for EVERY non-URL session, so all paste-drafts (and
  // separately all photo-drafts) shared one IndexedDB row. A second paste
  // session's autosave silently overwrote a first, unsaved one under the
  // same key with no confirmation, and an abandoned paste/photo draft never
  // got cleaned up if the user instead completed a different import — it
  // just sat there forever since only the single newest draft is ever
  // surfaced for resume. Each paste/photo attempt now gets its own id here
  // (set at the start of execute*Import, restored on resume) so sessions
  // can't collide, paired with the mount-time sweep below that clears
  // anything other than the single resumable draft.
  const [draftSessionId, setDraftSessionId] = useState(null);
  const [browserAssistSeed, setBrowserAssistSeed] = useState(null);
  const [capturedText, setCapturedText] = useState('');
  // Phase 4 (2026-07-20): Whisper model tier — one persisted global choice
  // (see transcriptionService.js), read fresh on mount so a preference set
  // in an earlier session sticks. Applies to both the manual "Transcribe
  // Video" action below and the automatic ASR pass in recipeParser.js.
  const [whisperModel, setWhisperModel] = useState(() => getPreferredWhisperModel());
  const toggleWhisperModel = useCallback(() => {
    const next = whisperModel === 'small' ? 'base' : 'small';
    setWhisperModel(next);
    setPreferredWhisperModel(next);
  }, [whisperModel]);

  // ── Input and review state lifted for single CTA ────────────────────────
  const [url, setUrl] = useState(sharedContent?.url || '');
  const [pasteText, setPasteText] = useState('');
  const [activeTab, setActiveTab] = useState('url');
  // Multi-page scan session — lives here (not in ImportInput) because the
  // original pages are needed again at review time for dish-photo re-cropping.
  const [scanPages, setScanPages] = useState([]);
  // 1.3: initialise from the launching tab instead of always defaulting to
  // 'library' — App.jsx's `target = destination || showImportFor` means a
  // truthy 'library' default permanently shadows showImportFor === 'drinks'
  // (bug I-2, bar-library-parity-plan-2026-08-07.md). Fixing the default here
  // also makes the ImportReview "Save to" grid show the right pre-selection.
  const [destination, setDestination] = useState(initialItemType === 'drink' ? 'bar' : 'library');

  // A new URL (or a fresh source) deserves a fresh auto-detect guess — don't
  // let a manual override on a previous link stick to the next one.
  useEffect(() => {
    setManualTypeOverride(false);
  }, [url, activeTab]);

  // Single source of truth for the IndexedDB draft key. Autosave, save-cleanup
  // and discard all derive the key the same way — so a draft can't be written
  // under one key and orphaned because another site computed a different one.
  // URL imports already have a naturally unique key (the URL itself); paste/
  // photo imports use the per-session draftSessionId set at the start of
  // execute*Import (see that state's comment) — the old fixed literal is only
  // a defensive fallback for the brief window before that id is assigned.
  const draftKey = useCallback(
    () => importUrl || draftSessionId || (activeTab === 'photo' ? 'photo-import' : 'pasted-text'),
    [importUrl, draftSessionId, activeTab],
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

  // ── Quiet Field: recovery phase text ──────────────────────────────────
  const [recoveryText, setRecoveryText] = useState('');

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
      handleImport({ url: sharedContent.url });
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
        // Only the single newest draft is ever offered for resume (above) —
        // sweep the rest. Before draftSessionId existed, every paste/photo
        // draft was written under one of two fixed keys, so an abandoned one
        // just got silently overwritten by the next paste/photo session and
        // never truly orphaned. Now that each paste/photo session gets its
        // own key, an abandoned draft has nothing to overwrite it and would
        // otherwise sit in IndexedDB forever with no UI path to reach it.
        const stale = sorted.slice(1).map(d => d.url).filter(Boolean);
        if (stale.length) db.importDrafts.bulkDelete(stale).catch(() => {});
      }
    }).catch(err => console.warn('[ImportSheet] Failed to load drafts:', err));
  }, []);

  // ── Draft snapshot ───────────────────────────────────────────────────────
  // What a resumable draft carries. Until 2026-09-03 only the `review` phase
  // wrote a draft, so a user who pasted a wall of recipe text and had the tab
  // reaped by iOS before extraction finished lost every word of it. The
  // snapshot now also covers the pre-review phases by storing the source text
  // so a resume can restore the input fields. Photo scans stay review-only on
  // purpose: scanPages carry megabytes of base64 and writing them on a
  // debounce would thrash IndexedDB for a source still in the camera roll.
  const draftSnapshot = useMemo(() => {
    const pasted = activeTab === 'paste' ? pasteText.trim() : '';
    const captured = (capturedText || '').trim();
    if (recipe) {
      return { recipe, confidence, sourceText: pasted, capturedText: captured };
    }
    // No structured recipe yet — only worth resuming if there is real text at
    // risk. A URL is one tap to retype, so bare-URL sessions write nothing.
    if (pasted.length < 40 && captured.length < 40) return null;
    return {
      recipe: null,
      confidence: null,
      sourceText: pasted.length >= 40 ? pasted : '',
      capturedText: captured.length >= 40 ? captured : '',
    };
  }, [recipe, confidence, activeTab, pasteText, capturedText]);

  // Parked in refs so the flush handlers below can stay stable listeners
  // instead of being torn down and re-added on every keystroke.
  const draftSnapshotRef = useRef(null);
  const draftKeyRef = useRef('');
  const lastDraftKeyRef = useRef('');
  // Set while a save is in flight so the pending debounce below cannot
  // resurrect the row a moment after handleSave deletes it.
  const draftRetiredRef = useRef(false);

  useEffect(() => {
    draftSnapshotRef.current = draftSnapshot;
    draftKeyRef.current = draftSnapshot ? draftKey() : '';
  }, [draftSnapshot, draftKey]);

  const writeDraft = useCallback(() => {
    if (draftRetiredRef.current) return;
    const snap = draftSnapshotRef.current;
    const key = draftKeyRef.current;
    if (!snap || !key) return;
    // draftSessionId is assigned at the start of execute*Import, so anything
    // written before that lives under the bare 'pasted-text' fallback key and
    // would be orphaned the moment the real key appears. Retire the previous
    // row as the key moves rather than leaving it for the mount-time sweep.
    const previous = lastDraftKeyRef.current;
    lastDraftKeyRef.current = key;
    if (previous && previous !== key) db.importDrafts?.delete(previous)?.catch(() => {});
    db.importDrafts?.put({ url: key, ...snap, timestamp: Date.now() })
      ?.catch(e => console.warn('[ImportSheet] draft save failed:', e));
  }, []);

  // Debounced, so a keystroke in the paste box is not an IndexedDB write.
  useEffect(() => {
    if (!draftSnapshot) return undefined;
    const id = setTimeout(writeDraft, 400);
    return () => clearTimeout(id);
  }, [draftSnapshot, writeDraft]);

  // pagehide / visibilitychange are the only lifecycle events an iOS PWA is
  // reliably given before the OS reaps the process, and the unmount cleanup
  // never runs in that case — so flush the pending debounce here, or the last
  // few seconds of editing die with the tab.
  useEffect(() => {
    const onHide = () => writeDraft();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') writeDraft();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [writeDraft]);

  // ── Resume / dismiss the offered draft ───────────────────────────────────
  const handleResumeDraft = useCallback(() => {
    if (!draftToResume) return;
    // 2026-08-14: paste/photo drafts are keyed 'pasted-text:<id>' /
    // 'photo-import:<id>' (see draftSessionId) rather than the bare literal,
    // so this has to match by prefix — an exact-equality check would treat
    // the new keyed format as a real URL and try to import it as one.
    const draftUrl = draftToResume.url || '';
    const isPasteDraft = draftUrl === 'pasted-text' || draftUrl.startsWith('pasted-text:');
    const isPhotoDraft = draftUrl === 'photo-import' || draftUrl.startsWith('photo-import:');
    if (draftUrl && !isPasteDraft && !isPhotoDraft) {
      setUrl(draftUrl);
      setImportUrl(draftUrl);
    }
    // Restore the exact draft key so continued edits keep autosaving to this
    // same row instead of spawning a new one under a fresh session id.
    if (isPasteDraft || isPhotoDraft) setDraftSessionId(draftUrl);
    lastDraftKeyRef.current = draftUrl;
    draftRetiredRef.current = false;

    if (draftToResume.capturedText) setCapturedText(draftToResume.capturedText);
    if (draftToResume.recipe) {
      setRecipe(draftToResume.recipe);
      setConfidence(draftToResume.confidence ?? null);
      if (isPasteDraft) setPasteText(draftToResume.sourceText || draftToResume.recipe.notes || '');
      setPhase('review');
    } else {
      // Pre-review draft: hand the text back in an editable field and let the
      // user press import themselves. Auto-firing would spend a network call
      // (and possibly an API credit) on a session they may have abandoned on
      // purpose.
      setPasteText(draftToResume.sourceText || draftToResume.capturedText || '');
      setActiveTab('paste');
      setPhase('input');
    }
    setDraftToResume(null);
  }, [draftToResume]);

  const handleDismissDraft = useCallback(() => {
    if (draftToResume?.url) db.importDrafts?.delete(draftToResume.url)?.catch(e => console.warn(e));
    setDraftToResume(null);
  }, [draftToResume]);

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
    if (phase === 'browserAssist' || phase === 'recovery') {
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
    !backgrounded && (phase === 'loading' || phase === 'review' || phase === 'browserAssist' || phase === 'recovery' || showDiscardConfirm),
    handleSteppedBack,
    showDiscardConfirm ? 'import-discard' : `import-${phase}`,
  );

  // ── Slide-down-to-dismiss: drag release handler ──────────────────────────
  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleCloseRequest();
    }
  }, [handleCloseRequest]);


  // ── Unified import executor ──────────────────────────────────────────────
  // All import paths (URL, paste, photo) funnel through this single function.
  // It builds an ImportRequest, calls engine.importRequest, and handles the
  // result uniformly. Replaces executeUrlImport, executePasteImport,
  // executePhotoImport, and executeTranscribeImport.
  const executeImport = useCallback(async ({ url: rawUrl, text, pages, type, explicitOverride, via }) => {
    // Abort any in-flight import.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveType = type || initialItemType;
    const userChose = explicitOverride || manualTypeOverride || initialItemType === 'drink';

    // Build the ImportRequest for the engine.
    const request = {
      url: rawUrl ? cleanUrl(rawUrl) : undefined,
      text,
      pages,
      kind: effectiveType,
      kindLocked: userChose,
      signal: controller.signal,
      onProgress: (msg) => {
        if (controller.signal.aborted) return;
        setProgressMsg(typeof msg === 'string' ? humanizeImportStatus(msg) : msg);
        if (typeof msg === 'string') setTimeline(t => advanceTimeline(t, msg));
      },
      via: via || 'sheet',
      whisperModel,
    };

    const source = detectSource(request);

    // ── Set initial UI state based on source type ──
    setItemType(effectiveType);
    setPhase('loading');
    setError('');
    setLoadingImage('');

    if (source === 'photo') {
      const count = Array.isArray(pages) ? pages.length : 0;
      setDraftSessionId(`photo-import:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      setProgressMsg(count > 1 ? `Reading ${count} pages…` : 'Reading your photo…');
      setTimeline({ stage: 0, chip: count > 1 ? `${count} pages` : 'Photo scan' });
    } else if (source === 'text') {
      setDraftSessionId(`pasted-text:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      setProgressMsg('Sorting ingredients from instructions…');
      setTimeline({ stage: 2, chip: null });
      setCapturedText(text);
    } else {
      // URL-based source
      const resolvedUrl = request.url || '';
      setImportUrl(resolvedUrl);
      setProgressMsg(via === 'transcribe' ? 'Having a listen to the video…' : 'Getting your recipe…');
      setTimeline(via === 'transcribe' ? { stage: 0, chip: 'Video audio' } : INITIAL_TIMELINE);
    }

    try {
      const { recipe: result, pack, gate: verdict, reasons: gateReasonsResult = [] } = await importRequest(request);
      if (controller.signal.aborted) return;

      if (result && (result.title || result.name || (result.ingredients || []).length)) {
        const normalized = normalizeRecipeForReview(result, effectiveType, { userChose });
        if (controller.signal.aborted) return;
        if (normalized && (normalized.title || normalized.ingredients.length)) {
          setRecipe(normalized);
          setConfidence(computeReviewConfidence(normalized));
          setGateVerdict(verdict || null);
          setGateReasons(gateReasonsResult);
          setProgressMsg('Plated up.');
          setPhase('review');
          return;
        }
      }

      // No recipe — check for caption recovery.
      const caption = pack?.caption || '';
      if (caption.trim()) {
        hapticError();
        setCapturedText(caption);
        setImportUrl(request.url || '');
        setRecoveryText(caption);
        setGateVerdict(verdict || 'empty');
        setGateReasons(gateReasonsResult);
        setPhase('recovery');
      } else {
        hapticError();
        setError(source === 'photo'
          ? "We couldn't read a recipe in that photo. Try a clearer shot."
          : source === 'text'
            ? "That text didn't look like a recipe. Try adding the ingredients or steps."
            : "We couldn't read a recipe from this.");
        setPhase('input');
      }
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'aborted') return;
      console.error('[ImportSheet] Import error:', err);
      hapticError();
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType, whisperModel, manualTypeOverride]);

  // ── Unified import handler (confirm-dialog guard) ────────────────────────
  // All public-facing import triggers go through here. If a review is already
  // showing, the user gets a "replace?" confirmation before re-importing.
  const handleImport = useCallback(async (input) => {
    // Offline guard for URL imports.
    const hasUrl = input.url || (input.text && /https?:\/\//i.test(input.text));
    const hasPages = Array.isArray(input.pages) && input.pages.length > 0;
    if (hasUrl && !hasPages && !navigator.onLine) {
      hapticError();
      setError("You're offline — link imports need a connection. Paste the recipe text and we'll sort it right now.");
      return;
    }

    if (phase === 'review' || lastReviewRef.current) {
      setConfirmImport({
        fn: () => {
          lastReviewRef.current = null;
          setConfirmImport(null);
          executeImport(input);
        },
        message: "This will replace the recipe you're reviewing.",
      });
    } else {
      executeImport(input);
    }
  }, [phase, executeImport]);

  // Legacy compatibility: handlePhotoImport normalizes single data URLs to pages.
  const handlePhotoImport = useCallback(async (pagesOrDataUrl, type) => {
    const pages = typeof pagesOrDataUrl === 'string'
      ? [{ id: `p-${Date.now()}`, dataUrl: pagesOrDataUrl, source: 'share' }]
      : pagesOrDataUrl;
    handleImport({ pages, type });
  }, [handleImport]);

  // ── BrowserAssist recipe callback ────────────────────────────────────────
  const handleBrowserAssistRecipe = useCallback((extractedRecipe) => {
    const normalized = normalizeRecipeForReview(extractedRecipe, itemType, {
      userChose: manualTypeOverride || initialItemType === 'drink',
    });
    if (normalized && (normalized.title || normalized.ingredients.length)) {
      setRecipe(normalized);
      setConfidence(computeReviewConfidence(normalized));
      setPhase('review');
    } else {
      hapticError();
      setError('Browser assist could not extract a recipe.');
      setPhase('input');
    }
  }, [itemType, manualTypeOverride, initialItemType]);

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
    // Offline OCR draft → queue a background vision upgrade with the scanned
    // pages. When connectivity returns, processImportQueue re-runs the online
    // tiers and merges the better extraction into the saved recipe.
    if (out._ocrDraft && scanPages.length > 0) {
      queuePhotoUpgrade(out, scanPages.map(p => p.dataUrl), out.itemType || itemType)
        .then(() => window.dispatchEvent(new Event('spicehub:import-queue-updated')))
        .catch(e => console.warn('[ImportSheet] queuePhotoUpgrade failed:', e));
    }

    hapticSuccess();
    // The draft is retired only once the save is confirmed. handleImport can
    // park the import behind the AgeGate and return { blocked: 'age-gate' }
    // having written nothing — deleting the draft here (as this did until
    // 2026-09-03) meant a gate cancel plus a background kill lost the work
    // for good.
    const key = draftKey();
    // Handed to App so the AgeGate confirm path — which re-enters
    // handleImport directly, long after this sheet has unmounted — can
    // still retire the draft once the save actually lands.
    const retireDraft = () => {
      db.importDrafts?.delete(key)?.catch(e => console.warn(e));
    };
    draftRetiredRef.current = true;
    Promise.resolve(onImport([out], destination, { onCommitted: retireDraft }))
      .then((result) => {
        if (result && result.blocked) {
          // Parked behind the gate: keep autosaving, and let retireDraft
          // above clean up if the user goes through with it.
          draftRetiredRef.current = false;
          return;
        }
        db.importDrafts?.delete(key)?.catch(e => console.warn(e));
      })
      .catch((e) => {
        draftRetiredRef.current = false;
        console.warn('[ImportSheet] save failed, draft kept:', e);
      });
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
    setRecoveryText('');
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
        {(phase === 'input' || phase === 'browserAssist' || phase === 'recovery') && (
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
                    <span className="resume-sub">
                      {draftToResume.recipe
                        ? `We saved your edits for "${draftToResume.recipe.title || 'Untitled Recipe'}"`
                        : 'We saved the text you pasted before the app closed'}
                    </span>
                  </div>
                </div>
                <div className="resume-actions">
                  <button
                    type="button"
                    className="import-sheet-btn import-sheet-btn-secondary"
                    onClick={handleResumeDraft}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="import-sheet-btn import-sheet-btn-ghost"
                    onClick={handleDismissDraft}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Error display is now handled by ImportInput's errorMsg prop —
               the error line appears below the re-expanded field. */}

            {/* Input field ↔ Source pill crossfade */}
            <AnimatePresence mode="wait">
              {phase === 'input' && (
                <motion.div
                  key="input-field"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                >
                  <ImportInput
                    url={url}
                    setUrl={setUrl}
                    pasteText={pasteText}
                    setPasteText={setPasteText}
                    scanPages={scanPages}
                    setScanPages={setScanPages}
                    onImport={(u) => handleImport({ url: u })}
                    disabled={false}
                    errorMsg={error || null}
                  />
                </motion.div>
              )}
              {(phase === 'loading' || phase === 'recovery') && (
                <SourcePill
                  key="source-pill"
                  url={importUrl}
                  isPhoto={scanPages.length > 0 && !importUrl}
                  onEdit={handleReExpand}
                />
              )}
            </AnimatePresence>

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
                  className="import-sheet-loading-area"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  role="status"
                  aria-label="Loading"
                >
                  {/* Image background (State 5 — appears when cover image is available) */}
                  <AnimatePresence>
                    {loadingImage && (
                      <motion.div
                        className="import-sheet-loading-image"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 160 }}
                        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                      >
                        <img
                          src={loadingImage}
                          alt=""
                          className="import-sheet-loading-image-bg"
                        />
                        <div className="import-sheet-loading-image-gradient" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Three-stage import timeline */}
                  <ImportTimeline
                    stage={timeline.stage}
                    chip={timeline.chip}
                    statusMsg={progressMsg || 'Reading the post…'}
                    slow={elapsedTime >= 8}
                  />
                </motion.div>
              )}

              {phase === 'recovery' && (
                <motion.div
                  key="recovery"
                  className="import-sheet-recovery"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {gateReasons.includes('bait-caption') ? (
                    <>
                      <p className="import-sheet-recovery-msg import-sheet-recovery-msg-title">
                        The recipe's on their blog.
                      </p>
                      <p className="import-sheet-recovery-msg">
                        The post just points at "link in bio" — there's nothing here to cook from yet.
                      </p>
                      <input
                        className="import-sheet-recovery-url"
                        type="url"
                        placeholder="Paste the blog URL here"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            handleImport({ url: e.target.value.trim() });
                          }
                        }}
                        ref={(el) => el && setTimeout(() => el.focus(), 100)}
                      />
                      <button
                        type="button"
                        className="import-sheet-recovery-alt"
                        onClick={() => {
                          setPhase('input');
                          setActiveTab('paste');
                          setPasteText(recoveryText);
                        }}
                      >
                        Paste the recipe text instead
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="import-sheet-recovery-msg">
                        We got the post, but couldn't turn it into a recipe.
                        The text is below — edit it and try again.
                      </p>
                      <textarea
                        className="import-sheet-recovery-textarea"
                        value={recoveryText}
                        onChange={(e) => setRecoveryText(e.target.value)}
                        aria-label="Captured recipe text"
                        rows={6}
                      />
                    </>
                  )}

                  <button
                    type="button"
                    className="import-sheet-recovery-retry"
                    onClick={() => {
                      if (recoveryText.trim()) {
                        handleImport({ text: recoveryText });
                      }
                    }}
                    disabled={!recoveryText.trim()}
                  >
                    Use this text
                  </button>
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
                    gate={gateVerdict}
                  />
                </motion.div>
              )}

              {/* BrowserAssist disabled 2026-07-14 (2026-07-13 critique: unexplained
                  "secondary importer" that confused users, and whose own iframe
                  fallback is structurally blocked by CSP frame-src for anything
                  but Instagram/YouTube). The phase === 'browserAssist' transition
                  is no longer triggered anywhere (see handleImport / the removed
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
                    // Explicit discard: stop the autosave debounce before
                    // deleting, so a keystroke from a moment ago cannot
                    // write the row back after this delete lands.
                    draftRetiredRef.current = true;
                    db.importDrafts?.delete(draftKey())?.catch(e => console.warn(e));
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
                      // Route based on content type
                      if (scanPages.length > 0) {
                        handleImport({ pages: scanPages });
                      } else if (url.trim()) {
                        handleImport({ url });
                      } else if (pasteText.trim()) {
                        handleImport({ text: pasteText });
                      }
                    }}
                    aria-disabled={!url.trim() && !pasteText.trim() && scanPages.length === 0}
                  >
                    {error ? 'Try again' : 'Import'}
                  </button>
                )}
                {phase === 'loading' && (
                  <>
                    <button
                      className="import-sheet-btn import-sheet-btn-ghost"
                      onClick={() => {
                        // Cancel: abort but stay on sheet with source visible
                        if (abortRef.current) abortRef.current.abort();
                        setPhase('input');
                        setProgressMsg('');
                        // URL/photo stays in the field — don't clear
                      }}
                    >
                      Cancel import
                    </button>
                    <button
                      className="import-sheet-btn import-sheet-btn-background"
                      onClick={() => setBackgrounded(true)}
                    >
                      Continue in background
                    </button>
                  </>
                )}
                {phase === 'recovery' && (
                  <>
                    <button
                      className="import-sheet-btn import-sheet-btn-ghost"
                      onClick={() => {
                        setPhase('input');
                        setRecoveryText('');
                        setError('');
                        setGateReasons([]);
                      }}
                    >
                      Give up on this one
                    </button>
                    <button
                      className="import-sheet-btn import-sheet-btn-primary"
                      onClick={() => {
                        handleImport({ text: recoveryText });
                      }}
                      disabled={!recoveryText.trim()}
                    >
                      Use this text
                    </button>
                  </>
                )}
                {phase === 'review' && (
                  <>
                    {gateVerdict === 'salvage' && (
                      <button
                        className="import-sheet-btn import-sheet-btn-ghost"
                        onClick={() => setShowDiscardConfirm(true)}
                      >
                        Discard
                      </button>
                    )}
                    <button
                      className="import-sheet-btn import-sheet-btn-primary"
                      onClick={() => { hapticTap(); handleSave(recipe); }}
                    >
                      Save to {destination === 'bar' ? 'Bar Library' : 'Meal Library'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
