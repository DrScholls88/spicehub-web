import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function TodayHeroCard({ meal, onPress }) {
  if (!meal || meal._special) return null;
  return (
    <motion.button
      className="today-hero-card"
      onClick={() => onPress(meal)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      style={{ width: '100%', border: 'none', outline: 'none', textAlign: 'left', padding: 0 }}
    >
      {meal.imageUrl ? (
        <div className="hero-photo-wrap">
          <SafeMediaImage
            src={meal.imageUrl}
            alt={meal.name || ''}
            className="hero-photo"
            style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block' }}
            fallbackEmoji="🍳"
          />
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--surface)', fontSize: '40px',
        }}>
          🍳
        </div>
      )}
      <div className="hero-body">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hero-tag">Tonight's dinner</div>
          <div className="hero-meal-name">{meal.name}</div>
          {(meal.category || meal.cuisine) && (
            <div className="hero-meal-meta">
              {[meal.category, meal.cuisine].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="hero-arrow">
          <ChevronRight size={16} strokeWidth={2.5} />
        </div>
      </div>
    </motion.button>
  );
}
