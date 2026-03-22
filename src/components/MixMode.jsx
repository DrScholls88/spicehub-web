import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Mix Mode — full-screen, step-by-step bartender walkthrough.
 * Optimized for speed and efficiency behind the bar.
 *
 * Key differences from CookMode:
 *   • Full ingredient checklist always visible (drinks are quick — no hiding them)
 *   • "Pour list" shows all ingredients needed for the current step with amounts
 *   • Shake/stir/blend technique indicators auto-detected from step text
 *   • Quick timer presets tuned for drinks (10s, 15s, 30s, 1m, 2m)
 *   • Garnish callout when on last step
 *   • Dark purple bar theme
 *   • Compact layout — drinks have fewer, shorter steps than meals
 */
export default function MixMode({ drink, scaleFactor = 1.0, onClose }) {
  const [currentStep, setCurrentStep] = useState(-1); // -1 = ingredients gather
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [checkedIngredients, setCheckedIngredients] = useState(new Set());
  const [timer, setTimer] = useState(null);
  const timerRef = useRef(null);
  const [wakeLock, setWakeLock] = useState(null);
  const [slideDir, setSlideDir] = useState('');
  const touchStartRef = useRef(null);

  const totalSteps = drink.directions.length;
  const progress = currentStep === -1 ? 0 : ((currentStep + 1) / (totalSteps + 1)) * 100;

  // Wake lock
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
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            return { ...prev, seconds: 0, running: false };
          }
          return { ...prev, seconds: prev.seconds - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timer?.running, timer?.seconds]);

  const startTimer = useCallback((seconds, label = 'Timer') => {
    setTimer({ seconds, running: true, label });
  }, []);

  const toggleTimer = useCallback(() => {
    setTimer(prev => prev ? { ...prev, running: !prev.running } : null);
  }, []);

  const clearTimer = useCallback(() => {
    clearInterval(timerRef.current);
    setTimer(null);
  }, []);

  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
  };

  // Navigation with slide animation
  const animateAndGo = useCallback((nextStep, direction) => {
    setSlideDir(direction);
    setTimeout(() => {
      setCurrentStep(nextStep);
      setSlideDir('');
    }, 200);
  }, []);

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      if (currentStep >= 0) {
        setCompletedSteps(prev => new Set([...prev, currentStep]));
      }
      animateAndGo(currentStep + 1, 'left');
    }
  }, [currentStep, totalSteps, animateAndGo]);

  const goPrev = useCallback(() => {
    if (currentStep > -1) {
      animateAndGo(currentStep - 1, 'right');
    }
  }, [currentStep, animateAndGo]);

  const goToStep = useCallback((step) => {
    if (step === currentStep) return;
    animateAndGo(step, step > currentStep ? 'left' : 'right');
  }, [currentStep, animateAndGo]);

  const markComplete = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    goNext();
  }, [currentStep, goNext]);

  // Swipe gesture
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

  const isLastStep = currentStep === totalSteps - 1;
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

  // Toggle ingredient checkbox
  const toggleIngredient = useCallback((idx) => {
    setCheckedIngredients(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const allChecked = checkedIngredients.size === drink.ingredients.length;

  // Detect technique hints from step text
  const detectTechnique = (text) => {
    const lower = text.toLowerCase();
    if (/\bshake\b|\bshaking\b|\bshaken\b/.test(lower)) return { icon: '🫨', label: 'Shake', detail: 'Shake vigorously' };
    if (/\bstir\b|\bstirring\b|\bstirred\b/.test(lower)) return { icon: '🥄', label: 'Stir', detail: 'Stir gently' };
    if (/\bblend\b|\bblending\b|\bblended\b/.test(lower)) return { icon: '🌀', label: 'Blend', detail: 'Blend until smooth' };
    if (/\bmuddle\b|\bmuddling\b|\bmuddled\b/.test(lower)) return { icon: '🪵', label: 'Muddle', detail: 'Muddle gently' };
    if (/\bstrain\b|\bstraining\b|\bdouble.strain/.test(lower)) return { icon: '🫗', label: 'Strain', detail: 'Strain into glass' };
    if (/\bpour\b|\bpouring\b/.test(lower)) return { icon: '🫗', label: 'Pour', detail: null };
    if (/\bgarnish\b|\bgarnishing\b/.test(lower)) return { icon: '🍋', label: 'Garnish', detail: null };
    if (/\bflame\b|\bflaming\b|\blight\b|fire/.test(lower)) return { icon: '🔥', label: 'Flame', detail: 'Use caution' };
    if (/\brim\b|\brimming\b/.test(lower)) return { icon: '🧂', label: 'Rim', detail: null };
    return null;
  };

  // Detect timer hints — drinks use seconds more often
  const extractTimerHint = (text) => {
    // Seconds first (e.g., "shake for 15 seconds")
    const secMatch = text.match(/(\d+)\s*(?:seconds?|secs?|sec)/i);
    if (secMatch) return { seconds: parseInt(secMatch[1]), label: `${secMatch[1]}s` };
    // Minutes
    const minMatch = text.match(/(\d+)\s*(?:minutes?|mins?|min)/i);
    if (minMatch) return { seconds: parseInt(minMatch[1]) * 60, label: `${minMatch[1]}m` };
    return null;
  };

  // Smart ingredient matching for current step
  const matchedIngredients = useMemo(() => {
    if (currentStep < 0 || !drink.directions[currentStep]) return [];
    const stepText = drink.directions[currentStep].toLowerCase();
    return drink.ingredients.map((ing, idx) => {
      const cleaned = ing.replace(/^[\d½¼¾⅓⅔⅛⅜⅝⅞\s./]+/, '')
        .replace(/\b(oz|ounces?|ml|cl|dash(?:es)?|drops?|parts?|cups?|tbsp|tsp|tablespoons?|teaspoons?|shots?|jiggers?|barspoons?|splashe?s?|float|rinse|sprigs?|slices?|wedges?|wheels?|twists?|leaves?|whole|fresh|chilled|large|small)\b/gi, '')
        .replace(/[,()]/g, '')
        .trim()
        .toLowerCase();
      if (cleaned.length < 3) return null;
      const words = cleaned.split(/\s+/).filter(w => w.length >= 3);
      const matched = words.some(word => stepText.includes(word));
      return matched ? { idx, ingredient: ing } : null;
    }).filter(Boolean);
  }, [currentStep, drink.directions, drink.ingredients]);

  // Detect if this is a garnish step
  const isGarnishStep = useMemo(() => {
    if (currentStep < 0 || !drink.directions[currentStep]) return false;
    return /\bgarnish\b/i.test(drink.directions[currentStep]);
  }, [currentStep, drink.directions]);

  // Prev/next for carousel
  const prevStepText = currentStep > 0 ? drink.directions[currentStep - 1] : null;
  const nextStepText = currentStep >= 0 && currentStep < totalSteps - 1 ? drink.directions[currentStep + 1] : null;
  const truncate = (text, maxLen = 55) => text && text.length > maxLen ? text.slice(0, maxLen) + '…' : text || '';

  // Current step technique
  const technique = currentStep >= 0 && drink.directions[currentStep] ? detectTechnique(drink.directions[currentStep]) : null;
  const timerHint = currentStep >= 0 && drink.directions[currentStep] ? extractTimerHint(drink.directions[currentStep]) : null;

  return (
    <div
      className="mm-container"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Progress bar */}
      <div className="mm-progress-bar">
        <div className="mm-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Top nav */}
      <div className="mm-topbar">
        <button className="mm-close-btn" onClick={onClose}>✕ Exit</button>
        <span className="mm-step-counter">
          {isIngredientView ? 'Ingredients' : `Step ${currentStep + 1} of ${totalSteps}`}
        </span>
        <div className="mm-step-dots">
          {Array.from({ length: totalSteps + 1 }, (_, i) => (
            <span
              key={i}
              className={`mm-dot ${i - 1 === currentStep ? 'active' : ''} ${completedSteps.has(i - 1) ? 'done' : ''} ${i === 0 ? 'ingredients' : ''}`}
              onClick={() => goToStep(i - 1)}
            />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="mm-content">
        {isIngredientView ? (
          /* ── Ingredients gather screen ── */
          <div className={`mm-gather ${slideDir ? 'mm-slide-' + slideDir : 'mm-slide-in'}`}>
            <h2 className="mm-drink-name">{drink.name}</h2>
            {drink.imageUrl && (
              <img src={drink.imageUrl} alt={drink.name} className="mm-hero-img" onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div className="mm-gather-header">
              <h3>Line Up Your Bottles</h3>
              {scaleFactor !== 1 && <span className="mm-scale-badge">{scaleFactor}×</span>}
              <span className="mm-check-count">{checkedIngredients.size}/{drink.ingredients.length}</span>
            </div>
            <ul className="mm-checklist">
              {drink.ingredients.map((ing, i) => (
                <li
                  key={i}
                  className={`mm-check-item ${checkedIngredients.has(i) ? 'checked' : ''}`}
                  onClick={() => toggleIngredient(i)}
                >
                  <span className="mm-checkbox">{checkedIngredients.has(i) ? '✓' : ''}</span>
                  <span className="mm-check-text">{scaleIngredient(ing, scaleFactor)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          /* ── Step view ── */
          <div className={`mm-step-carousel ${slideDir ? 'mm-slide-' + slideDir : 'mm-slide-in'}`}>
            {/* Previous step preview */}
            {prevStepText && (
              <div className="mm-step-preview mm-preview-prev" onClick={goPrev}>
                <span className="mm-preview-label">Step {currentStep}</span>
                <span className="mm-preview-text">{truncate(prevStepText)}</span>
              </div>
            )}

            {/* Current step */}
            <div className="mm-step-view">
              {/* Technique badge */}
              {technique && (
                <div className="mm-technique-badge">
                  <span className="mm-technique-icon">{technique.icon}</span>
                  <span className="mm-technique-label">{technique.label}</span>
                </div>
              )}

              <div className="mm-step-number">
                Step {currentStep + 1}
                {completedSteps.has(currentStep) && <span className="mm-step-check">✓</span>}
              </div>
              <p className="mm-step-text">{drink.directions[currentStep]}</p>

              {/* Auto timer suggestion */}
              {timerHint && !timer && (
                <button
                  className="mm-timer-suggest"
                  onClick={() => startTimer(timerHint.seconds, `Step ${currentStep + 1}`)}
                >
                  ⏱️ Set {timerHint.label} timer
                </button>
              )}

              {/* Garnish callout */}
              {isGarnishStep && (
                <div className="mm-garnish-callout">
                  🍋 Garnish Time — Make it pretty!
                </div>
              )}
            </div>

            {/* Next step preview */}
            {nextStepText && (
              <div className="mm-step-preview mm-preview-next" onClick={goNext}>
                <span className="mm-preview-label">Up next — Step {currentStep + 2}</span>
                <span className="mm-preview-text">{truncate(nextStepText)}</span>
              </div>
            )}
          </div>
        )}

        {/* Pour list — ingredients needed for this step */}
        {!isIngredientView && matchedIngredients.length > 0 && (
          <div className="mm-pour-list">
            <div className="mm-pour-header">
              <span>🫗</span>
              <span className="mm-pour-title">Pour</span>
            </div>
            <ul className="mm-pour-items">
              {matchedIngredients.map(({ idx, ingredient }) => (
                <li key={idx} className="mm-pour-item">
                  {scaleIngredient(ingredient, scaleFactor)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Timer */}
      {timer && (
        <div className={`mm-timer ${timer.seconds === 0 ? 'mm-timer-done' : ''}`}>
          <div className="mm-timer-display">
            <span className="mm-timer-label">{timer.label}</span>
            <span className={`mm-timer-time ${timer.seconds === 0 ? 'mm-blink' : ''}`}>
              {formatTime(timer.seconds)}
            </span>
          </div>
          <div className="mm-timer-controls">
            {timer.seconds > 0 ? (
              <>
                <button className="mm-timer-btn" onClick={toggleTimer}>
                  {timer.running ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button className="mm-timer-btn mm-timer-clear" onClick={clearTimer}>✕</button>
              </>
            ) : (
              <button className="mm-timer-btn mm-timer-dismiss" onClick={clearTimer}>
                Done!
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick timers — bartender presets (seconds-focused) */}
      {!timer && currentStep >= 0 && (
        <div className="mm-quick-timers">
          {[
            { s: 10, label: '10s' },
            { s: 15, label: '15s' },
            { s: 30, label: '30s' },
            { s: 60, label: '1m' },
            { s: 120, label: '2m' },
          ].map(t => (
            <button key={t.s} className="mm-qt-btn" onClick={() => startTimer(t.s, t.label)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Bottom nav */}
      <div className="mm-bottom-nav">
        <button
          className="mm-nav-btn mm-prev"
          onClick={goPrev}
          disabled={isIngredientView}
        >
          ← Back
        </button>

        {isIngredientView ? (
          <button
            className="mm-nav-btn mm-next mm-start"
            onClick={goNext}
          >
            {allChecked ? "Let's Mix! →" : "Start Mixing →"}
          </button>
        ) : isLastStep ? (
          <button className="mm-nav-btn mm-next mm-finish" onClick={onClose}>
            🍹 Cheers!
          </button>
        ) : (
          <button className="mm-nav-btn mm-next" onClick={markComplete}>
            Next Step →
          </button>
        )}
      </div>
    </div>
  );
}
