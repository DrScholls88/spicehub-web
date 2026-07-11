import { useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { IngredientSprite } from '../lib/barSprites.jsx';
import { INGREDIENT_CATALOG } from '../data/bar/ingredientCatalog';
import { getDomainFlags } from '../lib/pantryDomain';

/**
 * IngredientCatalog — a browsable, searchable apothecary rack of premade
 * ingredients, each rendered as its own pixel sprite. Tap a tile to stock
 * (or un-stock) it on your My Bar shelf. Fully offline; sprites procedural.
 *
 * P3 upgrades:
 *  - Collapsible category sections ([+]/[−]) to tame the 180+ item scroll
 *  - Sticky pixel jump-dock (3-letter tags) that snaps to a section
 *  - Silhouette-wake selection: unstocked tiles are desaturated ghosts that
 *    "wake up" in full color with an IN STOCK stamp when tapped (no ✓ badge)
 *
 * Props:
 *   stocked  : Set<string> of canonical lowercase names already on the shelf
 *   onAdd    : (name) => void
 *   onRemove : (name) => void
 *   onClose  : () => void
 */
export default function IngredientCatalog({ stocked, onAdd, onRemove, onClose }) {
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
    // Expand it if collapsed, then snap the scroll view to it.
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
    <div className="cat-overlay" onClick={onClose}>
      <motion.div
        className="cat-sheet"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="cat-handle" aria-hidden="true" />

        <div className="cat-header">
          <div>
            <h2 className="cat-title">Stock your bar</h2>
            <p className="cat-sub">{stockedCount} on your shelf · tap to add</p>
          </div>
          <button className="cat-done" onClick={onClose}>Done</button>
        </div>

        <div className="cat-search-row">
          <input
            type="text"
            className="cat-search"
            placeholder="Search 180+ ingredients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="cat-search-clear" onClick={() => setQuery('')} aria-label="Clear search">✕</button>
          )}
        </div>

        {/* Sticky pixel jump-dock — snaps the scroll to a category */}
        {!q && (
          <div className="cat-jumpdock" role="tablist" aria-label="Jump to category">
            {INGREDIENT_CATALOG.map((c) => (
              <button
                key={c.key}
                className="cat-jump-tag"
                onClick={() => jumpTo(c.key)}
                title={c.label}
              >
                <span aria-hidden="true">{c.emoji}</span>
                <span className="cat-jump-abbr">{c.label.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}

        <div className="cat-scroll">
          {sections.length === 0 ? (
            <div className="cat-empty">
              <span className="cat-empty-icon">🔍</span>
              <p>No ingredients match “{query}”.</p>
            </div>
          ) : (
            sections.map((section) => {
              const isCollapsed = !q && collapsed.has(section.key);
              return (
                <div
                  className="cat-section"
                  key={section.key}
                  ref={(el) => { sectionRefs.current[section.key] = el; }}
                >
                  <button
                    className="cat-section-title cat-section-toggle"
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <span aria-hidden="true">{section.emoji}</span> {section.label}
                    <span className="cat-section-count">{section.items.length}</span>
                    <span className="cat-section-caret" aria-hidden="true">{isCollapsed ? '[+]' : '[−]'}</span>
                  </button>
                  {!isCollapsed && (
                    <motion.div className="cat-grid" variants={gridV} initial="hidden" animate="visible">
                      {section.items.map((name) => {
                        const isStocked = stockedSet.has(name.toLowerCase());
                        return (
                          <motion.button
                            key={name}
                            type="button"
                            className={`cat-tile ${isStocked ? 'cat-tile--on' : 'cat-tile--ghost'}`}
                            variants={tileV}
                            whileTap={{ scale: 0.88 }}
                            onClick={() => toggle(name)}
                            title={isStocked ? `Remove ${name}` : `Add ${name}`}
                          >
                            <motion.span
                              className="cat-tile-sprite"
                              key={isStocked ? 'on' : 'off'}
                              initial={isStocked ? { scale: 0.7 } : false}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                            >
                              <IngredientSprite name={name} size={40} />
                            </motion.span>
                            <span className="cat-tile-name">{name}</span>
                            {getDomainFlags(name).canBoth && (
                              <span className="dual-duty-tag dual-duty-tag--tile" title="Double duty — bar & kitchen" aria-label="Works in cocktails and cooking">🍸🍳</span>
                            )}
                            {isStocked && <span className="cat-tile-stamp" aria-hidden="true">IN STOCK</span>}
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
