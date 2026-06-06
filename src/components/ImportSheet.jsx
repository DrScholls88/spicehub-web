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
    setProgressMsg('Starting import...');

    try {
      const result = await importRecipeFromUrl(
        url,
        (msg) => setProgressMsg(msg),
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
    setProgressMsg('Structuring pasted text with AI...');

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
    setProgressMsg('Analyzing photo...');

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
    <div className="import-sheet-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      <div className="import-sheet" style={{
        background: 'var(--card-bg, #fff)',
        borderRadius: '20px 20px 0 0',
        maxHeight: '92vh',
        overflowY: 'auto',
        padding: '16px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', fontSize: '1.5rem',
              cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#fee', color: '#c33', padding: '10px 14px',
            borderRadius: 10, fontSize: '0.9rem',
          }}>
            {error}
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
          <div style={{
            textAlign: 'center', padding: '32px 16px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
          }}>
            <div className="import-spinner" style={{
              width: 40, height: 40,
              border: '3px solid var(--border-color, #ddd)',
              borderTopColor: 'var(--accent, #e67e22)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{ margin: 0, color: 'var(--text-muted, #888)', fontSize: '0.95rem' }}>
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

        {/* Sticky footer close button */}
        <div style={{
          borderTop: '1px solid var(--border-color, #eee)',
          paddingTop: '12px',
          display: 'flex', justifyContent: 'center',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--border-color, #ccc)',
              borderRadius: 10, padding: '10px 32px',
              fontSize: '1rem', cursor: 'pointer',
              color: 'var(--text-color, #333)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Spin keyframe for loading spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
