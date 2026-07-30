import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import SafeMediaImage from './SafeMediaImage.jsx';

export default function RecipeCard({
  meal,
  layout = 'hero', // 'hero' | 'carousel' | 'grid'
  statusBadge = null,
  matchedCount = null,
  totalCount = null,
  missingIngredients = [],
  onClick = () => {},
  style = {},
}) {
  if (!meal || meal._special) return null;

  const title = meal.name || 'Untitled Meal';
  const categoryCuisine = [meal.category, meal.cuisine].filter(Boolean).join(' · ');

  if (layout === 'hero') {
    return (
      <motion.button
        className="sh-recipe-card hero-layout"
        onClick={() => onClick(meal)}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        style={{
          width: '100%',
          border: '1px solid var(--border-subtle, var(--border))',
          borderRadius: '16px',
          background: 'var(--surface-elevated, var(--card))',
          boxShadow: 'var(--elevation-shadow, 0 4px 12px rgba(0,0,0,0.05))',
          padding: '0',
          overflow: 'hidden',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          ...style,
        }}
      >
        {meal.imageUrl ? (
          <div style={{ width: '100%', height: '150px', overflow: 'hidden', position: 'relative' }}>
            <SafeMediaImage
              src={meal.imageUrl}
              alt={title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              fallbackEmoji="🍳"
            />
            {statusBadge && (
              <span
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  background: 'rgba(0,0,0,0.75)',
                  color: '#fff',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '11px',
                  fontWeight: '600',
                  backdropFilter: 'blur(6px)',
                }}
              >
                {statusBadge}
              </span>
            )}
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '110px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-base, var(--surface))',
              fontSize: '44px',
            }}
          >
            🍳
          </div>
        )}
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--primary)',
                marginBottom: '4px',
              }}
            >
              {statusBadge || "Tonight's Pick"}
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: '700',
                color: 'var(--text)',
                lineHeight: '1.3',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
            {categoryCuisine && (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted, var(--text-light))',
                  marginTop: '4px',
                }}
              >
                {categoryCuisine}
              </div>
            )}
          </div>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'var(--surface-overlay, var(--border))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text)',
              flexShrink: 0,
            }}
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </div>
        </div>
      </motion.button>
    );
  }

  // Carousel layout
  return (
    <motion.button
      className="sh-recipe-card carousel-layout"
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.95 }}
      onClick={() => onClick(meal)}
      style={{
        width: '155px',
        flexShrink: 0,
        borderRadius: '14px',
        border: '1px solid var(--border-subtle, var(--border))',
        background: 'var(--surface-elevated, var(--card))',
        boxShadow: 'var(--elevation-shadow, 0 2px 8px rgba(0,0,0,0.06))',
        overflow: 'hidden',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {meal.imageUrl ? (
        <div style={{ width: '100%', height: '110px', overflow: 'hidden', position: 'relative' }}>
          <SafeMediaImage
            src={meal.imageUrl}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            fallbackEmoji="🍳"
          />
          {statusBadge && (
            <span
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: '600',
              }}
            >
              {statusBadge}
            </span>
          )}
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: '90px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-base, var(--surface))',
            fontSize: '32px',
          }}
        >
          🍳
        </div>
      )}
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: '700',
            color: 'var(--text)',
            lineHeight: '1.25',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
        {matchedCount !== null && totalCount !== null && (
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: matchedCount === totalCount ? 'var(--success, #16a34a)' : 'var(--warning, #d97706)',
              marginTop: '6px',
            }}
          >
            {matchedCount === totalCount ? '🟢' : '🟡'} {matchedCount}/{totalCount} on hand
          </div>
        )}
        {missingIngredients.length > 0 && (
          <div
            style={{
              fontSize: '10px',
              color: 'var(--text-muted, var(--text-light))',
              marginTop: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Need: {missingIngredients.join(', ')}
          </div>
        )}
      </div>
    </motion.button>
  );
}
