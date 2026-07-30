import React from 'react';
import { motion } from 'framer-motion';
import RecipeCard from '../RecipeCard.jsx';

// matches: { ready: [...], almost: [...] } from lib/pantryMatch.js —
// ready = 0 missing, almost = 1-2 missing (staples never count as missing).
export default function CookTonightCarousel({ matches, onViewDetail }) {
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
      <div className="landing-section-label">🧊 Cook Tonight — from what you have</div>
      <div className="landing-next-days-wrap">
        <div
          className="landing-next-days-scroll sh-carousel"
          style={{ display: 'flex', gap: '12px', paddingBottom: '8px' }}
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
  );
}
