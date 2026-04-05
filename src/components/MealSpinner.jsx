import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * MealSpinner — Animated slot-machine meal randomizer.
 *
 * Props:
 *   meals              - All meals
 *   rotationMeals      - Rotation meals (preferred pool if ≥5)
 *   currentPlan        - Current week plan (preserves locked meals)
 *   onComplete         - callback(plan[7]) — full week array, nulls at unselected
 *   onClose            - dismiss without applying
 *   selectedDayIndices - Optional int[] (0-6). Omit/null = all 7.
 *   slotDates          - Optional Date[] parallel to activeDayIndices (for display)
 */

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatSlotDate(date) {
  if (!date) return '';
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

// Inject spinner-specific animations once
const SPIN_CSS = `
  @keyframes sp-reelScroll {
    0%   { transform: translateY(0); }
    100% { transform: translateY(-300px); }
  }
  @keyframes sp-slotFadeIn {
    from { opacity: 0; transform: translateY(12px) scale(0.94); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes sp-resolvePopIn {
    0%   { transform: scale(0.85); opacity: 0.4; }
    60%  { transform: scale(1.06); }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes sp-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200%  0; }
  }
  @keyframes sp-titleBounce {
    0%,100% { transform: translateY(0); }
    40%     { transform: translateY(-4px); }
    70%     { transform: translateY(2px); }
  }
  @keyframes sp-glow {
    0%,100% { box-shadow: 0 0 0 0 rgba(230,81,0,0); }
    50%     { box-shadow: 0 0 0 6px rgba(230,81,0,0.25); }
  }
  @keyframes sp-confettiFall {
    0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
    100% { transform: translateY(60px)  rotate(360deg); opacity: 0; }
  }
`;

// Simple confetti pieces
const CONFETTI_COLORS = ['#e65100','#ff833a','#2e7d32','#1565c0','#7b1fa2','#f59e0b'];

function ConfettiPiece({ i }) {
  const style = useMemo(() => ({
    position: 'absolute',
    top: 0,
    left: `${10 + (i * 13) % 80}%`,
    width: 7, height: 7,
    borderRadius: i % 2 === 0 ? '50%' : 2,
    background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    animation: `sp-confettiFall ${0.8 + (i * 0.12) % 0.6}s ease-out ${(i * 0.08) % 0.4}s forwards`,
    pointerEvents: 'none',
  }), [i]);
  return <div style={style} />;
}

export default function MealSpinner({
  meals,
  rotationMeals,
  currentPlan,
  onComplete,
  onClose,
  selectedDayIndices,
  slotDates,
}) {
  // Inject CSS once
  useEffect(() => {
    if (document.getElementById('sp-anim-style')) return;
    const s = document.createElement('style');
    s.id = 'sp-anim-style';
    s.textContent = SPIN_CSS;
    document.head.appendChild(s);
  }, []);

  // Determine active day indices
  const activeDayIndices = useMemo(() =>
    (selectedDayIndices && selectedDayIndices.length > 0)
      ? selectedDayIndices
      : [0,1,2,3,4,5,6],
  [selectedDayIndices]);

  const numSlots = activeDayIndices.length;

  const [phase, setPhase]               = useState('ready');
  const [columns, setColumns]           = useState(() => Array(numSlots).fill(null));
  const [displayNames, setDisplayNames] = useState(() => Array(numSlots).fill(''));
  const [fullPlan, setFullPlan]         = useState(null);
  const [resolvedSlots, setResolvedSlots] = useState(() => Array(numSlots).fill(false));
  const intervalsRef = useRef([]);

  const pool = (rotationMeals && rotationMeals.length >= 5) ? rotationMeals : meals;
  const usingRotation = rotationMeals && rotationMeals.length >= 5;
  const minNeeded = Math.max(1, Math.min(5, numSlots));

  // Build full 7-element plan, preserving locked meals
  const buildPlan = useCallback(() => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const result = Array(7).fill(null);
    let pickCount = 0;
    activeDayIndices.forEach(dayIdx => {
      if (currentPlan?.[dayIdx]?._locked) {
        result[dayIdx] = currentPlan[dayIdx];
      } else {
        result[dayIdx] = shuffled[pickCount % shuffled.length];
        pickCount++;
      }
    });
    return result;
  }, [pool, currentPlan, activeDayIndices]);

  const startSpin = useCallback(() => {
    if (pool.length < minNeeded) return;
    setPhase('spinning');
    setResolvedSlots(Array(numSlots).fill(false));
    const plan = buildPlan();
    setFullPlan(plan);
    const names = pool.map(m => m.name);

    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];

    for (let slotIdx = 0; slotIdx < numSlots; slotIdx++) {
      const dayIdx = activeDayIndices[slotIdx];
      let tick = 0;
      const speed  = 55 + slotIdx * 10;
      const stopAt = 18 + slotIdx * 9;
      const interval = setInterval(() => {
        tick++;
        if (tick >= stopAt) {
          clearInterval(interval);
          const finalName = plan[dayIdx]?.name || '';
          setDisplayNames(prev => { const n=[...prev]; n[slotIdx]=finalName; return n; });
          setColumns(prev =>      { const n=[...prev]; n[slotIdx]=plan[dayIdx]; return n; });
          setResolvedSlots(prev => { const n=[...prev]; n[slotIdx]=true; return n; });
          if (slotIdx === numSlots - 1) {
            setTimeout(() => setPhase('done'), 500);
          }
        } else {
          const rnd = names[Math.floor(Math.random() * names.length)];
          setDisplayNames(prev => { const n=[...prev]; n[slotIdx]=rnd; return n; });
        }
      }, speed);
      intervalsRef.current.push(interval);
    }
  }, [pool, buildPlan, numSlots, activeDayIndices, minNeeded]);

  // Reset when numSlots changes
  useEffect(() => {
    setPhase('ready');
    setColumns(Array(numSlots).fill(null));
    setDisplayNames(Array(numSlots).fill(''));
    setResolvedSlots(Array(numSlots).fill(false));
    setFullPlan(null);
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];
  }, [numSlots]);

  useEffect(() => () => intervalsRef.current.forEach(clearInterval), []);

  const handleAccept = () => { if (fullPlan) onComplete(fullPlan); };

  const handleSpinAgain = () => {
    setPhase('ready');
    setColumns(Array(numSlots).fill(null));
    setDisplayNames(Array(numSlots).fill(''));
    setResolvedSlots(Array(numSlots).fill(false));
    setFullPlan(null);
  };

  // Slot grid layout — narrower for many slots, bigger for few
  const slotMinW = numSlots <= 3 ? 90 : numSlots <= 5 ? 70 : 52;

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: 'var(--card)',
        borderRadius: 24,
        boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
        width: '100%',
        maxWidth: 560,
        maxHeight: '88vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        animation: 'sp-slotFadeIn 0.3s cubic-bezier(0.32,0.72,0,1) both',
        position: 'relative',
      }}
    >
      {/* Confetti (done phase) */}
      {phase === 'done' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 80,
          overflow: 'hidden', pointerEvents: 'none', zIndex: 10 }}>
          {Array.from({ length: 18 }, (_, i) => <ConfettiPiece key={i} i={i} />)}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 20px 0',
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--text)',
            animation: phase === 'done' ? 'sp-titleBounce 0.5s ease both' : undefined,
          }}>
            {phase === 'ready'   && (numSlots === 7 ? '🎰 Meal Spinner' : `🎰 Spin ${numSlots} Day${numSlots !== 1 ? 's' : ''}`)}
            {phase === 'spinning' && '⚡ Spinning...'}
            {phase === 'done'    && (numSlots === 7 ? '🎉 Your Week!' : '🎉 Your Picks!')}
          </h2>
          {phase === 'ready' && (
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {numSlots < 7
                ? `${numSlots} day${numSlots !== 1 ? 's' : ''} selected`
                : 'Full week spin'}
            </p>
          )}
        </div>
        {phase !== 'spinning' && (
          <button onClick={onClose} style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none',
            background: 'var(--surface)', color: 'var(--text-light)',
            fontSize: 17, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>✕</button>
        )}
      </div>

      {/* ── Source badge ── */}
      <div style={{ padding: '10px 20px 0' }}>
        {usingRotation ? (
          <span style={SOURCE_BADGE_ROT}>🔄 The Rotation · {rotationMeals.length} meals</span>
        ) : (
          <span style={SOURCE_BADGE_ALL}>
            {rotationMeals?.length > 0 && rotationMeals.length < 5
              ? `⚠️ Need 5+ in Rotation (have ${rotationMeals.length})`
              : '📚 All meals'}
          </span>
        )}
      </div>

      {/* ── Slot grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${numSlots}, minmax(${slotMinW}px, 1fr))`,
        gap: 6,
        padding: '16px 16px 8px',
        overflowX: numSlots > 5 ? 'auto' : undefined,
      }}>
        {activeDayIndices.map((dayIdx, slotIdx) => {
          const isResolved = resolvedSlots[slotIdx];
          const isSpinning = phase === 'spinning' && !isResolved;
          const meal = columns[slotIdx];
          const slotDate = slotDates?.[slotIdx];

          return (
            <div
              key={dayIdx}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                background: isResolved
                  ? 'linear-gradient(160deg, rgba(230,81,0,0.07), rgba(255,131,58,0.05))'
                  : 'var(--surface)',
                border: isResolved ? '1.5px solid rgba(230,81,0,0.25)' : '1.5px solid var(--border)',
                borderRadius: 14,
                padding: '10px 6px',
                minWidth: slotMinW,
                transition: 'all 0.3s ease',
                animation: slotIdx < 7
                  ? `sp-slotFadeIn 0.35s ${slotIdx * 0.04}s both ease`
                  : undefined,
                boxShadow: isResolved ? '0 4px 16px rgba(230,81,0,0.1)' : undefined,
              }}
            >
              {/* Day label */}
              <span style={{
                fontSize: 11, fontWeight: 800, letterSpacing: '0.5px',
                color: 'var(--primary)', textTransform: 'uppercase', marginBottom: 2,
              }}>
                {DAY_LABELS[dayIdx]}
              </span>

              {/* Date label */}
              {slotDate && (
                <span style={{
                  fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6,
                }}>
                  {formatSlotDate(slotDate)}
                </span>
              )}

              {/* Reel / display */}
              <div style={{
                width: '100%', minHeight: 52,
                background: isSpinning
                  ? `linear-gradient(90deg, var(--surface) 25%, var(--border) 50%, var(--surface) 75%)`
                  : 'transparent',
                backgroundSize: isSpinning ? '200% 100%' : undefined,
                animation: isSpinning ? 'sp-shimmer 1s linear infinite' : undefined,
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
                border: isSpinning ? '1px solid var(--border)' : undefined,
                padding: '4px 2px',
                transition: 'all 0.25s ease',
              }}>
                {phase === 'ready' ? (
                  <span style={{ fontSize: 22, opacity: 0.35 }}>?</span>
                ) : (
                  <span style={{
                    fontSize: numSlots <= 3 ? 12 : 10,
                    fontWeight: 700,
                    color: isResolved ? 'var(--text)' : 'var(--text-muted)',
                    textAlign: 'center',
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    animation: isResolved ? 'sp-resolvePopIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' : undefined,
                    padding: '0 2px',
                  }}>
                    {displayNames[slotIdx] || '…'}
                  </span>
                )}
              </div>

              {/* Meal image (resolved) */}
              {isResolved && meal?.imageUrl && (
                <div style={{ width: '100%', marginTop: 6, borderRadius: 8, overflow: 'hidden' }}>
                  <img
                    src={meal.imageUrl} alt=""
                    style={{
                      width: '100%', height: numSlots <= 4 ? 56 : 40,
                      objectFit: 'cover', display: 'block',
                      animation: 'sp-resolvePopIn 0.4s 0.1s ease both',
                    }}
                    onError={e => e.target.style.display = 'none'}
                  />
                </div>
              )}

              {/* Resolved checkmark */}
              {isResolved && (
                <div style={{
                  marginTop: 6, width: 18, height: 18, borderRadius: '50%',
                  background: 'var(--primary)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  animation: 'sp-resolvePopIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
                }}>
                  <span style={{ color: 'white', fontSize: 11, fontWeight: 900 }}>✓</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Actions ── */}
      <div style={{ padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phase === 'ready' && (
          <>
            <button
              onClick={startSpin}
              disabled={pool.length < minNeeded}
              style={{
                padding: '15px', borderRadius: 14, border: 'none',
                background: pool.length < minNeeded
                  ? 'var(--border)'
                  : 'linear-gradient(135deg, var(--primary), var(--primary-light))',
                color: pool.length < minNeeded ? 'var(--text-muted)' : 'white',
                fontSize: 16, fontWeight: 800, cursor: pool.length < minNeeded ? 'not-allowed' : 'pointer',
                boxShadow: pool.length >= minNeeded ? '0 4px 20px rgba(230,81,0,0.35)' : undefined,
                transition: 'transform 0.1s, box-shadow 0.2s',
                animation: pool.length >= minNeeded ? 'sp-glow 2s ease infinite' : undefined,
              }}
            >
              {pool.length < minNeeded
                ? `Need ${minNeeded - pool.length} more meal${minNeeded - pool.length !== 1 ? 's' : ''}`
                : `🎲 Let's Spin!`}
            </button>
          </>
        )}

        {phase === 'spinning' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '8px 0',
          }}>
            <SpinnerDots />
            <span style={{ fontSize: 14, color: 'var(--text-light)', fontWeight: 600 }}>
              Picking your meals…
            </span>
          </div>
        )}

        {phase === 'done' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleAccept} style={{
              flex: 2, padding: '15px', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, var(--primary), var(--primary-light))',
              color: 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(230,81,0,0.35)',
              animation: 'sp-slotFadeIn 0.3s 0.1s ease both',
            }}>
              ✓ Keep These
            </button>
            <button onClick={handleSpinAgain} style={{
              flex: 1, padding: '15px', borderRadius: 14,
              border: '1.5px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              animation: 'sp-slotFadeIn 0.3s 0.18s ease both',
            }}>
              🔄 Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Animated loading dots ─────────────────────────────────────────────────────
function SpinnerDots() {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--primary)',
          animation: `sp-titleBounce 0.7s ${i * 0.12}s ease infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Shared badge styles ───────────────────────────────────────────────────────
const SOURCE_BADGE_ROT = {
  display: 'inline-block',
  padding: '4px 10px', borderRadius: 20,
  background: 'rgba(46,125,50,0.1)', color: '#2e7d32',
  fontSize: 11, fontWeight: 700, border: '1px solid rgba(46,125,50,0.2)',
};
const SOURCE_BADGE_ALL = {
  display: 'inline-block',
  padding: '4px 10px', borderRadius: 20,
  background: 'var(--surface)', color: 'var(--text-muted)',
  fontSize: 11, fontWeight: 600, border: '1px solid var(--border)',
};
