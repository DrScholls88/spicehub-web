import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { getBarInventoryRecords, addToBarInventory, removeFromBarInventory, updateBarBottle } from '../db';
import { matchDrink, pickSurprise, categorizeBottle } from '../lib/barMatch';
import { QTY_LEVELS, QTY_FILL, QTY_LABEL, getDomainFlags } from '../lib/pantryDomain';
import { IngredientSprite } from '../lib/barSprites.jsx';
import IngredientCatalog from './IngredientCatalog';

/**
 * "My Bar" — retro pixel-art bar inventory (formerly the "What's on My Shelf?"
 * sheet). Your stocked bottles/mixers appear as procedural pixel sprites on
 * wooden shelves; a FRIDGE 2000 counter tallies them; a doorway behind the bar
 * walks into the Saloon (BarShelf). The barMatch engine still drives the
 * slide-up "Drinks" panel (ready / almost / derivable tiers). Fully offline.
 */
const SHELF_SIZE = 6; // sprites per wooden shelf row

// P4: the semantic quantity enum (QTY_LEVELS/QTY_FILL/QTY_LABEL) now lives in
// lib/pantryDomain.js — shared with the Kitchen Pantry.

// ── P3: per-category edit placeholders (fixes the gin-examples-on-bourbon bug)
const CATEGORY_PLACEHOLDERS = {
  gin:      { brand: 'e.g. Tanqueray',      style: 'e.g. London Dry' },
  vodka:    { brand: 'e.g. Tito\'s',        style: 'e.g. Potato, 80 proof' },
  whiskey:  { brand: 'e.g. Maker\'s Mark',  style: 'e.g. Bourbon, Rye' },
  rum:      { brand: 'e.g. Plantation',     style: 'e.g. Aged, Spiced' },
  tequila:  { brand: 'e.g. Espolòn',        style: 'e.g. Reposado' },
  liqueur:  { brand: 'e.g. Cointreau',      style: 'e.g. Orange liqueur' },
  wine:     { brand: 'e.g. Dolin',          style: 'e.g. Dry vermouth' },
  beer:     { brand: 'e.g. Modelo',         style: 'e.g. Lager' },
  bitters:  { brand: 'e.g. Angostura',      style: 'e.g. Aromatic' },
  mixer:    { brand: 'e.g. Fever-Tree',     style: 'e.g. Indian tonic' },
  juice:    { brand: 'e.g. fresh-squeezed', style: 'e.g. Cold-pressed' },
  syrup:    { brand: 'e.g. homemade',       style: 'e.g. 1:1 simple' },
  produce:  { brand: 'e.g. farmers market', style: 'e.g. Organic' },
};
function placeholdersFor(category, ingredient) {
  const key = (category || categorizeBottle(ingredient) || '').toLowerCase();
  for (const k of Object.keys(CATEGORY_PLACEHOLDERS)) {
    if (key.includes(k)) return CATEGORY_PLACEHOLDERS[k];
  }
  return { brand: 'e.g. house favorite', style: 'e.g. style / variety' };
}

export default function BarFridgeMode({ drinks, onViewDetail, onClose, onAddToGrocery, onOpenSaloon }) {
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
  const [showDrinks, setShowDrinks] = useState(false); // slide-up makeable panel
  const [showCatalog, setShowCatalog] = useState(false); // browse premade ingredients
  const [drinksFilter, setDrinksFilter] = useState(null); // P3: "using: gin" chip in drinks panel
  const [lastAdded, setLastAdded] = useState(null); // P3: sparkle on freshly added bottle

  // Flat canonical-name list drives the match engine.
  const shelfItems = useMemo(() => shelfRecords.map(r => r.ingredient), [shelfRecords]);

  // Group stocked bottles into wooden shelf rows for the scene.
  const shelfRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < shelfRecords.length; i += SHELF_SIZE) {
      rows.push(shelfRecords.slice(i, i + SHELF_SIZE));
    }
    return rows;
  }, [shelfRecords]);

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
    // P3: pixel sparkle on the newest arrival
    setLastAdded(clean);
    setTimeout(() => setLastAdded(cur => (cur === clean ? null : cur)), 1400);
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

  // Save edits from the bottle edit sheet (or remove the bottle entirely).
  const saveBottle = useCallback((ingredient, patch) => {
    if (patch && patch.__remove) {
      removeItem(ingredient);
      setEditingBottle(null);
      return;
    }
    setShelfRecords(prev => prev.map(r => (r.ingredient === ingredient ? { ...r, ...patch } : r)));
    updateBarBottle(ingredient, patch);
    setEditingBottle(null);
  }, [removeItem]);

  // Exit party mode behind a confirm so guests can't leave by accident.
  const exitParty = useCallback(() => {
    if (window.confirm('Exit Party Mode?')) { setPartyMode(false); setShowDrinks(false); }
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
  // aware, with derivable-ingredient inference).
  const scoredDrinks = useMemo(() => {
    if (shelfItems.length === 0) return [];
    return drinks
      .map(drink => {
        const match = matchDrink(drink, shelfItems);
        if (match.total === 0) return null;
        return { drink, match };
      })
      .filter(Boolean)
      .filter(s => s.match.matchedCount > 0 || s.match.derivable.length > 0)
      .sort((a, b) =>
        b.match.score - a.match.score || a.match.missing.length - b.match.missing.length
      );
  }, [drinks, shelfItems]);

  // Party mode always shows only makeable drinks (ready + almost).
  const tierFiltered = (partyMode || matchMode === 'strict')
    ? scoredDrinks.filter(s => s.match.tier === 'ready' || s.match.tier === 'almost')
    : scoredDrinks;

  // P3: optional "using: <ingredient>" filter — alias-aware via matchDrink.
  const filteredResults = useMemo(() => {
    if (!drinksFilter) return tierFiltered;
    return tierFiltered.filter(({ drink }) => matchDrink(drink, [drinksFilter]).matchedCount > 0);
  }, [tierFiltered, drinksFilter]);

  // P3: recipes this specific bottle unlocks (memoized per bottle, alias-aware).
  const editingUnlocks = useMemo(() => {
    if (!editingBottle) return 0;
    return drinks.filter(d => matchDrink(d, [editingBottle.ingredient]).matchedCount > 0).length;
  }, [editingBottle, drinks]);

  // P3: "Unlocks N recipes" tap-through → drinks panel pre-filtered to this bottle.
  const showUnlocksFor = useCallback((ingredient) => {
    setEditingBottle(null);
    setDrinksFilter(ingredient);
    setShowDrinks(true);
    if (navigator.vibrate) navigator.vibrate(12);
  }, []);

  // P3: Run Dry — mark EMPTY (silhouette on shelf) + push to grocery quest.
  const runDry = useCallback((record) => {
    setShelfRecords(prev => prev.map(r => (r.ingredient === record.ingredient ? { ...r, qtyLevel: 'EMPTY' } : r)));
    updateBarBottle(record.ingredient, { qtyLevel: 'EMPTY' });
    if (onAddToGrocery) {
      onAddToGrocery([{
        name: record.displayName || record.ingredient,
        tag: 'bar-quest',
        questName: 'Run Dry',
      }]);
    }
    if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    setEditingBottle(null);
  }, [onAddToGrocery]);

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

  const drinksOpen = showDrinks || partyMode;

  const bfmEmptyContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const bfmEmptyItemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } },
  };

  // Bottles cascade onto the shelves when the room opens — shelf by shelf,
  // each bottle popping in with a little spring. Fun without being janky.
  const shelvesContainerV = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  };
  const shelfRowV = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.035 } },
  };
  const bottlePopV = {
    hidden: { opacity: 0, scale: 0.5, y: 8 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 480, damping: 22 } },
  };

  return (
    <div className="mybar-overlay" onClick={partyMode ? undefined : onClose}>
      <motion.div
        className={`mybar-room ${partyMode ? 'mybar-party' : ''}`}
        onClick={e => e.stopPropagation()}
        drag={partyMode ? false : 'y'} dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={partyMode ? undefined : handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        {!partyMode && (
          <div className="bfm-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />
        )}

        {/* Top bar */}
        <div className="mybar-topbar">
          <div className="mybar-title-wrap">
            <span className="mybar-title">{partyMode ? 'PARTY MENU' : 'MY BAR'}</span>
            <span className="mybar-sub">
              {loaded ? `${shelfRecords.length} on the shelf` : 'loading…'}
            </span>
          </div>
          <div className="mybar-topbar-actions">
            {!partyMode && shelfItems.length > 0 && (
              <button className="mybar-icon-btn" onClick={() => setPartyMode(true)} title="Party mode (read-only)">
                👥
              </button>
            )}
            {partyMode
              ? <button className="mybar-exit-btn" onClick={exitParty} title="Exit Party Mode">Exit</button>
              : <button className="mybar-icon-btn" onClick={onClose} title="Close">✕</button>}
          </div>
        </div>

        {/* Add row + quick chips (hidden in party mode) */}
        {!partyMode && (
          <div className="mybar-stock">
            <div className="mybar-add-row">
              <input
                type="text"
                className="mybar-input"
                placeholder="Add a bottle or mixer…"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className="mybar-add-btn" onClick={() => addItem()} disabled={!inputValue.trim()}>
                + Add
              </button>
            </div>
            <div className="mybar-quick">
              <button className="mybar-browse-chip" onClick={() => setShowCatalog(true)}>
                🍾 Browse ingredients
              </button>
              {QUICK_ADDS.filter(item => !hasItem(item)).slice(0, 8).map(item => (
                <button key={item} className="mybar-quick-chip" onClick={() => quickAdd(item)}>
                  + {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scene: brick wall + wooden shelves of sprites */}
        <div className="mybar-scene">
          <div className="mybar-wall" aria-hidden="true" />
          <div className="mybar-cactus" aria-hidden="true">🌵</div>

          {shelfRows.length === 0 ? (
            <motion.div className="mybar-empty" variants={bfmEmptyContainerVariants} initial="hidden" animate="visible">
              <motion.span className="mybar-empty-icon" variants={bfmEmptyItemVariants}>🥃</motion.span>
              <motion.p variants={bfmEmptyItemVariants}>Your shelves are empty.</motion.p>
              <motion.p className="mybar-empty-sub" variants={bfmEmptyItemVariants}>
                Add spirits &amp; mixers above to stock your bar and see what you can make.
              </motion.p>
            </motion.div>
          ) : (
            <motion.div className="mybar-shelves" variants={shelvesContainerV} initial="hidden" animate="visible">
              {shelfRows.map((row, ri) => (
                <motion.div className="mybar-shelf" key={ri} variants={shelfRowV}>
                  <div className="mybar-shelf-row">
                    {row.map(rec => {
                      const isDry = rec.qtyLevel === 'EMPTY';
                      const isSparkling = rec.ingredient === lastAdded;
                      return (
                        <motion.button
                          key={rec.ingredient}
                          type="button"
                          className={[
                            'mybar-bottle',
                            isDry ? 'mybar-bottle--dry' : '',
                            isSparkling ? 'mybar-bottle--sparkle' : '',
                          ].filter(Boolean).join(' ')}
                          variants={bottlePopV}
                          whileTap={{ scale: 0.9, y: 2 }}
                          onClick={() => { if (!partyMode) setEditingBottle(rec); }}
                          title={isDry ? `${rec.displayName || rec.ingredient} — run dry` : (rec.displayName || rec.ingredient)}
                        >
                          <IngredientSprite name={rec.ingredient} size={48} />
                          {isDry && <span className="mybar-bottle-dry-tag" aria-hidden="true">DRY</span>}
                          {isSparkling && (
                            <span className="mybar-bottle-sparkles" aria-hidden="true">
                              <i>✦</i><i>✧</i><i>✦</i>
                            </span>
                          )}
                          <span className="mybar-bottle-label">
                            {rec.brand || rec.displayName || rec.ingredient}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                  <div className="mybar-shelf-board" aria-hidden="true" />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* Bar counter: FRIDGE 2000 counter + doorway + Drinks button */}
        <div className="mybar-counter">
          <div className="mybar-fridge" title="Items on your shelf">
            <span className="mybar-fridge-brand">FRIDGE</span>
            <span className="mybar-fridge-count">{String(shelfRecords.length).padStart(3, '0')}</span>
            <span className="mybar-fridge-model">2000</span>
          </div>

          {onOpenSaloon && (
            <button className="mybar-doorway" onClick={() => onOpenSaloon()} title="Enter the Saloon">
              <span className="mybar-doorway-arch" aria-hidden="true" />
              <span className="mybar-doorway-label">SALOON »</span>
            </button>
          )}

          <button className="mybar-drinks-btn" onClick={() => setShowDrinks(true)}>
            DRINKS
            <span className="mybar-drinks-badge">{perfectMatches + closeMatches}</span>
            »
          </button>
        </div>

        {/* Slide-up makeable-drinks panel */}
        <AnimatePresence>
          {drinksOpen && (
            <motion.div
              className="mybar-drinks-panel"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="mybar-drinks-head">
                <div className="bfm-summary-stats">
                  {perfectMatches > 0 && <span className="bfm-stat bfm-stat-perfect">{perfectMatches} ready to pour</span>}
                  {closeMatches > 0 && <span className="bfm-stat bfm-stat-close">{closeMatches} almost there</span>}
                  {perfectMatches === 0 && closeMatches === 0 && <span className="bfm-stat">Add more to unlock drinks</span>}
                </div>
                {partyMode
                  ? <button className="mybar-panel-close" onClick={exitParty}>Exit</button>
                  : <button className="mybar-panel-close" onClick={() => { setShowDrinks(false); setDrinksFilter(null); }}>Close</button>}
              </div>

              {/* P3: active "using: X" filter chip */}
              {drinksFilter && (
                <div className="bfm-filter-chip-row">
                  <button className="bfm-filter-chip" onClick={() => setDrinksFilter(null)} title="Clear filter">
                    <IngredientSprite name={drinksFilter} size={18} />
                    <span>using: {drinksFilter}</span>
                    <span className="bfm-filter-chip-x" aria-hidden="true">✕</span>
                  </button>
                </div>
              )}

              <div className="bfm-results-summary">
                {!partyMode && (
                  <div className="bfm-mode-toggle">
                    <button className={`bfm-mode-btn ${matchMode === 'best' ? 'active' : ''}`} onClick={() => setMatchMode('best')}>All</button>
                    <button className={`bfm-mode-btn ${matchMode === 'strict' ? 'active' : ''}`} onClick={() => setMatchMode('strict')}>Ready</button>
                  </div>
                )}
                {scoredDrinks.length > 0 && (
                  <button className="bfm-surprise-btn" onClick={surpriseMe} title="Pour something at random">
                    🎲 Surprise me
                  </button>
                )}
              </div>

              <div className="bfm-results mybar-results">
                {filteredResults.length === 0 ? (
                  <div className="bfm-empty">
                    <span className="bfm-empty-icon">😔</span>
                    <p>No cocktails match your bottles yet. Add more spirits or mixers!</p>
                  </div>
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
                            {missingCount > 0 && <span className="bfm-match-missing"> · {missingCount} missing</span>}
                          </p>
                          {derivable.length > 0 && (
                            <p className="bfm-derivable-list">
                              🧪 You can make: {derivable.map(d => d.result).slice(0, 2).join(', ')}
                            </p>
                          )}
                          {missingCount > 0 && missingCount <= 3 && (
                            <p className="bfm-missing-list">Need: {missing.slice(0, 3).join(', ')}</p>
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottle edit sheet */}
        <AnimatePresence>
          {editingBottle && (
            <BottleEditSheet
              key={editingBottle.ingredient}
              record={editingBottle}
              unlockCount={editingUnlocks}
              onShowUnlocks={showUnlocksFor}
              onRunDry={runDry}
              onSave={saveBottle}
              onClose={() => setEditingBottle(null)}
            />
          )}
        </AnimatePresence>

        {/* Browse premade ingredients */}
        <AnimatePresence>
          {showCatalog && (
            <IngredientCatalog
              key="ingredient-catalog"
              stocked={new Set(shelfItems)}
              onAdd={addByName}
              onRemove={removeItem}
              onClose={() => setShowCatalog(false)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Bottle sheet — RPG item card ──────────────────────────────────────────────
// Opens in VIEW mode (big sprite, semantic stock bar, "Unlocks N recipes",
// Run Dry). The ✏ button flips to EDIT mode with per-category placeholders.
// Writes through updateBarBottle (via the parent's onSave). qtyLevel is the
// semantic enum (string); legacy free-text qty is preserved untouched.
function BottleEditSheet({ record, unlockCount, onShowUnlocks, onRunDry, onSave, onClose }) {
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [brand, setBrand] = useState(record.brand || '');
  const [subcategory, setSubcategory] = useState(record.subcategory || '');
  const [notes, setNotes] = useState(record.notes || '');
  const [qtyLevel, setQtyLevel] = useState(
    QTY_LEVELS.includes(record.qtyLevel) ? record.qtyLevel : 'FULL'
  );

  const ph = placeholdersFor(record.category, record.ingredient);
  const displayName = record.displayName || record.ingredient;
  const fill = QTY_FILL[qtyLevel];

  const stepQty = (dir) => {
    const idx = QTY_LEVELS.indexOf(qtyLevel);
    const next = QTY_LEVELS[Math.max(0, Math.min(QTY_LEVELS.length - 1, idx + dir))];
    if (next !== qtyLevel) {
      setQtyLevel(next);
      if (navigator.vibrate) navigator.vibrate(8);
    }
  };

  const handleStash = () => {
    onSave(record.ingredient, {
      brand: brand.trim() || undefined,
      subcategory: subcategory.trim() || undefined,
      notes: notes.trim() || undefined,
      qtyLevel,
    });
  };

  // Quick save for view-mode qty changes (no form fields touched)
  const handleQtyCommit = (next) => {
    onSave(record.ingredient, { qtyLevel: next });
  };

  return (
    <div className="bfm-edit-overlay" onClick={onClose}>
      <motion.div
        className={`bfm-edit-sheet bfm-sheet--${mode}`}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="bfm-edit-header">
          <span className={`bfm-edit-sprite${mode === 'view' ? ' bfm-edit-sprite--big' : ''}`} aria-hidden="true">
            <IngredientSprite name={record.ingredient} size={mode === 'view' ? 64 : 40} />
          </span>
          <div className="bfm-edit-titlewrap">
            <h3 className="bfm-edit-title">{displayName}</h3>
            <div className="bfm-edit-badges">
              {record.category && <span className="bfm-edit-cat">{record.category}</span>}
              {record.subcategory && <span className="bfm-edit-cat bfm-edit-cat--sub">{record.subcategory}</span>}
              {record.brand && <span className="bfm-edit-cat bfm-edit-cat--brand">{record.brand}</span>}
              {getDomainFlags(record.ingredient).canBoth && (
                <span className="dual-duty-tag" title="Double duty — works in cocktails and cooking">🍸🍳</span>
              )}
            </div>
          </div>
          {mode === 'view' && (
            <button className="bfm-edit-pencil" onClick={() => setMode('edit')} title="Edit details" aria-label="Edit details">
              ✏
            </button>
          )}
        </div>

        {mode === 'view' ? (
          <>
            {/* ── Semantic stock bar with stepper ── */}
            <div className="bfm-stock-row">
              <button className="bfm-stock-step" onClick={() => stepQty(-1)} disabled={fill === 0} aria-label="Less stock">−</button>
              <div className="bfm-stock-bar" role="meter" aria-valuemin={0} aria-valuemax={3} aria-valuenow={fill} aria-label={`Stock: ${QTY_LABEL[qtyLevel]}`}>
                {QTY_LEVELS.slice(1).map((lvl, i) => (
                  <span key={lvl} className={`bfm-stock-cell${fill > i ? ' bfm-stock-cell--on' : ''}`} />
                ))}
                <span className="bfm-stock-label">{QTY_LABEL[qtyLevel]}</span>
              </div>
              <button className="bfm-stock-step" onClick={() => stepQty(1)} disabled={fill === 3} aria-label="More stock">+</button>
            </div>

            {/* ── Unlocks stat — taps through to the drinks panel filtered ── */}
            <button
              className="bfm-unlocks-btn"
              onClick={() => onShowUnlocks(record.ingredient)}
              disabled={!unlockCount}
            >
              🔓 Unlocks {unlockCount || 0} recipe{unlockCount === 1 ? '' : 's'}
              {unlockCount > 0 && <span className="bfm-unlocks-arrow" aria-hidden="true">»</span>}
            </button>

            {record.notes && <p className="bfm-view-notes">“{record.notes}”</p>}

            <div className="bfm-edit-actions">
              <button className="bfm-edit-cancel" onClick={onClose}>Close</button>
              <button
                className="bfm-edit-remove bfm-rundry-btn"
                onClick={() => onRunDry(record)}
                title="Mark empty and add to grocery quest"
              >
                🫙 RUN DRY
              </button>
              <button className="bfm-edit-save" onClick={() => handleQtyCommit(qtyLevel)}>STASH</button>
            </div>
          </>
        ) : (
          <>
            <label className="bfm-edit-field">
              <span>Brand</span>
              <input type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder={ph.brand} />
            </label>
            <label className="bfm-edit-field">
              <span>Style / subcategory</span>
              <input type="text" value={subcategory} onChange={e => setSubcategory(e.target.value)} placeholder={ph.style} />
            </label>
            <label className="bfm-edit-field">
              <span>Notes</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Tasting notes, where to buy…" />
            </label>

            <div className="bfm-edit-actions">
              <button className="bfm-edit-cancel" onClick={() => setMode('view')}>Back</button>
              <button className="bfm-edit-remove" onClick={() => onSave(record.ingredient, { __remove: true })}>TOSS</button>
              <button className="bfm-edit-save" onClick={handleStash}>STASH</button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
