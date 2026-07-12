import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { addToBarInventory, removeFromBarInventory, updateBarBottle } from '../db';
import { canonicalizeIngredient } from '../lib/barMatch';
import {
  getInventory,
  QTY_LEVELS, QTY_FILL, QTY_LABEL,
  KITCHEN_STAPLES, isStaple, categorizeKitchen, getDomainFlags,
  STORAGE_TIPS, freshnessOf,
} from '../lib/pantryDomain';
import { IngredientSprite } from '../lib/barSprites.jsx';

/**
 * PantryMode — the Kitchen Pantry (P5). The "daytime" counterpart to the
 * Saloon: a clean, upscale, morning-lit pantry over the SAME master inventory
 * store the Bar uses (lib/pantryDomain getInventory({domain:'kitchen'})).
 *
 * - STAPLES cabinet: permanent basics that default to In Stock; tap to manage.
 * - FRESH shelf: perishables the user actively tracks, with freshness dots.
 * - "WHAT CAN I COOK?": proximity match against the Meal Library — ready
 *   (0 missing) and almost-there (1–2 missing, one-tap add to grocery).
 * - Gourmet ledger card: qty stepper (shared semantic enum), storage tip,
 *   "Cook with this" pipeline into the matches panel.
 *
 * Supersedes the old ephemeral FridgeMode (same entry points, persistent data).
 */

const FRESH_QUICK_ADDS = [
  'chicken breast', 'ground beef', 'eggs', 'milk', 'cheddar cheese',
  'spinach', 'tomatoes', 'bell peppers', 'mushrooms', 'potatoes',
  'lemons', 'cilantro',
];

// ── Simple, alias-light meal matcher (proximity match) ───────────────────────
// Canonicalizes both sides, then whole-word containment either direction —
// the same containment rule matchIngredients uses in the Saloon.
function ingredientInPantry(ingCanon, pantryTokens) {
  if (!ingCanon) return false;
  if (pantryTokens.has(ingCanon)) return true;
  const ingWords = ingCanon.split(' ');
  for (const token of pantryTokens) {
    const tokWords = token.split(' ');
    if (tokWords.every(w => ingWords.includes(w))) return true;
    if (ingWords.every(w => tokWords.includes(w))) return true;
  }
  return false;
}

export function matchMealAgainstPantry(meal, pantryTokens) {
  const ingredients = Array.isArray(meal?.ingredients) ? meal.ingredients : [];
  const matched = [];
  const missing = [];
  for (const ing of ingredients) {
    const canon = canonicalizeIngredient(ing);
    if (ingredientInPantry(canon, pantryTokens)) matched.push(ing);
    else missing.push(ing);
  }
  const total = ingredients.length;
  return {
    matched,
    missing,
    total,
    score: total ? matched.length / total : 0,
    tier: total === 0 ? 'none' : missing.length === 0 ? 'ready' : missing.length <= 2 ? 'almost' : 'far',
  };
}

export default function PantryMode({ meals, onViewDetail, onClose, onAddToGrocery, initialShowMatches = false }) {
  const dragControls = useDragControls();
  const handleSheetDragEnd = useCallback((_e, info) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }, [onClose]);

  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [ledger, setLedger] = useState(null);       // record (or virtual staple) being inspected
  const [showMatches, setShowMatches] = useState(initialShowMatches);
  const [matchFilter, setMatchFilter] = useState(null); // "cook with this" ingredient
  const [justAdded, setJustAdded] = useState(null);

  // Load the kitchen slice of the unified inventory.
  useEffect(() => {
    getInventory({ domain: 'kitchen' }).then((recs) => {
      setRecords(recs);
      setLoaded(true);
    });
  }, []);

  const recordByName = useCallback(
    (name) => records.find(r => r.ingredient === String(name).toLowerCase().trim()),
    [records]
  );

  // A staple is "in stock" unless its record explicitly says EMPTY.
  const stapleStocked = useCallback((name) => {
    const rec = recordByName(name);
    return !rec || rec.qtyLevel !== 'EMPTY';
  }, [recordByName]);

  // Perishables = tracked records that aren't staples.
  const perishables = useMemo(
    () => records.filter(r => !isStaple(r.ingredient)),
    [records]
  );

  // ── Pantry tokens for the matcher: staples in stock + tracked non-empty ──
  const pantryTokens = useMemo(() => {
    const tokens = new Set();
    for (const s of KITCHEN_STAPLES) {
      if (stapleStocked(s)) tokens.add(canonicalizeIngredient(s));
    }
    for (const r of records) {
      if (r.qtyLevel !== 'EMPTY') tokens.add(canonicalizeIngredient(r.ingredient));
    }
    return tokens;
  }, [records, stapleStocked]);

  // ── Proximity match across the Meal Library ───────────────────────────────
  const scoredMeals = useMemo(() => {
    if (!meals || meals.length === 0) return [];
    return meals
      .map(meal => ({ meal, match: matchMealAgainstPantry(meal, pantryTokens) }))
      .filter(({ match }) => match.total > 0 && match.matched.length > 0)
      .sort((a, b) =>
        b.match.score - a.match.score || a.match.missing.length - b.match.missing.length
      );
  }, [meals, pantryTokens]);

  const filteredMeals = useMemo(() => {
    if (!matchFilter) return scoredMeals;
    const f = matchFilter.toLowerCase();
    return scoredMeals.filter(({ meal }) =>
      (meal.ingredients || []).some(i => i.toLowerCase().includes(f))
    );
  }, [scoredMeals, matchFilter]);

  const readyCount = scoredMeals.filter(s => s.match.tier === 'ready').length;
  const almostCount = scoredMeals.filter(s => s.match.tier === 'almost').length;

  // ── Mutations (single writer path → Dexie barInventory via db helpers) ────
  const addFresh = useCallback((rawName) => {
    const clean = String(rawName || '').trim().toLowerCase();
    if (!clean || recordByName(clean)) return;
    const optimistic = {
      ingredient: clean,
      displayName: clean,
      category: categorizeKitchen(clean)?.category || null,
      qtyLevel: 'FULL',
      addedAt: new Date().toISOString(),
    };
    setRecords(prev => [...prev, optimistic]);
    addToBarInventory(clean, { qtyLevel: 'FULL' });
    setJustAdded(clean);
    setTimeout(() => setJustAdded(cur => (cur === clean ? null : cur)), 1200);
    if (navigator.vibrate) navigator.vibrate(10);
  }, [recordByName]);

  const setLevel = useCallback((name, qtyLevel, { restock = false } = {}) => {
    const key = String(name).toLowerCase().trim();
    const patch = restock
      ? { qtyLevel, addedAt: new Date().toISOString() }
      : { qtyLevel };
    setRecords(prev => {
      const exists = prev.some(r => r.ingredient === key);
      if (exists) return prev.map(r => (r.ingredient === key ? { ...r, ...patch } : r));
      // Virtual staple getting its first explicit state → materialize a record.
      addToBarInventory(key, patch);
      return [...prev, { ingredient: key, displayName: key, category: categorizeKitchen(key)?.category || null, ...patch, addedAt: patch.addedAt || new Date().toISOString() }];
    });
    updateBarBottle(key, patch);
  }, []);

  const removeItem = useCallback((name) => {
    const key = String(name).toLowerCase().trim();
    setRecords(prev => prev.filter(r => r.ingredient !== key));
    removeFromBarInventory(key);
    setLedger(null);
  }, []);

  const openLedger = useCallback((name) => {
    const rec = recordByName(name) || {
      ingredient: String(name).toLowerCase().trim(),
      displayName: name,
      qtyLevel: 'FULL',
      _virtualStaple: true,
    };
    setLedger(rec);
    if (navigator.vibrate) navigator.vibrate(8);
  }, [recordByName]);

  const cookWithThis = useCallback((name) => {
    setLedger(null);
    setMatchFilter(name);
    setShowMatches(true);
    if (navigator.vibrate) navigator.vibrate(12);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); addFresh(inputValue); setInputValue(''); }
  }, [addFresh, inputValue]);

  // ── Entry animation variants ───────────────────────────────────────────────
  const zoneV = { hidden: {}, visible: { transition: { staggerChildren: 0.025, delayChildren: 0.08 } } };
  const tileV = {
    hidden: { opacity: 0, y: 10, scale: 0.92 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 26 } },
  };

  const freshDotTitle = { fresh: 'Fresh', aging: 'Use soon', old: 'Use it up!' };

  return (
    <div className="pm-overlay" onClick={onClose}>
      <motion.div
        className="pm-room"
        onClick={e => e.stopPropagation()}
        drag="y" dragListener={false} dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 30 }}
        onDragEnd={handleSheetDragEnd}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="pm-handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />

        {/* ── Topbar — morning light, brass hardware ── */}
        <div className="pm-topbar">
          <div>
            <h2 className="pm-title">THE PANTRY</h2>
            <p className="pm-sub">
              {loaded ? `${perishables.length} fresh · ${KITCHEN_STAPLES.filter(stapleStocked).length}/${KITCHEN_STAPLES.length} staples stocked` : 'opening the cabinets…'}
            </p>
          </div>
          <button className="pm-close" onClick={onClose} aria-label="Close pantry">✕</button>
        </div>

        {/* ── Add row ── */}
        <div className="pm-add-row">
          <input
            type="text"
            className="pm-input"
            placeholder="Add something fresh…"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="pm-add-btn"
            onClick={() => { addFresh(inputValue); setInputValue(''); }}
            disabled={!inputValue.trim()}
          >
            + Add
          </button>
        </div>
        <div className="pm-quick">
          {FRESH_QUICK_ADDS.filter(i => !recordByName(i)).slice(0, 7).map(item => (
            <button key={item} className="pm-quick-chip" onClick={() => addFresh(item)}>
              + {item}
            </button>
          ))}
        </div>

        {/* ── Scene: fresh shelf + staples cabinet ── */}
        <div className="pm-scene">
          {/* FRESH — actively tracked perishables */}
          <div className="pm-zone">
            <h3 className="pm-zone-title"><span aria-hidden="true">🧺</span> FRESH</h3>
            {perishables.length === 0 ? (
              <p className="pm-zone-empty">
                Nothing fresh being tracked yet — add groceries above and the
                pantry starts matching meals you can cook tonight.
              </p>
            ) : (
              <motion.div className="pm-grid" variants={zoneV} initial="hidden" animate="visible">
                {perishables.map(rec => {
                  const fr = rec.qtyLevel === 'EMPTY' ? null : freshnessOf(rec.addedAt);
                  const isDry = rec.qtyLevel === 'EMPTY';
                  return (
                    <motion.button
                      key={rec.ingredient}
                      type="button"
                      className={[
                        'pm-tile',
                        'pm-tile--fresh',
                        isDry ? 'pm-tile--out' : '',
                        rec.ingredient === justAdded ? 'pm-tile--new' : '',
                      ].filter(Boolean).join(' ')}
                      variants={tileV}
                      whileTap={{ scale: 0.93 }}
                      onClick={() => openLedger(rec.ingredient)}
                      title={rec.displayName || rec.ingredient}
                    >
                      <span className="pm-tile-dish">
                        <IngredientSprite name={rec.ingredient} size={36} />
                      </span>
                      <span className="pm-tile-name">{rec.displayName || rec.ingredient}</span>
                      {fr && <span className={`pm-fresh-dot pm-fresh-dot--${fr}`} title={freshDotTitle[fr]} aria-label={freshDotTitle[fr]} />}
                      {isDry && <span className="pm-out-tag">OUT</span>}
                      {getDomainFlags(rec.ingredient).canBoth && (
                        <span className="dual-duty-tag dual-duty-tag--tile" title="Double duty — bar & kitchen">🍸🍳</span>
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </div>

          {/* STAPLES — default in stock; dim when marked out */}
          <div className="pm-zone">
            <h3 className="pm-zone-title"><span aria-hidden="true">🏺</span> STAPLES <span className="pm-zone-hint">always assumed stocked — tap if you run out</span></h3>
            <motion.div className="pm-grid pm-grid--staples" variants={zoneV} initial="hidden" animate="visible">
              {KITCHEN_STAPLES.map(name => {
                const stocked = stapleStocked(name);
                return (
                  <motion.button
                    key={name}
                    type="button"
                    className={`pm-tile pm-tile--staple ${stocked ? '' : 'pm-tile--out'}`}
                    variants={tileV}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => openLedger(name)}
                    title={stocked ? name : `${name} — out of stock`}
                  >
                    <span className="pm-tile-dish pm-tile-dish--jar">
                      <IngredientSprite name={name} size={30} />
                    </span>
                    <span className="pm-tile-name">{name}</span>
                    {!stocked && <span className="pm-out-tag">OUT</span>}
                  </motion.button>
                );
              })}
            </motion.div>
          </div>
        </div>

        {/* ── Counter: what can I cook ── */}
        <div className="pm-counter">
          <button className="pm-cook-btn" onClick={() => setShowMatches(true)}>
            WHAT CAN I COOK?
            <span className="pm-cook-badge">{readyCount + almostCount}</span>
          </button>
        </div>

        {/* ── Matches panel — proximity match ── */}
        <AnimatePresence>
          {showMatches && (
            <motion.div
              className="pm-matches-panel"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="pm-matches-head">
                <div className="pm-matches-stats">
                  {readyCount > 0 && <span className="pm-stat pm-stat--ready">{readyCount} ready tonight</span>}
                  {almostCount > 0 && <span className="pm-stat pm-stat--almost">{almostCount} almost there</span>}
                  {readyCount === 0 && almostCount === 0 && <span className="pm-stat">Stock more to unlock dinners</span>}
                </div>
                <button className="pm-panel-close" onClick={() => { setShowMatches(false); setMatchFilter(null); }}>Close</button>
              </div>

              {matchFilter && (
                <div className="pm-filter-row">
                  <button className="pm-filter-chip" onClick={() => setMatchFilter(null)} title="Clear filter">
                    cooking with: <strong>{matchFilter}</strong> <span aria-hidden="true">✕</span>
                  </button>
                </div>
              )}

              <div className="pm-matches-scroll">
                {filteredMeals.length === 0 ? (
                  <div className="pm-matches-empty">
                    <span aria-hidden="true">🍳</span>
                    <p>No matches yet — add a few more ingredients, or import more recipes.</p>
                  </div>
                ) : (
                  filteredMeals.slice(0, 40).map(({ meal, match }) => (
                    <div
                      key={meal.id}
                      className={`pm-meal-card ${match.tier === 'ready' ? 'pm-meal-card--ready' : ''}`}
                      onClick={() => onViewDetail(meal)}
                    >
                      <div className="pm-meal-imgzone">
                        {meal.imageUrl
                          ? <img src={meal.imageUrl} alt="" className="pm-meal-img" onError={e => { e.target.style.display = 'none'; }} />
                          : <div className="pm-meal-img-ph" aria-hidden="true">🍽</div>}
                        <span className={`pm-meal-score pm-meal-score--${match.tier}`}>
                          {match.matched.length}/{match.total}
                        </span>
                      </div>
                      <div className="pm-meal-info">
                        <h4 className="pm-meal-name">{meal.name}</h4>
                        {match.tier === 'ready' ? (
                          <p className="pm-meal-line pm-meal-line--ready">You have everything. Tonight?</p>
                        ) : (
                          <p className="pm-meal-line">
                            Missing{' '}
                            {match.missing.slice(0, 2).map((m, i) => (
                              <span key={m} className="pm-missing-hl">{i > 0 ? ', ' : ''}{m}</span>
                            ))}
                            {match.missing.length > 2 && ` +${match.missing.length - 2} more`}
                          </p>
                        )}
                      </div>
                      {match.tier === 'almost' && onAddToGrocery && (
                        <button
                          className="pm-meal-grab"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToGrocery(match.missing.map(ing => ({
                              name: ing,
                              tag: 'bar-quest',
                              questName: meal.name,
                            })));
                            if (navigator.vibrate) navigator.vibrate([25, 15, 25]);
                          }}
                          title="Add missing to grocery list"
                        >
                          +🛒
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Gourmet ledger card ── */}
        <AnimatePresence>
          {ledger && (() => {
            const kcat = categorizeKitchen(ledger.ingredient);
            const staple = isStaple(ledger.ingredient);
            const level = QTY_LEVELS.includes(ledger.qtyLevel) ? ledger.qtyLevel : 'FULL';
            const fill = QTY_FILL[level];
            const fr = !staple && level !== 'EMPTY' ? freshnessOf(ledger.addedAt) : null;
            const step = (dir) => {
              const idx = QTY_LEVELS.indexOf(level);
              const next = QTY_LEVELS[Math.max(0, Math.min(QTY_LEVELS.length - 1, idx + dir))];
              if (next === level) return;
              setLevel(ledger.ingredient, next, { restock: dir > 0 && next === 'FULL' });
              setLedger(l => ({ ...l, qtyLevel: next, addedAt: dir > 0 && next === 'FULL' ? new Date().toISOString() : l.addedAt }));
            };
            return (
              <div className="pm-ledger-overlay" onClick={() => setLedger(null)}>
                <motion.div
                  className="pm-ledger"
                  role="dialog"
                  aria-label={ledger.displayName || ledger.ingredient}
                  onClick={e => e.stopPropagation()}
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                >
                  <div className="pm-ledger-head">
                    <span className="pm-ledger-sprite"><IngredientSprite name={ledger.ingredient} size={56} /></span>
                    <div className="pm-ledger-titles">
                      <h3 className="pm-ledger-name">{ledger.displayName || ledger.ingredient}</h3>
                      <div className="pm-ledger-tags">
                        {kcat && <span className="pm-ledger-cat">{kcat.emoji} {kcat.category}</span>}
                        {staple && <span className="pm-ledger-cat pm-ledger-cat--staple">staple</span>}
                        {getDomainFlags(ledger.ingredient).canBoth && (
                          <span className="dual-duty-tag" title="Double duty — bar & kitchen">🍸🍳</span>
                        )}
                      </div>
                    </div>
                    <button className="pm-ledger-close" onClick={() => setLedger(null)} aria-label="Close">✕</button>
                  </div>

                  {/* Stock stepper — shared semantic enum */}
                  <div className="pm-stock-row">
                    <button className="pm-stock-step" onClick={() => step(-1)} disabled={fill === 0} aria-label="Less stock">−</button>
                    <div className="pm-stock-bar" role="meter" aria-valuemin={0} aria-valuemax={3} aria-valuenow={fill} aria-label={`Stock: ${QTY_LABEL[level]}`}>
                      {QTY_LEVELS.slice(1).map((lvl, i) => (
                        <span key={lvl} className={`pm-stock-cell${fill > i ? ' pm-stock-cell--on' : ''}`} />
                      ))}
                    </div>
                    <button className="pm-stock-step" onClick={() => step(1)} disabled={fill === 3} aria-label="More stock">+</button>
                  </div>
                  <p className="pm-stock-label">{QTY_LABEL[level]}{fr ? ` · ${freshDotTitle[fr].toLowerCase()}` : ''}</p>

                  {kcat && STORAGE_TIPS[kcat.category] && (
                    <p className="pm-ledger-tip"><span aria-hidden="true">💡</span> {STORAGE_TIPS[kcat.category]}</p>
                  )}

                  <div className="pm-ledger-actions">
                    {!staple && !ledger._virtualStaple && (
                      <button className="pm-ledger-remove" onClick={() => removeItem(ledger.ingredient)}>Remove</button>
                    )}
                    <button className="pm-ledger-cook" onClick={() => cookWithThis(ledger.displayName || ledger.ingredient)}>
                      🍳 Cook with this
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
