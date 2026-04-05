import React, { useState, useMemo, useEffect } from 'react';

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
  weekStripContainer: {
    marginBottom: '24px',
  },
  weekStripLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text)',
    marginBottom: '12px',
  },
  weekStrip: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '8px',
    scrollBehavior: 'smooth',
  },
  dayChip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '50px',
    height: '60px',
    background: 'var(--card)',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease-out',
    fontSize: '12px',
    fontWeight: '500',
    color: 'var(--text-light)',
  },
  dayChipToday: {
    background: 'var(--primary)',
    color: '#fff',
    border: '1.5px solid var(--primary)',
    fontWeight: '700',
  },
  dayChipWithMeal: {
    borderColor: 'var(--primary)',
    borderWidth: '2px',
  },
  dayChipMealDot: {
    width: '6px',
    height: '6px',
    background: 'var(--primary)',
    borderRadius: '50%',
    marginTop: '4px',
  },
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
  emptyStateButtonHover: {
    background: 'var(--primary-dark)',
    transform: 'scale(1.02)',
  },
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
  tileBorder: {
    position: 'relative',
  },
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
  statsStripHover: {
    background: '#faf7f0',
    boxShadow: 'var(--shadow)',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--text)',
  },
  statEmoji: {
    fontSize: '16px',
  },
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TILE_COLORS = {
  planWeek: '#e65100',
  myMeals: '#2e7d32',
  bar: '#7b1fa2',
  grocery: '#1565c0',
  fridge: '#00838f',
  stats: '#e65100',
};

export default function LandingPage({
  cookingStats = {},
  weekPlan = [],
  meals = [],
  drinks = [],
  rotationCount = 0,
  onNavigate = () => {},
  onGenerate = () => {},
  onViewDetail = () => {},
  onOpenFridge = () => {},
  onOpenStats = () => {},
}) {
  const [hoveredTile, setHoveredTile] = useState(null);
  const [hoveredStats, setHoveredStats] = useState(false);
  const [hoverEmptyButton, setHoverEmptyButton] = useState(false);

  // Compute greeting and date
  const { greeting, period } = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return { greeting: 'Good morning! ☀️', period: 'morning' };
    if (hour < 18) return { greeting: 'Good afternoon! 🌤️', period: 'afternoon' };
    if (hour < 21) return { greeting: 'Good evening! 🌅', period: 'evening' };
    return { greeting: 'Night owl mode 🦉', period: 'night' };
  }, []);

  const formattedDate = useMemo(() => {
    const today = new Date();
    const dayName = DAYS[today.getDay() === 0 ? 6 : today.getDay() - 1];
    const date = today.getDate();
    const monthName = today.toLocaleString('default', { month: 'long' });
    return `${dayName}, ${monthName} ${date}`;
  }, []);

  // Get current day of week (0=Monday, 6=Sunday)
  const todayIndex = useMemo(() => {
    const today = new Date();
    return today.getDay() === 0 ? 6 : today.getDay() - 1;
  }, []);

  // Check if any meals are planned for the week
  const hasWeekPlan = useMemo(() => {
    return weekPlan && weekPlan.some((meal) => meal !== null);
  }, [weekPlan]);

  // Get stats data
  const { streak = 0, totalCooked = 0, topMeal = null } = cookingStats || {};

  // Tile definitions
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

  const handleTileClick = (tile) => {
    tile.onClick();
  };

  const getTileStyle = (tileId) => {
    const tileData = tiles.find((t) => t.id === tileId);
    return {
      ...STYLES.tile,
      ...(hoveredTile === tileId && STYLES.tileHover),
    };
  };

  return (
    <div style={STYLES.container}>
      {/* Header with greeting and date */}
      <div style={STYLES.header}>
        <div style={STYLES.headerGreeting}>{greeting}</div>
        <div style={STYLES.headerDate}>{formattedDate}</div>
      </div>

      {/* This Week mini strip */}
      <div style={STYLES.weekStripContainer}>
        <div style={STYLES.weekStripLabel}>This Week</div>
        {hasWeekPlan ? (
          <div style={STYLES.weekStrip}>
            {DAYS.map((day, index) => (
              <button
                key={day}
                onClick={() => onNavigate('week')}
                style={{
                  ...STYLES.dayChip,
                  ...(index === todayIndex && STYLES.dayChipToday),
                  ...(weekPlan[index] && STYLES.dayChipWithMeal),
                  outline: 'none',
                }}
                aria-label={`${day}, ${index === todayIndex ? 'today' : ''}`}
              >
                <div>{day}</div>
                {weekPlan[index] && (
                  <div
                    style={{
                      ...STYLES.dayChipMealDot,
                      background: index === todayIndex ? 'rgba(255,255,255,0.8)' : 'var(--primary)',
                    }}
                  />
                )}
              </button>
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
                ...(hoverEmptyButton && STYLES.emptyStateButtonHover),
              }}
            >
              Spin the Wheel
            </button>
          </div>
        )}
      </div>

      {/* Navigation tiles grid */}
      <div style={STYLES.tilesGrid}>
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => handleTileClick(tile)}
            onMouseEnter={() => setHoveredTile(tile.id)}
            onMouseLeave={() => setHoveredTile(null)}
            style={getTileStyle(tile.id)}
          >
            <div
              style={{
                ...STYLES.tileAccent,
                backgroundColor: tile.accent,
              }}
            />
            <div style={STYLES.tileEmoji}>{tile.emoji}</div>
            <div style={STYLES.tileTitle}>{tile.title}</div>
            <div style={STYLES.tileSubtitle}>{tile.subtitle}</div>
          </button>
        ))}
      </div>

      {/* Stats strip (bottom) */}
      {(streak > 0 || topMeal) && (
        <button
          onClick={onOpenStats}
          onMouseEnter={() => setHoveredStats(true)}
          onMouseLeave={() => setHoveredStats(false)}
          style={{
            ...STYLES.statsStrip,
            ...(hoveredStats && STYLES.statsStripHover),
            outline: 'none',
            border: 'none',
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
    </div>
  );
}
