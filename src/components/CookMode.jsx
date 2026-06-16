import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, CheckCircle2, Pause, Play, Timer, ChevronDown, ChevronRight, Salad, PartyPopper } from 'lucide-react';
import './CookMode.css';

/**
 * Cook Mode — full-screen, step-by-step kitchen walkthrough.
 *
 * Features:
 *   • Carousel-style step transitions with prev/next preview
 *   • Smart ingredient sidebar when a step mentions ingredients
 *   • Swipe gesture navigation (touch-friendly)
 *   • A-2: Inline timer pills auto-detected from step text (multi-match)
 *   • A-2: Fullscreen countdown overlay with wake lock + Web Notifications
 *   • Quick timer buttons (1–20 min)
 *   • Screen wake lock to keep display on
 *   • Step completion checkmarks
 */

// ── A-2: Time expression regex ─────────────────────────────────────────────
// Matches "25 minutes", "1 hour 30 min", "45 sec", "5-10 minutes" etc.
// Captures numeric value + unit. Range expressions use the upper bound.
const TIMER_RX = /(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?\s*(hours?|hrs?|h\b|minutes?|mins?|min\b|seconds?|secs?|sec\b)/gi;

/**
 * Parse ALL time expressions in a step string.
 * Returns [{minutes, label, index, length}] sorted by position.
 */
function parseStepTimers(text) {
  const hits = [];
  TIMER_RX.lastIndex = 0;
  let m;
  while ((m = TIMER_RX.exec(text)) !== null) {
    const val     = parseFloat(m[2] || m[1]); // use range upper-bound if present
    const unit    = m[3].toLowerCase();
    let minutes   = val;
    if (/^h/.test(unit))     minutes = val * 60;
    if (/^s/.test(unit))     minutes = val / 60;
    if (minutes < 0.5 || minutes > 600) continue; // skip sub-30s or >10h
    hits.push({ minutes: Math.round(minutes), label: m[0], index: m.index, length: m[0].length });
  }
  return hits;
}

/**
 * Render step text with timer expressions replaced by tappable orange pills.
 * Returns an array of React nodes.
 */
function renderWithTimerPills(text, timerActive, onPillTap) {
  const hits = parseStepTimers(text);
  if (hits.length === 0) return [text];

  const nodes = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.index > cursor) {
      nodes.push(text.slice(cursor, hit.index));
    }
    nodes.push(
      <button
        key={`pill-${hit.index}`}
        className={`cm-timer-pill${timerActive ? ' cm-timer-pill-disabled' : ''}`}
        disabled={timerActive}
        title={timerActive ? 'Timer already running' : `Start ${hit.minutes} min timer`}
        onClick={e => {
          e.stopPropagation();
          if (!timerActive) onPillTap(hit.minutes, hit.label);
        }}
      >
        <Timer size={12} strokeWidth={2} className="cm-pill-icon" aria-hidden="true" />
        {hit.label}
      </button>
    );
    cursor = hit.index + hit.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// ── Notification helpers ────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => {});
  }
}

function fireTimerDoneNotif(label) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('⏰ Timer done!', {
      body: `${label} is ready`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: 'spicehub-timer',
      renotify: true,
    });
  } catch {}
}

// ── Component ───────────────────────────────────────────────────────────────
export default function CookMode({ meal, scaleFactor = 1.0, onClose }) {
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }, [onClose]);

  const [currentStep, setCurrentStep]     = useState(-1); // -1 = ingredients overview
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [timer, setTimer]                 = useState(null); // { seconds, running, label, totalSeconds }
  const [timerFullscreen, setTimerFull]   = useState(false); // fullscreen overlay
  const timerRef                          = useRef(null);
  const [wakeLock, setWakeLock]           = useState(null);
  const [slideDir, setSlideDir]           = useState('');
  const [showIngSidebar, setShowIngSidebar] = useState(false);
  const touchStartRef                     = useRef(null);
  const contentRef                        = useRef(null);
  const notifAskedRef                     = useRef(false);

  const totalSteps = meal.directions.length;
  const progress   = currentStep === -1 ? 0 : ((currentStep + 1) / (totalSteps + 1)) * 100;

  // Request wake lock
  useEffect(() => {
    let lock = null;
    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen');
          setWakeLock(lock);
        }
      } catch {}
    }
    requestWakeLock();
    return () => { if (lock) lock.release().catch(() => {}); };
  }, []);

  // Timer countdown
  useEffect(() => {
    if (timer && timer.running && timer.seconds > 0) {
      timerRef.current = setInterval(() => {
        setTimer(prev => {
          if (!prev || prev.seconds <= 1) {
            clearInterval(timerRef.current);
            if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
            fireTimerDoneNotif(prev?.label || 'Timer');
            return { ...prev, seconds: 0, running: false };
          }
          return { ...prev, seconds: prev.seconds - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timer?.running, timer?.seconds]);

  // ── A-2: Start timer + request notif permission + open fullscreen ────────
  const startTimer = useCallback(async (minutes, label = 'Timer') => {
    if (!notifAskedRef.current) {
      notifAskedRef.current = true;
      await requestNotifPermission();
    }
    setTimer({ seconds: minutes * 60, totalSeconds: minutes * 60, running: true, label });
    setTimerFull(true);
  }, []);

  const toggleTimer = useCallback(() => {
    setTimer(prev => prev ? { ...prev, running: !prev.running } : null);
  }, []);

  const clearTimer = useCallback(() => {
    clearInterval(timerRef.current);
    setTimer(null);
    setTimerFull(false);
  }, []);

  const formatTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const animateAndGo = useCallback((nextStep, direction) => {
    setSlideDir(direction);
    setTimeout(() => { setCurrentStep(nextStep); setSlideDir(''); }, 200);
  }, []);

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      if (currentStep >= 0) setCompletedSteps(prev => new Set([...prev, currentStep]));
      animateAndGo(currentStep + 1, 'left');
    }
  }, [currentStep, totalSteps, animateAndGo]);

  const goPrev = useCallback(() => {
    if (currentStep > -1) animateAndGo(currentStep - 1, 'right');
  }, [currentStep, animateAndGo]);

  const goToStep = useCallback((step) => {
    if (step === currentStep) return;
    animateAndGo(step, step > currentStep ? 'left' : 'right');
  }, [currentStep, animateAndGo]);

  const markComplete = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    goNext();
  }, [currentStep, goNext]);

  // ── Swipe handling ────────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && currentStep < totalSteps - 1) goNext();
      else if (dx > 0 && currentStep > -1) goPrev();
    }
  }, [currentStep, totalSteps, goNext, goPrev]);

  const isLastStep      = currentStep === totalSteps - 1;
  const isIngredientView = currentStep === -1;

  // Scale ingredient amounts
  const scaleIngredient = (ingredient, factor) => {
    const regex = /^(\d+\.?\d*|\d+\/\d+)\s*(.*)$/;
    const match = ingredient.match(regex);
    if (!match || factor === 1) return ingredient;
    const [, amount, rest] = match;
    let scaled;
    if (amount.includes('/')) {
      const [num, denom] = amount.split('/').map(Number);
      scaled = (num / denom) * factor;
    } else {
      scaled = parseFloat(amount) * factor;
    }
    const fmt = scaled % 1 !== 0 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled).toString();
    return `${fmt} ${rest}`;
  };

  // Smart ingredient matching
  const matchedIngredients = useMemo(() => {
    if (currentStep < 0 || !meal.directions[currentStep]) return [];
    const stepText = meal.directions[currentStep].toLowerCase();
    return meal.ingredients.filter(ing => {
      const cleaned = ing
        .replace(/^[\d½¼¾⅓⅔⅛⅜⅝⅞\s./]+/, '')
        .replace(/\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|sticks?|slices?|handful|medium|large|small|whole|half)\b/gi, '')
        .replace(/[,()]/g, '')
        .trim()
        .toLowerCase();
      if (cleaned.length < 3) return false;
      return cleaned.split(/\s+/).filter(w => w.length >= 3).some(word => stepText.includes(word));
    });
  }, [currentStep, meal.directions, meal.ingredients]);

  useEffect(() => {
    setShowIngSidebar(matchedIngredients.length > 0);
  }, [matchedIngredients.length]);

  const prevStepText = currentStep > 0 ? meal.directions[currentStep - 1] : null;
  const nextStepText = currentStep >= 0 && currentStep < totalSteps - 1 ? meal.directions[currentStep + 1] : null;
  const truncate = (text, maxLen = 60) => text && text.length > maxLen ? text.slice(0, maxLen) + '…' : text;

  // Current step timer pills (pre-computed to reuse in step render)
  const currentStepText    = currentStep >= 0 ? meal.directions[currentStep] : '';
  const currentStepTimers  = useMemo(() => parseStepTimers(currentStepText), [currentStepText]);

  // ── Timer progress ring values ────────────────────────────────────────────
  const timerPct    = timer ? (timer.seconds / (timer.totalSeconds || 1)) : 1;
  const RING_R      = 70;
  const RING_CIRC   = 2 * Math.PI * RING_R;

  return (
    <motion.div
      className="cm-container"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      drag="y" dragListener={false} dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
      onDragEnd={handleSheetDragEnd}
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      <div
        className="cm-drag-handle"
        aria-hidden="true"
        onPointerDown={(e) => dragControls.start(e)}
        style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '8px auto', cursor: 'grab' }}
      />

      {/* Progress bar */}
      <div className="cm-progress-bar">
        <div className="cm-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Top nav */}
      <div className="cm-topbar">
        <button className="cm-close-btn" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <X size={18} strokeWidth={1.75} /> Exit
        </button>
        <span className="cm-step-counter">
          {isIngredientView ? 'Ingredients' : `Step ${currentStep + 1} of ${totalSteps}`}
        </span>
        <div className="cm-step-dots">
          {Array.from({ length: totalSteps + 1 }, (_, i) => (
            <span
              key={i}
              className={`cm-dot ${i - 1 === currentStep ? 'active' : ''} ${completedSteps.has(i - 1) ? 'done' : ''} ${i === 0 ? 'ingredients' : ''}`}
              onClick={() => goToStep(i - 1)}
            />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="cm-content" ref={contentRef}>
        {isIngredientView ? (
          <div className={`cm-ingredients-view ${slideDir ? 'cm-slide-' + slideDir : 'cm-slide-in'}`}>
            <h2 className="cm-recipe-name">{meal.name}</h2>
            {meal.imageUrl && (
              <img src={meal.imageUrl} alt={meal.name} className="cm-hero-img" onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div className="cm-ing-header">
              <h3>Gather Your Ingredients</h3>
              {scaleFactor !== 1 && <span className="cm-scale-badge">{scaleFactor}× scaled</span>}
            </div>
            <ul className="cm-ing-list">
              {meal.ingredients.map((ing, i) => (
                <li key={i} className="cm-ing-item">
                  <span className="cm-ing-bullet">•</span>
                  <span className="cm-ing-text">{scaleIngredient(ing, scaleFactor)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={`cm-step-carousel ${slideDir ? 'cm-slide-' + slideDir : 'cm-slide-in'}`}>
            {prevStepText && (
              <div className="cm-step-preview cm-preview-prev" onClick={goPrev}>
                <span className="cm-preview-label">Step {currentStep}</span>
                <span className="cm-preview-text">{truncate(prevStepText)}</span>
              </div>
            )}

            <div className="cm-step-view">
              <div className="cm-step-number">
                Step {currentStep + 1}
                {completedSteps.has(currentStep) && <CheckCircle2 size={18} strokeWidth={1.75} className="cm-step-check" />}
              </div>

              {/* ── A-2: Step text with inline timer pills ── */}
              <p className="cm-step-text">
                {renderWithTimerPills(
                  meal.directions[currentStep],
                  !!timer,
                  (minutes, label) => startTimer(minutes, label)
                )}
              </p>

              {/* ── A-2: "Open timer" hint when timer is running for this step ── */}
              {timer && (
                <button
                  className="cm-timer-running-pill"
                  onClick={() => setTimerFull(true)}
                  aria-label="Open fullscreen timer"
                >
                  <Timer size={14} strokeWidth={2} />
                  {formatTime(timer.seconds)} — {timer.label}
                  <span className="cm-timer-pulse" aria-hidden="true" />
                </button>
              )}
            </div>

            {nextStepText && (
              <div className="cm-step-preview cm-preview-next" onClick={goNext}>
                <span className="cm-preview-label">Up next — Step {currentStep + 2}</span>
                <span className="cm-preview-text">{truncate(nextStepText)}</span>
              </div>
            )}
          </div>
        )}

        {/* Ingredient sidebar */}
        {!isIngredientView && matchedIngredients.length > 0 && (
          <div className={`cm-ing-sidebar ${showIngSidebar ? 'cm-sidebar-visible' : ''}`}>
            <div className="cm-sidebar-header">
              <Salad size={16} strokeWidth={1.75} className="cm-sidebar-icon" />
              <span className="cm-sidebar-title">Ingredients</span>
              <button className="cm-sidebar-toggle" onClick={() => setShowIngSidebar(v => !v)}>
                {showIngSidebar ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}
              </button>
            </div>
            {showIngSidebar && (
              <ul className="cm-sidebar-list">
                {matchedIngredients.map((ing, i) => (
                  <li key={i} className="cm-sidebar-item">{scaleIngredient(ing, scaleFactor)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Quick timer buttons — only show when no timer active and in a step */}
      {!timer && currentStep >= 0 && (
        <div className="cm-quick-timers">
          {[1, 3, 5, 10, 15, 20].map(m => (
            <button key={m} className="cm-qt-btn" onClick={() => startTimer(m, `${m} min`)}>
              {m}m
            </button>
          ))}
        </div>
      )}

      {/* Bottom nav */}
      <div className="cm-bottom-nav">
        <button className="cm-nav-btn cm-prev" onClick={goPrev} disabled={isIngredientView}>
          ← Back
        </button>
        {isIngredientView ? (
          <button className="cm-nav-btn cm-next cm-start" onClick={goNext}>Let's Cook! →</button>
        ) : isLastStep ? (
          <button className="cm-nav-btn cm-next cm-finish" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <PartyPopper size={18} strokeWidth={1.75} /> Finish!
          </button>
        ) : (
          <button className="cm-nav-btn cm-next" onClick={markComplete}>Next Step →</button>
        )}
      </div>

      {/* ── A-2: Fullscreen timer overlay ── */}
      {timerFullscreen && timer && (
        <motion.div
          className="cm-timer-fullscreen"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        >
          {/* Close fullscreen (but keep timer running) */}
          <button
            className="cm-tfs-close"
            onClick={() => setTimerFull(false)}
            aria-label="Minimize timer"
          >
            <ChevronDown size={22} strokeWidth={2} />
          </button>

          <p className="cm-tfs-label">{timer.label}</p>

          {/* SVG progress ring */}
          <div className="cm-tfs-ring-wrap">
            <svg className="cm-tfs-ring" viewBox="0 0 160 160" aria-hidden="true">
              {/* Track */}
              <circle
                cx="80" cy="80" r={RING_R}
                fill="none"
                strokeWidth="6"
                className="cm-ring-track"
              />
              {/* Fill arc */}
              <circle
                cx="80" cy="80" r={RING_R}
                fill="none"
                strokeWidth="6"
                className={`cm-ring-fill ${timer.seconds === 0 ? 'cm-ring-done' : ''}`}
                strokeDasharray={RING_CIRC}
                strokeDashoffset={RING_CIRC * (1 - timerPct)}
                strokeLinecap="round"
                transform="rotate(-90 80 80)"
              />
            </svg>
            <div className="cm-tfs-time-wrap">
              <span className={`cm-tfs-time ${timer.seconds === 0 ? 'cm-tfs-done' : ''} ${timer.seconds > 0 && timer.seconds <= 10 ? 'cm-tfs-urgent' : ''}`}>
                {formatTime(timer.seconds)}
              </span>
              {timer.seconds === 0 && (
                <span className="cm-tfs-done-label">Done!</span>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="cm-tfs-controls">
            {timer.seconds > 0 ? (
              <>
                <button
                  className="cm-tfs-btn cm-tfs-pause"
                  onClick={toggleTimer}
                  aria-label={timer.running ? 'Pause' : 'Resume'}
                >
                  {timer.running
                    ? <><Pause size={22} strokeWidth={2} /> Pause</>
                    : <><Play  size={22} strokeWidth={2} /> Resume</>
                  }
                </button>
                <button className="cm-tfs-btn cm-tfs-cancel" onClick={clearTimer} aria-label="Cancel timer">
                  <X size={20} strokeWidth={2} /> Cancel
                </button>
              </>
            ) : (
              <button className="cm-tfs-btn cm-tfs-dismiss" onClick={clearTimer}>
                ✓ Got it!
              </button>
            )}
          </div>

          {/* Steps context at bottom */}
          <p className="cm-tfs-step-ctx">
            {currentStep >= 0 ? `Step ${currentStep + 1} of ${totalSteps}` : meal.name}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
