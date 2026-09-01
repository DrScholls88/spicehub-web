import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X as XIcon, Zap, ZapOff, Contrast, Check } from 'lucide-react';
import useBackHandler from '../hooks/useBackHandler';
import { hapticLight, hapticSuccess, hapticError } from '../haptics';
import {
  drawVideoFrame,
  downscaleForDetect,
  detectDocumentQuad,
  lerpCorners,
  cornersMoved,
  warpPerspective,
  enhanceDocument,
  canvasToJpegDataUrl,
} from '../lib/documentDetect.js';
import './DocumentScanner.css';

const STABLE_FRAMES = 6;
const STABLE_MOVE = 0.018;
const AUTO_MIN_SCORE = 0.52;
const ANALYZE_EVERY_MS = 90;

/**
 * DocumentScanner — Genius-Scan-lite live capture.
 *
 * Live rear camera, auto-centering quad overlay, optional auto-snap when
 * the page holds still, perspective flatten + auto-levels on capture.
 * Stays open after each page so a cookbook can be flipped through.
 *
 * Teaching moment for the Photo tab: line it up (overlay locks green) →
 * we flatten it (perspective warp on capture) → then we read it (same
 * importRecipeFromPages pipeline as every other photo page).
 *
 * Props:
 *   remaining          — pages still allowed in this session
 *   pageCount          — pages already captured
 *   onCapture(dataUrl) — flattened JPEG
 *   onClose()
 *   onUseSystemCamera() — optional; offered as a fallback action when the
 *     live camera can't open (permission denied / unsupported browser) so
 *     the page/PDF picker path already wired by the caller stays reachable
 */
export default function DocumentScanner({
  remaining = 10,
  pageCount = 0,
  onCapture,
  onClose,
  onUseSystemCamera,
}) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const cornersRef = useRef(null);
  const stableRef = useRef(0);
  const lastSnapRef = useRef(0);
  const rafRef = useRef(0);
  const lastAnalyzeRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [corners, setCorners] = useState(null);
  const [score, setScore] = useState(0);
  const [autoSnap, setAutoSnap] = useState(true);
  const [enhanceMode, setEnhanceMode] = useState('auto'); // auto | bw | off
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useBackHandler(true, onClose, 'document-scanner');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not available in this browser. Use Choose Files instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play();
        setReady(true);
      } catch (err) {
        const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
        setError(denied
          ? 'Camera permission denied. Allow camera, or use Choose Files instead.'
          : 'Could not open the camera. Use Choose Files instead.');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const captureNow = useCallback(async (usedCorners) => {
    const video = videoRef.current;
    if (!video?.videoWidth || busy) return;
    if (remaining <= 0) {
      onClose?.();
      return;
    }
    setBusy(true);
    try {
      if (!frameRef.current) frameRef.current = document.createElement('canvas');
      drawVideoFrame(video, frameRef.current);
      const quad = usedCorners || cornersRef.current;
      let canvas;
      if (quad) {
        canvas = warpPerspective(frameRef.current, quad, { maxEdge: 1600 });
      } else {
        canvas = frameRef.current;
      }
      canvas = enhanceDocument(canvas, enhanceMode);
      const dataUrl = canvasToJpegDataUrl(canvas, 0.88);
      hapticSuccess();
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      lastSnapRef.current = Date.now();
      stableRef.current = 0;
      onCapture?.(dataUrl);
      setToast(`Page ${pageCount + 1} saved`);
      setTimeout(() => setToast(''), 1400);
    } catch {
      hapticError();
      setError("Couldn't capture that page. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, enhanceMode, onCapture, onClose, pageCount, remaining]);

  useEffect(() => {
    if (!ready) return undefined;
    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video?.videoWidth || busy) return;
      if (now - lastAnalyzeRef.current < ANALYZE_EVERY_MS) return;
      lastAnalyzeRef.current = now;
      if (!frameRef.current) frameRef.current = document.createElement('canvas');
      drawVideoFrame(video, frameRef.current);
      const small = downscaleForDetect(frameRef.current);
      const hit = small ? detectDocumentQuad(small) : null;
      if (hit?.corners) {
        const smoothed = lerpCorners(cornersRef.current, hit.corners, cornersRef.current ? 0.35 : 1);
        const moved = cornersMoved(cornersRef.current, smoothed);
        cornersRef.current = smoothed;
        setCorners(smoothed);
        setScore(hit.score);
        if (moved < STABLE_MOVE && hit.score >= AUTO_MIN_SCORE) stableRef.current += 1;
        else stableRef.current = Math.max(0, stableRef.current - 2);
        const cooldown = Date.now() - lastSnapRef.current > 1400;
        if (autoSnap && cooldown && stableRef.current >= STABLE_FRAMES && remaining > 0) {
          stableRef.current = 0;
          captureNow(smoothed);
        }
      } else {
        stableRef.current = 0;
        if (cornersRef.current) {
          cornersRef.current = null;
          setCorners(null);
          setScore(0);
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, autoSnap, busy, captureNow, remaining]);

  const locked = score >= AUTO_MIN_SCORE && !!corners;

  return createPortal(
    <motion.div
      className="docscan-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Document scanner"
    >
      <video
        ref={videoRef}
        className="docscan-video"
        playsInline
        muted
        autoPlay
      />

      <div className="docscan-mask" aria-hidden="true">
        {corners ? (
          <svg className="docscan-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon
              className={`docscan-poly ${locked ? 'is-locked' : 'is-seeking'}`}
              points={corners.map((c) => `${(c.x * 100).toFixed(2)},${(c.y * 100).toFixed(2)}`).join(' ')}
            />
          </svg>
        ) : (
          <div className="docscan-guide" />
        )}
      </div>

      <AnimatePresence>
        {flash && (
          <motion.div
            className="docscan-flash"
            initial={{ opacity: 0.7 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      <header className="docscan-top">
        <button type="button" className="docscan-icon-btn" onClick={onClose} aria-label="Close scanner">
          <XIcon size={22} strokeWidth={2.2} />
        </button>
        <div className="docscan-status">
          {error
            ? 'Camera unavailable'
            : !ready
              ? 'Starting camera…'
              : locked
                ? (autoSnap ? 'Hold steady — auto capturing' : 'Page found')
                : 'Center the page in frame'}
        </div>
        <span className="docscan-count">{pageCount} saved</span>
      </header>

      {error && (
        <div className="docscan-error" role="alert">
          <p>{error}</p>
          {onUseSystemCamera && (
            <button
              type="button"
              className="docscan-chip"
              onClick={onUseSystemCamera}
            >
              Use system camera
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.p
            className="docscan-toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={14} strokeWidth={2.5} /> {toast}
          </motion.p>
        )}
      </AnimatePresence>

      <footer className="docscan-bottom">
        <button
          type="button"
          className={`docscan-chip ${autoSnap ? 'is-on' : ''}`}
          onClick={() => { hapticLight(); setAutoSnap((v) => !v); }}
        >
          {autoSnap ? <Zap size={16} strokeWidth={2.2} /> : <ZapOff size={16} strokeWidth={2.2} />}
          Auto
        </button>

        <button
          type="button"
          className="docscan-shutter"
          onClick={() => { hapticLight(); captureNow(cornersRef.current); }}
          disabled={!ready || busy || remaining <= 0}
          aria-label="Capture page"
        >
          <span />
        </button>

        <button
          type="button"
          className={`docscan-chip ${enhanceMode !== 'off' ? 'is-on' : ''}`}
          onClick={() => {
            hapticLight();
            setEnhanceMode((m) => (m === 'auto' ? 'bw' : m === 'bw' ? 'off' : 'auto'));
          }}
        >
          <Contrast size={16} strokeWidth={2.2} />
          {enhanceMode === 'bw' ? 'B&W' : enhanceMode === 'off' ? 'Raw' : 'Enhance'}
        </button>
      </footer>
    </motion.div>,
    document.body,
  );
}
