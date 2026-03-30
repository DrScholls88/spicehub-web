import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * MealSpinner — Animated slot-machine style meal randomizer.
 *
 * Shows 7 spinning columns (one per day) that resolve to meals.
 * Each column cycles through meal names with easing, stopping sequentially.
 *
 * Now uses "The Rotation" meals only. Falls back to all meals if rotation is empty.
 *
 * Props:
 *   meals         - Array of all meals
 *   rotationMeals - Array of meals in The Rotation (preferred pool)
 *   onComplete    - callback(plan[7]) when spin finishes — array of 7 meals
 *   onClose       - callback() to dismiss without applying
 */
export default function MealSpinner({ meals, rotationMeals, onComplete, onClose }) {
  const [phase, setPhase] = useState('ready');     // 'ready' | 'spinning' | 'done'
  const [columns, setColumns] = useState(Array(7).fill(null)); // final picks
  const [displayNames, setDisplayNames] = useState(Array(7).fill('')); // cycling display
  const intervalsRef = useRef([]);
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Determine the pool: rotation meals if we have enough, else all meals
  const pool = (rotationMeals && rotationMeals.length >= 5)
    ? rotationMeals
    : meals;

  const usingRotation = rotationMeals && rotationMeals.length >= 5;

  // Build the final plan
  const buildPlan = useCallback(() => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return Array.from({ length: 7 }, (_, i) => shuffled[i % shuffled.length]);
  }, [pool]);

  const startSpin = useCallback(() => {
    if (pool.length < 5) return;
    setPhase('spinning');

    const plan = buildPlan();
    const names = pool.map(m => m.name);
    const newDisplay = Array(7).fill('');

    // Clear any existing intervals
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];

    // Start each column spinning, stopping sequentially
    for (let col = 0; col < 7; col++) {
      let tick = 0;
      const speed = 60 + col * 8;
      const stopAt = 15 + col * 8;

      const interval = setInterval(() => {
        tick++;
        if (tick >= stopAt) {
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
          if (col === 6) {
            setTimeout(() => setPhase('done'), 400);
          }
        } else {
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
  }, [pool, buildPlan]);

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

        {/* Source indicator */}
        <div className="spinner-source">
          {usingRotation ? (
            <span className="spinner-source-badge rotation">🔄 From The Rotation ({rotationMeals.length} meals)</span>
          ) : (
            <span className="spinner-source-badge all">
              {rotationMeals && rotationMeals.length > 0 && rotationMeals.length < 5
                ? `⚠️ Need 5+ in Rotation (have ${rotationMeals.length}) — using all meals`
                : '📚 Using all meals (add 5+ to The Rotation to filter)'}
            </span>
          )}
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
            <button className="spinner-btn primary" onClick={startSpin} disabled={pool.length < 5}>
              {pool.length < 5 ? `Need ${5 - pool.length} more meals` : 'Spin!'}
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
