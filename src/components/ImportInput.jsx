import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, X, Check, Loader2 } from 'lucide-react';
import { getDetectionLabel } from './SourcePill';
import { isPdfFile, pdfToPageDataUrls } from '../lib/pdfPages.js';
import { MAX_PAGES } from '../lib/photoImportEngine.js';
import { hapticLight, hapticError } from '../haptics';
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
 * One unified field that accepts URLs, text, photos, screenshots, or PDFs.
 * Auto-detects input type. Two icon actions cover photo intake: Upload
 * (primary — file/gallery picker, accepts images and PDFs, the common
 * path for screenshots and cookbook scans) and Camera (secondary — the
 * least-used of the two, kept for in-the-moment snaps of a physical
 * recipe card). DetectionChip shows platform recognition. Photo thumbnail
 * replaces field content once a page has been added.
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
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pdfBusy, setPdfBusy] = useState('');
  const [notice, setNotice] = useState('');
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
  const isPdfBatch = hasPhoto && scanPages.every((p) => p.source === 'pdf');

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

  // ── File / photo / PDF handling ───────────────────────────────────────
  // Accepts a FileList/array of images and/or PDFs from the Upload button,
  // the Camera button, a paste, or a drop. PDFs are rendered to page images
  // client-side (same pdfToPageDataUrls pipeline PhotoScanSession uses);
  // everything lands in the same scanPages shape the photo-import engine
  // reads ({ id, dataUrl, source }). Caps the running total at MAX_PAGES
  // so one big PDF (or a big multi-select) can't blow past what the vision
  // pipeline is tuned for.
  const ingestFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setNotice('');

    const room = () => MAX_PAGES - (scanPages?.length || 0) - collected.length;
    const collected = [];
    let truncated = false;

    for (const file of files) {
      if (room() <= 0) { truncated = true; break; }
      if (isPdfFile(file)) {
        try {
          setPdfBusy(`Reading ${file.name}…`);
          const { pages: pdfPages, truncated: pdfTruncated } = await pdfToPageDataUrls(file, {
            maxPages: Math.max(1, room()),
            onProgress: (n, total) => setPdfBusy(`Rendering page ${n} of ${total}…`),
          });
          pdfPages.forEach((dataUrl) => {
            collected.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, source: 'pdf' });
          });
          if (pdfTruncated) truncated = true;
        } catch (err) {
          hapticError();
          setNotice(err.message || "Couldn't read that PDF.");
        } finally {
          setPdfBusy('');
        }
      } else if (/^image\//.test(file.type)) {
        collected.push({
          file,
          dataUrl: URL.createObjectURL(file),
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: 'gallery',
        });
      }
    }

    if (!collected.length) return;
    if (truncated) setNotice(`Only ${MAX_PAGES} pages per import — kept the first ${MAX_PAGES}.`);
    setScanPages((prev) => [...prev, ...collected]);
    // Clear URL/text when photos are added
    setUrl('');
    setPasteText('');
  }, [scanPages, setScanPages, setUrl, setPasteText]);

  const handlePaste = useCallback((e) => {
    // Check clipboard for files first (smart paste)
    const items = e.clipboardData?.items;
    if (items) {
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const f = items[i].getAsFile();
          if (f && (/^image\//.test(f.type) || isPdfFile(f))) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        ingestFiles(files);
        return;
      }
    }
    // Text paste — let the onChange handler route it
  }, [ingestFiles]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && hasUrl && onImport) {
      e.preventDefault();
      markUsed();
      onImport(url);
    }
  }, [hasUrl, url, onImport, markUsed]);

  const handleUploadClick = useCallback(() => {
    hapticLight();
    uploadInputRef.current?.click();
  }, []);

  const handleCameraClick = useCallback(() => {
    hapticLight();
    cameraInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    if (e.target.files?.length) {
      ingestFiles(e.target.files);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [ingestFiles]);

  // ── Clear ─────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    // Revoke blob URLs to prevent memory leaks (no-op for PDF data: URLs)
    scanPages.forEach(p => { try { URL.revokeObjectURL(p.dataUrl); } catch (_) {} });
    setUrl('');
    setPasteText('');
    setScanPages([]);
    setNotice('');
    setPdfBusy('');
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
      const usable = files.filter(f => /^image\//.test(f.type) || isPdfFile(f));
      if (usable.length > 0) {
        ingestFiles(usable);
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
  }, [ingestFiles, setUrl, setPasteText]);

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
  const photoLabel = hasPhoto
    ? (isPdfBatch
        ? `PDF · ${scanPages.length} page${scanPages.length === 1 ? '' : 's'}`
        : (scanPages.length === 1 ? 'Recipe photo' : `${scanPages.length} photos`))
    : '';

  return (
    <div
      className={`import-input-field-wrap${dragOver ? ' dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input — Upload button: gallery/files, images + PDFs */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* Hidden file input — Camera button: one live snap */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* The field */}
      <div className={`import-input-field${focused ? ' focused' : ''}${hasContent ? ' has-content' : ''}`}>
        {hasPhoto ? (
          /* ── Photo/PDF thumbnail display (State 3) ───────────────────── */
          <div className="import-input-photo-thumb">
            <img
              src={scanPages[0]?.dataUrl}
              alt="Selected recipe photo"
              className="import-input-photo-img"
            />
            <span className="import-input-photo-label">{photoLabel}</span>
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

        {/* Divider + action icon(s) */}
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
          <div className="import-input-actions">
            <button
              className="import-input-field-action upload"
              onClick={handleUploadClick}
              aria-label="Upload a photo, screenshot, or PDF"
              title="Upload photo or PDF"
              type="button"
            >
              <Upload size={20} strokeWidth={1.8} />
            </button>
            <button
              className="import-input-field-action camera"
              onClick={handleCameraClick}
              aria-label="Take a photo"
              title="Take photo"
              type="button"
            >
              <Camera size={20} strokeWidth={1.8} />
            </button>
          </div>
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

      {/* PDF render progress */}
      <AnimatePresence>
        {pdfBusy && (
          <motion.p
            className="import-input-notice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
            <span>{pdfBusy}</span>
          </motion.p>
        )}
        {notice && !pdfBusy && (
          <motion.p
            className="import-input-notice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            <span>{notice}</span>
          </motion.p>
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
        <p className="import-input-hint">or drop a photo, screenshot, or PDF of a recipe</p>
      )}
    </div>
  );
}
