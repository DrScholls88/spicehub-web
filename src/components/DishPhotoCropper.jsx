import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X as XIcon } from 'lucide-react';
import { cropRegionFromPage } from '../lib/photoImportEngine.js';
import { hapticLight, hapticSuccess } from '../haptics';

/**
 * DishPhotoCropper — manual crop / re-crop of the recipe card photo from the
 * scanned pages. Full-screen overlay (portal) with a draggable, corner-
 * resizable crop rect, page switcher when the scan had multiple pages, and
 * a "Use full page" shortcut.
 *
 * Crop state is normalized (0–1 of the displayed image) so it maps 1:1 onto
 * the original-resolution page at apply time via cropRegionFromPage.
 *
 * Props:
 *   pages       — [{ id, dataUrl }] original scan pages
 *   initialPage — 0-based page index to open on
 *   initialBox  — vision box [ymin, xmin, ymax, xmax] normalized 0–1000, or null
 *   onApply(dataUrl) — called with the cropped JPEG data URL
 *   onClose()
 */
export default function DishPhotoCropper({ pages, initialPage = 0, initialBox = null, onApply, onClose }) {
  const [pageIdx, setPageIdx] = useState(Math.min(Math.max(initialPage, 0), pages.length - 1));
  const [rect, setRect] = useState(() => boxToRect(initialBox));
  const [applying, setApplying] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 }); // displayed px
  const canvasRef = useRef(null);
  const gestureRef = useRef(null); // { mode, startX, startY, startRect }

  // Reset the crop when switching pages (vision box only applies to its page).
  const switchPage = useCallback((idx) => {
    hapticLight();
    setPageIdx(idx);
    setRect(initialBox && idx === initialPage ? boxToRect(initialBox) : DEFAULT_RECT);
  }, [initialBox, initialPage]);

  const onImgLoad = useCallback((e) => {
    setImgSize({ w: e.target.clientWidth, h: e.target.clientHeight });
  }, []);

  // Keep displayed size current on viewport changes.
  useEffect(() => {
    const el = canvasRef.current?.querySelector('img');
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setImgSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageIdx]);

  // ── Pointer gestures: move the rect, or resize from a corner ─────────────
  const beginGesture = useCallback((mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gestureRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: { ...rect } };
  }, [rect]);

  const onPointerMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g || !imgSize.w || !imgSize.h) return;
    const dx = (e.clientX - g.startX) / imgSize.w;
    const dy = (e.clientY - g.startY) / imgSize.h;
    const r = { ...g.startRect };

    if (g.mode === 'move') {
      r.x = clamp(g.startRect.x + dx, 0, 1 - r.w);
      r.y = clamp(g.startRect.y + dy, 0, 1 - r.h);
    } else {
      // Corner resize — anchor is the opposite corner.
      let x1 = g.startRect.x;
      let y1 = g.startRect.y;
      let x2 = g.startRect.x + g.startRect.w;
      let y2 = g.startRect.y + g.startRect.h;
      if (g.mode.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN_SIZE);
      if (g.mode.includes('e')) x2 = clamp(x2 + dx, x1 + MIN_SIZE, 1);
      if (g.mode.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN_SIZE);
      if (g.mode.includes('s')) y2 = clamp(y2 + dy, y1 + MIN_SIZE, 1);
      r.x = x1; r.y = y1; r.w = x2 - x1; r.h = y2 - y1;
    }
    setRect(r);
  }, [imgSize]);

  const endGesture = useCallback(() => {
    gestureRef.current = null;
  }, []);

  const handleUseFullPage = useCallback(() => {
    hapticLight();
    setRect({ x: 0, y: 0, w: 1, h: 1 });
  }, []);

  const handleApply = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    try {
      const dataUrl = await cropRegionFromPage(pages[pageIdx].dataUrl, rect);
      if (dataUrl) {
        hapticSuccess();
        onApply(dataUrl);
      } else {
        onClose();
      }
    } finally {
      setApplying(false);
    }
  }, [applying, pages, pageIdx, rect, onApply, onClose]);

  // Escape closes the cropper (capture phase so the sheet's handler doesn't fire).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const px = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };

  return createPortal(
    <motion.div
      className="dish-crop-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Adjust recipe photo"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="dish-crop-header">
        <h3>Adjust photo</h3>
        <button type="button" className="dish-crop-close" onClick={onClose} aria-label="Close">
          <XIcon size={20} strokeWidth={2} />
        </button>
      </div>

      <div className="dish-crop-stage" onPointerMove={onPointerMove} onPointerUp={endGesture} onPointerCancel={endGesture}>
        <div className="dish-crop-canvas" ref={canvasRef}>
          <img src={pages[pageIdx]?.dataUrl} alt={`Scan page ${pageIdx + 1}`} onLoad={onImgLoad} draggable={false} />

          {/* Dimmed shade around the crop (4 panels — cheap, no clip-path repaints) */}
          <div className="dish-crop-shade" style={{ left: 0, top: 0, right: 0, height: px.top }} />
          <div className="dish-crop-shade" style={{ left: 0, top: `calc(${px.top} + ${px.height})`, right: 0, bottom: 0 }} />
          <div className="dish-crop-shade" style={{ left: 0, top: px.top, width: px.left, height: px.height }} />
          <div className="dish-crop-shade" style={{ left: `calc(${px.left} + ${px.width})`, top: px.top, right: 0, height: px.height }} />

          {/* The crop rect itself */}
          <div className="dish-crop-rect" style={px} onPointerDown={beginGesture('move')}>
            <button type="button" className="dish-crop-handle dish-crop-handle-nw" onPointerDown={beginGesture('nw')} aria-label="Resize top left" />
            <button type="button" className="dish-crop-handle dish-crop-handle-ne" onPointerDown={beginGesture('ne')} aria-label="Resize top right" />
            <button type="button" className="dish-crop-handle dish-crop-handle-sw" onPointerDown={beginGesture('sw')} aria-label="Resize bottom left" />
            <button type="button" className="dish-crop-handle dish-crop-handle-se" onPointerDown={beginGesture('se')} aria-label="Resize bottom right" />
          </div>
        </div>
      </div>

      {/* Page switcher — only when the scan had multiple pages */}
      {pages.length > 1 && (
        <div className="dish-crop-pages" role="tablist" aria-label="Scan pages">
          {pages.map((p, i) => (
            <button
              key={p.id || i}
              type="button"
              role="tab"
              aria-selected={i === pageIdx}
              className={`dish-crop-page-thumb${i === pageIdx ? ' active' : ''}`}
              onClick={() => switchPage(i)}
            >
              <img src={p.dataUrl} alt={`Page ${i + 1}`} />
            </button>
          ))}
        </div>
      )}

      <div className="dish-crop-footer">
        <button type="button" className="dish-crop-btn dish-crop-btn-ghost" onClick={handleUseFullPage}>
          Use full page
        </button>
        <button type="button" className="dish-crop-btn dish-crop-btn-primary" onClick={handleApply} disabled={applying}>
          {applying ? 'Cropping…' : 'Use this crop'}
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_RECT = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
const MIN_SIZE = 0.08; // crop can't shrink below 8% of the page edge

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Vision box [ymin, xmin, ymax, xmax] (0–1000) → normalized rect (0–1). */
function boxToRect(box) {
  if (!Array.isArray(box) || box.length !== 4) return DEFAULT_RECT;
  const [ymin, xmin, ymax, xmax] = box.map(Number);
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite) || !(ymin < ymax && xmin < xmax)) {
    return DEFAULT_RECT;
  }
  return {
    x: clamp(xmin / 1000, 0, 1),
    y: clamp(ymin / 1000, 0, 1),
    w: clamp((xmax - xmin) / 1000, MIN_SIZE, 1),
    h: clamp((ymax - ymin) / 1000, MIN_SIZE, 1),
  };
}
