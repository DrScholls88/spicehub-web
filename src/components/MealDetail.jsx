import { useState, useRef, useCallback } from 'react';

export default function MealDetail({ meal, onClose, onShare, onToggleFavorite, onRate, onStartCook, onStartMix, isDrink = false }) {
  // ── Swipe-down-to-dismiss ──
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);
  const dragCurrentY = useRef(0);
  const isDragging = useRef(false);

  const handleSwipeStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    // Only allow swipe dismiss if scrolled to top
    if (sheet.scrollTop > 5) return;
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = 0;
    isDragging.current = false;
  }, []);

  const handleSwipeMove = useCallback((e) => {
    if (dragStartY.current === null) return;
    const deltaY = e.touches[0].clientY - dragStartY.current;
    if (deltaY < 0) { dragStartY.current = null; return; }
    if (deltaY > 10) isDragging.current = true;
    if (!isDragging.current) return;
    dragCurrentY.current = deltaY;
    const sheet = sheetRef.current;
    if (sheet) {
      const translate = deltaY < 120 ? deltaY : 120 + (deltaY - 120) * 0.3;
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${translate}px)`;
    }
  }, []);

  const handleSwipeEnd = useCallback(() => {
    if (dragStartY.current === null) return;
    const deltaY = dragCurrentY.current;
    const sheet = sheetRef.current;
    if (isDragging.current && deltaY > 120) {
      if (sheet) {
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
        sheet.style.transform = 'translateY(100%)';
      }
      setTimeout(() => onClose(), 250);
    } else if (sheet) {
      sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
      sheet.style.transform = 'translateY(0)';
      setTimeout(() => { if (sheet) sheet.style.transition = ''; }, 250);
    }
    dragStartY.current = null;
    dragCurrentY.current = 0;
    isDragging.current = false;
  }, [onClose]);
  const scaleOptions = [
    { value: 1.0, label: '1×' },
    { value: 1.5, label: '1.5×' },
    { value: 2.0, label: '2×' },
  ];
  const [scaleFactor, setScaleFactor] = useState(1.0);

  const scaleIngredient = (ingredient, factor) => {
    // Simple regex to detect numbers/fractions at the start of the ingredient string
    const regex = /^(\d+\.?\d*|\d+\/\d+|\d+\s+\d+\/\d+)\s*(.*)$/;
    const match = ingredient.match(regex);

    if (!match) return ingredient;

    const [, amount, rest] = match;
    let scaled = 0;

    // Handle fractions like "1/2", "3/4"
    if (amount.includes('/')) {
      const [num, denom] = amount.split('/').map(Number);
      scaled = (num / denom) * factor;
    } else {
      // Handle decimals and whole numbers, including compound like "2 1/2"
      const parts = amount.split(/\s+/);
      let value = 0;
      for (const part of parts) {
        if (part.includes('/')) {
          const [num, denom] = part.split('/').map(Number);
          value += num / denom;
        } else {
          value += parseFloat(part);
        }
      }
      scaled = value * factor;
    }

    // Format the scaled value nicely
    const formattedAmount = scaled % 1 !== 0
      ? scaled.toFixed(2).replace(/\.?0+$/, '')
      : Math.round(scaled).toString();

    return `${formattedAmount} ${rest}`;
  };

  const scaledIngredients = meal.ingredients.map(ing => scaleIngredient(ing, scaleFactor));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="modal-content detail-modal modal-slide-up"
        onClick={e => e.stopPropagation()}
        onTouchStart={handleSwipeStart}
        onTouchMove={handleSwipeMove}
        onTouchEnd={handleSwipeEnd}
      >
        {/* ── Swipe handle (visual indicator for drag-down-to-close) ── */}
        <div className="detail-swipe-handle" />
        <div className="modal-header">
          <h2>{meal.name}</h2>
          <div className="modal-header-actions">
            <button className="btn-icon" onClick={onShare} title="Share">📤</button>
            <button className="btn-icon" onClick={onClose}>✕</button>
          </div>
        </div>

        {meal.imageUrl && (
          <img src={meal.imageUrl} alt={meal.name} className="detail-image" onError={e => { e.target.style.display = 'none'; }} />
        )}

        {/* Favorites, Rating, Category, Cook Count */}
        <div className="detail-header-bar">
          {onToggleFavorite && (
            <button
              className={`heart-btn-detail ${meal.isFavorite ? 'favorited' : ''}`}
              onClick={() => onToggleFavorite(meal)}
              title={meal.isFavorite ? 'Unfavorite' : 'Favorite'}
            >
              {meal.isFavorite ? '❤️' : '🤍'}
            </button>
          )}
          {onRate && (
            <div className="star-rating">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  className={`star-btn ${star <= (meal.rating || 0) ? 'filled' : ''}`}
                  onClick={() => onRate(meal, star)}
                  title={`Rate ${star} stars`}
                >
                  ⭐
                </button>
              ))}
            </div>
          )}
          <div className="detail-meta">
            {meal.category && (
              <span className="detail-category-chip">{meal.category}</span>
            )}
            {meal.cookCount ? (
              <span className="detail-cook-count" title="Times cooked">
                🍳 {meal.cookCount}
              </span>
            ) : null}
          </div>
        </div>

        {/* Recipe Scale Selector */}
        <div className="servings-scaler">
          <label>Scale:</label>
          <div className="scale-selector">
            {scaleOptions.map(opt => (
              <button
                key={opt.value}
                className={`btn-scale${scaleFactor === opt.value ? ' active' : ''}`}
                onClick={() => setScaleFactor(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="detail-section">
          <h3>{isDrink ? '🍸 Ingredients' : '📝 Ingredients'}</h3>
          <ul className="ingredient-list">
            {scaledIngredients.map((ing, i) => (
              <li key={i}>{ing}</li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <h3>{isDrink ? '🫗 Instructions' : '👨‍🍳 Directions'}</h3>
          <ol className="direction-list">
            {meal.directions.map((dir, i) => (
              <li key={i}>{dir}</li>
            ))}
          </ol>
        </div>

        {meal.notes && (
          <div className="detail-section">
            <h3>📌 Notes</h3>
            <p className="detail-notes">{meal.notes}</p>
          </div>
        )}

        {meal.link && (
          <div className="detail-section">
            <a href={meal.link} target="_blank" rel="noopener noreferrer" className="recipe-link">
              🔗 View Original Recipe
            </a>
          </div>
        )}

        {/* Start Cooking / Start Mixing button */}
        {onStartCook && meal.directions && meal.directions.length > 0 && (
          <div className="detail-section" style={{ paddingBottom: 20 }}>
            <button
              className="cook-mode-launch-btn"
              onClick={() => { onClose(); onStartCook(meal, scaleFactor); }}
            >
              👨‍🍳 Start Cooking
            </button>
          </div>
        )}
        {onStartMix && meal.directions && meal.directions.length > 0 && (
          <div className="detail-section" style={{ paddingBottom: 20 }}>
            <button
              className="cook-mode-launch-btn mix-mode-launch-btn"
              onClick={() => { onClose(); onStartMix(meal, scaleFactor); }}
            >
              🍹 Start Mixing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
