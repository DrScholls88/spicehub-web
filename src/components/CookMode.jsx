import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Cook Mode — full-screen, step-by-step kitchen walkthrough with timers.
 * Big text, big buttons, designed for messy hands and steamy kitchens.
 */
export default function CookMode({ meal, scaleFactor = 1.0, onClose }) {
  const [currentStep, setCurrentStep] = useState(-1); // -1 = ingredients overview
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [timer, setTimer] = useState(null); // { seconds, running, label }
  const timerRef = useRef(null);
  const [wakeLock, setWakeLock] = useState(null);

  const totalSteps = meal.directions.length;
  const progress = currentStep === -1 ? 0 : ((currentStep + 1) / (totalSteps + 1)) * 100;

  // Request wake lock to keep screen on while cooking
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
            // Vibrate if available
            if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
            return { ...prev, seconds: 0, running: false };
          }
          return { ...prev, seconds: prev.seconds - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timer?.running, timer?.seconds]);

  const startTimer = useCallback((minutes, label = 'Timer') => {
    setTimer({ seconds: minutes * 60, running: true, label });
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      if (currentStep >= 0) {
        setCompletedSteps(prev => new Set([...prev, currentStep]));
      }
      setCurrentStep(prev => prev + 1);
    }
  }, [currentStep, totalSteps]);

  const goPrev = useCallback(() => {
    if (currentStep > -1) setCurrentStep(prev => prev - 1);
  }, [currentStep]);

  const markComplete = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    goNext();
  }, [currentStep, goNext]);

  const isLastStep = currentStep === totalSteps - 1;
  const isIngredientView = currentStep === -1;

  // Detect timer hints in step text (e.g., "for 5 minutes", "15 min", "20 mins")
  const extractTimerHint = (text) => {
    const match = text.match(/(\d+)\s*(?:minutes?|mins?|min)/i);
    return match ? parseInt(match[1]) : null;
  };

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

  return (
    <div className="cm-container">
      {/* Progress bar */}
      <div className="cm-progress-bar">
        <div className="cm-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Top nav */}
      <div className="cm-topbar">
        <button className="cm-close-btn" onClick={onClose}>✕ Exit</button>
        <span className="cm-step-counter">
          {isIngredientView ? 'Ingredients' : `Step ${currentStep + 1} of ${totalSteps}`}
        </span>
        <div className="cm-step-dots">
          {Array.from({ length: totalSteps + 1 }, (_, i) => (
            <span
              key={i}
              className={`cm-dot ${i - 1 === currentStep ? 'active' : ''} ${completedSteps.has(i - 1) ? 'done' : ''} ${i === 0 ? 'ingredients' : ''}`}
              onClick={() => setCurrentStep(i - 1)}
            />
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div className="cm-content">
        {isIngredientView ? (
          /* ── Ingredients overview ── */
          <div className="cm-ingredients-view">
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
          /* ── Step view ── */
          <div className="cm-step-view">
            <div className="cm-step-number">Step {currentStep + 1}</div>
            <p className="cm-step-text">{meal.directions[currentStep]}</p>

            {/* Auto-detect timer from step text */}
            {extractTimerHint(meal.directions[currentStep]) && !timer && (
              <button
                className="cm-timer-suggest"
                onClick={() => startTimer(extractTimerHint(meal.directions[currentStep]), `Step ${currentStep + 1}`)}
              >
                <span className="cm-timer-icon">⏱️</span>
                Set {extractTimerHint(meal.directions[currentStep])} min timer
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timer display (always visible when active) */}
      {timer && (
        <div className={`cm-timer ${timer.seconds === 0 ? 'cm-timer-done' : ''}`}>
          <div className="cm-timer-display">
            <span className="cm-timer-label">{timer.label}</span>
            <span className={`cm-timer-time ${timer.seconds === 0 ? 'cm-blink' : ''}`}>
              {formatTime(timer.seconds)}
            </span>
          </div>
          <div className="cm-timer-controls">
            {timer.seconds > 0 ? (
              <>
                <button className="cm-timer-btn" onClick={toggleTimer}>
                  {timer.running ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button className="cm-timer-btn cm-timer-clear" onClick={clearTimer}>✕</button>
              </>
            ) : (
              <button className="cm-timer-btn cm-timer-dismiss" onClick={clearTimer}>
                Done!
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick timer buttons */}
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
        <button
          className="cm-nav-btn cm-prev"
          onClick={goPrev}
          disabled={isIngredientView}
        >
          ← Back
        </button>

        {isIngredientView ? (
          <button className="cm-nav-btn cm-next cm-start" onClick={goNext}>
            Let's Cook! →
          </button>
        ) : isLastStep ? (
          <button className="cm-nav-btn cm-next cm-finish" onClick={onClose}>
            🎉 Finish!
          </button>
        ) : (
          <button className="cm-nav-btn cm-next" onClick={markComplete}>
            Next Step →
          </button>
        )}
      </div>
    </div>
  );
}
