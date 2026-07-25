import React, { useState } from 'react';
import { motion } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';
import { DOW_SHORT, dayCardVariants, haptic } from '../../lib/landingHelpers.js';

export default function DayPhotoCard({ date, meal, isToday, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateNum = date.getDate();
  const specialEmoji = meal?._special ? meal.icon : null;

  return (
    <motion.button
      className={`day-card${isToday ? ' day-card--today' : ''}`}
      variants={dayCardVariants}
      whileHover={{ y: -4, boxShadow: '0 8px 16px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.95 }}
      onClick={() => { haptic(10); onClick(); }}
      style={{ position: 'relative', outline: 'none' }}
    >
      {/* Photo / fallback */}
      {specialEmoji ? (
        <div className="day-card-photo-fallback">{specialEmoji}</div>
      ) : meal?.imageUrl && !imgErr ? (
        <SafeMediaImage
          src={meal?.imageUrl}
          alt={meal?.name || ''}
          className="day-card-photo"
          fallbackEmoji={meal ? '🍳' : '🍽️'}
        />
      ) : (
        <div className="day-card-photo-fallback">
          {meal ? '🍳' : '🍽️'}
        </div>
      )}
      {/* Card body */}
      <div className="day-card-body">
        <div className={`day-card-label${isToday ? ' day-card-label--today' : ''}`}>
          <span>{dayLabel} {dateNum}</span>
          {meal?._locked && <span style={{ fontSize: '12px' }} title="Locked">🔒</span>}
        </div>
        {meal ? (
          <div className="day-card-name">{meal.name}</div>
        ) : (
          <div className="day-card-empty">Nothing yet</div>
        )}
      </div>
    </motion.button>
  );
}
