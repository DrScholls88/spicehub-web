import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { IngredientSprite } from '../lib/barSprites.jsx';
import { INGREDIENT_CATALOG } from '../data/bar/ingredientCatalog';

/**
 * IngredientCatalog — a browsable, searchable shelf of premade ingredients, each
 * rendered as its own pixel sprite. Tap a tile to stock (or un-stock) it on your
 * My Bar shelf. Fully offline; sprites are procedural.
 *
 * Props:
 *   stocked  : Set<string> of canonical lowercase names already on the shelf
 *   onAdd    : (name) => void
 *   onRemove : (name) => void
 *   onClose  : () => void
 */
export default function IngredientCatalog({ stocked, onAdd, onRemove, onClose }) {
  const [query, setQuery] = useState('');
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

        <div className="cat-scroll">
          {sections.length === 0 ? (
            <div className="cat-empty">
              <span className="cat-empty-icon">🔍</span>
              <p>No ingredients match “{query}”.</p>
            </div>
          ) : (
            sections.map((section) => (
              <div className="cat-section" key={section.key}>
                <h3 className="cat-section-title">
                  <span aria-hidden="true">{section.emoji}</span> {section.label}
                </h3>
                <motion.div className="cat-grid" variants={gridV} initial="hidden" animate="visible">
                  {section.items.map((name) => {
                    const isStocked = stockedSet.has(name.toLowerCase());
                    return (
                      <motion.button
                        key={name}
                        type="button"
                        className={`cat-tile ${isStocked ? 'cat-tile--on' : ''}`}
                        variants={tileV}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => toggle(name)}
                        title={isStocked ? `Remove ${name}` : `Add ${name}`}
                      >
                        <span className="cat-tile-sprite">
                          <IngredientSprite name={name} size={40} />
                        </span>
                        <span className="cat-tile-name">{name}</span>
                        {isStocked && <span className="cat-tile-check" aria-hidden="true">✓</span>}
                      </motion.button>
                    );
                  })}
                </motion.div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
