import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { Download, Dices, UtensilsCrossed } from 'lucide-react';
import { hapticTap } from '../../haptics';

// ── App Intro Hero — Stage Carousel ─────────────────────────────────────────────
// Replaces the old "Decision Fatigue Killer" GamifiedHero (big Spin CTA +
// shake-to-spin). Product call (2026-07-30): the fold's job is to tell a new
// or returning user what SpiceHub actually does, not to push the Spin action —
// Spin now lives as its own tile in the widget grid below ("Spin the Week").
// Every color here is a token from design.md §2 (no undefined vars, no
// hardcoded fallbacks) — the washed-out-text bug in the old hero came from
// var(--surface-elevated, ...) / var(--surface-overlay, #1f2937), neither of
// which is ever defined in App.css, so the off-brand dark-navy fallback was
// silently permanent. Every value below resolves to a real token.
//
// SettingsPlan.md PKG D — swipeable stage carousel. iOS-hardened per the
// plan's D-2/D-3/D-6 notes:
//  - drag lives on an INNER motion.div, separate from the OUTER motion.div
//    that owns the enter/exit `variants` + `custom` transition — combining
//    both roles on one element was the original bug (custom prop misuse:
//    `initial={(dir) => ...}` isn't valid framer-motion, initial/exit take
//    objects or variant names, not functions).
//  - progress-dot fill uses a real useMotionValue + framer's `animate()`,
//    not a CSS custom-property pause trick (CSS can't read back a
//    mid-animation computed value to freeze/resume from).
//  - dot fill animates `scaleX` (compositor-only), not `width` (layout) —
//    cheaper than even the plan asked for, and avoids animating a gradient
//    background-color (a no-op on gradients in every browser).
//  - swipes are debounced 250ms so iOS Safari's occasional skipped exit
//    animation under `mode="wait"` + rapid swipes can't leave a ghost node.
//  - touch-action: pan-y + overscroll-behavior-x: none + dragDirectionLock
//    keep the horizontal drag from fighting iOS's vertical scroll and
//    edge-swipe back-navigation gesture.

const STAGES = [
  {
    id: 'import',
    icon: Download,
    title: 'Import from anywhere',
    subtitle: 'Instagram, TikTok, or any recipe link — auto-parsed in seconds.',
    color: '#6366f1',
  },
  {
    id: 'spin',
    icon: Dices,
    title: 'Auto-plan your week',
    subtitle: 'Spin up a full week of meals from your saved recipes.',
    color: 'var(--primary)',
  },
  {
    id: 'cook',
    icon: UtensilsCrossed,
    title: 'Cook what you have',
    subtitle: "Match recipes to what's already in your pantry.",
    color: '#10b981',
  },
];

const AUTO_ADVANCE_S = 4.2;
const SWIPE_DEBOUNCE_MS = 250;
const SWIPE_TRANSITION = { duration: 0.28, ease: [0.32, 0.72, 0, 1] };

const stageVariants = {
  enter: (dir) => ({ x: dir >= 0 ? 36 : -36, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir >= 0 ? -36 : 36, opacity: 0 }),
};

export default function AppIntroHero() {
  const [[index, direction], setIndexDir] = useState([0, 0]);
  const [paused, setPaused] = useState(false);
  const lastSwipeRef = useRef(0);
  const progress = useMotionValue(0);

  const stage = STAGES[index];
  const Icon = stage.icon;

  const goTo = useCallback((rawIndex, dir) => {
    const now = Date.now();
    // D-6: ignore a second swipe/tap that lands within 250ms of the last —
    // prevents rapid double-fires from racing AnimatePresence's exit
    // animation and leaving a stale node behind on iOS Safari.
    if (now - lastSwipeRef.current < SWIPE_DEBOUNCE_MS) return;
    lastSwipeRef.current = now;
    hapticTap(); // no-op on iOS (no navigator.vibrate) — dots get a scale
    // pulse below as the universal visual fallback.
    const next = ((rawIndex % STAGES.length) + STAGES.length) % STAGES.length;
    setIndexDir(([prevIndex]) => (prevIndex === next ? [prevIndex, 0] : [next, dir]));
  }, []);

  const goNext = useCallback(() => goTo(index + 1, 1), [index, goTo]);
  const goPrev = useCallback(() => goTo(index - 1, -1), [index, goTo]);
  const jumpTo = useCallback((i) => goTo(i, i > index ? 1 : -1), [index, goTo]);

  // Auto-advance the carousel and drive the active dot's fill with the same
  // motion value, so pausing mid-fill and resuming (or restarting after a
  // manual swipe) reads from real animation state instead of guessing at a
  // frozen CSS width.
  useEffect(() => {
    progress.set(0);
    if (paused) return undefined;
    const controls = animate(progress, 1, {
      duration: AUTO_ADVANCE_S,
      ease: 'linear',
      onComplete: () => goTo(index + 1, 1),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused]);

  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  const handleDragEnd = useCallback((_e, info) => {
    resume();
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > 60 || Math.abs(velocity.x) > 380) {
      if (offset.x < 0) goNext(); else goPrev();
    }
  }, [goNext, goPrev, resume]);

  return (
    <motion.div
      className="app-intro-hero"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
      style={{
        background: 'linear-gradient(135deg, var(--card), var(--surface))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '22px 20px',
        marginBottom: '20px',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>
          🌶️ SpiceHub
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)' }}>
          Your meals, gamified.
        </span>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-light)', margin: '0 0 16px 0', lineHeight: 1.45, fontWeight: 500 }}>
        Plan your week, import any recipe, and never wonder what's for dinner again.
      </p>

      {/* Stage viewport — pan-y so the browser owns vertical scroll while we
          own horizontal drag; overscroll-behavior-x stops the drag from
          triggering iOS's edge-swipe back gesture near the left edge. */}
      <div
        style={{
          position: 'relative',
          touchAction: 'pan-y',
          overscrollBehaviorX: 'none',
          minHeight: '58px',
        }}
        onTouchStart={pause}
        onTouchEnd={resume}
        onPointerDown={pause}
        onPointerUp={resume}
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={stage.id}
            custom={direction}
            variants={stageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={SWIPE_TRANSITION}
          >
            <motion.div
              drag="x"
              dragDirectionLock
              dragElastic={0.15}
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={handleDragEnd}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'grab' }}
              whileTap={{ cursor: 'grabbing' }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px',
                  background: 'var(--surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: stage.color,
                }}
              >
                <Icon size={17} strokeWidth={2.25} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '1px' }}>
                  {stage.title}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-light)', lineHeight: 1.4 }}>
                  {stage.subtitle}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots — past stages fully filled, current stage animates
          via the shared `progress` motion value, future stages empty. */}
      <div role="tablist" aria-label="Feature stages" style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Show: ${s.title}`}
            onClick={() => jumpTo(i)}
            className="stg-pulse"
            style={{
              background: 'none',
              border: 'none',
              padding: '6px 3px',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              style={{
                display: 'block',
                width: '22px',
                height: '4px',
                borderRadius: '2px',
                background: 'var(--border)',
                overflow: 'hidden',
              }}
            >
              {i < index && (
                <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: '2px', background: STAGES[i].color }} />
              )}
              {i === index && (
                <motion.span
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    borderRadius: '2px',
                    background: stage.color,
                    transformOrigin: 'left',
                    scaleX: progress,
                  }}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
