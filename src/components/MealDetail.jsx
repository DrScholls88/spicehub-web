import { useState } from 'react';

export default function MealDetail({ meal, onClose, onShare, onToggleFavorite, onRate, onStartCook }) {
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
      <div className="modal-content detail-modal modal-slide-up" onClick={e => e.stopPropagation()}>
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
          <h3>📝 Ingredients</h3>
          <ul className="ingredient-list">
            {scaledIngredients.map((ing, i) => (
              <li key={i}>{ing}</li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <h3>👨‍🍳 Directions</h3>
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

        {/* Start Cooking button */}
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
      </div>
    </div>
  );
}
