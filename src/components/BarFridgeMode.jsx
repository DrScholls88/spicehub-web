import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { getBarInventory, addToBarInventory, removeFromBarInventory } from '../db';

/**
 * "What's on My Shelf?" — the bar version of Fridge Mode.
 * Now persists inventory to IndexedDB so your bar shelf stays stocked between sessions.
 * Quest integration: missing ingredients show quest scroll icons.
 */
export default function BarFridgeMode({ drinks, onViewDetail, onClose, onAddToGrocery }) {
  const dragControls = useDragControls();

  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }, [onClose]);
  const [inputValue, setInputValue] = useState('');
  const [shelfItems, setShelfItems] = useState([]);
  const [matchMode, setMatchMode] = useState('best'); // 'best' | 'strict'
  const [loaded, setLoaded] = useState(false);

  // Load persistent inventory on mount
  useEffect(() => {
    getBarInventory().then(items => {
      setShelfItems(items);
      setLoaded(true);
    });
  }, []);

  // Persist adds/removes to IndexedDB
  const addItem = useCallback((val) => {
    const clean = (val || inputValue).trim().toLowerCase();
    if (clean && !shelfItems.includes(clean)) {
      setShelfItems(prev => [...prev, clean]);
      addToBarInventory(clean);
    }
    setInputValue('');
  }, [inputValue, shelfItems]);

  const removeItem = useCallback((item) => {
    setShelfItems(prev => prev.filter(i => i !== item));
    removeFromBarInventory(item);
  }, []);

  const clearAll = useCallback(() => {
    shelfItems.forEach(item => removeFromBarInventory(item));
    setShelfItems([]);
  }, [shelfItems]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
  }, [addItem]);

  // Bar-specific quick adds — common spirits and mixers
  const QUICK_ADDS = [
    'vodka', 'gin', 'rum', 'tequila', 'bourbon', 'whiskey',
    'triple sec', 'vermouth', 'bitters', 'lime juice', 'simple syrup',
    'soda water', 'ginger beer', 'tonic', 'ice', 'orange juice',
    'cranberry juice', 'club soda', 'grenadine', 'sugar',
  ];

  const quickAdd = useCallback((item) => {
    if (!shelfItems.includes(item)) {
      setShelfItems(prev => [...prev, item]);
      addToBarInventory(item);
    }
  }, [shelfItems]);

  // Score each drink by how many ingredients match what's on the shelf
  const scoredDrinks = useMemo(() => {
    if (shelfItems.length === 0) return [];

    return drinks
      .map(drink => {
        const totalIngredients = drink.ingredients?.length || 0;
        if (totalIngredients === 0) return null;
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
      .filter(Boolean)
      .filter(s => s.matched > 0)
      .sort((a, b) => b.score - a.score || a.missing - b.missing);
  }, [drinks, shelfItems]);

  const filteredResults = matchMode === 'strict'
    ? scoredDrinks.filter(s => s.missing <= 1)
    : scoredDrinks;

  const perfectMatches = scoredDrinks.filter(s => s.missing === 0).length;
  const closeMatches = scoredDrinks.filter(s => s.missing > 0 && s.missing <= 2).length;

  const bfmEmptyContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const bfmEmptyItemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  };

  return (
    <div className="bfm-overlay" onClick={onClose}>
      <motion.div className="bfm-sheet" onClick={e => e.stopPropagation()}
        drag="y" dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
        <div className="bfm-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />

        {/* Header */}
        <div className="bfm-header">
          <div className="bfm-title-row">
            <span className="bfm-icon">🍸</span>
            <div>
              <h2 className="bfm-title">What's on My Shelf?</h2>
              <p className="bfm-subtitle">
                {loaded && shelfItems.length > 0
                  ? `${shelfItems.length} items saved`
                  : 'Add spirits & mixers you have'}
              </p>
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
            <button className="bfm-add-btn" onClick={() => addItem()} disabled={!inputValue.trim()}>
              Add
            </button>
          </div>
        </div>

        {/* Quick-add chips */}
        <div className="bfm-quick-section">
          <span className="bfm-quick-label">{shelfItems.length === 0 ? 'Common bottles:' : 'Quick add:'}</span>
          <div className="bfm-quick-chips">
            {QUICK_ADDS.filter(item => !shelfItems.includes(item)).slice(0, 12).map(item => (
              <button
                key={item}
                className="bfm-quick-chip"
                onClick={() => quickAdd(item)}
              >
                + {item}
              </button>
            ))}
          </div>
        </div>

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
            <button className="bfm-clear-all" onClick={clearAll}>Clear all</button>
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
            <motion.div className="bfm-empty" variants={bfmEmptyContainerVariants} initial="hidden" animate="visible">
              <motion.span className="bfm-empty-icon" variants={bfmEmptyItemVariants}>🥃</motion.span>
              <motion.p variants={bfmEmptyItemVariants}>Add spirits from your bar to see what cocktails you can mix!</motion.p>
              <motion.p variants={bfmEmptyItemVariants} style={{ fontSize: '12px', color: '#888', marginTop: 8 }}>
                Your inventory is saved automatically between sessions.
              </motion.p>
            </motion.div>
          ) : filteredResults.length === 0 ? (
            <motion.div className="bfm-empty" variants={bfmEmptyContainerVariants} initial="hidden" animate="visible">
              <motion.span className="bfm-empty-icon" variants={bfmEmptyItemVariants}>😔</motion.span>
              <motion.p variants={bfmEmptyItemVariants}>No cocktails match your bottles. Try adding more spirits or mixers!</motion.p>
            </motion.div>
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
                  {missing > 0 && missing <= 3 && (
                    <p className="bfm-missing-list">
                      Need: {missingIngredients.slice(0, 3).join(', ')}
                    </p>
                  )}
                </div>
                <div className="bfm-result-actions">
                  {missing === 0 && <span className="bfm-ready-badge">Pour it!</span>}
                  {missing > 0 && missing <= 3 && onAddToGrocery && (
                    <button
                      className="bfm-quest-add-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToGrocery(missingIngredients.map(ing => ({
                          name: ing,
                          tag: 'bar-quest',
                          questDrinkId: drink.id,
                          questName: drink.name,
                        })));
                        if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
                      }}
                      title="Add missing to grocery quest"
                    >
                      📜 Quest
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
