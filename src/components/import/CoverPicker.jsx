// ─────────────────────────────────────────────────────────────────────────────
// CoverPicker — carousel cover selection for ImportReview.
//
// Instagram multi-photo posts now arrive with `_carouselImages`
// ([{url, dataUrl, kind}], ≤6, persisted as data URLs by images.js). This
// strip lets the user pick which shot is the recipe's cover. The selection
// ring travels between thumbnails with a shared-layout spring (layoutId), and
// every target is ≥56px — comfortably past the 48px floor.
//
// Renders nothing when there's ≤1 usable image, so it costs zero pixels for
// ordinary imports.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import './CoverPicker.css';

const SPRING = { type: 'spring', stiffness: 320, damping: 30 };

function CoverPicker({ recipe, onChange }) {
  const reduced = useReducedMotion();

  const candidates = useMemo(() => {
    const list = [];
    const seen = new Set();
    const push = (src, origin) => {
      if (!src || seen.has(src)) return;
      seen.add(src);
      list.push({ src, origin });
    };
    // Current cover first so the ring has a home even for single-image posts.
    push(recipe.image || recipe.imageUrl, 'current');
    for (const c of Array.isArray(recipe._carouselImages) ? recipe._carouselImages : []) {
      push(c?.dataUrl || c?.url, 'carousel');
    }
    return list;
  }, [recipe.image, recipe.imageUrl, recipe._carouselImages]);

  if (candidates.length <= 1) return null;

  const current = recipe.image || recipe.imageUrl || '';

  const select = (src) => {
    if (src === current) return;
    onChange({ ...recipe, image: src, imageUrl: src, _imageStatus: src.startsWith('data:') ? 'data-url' : 'remote' });
  };

  return (
    <div className="cover-picker" role="radiogroup" aria-label="Choose cover photo">
      <span className="cover-picker-label">Cover photo</span>
      <div className="cover-picker-strip">
        {candidates.map(({ src }, i) => {
          const selected = src === current;
          return (
            <motion.button
              key={src.slice(0, 96) + i}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Photo ${i + 1} of ${candidates.length}`}
              className={`cover-picker-thumb${selected ? ' is-selected' : ''}`}
              onClick={() => select(src)}
              whileTap={reduced ? undefined : { scale: 0.94 }}
              transition={SPRING}
            >
              <img src={src} alt="" loading="lazy" draggable={false} />
              {selected && (
                <motion.span
                  layoutId="cover-picker-ring"
                  className="cover-picker-ring"
                  transition={reduced ? { duration: 0 } : SPRING}
                >
                  <span className="cover-picker-ring-badge">
                    <Check size={12} strokeWidth={3} aria-hidden="true" />
                  </span>
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(CoverPicker);
