import { useState, useMemo } from 'react';

/**
 * Retro 16-bit style back-bar bottle shelf.
 * Displays all drinks as pixel-art style bottles on wooden shelves.
 * Tap a bottle to expand its detail card.
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
];

function getBottleStyle(drink) {
  const name = (drink.name + ' ' + (drink.ingredients || []).join(' ')).toLowerCase();
  for (const style of BOTTLE_STYLES) {
    if (style.keywords.some(kw => name.includes(kw))) return style;
  }
  // Default cocktail
  return { shape: 'round', color: '#ce93d8', label: '#6a1b9a', cap: '#4a148c' };
}

// Pixel-art SVG bottle renderer
function PixelBottle({ style, size = 48, glow = false }) {
  const s = size;
  const { shape, color, label, cap } = style;

  // All bottles drawn with blocky pixel-art aesthetic
  if (shape === 'tall') {
    return (
      <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={`bs-bottle-svg ${glow ? 'bs-glow' : ''}`}>
        {/* Cap */}
        <rect x="7" y="0" width="6" height="3" fill={cap} rx="0" />
        {/* Neck */}
        <rect x="8" y="3" width="4" height="6" fill={color} />
        {/* Body */}
        <rect x="4" y="9" width="12" height="24" fill={color} rx="1" />
        {/* Label */}
        <rect x="5" y="14" width="10" height="10" fill={label} rx="0" />
        {/* Shine */}
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
  // fallback
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

export default function BarShelf({ drinks, onViewDetail, onClose }) {
  const [selectedDrink, setSelectedDrink] = useState(null);

  // Organize drinks into shelf rows (max 6 per shelf)
  const shelves = useMemo(() => {
    const rows = [];
    for (let i = 0; i < drinks.length; i += 6) {
      rows.push(drinks.slice(i, i + 6));
    }
    // Always have at least 3 shelves for the visual
    while (rows.length < 3) rows.push([]);
    return rows;
  }, [drinks]);

  const handleBottleTap = (drink) => {
    if (selectedDrink?.id === drink.id) {
      setSelectedDrink(null);
    } else {
      setSelectedDrink(drink);
    }
  };

  return (
    <div className="bs-overlay" onClick={onClose}>
      <div className="bs-container" onClick={e => e.stopPropagation()}>
        {/* Top bar */}
        <div className="bs-topbar">
          <button className="bs-back-btn" onClick={onClose}>
            <span className="bs-pixel-arrow">&larr;</span> BACK
          </button>
          <h1 className="bs-title">
            <NeonText text="MY BAR SHELF" color="#ff4081" />
          </h1>
          <div className="bs-bottle-count">
            <span className="bs-count-num">{drinks.length}</span>
            <span className="bs-count-label">bottles</span>
          </div>
        </div>

        {/* Shelf display */}
        <div className="bs-shelf-area">
          {/* Ambient back-bar glow */}
          <div className="bs-backbar-glow" />

          {shelves.map((row, shelfIdx) => (
            <div key={shelfIdx} className="bs-shelf-row">
              <div className="bs-bottles-row">
                {row.map((drink) => {
                  const bottleStyle = getBottleStyle(drink);
                  const isSelected = selectedDrink?.id === drink.id;
                  return (
                    <button
                      key={drink.id}
                      className={`bs-bottle-slot ${isSelected ? 'bs-selected' : ''}`}
                      onClick={() => handleBottleTap(drink)}
                      title={drink.name}
                    >
                      <PixelBottle style={bottleStyle} size={56} glow={isSelected} />
                      <span className="bs-bottle-label">{drink.name.length > 8 ? drink.name.slice(0, 7) + '…' : drink.name}</span>
                    </button>
                  );
                })}
                {/* Empty slots for visual */}
                {row.length < 6 && Array.from({ length: 6 - row.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="bs-bottle-slot bs-empty-slot">
                    <div className="bs-empty-bottle" />
                  </div>
                ))}
              </div>
              {/* Wooden shelf plank */}
              <div className="bs-shelf-plank" />
            </div>
          ))}
        </div>

        {/* Selected bottle detail card */}
        {selectedDrink && (
          <div className="bs-detail-card">
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
              <button className="bs-detail-close" onClick={() => setSelectedDrink(null)}>✕</button>
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
