import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * MealSpinner — Animated slot-machine style meal randomizer.
 *
 * Shows 7 spinning columns (one per day) that resolve to meals.
 * Each column cycles through meal names with easing, stopping sequentially.
 *
 * Props:
 *   meals       - Array of all meals to sample from
 *   onComplete  - callback(plan[7]) when spin finishes — array of 7 meals
 *   onClose     - callback() to dismiss without applying
 */
export default function MealSpinner({ meals, onComplete, onClose }) {
  const [phase, setPhase] = useState('ready');     // 'ready' | 'spinning' | 'done'
  const [columns, setColumns] = useState(Array(7).fill(null)); // final picks
  const [displayNames, setDisplayNames] = useState(Array(7).fill('')); // cycling display
  const intervalsRef = useRef([]);
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build the final plan
  const buildPlan = useCallback(() => {
    const dinners = meals.filter(m => !m.category || m.category === 'Dinners');
    const pool = dinners.length >= 5 ? dinners : meals;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return Array.from({ length: 7 }, (_, i) => shuffled[i % shuffled.length]);
  }, [meals]);

  const startSpin = useCallback(() => {
    if (meals.length < 5) return;
    setPhase('spinning');

    const plan = buildPlan();
    const names = meals.map(m => m.name);
    const newDisplay = Array(7).fill('');

    // Clear any existing intervals
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];

    // Start each column spinning, stopping sequentially
    for (let col = 0; col < 7; col++) {
      let tick = 0;
      const speed = 60 + col * 8; // slightly slower each column
      const stopAt = 15 + col * 8; // staggered stop times

      const interval = setInterval(() => {
        tick++;
        if (tick >= stopAt) {
          // Stop this column — show final result
          clearInterval(interval);
          setDisplayNames(prev => {
            const next = [...prev];
            next[col] = plan[col].name;
            return next;
          });
          setColumns(prev => {
            const next = [...prev];
            next[col] = plan[col];
            return next;
          });
          // If last column, mark done
          if (col === 6) {
            setTimeout(() => setPhase('done'), 400);
          }
        } else {
          // Cycle through random names
          const randomName = names[Math.floor(Math.random() * names.length)];
          setDisplayNames(prev => {
            const next = [...prev];
            next[col] = randomName;
            return next;
          });
        }
      }, speed);

      intervalsRef.current.push(interval);
    }
  }, [meals, buildPlan]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => intervalsRef.current.forEach(clearInterval);
  }, []);

  const handleAccept = () => {
    if (columns.every(Boolean)) {
      onComplete(columns);
    }
  };

  return (
    <div className="spinner-overlay" onClick={phase === 'ready' ? onClose : undefined}>
      <div className="spinner-container" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="spinner-header">
          <h2 className="spinner-title">
            {phase === 'ready' && 'Meal Spinner'}
            {phase === 'spinning' && 'Spinning...'}
            {phase === 'done' && 'Your Week!'}
          </h2>
          <button className="spinner-close" onClick={onClose}>&#10005;</button>
        </div>

        {/* Slot machine display */}
        <div className="spinner-slots">
          {DAY_LABELS.map((day, i) => {
            const isResolved = phase === 'done' || (columns[i] !== null && phase !== 'ready');
            const isSpinning = phase === 'spinning' && columns[i] === null;
            return (
              <div key={i} className={`spinner-slot ${isResolved ? 'resolved' : ''} ${isSpinning ? 'spinning' : ''}`}>
                <span className="spinner-slot-day">{day}</span>
                <div className={`spinner-slot-reel ${isSpinning ? 'cycling' : ''}`}>
                  <span className="spinner-slot-meal">
                    {phase === 'ready' ? '?' : (displayNames[i] || '...')}
                  </span>
                </div>
                {isResolved && columns[i]?.imageUrl && (
                  <img
                    src={columns[i].imageUrl}
                    alt=""
                    className="spinner-slot-img"
                    onError={e => e.target.style.display = 'none'}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="spinner-actions">
          {phase === 'ready' && (
            <button className="spinner-btn primary" onClick={startSpin}>
              Spin!
            </button>
          )}
          {phase === 'spinning' && (
            <div className="spinner-waiting">
              <div className="browser-spinner large" />
            </div>
          )}
          {phase === 'done' && (
            <>
              <button className="spinner-btn primary" onClick={handleAccept}>
                Use This Week
              </button>
              <button className="spinner-btn secondary" onClick={() => { setPhase('ready'); setColumns(Array(7).fill(null)); setDisplayNames(Array(7).fill('')); }}>
                Spin Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
