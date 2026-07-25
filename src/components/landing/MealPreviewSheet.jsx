import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeMediaImage from '../SafeMediaImage.jsx';
import { DOW_SHORT } from '../../lib/landingHelpers.js';

export default function MealPreviewSheet({
  date, meal, isToday, onClose, onViewFull,
  meals = [], onRespinDate = null, onAssignMeal = null, onCreateMealForDay = null,
}) {
  const [imgErr, setImgErr] = useState(false);
  // Empty-day sheet has two views: the 3-action list, and (if "Pick from
  // Favorites" is tapped) an inline favorites list — kept in the same sheet
  // rather than stacking a second modal.
  const [view, setView] = useState('actions'); // 'actions' | 'favorites'

  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const favoriteMeals = useMemo(() => meals.filter(m => m.isFavorite), [meals]);

  return (
    <>
      {/* Scrim */}
      <motion.div
        className="preview-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
      />
      {/* Sheet */}
      <motion.div
        className="preview-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      >
        <div className="preview-handle" />
        {/* Header row */}
        <div className="preview-header">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {dayLabel} · {dateStr}
            </div>
          </div>
          <button className="preview-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Photo */}
        {!meal || meal._special ? (
          <div className="preview-photo-fallback">
            {meal?._special ? meal.icon : '🍽️'}
          </div>
        ) : meal.imageUrl && !imgErr ? (
          <SafeMediaImage
            src={meal?.imageUrl}
            alt={meal?.name || ''}
            className="day-card-photo"
            fallbackEmoji={meal ? '🍳' : '🍽️'}
          />
        ) : (
          <div className="preview-photo-fallback">🍳</div>
        )}

        {/* Body */}
        <div className="preview-body">
          {!meal ? (
            view === 'favorites' ? (
              <div>
                <button className="day-sheet-back-btn" onClick={() => setView('actions')}>← Back</button>
                {favoriteMeals.length === 0 ? (
                  <div style={{ fontSize: 14, color: 'var(--text-light)', padding: '8px 0' }}>
                    No favorites yet — heart a recipe in My Meals first.
                  </div>
                ) : (
                  <div className="day-sheet-favorites-list">
                    {favoriteMeals.map(m => (
                      <button
                        key={m.id}
                        className="day-sheet-favorite-row"
                        onClick={() => { onAssignMeal?.(date, m); onClose(); }}
                      >
                        ❤️ {m.name || 'Untitled Recipe'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ textAlign: 'center', padding: '4px 0 14px' }}>
                  <div style={{ fontSize: 15, color: 'var(--text-light)' }}>Nothing planned for this day.</div>
                </div>
                <div className="day-sheet-actions">
                  {onRespinDate && (
                    <button
                      className="day-sheet-action-btn"
                      onClick={() => { onRespinDate(date); onClose(); }}
                    >
                      🎲 Spin for {dayLabel}
                    </button>
                  )}
                  {onAssignMeal && (
                    <button className="day-sheet-action-btn" onClick={() => setView('favorites')}>
                      ⭐ Pick from Favorites
                    </button>
                  )}
                  {onCreateMealForDay && (
                    <button
                      className="day-sheet-action-btn"
                      onClick={() => { onCreateMealForDay(date); onClose(); }}
                    >
                      ✏️ Add Custom Meal
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <>
              <div className="preview-meal-name">{meal.name}</div>
              <div className="preview-meta">
                {meal.ingredients?.length
                  ? `${meal.ingredients.length} ingredients`
                  : ''}
                {meal.category ? ` · ${meal.category}` : ''}
                {meal.rating ? ` · ${'⭐'.repeat(meal.rating)}` : ''}
              </div>
              {!meal._special && (
                <button className="preview-view-btn" onClick={() => { onViewFull(meal); onClose(); }}>
                  📖 View Full Recipe
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}
