import React, { useState, useMemo, useEffect, useCallback } from 'react';
import SafeMediaImage from './SafeMediaImage.jsx';

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
  // ── Next 5 Days horizontal scroll ──
  nextDaysSection: {
    marginBottom: '24px',
  },
  nextDaysScroll: {
    display: 'flex',
    gap: '10px',
    overflowX: 'auto',
    paddingBottom: '8px',
    scrollBehavior: 'smooth',
    WebkitOverflowScrolling: 'touch',
  },
  dayCard: {
    flexShrink: 0,
    width: '130px',
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
    height: '80px',
    objectFit: 'cover',
    display: 'block',
    background: 'var(--surface)',
    flexShrink: 0,
  },
  dayCardPhotoFallback: {
    width: '100%',
    height: '80px',
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
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text)',
    lineHeight: '1.3',
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
    padding: '16px',
    textAlign: 'center',
    marginBottom: '24px',
  },
  emptyStateText: {
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text)',
    marginBottom: '12px',
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
    animation: 'lp-slideUp 0.3s cubic-bezier(0.32,0.72,0,1) both',
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

// Inject slideUp keyframe once
let _injectedLPStyle = false;
function injectLPStyle() {
  if (_injectedLPStyle || document.getElementById('lp-anim-style')) return;
  _injectedLPStyle = true;
  const s = document.createElement('style');
  s.id = 'lp-anim-style';
  s.textContent = `
    @keyframes lp-slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TILE_COLORS = {
  planWeek: '#e65100',
  myMeals: '#2e7d32',
  bar: '#7b1fa2',
  grocery: '#1565c0',
  fridge: '#00838f',
  stats: '#e65100',
};

// ── DayPhotoCard ──────────────────────────────────────────────────────────────
function DayPhotoCard({ date, meal, isToday, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateNum = date.getDate();
  const specialEmoji = meal?._special ? meal.icon : null;

  return (
    <button
      onClick={onClick}
      style={{
        ...STYLES.dayCard,
        ...(isToday && STYLES.dayCardToday),
        border: isToday ? '2px solid var(--primary)' : '1.5px solid var(--border)',
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
        }}>
          {dayLabel} {dateNum}
        </div>
        {meal ? (
          <div style={STYLES.dayCardMealName}>{meal.name}</div>
        ) : (
          <div style={STYLES.dayCardEmpty}>Nothing yet</div>
        )}
      </div>
    </button>
  );
}

// ── MealPreviewSheet ──────────────────────────────────────────────────────────
function MealPreviewSheet({ date, meal, isToday, onClose, onViewFull }) {
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => { injectLPStyle(); }, []);

  const dayLabel = isToday ? 'Today' : DOW_SHORT[date.getDay()];
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <>
      {/* Scrim */}
      <div style={STYLES.scrim} onClick={onClose} />
      {/* Sheet */}
      <div style={STYLES.previewSheet}>
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
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{ fontSize: 15, color: 'var(--text-light)' }}>Nothing planned for this day.</div>
            </div>
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
      </div>
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
  rotationCount = 0,
  onNavigate = () => {},
  onGenerate = () => {},
  onViewDetail = () => {},
  onOpenFridge = () => {},
  onOpenStats = () => {},
}) {
  useEffect(() => { injectLPStyle(); }, []);

  const [hoveredTile, setHoveredTile] = useState(null);
  const [hoveredStats, setHoveredStats] = useState(false);
  const [hoverEmptyButton, setHoverEmptyButton] = useState(false);
  const [previewDay, setPreviewDay] = useState(null); // { date, meal, isToday }

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

  const tiles = useMemo(() => [
    {
      id: 'planWeek',
      emoji: '📅',
      title: 'Plan Week',
      subtitle: rotationCount > 0 ? `${rotationCount} in rotation` : 'Organize your meals',
      accent: TILE_COLORS.planWeek,
      onClick: () => onNavigate('week'),
    },
    {
      id: 'myMeals',
      emoji: '🍳',
      title: 'My Meals',
      subtitle: `${meals.length} recipes saved`,
      accent: TILE_COLORS.myMeals,
      onClick: () => onNavigate('library'),
    },
    {
      id: 'bar',
      emoji: '🍹',
      title: 'The Bar',
      subtitle: `${drinks.length} drinks saved`,
      accent: TILE_COLORS.bar,
      onClick: () => onNavigate('bar'),
    },
    {
      id: 'grocery',
      emoji: '🛒',
      title: 'Grocery List',
      subtitle: 'Build from your week',
      accent: TILE_COLORS.grocery,
      onClick: () => onNavigate('grocery'),
    },
    {
      id: 'fridge',
      emoji: '🧊',
      title: 'Fridge Mode',
      subtitle: 'What can I make?',
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
  ], [rotationCount, meals.length, drinks.length, totalCooked, onNavigate, onOpenFridge, onOpenStats]);

  const getTileStyle = (tileId) => ({
    ...STYLES.tile,
    ...(hoveredTile === tileId && STYLES.tileHover),
  });

  return (
    <div style={STYLES.container}>
      {/* Header */}
      <div style={STYLES.header}>
        <div style={STYLES.headerGreeting}>{greeting}</div>
        <div style={STYLES.headerDate}>{formattedDate}</div>
      </div>

      {/* ── Next 5 Days ── */}
      <div style={STYLES.nextDaysSection}>
        <div style={STYLES.sectionLabel}>Next 5 Days</div>
        {hasAnyMeal ? (
          <div style={STYLES.nextDaysScroll}>
            {next5Days.map(({ date, meal, isToday }) => (
              <DayPhotoCard
                key={localDateKey(date)}
                date={date}
                meal={meal}
                isToday={isToday}
                onClick={() => setPreviewDay({ date, meal, isToday })}
              />
            ))}
          </div>
        ) : (
          <div style={STYLES.emptyState}>
            <div style={STYLES.emptyStateText}>Nothing planned — let's spin!</div>
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
          </div>
        )}
      </div>

      {/* ── Navigation tiles ── */}
      <div style={STYLES.tilesGrid}>
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={tile.onClick}
            onMouseEnter={() => setHoveredTile(tile.id)}
            onMouseLeave={() => setHoveredTile(null)}
            style={getTileStyle(tile.id)}
          >
            <div style={{ ...STYLES.tileAccent, backgroundColor: tile.accent }} />
            <div style={STYLES.tileEmoji}>{tile.emoji}</div>
            <div style={STYLES.tileTitle}>{tile.title}</div>
            <div style={STYLES.tileSubtitle}>{tile.subtitle}</div>
          </button>
        ))}
      </div>

      {/* ── Stats strip ── */}
      {(streak > 0 || topMeal) && (
        <button
          onClick={onOpenStats}
          onMouseEnter={() => setHoveredStats(true)}
          onMouseLeave={() => setHoveredStats(false)}
          style={{
            ...STYLES.statsStrip,
            ...(hoveredStats && { background: '#faf7f0', boxShadow: 'var(--shadow)' }),
            outline: 'none',
            border: hoveredStats ? '1px solid var(--border)' : '1px solid var(--border)',
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
        </button>
      )}

      {/* ── Day preview bottom sheet ── */}
      {previewDay && (
        <MealPreviewSheet
          date={previewDay.date}
          meal={previewDay.meal}
          isToday={previewDay.isToday}
          onClose={() => setPreviewDay(null)}
          onViewFull={(meal) => { onViewDetail(meal); }}
        />
      )}
    </div>
  );
}
