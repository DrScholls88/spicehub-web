import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { getBarInventoryRecords, addToBarInventory, removeFromBarInventory, updateBarBottle } from '../db';
import { matchDrink, pickSurprise, categorizeBottle } from '../lib/barMatch';

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
  const [shelfRecords, setShelfRecords] = useState([]); // full bottle records
  const [matchMode, setMatchMode] = useState('best'); // 'best' | 'strict'
  const [loaded, setLoaded] = useState(false);
  const [editingBottle, setEditingBottle] = useState(null); // record being edited
  const [partyMode, setPartyMode] = useState(false); // read-only guest/kiosk view

  // Flat canonical-name list drives the match engine.
  const shelfItems = useMemo(() => shelfRecords.map(r => r.ingredient), [shelfRecords]);

  // Load persistent inventory on mount
  useEffect(() => {
    getBarInventoryRecords().then(records => {
      setShelfRecords(records);
      setLoaded(true);
    });
  }, []);

  const hasItem = useCallback(
    (name) => shelfRecords.some(r => r.ingredient === name),
    [shelfRecords]
  );

  // Persist adds/removes to IndexedDB (optimistic local record for instant UI)
  const addByName = useCallback((rawName) => {
    const clean = String(rawName || '').trim().toLowerCase();
    if (!clean || hasItem(clean)) return;
    const optimistic = {
      ingredient: clean,
      displayName: clean,
      category: categorizeBottle(clean) || null,
    };
    setShelfRecords(prev => [...prev, optimistic]);
    addToBarInventory(clean);
  }, [hasItem]);

  const addItem = useCallback((val) => {
    addByName(val || inputValue);
    setInputValue('');
  }, [addByName, inputValue]);

  const quickAdd = useCallback((item) => addByName(item), [addByName]);

  const removeItem = useCallback((item) => {
    setShelfRecords(prev => prev.filter(r => r.ingredient !== item));
    removeFromBarInventory(item);
  }, []);

  const clearAll = useCallback(() => {
    shelfRecords.forEach(r => removeFromBarInventory(r.ingredient));
    setShelfRecords([]);
  }, [shelfRecords]);

  // Save edits from the bottle edit sheet.
  const saveBottle = useCallback((ingredient, patch) => {
    setShelfRecords(prev => prev.map(r => (r.ingredient === ingredient ? { ...r, ...patch } : r)));
    updateBarBottle(ingredient, patch);
    setEditingBottle(null);
  }, []);

  // Exit party mode behind a confirm so guests can't leave by accident.
  const exitParty = useCallback(() => {
    if (window.confirm('Exit Party Mode?')) setPartyMode(false);
  }, []);

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

  // Score each drink with the deterministic barMatch engine (alias + category
  // aware, with derivable-ingredient inference). Replaces the old naive
  // substring scan that false-matched things like "ice" against "juice".
  const scoredDrinks = useMemo(() => {
    if (shelfItems.length === 0) return [];

    return drinks
      .map(drink => {
        const match = matchDrink(drink, shelfItems);
        if (match.total === 0) return null;
        return { drink, match };
      })
      .filter(Boolean)
      // Keep anything with at least one real or derivable match.
      .filter(s => s.match.matchedCount > 0 || s.match.derivable.length > 0)
      .sort((a, b) =>
        b.match.score - a.match.score || a.match.missing.length - b.match.missing.length
      );
  }, [drinks, shelfItems]);

  // Party mode always shows only makeable drinks (ready + almost), regardless of toggle.
  const filteredResults = (partyMode || matchMode === 'strict')
    ? scoredDrinks.filter(s => s.match.tier === 'ready' || s.match.tier === 'almost')
    : scoredDrinks;

  const perfectMatches = scoredDrinks.filter(s => s.match.tier === 'ready').length;
  const closeMatches = scoredDrinks.filter(s => s.match.tier === 'almost').length;

  // "Surprise me" — jump straight to a random makeable drink.
  const surpriseMe = useCallback(() => {
    const pick = pickSurprise(scoredDrinks);
    if (pick) {
      if (navigator.vibrate) navigator.vibrate([20, 15, 30]);
      onViewDetail(pick.drink);
    }
  }, [scoredDrinks, onViewDetail]);

  const bfmEmptyContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const bfmEmptyItemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  };

  return (
    <div className="bfm-overlay" onClick={partyMode ? undefined : onClose}>
      <motion.div className={`bfm-sheet ${partyMode ? 'bfm-party' : ''}`} onClick={e => e.stopPropagation()}
        drag={partyMode ? false : 'y'} dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={partyMode ? undefined : handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
        {!partyMode && (
          <div className="bfm-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />
        )}

        {/* Header */}
        <div className="bfm-header">
          <div className="bfm-title-row">
            <span className="bfm-icon">{partyMode ? '🎉' : '🍸'}</span>
            <div>
              <h2 className="bfm-title">{partyMode ? 'Party Menu' : "What's on My Shelf?"}</h2>
              <p className="bfm-subtitle">
                {partyMode
                  ? `${perfectMatches} ready to pour`
                  : loaded && shelfItems.length > 0
                    ? `${shelfItems.length} items saved`
                    : 'Add spirits & mixers you have'}
              </p>
            </div>
          </div>
          <div className="bfm-header-actions">
            {!partyMode && shelfItems.length > 0 && (
              <button
                className="bfm-party-btn"
                onClick={() => setPartyMode(true)}
                title="Read-only menu for guests"
              >
                👥 Party
              </button>
            )}
            {partyMode
              ? <button className="bfm-close" onClick={exitParty} title="Exit Party Mode">Exit</button>
              : <button className="bfm-close" onClick={onClose}>✕</button>}
          </div>
        </div>

        {/* Input (hidden in party mode) */}
        {!partyMode && (
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
        )}

        {/* Quick-add chips (hidden in party mode) */}
        {!partyMode && (
          <div className="bfm-quick-section">
            <span className="bfm-quick-label">{shelfItems.length === 0 ? 'Common bottles:' : 'Quick add:'}</span>
            <div className="bfm-quick-chips">
              {QUICK_ADDS.filter(item => !hasItem(item)).slice(0, 12).map(item => (
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
        )}

        {/* Shelf items (editable chips; hidden in party mode) */}
        {!partyMode && shelfRecords.length > 0 && (
          <div className="bfm-shelf-items">
            <div className="bfm-shelf-chips">
              {shelfRecords.map(rec => {
                const sub = rec.brand || rec.subcategory;
                return (
                  <span key={rec.ingredient} className="bfm-shelf-chip">
                    <button
                      type="button"
                      className="bfm-chip-label"
                      onClick={() => setEditingBottle(rec)}
                      title="Edit bottle details"
                    >
                      {rec.displayName || rec.ingredient}
                      {sub && <span className="bfm-chip-sub"> · {sub}</span>}
                    </button>
                    <button className="bfm-chip-remove" onClick={() => removeItem(rec.ingredient)}>✕</button>
                  </span>
                );
              })}
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
            {!partyMode && (
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
            )}
            {scoredDrinks.length > 0 && (
              <button className="bfm-surprise-btn" onClick={surpriseMe} title="Pour something at random">
                🎲 Surprise me
              </button>
            )}
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
            filteredResults.map(({ drink, match }) => {
              const { matchedCount, total, missing, derivable, score, tier } = match;
              const missingCount = missing.length;
              return (
              <div
                key={drink.id}
                className={`bfm-result-card ${tier === 'ready' ? 'bfm-perfect' : ''}`}
                onClick={() => onViewDetail(drink)}
              >
                <div className="bfm-result-img-zone">
                  {drink.imageUrl ? (
                    <img src={drink.imageUrl} alt={drink.name} className="bfm-result-img" onError={e => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="bfm-result-img-ph">🍹</div>
                  )}
                  <div className={`bfm-score-badge ${tier === 'ready' ? 'perfect' : tier === 'almost' ? 'close' : 'partial'}`}>
                    {Math.round(score * 100)}%
                  </div>
                </div>
                <div className="bfm-result-info">
                  <h4 className="bfm-result-name">{drink.name}</h4>
                  <p className="bfm-result-match">
                    <span className="bfm-match-good">{matchedCount}/{total} ingredients</span>
                    {missingCount > 0 && (
                      <span className="bfm-match-missing"> · {missingCount} missing</span>
                    )}
                  </p>
                  {derivable.length > 0 && (
                    <p className="bfm-derivable-list">
                      🧪 You can make: {derivable.map(d => d.result).slice(0, 2).join(', ')}
                    </p>
                  )}
                  {missingCount > 0 && missingCount <= 3 && (
                    <p className="bfm-missing-list">
                      Need: {missing.slice(0, 3).join(', ')}
                    </p>
                  )}
                </div>
                <div className="bfm-result-actions">
                  {tier === 'ready' && <span className="bfm-ready-badge">Pour it!</span>}
                  {!partyMode && missingCount > 0 && missingCount <= 3 && onAddToGrocery && (
                    <button
                      className="bfm-quest-add-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToGrocery(missing.map(ing => ({
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
              );
            })
          )}
        </div>

        {/* Bottle edit sheet */}
        <AnimatePresence>
          {editingBottle && (
            <BottleEditSheet
              key={editingBottle.ingredient}
              record={editingBottle}
              onSave={saveBottle}
              onClose={() => setEditingBottle(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Bottle edit sheet ─────────────────────────────────────────────────────────
// Lets the user attach brand, subcategory, quantity and tasting notes to a
// bottle. Writes through updateBarBottle (via the parent's onSave).
function BottleEditSheet({ record, onSave, onClose }) {
  const [brand, setBrand] = useState(record.brand || '');
  const [subcategory, setSubcategory] = useState(record.subcategory || '');
  const [qty, setQty] = useState(record.qty || '');
  const [notes, setNotes] = useState(record.notes || '');

  const handleSave = () => {
    onSave(record.ingredient, {
      brand: brand.trim() || undefined,
      subcategory: subcategory.trim() || undefined,
      qty: qty.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="bfm-edit-overlay" onClick={onClose}>
      <motion.div
        className="bfm-edit-sheet"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="bfm-edit-header">
          <h3 className="bfm-edit-title">{record.displayName || record.ingredient}</h3>
          {record.category && <span className="bfm-edit-cat">{record.category}</span>}
        </div>

        <label className="bfm-edit-field">
          <span>Brand</span>
          <input type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Tanqueray" />
        </label>
        <label className="bfm-edit-field">
          <span>Style / subcategory</span>
          <input type="text" value={subcategory} onChange={e => setSubcategory(e.target.value)} placeholder="e.g. London Dry" />
        </label>
        <label className="bfm-edit-field">
          <span>Quantity</span>
          <input type="text" value={qty} onChange={e => setQty(e.target.value)} placeholder="e.g. ¾ bottle" />
        </label>
        <label className="bfm-edit-field">
          <span>Notes</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Tasting notes, where to buy…" />
        </label>

        <div className="bfm-edit-actions">
          <button className="bfm-edit-cancel" onClick={onClose}>Cancel</button>
          <button className="bfm-edit-save" onClick={handleSave}>Save</button>
        </div>
      </motion.div>
    </div>
  );
}
