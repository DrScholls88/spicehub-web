import { useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { IngredientSprite } from '../lib/barSprites.jsx';
import { INGREDIENT_CATALOG } from '../data/pantry/ingredientCatalog';
import { getDomainFlags } from '../lib/pantryDomain';

/**
 * PantryIngredientCatalog — the Pantry's own "browse everything" sheet,
 * mirroring components/IngredientCatalog.jsx (the Bar's apothecary rack)
 * one-for-one in structure: search, collapsible sections, sticky jump-dock,
 * silhouette-wake tiles. Reskinned with a `pcat-` class prefix in Pantry's
 * warm cream/brass palette (see .pm-tile in App.css) instead of the Bar's
 * `cat-` classes, so the two can evolve independently.
 *
 * This is the "massively expanded" item list (400+, see
 * data/pantry/ingredientCatalog.js) — separate from the small curated
 * FRESH_QUICK_ADDS chips in PantryMode, which stay as fast one-tap defaults.
 * Tapping a tile here adds/removes it as a tracked Fresh item (the same
 * addFresh/removeItem path PantryMode already uses), never a Staple —
 * staples live permanently in the Staples Vault and this catalog
 * deliberately excludes every KITCHEN_STAPLES name (see the data file's own
 * header comment and pantryIngredientCatalog.test.js's invariant).
 *
 * Props:
 *   stocked  : Set<string> of canonical lowercase ingredient names currently
 *              tracked as Fresh (so already-added items show "on" here too)
 *   onAdd    : (name) => void   — PantryMode's addFresh
 *   onRemove : (name) => void   — PantryMode's removeItem
 *   onClose  : () => void
 */
export default function PantryIngredientCatalog({ stocked, onAdd, onRemove, onClose }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const sectionRefs = useRef({});
  const stockedSet = stocked instanceof Set ? stocked : new Set(stocked || []);

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!q) return INGREDIENT_CATALOG;
    return INGREDIENT_CATALOG
      .map((c) => ({ ...c, items: c.items.filter((n) => n.toLowerCase().includes(q)) }))
      .filter((c) => c.items.length > 0);
  }, [q]);

  const stockedCount = stockedSet.size;

  const toggle = useCallback((name) => {
    const key = name.toLowerCase();
    if (stockedSet.has(key)) {
      onRemove?.(key);
    } else {
      onAdd?.(name);
      if (navigator.vibrate) navigator.vibrate(12);
    }
  }, [stockedSet, onAdd, onRemove]);

  const toggleSection = useCallback((key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (navigator.vibrate) navigator.vibrate(8);
  }, []);

  const jumpTo = useCallback((key) => {
    setCollapsed(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key); return next;
    });
    requestAnimationFrame(() => {
      sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (navigator.vibrate) navigator.vibrate(8);
  }, []);

  const gridV = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.012 } },
  };
  const tileV = {
    hidden: { opacity: 0, scale: 0.6, y: 8 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 520, damping: 24 } },
  };

  return (
    <div className="pcat-overlay" onClick={onClose}>
      <motion.div
        className="pcat-sheet"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="pcat-handle" aria-hidden="true" />

        <div className="pcat-header">
          <div>
            <h2 className="pcat-title">Browse the pantry</h2>
            <p className="pcat-sub">{stockedCount} tracked fresh · tap to add</p>
          </div>
          <button className="pcat-done" onClick={onClose}>Done</button>
        </div>

        <div className="pcat-search-row">
          <input
            type="text"
            className="pcat-search"
            placeholder="Search 400+ ingredients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="pcat-search-clear" onClick={() => setQuery('')} aria-label="Clear search">✕</button>
          )}
        </div>

        {!q && (
          <div className="pcat-jumpdock" role="tablist" aria-label="Jump to category">
            {INGREDIENT_CATALOG.map((c) => (
              <button
                key={c.key}
                className="pcat-jump-tag"
                onClick={() => jumpTo(c.key)}
                title={c.label}
              >
                <span aria-hidden="true">{c.emoji}</span>
                <span className="pcat-jump-abbr">{c.label.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}

        <div className="pcat-scroll">
          {sections.length === 0 ? (
            <div className="pcat-empty">
              <span className="pcat-empty-icon">🔍</span>
              <p>No ingredients match "{query}".</p>
            </div>
          ) : (
            sections.map((section) => {
              const isCollapsed = !q && collapsed.has(section.key);
              return (
                <div
                  className="pcat-section"
                  key={section.key}
                  ref={(el) => { sectionRefs.current[section.key] = el; }}
                >
                  <button
                    className="pcat-section-title pcat-section-toggle"
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <span aria-hidden="true">{section.emoji}</span> {section.label}
                    <span className="pcat-section-count">{section.items.length}</span>
                    <span className="pcat-section-caret" aria-hidden="true">{isCollapsed ? '[+]' : '[−]'}</span>
                  </button>
                  {!isCollapsed && (
                    <motion.div className="pcat-grid" variants={gridV} initial="hidden" animate="visible">
                      {section.items.map((name) => {
                        const isStocked = stockedSet.has(name.toLowerCase());
                        return (
                          <motion.button
                            key={name}
                            type="button"
                            className={`pcat-tile ${isStocked ? 'pcat-tile--on' : 'pcat-tile--ghost'}`}
                            variants={tileV}
                            whileTap={{ scale: 0.88 }}
                            onClick={() => toggle(name)}
                            title={isStocked ? `Remove ${name}` : `Add ${name}`}
                          >
                            <motion.span
                              className="pcat-tile-sprite"
                              key={isStocked ? 'on' : 'off'}
                              initial={isStocked ? { scale: 0.7 } : false}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                            >
                              <IngredientSprite name={name} size={36} />
                            </motion.span>
                            <span className="pcat-tile-name">{name}</span>
                            {getDomainFlags(name).canBoth && (
                              <span className="dual-duty-tag dual-duty-tag--tile" title="Double duty — bar & kitchen" aria-label="Works in cocktails and cooking">🍸🍳</span>
                            )}
                            {isStocked && <span className="pcat-tile-stamp" aria-hidden="true">TRACKED</span>}
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
