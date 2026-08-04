import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import RecipeCard from '../RecipeCard.jsx';

// matches: { ready: [...], almost: [...] } from lib/pantryMatch.js —
// ready = 0 missing, almost = 1-2 missing (staples never count as missing).
export default function CookTonightCarousel({ matches, onViewDetail }) {
  const [open, setOpen] = useState(false);

  const ready = matches?.ready || [];
  const almost = matches?.almost || [];
  const combined = [
    ...ready.map(m => ({ ...m, tier: 'ready' })),
    ...almost.map(m => ({ ...m, tier: 'almost' })),
  ];
  if (!combined.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
      style={{ marginBottom: '24px' }}
    >
      {/* ── Collapsible header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '0 0 8px',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span className="landing-section-label" style={{ margin: 0 }}>
          🧊 Cook Tonight
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            marginLeft: '2px',
          }}
        >
          ({combined.length})
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          style={{
            display: 'inline-flex',
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}
        >
          <ChevronDown size={18} strokeWidth={2.5} />
        </motion.span>
      </button>

      {/* ── Collapsible body ── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="cook-tonight-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="landing-next-days-wrap">
              <div
                className="landing-next-days-scroll sh-carousel"
                style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', paddingBottom: '8px' }}
              >
                {combined.map(({ meal, matched, total, missing, tier }) => (
                  <RecipeCard
                    key={meal.id || meal.name}
                    meal={meal}
                    layout="carousel"
                    statusBadge={tier === 'ready' ? 'Ready to cook' : '1-2 items needed'}
                    matchedCount={matched}
                    totalCount={total}
                    missingIngredients={missing}
                    onClick={onViewDetail}
                  />
                ))}
              </div>
              <div className="landing-next-days-fade" aria-hidden="true" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
