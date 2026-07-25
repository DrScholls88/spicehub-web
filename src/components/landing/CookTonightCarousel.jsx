import React from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function CookTonightCarousel({ matches, onViewDetail }) {
  if (!matches?.length) return null;

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
        <div className="landing-next-days-scroll sh-carousel">
          {matches.map(({ meal, matched, total, missing, coverage }) => (
            <motion.button
              key={meal.id || meal.name}
              whileHover={{ y: -4, boxShadow: '0 8px 16px rgba(0,0,0,0.12)' }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onViewDetail(meal)}
              className="day-card"
              style={{ width: '150px' }}
            >
              {meal.imageUrl ? (
                <SafeMediaImage
                  src={meal.imageUrl}
                  alt={meal.name || ''}
                  className="day-card-photo"
                  fallbackEmoji="🍳"
                />
              ) : (
                <div className="day-card-photo-fallback">🍳</div>
              )}
              <div className="day-card-body">
                <div className="day-card-name">{meal.name}</div>
                <div style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  color: coverage >= 0.8 ? 'var(--success, #16a34a)' : 'var(--warning, #d97706)',
                  marginTop: '3px',
                }}>
                  {matched}/{total} items ✓
                </div>
                {missing.length > 0 && (
                  <div style={{
                    fontSize: '10px',
                    color: 'var(--text-muted, var(--text-light))',
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    Need: {missing.join(', ')}
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>
        <div className="landing-next-days-fade" aria-hidden="true" />
      </div>
    </motion.div>
  );
}
