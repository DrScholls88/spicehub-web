import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Dices, ChevronRight, Compass, GripVertical, EyeOff, Eye, Pencil, Check } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import SafeMediaImage from './SafeMediaImage.jsx';
import { loadLandingLayout, saveLandingLayout } from '../lib/landingLayout.js';
import { freshnessOf, categorizeKitchen } from '../lib/pantryDomain.js';
import './LandingPage.css';

// ── Date helpers ──────────────────────────────────────────────────────────────
function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Small, tolerant duration parser for the ticker's "Tonight: N min prep time"
// line — doesn't need to be exhaustive (weekPlanner.js's parseTotalMinutes
// already handles the authoritative case), just good enough for a status line.
function mealTickerMinutes(meal) {
  const raw = meal?.totalTime || meal?.prepTime || meal?.cookTime;
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const hrMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/);
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/);
  let total = 0;
  if (hrMatch) total += parseFloat(hrMatch[1]) * 60;
  if (minMatch) total += parseFloat(minMatch[1]);
  if (total > 0) return Math.round(total);
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  return bare ? Math.round(parseFloat(bare[1])) : null;
}

const STYLES = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text)',
    padding: '16px',
    paddingBottom: '100px',
  },
  header: {
    background: 'linear-gradient(135deg, var(--primary), var(--primary-light))',
    color: '#fff',
    borderRadius: 'var(--radius)',
    padding: '24px 16px',
    marginBottom: '24px',
    boxShadow: 'var(--shadow)',
  },
  headerGreeting: {
    fontSize: '28px',
    fontWeight: '700',
    marginBottom: '4px',
    lineHeight: '1.2',
  },
  headerDate: {
    fontSize: '14px',
    opacity: '0.95',
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text)',
    marginBottom: '12px',
  },
  // ── Slim context bar (replaces bulky greeting card) ──
  contextBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '7px',
    marginBottom: '14px',
    fontSize: '15px',
    lineHeight: 1.3,
  },
  contextGreeting: {
    fontWeight: '700',
    color: 'var(--text)',
  },
  contextDivider: {
    color: 'var(--text-muted, var(--text-light))',
    opacity: 0.55,
  },
  contextDate: {
    color: 'var(--text-light)',
    fontWeight: '500',
  },
  contextStreak: {
    marginLeft: 'auto',
    fontSize: '12.5px',
    fontWeight: '700',
    color: 'var(--primary)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '999px',
    padding: '3px 10px',
  },
  tagline: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--text-muted, var(--text-light))',
    marginTop: '-4px',
    marginBottom: '10px',
    letterSpacing: '0.01em',
  },
  spinBtnFull: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '0',
  },
  // ── Next 5 Days horizontal scroll ──
  nextDaysSection: {
    marginBottom: '24px',
  },
  nextDaysScrollWrap: {
    position: 'relative',
  },
  nextDaysScroll: {
    display: 'flex',
    gap: '10px',
    overflowX: 'auto',
    paddingBottom: '8px',
    paddingRight: '20px',
    scrollBehavior: 'smooth',
    WebkitOverflowScrolling: 'touch',
    scrollPaddingLeft: '2px',
    // Gesture isolation: keep horizontal swipes here from triggering page
    // pinch-zoom / vertical scroll chaining (eliminates carousel jitter).
    touchAction: 'pan-x',
    overscrollBehaviorX: 'contain',
  },
  nextDaysFade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: '8px',
    width: '36px',
    pointerEvents: 'none',
    background: 'linear-gradient(to right, rgba(0,0,0,0), var(--bg))',
  },
  dayCard: {
    flexShrink: 0,
    width: '144px',
    background: 'var(--card)',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out',
    display: 'flex',
    flexDirection: 'column',
  },
  dayCardToday: {
    border: '2px solid var(--primary)',
  },
  dayCardPhotoArea: {
    width: '100%',
    height: '96px',
    objectFit: 'cover',
    display: 'block',
    background: 'var(--surface)',
    flexShrink: 0,
  },
  dayCardPhotoFallback: {
    width: '100%',
    height: '96px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--surface)',
    fontSize: '28px',
    flexShrink: 0,
  },
  dayCardBody: {
    padding: '8px 8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: 1,
  },
  dayCardDayLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  dayCardDayLabelToday: {
    color: 'var(--primary)',
  },
  dayCardMealName: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text)',
    lineHeight: '1.35',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  dayCardEmpty: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  // ── Empty state ──
  emptyState: {
    background: 'var(--surface)',
    border: '1.5px dashed var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '20px 16px',
    textAlign: 'center',
    marginBottom: '24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  emptyStateIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    color: 'var(--text-muted, var(--text-light))',
    marginBottom: '10px',
  },
  emptyStateText: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text)',
    marginBottom: '4px',
  },
  emptyStateHint: {
    fontSize: '13px',
    color: 'var(--text-muted, var(--text-light))',
    marginBottom: '14px',
    lineHeight: 1.5,
    maxWidth: '260px',
  },
  emptyStateButton: {
    display: 'inline-block',
    background: 'var(--primary)',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '13px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease-out',
  },
  // ── Tiles ──
  tilesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginBottom: '24px',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px 16px 16px 20px',
    cursor: 'pointer',
    transition: 'all 0.2s ease-out',
    minHeight: '140px',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
    textAlign: 'left',
  },
  tileHover: {
    transform: 'scale(0.97)',
    boxShadow: 'var(--shadow)',
    opacity: '0.95',
  },
  tileEmoji: {
    fontSize: '40px',
    marginBottom: '8px',
    lineHeight: '1',
  },
  tileTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--text)',
    marginBottom: '4px',
    lineHeight: '1.2',
  },
  tileSubtitle: {
    fontSize: '12px',
    color: 'var(--text-light)',
    fontWeight: '500',
  },
  tileAccent: {
    width: '3px',
    height: '100%',
    position: 'absolute',
    left: '0',
    top: '0',
    borderRadius: 'var(--radius) 0 0 var(--radius)',
  },
  // ── Stats strip ──
  statsStrip: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 16px',
    display: 'flex',
    gap: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s ease-out',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--text)',
  },
  statEmoji: { fontSize: '16px' },
  // ── Preview Sheet ──
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    zIndex: 300,
  },
  previewSheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 600,
    margin: '0 auto',
    background: 'var(--card)',
    borderRadius: '20px 20px 0 0',
    boxShadow: '0 -8px 40px rgba(0,0,0,0.2)',
    zIndex: 310,
    maxHeight: '70vh',
    overflowY: 'auto',
  },
  previewHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'var(--border)',
    margin: '10px auto 0',
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '14px 16px 8px',
  },
  previewCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--surface)',
    color: 'var(--text-light)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  previewPhoto: {
    width: '100%',
    height: 180,
    objectFit: 'cover',
    display: 'block',
  },
  previewPhotoFallback: {
    width: '100%',
    height: 140,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 56,
    background: 'var(--surface)',
  },
  previewBody: {
    padding: '12px 16px 28px',
  },
  previewMealName: {
    fontSize: 20,
    fontWeight: 800,
    color: 'var(--text)',
    marginBottom: 4,
  },
  previewMeta: {
    fontSize: 13,
    color: 'var(--text-light)',
    marginBottom: 16,
  },
  previewBtn: {
    display: 'block',
    width: '100%',
    padding: '13px 16px',
    border: 'none',
    borderRadius: 12,
    background: 'var(--primary)',
    color: 'white',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
  },
};

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Animation variants ────────────────────────────────────────────────────────
const dayCardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.94 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 320, damping: 26 },
  },
};
const diceVariants = {
  rest:  { rotate: 0 },
  hover: { rotate: [0, -22, 20, -10, 6, 0], transition: { duration: 0.55, ease: 'easeInOut' } },
};

const TILE_COLORS = {
  planWeek: '#e65100',
  myMeals: '#2e7d32',
  bar: '#7b1fa2',
  grocery: '#1565c0',
  pantry: '#8a6d3b',
  fridge: '#00838f',
  stats: '#e65100',
};

// Primary tiles span full width with distinct treatment
const PRIMARY_TILES = new Set(['planWeek', 'fridge']);

// ── Seasonal helpers ──────────────────────────────────────────────────────────
function getSeasonInfo() {
  const m = new Date().getMonth(); // 0-indexed
  if (m >= 2 && m <= 4) return {
    name: 'Spring', emoji: '🌸',
    headline: 'Perfect for Spring',
    keywords: ['spring', 'pea', 'asparagus', 'radish', 'artichoke', 'strawberry', 'lemon', 'salad', 'light', 'fresh', 'herb'],
  };
  if (m >= 5 && m <= 7) return {
    name: 'Summer', emoji: '☀️',
    headline: 'Summer Favorites',
    keywords: ['summer', 'grill', 'grilled', 'bbq', 'barbecue', 'corn', 'tomato', 'zucchini', 'peach', 'watermelon', 'taco', 'burger', 'fresh', 'light', 'salad'],
  };
  if (m >= 8 && m <= 10) return {
    name: 'Fall', emoji: '🍂',
    headline: 'Cozy Fall Recipes',
    keywords: ['fall', 'pumpkin', 'squash', 'apple', 'sweet potato', 'butternut', 'soup', 'stew', 'roast', 'harvest', 'cider', 'maple'],
  };
  return {
    name: 'Winter', emoji: '❄️',
    headline: 'Warm Winter Comfort',
    keywords: ['winter', 'soup', 'stew', 'chili', 'braise', 'roast', 'hearty', 'comfort', 'pot roast', 'casserole', 'curry', 'warm', 'slow cooker'],
  };
}

function getSeasonalMeals(meals, season) {
  const kws = season.keywords;
  const scored = meals.map(m => {
    const haystack = [
      m.name || '',
      m.category || '',
      m.cuisine || '',
      m.dishType || '',
      ...(m.tags || []),
      ...(m.ingredients || []).slice(0, 8),
    ].join(' ').toLowerCase();
    const hits = kws.filter(k => haystack.includes(k)).length;
    return { meal: m, hits };
  })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, 5).map(x => x.meal);
}

// ── SeasonalMealCard ──────────────────────────────────────────────────────────
function SeasonalMealCard({ meal, onPress }) {
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

// ── TodayHeroCard ────────────────────────────────────────────────────────────
function TodayHeroCard({ meal, onPress }) {
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

// ── DiscoverFeatureCard ──────────────────────────────────────────────────────
// Entry point to Discover Recipes (Reddit browse-and-import), which previously
// only lived behind the Meal Library's FAB. Given its own featured moment here
// rather than folded into the utility tiles grid below — "find something new"
// is a different kind of action from "go manage my stuff".
function DiscoverFeatureCard({ onPress }) {
  return (
    <motion.button
      className="discover-feature-card"
      onClick={onPress}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="discover-card-glow" aria-hidden="true" />
      <span className="discover-card-badge">
        <span className="discover-card-badge-ring" aria-hidden="true" />
        <Compass size={22} strokeWidth={1.75} />
      </span>
      <span className="discover-card-text">
        <span className="discover-card-eyebrow">Discover</span>
        <span className="discover-card-title">Find your next favorite</span>
        <span className="discover-card-subtitle">Browse recipe communities — tap one to import</span>
      </span>
      <span className="discover-card-arrow">
        <ChevronRight size={16} strokeWidth={2.5} />
      </span>
    </motion.button>
  );
}

// ── InstallBanner ────────────────────────────────────────────────────────────
function InstallBanner({ onInstall }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <motion.div
      className="install-banner"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, overflow: 'hidden' }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      onClick={onInstall}
    >
      <span className="install-icon">📲</span>
      <div className="install-text">
        <div className="install-title">Install SpiceHub</div>
        <div className="install-subtitle">Add to home screen for faster access</div>
      </div>
      <button
        className="install-dismiss"
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}

// ── StickyHeader ─────────────────────────────────────────────────────────────
function StickyHeader({ visible, onSpin }) {
  return (
    <div className={`landing-sticky-header${visible ? ' visible' : ''}`}>
      <div className="sticky-brand">
        🌶️ SpiceHub
      </div>
      <button className="sticky-spin-btn" onClick={onSpin}>
        Spin 🎲
      </button>
    </div>
  );
}

// ── DayPhotoCard ──────────────────────────────────────────────────────────────
function DayPhotoCard({ date, meal, isToday, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateNum = date.getDate();
  const specialEmoji = meal?._special ? meal.icon : null;

  return (
    <motion.button
      variants={dayCardVariants}
      whileHover={{ y: -4, boxShadow: '0 8px 16px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      style={{
        ...STYLES.dayCard,
        ...(isToday && STYLES.dayCardToday),
        border: isToday ? '2px solid var(--primary)' : '1.5px solid var(--border)',
        position: 'relative',
        outline: 'none',
      }}
    >
      {/* Photo / fallback */}
      {specialEmoji ? (
        <div style={STYLES.dayCardPhotoFallback}>{specialEmoji}</div>
      ) : meal?.imageUrl && !imgErr ? (
<SafeMediaImage
  src={meal?.imageUrl}
  alt={meal?.name || ''}
  style={STYLES.dayCardPhotoArea}   // or previewPhoto
  fallbackEmoji={meal ? '🍳' : '🍽️'}
/>
      ) : (
        <div style={STYLES.dayCardPhotoFallback}>
          {meal ? '🍳' : '🍽️'}
        </div>
      )}
      {/* Card body */}
      <div style={STYLES.dayCardBody}>
        <div style={{
          ...STYLES.dayCardDayLabel,
          ...(isToday && STYLES.dayCardDayLabelToday),
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>{dayLabel} {dateNum}</span>
          {meal?._locked && <span style={{ fontSize: '12px' }} title="Locked">🔒</span>}
        </div>
        {meal ? (
          <div style={STYLES.dayCardMealName}>{meal.name}</div>
        ) : (
          <div style={STYLES.dayCardEmpty}>Nothing yet</div>
        )}
      </div>
    </motion.button>
  );
}

// ── MealPreviewSheet ──────────────────────────────────────────────────────────
function MealPreviewSheet({
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
        style={STYLES.scrim}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
      />
      {/* Sheet */}
      <motion.div
        style={STYLES.previewSheet}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      >
        <div style={STYLES.previewHandle} />
        {/* Header row */}
        <div style={STYLES.previewHeader}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {dayLabel} · {dateStr}
            </div>
          </div>
          <button style={STYLES.previewCloseBtn} onClick={onClose}>✕</button>
        </div>

        {/* Photo */}
        {!meal || meal._special ? (
          <div style={STYLES.previewPhotoFallback}>
            {meal?._special ? meal.icon : '🍽️'}
          </div>
        ) : meal.imageUrl && !imgErr ? (
<SafeMediaImage
  src={meal?.imageUrl}
  alt={meal?.name || ''}
  style={STYLES.dayCardPhotoArea}   // or previewPhoto
  fallbackEmoji={meal ? '🍳' : '🍽️'}
/>
        ) : (
          <div style={STYLES.previewPhotoFallback}>🍳</div>
        )}

        {/* Body */}
        <div style={STYLES.previewBody}>
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
              <div style={STYLES.previewMealName}>{meal.name}</div>
              <div style={STYLES.previewMeta}>
                {meal.ingredients?.length
                  ? `${meal.ingredients.length} ingredients`
                  : ''}
                {meal.category ? ` · ${meal.category}` : ''}
                {meal.rating ? ` · ${'⭐'.repeat(meal.rating)}` : ''}
              </div>
              {!meal._special && (
                <button style={STYLES.previewBtn} onClick={() => { onViewFull(meal); onClose(); }}>
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

// ── Main component ────────────────────────────────────────────────────────────
export default function LandingPage({
  cookingStats = {},
  weekPlan = [],
  weekHistory = [],
  meals = [],
  drinks = [],
  groceryItems = [],
  fridgeInventory = [],
  rotationCount = 0,
  onNavigate = () => {},
  onGenerate = () => {},
  onViewDetail = () => {},
  onOpenFridge = () => {},
  onOpenPantry = () => {},
  onOpenStats = () => {},
  onOpenDiscover = () => {},
  onInstallApp = null,
  canInstall = false,
  onRespinDate = null,
  onAssignMeal = null,
  onCreateMealForDay = null,
  spinConstraints = null,
  onChangeSpinConstraints = null,
}) {
  const [hoveredTile, setHoveredTile] = useState(null);
  const [hoveredStats, setHoveredStats] = useState(false);
  const [hoverEmptyButton, setHoverEmptyButton] = useState(false);
  const [previewDay, setPreviewDay] = useState(null); // { date, meal, isToday }

  // ── Widget dashboard: reorder / pin / hide, persisted device-local ────────
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState(() => loadLandingLayout()); // { order, hidden }
  useEffect(() => { saveLandingLayout(layout); }, [layout]);

  // ── Banner interactivity: tactile Spin button dice-rattle-on-tap ──────────
  const [diceRattling, setDiceRattling] = useState(false);

  // ── Sticky header visibility via IntersectionObserver ────────────────────
  const heroRef = useRef(null);
  const [stickyVisible, setStickyVisible] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Greeting and date
  const { greeting } = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return { greeting: 'Good morning! ☀️' };
    if (hour < 18) return { greeting: 'Good afternoon! 🌤️' };
    if (hour < 21) return { greeting: 'Good evening! 🌅' };
    return { greeting: 'Night owl mode 🦉' };
  }, []);

  const formattedDate = useMemo(() => {
    const today = new Date();
    const dow = DOW_SHORT[today.getDay()];
    const date = today.getDate();
    const monthName = today.toLocaleString('default', { month: 'long' });
    return `${dow}, ${monthName} ${date}`;
  }, []);

  // ── Build Next 5 Days ──────────────────────────────────────────────────────
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const currentWeekMonday = useMemo(() => getMondayOfWeek(today), [today]);

  const next5Days = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const date = addDays(today, i);
      const isToday = i === 0;
      // Find meal: check current weekPlan first, then weekHistory
      const weekMon = getMondayOfWeek(date);
      const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // Mon-first index
      let meal = null;
      if (weekMon.getTime() === currentWeekMonday.getTime()) {
        meal = weekPlan[dow] || null;
      } else {
        const key = localDateKey(weekMon);
        const histEntry = weekHistory.find(hw => {
          const hwMon = new Date(hw.weekStart); hwMon.setHours(0,0,0,0);
          return localDateKey(hwMon) === key;
        });
        if (histEntry) meal = histEntry.meals?.[dow] || null;
      }
      return { date, meal, isToday };
    });
  }, [today, currentWeekMonday, weekPlan, weekHistory]);

  const hasAnyMeal = next5Days.some(d => d.meal !== null);

  // ── Tiles ──────────────────────────────────────────────────────────────────
  const { streak = 0, totalCooked = 0, topMeal = null } = cookingStats || {};

  // Widget telemetry (Gemini landing analysis, 2026-07-14): status at a glance,
  // computed entirely from local data already in props — no network calls.
  const groceryTelemetry = useMemo(() => {
    if (!groceryItems.length) return 'Build shopping list';
    const unchecked = groceryItems.filter(i => !i.isChecked).length;
    return unchecked > 0 ? `${unchecked} item${unchecked === 1 ? '' : 's'} needed` : 'All set ✓';
  }, [groceryItems]);

  const fridgeTelemetry = useMemo(() => {
    if (!fridgeInventory.length) return 'All I have is ingredients for food.';
    // "Expiring soon" only makes sense for perishables — a jar of cumin isn't
    // going anywhere in 6 days the way a chicken breast is.
    const PERISHABLE = new Set(['protein', 'produce', 'dairy']);
    const aging = fridgeInventory.filter(r => {
      const fresh = freshnessOf(r?.addedAt);
      if (fresh !== 'aging' && fresh !== 'old') return false;
      const cat = categorizeKitchen(r?.ingredient)?.category;
      return cat ? PERISHABLE.has(cat) : false;
    }).length;
    if (aging > 0) return `${aging} item${aging === 1 ? '' : 's'} aging — use soon`;
    return `${fridgeInventory.length} item${fridgeInventory.length === 1 ? '' : 's'} on hand`;
  }, [fridgeInventory]);

  const tiles = useMemo(() => [
    {
      id: 'planWeek',
      emoji: '🎲',
      title: 'Plan out your week of meals',
      subtitle: "So you stop texting ‘idk, you pick’ at 5pm.",
      accent: TILE_COLORS.planWeek,
      onClick: () => onNavigate('week'),
    },
    {
      id: 'myMeals',
      emoji: '📓',
      title: 'My Meals',
      subtitle: `${meals.length} recipes saved`,
      accent: TILE_COLORS.myMeals,
      onClick: () => onNavigate('library'),
    },
    {
      id: 'bar',
      emoji: '🍸',
      title: 'Bar Shelf',
      subtitle: drinks.length > 0 ? "Tonight's Cocktail" : `${drinks.length} drinks saved`,
      accent: TILE_COLORS.bar,
      onClick: () => onNavigate('bar'),
    },
    {
      id: 'grocery',
      emoji: '🛒',
      title: 'Grocery List',
      subtitle: groceryTelemetry,
      accent: TILE_COLORS.grocery,
      onClick: () => onNavigate('grocery'),
    },
    {
      id: 'pantry',
      emoji: '🥫',
      title: 'Pantry',
      subtitle: 'Track what’s on hand',
      accent: TILE_COLORS.pantry,
      onClick: () => onOpenPantry(),
    },
    {
      id: 'fridge',
      emoji: '🧊',
      title: 'What Can I Cook today?',
      subtitle: fridgeTelemetry,
      accent: TILE_COLORS.fridge,
      onClick: () => onOpenFridge(),
    },
    {
      id: 'stats',
      emoji: '📊',
      title: 'Stats',
      subtitle: totalCooked > 0 ? `${totalCooked} meals cooked` : 'Track your cooking',
      accent: TILE_COLORS.stats,
      onClick: () => onOpenStats(),
    },
  ], [rotationCount, meals.length, drinks.length, totalCooked, groceryTelemetry, fridgeTelemetry, onNavigate, onOpenFridge, onOpenPantry, onOpenStats]);

  const tilesById = useMemo(() => {
    const map = {};
    for (const t of tiles) map[t.id] = t;
    return map;
  }, [tiles]);

  // Layout order/hidden reference tile ids only — tile definitions (emoji,
  // onClick, live telemetry) always come fresh from `tiles` above, so a
  // reordered/hidden widget never goes stale.
  const visibleTiles = useMemo(
    () => layout.order.map(id => tilesById[id]).filter(Boolean).filter(t => !layout.hidden.includes(t.id)),
    [layout, tilesById]
  );
  const hiddenTileDefs = useMemo(
    () => layout.order.map(id => tilesById[id]).filter(Boolean).filter(t => layout.hidden.includes(t.id)),
    [layout, tilesById]
  );

  const handleReorderTiles = useCallback((newVisibleOrder) => {
    setLayout(prev => {
      const newIds = newVisibleOrder.map(t => t.id);
      // Preserve hidden tiles' relative position by appending them after the
      // reordered visible ones — they're not shown, but this keeps `order`
      // a stable superset so un-hiding doesn't dump them at a random spot.
      const stillHidden = prev.order.filter(id => prev.hidden.includes(id));
      return { ...prev, order: [...newIds, ...stillHidden] };
    });
  }, []);

  const handleToggleHidden = useCallback((id) => {
    setLayout(prev => {
      const hidden = prev.hidden.includes(id)
        ? prev.hidden.filter(h => h !== id)
        : [...prev.hidden, id];
      return { ...prev, hidden };
    });
  }, []);

  // ── Seasonal picks ──────────────────────────────────────────────────────────
  const seasonInfo = useMemo(() => getSeasonInfo(), []);
  const seasonalMeals = useMemo(() => getSeasonalMeals(meals, seasonInfo), [meals, seasonInfo]);

  // ── Telemetry Ticker — rotating status line replacing the static tagline ──
  // Skips weather entirely per product decision (2026-07-14) — every line
  // here comes from data already in props, no network/geolocation involved.
  const tickerItems = useMemo(() => {
    const items = [{ key: 'tagline', text: 'Your meals, gamified.', onTap: null }];
    if (streak > 0) {
      items.push({ key: 'streak', text: `Active Streak: ${streak} home-cooked meal${streak === 1 ? '' : 's'} 🔥`, onTap: () => onOpenStats() });
    }
    if (groceryItems.length > 0) {
      const unchecked = groceryItems.filter(i => !i.isChecked).length;
      if (unchecked > 0) {
        items.push({ key: 'grocery', text: `Pantry Status: ${unchecked} item${unchecked === 1 ? '' : 's'} running low`, onTap: () => onNavigate('grocery') });
      }
    }
    const todayMealForTicker = next5Days[0]?.meal;
    if (todayMealForTicker && !todayMealForTicker._special) {
      const mins = mealTickerMinutes(todayMealForTicker);
      if (mins != null) {
        items.push({ key: 'tonight', text: `Tonight: ${mins} min prep time`, onTap: () => onViewDetail(todayMealForTicker) });
      }
    }
    return items;
  }, [streak, groceryItems, next5Days, onOpenStats, onNavigate, onViewDetail]);

  const [tickerIndex, setTickerIndex] = useState(0);
  useEffect(() => {
    if (tickerItems.length <= 1) { setTickerIndex(0); return; }
    const id = setInterval(() => setTickerIndex(i => (i + 1) % tickerItems.length), 6000);
    return () => clearInterval(id);
  }, [tickerItems.length]);
  // Clamp in case the item count shrank (e.g. grocery list got fully checked off)
  const activeTicker = tickerItems[tickerIndex % tickerItems.length] || tickerItems[0];

  const getTileStyle = (tileId) => ({
    ...STYLES.tile,
    ...(hoveredTile === tileId && STYLES.tileHover),
  });

  // Today's meal for hero card
  const todayMeal = next5Days[0]?.meal;

  return (
    <div style={STYLES.container}>
      {/* Sticky mini-header — appears on scroll past hero */}
      <StickyHeader visible={stickyVisible} onSpin={onGenerate} />

      {/* Hero — flattened to reclaim the fold (slim context bar + primary CTA) */}
      <motion.div
        ref={heroRef}
        style={{ marginBottom: '20px' }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        {/* Slim single-line context bar */}
        <div style={STYLES.contextBar}>
          <span style={STYLES.contextGreeting}>{greeting}</span>
          <span style={STYLES.contextDivider}>•</span>
          <span style={STYLES.contextDate}>{formattedDate}</span>
          {streak > 0 && (
            <span style={STYLES.contextStreak}>{streak} day streak 🔥</span>
          )}
        </div>

        {/* Telemetry Ticker — rotating status line, tap to deep-link (replaces
            the old static "Your meals, gamified." tagline). Weather excluded
            on purpose — every line here is local data, no network call. */}
        <div
          className="landing-ticker"
          onClick={activeTicker.onTap || undefined}
          onKeyDown={activeTicker.onTap ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activeTicker.onTap(); } } : undefined}
          role={activeTicker.onTap ? 'button' : undefined}
          tabIndex={activeTicker.onTap ? 0 : undefined}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTicker.key}
              className="landing-ticker-text"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              {activeTicker.text}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Spin Action Center — consolidated Spin CTA + pre-spin constraint
            toggles (Gemini landing analysis, 2026-07-14). Toggles pre-filter
            the candidate pool the spinner draws from (WeekView + weekPlanner's
            filterMealsByConstraints); "Vegetarian Only" mirrors the existing
            household dietaryPref rather than inventing a second setting. */}
        {onChangeSpinConstraints && (
          <div className="spin-action-center">
            <button
              type="button"
              className={`spin-constraint-toggle${spinConstraints?.vegetarianOnly ? ' active' : ''}`}
              onClick={() => onChangeSpinConstraints({ vegetarianOnly: !spinConstraints?.vegetarianOnly })}
              aria-pressed={!!spinConstraints?.vegetarianOnly}
            >
              <span className="sct-box">{spinConstraints?.vegetarianOnly ? '✓' : ''}</span> Vegetarian Only
            </button>
            <button
              type="button"
              className={`spin-constraint-toggle${spinConstraints?.under30 ? ' active' : ''}`}
              onClick={() => onChangeSpinConstraints({ under30: !spinConstraints?.under30 })}
              aria-pressed={!!spinConstraints?.under30}
            >
              <span className="sct-box">{spinConstraints?.under30 ? '✓' : ''}</span> Under 30 Mins
            </button>
            <button
              type="button"
              className={`spin-constraint-toggle${spinConstraints?.useFridgeStock ? ' active' : ''}`}
              onClick={() => onChangeSpinConstraints({ useFridgeStock: !spinConstraints?.useFridgeStock })}
              aria-pressed={!!spinConstraints?.useFridgeStock}
            >
              <span className="sct-box">{spinConstraints?.useFridgeStock ? '✓' : ''}</span> Use Fridge Stock
            </button>
          </div>
        )}

        {/* Primary CTA — Spin the Week (full width). Gemini UX audit
            (2026-07-06): with 0 saved meals, "Spin the Week" is a dead end —
            the button label itself should say what to do next. Clicking
            always works (App.jsx generateWeek routes to the Library with a
            toast when there aren't enough meals yet), this is just honest
            labeling of what will happen. */}
        <motion.button
          className={`btn-primary spin-tactile${!hasAnyMeal ? ' spin-pulse' : ''}`}
          onClick={() => { setDiceRattling(true); setTimeout(() => setDiceRattling(false), 600); onGenerate(); }}
          initial="rest"
          whileHover="hover"
          whileTap={{ scale: 0.97 }}
          animate="rest"
          style={STYLES.spinBtnFull}
        >
          {meals.length === 0 ? (
            'Add Meals to Spin'
          ) : (
            <>
              Spin the Week{' '}
              <motion.span
                variants={diceVariants}
                className={diceRattling ? 'dice-rattle-on-tap' : ''}
                style={{ display: 'inline-block', transformOrigin: 'center' }}
              >🎲</motion.span>
            </>
          )}
        </motion.button>
      </motion.div>

      {/* Install banner — shown when PWA install is available */}
      <AnimatePresence>
        {canInstall && onInstallApp && (
          <InstallBanner onInstall={onInstallApp} />
        )}
      </AnimatePresence>

      {/* Today's meal — elevated hero card */}
      {todayMeal && !todayMeal._special && todayMeal.name && (
        <TodayHeroCard meal={todayMeal} onPress={onViewDetail} />
      )}

      {/* ── Next 5 Days ── */}
      <div style={STYLES.nextDaysSection}>
        <div style={STYLES.sectionLabel}>Next 5 Days</div>
        {hasAnyMeal ? (
          <div style={STYLES.nextDaysScrollWrap}>
            <motion.div
              className="sh-carousel"
              style={STYLES.nextDaysScroll}
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
            >
              {next5Days.map(({ date, meal, isToday }) => (
                <DayPhotoCard
                  key={localDateKey(date)}
                  date={date}
                  meal={meal}
                  isToday={isToday}
                  onClick={() => setPreviewDay({ date, meal, isToday })}
                />
              ))}
            </motion.div>
            <div style={STYLES.nextDaysFade} aria-hidden="true" />
          </div>
        ) : (
          <motion.div
            style={STYLES.emptyState}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <div style={STYLES.emptyStateIcon}><Dices size={22} strokeWidth={1.75} /></div>
            <div style={STYLES.emptyStateText}>Nothing planned yet</div>
            <div style={STYLES.emptyStateHint}>Spin the wheel to fill your week with meals.</div>
            <button
              onClick={onGenerate}
              onMouseEnter={() => setHoverEmptyButton(true)}
              onMouseLeave={() => setHoverEmptyButton(false)}
              style={{
                ...STYLES.emptyStateButton,
                ...(hoverEmptyButton && { background: 'var(--primary-dark)', transform: 'scale(1.02)' }),
              }}
            >
              Spin the Wheel
            </button>
          </motion.div>
        )}
      </div>

      {/* ── Discover — browse recipe communities, tap to import ── */}
      <DiscoverFeatureCard onPress={onOpenDiscover} />

      {/* ── Widget dashboard (reorder / pin / hide, persisted local layout) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ ...STYLES.sectionLabel, marginBottom: 0 }}>Your Widgets</div>
        <button
          type="button"
          className="landing-edit-toggle"
          onClick={() => setEditMode(e => !e)}
          aria-pressed={editMode}
        >
          {editMode ? (<><Check size={14} strokeWidth={2.5} /> Done</>) : (<><Pencil size={13} strokeWidth={2.25} /> Edit</>)}
        </button>
      </div>

      {!editMode ? (
        <motion.div
          style={STYLES.tilesGrid}
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
        >
          {visibleTiles.map((tile) => {
            const isPrimary = PRIMARY_TILES.has(tile.id);
            const isBar = tile.id === 'bar';
            const tileClasses = [
              'landing-tile-glass',
              isPrimary ? 'landing-tile-primary' : '',
              isBar ? 'tile-bar' : '',
            ].filter(Boolean).join(' ');

            return (
              <motion.button
                key={tile.id}
                className={tileClasses}
                onClick={tile.onClick}
                variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } }}
                whileHover={{ scale: 0.97, y: -2, boxShadow: 'var(--shadow)', opacity: 0.98 }}
                whileTap={{ scale: 0.94 }}
                style={{
                  ...STYLES.tile,
                  ...(isPrimary ? { padding: '18px 20px 18px 24px' } : { padding: '16px 16px 16px 20px' }),
                  textAlign: 'left',
                  outline: 'none',
                }}
              >
                {!isPrimary && (
                  <div style={{ ...STYLES.tileAccent, backgroundColor: tile.accent }} />
                )}
                {isPrimary ? (
                  <>
                    <div className="tile-emoji-wrap" style={{ fontSize: '36px', flexShrink: 0 }}>{tile.emoji}</div>
                    <div className="tile-text-wrap" style={{ flex: 1, minWidth: 0 }}>
                      <div style={STYLES.tileTitle}>{tile.title}</div>
                      <div style={STYLES.tileSubtitle}>{tile.subtitle}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={STYLES.tileEmoji}>{tile.emoji}</div>
                    <div style={STYLES.tileTitle}>{tile.title}</div>
                    <div style={STYLES.tileSubtitle}>{tile.subtitle}</div>
                  </>
                )}
              </motion.button>
            );
          })}
        </motion.div>
      ) : (
        <>
          <Reorder.Group
            as="div"
            axis="y"
            values={visibleTiles}
            onReorder={handleReorderTiles}
            style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, listStyle: 'none', padding: 0, margin: '0 0 14px' }}
          >
            {visibleTiles.map((tile) => (
              <Reorder.Item
                as="div"
                key={tile.id}
                value={tile}
                className="landing-widget-edit-row"
                whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)', zIndex: 5 }}
              >
                <span className="landing-drag-handle" aria-hidden="true"><GripVertical size={18} strokeWidth={2} /></span>
                <span style={{ fontSize: 26, flexShrink: 0 }}>{tile.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...STYLES.tileTitle, fontSize: 14, marginBottom: 2 }}>{tile.title}</div>
                  <div style={STYLES.tileSubtitle}>{tile.subtitle}</div>
                </span>
                <button
                  type="button"
                  className="landing-hide-btn"
                  aria-label={`Hide ${tile.title} widget`}
                  onClick={() => handleToggleHidden(tile.id)}
                >
                  <EyeOff size={16} strokeWidth={2} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {hiddenTileDefs.length > 0 && (
            <div className="landing-hidden-widgets">
              <div className="landing-hidden-widgets-label">Hidden widgets — tap to restore</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {hiddenTileDefs.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    className="landing-hidden-chip"
                    onClick={() => handleToggleHidden(tile.id)}
                  >
                    <Eye size={13} strokeWidth={2} /> {tile.emoji} {tile.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Stats strip ── */}
      {(streak > 0 || topMeal) && (
        <motion.button
          onClick={onOpenStats}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.02, backgroundColor: '#faf7f0', boxShadow: 'var(--shadow)' }}
          whileTap={{ scale: 0.98 }}
          style={{
            ...STYLES.statsStrip,
            outline: 'none',
            border: '1px solid var(--border)',
            width: '100%',
            justifyContent: 'center',
            marginBottom: '24px'
          }}
        >
          {streak > 0 && (
            <div style={STYLES.statItem}>
              <span style={STYLES.statEmoji}>🔥</span>
              <span>{streak} day streak</span>
            </div>
          )}
          {topMeal && (
            <div style={STYLES.statItem}>
              <span style={STYLES.statEmoji}>⭐</span>
              <span>{topMeal?.name || topMeal}</span>
            </div>
          )}
        </motion.button>
      )}

      {/* ── Seasonal Picks ── */}
      {seasonalMeals.length >= 2 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1], delay: 0.1 }}
          style={{ marginBottom: '24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
              {seasonInfo.emoji} {seasonInfo.headline}
            </div>
            <button
              onClick={() => onNavigate('library')}
              style={{ fontSize: '12px', fontWeight: '600', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
            >
              See all →
            </button>
          </div>
          <div className="sh-carousel" style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x', overscrollBehaviorX: 'contain' }}>
            {seasonalMeals.map(meal => (
              <SeasonalMealCard
                key={meal.id || meal.name}
                meal={meal}
                onPress={() => onViewDetail(meal)}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Day preview bottom sheet ── */}
      <AnimatePresence>
        {previewDay && (
          <MealPreviewSheet
            key="preview-sheet"
            date={previewDay.date}
            meal={previewDay.meal}
            isToday={previewDay.isToday}
            onClose={() => setPreviewDay(null)}
            onViewFull={(meal) => { onViewDetail(meal); }}
            meals={meals}
            onRespinDate={onRespinDate}
            onAssignMeal={onAssignMeal}
            onCreateMealForDay={onCreateMealForDay}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
