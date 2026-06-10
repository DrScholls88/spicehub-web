import { useState, useRef, useCallback, useEffect } from 'react';
import './ImportSheet.css';
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
}) {
  // ── Phase state machine ──────────────────────────────────────────────────
  const [phase, setPhase] = useState('input'); // 'input' | 'loading' | 'review' | 'browserAssist'
  const [recipe, setRecipe] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [error, setError] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [itemType, setItemType] = useState(initialItemType);
  const [browserAssistSeed, setBrowserAssistSeed] = useState(null);
  const [capturedText, setCapturedText] = useState('');

  const abortRef = useRef(null);
  const browserAssistRef = useRef(null);

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

  // ── URL Import ───────────────────────────────────────────────────────────
  const handleUrlImport = useCallback(async (rawUrl, type) => {
    const url = cleanUrl(rawUrl);
    if (!url) return;

    // Abort previous attempt
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setImportUrl(url);
    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setProgressMsg('Getting your recipe…');

    try {
      const result = await importRecipeFromUrl(
        url,
        (msg) => setProgressMsg(humanizeImportStatus(msg)),
        { type: type || initialItemType, signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      // Engine asks for browser-assist fallback
      if (result && result._needsBrowserAssist) {
        setBrowserAssistSeed(result.seed || null);
        setCapturedText(result.capturedCaption || '');
        setImportUrl(url);
        setPhase('browserAssist');
        return;
      }

      // Success — move to review
      if (result && (result.title || (result.ingredients && result.ingredients.length))) {
        const conf = scoreExtractionConfidence(result);
        setRecipe(result);
        setConfidence(conf);
        setPhase('review');
      } else {
        setError('Could not extract a recipe from this URL.');
        setPhase('input');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[ImportSheet] URL import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  // ── Paste Text Import ────────────────────────────────────────────────────
  const handlePasteImport = useCallback(async (text, type) => {
    if (!text || !text.trim()) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;

    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setProgressMsg('Sorting ingredients from instructions…');

    try {
      const result = await captionToRecipe(text, { type: type || initialItemType });
      if (result && (result.title || (result.ingredients && result.ingredients.length))) {
        const conf = scoreExtractionConfidence(result);
        setRecipe(result);
        setConfidence(conf);
        setPhase('review');
      } else {
        setError('Could not parse a recipe from the pasted text.');
        setPhase('input');
      }
    } catch (err) {
      console.error('[ImportSheet] Paste import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  // ── Photo Import ─────────────────────────────────────────────────────────
  const handlePhotoImport = useCallback(async (imageDataUrl, type) => {
    if (!imageDataUrl) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;

    setItemType(type || initialItemType);
    setPhase('loading');
    setError('');
    setProgressMsg('Reading your photo…');

    try {
      const result = await structureRecipeFromImage(imageDataUrl, { type: type || initialItemType });
      if (result && (result.title || (result.ingredients && result.ingredients.length))) {
        const conf = scoreExtractionConfidence(result);
        setRecipe(result);
        setConfidence(conf);
        setPhase('review');
      } else {
        setError('Could not extract a recipe from this image.');
        setPhase('input');
      }
    } catch (err) {
      console.error('[ImportSheet] Photo import error:', err);
      setError(err.message || 'Import failed.');
      setPhase('input');
    }
  }, [initialItemType]);

  // ── BrowserAssist recipe callback ────────────────────────────────────────
  const handleBrowserAssistRecipe = useCallback((extractedRecipe) => {
    if (extractedRecipe && (extractedRecipe.title || (extractedRecipe.ingredients && extractedRecipe.ingredients.length))) {
      const conf = scoreExtractionConfidence(extractedRecipe);
      setRecipe(extractedRecipe);
      setConfidence(conf);
      setPhase('review');
    } else {
      setError('Browser assist could not extract a recipe.');
      setPhase('input');
    }
  }, []);

  const handleBrowserAssistFallback = useCallback((fallbackText) => {
    setCapturedText(fallbackText || '');
    setPhase('input');
  }, []);

  // ── Save from review ─────────────────────────────────────────────────────
  const handleSave = useCallback((finalRecipe) => {
    if (!finalRecipe) return;
    onImport([finalRecipe]);
  }, [onImport]);

  // ── Re-expand input from collapsed state ─────────────────────────────────
  const handleReExpand = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setPhase('input');
    setError('');
    setProgressMsg('');
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="import-sheet-overlay">
      <div className="import-sheet">
        {/* Grab handle */}
        <div className="import-sheet-grab" />

        {/* Header */}
        <div className="import-sheet-header">
          <h2>{title}</h2>
          <button
            className="import-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="import-sheet-body">
          {/* Error banner */}
          {error && (
            <div className="import-sheet-error">
              <p>{error}</p>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {/* ImportInput — full or collapsed */}
          <ImportInput
            collapsed={phase !== 'input'}
            onImport={handleUrlImport}
            onPasteImport={handlePasteImport}
            onPhotoImport={handlePhotoImport}
            onReExpand={handleReExpand}
            initialUrl={sharedContent?.url || ''}
            initialType={initialItemType}
            title={title}
          />

          {/* Loading phase */}
          {phase === 'loading' && (
            <div className="import-sheet-loading">
              <div className="import-sheet-progress-bar">
                <div className="import-sheet-progress-fill" />
              </div>
              <p className="import-sheet-progress-text">
                {progressMsg}
              </p>
            </div>
          )}

          {/* Review phase */}
          {phase === 'review' && recipe && (
            <ImportReview
              recipe={recipe}
              onChange={setRecipe}
              onSave={handleSave}
              confidence={confidence}
            />
          )}

          {/* BrowserAssist inline phase */}
          {phase === 'browserAssist' && (
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
                setError('Visual extraction failed. Try pasting the recipe text.');
                setPhase('input');
              }}
            />
          )}
        </div>

        {/* Sticky footer */}
        <div className="import-sheet-footer">
          {phase === 'input' && (
            <button
              className="import-sheet-btn import-sheet-btn-primary"
              onClick={() => {}}
              disabled
            >
              Import recipe
            </button>
          )}
          {phase === 'loading' && (
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
          )}
          {phase === 'review' && (
            <button
              className="import-sheet-btn import-sheet-btn-primary"
              onClick={() => handleSave(recipe)}
            >
              Save to library
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
