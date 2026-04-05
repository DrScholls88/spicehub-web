import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * MealSpinner — Animated slot-machine style meal randomizer.
 *
 * Shows spinning columns (one per selected day) that resolve to meals.
 * Each column cycles through meal names with easing, stopping sequentially.
 *
 * Now uses "The Rotation" meals only. Falls back to all meals if rotation is empty.
 *
 * Props:
 *   meals              - Array of all meals
 *   rotationMeals      - Array of meals in The Rotation (preferred pool)
 *   currentPlan        - Current week plan (to preserve locked meals)
 *   onComplete         - callback(plan[7]) when spin finishes — array of 7 meals
 *   onClose            - callback() to dismiss without applying
 *   selectedDayIndices - Optional array of 0-6 indices (e.g., [0,2,4] for Mon,Wed,Fri)
 *                       If provided and non-empty, only spin those days.
 *                       If null/undefined/empty, default to all 7 days.
 */
export default function MealSpinner({
  meals,
  rotationMeals,
  currentPlan,
  onComplete,
  onClose,
  selectedDayIndices
}) {
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Compute active day indices
  const activeDayIndices = (selectedDayIndices && selectedDayIndices.length > 0)
    ? selectedDayIndices
    : [0, 1, 2, 3, 4, 5, 6];
  const numSlots = activeDayIndices.length;

  const [phase, setPhase] = useState('ready');     // 'ready' | 'spinning' | 'done'
  const [columns, setColumns] = useState(Array(numSlots).fill(null)); // final picks for slots
  const [displayNames, setDisplayNames] = useState(Array(numSlots).fill('')); // cycling display
  const [fullPlan, setFullPlan] = useState(null); // full 7-element plan when done
  const intervalsRef = useRef([]);

  // Determine the pool: rotation meals if we have enough, else all meals
  const pool = (rotationMeals && rotationMeals.length >= 5)
    ? rotationMeals
    : meals;

  const usingRotation = rotationMeals && rotationMeals.length >= 5;

  // Build the final plan, preserving locked meals
  // Always returns array[7], but only fills activeDayIndices
  const buildPlan = useCallback(() => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const result = Array(7).fill(null);
    let pickCount = 0;

    activeDayIndices.forEach((dayIdx) => {
      if (currentPlan && currentPlan[dayIdx] && currentPlan[dayIdx]._locked) {
        result[dayIdx] = currentPlan[dayIdx];
      } else {
        result[dayIdx] = shuffled[pickCount % shuffled.length];
        pickCount++;
      }
    });

    return result;
  }, [pool, currentPlan, activeDayIndices]);

  const startSpin = useCallback(() => {
    if (pool.length < Math.max(1, Math.min(5, numSlots))) return;

    setPhase('spinning');
    const plan = buildPlan();
    setFullPlan(plan); // store full plan for later
    const names = pool.map(m => m.name);

    // Clear any existing intervals
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];

    // Start each slot spinning, stopping sequentially
    for (let slotIdx = 0; slotIdx < numSlots; slotIdx++) {
      const dayIdx = activeDayIndices[slotIdx];
      let tick = 0;
      const speed = 60 + slotIdx * 8;
      const stopAt = 15 + slotIdx * 8;

      const interval = setInterval(() => {
        tick++;
        if (tick >= stopAt) {
          clearInterval(interval);
          setDisplayNames(prev => {
            const next = [...prev];
            next[slotIdx] = plan[dayIdx]?.name || '';
            return next;
          });
          setColumns(prev => {
            const next = [...prev];
            next[slotIdx] = plan[dayIdx];
            return next;
          });
          if (slotIdx === numSlots - 1) {
            setTimeout(() => setPhase('done'), 400);
          }
        } else {
          const randomName = names[Math.floor(Math.random() * names.length)];
          setDisplayNames(prev => {
            const next = [...prev];
            next[slotIdx] = randomName;
            return next;
          });
        }
      }, speed);

      intervalsRef.current.push(interval);
    }
  }, [pool, buildPlan, numSlots, activeDayIndices]);

  // Reset state when numSlots changes (selectedDayIndices changed)
  useEffect(() => {
    setPhase('ready');
    setColumns(Array(numSlots).fill(null));
    setDisplayNames(Array(numSlots).fill(''));
    setFullPlan(null);
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];
  }, [numSlots]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => intervalsRef.current.forEach(clearInterval);
  }, []);

  const handleAccept = () => {
    if (fullPlan) {
      onComplete(fullPlan);
    }
  };

  return (
    <div className="spinner-container inline" onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="spinner-header">
        <h2 className="spinner-title">
          {phase === 'ready' && (numSlots === 7 ? 'Meal Spinner' : `Spin ${numSlots} Days`)}
          {phase === 'spinning' && 'Spinning...'}
          {phase === 'done' && (numSlots === 7 ? 'Your Week!' : 'Your Picks!')}
        </h2>
        {phase === 'ready' && <button className="spinner-close" onClick={onClose}>&#10005;</button>}
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
      <div className="spinner-slots" style={{
        gridTemplateColumns: `repeat(${numSlots}, 1fr)`,
      }}>
        {activeDayIndices.map((dayIdx, slotIdx) => {
          const isResolved = phase === 'done' || (columns[slotIdx] !== null && phase !== 'ready');
          const isSpinning = phase === 'spinning' && columns[slotIdx] === null;
          return (
            <div key={dayIdx} className={`spinner-slot ${isResolved ? 'resolved' : ''} ${isSpinning ? 'spinning' : ''}`}>
              <span className="spinner-slot-day">{DAY_LABELS[dayIdx]}</span>
              <div className={`spinner-slot-reel ${isSpinning ? 'cycling' : ''}`}>
                <span className="spinner-slot-meal">
                  {phase === 'ready' ? '?' : (displayNames[slotIdx] || '...')}
                </span>
              </div>
              {isResolved && columns[slotIdx]?.imageUrl && (
                <img
                  src={columns[slotIdx].imageUrl}
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
          <button
            className="spinner-btn primary"
            onClick={startSpin}
            disabled={pool.length < Math.max(1, Math.min(5, numSlots))}
          >
            {pool.length < Math.max(1, Math.min(5, numSlots))
              ? `Need ${Math.max(1, Math.min(5, numSlots)) - pool.length} more meals`
              : '🎲 Spin My Week!'}
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
              ✓ Keep These
            </button>
            <button
              className="spinner-btn secondary"
              onClick={() => {
                setPhase('ready');
                setColumns(Array(numSlots).fill(null));
                setDisplayNames(Array(numSlots).fill(''));
                setFullPlan(null);
              }}
            >
              🔄 Spin Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
