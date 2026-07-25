import React from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';

export default function SeasonalMealCard({ meal, onPress }) {
  return (
    <motion.button
      whileHover={{ y: -3, boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.96 }}
      onClick={onPress}
      style={{
        flexShrink: 0,
        width: '140px',
        background: 'var(--card)',
        border: '1.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        padding: 0,
        outline: 'none',
      }}
    >
      {meal.imageUrl ? (
        <SafeMediaImage
          src={meal.imageUrl}
          alt={meal.name || ''}
          style={{ width: '100%', height: '90px', objectFit: 'cover', display: 'block' }}
          fallbackEmoji="🍳"
        />
      ) : (
        <div style={{ width: '100%', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', fontSize: '32px', flexShrink: 0 }}>
          🍳
        </div>
      )}
      <div style={{ padding: '8px 10px 10px' }}>
        <div style={{
          fontSize: '12px',
          fontWeight: '700',
          color: 'var(--text)',
          lineHeight: '1.3',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {meal.name}
        </div>
        {meal.category && (
          <div style={{ fontSize: '10px', color: 'var(--text-muted, var(--text-light))', marginTop: '3px', fontWeight: '500' }}>
            {meal.category}
          </div>
        )}
      </div>
    </motion.button>
  );
}
