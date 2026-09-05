import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X as XIcon, Check, Contrast, RotateCcw, Maximize2 } from 'lucide-react';
import useBackHandler from '../hooks/useBackHandler';
import { hapticLight, hapticSuccess, hapticError } from '../haptics';
import {
  downscaleForDetect,
  detectDocumentQuad,
  warpPerspective,
  enhanceDocument,
  canvasToJpegDataUrl,
} from '../lib/documentDetect.js';
import './PageAligner.css';

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const DEFAULT_INSET = 0.08; // fallback guess when auto-detect can't find an edge

function insetCorners() {
  const i = DEFAULT_INSET;
  return [
    { x: i, y: i },
    { x: 1 - i, y: i },
    { x: 1 - i, y: 1 - i },
    { x: i, y: 1 - i },
  ];
}

function fullCorners() {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * PageAligner — static-image "Genius Scan"-style crop/flatten step.
 *
 * Runs once after a photo is captured (system camera) or picked (gallery
 * upload) — this is the alignment tool, decoupled from any live camera
 * feed so it works no matter how the photo was taken. Auto-detects the
 * page quad once on load, lets the person drag the four corners to fix
 * the framing, then warps + auto-levels on confirm. Outputs the same
 * flattened-JPEG data URL shape the rest of the import pipeline expects.
 *
 * Props:
 *   imageSrc   — source photo as a data:/blob: URL
 *   pageCount  — pages already saved (shown in the header chip)
 *   onConfirm(dataUrl) — flattened JPEG
 *   onCancel() — skip this photo, don't add a page
 */
export default function PageAligner({ imageSrc, pageCount = 0, onConfirm, onCancel }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null); // full-res source canvas
  const dragRef = useRef(null); // index of the corner being dragged, or null

  const [corners, setCorners] = useState(null);
  const [enhanceMode, setEnhanceMode] = useState('auto'); // auto | bw | off
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useBackHandler(true, onCancel, 'page-aligner');

  // Load the photo, build a full-res source canvas, run one-shot detection
  // for an initial guess at the page edges.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (!img.naturalWidth || !img.naturalHeight) {
        setError("Couldn't read that photo. Try again.");
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvasRef.current = canvas;

      let initial = null;
      try {
        const small = downscaleForDetect(canvas);
        const hit = small ? detectDocumentQuad(small) : null;
        if (hit?.corners) initial = hit.corners;
      } catch {
        initial = null;
      }
      setCorners(initial || insetCorners());
    };
    img.onerror = () => {
      if (!cancelled) setError("Couldn't load that photo. Try again.");
    };
    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc]);

  const cornerAt = useCallback((clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const onHandlePointerDown = useCallback((index) => (e) => {
    e.preventDefault();
    dragRef.current = index;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onFramePointerMove = useCallback((e) => {
    if (dragRef.current === null) return;
    const idx = dragRef.current;
    const point = cornerAt(e.clientX, e.clientY);
    setCorners((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[idx] = point;
      return next;
    });
  }, [cornerAt]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const resetCorners = useCallback(() => {
    hapticLight();
    setCorners(insetCorners());
  }, []);

  const useFullPhoto = useCallback(() => {
    hapticLight();
    setCorners(fullCorners());
  }, []);

  const handleConfirm = useCallback(() => {
    if (!canvasRef.current || !corners || busy) return;
    hapticLight();
    setBusy(true);
    try {
      let out = warpPerspective(canvasRef.current, corners, { maxEdge: 1600 });
      out = enhanceDocument(out, enhanceMode);
      const dataUrl = canvasToJpegDataUrl(out, 0.88);
      hapticSuccess();
      onConfirm?.(dataUrl);
    } catch {
      hapticError();
      setError("Couldn't flatten that page. Try Reset or Full photo, then try again.");
      setBusy(false);
    }
  }, [corners, enhanceMode, busy, onConfirm]);

  const statusText = error
    ? 'Could not load photo'
    : !corners
      ? 'Loading photo…'
      : busy
        ? 'Flattening…'
        : 'Drag the corners to fit the page';

  return createPortal(
    <motion.div
      className="pgalign-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Adjust page edges"
    >
      <header className="pgalign-top">
        <button type="button" className="pgalign-icon-btn" onClick={onCancel} aria-label="Cancel — don't add this page">
          <XIcon size={22} strokeWidth={2.2} />
        </button>
        <div className="pgalign-status">{statusText}</div>
        <span className="pgalign-count">{pageCount} saved</span>
      </header>

      <div className="pgalign-stage">
        {corners && (
          <div
            ref={wrapRef}
            className="pgalign-frame"
            onPointerMove={onFramePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img src={imageSrc} alt="Captured page" className="pgalign-img" draggable="false" />
            <svg className="pgalign-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon
                className="pgalign-poly"
                points={corners.map((c) => `${(c.x * 100).toFixed(2)},${(c.y * 100).toFixed(2)}`).join(' ')}
              />
            </svg>
            {corners.map((c, i) => (
              <div
                key={CORNER_NAMES[i]}
                className="pgalign-handle"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                onPointerDown={onHandlePointerDown(i)}
                role="slider"
                aria-label={`${CORNER_NAMES[i]} corner`}
                aria-valuenow={0}
                tabIndex={0}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="pgalign-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <footer className="pgalign-bottom">
        <div className="pgalign-chips">
          <button type="button" className="pgalign-chip" onClick={resetCorners} disabled={!corners}>
            <RotateCcw size={16} strokeWidth={2.2} />
            Reset
          </button>
          <button type="button" className="pgalign-chip" onClick={useFullPhoto} disabled={!corners}>
            <Maximize2 size={16} strokeWidth={2.2} />
            Full photo
          </button>
          <button
            type="button"
            className={`pgalign-chip ${enhanceMode !== 'off' ? 'is-on' : ''}`}
            onClick={() => {
              hapticLight();
              setEnhanceMode((m) => (m === 'auto' ? 'bw' : m === 'bw' ? 'off' : 'auto'));
            }}
          >
            <Contrast size={16} strokeWidth={2.2} />
            {enhanceMode === 'bw' ? 'B&W' : enhanceMode === 'off' ? 'Raw' : 'Enhance'}
          </button>
        </div>
        <button
          type="button"
          className="pgalign-confirm"
          onClick={handleConfirm}
          disabled={!corners || busy}
        >
          <Check size={18} strokeWidth={2.4} />
          {busy ? 'Flattening…' : 'Use this page'}
        </button>
      </footer>
    </motion.div>,
    document.body,
  );
}
