import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, useDragControls, animate } from 'framer-motion';
import { X, Minus, GripHorizontal, ExternalLink, WifiOff } from 'lucide-react';
import useYouTubeController from '../hooks/useYouTubeController';
import './FloatingVideoPlayer.css';

/**
 * FloatingVideoPlayer — viewport-confined, draggable Picture-in-Picture panel.
 *
 * Keeps a recipe video (YouTube / Instagram) playing in a corner while the user
 * browses the rest of SpiceHub or works through Cook Mode.
 *
 * Design decisions:
 *   • The TITLE BAR is the drag handle (framer dragControls + dragListener=false).
 *     This leaves the <iframe> fully interactive for native play/pause and
 *     completely avoids the "iframe swallows the drag gesture" problem — no
 *     transparent shield required.
 *   • Bounds are enforced by a fixed full-viewport constraints ref, so the panel
 *     can never be flung permanently off-screen or under the bottom nav.
 *   • On drag end it snaps to the nearest horizontal edge (subtle haptic).
 *   • Minimize collapses to a small pulsing pill that reclaims the viewport.
 *   • Offline → blurred cached thumbnail + "Video available when online".
 *
 * Props:
 *   source  : result of detectVideoSource() — { platform, label, embedUrl, originalUrl, ... }
 *   meal    : the recipe (for title + offline thumbnail)
 *   isOnline: boolean
 *   onClose : () => void
 */

const MARGIN = 12;          // gap from viewport edge
const BOTTOM_OFFSET = 84;   // sit above the bottom nav
const PANEL_W = 220;        // matches CSS .fvp-panel width

function hapticTap() {
  try { navigator.vibrate?.(12); } catch { /* no-op */ }
}

export default function FloatingVideoPlayer({ source, meal, isOnline = true, onClose }) {
  const boundsRef = useRef(null);
  const panelRef = useRef(null);
  const iframeRef = useRef(null);
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [minimized, setMinimized] = useState(false);

  const isYouTube = source?.platform === 'youtube';
  // Drives play/pause/seek over the YT IFrame API (no-op for Instagram).
  const yt = useYouTubeController(iframeRef);

  // Cook Mode context, received over decoupled window events. null when the
  // player wasn't launched from / isn't accompanied by Cook Mode.
  const [cook, setCook] = useState(null); // { stepIndex, totalSteps, seconds }

  const title = meal?.name || source?.label || 'Recipe video';

  // ── Snap to nearest horizontal edge on release ────────────────────────────
  const handleDragEnd = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const snapLeft = rect.left + rect.width / 2 < vw / 2;
    const desiredLeft = snapLeft ? MARGIN : vw - rect.width - MARGIN;
    const deltaX = desiredLeft - rect.left;
    animate(x, x.get() + deltaX, { type: 'spring', stiffness: 500, damping: 38 });
    hapticTap();
  }, [x]);

  // Escape/back: App registers useBackHandler(!!pipVideo) — no local Escape

  // ── Cook Mode step-sync (decoupled via window events) ───────────────────────
  // Cook Mode broadcasts the active step + its video timestamp; we mirror that
  // into the X-ray bar and scrub the player. On mount we ask for the current
  // step so a mid-cook launch lands in sync.
  useEffect(() => {
    const onCookStep = (e) => {
      const d = e.detail || {};
      setCook({
        stepIndex: typeof d.stepIndex === 'number' ? d.stepIndex : -1,
        totalSteps: typeof d.totalSteps === 'number' ? d.totalSteps : 0,
        seconds: typeof d.seconds === 'number' ? d.seconds : null,
      });
    };
    window.addEventListener('spicehub:cook-step', onCookStep);
    window.dispatchEvent(new CustomEvent('spicehub:pip-request-step'));
    return () => window.removeEventListener('spicehub:cook-step', onCookStep);
  }, []);

  // Scrub the YouTube player to the active step's timestamp (once ready).
  useEffect(() => {
    if (!isYouTube || !yt.ready) return;
    if (!cook || cook.seconds == null) return;
    yt.seekTo(cook.seconds);
    yt.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYouTube, yt.ready, cook?.seconds]);

  // X-ray segment tap → tell Cook Mode to change step (it echoes back a
  // cook-step event, which scrubs the video — single source of truth).
  const handleSegmentTap = useCallback((i) => {
    hapticTap();
    window.dispatchEvent(new CustomEvent('spicehub:pip-seek-step', { detail: { stepIndex: i } }));
  }, []);

  if (!source) return null;

  const showXray = !!cook && cook.totalSteps > 0;

  // ── Minimized pill ─────────────────────────────────────────────────────────
  if (minimized) {
    return createPortal(
      <motion.button
        className="fvp-pill"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0 }}
        onClick={() => { hapticTap(); setMinimized(false); }}
        aria-label={`Expand ${title} video`}
        title={`Expand — ${title}`}
      >
        <span className="fvp-pill-dot" aria-hidden="true" />
        <span className="fvp-pill-icon" aria-hidden="true">🎥</span>
      </motion.button>,
      document.body
    );
  }

  return createPortal(
    <>
      {/* Invisible full-viewport drag boundary */}
      <div ref={boundsRef} className="fvp-bounds" aria-hidden="true" />

      <motion.div
        ref={panelRef}
        className={`fvp-panel fvp-${source.platform}`}
        style={{ x, y }}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={boundsRef}
        dragElastic={0.06}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 1.04, cursor: 'grabbing' }}
        initial={{ opacity: 0, scale: 0.85, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        role="dialog"
        aria-label={`${source.label} video player — ${title}`}
      >
        {/* Drag handle bar */}
        <div
          className="fvp-bar"
          onPointerDown={(e) => dragControls.start(e)}
          style={{ touchAction: 'none' }}
        >
          <GripHorizontal size={14} strokeWidth={2} className="fvp-grip" aria-hidden="true" />
          <span className="fvp-title">{title}</span>
          <button
            className="fvp-bar-btn"
            onClick={() => { hapticTap(); setMinimized(true); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Minimize video"
            title="Minimize"
          >
            <Minus size={15} strokeWidth={2.25} />
          </button>
          <button
            className="fvp-bar-btn fvp-close"
            onClick={() => { hapticTap(); onClose?.(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Close video"
            title="Close"
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>

        {/* Stage */}
        <div className="fvp-stage">
          {isOnline ? (
            <iframe
              ref={iframeRef}
              className="fvp-iframe"
              src={isYouTube ? `${source.embedUrl}&enablejsapi=1` : source.embedUrl}
              title={`${source.label} player`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="fvp-offline">
              {meal?.imageUrl && (
                <img className="fvp-offline-thumb" src={meal.imageUrl} alt="" aria-hidden="true" />
              )}
              <div className="fvp-offline-overlay">
                <WifiOff size={20} strokeWidth={1.75} />
                <span>Video available when online</span>
                {source.originalUrl && (
                  <a
                    className="fvp-offline-link"
                    href={source.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={12} strokeWidth={2} /> Open on {source.label}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* X-ray stepped progress — segmented track mapped to recipe steps */}
        {showXray && (
          <div className="fvp-xray" role="group" aria-label="Recipe steps — tap to jump">
            {Array.from({ length: cook.totalSteps }, (_, i) => (
              <button
                key={i}
                type="button"
                className={
                  'fvp-xray-seg' +
                  (i === cook.stepIndex ? ' is-active' : '') +
                  (i < cook.stepIndex ? ' is-done' : '')
                }
                onClick={() => handleSegmentTap(i)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Jump to step ${i + 1} of ${cook.totalSteps}`}
                aria-current={i === cook.stepIndex ? 'step' : undefined}
                title={`Step ${i + 1}`}
              />
            ))}
          </div>
        )}
      </motion.div>
    </>,
    document.body
  );
}
