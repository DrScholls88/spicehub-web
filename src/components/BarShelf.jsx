import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

/**
 * Retro 16-bit style back-bar with animated bartender behind a bar top.
 * Layout: Backbar (paginated bottle shelves) → Bar Top (bartender stands behind, wipes)
 * Tap a bottle → bartender shuffles over, grabs it, presents the detail card.
 * Dismiss → bartender puts it back and returns to wiping the bar.
 */

// Bottle shape + color mapping based on spirit type keywords
const BOTTLE_STYLES = [
  { keywords: ['vodka'], shape: 'tall', color: '#c8d8e4', label: '#2196f3', cap: '#666' },
  { keywords: ['gin'], shape: 'tall', color: '#c8e6c9', label: '#388e3c', cap: '#555' },
  { keywords: ['rum', 'bacardi'], shape: 'round', color: '#795548', label: '#ffcc02', cap: '#4e342e' },
  { keywords: ['whiskey', 'bourbon', 'rye', 'scotch'], shape: 'square', color: '#a1887f', label: '#ff8f00', cap: '#5d4037' },
  { keywords: ['tequila', 'mezcal'], shape: 'tall', color: '#fff9c4', label: '#f57f17', cap: '#827717' },
  { keywords: ['wine', 'champagne', 'prosecco'], shape: 'wine', color: '#7b1fa2', label: '#e1bee7', cap: '#4a148c' },
  { keywords: ['beer', 'ale', 'lager', 'stout', 'ipa'], shape: 'beer', color: '#ffb74d', label: '#e65100', cap: '#bf360c' },
  { keywords: ['triple sec', 'cointreau', 'curacao', 'liqueur', 'kahlua', 'baileys', 'amaretto'], shape: 'round', color: '#ff8a65', label: '#bf360c', cap: '#4e342e' },
  { keywords: ['bitters', 'angostura'], shape: 'mini', color: '#ffcc02', label: '#e65100', cap: '#5d4037' },
  { keywords: ['vermouth'], shape: 'tall', color: '#a5d6a7', label: '#1b5e20', cap: '#2e7d32' },
  { keywords: ['soda', 'tonic', 'ginger beer', 'juice', 'syrup', 'grenadine'], shape: 'can', color: '#e0e0e0', label: '#424242', cap: '#9e9e9e' },
  { keywords: ['cognac', 'brandy'], shape: 'round', color: '#a1887f', label: '#e65100', cap: '#5d4037' },
  { keywords: ['absinthe'], shape: 'tall', color: '#a5d6a7', label: '#2e7d32', cap: '#1b5e20' },
  { keywords: ['coffee', 'espresso', 'irish'], shape: 'round', color: '#5d4037', label: '#ffcc02', cap: '#3e2723' },
];

function getBottleStyle(drink) {
  const name = (drink.name + ' ' + (drink.ingredients || []).join(' ')).toLowerCase();
  for (const style of BOTTLE_STYLES) {
    if (style.keywords.some(kw => name.includes(kw))) return style;
  }
  return { shape: 'round', color: '#ce93d8', label: '#6a1b9a', cap: '#4a148c' };
}

// Pixel-art SVG bottle renderer
function PixelBottle({ style, size = 48, glow = false }) {
  const s = size;
  const { shape, color, label, cap } = style;

  if (shape === 'tall') {
    return (
      <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="7" y="0" width="6" height="3" fill={cap} rx="0" />
        <rect x="8" y="3" width="4" height="6" fill={color} />
        <rect x="4" y="9" width="12" height="24" fill={color} rx="1" />
        <rect x="5" y="14" width="10" height="10" fill={label} rx="0" />
        <rect x="5" y="10" width="2" height="16" fill="rgba(255,255,255,0.25)" />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="8" y="0" width="6" height="3" fill={cap} />
        <rect x="9" y="3" width="4" height="5" fill={color} />
        <rect x="3" y="8" width="16" height="25" fill={color} rx="1" />
        <rect x="5" y="13" width="12" height="8" fill={label} />
        <rect x="4" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
      </svg>
    );
  }
  if (shape === 'round') {
    return (
      <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="8" y="0" width="6" height="3" fill={cap} />
        <rect x="9" y="3" width="4" height="5" fill={color} />
        <rect x="4" y="8" width="14" height="25" fill={color} rx="3" />
        <rect x="6" y="14" width="10" height="10" fill={label} rx="1" />
        <rect x="5" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
      </svg>
    );
  }
  if (shape === 'wine') {
    return (
      <svg width={s * 0.5} height={s} viewBox="0 0 18 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="7" y="0" width="4" height="3" fill={cap} />
        <rect x="7" y="3" width="4" height="10" fill={color} />
        <rect x="3" y="13" width="12" height="20" fill={color} rx="2" />
        <rect x="5" y="17" width="8" height="8" fill={label} rx="1" />
        <rect x="4" y="14" width="2" height="18" fill="rgba(255,255,255,0.15)" />
      </svg>
    );
  }
  if (shape === 'beer') {
    return (
      <svg width={s * 0.55} height={s * 0.85} viewBox="0 0 18 30" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="6" y="0" width="6" height="3" fill={cap} />
        <rect x="7" y="3" width="4" height="4" fill={color} />
        <rect x="4" y="7" width="10" height="20" fill={color} rx="1" />
        <rect x="5" y="10" width="8" height="8" fill={label} rx="0" />
        <rect x="5" y="8" width="2" height="18" fill="rgba(255,255,255,0.25)" />
      </svg>
    );
  }
  if (shape === 'mini') {
    return (
      <svg width={s * 0.4} height={s * 0.7} viewBox="0 0 14 24" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="5" y="0" width="4" height="2" fill={cap} />
        <rect x="5" y="2" width="4" height="4" fill={color} />
        <rect x="2" y="6" width="10" height="16" fill={color} rx="1" />
        <rect x="3" y="9" width="8" height="6" fill={label} />
        <rect x="3" y="7" width="2" height="14" fill="rgba(255,255,255,0.2)" />
      </svg>
    );
  }
  if (shape === 'can') {
    return (
      <svg width={s * 0.45} height={s * 0.65} viewBox="0 0 16 22" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        <rect x="2" y="0" width="12" height="22" fill={color} rx="2" />
        <rect x="3" y="1" width="10" height="3" fill={cap} rx="1" />
        <rect x="4" y="7" width="8" height="8" fill={label} rx="0" />
        <rect x="3" y="2" width="2" height="18" fill="rgba(255,255,255,0.2)" />
      </svg>
    );
  }
  return (
    <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
      <rect x="7" y="0" width="6" height="3" fill={cap} />
      <rect x="8" y="3" width="4" height="6" fill={color} />
      <rect x="4" y="9" width="12" height="24" fill={color} rx="2" />
      <rect x="6" y="14" width="8" height="8" fill={label} />
    </svg>
  );
}

// Neon sign text component
function NeonText({ text, color = '#ff4081' }) {
  return (
    <span
      className="bs-neon-text"
      style={{
        color,
        textShadow: `0 0 4px ${color}, 0 0 8px ${color}, 0 0 16px ${color}40`,
      }}
    >
      {text}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PIXEL ART BARTENDER — Old-timey character with state-driven animations
// States: idle (wiping bar), walking, grabbing, presenting, returning
// ══════════════════════════════════════════════════════════════════════════════

function PixelBartender({ state, holdingBottle, facingRight }) {
  const flip = facingRight ? '' : 'scale(-1,1)';
  const isWalking = state === 'walking' || state === 'returning';
  const isGrabbing = state === 'grabbing';
  const isPresenting = state === 'presenting';
  const isIdle = state === 'idle';

  return (
    <svg
      width="120" height="168" viewBox="0 0 40 56"
      className={`bs-bartender-svg ${isWalking ? 'bs-bt-walk' : ''} ${isPresenting ? 'bs-bt-present' : ''}`}
      style={{ imageRendering: 'pixelated' }}
    >
      <g transform={`translate(20,0) ${flip} translate(-20,0)`}>
        {/* Hat (bowler hat) */}
        <rect x="10" y="0" width="20" height="4" fill="#1a1a1a" />
        <rect x="8" y="4" width="24" height="3" fill="#1a1a1a" />
        <rect x="12" y="1" width="16" height="6" fill="#2a2a2a" />

        {/* Head */}
        <rect x="13" y="7" width="14" height="12" fill="#e8b88a" />
        {/* Eyes */}
        <rect x="15" y="11" width="3" height="3" fill="#333" />
        <rect x="22" y="11" width="3" height="3" fill="#333" />
        {/* Eye shine */}
        <rect x="16" y="11" width="1" height="1" fill="#fff" />
        <rect x="23" y="11" width="1" height="1" fill="#fff" />
        {/* Blink animation on idle */}
        {isIdle && <rect x="15" y="11" width="3" height="1" fill="#e8b88a" className="bs-bt-blink" />}
        {isIdle && <rect x="22" y="11" width="3" height="1" fill="#e8b88a" className="bs-bt-blink" />}
        {/* Mustache */}
        <rect x="14" y="15" width="5" height="2" fill="#4a3520" />
        <rect x="21" y="15" width="5" height="2" fill="#4a3520" />
        <rect x="17" y="16" width="6" height="1" fill="#4a3520" />

        {/* Bow tie */}
        <rect x="16" y="19" width="3" height="3" fill="#c62828" />
        <rect x="21" y="19" width="3" height="3" fill="#c62828" />
        <rect x="19" y="20" width="2" height="1" fill="#e53935" />

        {/* Body (vest + shirt) */}
        <rect x="12" y="22" width="16" height="16" fill="#333" />
        {/* Vest buttons */}
        <rect x="19" y="24" width="2" height="2" fill="#ffd700" />
        <rect x="19" y="28" width="2" height="2" fill="#ffd700" />
        <rect x="19" y="32" width="2" height="2" fill="#ffd700" />
        {/* White shirt visible */}
        <rect x="17" y="22" width="6" height="16" fill="#f5f5f5" />
        <rect x="19" y="24" width="2" height="2" fill="#ffd700" />
        <rect x="19" y="28" width="2" height="2" fill="#ffd700" />
        <rect x="19" y="32" width="2" height="2" fill="#ffd700" />

        {/* Arms */}
        {isIdle ? (
          <>
            {/* Wiping animation - arm moves back and forth */}
            <rect x="4" y="24" width="8" height="4" fill="#333" className="bs-bt-wipe-arm" />
            <rect x="4" y="28" width="4" height="3" fill="#e8b88a" className="bs-bt-wipe-arm" />
            <rect x="28" y="24" width="8" height="4" fill="#333" />
            <rect x="32" y="28" width="4" height="3" fill="#e8b88a" />
          </>
        ) : isGrabbing || isPresenting ? (
          <>
            {/* Arm raised to grab/present */}
            <rect x="28" y="16" width="4" height="10" fill="#333" />
            <rect x="30" y="14" width="4" height="4" fill="#e8b88a" />
            <rect x="4" y="24" width="8" height="4" fill="#333" />
            <rect x="4" y="28" width="4" height="3" fill="#e8b88a" />
          </>
        ) : (
          <>
            {/* Walking arms */}
            <rect x="4" y="24" width="8" height="4" fill="#333" />
            <rect x="4" y="28" width="4" height="3" fill="#e8b88a" />
            <rect x="28" y="24" width="8" height="4" fill="#333" />
            <rect x="32" y="28" width="4" height="3" fill="#e8b88a" />
          </>
        )}

        {/* Apron */}
        <rect x="14" y="34" width="12" height="8" fill="#f5f5f5" />
        <rect x="16" y="34" width="8" height="1" fill="#ddd" />

        {/* Legs */}
        <rect x="14" y="42" width="5" height="10" fill="#1a1a1a" />
        <rect x="21" y="42" width="5" height="10" fill="#1a1a1a" />
        {/* Shoes */}
        <rect x="12" y="52" width="7" height="4" fill="#3e2723" />
        <rect x="21" y="52" width="7" height="4" fill="#3e2723" />
      </g>

      {/* Held bottle (when grabbing/presenting) */}
      {holdingBottle && (isGrabbing || isPresenting) && (
        <g transform={facingRight ? 'translate(30, 6)' : 'translate(2, 6)'} className="bs-bt-held-bottle">
          <rect x="0" y="0" width="3" height="2" fill={holdingBottle.cap} />
          <rect x="0" y="2" width="3" height="3" fill={holdingBottle.color} />
          <rect x="-1" y="5" width="5" height="10" fill={holdingBottle.color} rx="1" />
          <rect x="0" y="7" width="3" height="4" fill={holdingBottle.label} />
        </g>
      )}

      {/* Rag in hand when idle */}
      {isIdle && (
        <g className="bs-bt-wipe-arm">
          <rect x="2" y="29" width="6" height="3" fill="#f5f5dc" rx="1" />
          <rect x="1" y="30" width="3" height="4" fill="#f5f5dc" rx="1" />
        </g>
      )}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BOTTLES PER PAGE — responsive
// ══════════════════════════════════════════════════════════════════════════════
const BOTTLES_PER_SHELF = 5;
const SHELVES_PER_PAGE = 3;
const BOTTLES_PER_PAGE = BOTTLES_PER_SHELF * SHELVES_PER_PAGE; // 15

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function BarShelf({ drinks, onViewDetail, onClose }) {
  const [selectedDrink, setSelectedDrink] = useState(null);
  const [bartenderState, setBartenderState] = useState('idle');
  const [bartenderX, setBartenderX] = useState(20);
  const [bartenderTargetX, setBartenderTargetX] = useState(20);
  const [facingRight, setFacingRight] = useState(true);
  const [holdingBottle, setHoldingBottle] = useState(null);
  const [swipeStartY, setSwipeStartY] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageDirection, setPageDirection] = useState('none'); // 'left' | 'right' | 'none'
  const [idleQuip, setIdleQuip] = useState(0); // cycle through idle quips

  const bottleSlotsRef = useRef({});
  const barTopRef = useRef(null);
  const animationRef = useRef(null);
  const timeoutRef = useRef(null);
  const idleTimerRef = useRef(null);

  // Idle quips the bartender says
  const QUIPS = useMemo(() => [
    'Pick a bottle!',
    'What\'ll it be?',
    'Top shelf?',
    'Try somethin\' new!',
    'Thirsty?',
    'Name your poison!',
    'Happy hour!',
  ], []);

  // Cycle idle quips
  useEffect(() => {
    if (bartenderState !== 'idle') return;
    idleTimerRef.current = setInterval(() => {
      setIdleQuip(q => (q + 1) % QUIPS.length);
    }, 5000);
    return () => clearInterval(idleTimerRef.current);
  }, [bartenderState, QUIPS.length]);

  // Paginate drinks into pages of shelves
  const totalPages = Math.max(1, Math.ceil(drinks.length / BOTTLES_PER_PAGE));
  const currentPageDrinks = useMemo(() => {
    const start = currentPage * BOTTLES_PER_PAGE;
    return drinks.slice(start, start + BOTTLES_PER_PAGE);
  }, [drinks, currentPage]);

  const shelves = useMemo(() => {
    const rows = [];
    for (let i = 0; i < currentPageDrinks.length; i += BOTTLES_PER_SHELF) {
      rows.push(currentPageDrinks.slice(i, i + BOTTLES_PER_SHELF));
    }
    // Pad to at least SHELVES_PER_PAGE rows
    while (rows.length < SHELVES_PER_PAGE) rows.push([]);
    return rows;
  }, [currentPageDrinks]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, []);

  // Page navigation
  const goToPage = useCallback((newPage) => {
    if (newPage < 0 || newPage >= totalPages || newPage === currentPage) return;
    if (bartenderState !== 'idle') return;
    setPageDirection(newPage > currentPage ? 'right' : 'left');
    setTimeout(() => {
      setCurrentPage(newPage);
      setPageDirection('none');
    }, 200);
  }, [totalPages, currentPage, bartenderState]);

  const getBottlePosition = useCallback((drinkId) => {
    const slotEl = bottleSlotsRef.current[drinkId];
    const areaEl = barTopRef.current;
    if (!slotEl || !areaEl) return 20;
    const slotRect = slotEl.getBoundingClientRect();
    const areaRect = areaEl.getBoundingClientRect();
    return slotRect.left - areaRect.left + slotRect.width / 2 - 60;
  }, []);

  const handleBottleTap = useCallback((drink) => {
    if (bartenderState !== 'idle' && bartenderState !== 'presenting') return;

    if (selectedDrink?.id === drink.id) {
      dismissDrink();
      return;
    }

    if (bartenderState === 'presenting' && selectedDrink) {
      setSelectedDrink(null);
      setBartenderState('idle');
    }

    const targetPos = getBottlePosition(drink.id);
    const bottleStyle = getBottleStyle(drink);
    setFacingRight(targetPos > bartenderX);
    setBartenderTargetX(targetPos);
    setBartenderState('walking');

    const walkTime = Math.min(800, Math.max(300, Math.abs(targetPos - bartenderX) * 3));
    const startX = bartenderX;
    const startTime = performance.now();

    const animateWalk = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / walkTime);
      const eased = 1 - Math.pow(1 - progress, 3);
      setBartenderX(startX + (targetPos - startX) * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateWalk);
      } else {
        setBartenderState('grabbing');
        setHoldingBottle(bottleStyle);

        timeoutRef.current = setTimeout(() => {
          setBartenderState('presenting');
          setSelectedDrink(drink);
          const centerX = barTopRef.current
            ? barTopRef.current.clientWidth / 2 - 60
            : 100;
          setFacingRight(true);

          const grabX = targetPos;
          const presentStart = performance.now();
          const presentTime = 400;
          const animatePresent = (pNow) => {
            const pElapsed = pNow - presentStart;
            const pProgress = Math.min(1, pElapsed / presentTime);
            const pEased = 1 - Math.pow(1 - pProgress, 3);
            setBartenderX(grabX + (centerX - grabX) * pEased);
            if (pProgress < 1) {
              animationRef.current = requestAnimationFrame(animatePresent);
            }
          };
          animationRef.current = requestAnimationFrame(animatePresent);
        }, 350);
      }
    };
    animationRef.current = requestAnimationFrame(animateWalk);
  }, [bartenderState, bartenderX, selectedDrink, getBottlePosition]);

  const dismissDrink = useCallback(() => {
    if (!selectedDrink || bartenderState !== 'presenting') return;

    const drink = selectedDrink;
    const returnPos = getBottlePosition(drink.id);
    const startX = bartenderX;

    setSelectedDrink(null);
    setFacingRight(returnPos > bartenderX);
    setBartenderState('returning');

    const returnStart = performance.now();
    const returnTime = Math.min(700, Math.max(300, Math.abs(returnPos - startX) * 3));

    const animateReturn = (now) => {
      const elapsed = now - returnStart;
      const progress = Math.min(1, elapsed / returnTime);
      const eased = 1 - Math.pow(1 - progress, 3);
      setBartenderX(startX + (returnPos - startX) * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateReturn);
      } else {
        setHoldingBottle(null);
        setBartenderState('walking');
        setFacingRight(40 < returnPos);

        const restPos = 20;
        const idleStart = performance.now();
        const idleTime = Math.min(600, Math.max(200, Math.abs(restPos - returnPos) * 3));

        const animateIdle = (iNow) => {
          const iElapsed = iNow - idleStart;
          const iProgress = Math.min(1, iElapsed / idleTime);
          const iEased = 1 - Math.pow(1 - iProgress, 3);
          setBartenderX(returnPos + (restPos - returnPos) * iEased);

          if (iProgress < 1) {
            animationRef.current = requestAnimationFrame(animateIdle);
          } else {
            setBartenderState('idle');
            setFacingRight(true);
          }
        };
        animationRef.current = requestAnimationFrame(animateIdle);
      }
    };
    animationRef.current = requestAnimationFrame(animateReturn);
  }, [selectedDrink, bartenderState, bartenderX, getBottlePosition]);

  // Swipe down on detail card to dismiss
  const handleDetailTouchStart = useCallback((e) => {
    setSwipeStartY(e.touches[0].clientY);
  }, []);

  const handleDetailTouchEnd = useCallback((e) => {
    if (swipeStartY === null) return;
    const diff = e.changedTouches[0].clientY - swipeStartY;
    if (diff > 50) {
      dismissDrink();
    }
    setSwipeStartY(null);
  }, [swipeStartY, dismissDrink]);

  return (
    <div className="bs-overlay" onClick={onClose}>
      <div className="bs-container" onClick={e => e.stopPropagation()}>
        {/* Top bar */}
        <div className="bs-topbar">
          <button className="bs-back-btn" onClick={onClose}>
            <span className="bs-pixel-arrow">&larr;</span> BACK
          </button>
          <h1 className="bs-title">
            <NeonText text="MY BAR" color="#ff4081" />
          </h1>
          <div className="bs-bottle-count">
            <span className="bs-count-num">{drinks.length}</span>
            <span className="bs-count-label">bottles</span>
          </div>
        </div>

        {/* ═══ BACKBAR DISPLAY — Paginated bottle shelves ═══ */}
        <div className="bs-backbar">
          {/* Ambient back-bar glow */}
          <div className="bs-backbar-glow" />

          {/* Mirror / decorative top */}
          <div className="bs-backbar-mirror">
            <NeonText text="COCKTAILS" color="#ffcc02" />
          </div>

          {/* Bottle shelves with page transition */}
          <div className={`bs-backbar-shelves ${pageDirection !== 'none' ? `bs-page-${pageDirection}` : ''}`}>
            {shelves.map((row, shelfIdx) => (
              <div key={shelfIdx} className={`bs-shelf-row bs-shelf-wobble-${shelfIdx}`}>
                <div className="bs-bottles-row">
                  {row.map((drink) => {
                    const bottleStyle = getBottleStyle(drink);
                    const isSelected = selectedDrink?.id === drink.id;
                    return (
                      <button
                        key={drink.id}
                        ref={(el) => { if (el) bottleSlotsRef.current[drink.id] = el; }}
                        className={`bs-bottle-slot ${isSelected ? 'bs-selected' : ''}`}
                        onClick={() => handleBottleTap(drink)}
                        title={drink.name}
                      >
                        <div className="bs-bottle-idle" style={{ opacity: isSelected && holdingBottle ? 0.2 : 1 }}>
                          <PixelBottle style={bottleStyle} size={52} glow={isSelected} />
                        </div>
                        <span className="bs-bottle-label">{drink.name.length > 9 ? drink.name.slice(0, 8) + '…' : drink.name}</span>
                      </button>
                    );
                  })}
                  {row.length < BOTTLES_PER_SHELF && Array.from({ length: BOTTLES_PER_SHELF - row.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="bs-bottle-slot bs-empty-slot">
                      <div className="bs-empty-bottle" />
                    </div>
                  ))}
                </div>
                <div className="bs-shelf-plank" />
              </div>
            ))}
          </div>

          {/* Page navigation */}
          {totalPages > 1 && (
            <div className="bs-page-nav">
              <button
                className="bs-page-btn"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
              >
                ◀
              </button>
              <div className="bs-page-dots">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    className={`bs-page-dot ${i === currentPage ? 'active' : ''}`}
                    onClick={() => goToPage(i)}
                  />
                ))}
              </div>
              <button
                className="bs-page-btn"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages - 1}
              >
                ▶
              </button>
            </div>
          )}
        </div>

        {/* ═══ BAR TOP — Bartender stands behind here ═══ */}
        <div className="bs-bar-top" ref={barTopRef}>
          {/* Bar surface (wood grain) */}
          <div className="bs-bar-surface">
            {/* Coasters and decorations */}
            <div className="bs-bar-coaster bs-bar-coaster-1" />
            <div className="bs-bar-coaster bs-bar-coaster-2" />
            <div className="bs-bar-napkin" />
          </div>

          {/* Bartender behind the bar */}
          <div
            className="bs-bartender-wrap"
            style={{
              transform: `translateX(${bartenderX}px)`,
              transition: bartenderState === 'idle' ? 'transform 0.3s ease' : 'none',
            }}
          >
            <PixelBartender
              state={bartenderState}
              holdingBottle={holdingBottle}
              facingRight={facingRight}
            />
            {/* Speech bubble */}
            {bartenderState === 'presenting' && selectedDrink && (
              <div className="bs-bt-speech">
                <span>Here ya go!</span>
              </div>
            )}
            {bartenderState === 'idle' && !selectedDrink && (
              <div className="bs-bt-speech bs-bt-speech-idle">
                <span>{QUIPS[idleQuip]}</span>
              </div>
            )}
          </div>

          {/* Bar rail (front edge) */}
          <div className="bs-bar-rail" />
        </div>

        {/* Selected bottle detail card */}
        {selectedDrink && bartenderState === 'presenting' && (
          <div
            className="bs-detail-card"
            onTouchStart={handleDetailTouchStart}
            onTouchEnd={handleDetailTouchEnd}
          >
            <div className="bs-detail-swipe-hint">
              <div className="bs-detail-swipe-bar" />
              <span className="bs-detail-swipe-text">swipe down to dismiss</span>
            </div>
            <div className="bs-detail-header">
              <div className="bs-detail-bottle-preview">
                <PixelBottle style={getBottleStyle(selectedDrink)} size={72} glow />
              </div>
              <div className="bs-detail-info">
                <h3 className="bs-detail-name">{selectedDrink.name}</h3>
                <p className="bs-detail-meta">
                  {selectedDrink.category && <span className="bs-detail-cat">{selectedDrink.category}</span>}
                  {selectedDrink.ingredients && (
                    <span className="bs-detail-ing-count">{selectedDrink.ingredients.length} ingredients</span>
                  )}
                </p>
              </div>
              <button className="bs-detail-close" onClick={dismissDrink}>✕</button>
            </div>

            {selectedDrink.ingredients && (
              <div className="bs-detail-ingredients">
                {selectedDrink.ingredients.slice(0, 4).map((ing, i) => (
                  <span key={i} className="bs-ing-chip">{ing}</span>
                ))}
                {selectedDrink.ingredients.length > 4 && (
                  <span className="bs-ing-more">+{selectedDrink.ingredients.length - 4} more</span>
                )}
              </div>
            )}

            <div className="bs-detail-actions">
              <button
                className="bs-action-btn bs-action-view"
                onClick={() => onViewDetail(selectedDrink)}
              >
                VIEW RECIPE
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {drinks.length === 0 && (
          <div className="bs-empty-bar">
            <span className="bs-empty-neon">
              <NeonText text="OPEN" color="#4caf50" />
            </span>
            <p className="bs-empty-msg">Your bar is empty! Add some drinks to stock the shelves.</p>
          </div>
        )}
      </div>
    </div>
  );
}
