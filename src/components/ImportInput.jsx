import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, Check } from 'lucide-react';
import { getDetectionLabel, detectPlatform } from './SourcePill';
// PhotoScanSession: multi-page scan UI retained for future re-integration

/* ── Constants ──────────────────────────────────────────────────────────── */
const FIRST_VISIT_KEY = 'spicehub_hasUsedImport';

/* ── Helpers ────────────────────────────────────────────────────────────── */
function looksLikeUrl(s) {
  return /^\s*https?:\/\/\S+/i.test(s || '');
}

/**
 * ImportInput — Quiet Field design.
 *
 * One unified field that accepts URLs, text, or photos. Auto-detects
 * input type. Camera icon triggers photo capture. DetectionChip shows
 * platform recognition. Photo thumbnail replaces field content when
 * a photo is selected.
 */
export default function ImportInput({
  url,
  setUrl,
  pasteText,
  setPasteText,
  scanPages,
  setScanPages,
  onImport,        // Called on Enter key with URL (footer handles main CTA)
  disabled,        // True during loading — field is hidden, SourcePill shows instead
  errorMsg,        // Error string for total-miss error line
}) {
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(() => {
    try { return !localStorage.getItem(FIRST_VISIT_KEY); } catch { return false; }
  });

  // Mark first visit complete on first import
  const markUsed = useCallback(() => {
    try {
      localStorage.setItem(FIRST_VISIT_KEY, '1');
      setIsFirstVisit(false);
    } catch { /* localStorage unavailable — fine */ }
  }, []);

  // ── Content state ─────────────────────────────────────────────────────
  const hasUrl = url && url.trim().length > 0;
  const hasText = pasteText && pasteText.trim().length > 0;
  const hasPhoto = scanPages && scanPages.length > 0;
  const hasContent = hasUrl || hasText || hasPhoto;

  // ── Detection ─────────────────────────────────────────────────────────
  const detectionLabel = useMemo(() => {
    if (hasPhoto) return 'Photo ready';
    if (hasUrl) return getDetectionLabel(url);
    return null;
  }, [hasUrl, hasPhoto, url]);

  // ── Input handling ────────────────────────────────────────────────────
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    if (looksLikeUrl(val)) {
      setUrl(val.trim());
      setPasteText('');
    } else {
      setPasteText(val);
      setUrl('');
    }
  }, [setUrl, setPasteText]);

  const handlePaste = useCallback((e) => {
    // Check clipboard for files first (smart paste)
    const items = e.clipboardData?.items;
    if (items) {
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const f = items[i].getAsFile();
          if (f && /^image\//.test(f.type)) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        ingestMediaFiles(files);
        return;
      }
    }
    // Text paste — let the onChange handler route it
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && hasUrl && onImport) {
      e.preventDefault();
      markUsed();
      onImport(url);
    }
  }, [hasUrl, url, onImport, markUsed]);

  // ── File / photo handling ─────────────────────────────────────────────
  const ingestMediaFiles = useCallback((files) => {
    const imageFiles = Array.from(files).filter(f => /^image\//.test(f.type));
    if (imageFiles.length === 0) return;

    const newPages = imageFiles.map((file) => ({
      file,
      dataUrl: URL.createObjectURL(file),
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setScanPages((prev) => [...prev, ...newPages]);
    // Clear URL/text when photos are added
    setUrl('');
    setPasteText('');
  }, [setScanPages, setUrl, setPasteText]);

  const handleCameraClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    if (e.target.files?.length) {
      ingestMediaFiles(e.target.files);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [ingestMediaFiles]);

  // ── Clear ─────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    // Revoke blob URLs to prevent memory leaks
    scanPages.forEach(p => { try { URL.revokeObjectURL(p.dataUrl); } catch (_) {} });
    setUrl('');
    setPasteText('');
    setScanPages([]);
    inputRef.current?.focus();
  }, [setUrl, setPasteText, setScanPages, scanPages]);

  // ── Drop zone ─────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter(f => /^image\//.test(f.type));
      if (imageFiles.length > 0) {
        ingestMediaFiles(imageFiles);
        return;
      }
    }
    // Text drop
    const text = e.dataTransfer?.getData('text/plain');
    if (text) {
      if (looksLikeUrl(text)) {
        setUrl(text.trim());
        setPasteText('');
      } else {
        setPasteText(text);
        setUrl('');
      }
    }
  }, [ingestMediaFiles, setUrl, setPasteText]);

  // ── Focus field on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!disabled && !hasPhoto) {
      // Small delay to let the sheet animation finish
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [disabled, hasPhoto]);

  // ── Don't render when disabled (loading phase — SourcePill shows) ────
  if (disabled) return null;

  // ── Render ────────────────────────────────────────────────────────────
  const fieldValue = hasUrl ? url : (hasText ? pasteText : '');
  const showFirstVisitHint = isFirstVisit && !hasContent;

  return (
    <div
      className={`import-input-field-wrap${dragOver ? ' dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for camera/gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* The field */}
      <div className={`import-input-field${focused ? ' focused' : ''}${hasContent ? ' has-content' : ''}`}>
        {hasPhoto ? (
          /* ── Photo thumbnail display (State 3) ───────────────────── */
          <div className="import-input-photo-thumb">
            <img
              src={scanPages[0]?.dataUrl}
              alt="Selected recipe photo"
              className="import-input-photo-img"
            />
            <span className="import-input-photo-label">
              {scanPages.length === 1 ? 'Recipe photo' : `${scanPages.length} photos`}
            </span>
          </div>
        ) : (
          /* ── Text/URL input ──────────────────────────────────────── */
          <input
            ref={inputRef}
            type="text"
            className="import-input-text"
            value={fieldValue}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Paste a link or recipe text…"
            aria-label="Paste a recipe URL or text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        )}

        {/* Divider + action icon */}
        <div className="import-input-field-divider" />

        {hasContent ? (
          <button
            className="import-input-field-action"
            onClick={handleClear}
            aria-label={hasPhoto ? 'Remove photo' : 'Clear URL'}
            type="button"
          >
            <X size={20} strokeWidth={2} />
          </button>
        ) : (
          <button
            className="import-input-field-action camera"
            onClick={handleCameraClick}
            aria-label="Take or choose a photo"
            type="button"
          >
            <Camera size={20} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Detection chip */}
      <AnimatePresence>
        {detectionLabel && (
          <motion.div
            className="detection-chip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <Check size={14} strokeWidth={2.5} />
            <span>{detectionLabel}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error line (State 7 — total miss) */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            className="import-input-error-line"
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{errorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* First-visit hint */}
      {showFirstVisitHint && (
        <p className="import-input-hint">or drop a photo of a recipe card</p>
      )}
    </div>
  );
}
