import { useState, useMemo, useCallback } from 'react';

/**
 * "What's on My Shelf?" — the bar version of Fridge Mode.
 * Type spirits/liqueurs you have, see what cocktails you can make.
 */
export default function BarFridgeMode({ drinks, onViewDetail, onClose }) {
  const [inputValue, setInputValue] = useState('');
  const [shelfItems, setShelfItems] = useState([]);
  const [matchMode, setMatchMode] = useState('best'); // 'best' | 'strict'

  const addItem = useCallback(() => {
    const val = inputValue.trim().toLowerCase();
    if (val && !shelfItems.includes(val)) {
      setShelfItems(prev => [...prev, val]);
    }
    setInputValue('');
  }, [inputValue, shelfItems]);

  const removeItem = useCallback((item) => {
    setShelfItems(prev => prev.filter(i => i !== item));
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  }, [addItem]);

  // Bar-specific quick adds — common spirits and mixers
  const QUICK_ADDS = [
    'vodka', 'gin', 'rum', 'tequila', 'bourbon', 'whiskey',
    'triple sec', 'vermouth', 'bitters', 'lime juice', 'simple syrup',
    'soda water', 'ginger beer', 'tonic', 'ice',
  ];

  const quickAdd = useCallback((item) => {
    if (!shelfItems.includes(item)) {
      setShelfItems(prev => [...prev, item]);
    }
  }, [shelfItems]);

  // Score each drink by how many ingredients match what's on the shelf
  const scoredDrinks = useMemo(() => {
    if (shelfItems.length === 0) return [];

    return drinks
      .map(drink => {
        const totalIngredients = drink.ingredients.length;
        let matched = 0;
        const matchedIngredients = [];
        const missingIngredients = [];

        drink.ingredients.forEach(ing => {
          const ingLower = ing.toLowerCase();
          const isMatch = shelfItems.some(shelfItem =>
            ingLower.includes(shelfItem) || shelfItem.includes(ingLower.split(' ').pop())
          );
          if (isMatch) {
            matched++;
            matchedIngredients.push(ing);
          } else {
            missingIngredients.push(ing);
          }
        });

        const score = matched / totalIngredients;
        return {
          drink,
          score,
          matched,
          total: totalIngredients,
          missing: totalIngredients - matched,
          matchedIngredients,
          missingIngredients,
        };
      })
      .filter(s => s.matched > 0)
      .sort((a, b) => b.score - a.score || a.missing - b.missing);
  }, [drinks, shelfItems]);

  const filteredResults = matchMode === 'strict'
    ? scoredDrinks.filter(s => s.missing <= 1)
    : scoredDrinks;

  const perfectMatches = scoredDrinks.filter(s => s.missing === 0).length;
  const closeMatches = scoredDrinks.filter(s => s.missing > 0 && s.missing <= 2).length;

  return (
    <div className="bfm-overlay" onClick={onClose}>
      <div className="bfm-sheet" onClick={e => e.stopPropagation()}>
        <div className="bfm-handle" />

        {/* Header */}
        <div className="bfm-header">
          <div className="bfm-title-row">
            <span className="bfm-icon">🍸</span>
            <div>
              <h2 className="bfm-title">What's on My Shelf?</h2>
              <p className="bfm-subtitle">Add spirits & mixers you have</p>
            </div>
          </div>
          <button className="bfm-close" onClick={onClose}>✕</button>
        </div>

        {/* Input */}
        <div className="bfm-input-zone">
          <div className="bfm-input-row">
            <input
              type="text"
              className="bfm-input"
              placeholder="Type a spirit or mixer..."
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button className="bfm-add-btn" onClick={addItem} disabled={!inputValue.trim()}>
              Add
            </button>
          </div>
        </div>

        {/* Quick-add chips */}
        {shelfItems.length === 0 && (
          <div className="bfm-quick-section">
            <span className="bfm-quick-label">Common bottles:</span>
            <div className="bfm-quick-chips">
              {QUICK_ADDS.map(item => (
                <button
                  key={item}
                  className={`bfm-quick-chip ${shelfItems.includes(item) ? 'added' : ''}`}
                  onClick={() => quickAdd(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shelf items */}
        {shelfItems.length > 0 && (
          <div className="bfm-shelf-items">
            <div className="bfm-shelf-chips">
              {shelfItems.map(item => (
                <span key={item} className="bfm-shelf-chip">
                  {item}
                  <button className="bfm-chip-remove" onClick={() => removeItem(item)}>✕</button>
                </span>
              ))}
            </div>
            <button className="bfm-clear-all" onClick={() => setShelfItems([])}>Clear all</button>
          </div>
        )}

        {/* Results summary */}
        {shelfItems.length > 0 && (
          <div className="bfm-results-summary">
            <div className="bfm-summary-stats">
              {perfectMatches > 0 && (
                <span className="bfm-stat bfm-stat-perfect">
                  {perfectMatches} ready to pour
                </span>
              )}
              {closeMatches > 0 && (
                <span className="bfm-stat bfm-stat-close">
                  {closeMatches} almost there
                </span>
              )}
            </div>
            <div className="bfm-mode-toggle">
              <button
                className={`bfm-mode-btn ${matchMode === 'best' ? 'active' : ''}`}
                onClick={() => setMatchMode('best')}
              >
                All
              </button>
              <button
                className={`bfm-mode-btn ${matchMode === 'strict' ? 'active' : ''}`}
                onClick={() => setMatchMode('strict')}
              >
                Ready
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="bfm-results">
          {shelfItems.length === 0 ? (
            <div className="bfm-empty">
              <span className="bfm-empty-icon">🥃</span>
              <p>Add spirits from your bar to see what cocktails you can mix!</p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="bfm-empty">
              <span className="bfm-empty-icon">😔</span>
              <p>No cocktails match your bottles. Try adding more spirits or mixers!</p>
            </div>
          ) : (
            filteredResults.map(({ drink, score, matched, total, missing, missingIngredients }) => (
              <div
                key={drink.id}
                className={`bfm-result-card ${missing === 0 ? 'bfm-perfect' : ''}`}
                onClick={() => onViewDetail(drink)}
              >
                <div className="bfm-result-img-zone">
                  {drink.imageUrl ? (
                    <img src={drink.imageUrl} alt={drink.name} className="bfm-result-img" onError={e => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="bfm-result-img-ph">🍹</div>
                  )}
                  <div className={`bfm-score-badge ${missing === 0 ? 'perfect' : missing <= 1 ? 'close' : 'partial'}`}>
                    {Math.round(score * 100)}%
                  </div>
                </div>
                <div className="bfm-result-info">
                  <h4 className="bfm-result-name">{drink.name}</h4>
                  <p className="bfm-result-match">
                    <span className="bfm-match-good">{matched}/{total} ingredients</span>
                    {missing > 0 && (
                      <span className="bfm-match-missing"> · {missing} missing</span>
                    )}
                  </p>
                  {missing > 0 && missing <= 2 && (
                    <p className="bfm-missing-list">
                      Need: {missingIngredients.slice(0, 2).join(', ')}
                    </p>
                  )}
                </div>
                {missing === 0 && <span className="bfm-ready-badge">Pour it!</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
