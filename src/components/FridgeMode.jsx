import { useState, useMemo, useCallback } from 'react';
import { motion, useDragControls } from 'framer-motion';

/**
 * "What's in My Fridge?" — type ingredients you have, see what you can make.
 */
export default function FridgeMode({ meals, onViewDetail, onClose }) {
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }, [onClose]);
  const [inputValue, setInputValue] = useState('');
  const [pantryItems, setPantryItems] = useState([]);
  const [matchMode, setMatchMode] = useState('best'); // 'best' | 'strict'

  const addItem = useCallback(() => {
    const val = inputValue.trim().toLowerCase();
    if (val && !pantryItems.includes(val)) {
      setPantryItems(prev => [...prev, val]);
    }
    setInputValue('');
  }, [inputValue, pantryItems]);

  const removeItem = useCallback((item) => {
    setPantryItems(prev => prev.filter(i => i !== item));
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  }, [addItem]);

  // Quick-add common pantry staples
  const QUICK_ADDS = ['chicken', 'rice', 'pasta', 'eggs', 'onion', 'garlic', 'butter', 'cheese', 'tomatoes', 'potatoes', 'broccoli', 'beef'];

  const quickAdd = useCallback((item) => {
    if (!pantryItems.includes(item)) {
      setPantryItems(prev => [...prev, item]);
    }
  }, [pantryItems]);

  // Score each meal by how many ingredients match
  const scoredMeals = useMemo(() => {
    if (pantryItems.length === 0) return [];

    return meals
      .map(meal => {
        const totalIngredients = meal.ingredients.length;
        let matched = 0;
        const matchedIngredients = [];
        const missingIngredients = [];

        meal.ingredients.forEach(ing => {
          const ingLower = ing.toLowerCase();
          const isMatch = pantryItems.some(pantryItem =>
            ingLower.includes(pantryItem) || pantryItem.includes(ingLower.split(' ').pop())
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
          meal,
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
  }, [meals, pantryItems]);

  const filteredResults = matchMode === 'strict'
    ? scoredMeals.filter(s => s.missing <= 2)
    : scoredMeals;

  const perfectMatches = scoredMeals.filter(s => s.missing === 0).length;
  const closeMatches = scoredMeals.filter(s => s.missing > 0 && s.missing <= 3).length;

  const fmEmptyContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const fmEmptyItemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  };

  return (
    <div className="fm-overlay" onClick={onClose}>
      <motion.div className="fm-sheet" onClick={e => e.stopPropagation()}
        drag="y" dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
        <div className="fm-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />

        {/* Header */}
        <div className="fm-header">
          <div className="fm-title-row">
            <span className="fm-icon">🧊</span>
            <div>
              <h2 className="fm-title">What's in My Fridge?</h2>
              <p className="fm-subtitle">Add ingredients you have on hand</p>
            </div>
          </div>
          <button className="fm-close" onClick={onClose}>✕</button>
        </div>

        {/* Input bar */}
        <div className="fm-input-zone">
          <div className="fm-input-row">
            <input
              type="text"
              className="fm-input"
              placeholder="Type an ingredient..."
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button className="fm-add-btn" onClick={addItem} disabled={!inputValue.trim()}>
              Add
            </button>
          </div>
        </div>

        {/* Quick-add chips */}
        {pantryItems.length === 0 && (
          <div className="fm-quick-section">
            <span className="fm-quick-label">Quick add:</span>
            <div className="fm-quick-chips">
              {QUICK_ADDS.map(item => (
                <button
                  key={item}
                  className={`fm-quick-chip ${pantryItems.includes(item) ? 'added' : ''}`}
                  onClick={() => quickAdd(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pantry items */}
        {pantryItems.length > 0 && (
          <div className="fm-pantry">
            <div className="fm-pantry-chips">
              {pantryItems.map(item => (
                <span key={item} className="fm-pantry-chip">
                  {item}
                  <button className="fm-chip-remove" onClick={() => removeItem(item)}>✕</button>
                </span>
              ))}
            </div>
            <button className="fm-clear-all" onClick={() => setPantryItems([])}>Clear all</button>
          </div>
        )}

        {/* Results summary */}
        {pantryItems.length > 0 && (
          <div className="fm-results-summary">
            <div className="fm-summary-stats">
              {perfectMatches > 0 && (
                <span className="fm-stat fm-stat-perfect">
                  {perfectMatches} perfect match{perfectMatches !== 1 ? 'es' : ''}
                </span>
              )}
              {closeMatches > 0 && (
                <span className="fm-stat fm-stat-close">
                  {closeMatches} close (1-3 missing)
                </span>
              )}
            </div>
            <div className="fm-mode-toggle">
              <button
                className={`fm-mode-btn ${matchMode === 'best' ? 'active' : ''}`}
                onClick={() => setMatchMode('best')}
              >
                All
              </button>
              <button
                className={`fm-mode-btn ${matchMode === 'strict' ? 'active' : ''}`}
                onClick={() => setMatchMode('strict')}
              >
                Best Fits
              </button>
            </div>
          </div>
        )}

        {/* Results list */}
        <div className="fm-results">
          {pantryItems.length === 0 ? (
            <motion.div className="fm-empty" variants={fmEmptyContainerVariants} initial="hidden" animate="visible">
              <motion.span className="fm-empty-icon" variants={fmEmptyItemVariants}>🔍</motion.span>
              <motion.p variants={fmEmptyItemVariants}>Add some ingredients above to see what you can make!</motion.p>
            </motion.div>
          ) : filteredResults.length === 0 ? (
            <motion.div className="fm-empty" variants={fmEmptyContainerVariants} initial="hidden" animate="visible">
              <motion.span className="fm-empty-icon" variants={fmEmptyItemVariants}>😔</motion.span>
              <motion.p variants={fmEmptyItemVariants}>No recipes match your ingredients. Try adding more items!</motion.p>
            </motion.div>
          ) : (
            filteredResults.map(({ meal, score, matched, total, missing, missingIngredients }) => (
              <div
                key={meal.id}
                className={`fm-result-card ${missing === 0 ? 'fm-perfect' : ''}`}
                onClick={() => onViewDetail(meal)}
              >
                <div className="fm-result-img-zone">
                  {meal.imageUrl ? (
                    <img src={meal.imageUrl} alt={meal.name} className="fm-result-img" onError={e => { e.target.style.display='none'; }} />
                  ) : (
                    <div className="fm-result-img-ph">🍽️</div>
                  )}
                  {/* Score ring */}
                  <div className={`fm-score-badge ${missing === 0 ? 'perfect' : missing <= 2 ? 'close' : 'partial'}`}>
                    {Math.round(score * 100)}%
                  </div>
                </div>
                <div className="fm-result-info">
                  <h4 className="fm-result-name">{meal.name}</h4>
                  <p className="fm-result-match">
                    <span className="fm-match-good">{matched}/{total} ingredients</span>
                    {missing > 0 && (
                      <span className="fm-match-missing"> · {missing} missing</span>
                    )}
                  </p>
                  {missing > 0 && missing <= 3 && (
                    <p className="fm-missing-list">
                      Need: {missingIngredients.slice(0, 3).join(', ')}
                    </p>
                  )}
                </div>
                {missing === 0 && <span className="fm-perfect-badge">Ready!</span>}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
